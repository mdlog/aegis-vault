/**
 * Deploy Phase 1 contracts: ProtocolTreasury + ExecutionRegistry + Factory + OperatorRegistry
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-phase1.js --network og_testnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Aegis Vault Phase 1 (Production Economics)");
  console.log("  Deployer:", deployer.address);
  const network = await ethers.provider.getNetwork();
  console.log("  Network:", network.name, "(chainId:", network.chainId, ")");

  const deployments = {};

  // 1. ProtocolTreasury (admin = deployer initially; transfer to multi-sig later)
  console.log("\n1/4 Deploying ProtocolTreasury...");
  const Treasury = await ethers.getContractFactory("ProtocolTreasury");
  const treasury = await Treasury.deploy(deployer.address);
  await treasury.waitForDeployment();
  deployments.protocolTreasury = await treasury.getAddress();
  console.log("    ProtocolTreasury:", deployments.protocolTreasury);

  // 2. ExecutionRegistry
  console.log("\n2/4 Deploying ExecutionRegistry...");
  const Registry = await ethers.getContractFactory("ExecutionRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  deployments.executionRegistry = await registry.getAddress();
  console.log("    ExecutionRegistry:", deployments.executionRegistry);

  // 3. AegisVaultFactory (with treasury)
  console.log("\n3/4 Deploying AegisVaultFactory...");
  const Factory = await ethers.getContractFactory("AegisVaultFactory");
  const factory = await Factory.deploy(
    deployments.executionRegistry,
    deployments.protocolTreasury
  );
  await factory.waitForDeployment();
  deployments.aegisVaultFactory = await factory.getAddress();
  console.log("    AegisVaultFactory:", deployments.aegisVaultFactory);

  // Transfer registry admin to factory
  console.log("    Transferring registry admin to factory...");
  await (await registry.transferAdmin(deployments.aegisVaultFactory)).wait();
  console.log("    Registry admin transferred ✓");

  // 4. OperatorRegistry
  console.log("\n4/4 Deploying OperatorRegistry...");
  const OpRegistry = await ethers.getContractFactory("OperatorRegistry");
  const opRegistry = await OpRegistry.deploy();
  await opRegistry.waitForDeployment();
  deployments.operatorRegistry = await opRegistry.getAddress();
  console.log("    OperatorRegistry:", deployments.operatorRegistry);

  // Save deployments.json
  deployments.network = network.name;
  deployments.chainId = Number(network.chainId);
  deployments.deployer = deployer.address;
  deployments.timestamp = new Date().toISOString();

  // Merge with existing deployments if file exists
  const deploymentsPath = path.resolve(__dirname, "../deployments.json");
  let merged = {};
  if (fs.existsSync(deploymentsPath)) {
    merged = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }
  Object.assign(merged, deployments);
  fs.writeFileSync(deploymentsPath, JSON.stringify(merged, null, 2));
  console.log("\nDeployments saved:", deploymentsPath);

  console.log("\n══════════════════════════════════════════════");
  console.log("Phase 1 Deployment Complete");
  console.log("══════════════════════════════════════════════");
  console.log("ProtocolTreasury:  ", deployments.protocolTreasury);
  console.log("ExecutionRegistry: ", deployments.executionRegistry);
  console.log("AegisVaultFactory: ", deployments.aegisVaultFactory);
  console.log("OperatorRegistry:  ", deployments.operatorRegistry);
  console.log("\nNext steps:");
  console.log("  1. Run: node scripts/sync-frontend.js");
  console.log("  2. Deploy mock tokens + DEX (npx hardhat run scripts/deploy.js)");
  console.log("  3. Operators register at /operator/register");
  console.log("  4. Users create vaults at /create");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Deployment failed:", err);
    process.exit(1);
  });
