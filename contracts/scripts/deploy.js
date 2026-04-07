const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // ── 1. Deploy ExecutionRegistry ──
  console.log("\n--- Deploying ExecutionRegistry ---");
  const ExecutionRegistry = await hre.ethers.getContractFactory("ExecutionRegistry");
  const registry = await ExecutionRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("ExecutionRegistry deployed to:", registryAddr);

  // ── 2. Deploy AegisVaultFactory ──
  console.log("\n--- Deploying AegisVaultFactory ---");
  const Factory = await hre.ethers.getContractFactory("AegisVaultFactory");
  const factory = await Factory.deploy(registryAddr);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("AegisVaultFactory deployed to:", factoryAddr);

  // Transfer registry admin to factory (C-1 fix: factory authorizes vaults)
  await registry.transferAdmin(factoryAddr);
  console.log("Registry admin transferred to factory");

  // ── 3. Deploy MockERC20 (USDC) for testnet ──
  console.log("\n--- Deploying MockERC20 (USDC) ---");
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("MockERC20 (USDC) deployed to:", usdcAddr);

  // ── 4. Deploy mock assets for testing ──
  console.log("\n--- Deploying MockERC20 (WBTC) ---");
  const wbtc = await MockERC20.deploy("Wrapped BTC", "WBTC", 8);
  await wbtc.waitForDeployment();
  const wbtcAddr = await wbtc.getAddress();
  console.log("MockERC20 (WBTC) deployed to:", wbtcAddr);

  console.log("\n--- Deploying MockERC20 (WETH) ---");
  const weth = await MockERC20.deploy("Wrapped ETH", "WETH", 18);
  await weth.waitForDeployment();
  const wethAddr = await weth.getAddress();
  console.log("MockERC20 (WETH) deployed to:", wethAddr);

  // ── 5. Deploy MockDEX ──
  console.log("\n--- Deploying MockDEX ---");
  const MockDEX = await hre.ethers.getContractFactory("MockDEX");
  const dex = await MockDEX.deploy();
  await dex.waitForDeployment();
  const dexAddr = await dex.getAddress();
  console.log("MockDEX deployed to:", dexAddr);

  // Set pair rates: BTC @ $70,000, ETH @ $2,200
  await dex.setPairRate(usdcAddr, wbtcAddr, hre.ethers.parseUnits("0.00001428", 18), 6, 8);
  await dex.setPairRate(usdcAddr, wethAddr, hre.ethers.parseUnits("0.000454", 18), 6, 18);
  console.log("Pair rates set (BTC@$70k, ETH@$2.2k)");

  // ── 6. Mint tokens and add DEX liquidity ──
  console.log("\n--- Minting tokens & adding DEX liquidity ---");
  const mintAmount = hre.ethers.parseUnits("1000000", 6);
  await usdc.mint(deployer.address, mintAmount);
  console.log("Minted 1,000,000 USDC to deployer");

  // DEX liquidity
  await wbtc.mint(deployer.address, hre.ethers.parseUnits("100", 8));
  await weth.mint(deployer.address, hre.ethers.parseUnits("10000", 18));
  await usdc.mint(deployer.address, hre.ethers.parseUnits("500000", 6));

  await wbtc.approve(dexAddr, hre.ethers.parseUnits("100", 8));
  await weth.approve(dexAddr, hre.ethers.parseUnits("10000", 18));
  await usdc.approve(dexAddr, hre.ethers.parseUnits("500000", 6));

  await dex.addLiquidity(wbtcAddr, hre.ethers.parseUnits("50", 8));
  await dex.addLiquidity(wethAddr, hre.ethers.parseUnits("5000", 18));
  await dex.addLiquidity(usdcAddr, hre.ethers.parseUnits("500000", 6));
  console.log("DEX liquidity added: 50 BTC, 5000 ETH, 500k USDC");

  // ── 7. Create a demo vault ──
  console.log("\n--- Creating demo vault ---");
  const defaultPolicy = {
    maxPositionBps: 5000,           // 50%
    maxDailyLossBps: 500,           // 5%
    stopLossBps: 1500,              // 15%
    cooldownSeconds: 60,             // 1 min (shorter for demo)
    confidenceThresholdBps: 6000,   // 60%
    maxActionsPerDay: 20,
    autoExecution: true,
    paused: false,
  };

  const allowedAssets = [usdcAddr, wbtcAddr, wethAddr];

  const tx = await factory.createVault(
    usdcAddr,
    deployer.address, // deployer is also executor for MVP
    dexAddr,          // venue adapter
    defaultPolicy,
    allowedAssets
  );
  const receipt = await tx.wait();

  const vaultAddr = await factory.getVaultAt(0);
  console.log("Demo vault deployed to:", vaultAddr);

  // ── 8. Deposit into vault ──
  console.log("\n--- Depositing USDC into vault ---");
  const depositAmount = hre.ethers.parseUnits("100000", 6);
  await usdc.approve(vaultAddr, depositAmount);
  const vault = await hre.ethers.getContractAt("AegisVault", vaultAddr);
  await vault.deposit(depositAmount);
  console.log("Deposited 100,000 USDC into vault");

  // ── Summary ──
  console.log("\n" + "=".repeat(50));
  console.log("DEPLOYMENT SUMMARY");
  console.log("=".repeat(50));
  console.log("Network:            ", hre.network.name);
  console.log("Deployer:           ", deployer.address);
  console.log("ExecutionRegistry:  ", registryAddr);
  console.log("AegisVaultFactory:  ", factoryAddr);
  console.log("MockUSDC:           ", usdcAddr);
  console.log("MockWBTC:           ", wbtcAddr);
  console.log("MockWETH:           ", wethAddr);
  console.log("MockDEX:            ", dexAddr);
  console.log("Demo Vault:         ", vaultAddr);
  console.log("Vault Balance:       100,000 USDC");
  console.log("DEX Liquidity:       50 BTC, 5000 ETH, 500k USDC");
  console.log("=".repeat(50));

  // Write deployment addresses to file
  const fs = require("fs");
  const deployments = {
    network: hre.network.name,
    deployer: deployer.address,
    executionRegistry: registryAddr,
    aegisVaultFactory: factoryAddr,
    mockUSDC: usdcAddr,
    mockWBTC: wbtcAddr,
    mockWETH: wethAddr,
    mockDEX: dexAddr,
    demoVault: vaultAddr,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(
    "./deployments.json",
    JSON.stringify(deployments, null, 2)
  );
  console.log("\nDeployment addresses saved to deployments.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
