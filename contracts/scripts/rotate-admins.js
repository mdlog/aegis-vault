/**
 * rotate-admins.js
 *
 * Transfers admin / owner / arbitrator roles on all deployed contracts
 * from the current DEPLOYER_PRIVATE_KEY signer to a NEW_ADMIN address.
 *
 * The signer private key is read from .env (DEPLOYER_PRIVATE_KEY) and
 * never logged. The target NEW_ADMIN address is the only public input.
 *
 * Usage:
 *   NEW_ADMIN=0x... npx hardhat run scripts/rotate-admins.js --network og_mainnet
 *
 * Idempotent: each transfer is skipped if the role is already on NEW_ADMIN.
 *
 * NOTE — VaultNAVCalculator has no transferAdmin function. It is logged
 *        as a manual follow-up (redeploy required). The other 7 contracts
 *        are rotated atomically here.
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const newAdmin = process.env.NEW_ADMIN;
  if (!newAdmin) {
    throw new Error(
      "NEW_ADMIN env var required.\n" +
      "Usage: NEW_ADMIN=0x... npx hardhat run scripts/rotate-admins.js --network og_mainnet"
    );
  }
  if (!ethers.isAddress(newAdmin)) {
    throw new Error(`Invalid NEW_ADMIN address: ${newAdmin}`);
  }
  const newAdminChecksum = ethers.getAddress(newAdmin);

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY in .env.");
  }
  const signer = signers[0];

  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== 16661) {
    throw new Error(`Expected 0G mainnet (16661), got chain ${network.chainId}`);
  }

  console.log("╔════════════════════════════════════════════════╗");
  console.log("║   Rotate admins — 0G Mainnet                  ║");
  console.log("╚════════════════════════════════════════════════╝\n");
  console.log("From (current signer): ", signer.address);
  console.log("To   (NEW_ADMIN):      ", newAdminChecksum);
  console.log("");

  if (signer.address.toLowerCase() === newAdminChecksum.toLowerCase()) {
    throw new Error("NEW_ADMIN is the same as current signer. Nothing to rotate.");
  }

  const deploymentsPath = path.join(__dirname, "..", "deployments-mainnet.json");
  const d = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const steps = [
    {
      name: "ExecutionRegistry",
      address: d.executionRegistry,
      abi: [
        "function admin() view returns (address)",
        "function transferAdmin(address newAdmin) external",
      ],
      read: "admin",
      call: async (c) => c.transferAdmin(newAdminChecksum),
    },
    {
      name: "AegisVaultFactory",
      address: d.aegisVaultFactory,
      abi: [
        "function admin() view returns (address)",
        "function transferAdmin(address newAdmin) external",
      ],
      read: "admin",
      call: async (c) => c.transferAdmin(newAdminChecksum),
    },
    {
      name: "OperatorReputation",
      address: d.operatorReputation,
      abi: [
        "function admin() view returns (address)",
        "function transferAdmin(address newAdmin) external",
      ],
      read: "admin",
      call: async (c) => c.transferAdmin(newAdminChecksum),
    },
    {
      name: "ProtocolTreasury",
      address: d.protocolTreasury,
      abi: [
        "function admin() view returns (address)",
        "function transferAdmin(address newAdmin) external",
      ],
      read: "admin",
      call: async (c) => c.transferAdmin(newAdminChecksum),
    },
    {
      name: "JaineVenueAdapter",
      address: d.jaineVenueAdapter,
      abi: [
        "function owner() view returns (address)",
        "function transferOwnership(address newOwner) external",
      ],
      read: "owner",
      call: async (c) => c.transferOwnership(newAdminChecksum),
    },
    {
      name: "OperatorStaking (arbitrator)",
      address: d.operatorStaking,
      abi: [
        "function arbitrator() view returns (address)",
        "function setArbitrator(address newArbitrator) external",
      ],
      read: "arbitrator",
      call: async (c) => c.setArbitrator(newAdminChecksum),
    },
    {
      name: "InsurancePool (arbitrator)",
      address: d.insurancePool,
      abi: [
        "function arbitrator() view returns (address)",
        "function setArbitrator(address newArbitrator) external",
      ],
      read: "arbitrator",
      call: async (c) => c.setArbitrator(newAdminChecksum),
    },
  ];

  let okCount = 0;
  let skipCount = 0;
  let errCount = 0;

  for (const step of steps) {
    const prefix = `[${step.name}]`.padEnd(34);

    if (!step.address) {
      console.log(`${prefix} ⚠  address missing in deployments-mainnet.json — skipped`);
      errCount++;
      continue;
    }

    try {
      const contract = new ethers.Contract(step.address, step.abi, signer);
      const currentRole = await contract[step.read]();

      if (currentRole.toLowerCase() === newAdminChecksum.toLowerCase()) {
        console.log(`${prefix} ✓ already on NEW_ADMIN — skipped`);
        skipCount++;
        continue;
      }

      if (currentRole.toLowerCase() !== signer.address.toLowerCase()) {
        console.log(`${prefix} ⚠  current role is ${currentRole} (not signer) — skipped`);
        errCount++;
        continue;
      }

      const tx = await step.call(contract);
      const rcpt = await tx.wait();
      console.log(`${prefix} ✓ ${step.read} → NEW_ADMIN  (tx ${rcpt.hash})`);
      okCount++;
    } catch (err) {
      console.log(`${prefix} ✗ ${err.shortMessage || err.message}`);
      errCount++;
    }
  }

  console.log("");
  console.log("────────────────────────────────────────────────");
  console.log(`  Rotated:  ${okCount}`);
  console.log(`  Already:  ${skipCount}`);
  console.log(`  Skipped:  ${errCount}`);
  console.log("────────────────────────────────────────────────");

  // ── Manual follow-up notes ──
  console.log("");
  console.log("⚠  Manual follow-up required:");
  console.log("");
  console.log("  1. VaultNAVCalculator");
  console.log(`     Address: ${d.vaultNAVCalculator}`);
  console.log("     Has no transferAdmin function. Admin is locked to original deployer.");
  console.log("     Options:");
  console.log("       a) Redeploy via deploy-mainnet.js (simplest; no vaults exist yet).");
  console.log("       b) Deploy a new NAV calculator and update vault references later.");
  console.log("");
  console.log("  2. AegisGovernor");
  console.log(`     Address: ${d.aegisGovernor}`);
  console.log(`     Owners: ${(d.governorOwners || []).join(", ")}`);
  console.log("     Governor is a multisig — rotating owners must be done via governor proposals:");
  console.log("       a) Submit proposal to addOwner(NEW_ADMIN).");
  console.log("       b) Approve + execute with 1-of-1 threshold.");
  console.log("       c) Submit + execute proposal to removeOwner(OLD_OWNER).");
  console.log("");
  console.log("  3. Next: update orchestrator + frontend");
  console.log("     - Rotate PRIVATE_KEY in orchestrator/.env to NEW_ADMIN's key");
  console.log("     - Rotate DEPLOYER_PRIVATE_KEY in contracts/.env (if you still deploy more)");
  console.log("     - Rebuild + redeploy frontend (addresses unchanged — no sync needed)");
  console.log("");

  if (errCount > 0 && okCount === 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\n✗ Rotate failed:", err.shortMessage || err.message);
  process.exit(1);
});
