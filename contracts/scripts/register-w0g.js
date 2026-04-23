/**
 * register-w0g.js
 *
 * Post-deploy script that registers W0G with the already-deployed
 * VaultNAVCalculator and JaineVenueAdapter on 0G mainnet.
 *
 * Run after the initial deploy when W0G support was added to the stack.
 * Idempotent: skips registration if asset already exists (best-effort check).
 *
 * Usage:
 *   npx hardhat run scripts/register-w0g.js --network og_mainnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const W0G_ADDRESS  = "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c";
const PYTH_FEED_0G = "0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070";

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "No signer available. Make sure DEPLOYER_PRIVATE_KEY is set in contracts/.env\n" +
      "and that hardhat.config.js loads it (require('dotenv').config() at top)."
    );
  }
  const signer = signers[0];
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== 16661) {
    throw new Error(`Expected 0G mainnet (16661), got chain ${chainId}`);
  }

  console.log("╔════════════════════════════════════════════════╗");
  console.log("║   Register W0G — 0G Mainnet                   ║");
  console.log("╚════════════════════════════════════════════════╝\n");
  console.log("Signer:  ", signer.address);
  console.log("Chain:   ", chainId);
  console.log("W0G:     ", W0G_ADDRESS);
  console.log("Feed:    ", PYTH_FEED_0G);
  console.log("");

  const deploymentsPath = path.join(__dirname, "..", "deployments-mainnet.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  const navCalcAddr = deployments.vaultNAVCalculator;
  const adapterAddr = deployments.jaineVenueAdapter;

  if (!navCalcAddr) throw new Error("vaultNAVCalculator missing in deployments-mainnet.json");
  if (!adapterAddr) throw new Error("jaineVenueAdapter missing in deployments-mainnet.json");

  console.log("Targets:");
  console.log("  VaultNAVCalculator:", navCalcAddr);
  console.log("  JaineVenueAdapter: ", adapterAddr);
  console.log("");

  // ── 1) VaultNAVCalculator.addAsset(W0G, feed0G, 18, false) ──
  console.log("[1/2] Registering W0G with VaultNAVCalculator...");
  const navCalc = await ethers.getContractAt("VaultNAVCalculator", navCalcAddr, signer);

  const navAdmin = await navCalc.admin();
  if (navAdmin.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `NAV admin mismatch. Current admin: ${navAdmin}, signer: ${signer.address}.\n` +
      `If admin has been transferred to governor, submit this tx via governor instead.`
    );
  }

  // Best-effort duplicate guard — iterate assets() and skip if W0G is already there
  let alreadyInNav = false;
  try {
    const count = await navCalc.getAssetCount();
    for (let i = 0; i < Number(count); i++) {
      const a = await navCalc.assets(i);
      if (a.token.toLowerCase() === W0G_ADDRESS.toLowerCase()) {
        alreadyInNav = true;
        break;
      }
    }
  } catch (err) {
    console.log("  (duplicate check failed — proceeding anyway:", err.message, ")");
  }

  if (alreadyInNav) {
    console.log("  ✓ W0G already registered in VaultNAVCalculator — skipping");
  } else {
    const tx1 = await navCalc.addAsset(W0G_ADDRESS, PYTH_FEED_0G, 18, false);
    const rcpt1 = await tx1.wait();
    console.log(`  ✓ addAsset tx: ${rcpt1.hash}`);
  }

  // ── 2) JaineVenueAdapter.registerAsset(W0G, feed0G, 18) ──
  console.log("\n[2/2] Registering W0G with JaineVenueAdapter...");
  const adapter = await ethers.getContractAt("JaineVenueAdapter", adapterAddr, signer);

  const adapterOwner = await adapter.owner();
  if (adapterOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Adapter owner mismatch. Current owner: ${adapterOwner}, signer: ${signer.address}.\n` +
      `If ownership has been transferred, submit this tx via the owner instead.`
    );
  }

  const existingFeed = await adapter.priceFeeds(W0G_ADDRESS);
  if (existingFeed !== ethers.ZeroHash) {
    console.log(`  ✓ W0G already registered in JaineVenueAdapter (feed ${existingFeed}) — skipping`);
  } else {
    const tx2 = await adapter.registerAsset(W0G_ADDRESS, PYTH_FEED_0G, 18);
    const rcpt2 = await tx2.wait();
    console.log(`  ✓ registerAsset tx: ${rcpt2.hash}`);
  }

  // ── 3) Update deployments-mainnet.json with feed0G ──
  if (!deployments.pyth.feed0G) {
    deployments.pyth.feed0G = PYTH_FEED_0G;
    fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
    console.log("\n[3/3] Added feed0G to deployments-mainnet.json");
  } else {
    console.log("\n[3/3] feed0G already in deployments-mainnet.json — skipping write");
  }

  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║   ✓ W0G registration complete                 ║");
  console.log("╚════════════════════════════════════════════════╝");
  console.log("\nNext steps:");
  console.log("  1. Run `npx hardhat run scripts/sync-frontend.js --network og_mainnet` to propagate to frontend");
  console.log("  2. Restart the orchestrator so it picks up the new 0G Pyth feed");
  console.log("  3. Existing vaults will NAV-revalue on next cycle");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
