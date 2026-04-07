/**
 * Continue deployment from where it failed.
 * The first 6 contracts are already deployed. This script:
 * 1. Mints tokens to deployer
 * 2. Adds DEX liquidity (smaller amounts for gas efficiency)
 * 3. Creates demo vault
 * 4. Deposits into vault
 */
const hre = require("hardhat");

// Already deployed addresses from first run
const DEPLOYED = {
  executionRegistry: "0xDF277f39d4869B1a4bb7Fa2D25e58ab32E2af998",
  aegisVaultFactory: "0x2A0CAA1d639060446fA1bA799b6B64810B5B4aff",
  mockUSDC: "0xcb7F4c52f72DA18d27Bc18C4c3f706b6ba361BC1",
  mockWBTC: "0x0d8C28Ad2741cBec172003eee01e7BD97450b5A9",
  mockWETH: "0x339d0484699C0E1232aE0947310a5694B7e0E03A",
  mockDEX: "0x8eeF4E72ec2ff6f9E00a6D2029bEcB8FcB2f03E6",
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Continuing deployment with:", deployer.address);
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(bal), "A0GI");

  const usdc = await hre.ethers.getContractAt("MockERC20", DEPLOYED.mockUSDC);
  const wbtc = await hre.ethers.getContractAt("MockERC20", DEPLOYED.mockWBTC);
  const weth = await hre.ethers.getContractAt("MockERC20", DEPLOYED.mockWETH);
  const dex = await hre.ethers.getContractAt("MockDEX", DEPLOYED.mockDEX);
  const factory = await hre.ethers.getContractAt("AegisVaultFactory", DEPLOYED.aegisVaultFactory);

  // ── Step 1: Mint WBTC + WETH to deployer ──
  console.log("\n--- Minting WBTC ---");
  let tx = await wbtc.mint(deployer.address, hre.ethers.parseUnits("10", 8));
  await tx.wait();
  console.log("Minted 10 WBTC");

  console.log("--- Minting WETH ---");
  tx = await weth.mint(deployer.address, hre.ethers.parseUnits("100", 18));
  await tx.wait();
  console.log("Minted 100 WETH");

  // ── Step 2: Approve DEX ──
  console.log("\n--- Approving DEX ---");
  tx = await wbtc.approve(DEPLOYED.mockDEX, hre.ethers.parseUnits("10", 8));
  await tx.wait();
  tx = await weth.approve(DEPLOYED.mockDEX, hre.ethers.parseUnits("100", 18));
  await tx.wait();
  tx = await usdc.approve(DEPLOYED.mockDEX, hre.ethers.parseUnits("500000", 6));
  await tx.wait();
  console.log("Approvals set");

  // ── Step 3: Add DEX liquidity (smaller for gas) ──
  console.log("\n--- Adding DEX liquidity ---");
  tx = await dex.addLiquidity(DEPLOYED.mockWBTC, hre.ethers.parseUnits("5", 8));
  await tx.wait();
  console.log("Added 5 WBTC liquidity");

  tx = await dex.addLiquidity(DEPLOYED.mockWETH, hre.ethers.parseUnits("50", 18));
  await tx.wait();
  console.log("Added 50 WETH liquidity");

  tx = await dex.addLiquidity(DEPLOYED.mockUSDC, hre.ethers.parseUnits("100000", 6));
  await tx.wait();
  console.log("Added 100,000 USDC liquidity");

  // ── Step 4: Create demo vault ──
  console.log("\n--- Creating demo vault ---");
  const defaultPolicy = {
    maxPositionBps: 5000,
    maxDailyLossBps: 500,
    stopLossBps: 1500,
    cooldownSeconds: 60,
    confidenceThresholdBps: 6000,
    maxActionsPerDay: 20,
    autoExecution: true,
    paused: false,
  };

  const allowedAssets = [DEPLOYED.mockUSDC, DEPLOYED.mockWBTC, DEPLOYED.mockWETH];

  tx = await factory.createVault(
    DEPLOYED.mockUSDC,
    deployer.address,
    DEPLOYED.mockDEX,
    defaultPolicy,
    allowedAssets
  );
  const receipt = await tx.wait();
  const vaultAddr = await factory.getVaultAt(0);
  console.log("Demo vault:", vaultAddr);

  // ── Step 5: Deposit ──
  console.log("\n--- Depositing USDC into vault ---");
  tx = await usdc.approve(vaultAddr, hre.ethers.parseUnits("50000", 6));
  await tx.wait();
  const vault = await hre.ethers.getContractAt("AegisVault", vaultAddr);
  tx = await vault.deposit(hre.ethers.parseUnits("50000", 6));
  await tx.wait();
  console.log("Deposited 50,000 USDC");

  // ── Summary ──
  const finalBal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("\n" + "=".repeat(50));
  console.log("DEPLOYMENT COMPLETE — 0G Galileo Testnet");
  console.log("=".repeat(50));
  console.log("ExecutionRegistry:  ", DEPLOYED.executionRegistry);
  console.log("AegisVaultFactory:  ", DEPLOYED.aegisVaultFactory);
  console.log("MockUSDC:           ", DEPLOYED.mockUSDC);
  console.log("MockWBTC:           ", DEPLOYED.mockWBTC);
  console.log("MockWETH:           ", DEPLOYED.mockWETH);
  console.log("MockDEX:            ", DEPLOYED.mockDEX);
  console.log("Demo Vault:         ", vaultAddr);
  console.log("Gas used:           ", hre.ethers.formatEther(bal - finalBal), "A0GI");
  console.log("Remaining balance:  ", hre.ethers.formatEther(finalBal), "A0GI");
  console.log("=".repeat(50));

  // Write deployments.json
  const fs = require("fs");
  const deployments = {
    network: "og_testnet",
    deployer: deployer.address,
    ...DEPLOYED,
    demoVault: vaultAddr,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync("./deployments.json", JSON.stringify(deployments, null, 2));
  console.log("\nDeployment addresses saved to deployments.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
