/**
 * Standalone deploy script for OperatorRegistry.
 * Run AFTER the main deploy.js since this contract is independent of the vault system.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-operator-registry.js --network og_testnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying OperatorRegistry...");
  console.log("  Deployer:", deployer.address);
  console.log("  Network:", (await ethers.provider.getNetwork()).name);

  const Registry = await ethers.getContractFactory("OperatorRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const address = await registry.getAddress();

  console.log("");
  console.log("✓ OperatorRegistry deployed:", address);
  console.log("");

  // Update deployments.json
  const deploymentsPath = path.resolve(__dirname, "../deployments.json");
  let deployments = {};
  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }
  deployments.operatorRegistry = address;
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("Updated:", deploymentsPath);

  console.log("");
  console.log("Next steps:");
  console.log("  1. node scripts/sync-frontend.js");
  console.log("  2. Frontend will automatically use the new registry address");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Deployment failed:", err);
    process.exit(1);
  });
