/**
 * Deploy v2 stack:
 *   - AegisVault_v2 implementation (+ AegisVaultFactory pointing at it)
 *   - Fresh ExecutionRegistry (isolated from v1)
 *   - InsurancePool_v2 (with rescueToken)
 *   - OperatorStaking_v2 (with rescueToken)
 *
 * Reuses existing on-chain pieces (libraries, OperatorRegistry, treasury,
 * USDC token) so no duplicate state + no migration needed for operators.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-v2.js --network og_mainnet
 *   (or --network og_testnet for a shakeout first)
 *
 * Writes to:
 *   - deployments-mainnet.json  (chainId 16661)
 *   - deployments.json          (any other chain)
 *
 * Keys are prefixed with "v2" so v1 addresses stay untouched and frontend
 * can switch at its own pace.
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

function loadDeployments(chainId) {
  const file = Number(chainId) === 16661 ? "deployments-mainnet.json" : "deployments.json";
  const p = path.resolve(__dirname, "..", file);
  if (!fs.existsSync(p)) {
    throw new Error(`${file} not found — run phase 1 / 2 before v2`);
  }
  return { path: p, data: JSON.parse(fs.readFileSync(p, "utf8")) };
}

function requireField(deployments, key, hint) {
  if (!deployments[key]) {
    throw new Error(`${key} missing in deployments file — ${hint}`);
  }
  return deployments[key];
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log("─".repeat(60));
  console.log("Deploying AegisVault v2 stack");
  console.log("  Network: ", net.name, "(chainId", net.chainId, ")");
  console.log("  Deployer:", deployer.address);

  const { path: deployFile, data: deployments } = loadDeployments(net.chainId);

  const treasury         = requireField(deployments, "protocolTreasury", "deploy phase1 first");
  const operatorRegistry = requireField(deployments, "operatorRegistry", "deploy phase1 first");

  // Prefer deployed real-token address when present (mainnet), else fall back
  // to mockUSDC (hardhat/testnet).
  const usdc = deployments.realTokens?.USDCe
    || deployments.USDCe
    || requireField(deployments, "mockUSDC", "no USDC address found (expected realTokens.USDCe or mockUSDC)");

  console.log("  Treasury reused:        ", treasury);
  console.log("  OperatorRegistry reused:", operatorRegistry);
  console.log("  USDC (stake/payout):    ", usdc);

  // Arbitrator default = deployer. For mainnet, rotate to the multi-sig
  // AFTER deploy with setArbitrator() (same pattern as v1).
  const arbitrator = deployer.address;
  console.log("  Arbitrator (initial):   ", arbitrator);

  // ── 1. Libraries (reuse if already deployed, else deploy fresh) ──
  console.log("\n1/7 Libraries (ExecLib / SealedLib / IOLib)");
  let execLibAddr   = deployments.execLibrary;
  let sealedLibAddr = deployments.sealedLibrary;
  let ioLibAddr     = deployments.ioLibrary;

  if (!execLibAddr) {
    const ExecLib = await ethers.getContractFactory("ExecLib");
    const lib = await ExecLib.deploy();
    await lib.waitForDeployment();
    execLibAddr = await lib.getAddress();
    console.log("    ExecLib deployed   :", execLibAddr);
  } else {
    console.log("    ExecLib reused     :", execLibAddr);
  }
  if (!sealedLibAddr) {
    const SealedLib = await ethers.getContractFactory("SealedLib");
    const lib = await SealedLib.deploy();
    await lib.waitForDeployment();
    sealedLibAddr = await lib.getAddress();
    console.log("    SealedLib deployed :", sealedLibAddr);
  } else {
    console.log("    SealedLib reused   :", sealedLibAddr);
  }
  if (!ioLibAddr) {
    const IOLib = await ethers.getContractFactory("IOLib");
    const lib = await IOLib.deploy();
    await lib.waitForDeployment();
    ioLibAddr = await lib.getAddress();
    console.log("    IOLib deployed     :", ioLibAddr);
  } else {
    console.log("    IOLib reused       :", ioLibAddr);
  }

  // ── 2. AegisVault_v2 implementation ──
  console.log("\n2/7 AegisVault_v2 implementation");
  const VaultV2 = await ethers.getContractFactory("AegisVault_v2", {
    libraries: { ExecLib: execLibAddr, SealedLib: sealedLibAddr, IOLib: ioLibAddr },
  });
  const implV2 = await VaultV2.deploy();
  await implV2.waitForDeployment();
  const implV2Addr = await implV2.getAddress();
  console.log("    AegisVault_v2 impl :", implV2Addr);

  // ── 3. Fresh ExecutionRegistry (isolated for v2) ──
  console.log("\n3/7 ExecutionRegistry_v2 (fresh instance, isolated from v1)");
  const Registry = await ethers.getContractFactory("ExecutionRegistry");
  const registryV2 = await Registry.deploy();
  await registryV2.waitForDeployment();
  const registryV2Addr = await registryV2.getAddress();
  console.log("    ExecutionRegistry v2:", registryV2Addr);

  // ── 4. Factory v2 pointing at v2 impl + v2 registry + shared treasury ──
  console.log("\n4/7 AegisVaultFactory (v2 — new instance, same contract code)");
  const Factory = await ethers.getContractFactory("AegisVaultFactory");
  const factoryV2 = await Factory.deploy(implV2Addr, registryV2Addr, treasury);
  await factoryV2.waitForDeployment();
  const factoryV2Addr = await factoryV2.getAddress();
  console.log("    AegisVaultFactory v2:", factoryV2Addr);

  // Sanity: factory actually points at v2 impl
  const implCheck = await factoryV2.vaultImplementation();
  if (implCheck.toLowerCase() !== implV2Addr.toLowerCase()) {
    throw new Error(`Factory impl mismatch: ${implCheck} != ${implV2Addr}`);
  }

  // Transfer registry admin to factory v2 (factory can now authorize vaults)
  console.log("    Transferring registryV2 admin → factoryV2…");
  await (await registryV2.transferAdmin(factoryV2Addr)).wait();
  const newAdmin = await registryV2.admin();
  if (newAdmin.toLowerCase() !== factoryV2Addr.toLowerCase()) {
    throw new Error(`Registry admin transfer failed: ${newAdmin}`);
  }
  console.log("    Registry admin → factoryV2 ✓");

  // ── 5. InsurancePool_v2 ──
  console.log("\n5/7 InsurancePool_v2");
  const PoolV2 = await ethers.getContractFactory("InsurancePool_v2");
  const poolV2 = await PoolV2.deploy(usdc, arbitrator);
  await poolV2.waitForDeployment();
  const poolV2Addr = await poolV2.getAddress();
  console.log("    InsurancePool_v2   :", poolV2Addr);

  // ── 6. OperatorStaking_v2 ──
  console.log("\n6/7 OperatorStaking_v2");
  const StakingV2 = await ethers.getContractFactory("OperatorStaking_v2");
  const stakingV2 = await StakingV2.deploy(usdc, operatorRegistry, poolV2Addr, arbitrator);
  await stakingV2.waitForDeployment();
  const stakingV2Addr = await stakingV2.getAddress();
  console.log("    OperatorStaking_v2 :", stakingV2Addr);

  // ── 7. Authorize staking as slash notifier on pool ──
  console.log("\n7/7 Authorizing stakingV2 as slash notifier on poolV2");
  await (await poolV2.setNotifier(stakingV2Addr, true)).wait();
  console.log("    Notifier authorized ✓");

  // ── Persist ──
  // Use v2-prefixed keys so v1 addresses remain untouched.
  const patch = {
    // Libraries — canonical keys match existing naming so future phases can reuse
    execLibrary:   execLibAddr,
    sealedLibrary: sealedLibAddr,
    ioLibrary:     ioLibAddr,
    // v2 stack
    aegisVaultImplementationV2: implV2Addr,
    executionRegistryV2:        registryV2Addr,
    aegisVaultFactoryV2:        factoryV2Addr,
    insurancePoolV2:            poolV2Addr,
    operatorStakingV2:          stakingV2Addr,
    v2DeployedAt:               new Date().toISOString(),
    v2Deployer:                 deployer.address,
  };
  const merged = { ...deployments, ...patch };
  fs.writeFileSync(deployFile, JSON.stringify(merged, null, 2));
  console.log("\nDeployments written:", deployFile);

  console.log("\n" + "═".repeat(60));
  console.log("AegisVault v2 deploy complete");
  console.log("═".repeat(60));
  console.log("aegisVaultImplementationV2:", implV2Addr);
  console.log("executionRegistryV2:       ", registryV2Addr);
  console.log("aegisVaultFactoryV2:       ", factoryV2Addr);
  console.log("insurancePoolV2:           ", poolV2Addr);
  console.log("operatorStakingV2:         ", stakingV2Addr);
  console.log("\nNext steps:");
  console.log("  1. Run: node scripts/sync-frontend.js");
  console.log("  2. Frontend: cutover /create to use aegisVaultFactoryV2");
  console.log("  3. Rotate arbitrator to multi-sig (stakingV2.setArbitrator / poolV2.setArbitrator)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Deploy failed:", err);
    process.exit(1);
  });
