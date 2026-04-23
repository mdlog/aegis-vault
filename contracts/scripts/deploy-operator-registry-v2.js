/**
 * Deploy fresh OperatorRegistry v2 + OperatorStaking v3.
 *
 * Why a second round of v2:
 *   - The first v2 deploy reused the existing OperatorRegistry so operators
 *     wouldn't have to re-register.
 *   - User now wants a clean marketplace (no legacy operators visible), so
 *     we deploy a fresh registry. OperatorStaking's registry is immutable,
 *     so it also needs a fresh instance pointing at the new registry.
 *
 * IMPORTANT: run this with the CURRENT ARBITRATOR key (fresh EOA that owns
 * v2 staking/pool) — not the compromised deployer. Reason: the existing
 * InsurancePool_v2 needs its arbitrator to authorize the NEW staking as a
 * slash notifier.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=<fresh-admin-key> \
 *     npx hardhat run scripts/deploy-operator-registry-v2.js --network og_mainnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log("─".repeat(60));
  console.log("Fresh OperatorRegistry + OperatorStaking");
  console.log("  Network: ", net.name, "(chainId", net.chainId, ")");
  console.log("  Signer:  ", signer.address);

  const file = Number(net.chainId) === 16661 ? "deployments-mainnet.json" : "deployments.json";
  const deployFile = path.resolve(__dirname, "..", file);
  const deployments = JSON.parse(fs.readFileSync(deployFile, "utf8"));

  const insurancePoolV2 = deployments.insurancePoolV2;
  const stakingV1 = deployments.operatorStaking;              // original v1
  const stakingV2Old = deployments.operatorStakingV2;         // first v2 (about to be retired)
  const usdc = deployments.realTokens?.USDCe || deployments.USDCe || deployments.mockUSDC;

  if (!insurancePoolV2) throw new Error("insurancePoolV2 missing — run deploy-v2 first");
  if (!usdc) throw new Error("USDC address not found");

  // Sanity: confirm the signer is arbitrator on the existing pool v2,
  // otherwise setNotifier() will revert.
  const pool = await ethers.getContractAt("InsurancePool_v2", insurancePoolV2);
  const poolArb = await pool.arbitrator();
  if (poolArb.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Signer (${signer.address}) is not arbitrator of InsurancePool_v2. `
      + `Current arbitrator: ${poolArb}. Run this script with that key.`
    );
  }

  console.log("  InsurancePool_v2 arbitrator matches signer ✓");
  console.log("  Current OperatorStaking v2 (old):", stakingV2Old || "(none)");
  console.log("  Reusing InsurancePool_v2:        ", insurancePoolV2);
  console.log("  Reusing USDC:                    ", usdc);

  // ── 1. Fresh OperatorRegistry ──
  console.log("\n1/4 Deploying OperatorRegistry (fresh)");
  const Registry = await ethers.getContractFactory("OperatorRegistry");
  const registryV2 = await Registry.deploy();
  await registryV2.waitForDeployment();
  const registryV2Addr = await registryV2.getAddress();
  console.log("    OperatorRegistry v2:", registryV2Addr);

  // ── 2. Fresh OperatorStaking v2 pointing at new registry ──
  console.log("\n2/4 Deploying OperatorStaking_v2 (new instance, points to registry v2)");
  const StakingV2 = await ethers.getContractFactory("OperatorStaking_v2");
  const stakingV2 = await StakingV2.deploy(
    usdc,
    registryV2Addr,
    insurancePoolV2,
    signer.address, // arbitrator = deployer (fresh EOA) — same model as before
  );
  await stakingV2.waitForDeployment();
  const stakingV2Addr = await stakingV2.getAddress();
  console.log("    OperatorStaking v2:", stakingV2Addr);

  // ── 3. Authorize new staking as notifier on the (reused) pool ──
  console.log("\n3/4 Authorizing new staking as slash notifier on InsurancePool_v2");
  const tx1 = await pool.setNotifier(stakingV2Addr, true);
  console.log("    tx:", tx1.hash);
  await tx1.wait();
  console.log("    Authorized ✓");

  // ── 4. De-authorize OLD staking (hygiene — no one has staked there, but
  //      leaving it authorized means a rogue caller that somehow triggers
  //      the old staking could still write accounting on the pool) ──
  if (stakingV2Old && stakingV2Old.toLowerCase() !== stakingV2Addr.toLowerCase()) {
    console.log("\n4/4 De-authorizing OLD OperatorStaking_v2 from pool (hygiene)");
    const tx2 = await pool.setNotifier(stakingV2Old, false);
    console.log("    tx:", tx2.hash);
    await tx2.wait();
    console.log("    De-authorized ✓");
  } else {
    console.log("\n4/4 No old v2 staking to de-authorize — skipped");
  }

  // ── Persist ──
  // We archive the "old" v2 addresses under *_retired keys for audit trail,
  // then overwrite operatorRegistryV2 / operatorStakingV2 with new ones.
  const patch = {
    operatorStakingV2_retired: stakingV2Old || '',
    operatorRegistry_retired:  deployments.operatorRegistry || '',
    operatorRegistryV2:        registryV2Addr,
    operatorStakingV2:         stakingV2Addr,
    operatorStackV2Redeploy:   new Date().toISOString(),
  };
  const merged = { ...deployments, ...patch };
  fs.writeFileSync(deployFile, JSON.stringify(merged, null, 2));
  console.log("\nDeployments updated:", deployFile);

  console.log("\n" + "═".repeat(60));
  console.log("Fresh operator stack live");
  console.log("═".repeat(60));
  console.log("operatorRegistryV2: ", registryV2Addr);
  console.log("operatorStakingV2:  ", stakingV2Addr);
  console.log("(insurancePoolV2 reused, now notifies new staking only)");
  console.log("\nNext steps:");
  console.log("  1. node scripts/sync-frontend.js deployments-mainnet.json");
  console.log("  2. Frontend cutover: all operator pages point to operatorRegistryV2");
  console.log("  3. Existing operators must re-register at /operator/register");
  console.log("  4. Stake + arbitrator operations now target the new staking contract");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error("Deploy failed:", err); process.exit(1); });
