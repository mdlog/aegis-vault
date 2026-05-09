/**
 * rotate-2step-admins.js
 *
 * Rotates admin / arbitrator roles on the contracts that have been migrated
 * to the Ownable2Step pattern. The 2-step contracts queue a `pendingAdmin`
 * on the first call and only finalize once the new admin calls
 * `acceptAdmin` (or `acceptOwnership`) — a typo in the target address can
 * be corrected before acceptance instead of permanently bricking the
 * contract.
 *
 * Two modes:
 *
 *   MODE=propose (default)
 *     Run from the CURRENT admin signer. Calls `transferAdmin(NEW_ADMIN)`
 *     on every 2-step contract that names the current signer as admin and
 *     does NOT already have the new admin pending. Idempotent.
 *
 *   MODE=accept
 *     Run from the NEW_ADMIN signer. Calls `acceptAdmin()` on every 2-step
 *     contract whose `pendingAdmin` equals the current signer. Finalizes
 *     the rotation. Idempotent.
 *
 * Contracts handled (read from deployments-mainnet.json):
 *   - ExecutionRegistry          (admin / 2-step — pre-existing)
 *   - AegisVaultFactory          (admin / 2-step — patched in audit fix round)
 *   - AegisVaultFactoryV3        (admin / 2-step — patched in audit fix round)
 *   - AegisVaultFactoryV4        (admin / 2-step — new in audit fix round)
 *   - ProtocolTreasury           (admin / 2-step — patched in audit fix round)
 *   - VaultNAVCalculator         (admin / 2-step — pre-existing)
 *
 * Single-step contracts (NOT handled here — use rotate-admins.js / rotate-v2-admins.js):
 *   - OperatorStaking_v2.arbitrator   (single-step setArbitrator)
 *   - InsurancePool_v2.arbitrator     (single-step setArbitrator)
 *   - OperatorReputation.admin        (single-step transferAdmin)
 *   - JaineVenueAdapter*.owner        (single-step transferOwnership)
 *   - UniswapV3VenueAdapter.owner     (single-step transferOwnership)
 *   - AegisGovernor                   (multisig — proposals via UI)
 *
 * Usage:
 *   # Step 1 — current admin proposes
 *   DEPLOYER_PRIVATE_KEY=<current> NEW_ADMIN=0x... MODE=propose \
 *     npx hardhat run scripts/rotate-2step-admins.js --network og_mainnet
 *
 *   # Step 2 — NEW admin accepts (run with new admin's key)
 *   DEPLOYER_PRIVATE_KEY=<new> MODE=accept \
 *     npx hardhat run scripts/rotate-2step-admins.js --network og_mainnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const ABI_2STEP = [
  "function admin() view returns (address)",
  "function pendingAdmin() view returns (address)",
  "function transferAdmin(address newAdmin) external",
  "function acceptAdmin() external",
  "function cancelAdminTransfer() external",
];

async function main() {
  const mode = (process.env.MODE || "propose").toLowerCase();
  if (!["propose", "accept", "cancel"].includes(mode)) {
    throw new Error(`MODE must be propose | accept | cancel — got ${mode}`);
  }

  const newAdmin = process.env.NEW_ADMIN;
  if (mode === "propose") {
    if (!newAdmin || !ethers.isAddress(newAdmin)) {
      throw new Error("NEW_ADMIN env var required (and must be a valid address) for MODE=propose");
    }
  }
  const target = newAdmin ? ethers.getAddress(newAdmin) : null;

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY in .env.");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const file = chainId === 16661 ? "deployments-mainnet.json" : "deployments.json";
  const deployments = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", file), "utf8")
  );

  const targets = [
    { name: "ExecutionRegistry",      key: "executionRegistry" },
    { name: "ExecutionRegistry V3",   key: "executionRegistryV3" },
    { name: "AegisVaultFactory",      key: "aegisVaultFactory" },
    { name: "AegisVaultFactoryV3",    key: "aegisVaultFactoryV3" },
    { name: "AegisVaultFactoryV4",    key: "aegisVaultFactoryV4" },
    { name: "ProtocolTreasury",       key: "protocolTreasury" },
    { name: "VaultNAVCalculator",     key: "vaultNAVCalculator" },
  ];

  console.log("─".repeat(72));
  console.log(`rotate-2step-admins  mode=${mode}  signer=${signer.address}  network=${network.name} (${chainId})`);
  if (target) console.log(`  target NEW_ADMIN: ${target}`);
  console.log("─".repeat(72));

  let okCount = 0, skipCount = 0, errCount = 0;

  for (const t of targets) {
    const addr = deployments[t.key];
    const tag = `[${t.name}]`.padEnd(28);

    if (!addr) {
      console.log(`${tag} ⚠  not in deployments — skipped`);
      continue;
    }

    let contract;
    try {
      contract = new ethers.Contract(addr, ABI_2STEP, signer);
    } catch (err) {
      console.log(`${tag} ✗ instantiate failed: ${err.message}`);
      errCount++;
      continue;
    }

    let admin, pending;
    try {
      admin = await contract.admin();
      pending = await contract.pendingAdmin();
    } catch (err) {
      console.log(`${tag} ⚠  not 2-step (no pendingAdmin view) — use rotate-admins.js / rotate-v2-admins.js`);
      continue;
    }

    if (mode === "propose") {
      if (admin.toLowerCase() === target.toLowerCase()) {
        console.log(`${tag} ✓ admin already on NEW_ADMIN — skipped`);
        skipCount++;
        continue;
      }
      if (admin.toLowerCase() !== signer.address.toLowerCase()) {
        console.log(`${tag} ⚠  current admin is ${admin}, not signer — skipped`);
        errCount++;
        continue;
      }
      if (pending.toLowerCase() === target.toLowerCase()) {
        console.log(`${tag} ✓ NEW_ADMIN already pending — skipped (run MODE=accept from NEW_ADMIN)`);
        skipCount++;
        continue;
      }
      try {
        const tx = await contract.transferAdmin(target);
        const rcpt = await tx.wait();
        console.log(`${tag} ✓ transferAdmin → pending=${target}  (tx ${rcpt.hash})`);
        okCount++;
      } catch (err) {
        console.log(`${tag} ✗ transferAdmin failed: ${err.shortMessage || err.message}`);
        errCount++;
      }
    } else if (mode === "accept") {
      if (admin.toLowerCase() === signer.address.toLowerCase()) {
        console.log(`${tag} ✓ admin already on signer — skipped`);
        skipCount++;
        continue;
      }
      if (pending.toLowerCase() !== signer.address.toLowerCase()) {
        console.log(`${tag} ⚠  pending is ${pending}, not signer — skipped`);
        errCount++;
        continue;
      }
      try {
        const tx = await contract.acceptAdmin();
        const rcpt = await tx.wait();
        console.log(`${tag} ✓ acceptAdmin → admin=${signer.address}  (tx ${rcpt.hash})`);
        okCount++;
      } catch (err) {
        console.log(`${tag} ✗ acceptAdmin failed: ${err.shortMessage || err.message}`);
        errCount++;
      }
    } else if (mode === "cancel") {
      if (admin.toLowerCase() !== signer.address.toLowerCase()) {
        console.log(`${tag} ⚠  current admin is ${admin}, not signer — skipped`);
        errCount++;
        continue;
      }
      if (pending === ethers.ZeroAddress) {
        console.log(`${tag} ✓ no pending — skipped`);
        skipCount++;
        continue;
      }
      try {
        const tx = await contract.cancelAdminTransfer();
        const rcpt = await tx.wait();
        console.log(`${tag} ✓ cancelAdminTransfer (tx ${rcpt.hash})`);
        okCount++;
      } catch (err) {
        console.log(`${tag} ✗ cancelAdminTransfer failed: ${err.shortMessage || err.message}`);
        errCount++;
      }
    }
  }

  console.log("─".repeat(72));
  console.log(`done — ok=${okCount} skip=${skipCount} err=${errCount}`);
  console.log("─".repeat(72));

  if (mode === "propose") {
    console.log("\nNext: hand the NEW_ADMIN key to its holder and have them run\n  MODE=accept npx hardhat run scripts/rotate-2step-admins.js --network og_mainnet\n");
  }

  if (errCount > 0 && okCount === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\n✗ rotate-2step-admins failed:", err.shortMessage || err.message);
  process.exit(1);
});
