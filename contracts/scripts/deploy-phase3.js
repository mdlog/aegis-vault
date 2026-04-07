/**
 * Deploy Phase 3: OperatorReputation
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-phase3.js --network og_testnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Aegis Vault Phase 3 (Reputation & Discovery)");
  console.log("  Deployer:", deployer.address);
  const network = await ethers.provider.getNetwork();
  console.log("  Network:", network.name, "(chainId:", network.chainId, ")");

  const deploymentsPath = path.resolve(__dirname, "../deployments.json");
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error("deployments.json not found — run deploy-phase1.js first");
  }
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  // Admin = deployer (transfer to multi-sig later)
  const admin = deployer.address;

  console.log("\n1/1 Deploying OperatorReputation...");
  const Reputation = await ethers.getContractFactory("OperatorReputation");
  const reputation = await Reputation.deploy(admin);
  await reputation.waitForDeployment();
  deployments.operatorReputation = await reputation.getAddress();
  console.log("    OperatorReputation:", deployments.operatorReputation);

  // Authorize the factory as a recorder so vaults can write stats
  if (deployments.aegisVaultFactory) {
    console.log("\n  Authorizing factory as recorder...");
    await (await reputation.setRecorder(deployments.aegisVaultFactory, true)).wait();
    console.log("  Factory authorized ✓");
  }

  deployments.timestamp = new Date().toISOString();
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("\nDeployments saved:", deploymentsPath);

  console.log("\n══════════════════════════════════════════════");
  console.log("Phase 3 Deployment Complete");
  console.log("══════════════════════════════════════════════");
  console.log("OperatorReputation:", deployments.operatorReputation);
  console.log("\nNext steps:");
  console.log("  1. Run: node scripts/sync-frontend.js");
  console.log("  2. Authorize individual vaults via reputation.setRecorder(vault, true)");
  console.log("  3. Grant verified badges to trusted operators via reputation.setVerified()");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Deployment failed:", err);
    process.exit(1);
  });
