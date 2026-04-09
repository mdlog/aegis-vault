/**
 * Deploy Aegis Vault — EXECUTION LAYER on Arbitrum One (chain 42161)
 *
 * Pairs with deploy-0g-verification.js (verification layer on 0G mainnet).
 *
 * Deploys:
 *   - ExecutionRegistry        replay guard + intent history
 *   - AegisVaultFactory        clones AegisVault per user
 *   - UniswapV3VenueAdapter    real DEX execution via Uniswap V3 SwapRouter02
 *   - VaultNAVCalculator       Pyth-priced multi-asset NAV
 *
 * Pre-flight verified addresses (Arbitrum One):
 *   USDC native:        0xaf88d065e77c8cC2239327C5EDb3A432268e5831 (6 decimals)
 *   WETH:               0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 (18 decimals)
 *   WBTC:               0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f (8 decimals)
 *   Uniswap V3 Router:  0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45 (SwapRouter02)
 *   Uniswap V3 Factory: 0x1F98431c8aD98523631AE4a59f267346ea31F984
 *   Pyth Oracle:        0xff1a0f4744e8582DF1aE09D5611b887B6a12925C
 *
 * Pyth feed IDs:
 *   BTC/USD: 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
 *   ETH/USD: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
 *   USDC/USD: 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a
 *
 * Required env:
 *   DEPLOYER_PRIVATE_KEY    funded Arbitrum wallet (>= 0.005 ETH for full deploy)
 *
 * Optional:
 *   TREASURY_ADDRESS_0G     pass the protocol treasury address from 0G layer
 *                           (this layer's vaults credit the same treasury logically;
 *                            on-chain treasury here can also be 0x0 for demo)
 *   CONFIRM_MAINNET=1       safety guard
 *
 * Usage:
 *   CONFIRM_MAINNET=1 \
 *   npx hardhat run scripts/deploy-arbitrum-execution.js --network arbitrum
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ── Pre-verified Arbitrum One canonical addresses ──
const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const ARB_WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const ARB_WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const ARB_UNIV3_ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const ARB_UNIV3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const ARB_PYTH = "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C";

// Pyth feed IDs (same on every chain)
const PYTH_FEED_BTC = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const PYTH_FEED_ETH = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const PYTH_FEED_USDC = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

const EXPECTED_CHAIN_ID = 42161;

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║   AEGIS VAULT — ARBITRUM EXECUTION LAYER             ║");
  console.log("║   Chain: Arbitrum One (42161)                        ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");
  console.log("Deployer:", deployer.address);
  console.log("Balance: ", ethers.formatEther(balance), "ETH");
  console.log("Network: ", network.name, "(chainId:", network.chainId.toString(), ")");
  console.log();

  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error("Wrong network: expected chain " + EXPECTED_CHAIN_ID + ", got " + network.chainId + ". Run with --network arbitrum");
  }
  if (balance < ethers.parseEther("0.003")) {
    throw new Error("Insufficient balance: have " + ethers.formatEther(balance) + " ETH, need >= 0.003 ETH");
  }
  if (process.env.CONFIRM_MAINNET !== "1") {
    throw new Error("Refusing to deploy without CONFIRM_MAINNET=1.");
  }

  // Treasury address — passed from 0G layer or 0x0 (vaults still work without)
  const treasuryAddress = process.env.TREASURY_ADDRESS_0G || ethers.ZeroAddress;
  console.log("Protocol treasury (logical link to 0G):", treasuryAddress);
  console.log();

  console.log("✓ Pre-flight passed. Beginning deployment.\n");

  const deployments = {
    network: "arbitrum_one",
    chainId: EXPECTED_CHAIN_ID,
    layer: "execution",
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    canonical: {
      USDC: ARB_USDC,
      WETH: ARB_WETH,
      WBTC: ARB_WBTC,
      UniV3_Router: ARB_UNIV3_ROUTER,
      UniV3_Factory: ARB_UNIV3_FACTORY,
      Pyth: ARB_PYTH,
    },
    pythFeeds: {
      BTC: PYTH_FEED_BTC,
      ETH: PYTH_FEED_ETH,
      USDC: PYTH_FEED_USDC,
    },
    treasuryLink: treasuryAddress,
  };

  // ─── 1: ExecutionRegistry ───
  console.log("[1/4] ExecutionRegistry...");
  const ExecReg = await ethers.getContractFactory("ExecutionRegistry");
  const execRegistry = await ExecReg.deploy();
  await execRegistry.waitForDeployment();
  deployments.executionRegistry = await execRegistry.getAddress();
  console.log("      →", deployments.executionRegistry);

  // ─── 2: AegisVaultFactory ───
  console.log("[2/4] AegisVaultFactory...");
  const Factory = await ethers.getContractFactory("AegisVaultFactory");
  const factory = await Factory.deploy(deployments.executionRegistry, treasuryAddress);
  await factory.waitForDeployment();
  deployments.aegisVaultFactory = await factory.getAddress();
  console.log("      →", deployments.aegisVaultFactory);

  console.log("      Transferring registry admin to factory...");
  await (await execRegistry.transferAdmin(deployments.aegisVaultFactory)).wait();
  console.log("      ✓");

  // ─── 3: UniswapV3VenueAdapter ───
  console.log("[3/4] UniswapV3VenueAdapter (Uniswap V3 SwapRouter02)...");
  const Adapter = await ethers.getContractFactory("UniswapV3VenueAdapter");
  const adapter = await Adapter.deploy(ARB_UNIV3_ROUTER, ARB_UNIV3_FACTORY);
  await adapter.waitForDeployment();
  deployments.uniswapV3VenueAdapter = await adapter.getAddress();
  console.log("      →", deployments.uniswapV3VenueAdapter);

  // ─── 4: VaultNAVCalculator ───
  console.log("[4/4] VaultNAVCalculator (Pyth)...");
  const NAV = await ethers.getContractFactory("VaultNAVCalculator");
  const nav = await NAV.deploy(ARB_PYTH);
  await nav.waitForDeployment();
  deployments.vaultNAVCalculator = await nav.getAddress();
  console.log("      →", deployments.vaultNAVCalculator);

  // Configure NAV calculator with the assets we care about
  console.log("      Adding USDC asset (stablecoin)...");
  await (await nav.addAsset(ARB_USDC, PYTH_FEED_USDC, 6, true)).wait();
  console.log("      ✓");

  console.log("      Adding WETH asset...");
  await (await nav.addAsset(ARB_WETH, PYTH_FEED_ETH, 18, false)).wait();
  console.log("      ✓");

  console.log("      Adding WBTC asset...");
  await (await nav.addAsset(ARB_WBTC, PYTH_FEED_BTC, 8, false)).wait();
  console.log("      ✓");

  // ─── Persist ───
  deployments.timestamp = new Date().toISOString();
  const outPath = path.resolve(__dirname, "../deployments-arbitrum.json");
  fs.writeFileSync(outPath, JSON.stringify(deployments, null, 2));
  console.log("\nDeployments saved:", outPath);

  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║   ARBITRUM EXECUTION LAYER COMPLETE                  ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");
  Object.entries(deployments).forEach(([k, v]) => {
    if (typeof v === "string" && v.startsWith("0x") && v.length === 42) {
      console.log("  " + k.padEnd(22) + " " + v);
    }
  });
  console.log("\nExplorer: https://arbiscan.io");
  console.log("\nNext steps:");
  console.log("  1. node scripts/sync-frontend.js deployments-arbitrum.json");
  console.log("  2. Create a vault via factory.createVault(USDC, executor, adapter, policy, [USDC, WETH, WBTC])");
  console.log("  3. Deposit + execute swaps via Uniswap V3 — full DeFi flow on a mature chain");
  console.log("  4. Submit operator activity on 0G mainnet to satisfy hackathon requirement");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Deployment failed:", err.message);
    process.exit(1);
  });
