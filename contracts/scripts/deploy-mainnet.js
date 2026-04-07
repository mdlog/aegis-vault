/**
 * Aegis Vault — 0G Mainnet (Aristotle, chain 16661) deployment.
 *
 * Production-grade Phase 1-5 stack with Jaine DEX as the real venue. NO mocks,
 * NO demo vault, NO MockDEX. Uses real on-chain tokens (oUSDT, W0G).
 *
 * Required environment variables:
 *   GOVERNOR_OWNERS     comma-separated owner addresses (min 3 recommended)
 *   GOVERNOR_THRESHOLD  M-of-N threshold (e.g. 2 for 2-of-3)
 *   ARBITRATOR_ADDRESS  initial slashing arbitrator (must equal governor on prod)
 *   DEPLOYER_PRIVATE_KEY
 *
 * Optional:
 *   TRANSFER_ADMINS=1   rotate admin roles to governor at end (recommended)
 *   CONFIRM_MAINNET=1   skip the interactive confirmation guard
 *
 * Usage:
 *   GOVERNOR_OWNERS="0xaaa,0xbbb,0xccc" GOVERNOR_THRESHOLD=2 \
 *   ARBITRATOR_ADDRESS=0xddd TRANSFER_ADMINS=1 CONFIRM_MAINNET=1 \
 *   npx hardhat run scripts/deploy-mainnet.js --network og_mainnet
 *
 * Jaine Mainnet:
 *   SwapRouter: 0x8b598a7c136215a95ba0282b4d832b9f9801f2e2
 *   Factory:    0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4
 *   W0G:        0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c
 *
 * Real tokens:
 *   oUSDT:      0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189 (Hyperlane bridged, 6dec)
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ── Jaine + real token addresses on 0G mainnet ──
const JAINE_ROUTER  = "0x8b598a7c136215a95ba0282b4d832b9f9801f2e2";
const JAINE_FACTORY = "0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4";
const W0G_ADDRESS   = "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c";
const oUSDT_ADDRESS = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189";

// Hard-coded mainnet chain id
const EXPECTED_CHAIN_ID = 16661;

function isValidAddress(addr) {
  try {
    return ethers.getAddress(addr) === addr || ethers.getAddress(addr).toLowerCase() === addr.toLowerCase();
  } catch {
    return false;
  }
}

async function main() {
  // ── Pre-flight: validate environment ──
  const ownersStr = process.env.GOVERNOR_OWNERS || "";
  const owners = ownersStr.split(",").map((a) => a.trim()).filter(Boolean);
  const threshold = Number(process.env.GOVERNOR_THRESHOLD || 0);
  const arbitratorAddress = process.env.ARBITRATOR_ADDRESS || "";

  if (owners.length < 1) {
    throw new Error("GOVERNOR_OWNERS env required (comma-separated). Recommend ≥ 3.");
  }
  if (owners.length < 3) {
    console.warn(`⚠  Only ${owners.length} governor owner(s). Recommend ≥ 3 for mainnet.`);
  }
  for (const o of owners) {
    if (!isValidAddress(o)) throw new Error(`Invalid GOVERNOR_OWNERS entry: ${o}`);
  }
  if (threshold < 1 || threshold > owners.length) {
    throw new Error(`GOVERNOR_THRESHOLD must be 1..${owners.length}, got ${threshold}`);
  }
  if (!arbitratorAddress || !isValidAddress(arbitratorAddress)) {
    throw new Error("ARBITRATOR_ADDRESS env required (must be a valid address — typically the governor).");
  }

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("╔════════════════════════════════════════════════╗");
  console.log("║   AEGIS VAULT — 0G MAINNET DEPLOYMENT          ║");
  console.log("║   Phase 1-5 Production Stack                   ║");
  console.log("╚════════════════════════════════════════════════╝\n");
  console.log("Deployer:    ", deployer.address);
  console.log("Balance:     ", ethers.formatEther(balance), "0G");
  console.log("Network:     ", network.name, "(chainId:", network.chainId, ")");
  console.log("Governor:    ", `${threshold}-of-${owners.length} multi-sig`);
  owners.forEach((o, i) => console.log(`  Owner #${i + 1}:`, o));
  console.log("Arbitrator:  ", arbitratorAddress);
  console.log("Transfer admins → governor:", process.env.TRANSFER_ADMINS === "1" ? "YES" : "NO");
  console.log("");

  // ── Pre-flight: chain id guard ──
  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Wrong network: expected chain ${EXPECTED_CHAIN_ID} (0G Aristotle mainnet), got ${network.chainId}. ` +
      `Run with --network og_mainnet.`
    );
  }

  // ── Pre-flight: balance guard ──
  if (balance < ethers.parseEther("0.1")) {
    throw new Error(`Insufficient balance: have ${ethers.formatEther(balance)} 0G, need ≥ 0.1 0G for full Phase 1-5 deploy.`);
  }

  // ── Pre-flight: explicit confirmation ──
  if (process.env.CONFIRM_MAINNET !== "1") {
    throw new Error(
      "Refusing to deploy to mainnet without CONFIRM_MAINNET=1. Re-run with CONFIRM_MAINNET=1 to proceed."
    );
  }

  console.log("✓ All pre-flight checks passed. Beginning deployment.\n");

  const deployments = {
    network: "og_mainnet",
    chainId: EXPECTED_CHAIN_ID,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };

  // ═══════════════════════════════════════════════
  // PHASE 1: Foundation
  // ═══════════════════════════════════════════════
  console.log("── Phase 1: Foundation ──");

  console.log("  [1/9] Deploying ProtocolTreasury...");
  const Treasury = await ethers.getContractFactory("ProtocolTreasury");
  const treasury = await Treasury.deploy(deployer.address);
  await treasury.waitForDeployment();
  deployments.protocolTreasury = await treasury.getAddress();
  console.log("        →", deployments.protocolTreasury);

  console.log("  [2/9] Deploying ExecutionRegistry...");
  const ExecReg = await ethers.getContractFactory("ExecutionRegistry");
  const execRegistry = await ExecReg.deploy();
  await execRegistry.waitForDeployment();
  deployments.executionRegistry = await execRegistry.getAddress();
  console.log("        →", deployments.executionRegistry);

  console.log("  [3/9] Deploying AegisVaultFactory...");
  const Factory = await ethers.getContractFactory("AegisVaultFactory");
  const factory = await Factory.deploy(deployments.executionRegistry, deployments.protocolTreasury);
  await factory.waitForDeployment();
  deployments.aegisVaultFactory = await factory.getAddress();
  console.log("        →", deployments.aegisVaultFactory);
  console.log("        Transferring registry admin to factory...");
  await (await execRegistry.transferAdmin(deployments.aegisVaultFactory)).wait();
  console.log("        ✓");

  console.log("  [4/9] Deploying OperatorRegistry...");
  const OpReg = await ethers.getContractFactory("OperatorRegistry");
  const opRegistry = await OpReg.deploy();
  await opRegistry.waitForDeployment();
  deployments.operatorRegistry = await opRegistry.getAddress();
  console.log("        →", deployments.operatorRegistry);

  // ═══════════════════════════════════════════════
  // Real venue
  // ═══════════════════════════════════════════════
  console.log("\n── Real Venue (Jaine DEX) ──");
  console.log("  [5/9] Deploying JaineVenueAdapter...");
  const Adapter = await ethers.getContractFactory("JaineVenueAdapter");
  const adapter = await Adapter.deploy(JAINE_ROUTER, JAINE_FACTORY);
  await adapter.waitForDeployment();
  deployments.jaineVenueAdapter = await adapter.getAddress();
  console.log("        →", deployments.jaineVenueAdapter);

  // ═══════════════════════════════════════════════
  // PHASE 2: Stake & Slashing
  // ═══════════════════════════════════════════════
  console.log("\n── Phase 2: Stake & Slashing ──");

  // Use oUSDT as the canonical stake token on mainnet
  console.log("  [6/9] Deploying InsurancePool (stake token = oUSDT)...");
  const Insurance = await ethers.getContractFactory("InsurancePool");
  const insurance = await Insurance.deploy(oUSDT_ADDRESS, arbitratorAddress);
  await insurance.waitForDeployment();
  deployments.insurancePool = await insurance.getAddress();
  console.log("        →", deployments.insurancePool);

  console.log("  [7/9] Deploying OperatorStaking...");
  const Staking = await ethers.getContractFactory("OperatorStaking");
  const staking = await Staking.deploy(
    oUSDT_ADDRESS,
    deployments.operatorRegistry,
    deployments.insurancePool,
    arbitratorAddress
  );
  await staking.waitForDeployment();
  deployments.operatorStaking = await staking.getAddress();
  console.log("        →", deployments.operatorStaking);

  // Authorize staking as a slash notifier on insurance pool
  console.log("        Authorizing staking as slash notifier on insurance...");
  // arbitrator may differ from deployer; if so, this call will fail and we instruct the user
  try {
    await (await insurance.setNotifier(deployments.operatorStaking, true)).wait();
    console.log("        ✓");
  } catch (e) {
    console.log("        ⚠  setNotifier failed:", e.message);
    console.log("        → Submit via governance: insurance.setNotifier(", deployments.operatorStaking, ", true)");
  }

  // ═══════════════════════════════════════════════
  // PHASE 3: Reputation & Discovery
  // ═══════════════════════════════════════════════
  console.log("\n── Phase 3: Reputation & Discovery ──");

  console.log("  [8/9] Deploying OperatorReputation...");
  const Reputation = await ethers.getContractFactory("OperatorReputation");
  const reputation = await Reputation.deploy(deployer.address);
  await reputation.waitForDeployment();
  deployments.operatorReputation = await reputation.getAddress();
  console.log("        →", deployments.operatorReputation);

  console.log("        Authorizing factory as reputation recorder...");
  await (await reputation.setRecorder(deployments.aegisVaultFactory, true)).wait();
  console.log("        ✓");

  // ═══════════════════════════════════════════════
  // PHASE 4: Governance
  // ═══════════════════════════════════════════════
  console.log("\n── Phase 4: Governance ──");

  console.log("  [9/9] Deploying AegisGovernor...");
  const Governor = await ethers.getContractFactory("AegisGovernor");
  const governor = await Governor.deploy(owners, threshold);
  await governor.waitForDeployment();
  deployments.aegisGovernor = await governor.getAddress();
  console.log("        →", deployments.aegisGovernor);
  console.log("        Threshold:", threshold, "of", owners.length);

  // ═══════════════════════════════════════════════
  // Optional: rotate admin roles to governor
  // ═══════════════════════════════════════════════
  if (process.env.TRANSFER_ADMINS === "1") {
    console.log("\n── Rotating admin roles to governor ──");

    console.log("  Staking arbitrator → governor...");
    try {
      await (await staking.setArbitrator(deployments.aegisGovernor)).wait();
      console.log("  ✓");
    } catch (e) {
      console.log("  ⚠ ", e.message, "(may already be governor)");
    }

    console.log("  Insurance arbitrator → governor...");
    try {
      await (await insurance.setArbitrator(deployments.aegisGovernor)).wait();
      console.log("  ✓");
    } catch (e) {
      console.log("  ⚠ ", e.message, "(may already be governor)");
    }

    console.log("  Reputation admin → governor...");
    await (await reputation.transferAdmin(deployments.aegisGovernor)).wait();
    console.log("  ✓");

    console.log("  Treasury admin → governor...");
    await (await treasury.transferAdmin(deployments.aegisGovernor)).wait();
    console.log("  ✓");
  } else {
    console.log("\n⚠  TRANSFER_ADMINS != 1 — admin roles still held by deployer.");
    console.log("   Run with TRANSFER_ADMINS=1 (or rotate manually) before going live.");
  }

  // ═══════════════════════════════════════════════
  // Persist deployments
  // ═══════════════════════════════════════════════

  // Static metadata
  deployments.jaine = {
    router: JAINE_ROUTER,
    factory: JAINE_FACTORY,
    w0g: W0G_ADDRESS,
  };
  deployments.realTokens = {
    oUSDT: oUSDT_ADDRESS,
    W0G: W0G_ADDRESS,
  };
  deployments.governorOwners = owners;
  deployments.governorThreshold = threshold;
  deployments.timestamp = new Date().toISOString();

  // Write to deployments-mainnet.json AND deployments.json so sync-frontend works
  const mainnetPath = path.resolve(__dirname, "../deployments-mainnet.json");
  const sharedPath = path.resolve(__dirname, "../deployments.json");
  fs.writeFileSync(mainnetPath, JSON.stringify(deployments, null, 2));
  fs.writeFileSync(sharedPath, JSON.stringify(deployments, null, 2));
  console.log("\nDeployments saved:");
  console.log("  ", mainnetPath);
  console.log("  ", sharedPath);

  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║   DEPLOYMENT COMPLETE                          ║");
  console.log("╚════════════════════════════════════════════════╝\n");
  console.log("Smart contract addresses (chain 16661):\n");
  Object.entries(deployments).forEach(([k, v]) => {
    if (typeof v === "string" && v.startsWith("0x")) {
      console.log(`  ${k.padEnd(22)} ${v}`);
    }
  });
  console.log("\nNext steps:");
  console.log("  1. node scripts/sync-frontend.js");
  console.log("  2. Configure orchestrator .env with mainnet addresses");
  console.log("  3. Operators: register at /operator/register, stake oUSDT");
  console.log("  4. Users: create vaults at /create with venue =", deployments.jaineVenueAdapter);
  console.log("  5. Audit explorer:", "https://chainscan.0g.ai");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Deployment failed:", err.message);
    process.exit(1);
  });
