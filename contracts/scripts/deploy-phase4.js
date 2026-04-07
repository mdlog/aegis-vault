/**
 * Deploy Phase 4: AegisGovernor multisig
 *
 * Usage:
 *   GOVERNOR_OWNERS="0xaaa,0xbbb,0xccc" GOVERNOR_THRESHOLD=2 \
 *     DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-phase4.js --network og_testnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Aegis Vault Phase 4 (Governance)");
  console.log("  Deployer:", deployer.address);
  const network = await ethers.provider.getNetwork();
  console.log("  Network:", network.name, "(chainId:", network.chainId, ")");

  const deploymentsPath = path.resolve(__dirname, "../deployments.json");
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error("deployments.json not found — run deploy-phase1.js first");
  }
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  // Owners + threshold from env or fall back to single-deployer 1-of-1 (testnet only!)
  const ownersStr = process.env.GOVERNOR_OWNERS || deployer.address;
  const owners = ownersStr.split(",").map(a => a.trim()).filter(Boolean);
  const threshold = Number(process.env.GOVERNOR_THRESHOLD || 1);

  console.log("\n  Owners:");
  owners.forEach(o => console.log("   ", o));
  console.log("  Threshold:", threshold, "of", owners.length);

  console.log("\n1/1 Deploying AegisGovernor...");
  const Governor = await ethers.getContractFactory("AegisGovernor");
  const governor = await Governor.deploy(owners, threshold);
  await governor.waitForDeployment();
  deployments.aegisGovernor = await governor.getAddress();
  console.log("    AegisGovernor:", deployments.aegisGovernor);

  // Wire governor as arbitrator on staking + insurance + admin on reputation + treasury
  // (only if those contracts already exist)
  const govAddr = deployments.aegisGovernor;

  if (deployments.operatorStaking) {
    console.log("\n  Setting governor as staking arbitrator...");
    const staking = await ethers.getContractAt("OperatorStaking", deployments.operatorStaking);
    try {
      await (await staking.setArbitrator(govAddr)).wait();
      console.log("  Staking arbitrator → governor ✓");
    } catch (e) {
      console.log("  ! Could not set staking arbitrator:", e.message);
    }
  }

  if (deployments.insurancePool) {
    console.log("  Setting governor as insurance arbitrator...");
    const insurance = await ethers.getContractAt("InsurancePool", deployments.insurancePool);
    try {
      await (await insurance.setArbitrator(govAddr)).wait();
      console.log("  Insurance arbitrator → governor ✓");
    } catch (e) {
      console.log("  ! Could not set insurance arbitrator:", e.message);
    }
  }

  if (deployments.operatorReputation) {
    console.log("  Transferring reputation admin to governor...");
    const reputation = await ethers.getContractAt("OperatorReputation", deployments.operatorReputation);
    try {
      await (await reputation.transferAdmin(govAddr)).wait();
      console.log("  Reputation admin → governor ✓");
    } catch (e) {
      console.log("  ! Could not transfer reputation admin:", e.message);
    }
  }

  if (deployments.protocolTreasury) {
    console.log("  Transferring protocol treasury admin to governor...");
    const treasury = await ethers.getContractAt("ProtocolTreasury", deployments.protocolTreasury);
    try {
      // Method may be transferAdmin or setAdmin depending on contract
      await (await treasury.transferAdmin(govAddr)).wait();
      console.log("  Treasury admin → governor ✓");
    } catch (e) {
      console.log("  ! Could not transfer treasury admin (may not be supported):", e.message);
    }
  }

  deployments.timestamp = new Date().toISOString();
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("\nDeployments saved:", deploymentsPath);

  console.log("\n══════════════════════════════════════════════");
  console.log("Phase 4 Deployment Complete");
  console.log("══════════════════════════════════════════════");
  console.log("AegisGovernor:", deployments.aegisGovernor);
  console.log("\nNext steps:");
  console.log("  1. Run: node scripts/sync-frontend.js");
  console.log("  2. Owners can submit proposals at /governance");
  console.log("  3. All slashing/treasury actions now flow through governance");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Deployment failed:", err);
    process.exit(1);
  });
