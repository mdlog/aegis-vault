/**
 * Deploy Phase 2 contracts: InsurancePool + OperatorStaking
 *
 * Requires Phase 1 to be deployed (needs OperatorRegistry + USDC).
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-phase2.js --network og_testnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Aegis Vault Phase 2 (Stake & Slashing)");
  console.log("  Deployer:", deployer.address);
  const network = await ethers.provider.getNetwork();
  console.log("  Network:", network.name, "(chainId:", network.chainId, ")");

  // Load existing deployments
  const deploymentsPath = path.resolve(__dirname, "../deployments.json");
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error("deployments.json not found — run deploy-phase1.js first");
  }
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  if (!deployments.operatorRegistry) {
    throw new Error("operatorRegistry missing — run deploy-phase1.js first");
  }
  if (!deployments.mockUSDC) {
    throw new Error("mockUSDC missing — run deploy.js (mocks) first");
  }

  // Arbitrator defaults to deployer; transfer to multi-sig later
  const arbitrator = deployer.address;
  console.log("  Arbitrator (initial):", arbitrator);

  // 1. InsurancePool
  console.log("\n1/2 Deploying InsurancePool...");
  const Insurance = await ethers.getContractFactory("InsurancePool");
  const insurance = await Insurance.deploy(deployments.mockUSDC, arbitrator);
  await insurance.waitForDeployment();
  deployments.insurancePool = await insurance.getAddress();
  console.log("    InsurancePool:", deployments.insurancePool);

  // 2. OperatorStaking
  console.log("\n2/2 Deploying OperatorStaking...");
  const Staking = await ethers.getContractFactory("OperatorStaking");
  const staking = await Staking.deploy(
    deployments.mockUSDC,
    deployments.operatorRegistry,
    deployments.insurancePool,
    arbitrator
  );
  await staking.waitForDeployment();
  deployments.operatorStaking = await staking.getAddress();
  console.log("    OperatorStaking:", deployments.operatorStaking);

  // Authorize staking as the slash notifier on insurance pool
  console.log("    Authorizing staking as slash notifier on insurance pool...");
  await (await insurance.setNotifier(deployments.operatorStaking, true)).wait();
  console.log("    Notifier authorized ✓");

  // Save merged deployments
  deployments.timestamp = new Date().toISOString();
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("\nDeployments saved:", deploymentsPath);

  console.log("\n══════════════════════════════════════════════");
  console.log("Phase 2 Deployment Complete");
  console.log("══════════════════════════════════════════════");
  console.log("InsurancePool:    ", deployments.insurancePool);
  console.log("OperatorStaking:  ", deployments.operatorStaking);
  console.log("\nNext steps:");
  console.log("  1. Run: node scripts/sync-frontend.js");
  console.log("  2. Operators stake at /operator/profile");
  console.log("  3. Transfer arbitrator role to multi-sig (Phase 4)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Deployment failed:", err);
    process.exit(1);
  });
