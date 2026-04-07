/**
 * Deploy MockPyth + VaultNAVCalculator and configure asset feeds.
 * Run after initial contracts are deployed.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-pyth.js --network og_testnet
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying Pyth oracle with:", deployer.address);

  // Load existing deployments
  const deploymentsPath = path.resolve(__dirname, "../deployments.json");
  const D = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));

  // ── 1. Deploy MockPyth ──
  console.log("\n--- Deploying MockPyth ---");
  const MockPyth = await hre.ethers.getContractFactory("MockPyth");
  const mockPyth = await MockPyth.deploy(300, 1); // 300s validity, 1 wei fee
  await mockPyth.waitForDeployment();
  const pythAddr = await mockPyth.getAddress();
  console.log("MockPyth deployed to:", pythAddr);

  // ── 2. Set mock prices ──
  console.log("\n--- Setting mock prices ---");
  const BTC_FEED = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
  const ETH_FEED = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
  const now = Math.floor(Date.now() / 1000);

  // BTC @ $70,000 (price=7000000000000, expo=-8)
  const btcUpdate = await mockPyth.createPriceFeedUpdateData(
    BTC_FEED,
    7000000000000n,   // $70,000.00
    100000000n,        // conf
    -8,                // expo
    7000000000000n,   // ema price
    100000000n,        // ema conf
    now,               // publishTime
    now - 60           // prevPublishTime
  );

  // ETH @ $2,200 (price=220000000000, expo=-8)
  const ethUpdate = await mockPyth.createPriceFeedUpdateData(
    ETH_FEED,
    220000000000n,    // $2,200.00
    50000000n,         // conf
    -8,                // expo
    220000000000n,    // ema price
    50000000n,         // ema conf
    now,               // publishTime
    now - 60           // prevPublishTime
  );

  const fee = await mockPyth.getUpdateFee([btcUpdate, ethUpdate]);
  let tx = await mockPyth.updatePriceFeeds([btcUpdate, ethUpdate], { value: fee });
  await tx.wait();
  console.log("Prices set: BTC=$70,000 ETH=$2,200");

  // ── 3. Deploy VaultNAVCalculator ──
  console.log("\n--- Deploying VaultNAVCalculator ---");
  const NAVCalc = await hre.ethers.getContractFactory("VaultNAVCalculator");
  const navCalc = await NAVCalc.deploy(pythAddr);
  await navCalc.waitForDeployment();
  const navCalcAddr = await navCalc.getAddress();
  console.log("VaultNAVCalculator deployed to:", navCalcAddr);

  // ── 4. Configure assets ──
  console.log("\n--- Configuring assets ---");
  // USDC (stablecoin — skip oracle)
  tx = await navCalc.addAsset(D.mockUSDC, "0x" + "0".repeat(64), 6, true);
  await tx.wait();
  console.log("Added USDC (stablecoin)");

  // WBTC
  tx = await navCalc.addAsset(D.mockWBTC, BTC_FEED, 8, false);
  await tx.wait();
  console.log("Added WBTC (BTC/USD feed)");

  // WETH
  tx = await navCalc.addAsset(D.mockWETH, ETH_FEED, 18, false);
  await tx.wait();
  console.log("Added WETH (ETH/USD feed)");

  // ── 5. Test NAV calculation ──
  console.log("\n--- Testing NAV calculation ---");
  const [navUsd6, breakdown] = await navCalc.calculateNAV(D.demoVault);
  const navUsd = Number(navUsd6) / 1e6;
  console.log(`Vault NAV: $${navUsd.toLocaleString()}`);
  const labels = ["USDC", "WBTC", "WETH"];
  for (let i = 0; i < breakdown.length; i++) {
    const val = Number(breakdown[i]) / 1e6;
    if (val > 0) console.log(`  ${labels[i]}: $${val.toLocaleString()}`);
  }

  // ── 6. Update deployments.json ──
  D.mockPyth = pythAddr;
  D.navCalculator = navCalcAddr;
  fs.writeFileSync(deploymentsPath, JSON.stringify(D, null, 2));
  console.log("\n" + "=".repeat(50));
  console.log("PYTH ORACLE DEPLOYMENT COMPLETE");
  console.log("=".repeat(50));
  console.log("MockPyth:          ", pythAddr);
  console.log("VaultNAVCalculator:", navCalcAddr);
  console.log("Vault NAV:          $" + navUsd.toLocaleString());
  console.log("=".repeat(50));
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
