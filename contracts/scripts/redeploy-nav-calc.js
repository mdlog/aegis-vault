/**
 * redeploy-nav-calc.js
 *
 * Deploys a fresh VaultNAVCalculator with the current signer as admin.
 * Used when you need to rotate the NAV calculator admin (the contract has
 * no transferAdmin function), typically after key rotation.
 *
 * Registers the same 4 assets as deploy-mainnet.js: USDC.e, WETH, WBTC, W0G.
 * Updates deployments-mainnet.json with the new address.
 *
 * Usage (run WITH the NEW deployer key loaded in .env):
 *   npx hardhat run scripts/redeploy-nav-calc.js --network og_mainnet
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const USDCE_ADDRESS = "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E";
const WETH_ADDRESS  = "0x564770837Ef8bbF077cFe54E5f6106538c815B22";
const WBTC_ADDRESS  = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const W0G_ADDRESS   = "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c";

const PYTH_ADDRESS   = "0x2880ab155794e7179c9ee2e38200202908c17b43";
const PYTH_FEED_BTC  = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const PYTH_FEED_ETH  = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const PYTH_FEED_USDC = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
const PYTH_FEED_0G   = "0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070";

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY in .env.");
  const signer = signers[0];

  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== 16661) {
    throw new Error(`Expected 0G mainnet (16661), got chain ${network.chainId}`);
  }

  console.log("╔════════════════════════════════════════════════╗");
  console.log("║   Redeploy VaultNAVCalculator — 0G Mainnet     ║");
  console.log("╚════════════════════════════════════════════════╝\n");
  console.log("Deployer:", signer.address);
  console.log("");

  const deploymentsPath = path.join(__dirname, "..", "deployments-mainnet.json");
  const d = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const oldNavCalc = d.vaultNAVCalculator;
  console.log("Old NAV calculator:", oldNavCalc);

  // Deploy new NAV calculator
  console.log("\n[1/2] Deploying new VaultNAVCalculator...");
  const NAV = await ethers.getContractFactory("VaultNAVCalculator");
  const navCalc = await NAV.deploy(PYTH_ADDRESS);
  await navCalc.waitForDeployment();
  const navAddr = await navCalc.getAddress();
  console.log(`        → ${navAddr}`);

  // Register assets
  console.log("\n[2/2] Registering assets...");
  console.log("        Adding USDC.e (stablecoin)...");
  await (await navCalc.addAsset(USDCE_ADDRESS, PYTH_FEED_USDC, 6, true)).wait();
  console.log("        ✓");
  console.log("        Adding WETH...");
  await (await navCalc.addAsset(WETH_ADDRESS, PYTH_FEED_ETH, 18, false)).wait();
  console.log("        ✓");
  console.log("        Adding WBTC...");
  await (await navCalc.addAsset(WBTC_ADDRESS, PYTH_FEED_BTC, 8, false)).wait();
  console.log("        ✓");
  console.log("        Adding W0G...");
  await (await navCalc.addAsset(W0G_ADDRESS, PYTH_FEED_0G, 18, false)).wait();
  console.log("        ✓");

  // Update deployments file
  d.vaultNAVCalculator = navAddr;
  fs.writeFileSync(deploymentsPath, JSON.stringify(d, null, 2));
  console.log(`\n✓ Updated deployments-mainnet.json — vaultNAVCalculator = ${navAddr}`);

  console.log("\nNext steps:");
  console.log("  1. npx hardhat run scripts/sync-frontend.js --network og_mainnet");
  console.log("  2. Rebuild + redeploy frontend");
  console.log("  3. Restart orchestrator (picks up new NAV addr from deployments file)");
  console.log(`  4. Old NAV calculator (${oldNavCalc}) can be ignored — it has no references now.`);
}

main().catch((err) => {
  console.error("\n✗ Redeploy failed:", err.shortMessage || err.message);
  process.exit(1);
});
