/**
 * Rotate v2 arbitrator + factoryV2 admin away from the compromised deployer
 * wallet. Reads the v2 addresses from deployments-mainnet.json.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=<old-key> FRESH_ADMIN=0x... \
 *     npx hardhat run scripts/rotate-v2-admins.js --network og_mainnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const fresh = process.env.FRESH_ADMIN;
  if (!fresh || !ethers.isAddress(fresh)) {
    throw new Error("FRESH_ADMIN env var not set or not a valid address");
  }

  const file = Number(net.chainId) === 16661 ? "deployments-mainnet.json" : "deployments.json";
  const deployments = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"));

  const stakingV2Addr = deployments.operatorStakingV2;
  const poolV2Addr    = deployments.insurancePoolV2;
  const factoryV2Addr = deployments.aegisVaultFactoryV2;

  console.log("Rotating v2 admins");
  console.log("  Network:      ", net.name, "(chainId", net.chainId, ")");
  console.log("  Caller:       ", signer.address);
  console.log("  New admin:    ", fresh);
  console.log("  stakingV2:    ", stakingV2Addr);
  console.log("  poolV2:       ", poolV2Addr);
  console.log("  factoryV2:    ", factoryV2Addr);

  const staking = await ethers.getContractAt("OperatorStaking_v2", stakingV2Addr);
  const pool    = await ethers.getContractAt("InsurancePool_v2",  poolV2Addr);
  const factory = await ethers.getContractAt("AegisVaultFactory", factoryV2Addr);

  // Idempotent: skip role already held by fresh admin, fail hard if held by
  // someone OTHER than caller/fresh (means caller can't rotate AND isn't done).
  const curStakingArb = await staking.arbitrator();
  const curPoolArb    = await pool.arbitrator();
  const curFactoryAdm = await factory.admin();

  const isFresh = (a) => a.toLowerCase() === fresh.toLowerCase();
  const isCaller = (a) => a.toLowerCase() === signer.address.toLowerCase();

  console.log("\nCurrent roles:");
  console.log("  stakingV2.arbitrator:", curStakingArb, isFresh(curStakingArb) ? "(already rotated ✓)" : isCaller(curStakingArb) ? "(will rotate)" : "(HELD BY THIRD PARTY — abort)");
  console.log("  poolV2.arbitrator:   ", curPoolArb,    isFresh(curPoolArb)    ? "(already rotated ✓)" : isCaller(curPoolArb)    ? "(will rotate)" : "(HELD BY THIRD PARTY — abort)");
  console.log("  factoryV2.admin:     ", curFactoryAdm, isFresh(curFactoryAdm) ? "(already rotated ✓)" : isCaller(curFactoryAdm) ? "(will rotate)" : "(HELD BY THIRD PARTY — abort)");

  for (const [label, cur] of [["stakingV2", curStakingArb], ["poolV2", curPoolArb], ["factoryV2", curFactoryAdm]]) {
    if (!isFresh(cur) && !isCaller(cur)) {
      throw new Error(`${label} role held by neither caller nor fresh admin — someone else rotated it. Aborting.`);
    }
  }

  if (!isFresh(curStakingArb)) {
    console.log("\n1/3 stakingV2.setArbitrator…");
    const tx = await staking.setArbitrator(fresh);
    console.log("    tx:", tx.hash);
    await tx.wait();
    console.log("    ✓");
  } else {
    console.log("\n1/3 stakingV2 already rotated, skipping");
  }

  if (!isFresh(curPoolArb)) {
    console.log("\n2/3 poolV2.setArbitrator…");
    const tx = await pool.setArbitrator(fresh);
    console.log("    tx:", tx.hash);
    await tx.wait();
    console.log("    ✓");
  } else {
    console.log("\n2/3 poolV2 already rotated, skipping");
  }

  if (!isFresh(curFactoryAdm)) {
    console.log("\n3/3 factoryV2.transferAdmin…");
    const tx = await factory.transferAdmin(fresh);
    console.log("    tx:", tx.hash);
    await tx.wait();
    console.log("    ✓");
  } else {
    console.log("\n3/3 factoryV2 already rotated, skipping");
  }

  // Verify
  const newStakingArb = await staking.arbitrator();
  const newPoolArb    = await pool.arbitrator();
  const newFactoryAdm = await factory.admin();
  console.log("\nPost-rotation verification:");
  console.log("  stakingV2.arbitrator:  ", newStakingArb, newStakingArb.toLowerCase() === fresh.toLowerCase() ? "✓" : "✗");
  console.log("  poolV2.arbitrator:     ", newPoolArb,    newPoolArb.toLowerCase()    === fresh.toLowerCase() ? "✓" : "✗");
  console.log("  factoryV2.admin:       ", newFactoryAdm, newFactoryAdm.toLowerCase() === fresh.toLowerCase() ? "✓" : "✗");

  if (
    newStakingArb.toLowerCase() !== fresh.toLowerCase() ||
    newPoolArb.toLowerCase()    !== fresh.toLowerCase() ||
    newFactoryAdm.toLowerCase() !== fresh.toLowerCase()
  ) {
    throw new Error("One or more roles did not rotate correctly. Investigate before discarding old key.");
  }
  console.log("\nAll 3 roles rotated ✓");
  console.log("\nRemaining step: drain 0G from old wallet to fresh wallet, then discard old key.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error("Rotation failed:", err); process.exit(1); });
