/**
 * Deploy Aegis Vault — VERIFICATION LAYER on 0G Aristotle Mainnet (chain 16661)
 *
 * This is the cross-chain hybrid architecture:
 *   - Verification layer (this script) → 0G mainnet
 *     • OperatorRegistry, OperatorReputation
 *     • OperatorStaking, InsurancePool
 *     • ProtocolTreasury, AegisGovernor
 *
 *   - Execution layer (deploy-arbitrum-execution.js) → Arbitrum One mainnet
 *     • ExecutionRegistry, AegisVaultFactory
 *     • UniswapV3VenueAdapter, VaultNAVCalculator
 *     • Per-user AegisVault clones
 *
 * Why split? 0G mainnet has Pyth + a Uniswap V3 fork (Jaine), but no mature
 * stablecoin/DeFi liquidity yet. Arbitrum has billions in USDC liquidity and
 * deep pools on Uniswap V3. The verification layer (operator identity, staking,
 * reputation, governance) lives on 0G — that's the part hackathon judges need
 * to see. Execution happens where the real users and liquidity live.
 *
 * Required env:
 *   DEPLOYER_PRIVATE_KEY    — funded 0G mainnet wallet (>= 0.5 0G)
 *   GOVERNOR_OWNERS         — comma-separated owners (default: deployer)
 *   GOVERNOR_THRESHOLD      — M-of-N threshold (default: 1)
 *   ARBITRATOR_ADDRESS      — initial slashing arbitrator (default: deployer)
 *   STAKE_TOKEN_ADDRESS     — token used for operator staking
 *                              (default: oUSDT 0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189)
 *
 * Optional:
 *   TRANSFER_ADMINS=1   rotate admin roles to governor at end (recommended)
 *   CONFIRM_MAINNET=1   skip the safety guard
 *
 * Usage:
 *   GOVERNOR_OWNERS="0xaaa,0xbbb,0xccc" GOVERNOR_THRESHOLD=2 \
 *   ARBITRATOR_ADDRESS=0xddd TRANSFER_ADMINS=1 CONFIRM_MAINNET=1 \
 *   npx hardhat run scripts/deploy-0g-verification.js --network og_mainnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Real on-chain stake token: oUSDT bridged via Hyperlane (verified on-chain)
const oUSDT_ADDRESS = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189";
const EXPECTED_CHAIN_ID = 16661;

function isValidAddress(addr) {
  try {
    ethers.getAddress(addr);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Pre-flight: env validation
  const ownersStr = process.env.GOVERNOR_OWNERS || "";
  const arbitratorAddress = process.env.ARBITRATOR_ADDRESS || "";
  const stakeTokenAddress = process.env.STAKE_TOKEN_ADDRESS || oUSDT_ADDRESS;
  const threshold = Number(process.env.GOVERNOR_THRESHOLD || 0);

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  // Default owners to deployer if not specified
  const owners = ownersStr
    ? ownersStr.split(",").map(a => a.trim()).filter(Boolean)
    : [deployer.address];
  const finalThreshold = threshold || 1;
  const finalArbitrator = arbitratorAddress || deployer.address;

  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║   AEGIS VAULT — 0G VERIFICATION LAYER DEPLOYMENT     ║");
  console.log("║   Chain: 0G Aristotle Mainnet (16661)                ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");
  console.log("Deployer:    ", deployer.address);
  console.log("Balance:     ", ethers.formatEther(balance), "0G");
  console.log("Network:     ", network.name, "(chainId:", network.chainId.toString(), ")");
  console.log("Stake token: ", stakeTokenAddress, "(oUSDT)");
  console.log("Governor:    ", finalThreshold, "of", owners.length);
  owners.forEach((o, i) => console.log("  Owner #" + (i + 1) + ":", o));
  console.log("Arbitrator:  ", finalArbitrator);
  console.log("Transfer admins → governor:", process.env.TRANSFER_ADMINS === "1" ? "YES" : "NO");
  console.log();

  // Pre-flight checks
  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong network: expected chain ${EXPECTED_CHAIN_ID} (0G Aristotle), got ${network.chainId}. Run with --network og_mainnet`);
  }

  for (const o of owners) {
    if (!isValidAddress(o)) throw new Error("Invalid governor owner: " + o);
  }
  if (!isValidAddress(finalArbitrator)) throw new Error("Invalid arbitrator: " + finalArbitrator);
  if (!isValidAddress(stakeTokenAddress)) throw new Error("Invalid stake token: " + stakeTokenAddress);

  if (finalThreshold < 1 || finalThreshold > owners.length) {
    throw new Error("GOVERNOR_THRESHOLD must be 1.." + owners.length);
  }

  if (balance < ethers.parseEther("0.1")) {
    throw new Error("Insufficient balance: have " + ethers.formatEther(balance) + " 0G, need >= 0.1 0G");
  }

  if (process.env.CONFIRM_MAINNET !== "1") {
    throw new Error("Refusing to deploy without CONFIRM_MAINNET=1 — re-run with that flag.");
  }

  console.log("✓ Pre-flight passed. Beginning deployment.\n");

  const deployments = {
    network: "og_mainnet",
    chainId: EXPECTED_CHAIN_ID,
    layer: "verification",
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    stakeToken: stakeTokenAddress,
  };

  // ─── Phase 1.1: ProtocolTreasury ───
  console.log("[1/6] ProtocolTreasury...");
  const Treasury = await ethers.getContractFactory("ProtocolTreasury");
  const treasury = await Treasury.deploy(deployer.address);
  await treasury.waitForDeployment();
  deployments.protocolTreasury = await treasury.getAddress();
  console.log("      →", deployments.protocolTreasury);

  // ─── Phase 1.2: OperatorRegistry ───
  console.log("[2/6] OperatorRegistry...");
  const OpReg = await ethers.getContractFactory("OperatorRegistry");
  const opRegistry = await OpReg.deploy();
  await opRegistry.waitForDeployment();
  deployments.operatorRegistry = await opRegistry.getAddress();
  console.log("      →", deployments.operatorRegistry);

  // ─── Phase 2.1: InsurancePool ───
  console.log("[3/6] InsurancePool (oUSDT)...");
  const Insurance = await ethers.getContractFactory("InsurancePool");
  const insurance = await Insurance.deploy(stakeTokenAddress, finalArbitrator);
  await insurance.waitForDeployment();
  deployments.insurancePool = await insurance.getAddress();
  console.log("      →", deployments.insurancePool);

  // ─── Phase 2.2: OperatorStaking ───
  console.log("[4/6] OperatorStaking (oUSDT)...");
  const Staking = await ethers.getContractFactory("OperatorStaking");
  const staking = await Staking.deploy(
    stakeTokenAddress,
    deployments.operatorRegistry,
    deployments.insurancePool,
    finalArbitrator
  );
  await staking.waitForDeployment();
  deployments.operatorStaking = await staking.getAddress();
  console.log("      →", deployments.operatorStaking);

  // Wire staking as authorized notifier on insurance (only if deployer is currently arbitrator)
  if (finalArbitrator === deployer.address) {
    console.log("      Authorizing staking as slash notifier...");
    await (await insurance.setNotifier(deployments.operatorStaking, true)).wait();
    console.log("      ✓");
  } else {
    console.log("      ⚠ arbitrator != deployer. Submit via governance: insurance.setNotifier(", deployments.operatorStaking, ", true)");
  }

  // ─── Phase 3: OperatorReputation ───
  console.log("[5/6] OperatorReputation...");
  const Reputation = await ethers.getContractFactory("OperatorReputation");
  const reputation = await Reputation.deploy(deployer.address);
  await reputation.waitForDeployment();
  deployments.operatorReputation = await reputation.getAddress();
  console.log("      →", deployments.operatorReputation);

  // NOTE: We don't authorize a factory recorder here because the factory lives
  // on Arbitrum, not 0G. Reputation recording from Arbitrum vaults will be
  // mediated by the orchestrator via a separate cross-chain attestation flow,
  // OR by manually authorizing each vault's owner wallet to call recordExecution
  // through governance proposals. For the hackathon demo, we'll authorize the
  // deployer wallet so demo transactions work.
  console.log("      Authorizing deployer as recorder (demo only)...");
  await (await reputation.setRecorder(deployer.address, true)).wait();
  console.log("      ✓ (production: replace with cross-chain bridge or governance-managed list)");

  // ─── Phase 4: AegisGovernor ───
  console.log("[6/6] AegisGovernor...");
  const Governor = await ethers.getContractFactory("AegisGovernor");
  const governor = await Governor.deploy(owners, finalThreshold);
  await governor.waitForDeployment();
  deployments.aegisGovernor = await governor.getAddress();
  console.log("      →", deployments.aegisGovernor);

  // ─── Optional: rotate admin roles ───
  if (process.env.TRANSFER_ADMINS === "1") {
    console.log("\n── Rotating admin roles to governor ──");

    if (finalArbitrator === deployer.address) {
      console.log("  Staking arbitrator → governor...");
      await (await staking.setArbitrator(deployments.aegisGovernor)).wait();
      console.log("  ✓");

      console.log("  Insurance arbitrator → governor...");
      await (await insurance.setArbitrator(deployments.aegisGovernor)).wait();
      console.log("  ✓");
    }

    console.log("  Reputation admin → governor...");
    await (await reputation.transferAdmin(deployments.aegisGovernor)).wait();
    console.log("  ✓");

    console.log("  Treasury admin → governor...");
    await (await treasury.transferAdmin(deployments.aegisGovernor)).wait();
    console.log("  ✓");
  } else {
    console.log("\n⚠  TRANSFER_ADMINS != 1 — admin roles still held by deployer.");
  }

  // ─── Persist ───
  deployments.governorOwners = owners;
  deployments.governorThreshold = finalThreshold;
  deployments.timestamp = new Date().toISOString();

  const outPath = path.resolve(__dirname, "../deployments-0g-mainnet.json");
  fs.writeFileSync(outPath, JSON.stringify(deployments, null, 2));
  console.log("\nDeployments saved:", outPath);

  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║   0G VERIFICATION LAYER COMPLETE                     ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");
  Object.entries(deployments).forEach(([k, v]) => {
    if (typeof v === "string" && v.startsWith("0x")) {
      console.log("  " + k.padEnd(22) + " " + v);
    }
  });
  console.log("\nExplorer: https://chainscan.0g.ai");
  console.log("\nNext step: Deploy execution layer to Arbitrum");
  console.log("  npx hardhat run scripts/deploy-arbitrum-execution.js --network arbitrum");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Deployment failed:", err.message);
    process.exit(1);
  });
