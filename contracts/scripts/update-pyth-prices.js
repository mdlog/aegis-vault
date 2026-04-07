/**
 * Update MockPyth prices to current real market prices via Hermes API.
 * Run periodically or before demos.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/update-pyth-prices.js --network og_testnet
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const D = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../deployments.json"), "utf8"));

  if (!D.mockPyth) {
    console.error("MockPyth not deployed. Run deploy-pyth.js first.");
    process.exit(1);
  }

  console.log("Fetching real prices from Pyth Hermes...");

  // Fetch real prices from Hermes API
  const BTC_FEED = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
  const ETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

  const resp = await fetch(
    `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${BTC_FEED}&ids[]=${ETH_FEED}`
  );
  const data = await resp.json();

  const btcPrice = BigInt(data.parsed[0].price.price);
  const btcConf = BigInt(data.parsed[0].price.conf);
  const btcExpo = data.parsed[0].price.expo;

  const ethPrice = BigInt(data.parsed[1].price.price);
  const ethConf = BigInt(data.parsed[1].price.conf);
  const ethExpo = data.parsed[1].price.expo;

  const btcUsd = Number(btcPrice) * Math.pow(10, btcExpo);
  const ethUsd = Number(ethPrice) * Math.pow(10, ethExpo);

  console.log(`BTC/USD: $${btcUsd.toLocaleString()} (real)`);
  console.log(`ETH/USD: $${ethUsd.toLocaleString()} (real)`);

  // Update MockPyth on-chain
  const mockPyth = await hre.ethers.getContractAt("MockPyth", D.mockPyth);
  const now = Math.floor(Date.now() / 1000);

  const btcUpdate = await mockPyth.createPriceFeedUpdateData(
    BTC_FEED, btcPrice, btcConf, btcExpo, btcPrice, btcConf, now, now - 60
  );
  const ethUpdate = await mockPyth.createPriceFeedUpdateData(
    ETH_FEED, ethPrice, ethConf, ethExpo, ethPrice, ethConf, now, now - 60
  );

  const fee = await mockPyth.getUpdateFee([btcUpdate, ethUpdate]);
  const tx = await mockPyth.updatePriceFeeds([btcUpdate, ethUpdate], { value: fee });
  await tx.wait();

  console.log("MockPyth prices updated on-chain.");

  // Verify NAV
  if (D.navCalculator) {
    const navCalc = await hre.ethers.getContractAt("VaultNAVCalculator", D.navCalculator);
    const [navUsd6, breakdown] = await navCalc.calculateNAV(D.demoVault);
    const navUsd = Number(navUsd6) / 1e6;
    console.log(`\nVault NAV (on-chain): $${navUsd.toLocaleString()}`);
    const labels = ["USDC", "WBTC", "WETH"];
    for (let i = 0; i < breakdown.length; i++) {
      const val = Number(breakdown[i]) / 1e6;
      if (val > 0) console.log(`  ${labels[i]}: $${val.toLocaleString()}`);
    }
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
