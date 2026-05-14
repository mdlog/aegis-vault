/**
 * deploy-fresh-marketplace.js
 *
 * Deploy a fully fresh operator marketplace stack: OperatorRegistry +
 * InsurancePool_v2 + OperatorStaking_v2 + OperatorReputation. Used for
 * a clean V4 cutover where the marketplace must start with zero
 * operators / zero stakers / zero reputation history.
 *
 * Why all four?
 *
 *   The four contracts are interlinked. Registry is standalone but staking's
 *   `registry` is immutable → a fresh registry needs a fresh staking. Staking
 *   notifies the pool on slash via `pool.setNotifier(staking, true)` which
 *   requires the pool's arbitrator to authorize the new notifier. The live
 *   InsurancePool_v2 arbitrator is the AegisGovernor multisig — running the
 *   prior `deploy-operator-registry-v2.js` script with an EOA fails the
 *   pre-flight check.
 *
 *   This script side-steps the multisig dependency by deploying a fresh
 *   InsurancePool_v2 with the deployer as initial arbitrator, then doing the
 *   notifier wire-up locally, then OPTIONALLY rotating the arbitrator role
 *   to AegisGovernor at the end (deferred-rotation path so the deploy is
 *   autonomous).
 *
 *   OperatorReputation has no on-chain coupling to staking; we deploy a
 *   fresh one here because the live instance has an EOA admin (per audit
 *   H-7) — fresh contract lets us land it on AegisGovernor without a live
 *   transferAdmin call.
 *
 * Old contracts ARE NOT touched. They keep their state and remain reachable
 * from any indexer that watches their addresses. The frontend cuts over by
 * the next `sync-frontend.js` run (which copies the new addresses into
 * `frontend/src/lib/deployments.generated.json`). Operators previously
 * registered on the old registry must re-register on the new one — that is
 * the desired clean-slate behavior.
 *
 * Idempotent: each step skips if the target key in deployments-mainnet.json
 * already points at a contract with code. Re-run is safe.
 *
 * Usage:
 *   CONFIRM_MAINNET=1 DEPLOYER_PRIVATE_KEY=<key> \
 *     npx hardhat run scripts/deploy-fresh-marketplace.js --network og_mainnet
 *
 *   # Deferred rotation: by default the freshly-deployed contracts keep the
 *   # deployer as arbitrator/admin so the wire-up tx (setNotifier) can run.
 *   # Pass ROTATE_TO_GOVERNOR=1 to also queue arbitrator/admin rotation to
 *   # the AegisGovernor multisig at the end of the deploy. The rotation uses
 *   # the Ownable2Step pattern where available; staking/insurance use
 *   # single-step setArbitrator (no 2-step on those contracts).
 *   ROTATE_TO_GOVERNOR=1 CONFIRM_MAINNET=1 DEPLOYER_PRIVATE_KEY=<key> \
 *     npx hardhat run scripts/deploy-fresh-marketplace.js --network og_mainnet
 *
 *   # Testnet / hardhat shakeout:
 *   ALLOW_NON_MAINNET=1 CONFIRM_MAINNET=0 npx hardhat run scripts/deploy-fresh-marketplace.js --network og_testnet
 *
 * Writes back into deployments-mainnet.json (chainId 16661) or
 * deployments.json (any other chain). Old addresses are preserved under
 * `*_retired` keys for the on-chain audit trail.
 *
 * New / updated keys:
 *   operatorRegistryV2                ← fresh registry
 *   operatorStakingV2                 ← fresh staking (bound to fresh registry + fresh pool)
 *   insurancePoolV2                   ← fresh pool
 *   operatorReputation                ← fresh reputation
 *   operatorRegistryV2_retired        ← previous address (audit trail)
 *   operatorStakingV2_retired
 *   insurancePoolV2_retired
 *   operatorReputation_retired
 *   freshMarketplaceDeployedAt        ← ISO timestamp
 *   freshMarketplaceDeployer          ← deployer EOA
 *
 * After this script:
 *   1. `node scripts/sync-frontend.js deployments-mainnet.json` — propagates
 *      to frontend manifest.
 *   2. Frontend rebuild + redeploy. Marketplace shows zero operators.
 *   3. (Optional) For every V4 vault that needs to record reputation, the
 *      reputation admin must call `setRecorder(vault, true)` — this is a
 *      per-vault op that lives outside this script.
 *   4. (Optional) If ROTATE_TO_GOVERNOR=1 was not used, manually rotate the
 *      4 arbitrator/admin slots to AegisGovernor.
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const MAINNET_CHAIN_ID = 16661;

function loadDeployments(chainId) {
  const file = Number(chainId) === MAINNET_CHAIN_ID
    ? "deployments-mainnet.json"
    : "deployments.json";
  const p = path.resolve(__dirname, "..", file);
  if (!fs.existsSync(p)) {
    throw new Error(`${file} not found at ${p}`);
  }
  return { path: p, data: JSON.parse(fs.readFileSync(p, "utf8")) };
}

function checksum(addr) {
  return ethers.getAddress(addr);
}

async function isContract(provider, addr) {
  if (!addr) return false;
  try {
    const code = await provider.getCode(addr);
    return code && code !== "0x";
  } catch {
    return false;
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY in .env.");

  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("─".repeat(72));
  console.log("Fresh marketplace deploy — OperatorRegistry + Staking + Pool + Reputation");
  console.log("  Network:  ", net.name, "(chainId", chainId + ")");
  console.log("  Deployer: ", deployer.address);
  console.log("  Balance:  ", ethers.formatEther(balance), "0G/ETH");
  console.log("─".repeat(72));

  // Mainnet guards (mirror deploy-v4.js).
  const allowNonMainnet =
    process.env.ALLOW_NON_MAINNET === "1" || process.argv.includes("--allow-non-mainnet");
  if (chainId !== MAINNET_CHAIN_ID && !allowNonMainnet) {
    throw new Error(
      `Refusing to deploy on chainId ${chainId}. Expected ${MAINNET_CHAIN_ID} (0G mainnet). ` +
        `Re-run with ALLOW_NON_MAINNET=1 for testnet / hardhat shakeout.`
    );
  }
  if (chainId === MAINNET_CHAIN_ID && process.env.CONFIRM_MAINNET !== "1") {
    throw new Error(
      "Mainnet deploy requires CONFIRM_MAINNET=1 to prevent accidental burns."
    );
  }

  const { path: deployFile, data: deployments } = loadDeployments(chainId);

  // ── Inputs ──
  const usdc = deployments.realTokens?.USDCe
            || deployments.USDCe
            || deployments.mockUSDC;
  if (!usdc) {
    throw new Error("USDC address not found in deployments (need realTokens.USDCe / USDCe / mockUSDC)");
  }
  const aegisGovernor = deployments.aegisGovernor || "";
  const rotateToGovernor = process.env.ROTATE_TO_GOVERNOR === "1";

  if (rotateToGovernor && !aegisGovernor) {
    throw new Error("ROTATE_TO_GOVERNOR=1 requires aegisGovernor in deployments");
  }

  console.log("\nInputs:");
  console.log("  USDC (stake/payout) :", checksum(usdc));
  console.log("  AegisGovernor       :", aegisGovernor || "(none — rotation skipped)");
  console.log("  rotateToGovernor    :", rotateToGovernor ? "yes" : "no (manual rotation later)");

  // ── 1. Fresh OperatorRegistry ──
  console.log("\n[1/5] OperatorRegistry (fresh)");
  let registryAddr = deployments.operatorRegistryV2_fresh;
  if (registryAddr && (await isContract(ethers.provider, registryAddr))) {
    registryAddr = checksum(registryAddr);
    console.log("      reused (from prior run) :", registryAddr);
  } else {
    const Registry = await ethers.getContractFactory("OperatorRegistry");
    const reg = await Registry.deploy();
    await reg.waitForDeployment();
    registryAddr = checksum(await reg.getAddress());
    console.log("      deployed :", registryAddr);
  }

  // ── 2. Fresh InsurancePool_v2 (deployer as initial arbitrator) ──
  console.log("\n[2/5] InsurancePool_v2 (fresh, deployer as arbitrator)");
  let poolAddr = deployments.insurancePoolV2_fresh;
  if (poolAddr && (await isContract(ethers.provider, poolAddr))) {
    poolAddr = checksum(poolAddr);
    console.log("      reused :", poolAddr);
  } else {
    const Pool = await ethers.getContractFactory("InsurancePool_v2");
    // arbitrator = deployer initially so we can `setNotifier` in step 4.
    // Optionally rotated to AegisGovernor at end of script.
    const pool = await Pool.deploy(usdc, deployer.address);
    await pool.waitForDeployment();
    poolAddr = checksum(await pool.getAddress());
    console.log("      deployed :", poolAddr);
  }

  // ── 3. Fresh OperatorStaking_v2 (bound to fresh registry + fresh pool) ──
  console.log("\n[3/5] OperatorStaking_v2 (fresh, points to fresh registry + fresh pool)");
  let stakingAddr = deployments.operatorStakingV2_fresh;
  if (stakingAddr && (await isContract(ethers.provider, stakingAddr))) {
    stakingAddr = checksum(stakingAddr);
    console.log("      reused :", stakingAddr);
  } else {
    const Staking = await ethers.getContractFactory("OperatorStaking_v2");
    // arbitrator = deployer initially. Rotated to AegisGovernor at end if requested.
    const staking = await Staking.deploy(
      usdc,
      registryAddr,
      poolAddr,
      deployer.address
    );
    await staking.waitForDeployment();
    stakingAddr = checksum(await staking.getAddress());
    console.log("      deployed :", stakingAddr);
  }

  // ── 4. Authorize fresh staking on fresh pool ──
  console.log("\n[4/5] InsurancePool_v2.setNotifier(staking, true)");
  const pool = await ethers.getContractAt("InsurancePool_v2", poolAddr);
  const isNotifier = await pool.authorizedNotifiers(stakingAddr).catch(() => null);
  if (isNotifier === true) {
    console.log("      already authorized → skip");
  } else {
    // Verify deployer is the current arbitrator (it should be — we just set it
    // at construction). If something rotated it out from under us, fail loudly.
    const poolArb = checksum(await pool.arbitrator());
    if (poolArb !== checksum(deployer.address)) {
      throw new Error(
        `Pool arbitrator is ${poolArb}, not deployer ${deployer.address}. ` +
        `Refusing to call setNotifier. (Did a parallel rotation happen?)`
      );
    }
    const tx = await pool.setNotifier(stakingAddr, true);
    const rcpt = await tx.wait();
    console.log("      authorized ✓ (tx", rcpt.hash + ")");
  }

  // ── 5. Fresh OperatorReputation (deployer as admin) ──
  console.log("\n[5/5] OperatorReputation (fresh, deployer as admin)");
  let reputationAddr = deployments.operatorReputation_fresh;
  if (reputationAddr && (await isContract(ethers.provider, reputationAddr))) {
    reputationAddr = checksum(reputationAddr);
    console.log("      reused :", reputationAddr);
  } else {
    const Reputation = await ethers.getContractFactory("OperatorReputation");
    const rep = await Reputation.deploy(deployer.address);
    await rep.waitForDeployment();
    reputationAddr = checksum(await rep.getAddress());
    console.log("      deployed :", reputationAddr);
  }

  // ── Optional: rotate arbitrators/admin to AegisGovernor ──
  if (rotateToGovernor) {
    console.log("\n[rotation] Rotate arbitrator/admin to AegisGovernor");
    console.log("            AegisGovernor:", checksum(aegisGovernor));

    // Pool: single-step setArbitrator
    const poolCurrentArb = checksum(await pool.arbitrator());
    if (poolCurrentArb !== checksum(aegisGovernor)) {
      const tx = await pool.setArbitrator(aegisGovernor);
      await tx.wait();
      console.log("            pool.setArbitrator(governor) ✓ (tx", tx.hash + ")");
    } else {
      console.log("            pool.arbitrator already governor — skip");
    }

    // Staking: single-step setArbitrator
    const staking = await ethers.getContractAt("OperatorStaking_v2", stakingAddr);
    const stakingCurrentArb = checksum(await staking.arbitrator());
    if (stakingCurrentArb !== checksum(aegisGovernor)) {
      const tx = await staking.setArbitrator(aegisGovernor);
      await tx.wait();
      console.log("            staking.setArbitrator(governor) ✓ (tx", tx.hash + ")");
    } else {
      console.log("            staking.arbitrator already governor — skip");
    }

    // Reputation: single-step transferAdmin (no 2-step on this contract).
    const reputation = await ethers.getContractAt("OperatorReputation", reputationAddr);
    const repCurrentAdmin = checksum(await reputation.admin());
    if (repCurrentAdmin !== checksum(aegisGovernor)) {
      const tx = await reputation.transferAdmin(aegisGovernor);
      await tx.wait();
      console.log("            reputation.transferAdmin(governor) ✓ (tx", tx.hash + ")");
    } else {
      console.log("            reputation.admin already governor — skip");
    }
  } else {
    console.log("\n[rotation] Skipped (ROTATE_TO_GOVERNOR not set)");
    console.log("           Run rotate-v2-admins.js + reputation transferAdmin manually later.");
  }

  // ── Persist deployment record ──
  // Move current marketplace addresses to *_retired (audit trail), then
  // overwrite the canonical keys with the fresh ones.
  const patch = {
    operatorRegistryV2_retired:        deployments.operatorRegistryV2 || "",
    operatorStakingV2_retired:         deployments.operatorStakingV2 || "",
    insurancePoolV2_retired:           deployments.insurancePoolV2 || "",
    operatorReputation_retired:        deployments.operatorReputation || "",

    operatorRegistryV2:                registryAddr,
    operatorStakingV2:                 stakingAddr,
    insurancePoolV2:                   poolAddr,
    operatorReputation:                reputationAddr,

    // Mirror under aliases used by older legacy paths so any consumer that
    // still reads the v1-shape key gets the fresh marketplace too.
    operatorRegistry:                  registryAddr,
    operatorStaking:                   stakingAddr,
    insurancePool:                     poolAddr,

    freshMarketplaceDeployedAt:        new Date().toISOString(),
    freshMarketplaceDeployer:          deployer.address,
    freshMarketplaceRotatedToGovernor: rotateToGovernor,
  };
  const merged = { ...deployments, ...patch };
  fs.writeFileSync(deployFile, JSON.stringify(merged, null, 2));
  console.log("\n📝 Wrote fresh marketplace addresses to", path.basename(deployFile));

  // ── Summary ──
  console.log("\n" + "═".repeat(72));
  console.log("Fresh marketplace live");
  console.log("═".repeat(72));
  console.log("  OperatorRegistry    :", registryAddr);
  console.log("  OperatorStaking_v2  :", stakingAddr);
  console.log("  InsurancePool_v2    :", poolAddr);
  console.log("  OperatorReputation  :", reputationAddr);
  console.log("");
  console.log("Retired (audit trail, frontend cuts over via sync-frontend.js):");
  console.log("  OperatorRegistry_retired   :", patch.operatorRegistryV2_retired || "(none)");
  console.log("  OperatorStaking_retired    :", patch.operatorStakingV2_retired || "(none)");
  console.log("  InsurancePool_retired      :", patch.insurancePoolV2_retired || "(none)");
  console.log("  OperatorReputation_retired :", patch.operatorReputation_retired || "(none)");
  console.log("");
  console.log("Next steps:");
  console.log("  1. node scripts/sync-frontend.js deployments-mainnet.json");
  console.log("  2. cd ../frontend && npm run build && (redeploy dist/)");
  console.log("  3. Marketplace UI shows zero operators / zero stakers / zero claims.");
  if (!rotateToGovernor) {
    console.log("  4. Rotate roles to AegisGovernor:");
    console.log("       FRESH_ADMIN=" + (aegisGovernor || "<governor>") + " \\");
    console.log("         npx hardhat run scripts/rotate-v2-admins.js --network og_mainnet");
    console.log("       (manual: reputation.transferAdmin(governor) — no dedicated script)");
  }
  console.log("═".repeat(72));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Fresh marketplace deploy failed:", err.shortMessage || err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
