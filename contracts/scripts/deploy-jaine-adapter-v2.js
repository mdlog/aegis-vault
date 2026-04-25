// Deploy `JaineVenueAdapterV2` to 0G Aristotle mainnet.
//
// This is a one-shot, additive deploy — it does NOT redeploy the rest of the
// stack and does NOT touch live vaults. Existing vaults stay pinned to the V1
// adapter address (their `venue` is set at initialize and is immutable).
// New vaults created after this deploy can opt in to V2 by passing the new
// adapter address through the factory.
//
// Usage:
//   DEPLOYER_PRIVATE_KEY=<key> CONFIRM_MAINNET=1 \
//     npx hardhat run scripts/deploy-jaine-adapter-v2.js --network og_mainnet
//
// What it does:
//   1. Reads existing `deployments-mainnet.json` (Jaine router + factory + W0G)
//   2. Deploys `JaineVenueAdapterV2(router, factory, hubToken=W0G)`
//   3. Optionally re-registers the same Pyth feeds the V1 adapter has (skipped
//      by default — Jaine's on-chain Pyth feeds were stale during the hackathon
//      window, so we ship V2 with oracle guard OFF, same posture as V1 today)
//   4. Transfers ownership to the executor wallet (matches admin centralisation)
//   5. Writes the new address into `deployments-mainnet.json` under
//      `jaineVenueAdapterV2` (V1 stays at `jaineVenueAdapter` for vault history)
//
// Post-deploy:
//   - Run `node scripts/sync-frontend.js deployments-mainnet.json` to surface the
//     new address in the UI's chain config.
//   - Run `node sdk/...` to bump the SDK address book if you cut a release.
//   - Tell users that newly created vaults will route through V2 automatically;
//     legacy vaults keep working with single-hop V1.

const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

const DEPLOYMENTS_FILE = path.join(__dirname, "../deployments-mainnet.json");

// If EXECUTOR_ADDRESS is set, transfer ownership to it. Otherwise the
// deployer keeps ownership — this is the right default when you're already
// running the deploy from the executor wallet (`owner = msg.sender` in the
// adapter constructor takes care of it). We deliberately avoid hardcoding
// an address here: a typo or stale checksum would crash mid-deploy after
// the contract is already on-chain (which is exactly how this script's
// previous version broke).
const RAW_EXECUTOR = process.env.EXECUTOR_ADDRESS || "";

function readDeployments() {
  if (!fs.existsSync(DEPLOYMENTS_FILE)) {
    throw new Error(`deployments-mainnet.json not found at ${DEPLOYMENTS_FILE}`);
  }
  return JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf8"));
}

function writeDeployments(d) {
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(d, null, 2) + "\n");
}

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== 16661) {
    throw new Error(`Wrong network: chainId=${chainId}, expected 16661 (0G Aristotle)`);
  }
  if (process.env.CONFIRM_MAINNET !== "1") {
    throw new Error("Set CONFIRM_MAINNET=1 to confirm you mean to deploy to 0G mainnet.");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const dep = readDeployments();
  const router  = dep.jaine?.router;
  const factory = dep.jaine?.factory;
  const w0g     = dep.jaine?.w0g || dep.realTokens?.W0G;
  if (!router || !factory || !w0g) {
    throw new Error("deployments-mainnet.json is missing jaine.router / jaine.factory / W0G");
  }

  console.log("Jaine router : ", router);
  console.log("Jaine factory: ", factory);
  console.log("Hub token W0G:", w0g);

  console.log("\n[1/3] Deploying JaineVenueAdapterV2…");
  const Adapter = await hre.ethers.getContractFactory("JaineVenueAdapterV2");
  const adapter = await Adapter.deploy(router, factory, w0g);
  await adapter.waitForDeployment();
  const adapterAddr = await adapter.getAddress();
  console.log("  → JaineVenueAdapterV2:", adapterAddr);

  console.log("\n[2/3] Sanity-checking previewRoute() against live pools…");
  const probes = [
    { name: "USDC.e ↔ W0G",  a: dep.realTokens.USDCe, b: w0g },
    { name: "USDC.e ↔ WBTC", a: dep.realTokens.USDCe, b: dep.realTokens.WBTC },
    { name: "USDC.e ↔ WETH", a: dep.realTokens.USDCe, b: dep.realTokens.WETH },
  ];
  for (const p of probes) {
    const [kind, feeA, feeB] = await adapter.previewRoute(p.a, p.b);
    const label = kind == 0n ? "NO ROUTE"
                : kind == 1n ? `direct fee=${feeA}`
                :              `hub via W0G fees=${feeA}/${feeB}`;
    console.log(`  ${p.name.padEnd(16)} → ${label}`);
    if (kind === 0n) {
      throw new Error(`No route found for ${p.name} — refusing to ship adapter that can't route core pairs`);
    }
  }

  // Persist FIRST — adapter is already on-chain, we don't want to lose
  // the address if the optional ownership-transfer step below throws.
  dep.jaineVenueAdapterV2 = adapterAddr;
  dep.jaineVenueAdapterV2DeployedAt = new Date().toISOString();
  dep.jaineVenueAdapterV2Hub = w0g;
  writeDeployments(dep);
  console.log(`\nWrote ${adapterAddr} to ${DEPLOYMENTS_FILE} under jaineVenueAdapterV2.`);

  // Optional ownership transfer. Only runs when EXECUTOR_ADDRESS env var is
  // set AND parses as a valid checksummed address. Skipped silently in the
  // normal case where the executor wallet IS the deployer.
  if (RAW_EXECUTOR) {
    let target;
    try {
      target = hre.ethers.getAddress(RAW_EXECUTOR);
    } catch (err) {
      console.warn(`\n[3/3] WARNING: EXECUTOR_ADDRESS="${RAW_EXECUTOR}" failed checksum parse — keeping deployer as owner. (${err.message})`);
      target = null;
    }
    if (target && target.toLowerCase() !== deployer.address.toLowerCase()) {
      console.log("\n[3/3] Transferring ownership to executor:", target);
      const tx = await adapter.transferOwnership(target);
      await tx.wait();
      console.log("  → ownership transferred (tx:", tx.hash, ")");
    } else if (target) {
      console.log("\n[3/3] Ownership transfer skipped — deployer == EXECUTOR_ADDRESS.");
    }
  } else {
    console.log("\n[3/3] No EXECUTOR_ADDRESS env var — leaving deployer as owner.");
  }

  console.log("\nNext steps:");
  console.log("  1. node scripts/sync-frontend.js deployments-mainnet.json");
  console.log("  2. Update sdk/src/deployments-mainnet.json (or run a sync there)");
  console.log("  3. New vaults created via the factory should pass venue =", adapterAddr);
  console.log("     Existing vaults stay on the V1 adapter — that's expected.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
