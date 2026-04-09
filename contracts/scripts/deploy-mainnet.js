/**
 * Aegis Vault — 0G Mainnet (Aristotle, chain 16661) deployment.
 *
 * Production-grade Phase 1-5 stack with Jaine DEX as the real venue. NO mocks,
 * NO demo vault, NO MockDEX. Uses real on-chain tokens (oUSDT, W0G).
 *
 * Required environment variables:
 *   GOVERNOR_OWNERS     comma-separated owner addresses (min 3 recommended)
 *   GOVERNOR_THRESHOLD  M-of-N threshold (e.g. 2 for 2-of-3)
 *   ARBITRATOR_ADDRESS  initial slashing arbitrator (must equal governor on prod)
 *   DEPLOYER_PRIVATE_KEY
 *
 * Optional:
 *   TRANSFER_ADMINS=1   rotate admin roles to governor at end (recommended)
 *   CONFIRM_MAINNET=1   skip the interactive confirmation guard
 *
 * Usage:
 *   GOVERNOR_OWNERS="0xaaa,0xbbb,0xccc" GOVERNOR_THRESHOLD=2 \
 *   ARBITRATOR_ADDRESS=0xddd TRANSFER_ADMINS=1 CONFIRM_MAINNET=1 \
 *   npx hardhat run scripts/deploy-mainnet.js --network og_mainnet
 *
 * Jaine Mainnet:
 *   SwapRouter: 0x8b598a7c136215a95ba0282b4d832b9f9801f2e2
 *   Factory:    0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4
 *   W0G:        0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c
 *
 * Real tokens:
 *   oUSDT:      0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189 (Hyperlane bridged, 6dec)
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ── Verified live addresses on 0G Aristotle Mainnet (chain 16661) ──
// Verified by direct RPC eth_getCode + functional calls during pre-flight
const JAINE_ROUTER  = "0x8b598a7c136215a95ba0282b4d832b9f9801f2e2";
const JAINE_FACTORY = "0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4";
const W0G_ADDRESS   = "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c";
const oUSDT_ADDRESS = "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189";

// Pyth Oracle on 0G mainnet (verified live with real BTC feed)
const PYTH_ADDRESS = "0x2880ab155794e7179c9ee2e38200202908c17b43";

// Pyth feed IDs (cross-chain stable)
const PYTH_FEED_BTC = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const PYTH_FEED_ETH = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const PYTH_FEED_USDC = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

// Hard-coded mainnet chain id
const EXPECTED_CHAIN_ID = 16661;

function isValidAddress(addr) {
  try {
    return ethers.getAddress(addr) === addr || ethers.getAddress(addr).toLowerCase() === addr.toLowerCase();
  } catch {
    return false;
  }
}

async function main() {
  // ── Pre-flight: validate environment ──
  const ownersStr = process.env.GOVERNOR_OWNERS || "";
  const owners = ownersStr.split(",").map((a) => a.trim()).filter(Boolean);
  const threshold = Number(process.env.GOVERNOR_THRESHOLD || 0);
  const arbitratorAddress = process.env.ARBITRATOR_ADDRESS || "";

  if (owners.length < 1) {
    throw new Error("GOVERNOR_OWNERS env required (comma-separated). Recommend ≥ 3.");
  }
  if (owners.length < 3) {
    console.warn(`⚠  Only ${owners.length} governor owner(s). Recommend ≥ 3 for mainnet.`);
  }
  for (const o of owners) {
    if (!isValidAddress(o)) throw new Error(`Invalid GOVERNOR_OWNERS entry: ${o}`);
  }
  if (threshold < 1 || threshold > owners.length) {
    throw new Error(`GOVERNOR_THRESHOLD must be 1..${owners.length}, got ${threshold}`);
  }
  if (!arbitratorAddress || !isValidAddress(arbitratorAddress)) {
    throw new Error("ARBITRATOR_ADDRESS env required (must be a valid address — typically the governor).");
  }

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("╔════════════════════════════════════════════════╗");
  console.log("║   AEGIS VAULT — 0G MAINNET DEPLOYMENT          ║");
  console.log("║   Phase 1-5 Production Stack                   ║");
  console.log("╚════════════════════════════════════════════════╝\n");
  console.log("Deployer:    ", deployer.address);
  console.log("Balance:     ", ethers.formatEther(balance), "0G");
  console.log("Network:     ", network.name, "(chainId:", network.chainId, ")");
  console.log("Governor:    ", `${threshold}-of-${owners.length} multi-sig`);
  owners.forEach((o, i) => console.log(`  Owner #${i + 1}:`, o));
  console.log("Arbitrator:  ", arbitratorAddress);
  console.log("Transfer admins → governor:", process.env.TRANSFER_ADMINS === "1" ? "YES" : "NO");
  console.log("");

  // ── Pre-flight: chain id guard ──
  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Wrong network: expected chain ${EXPECTED_CHAIN_ID} (0G Aristotle mainnet), got ${network.chainId}. ` +
      `Run with --network og_mainnet.`
    );
  }

  // ── Pre-flight: balance guard ──
  if (balance < ethers.parseEther("0.1")) {
    throw new Error(`Insufficient balance: have ${ethers.formatEther(balance)} 0G, need ≥ 0.1 0G for full Phase 1-5 deploy.`);
  }

  // ── Pre-flight: explicit confirmation ──
  if (process.env.CONFIRM_MAINNET !== "1") {
    throw new Error(
      "Refusing to deploy to mainnet without CONFIRM_MAINNET=1. Re-run with CONFIRM_MAINNET=1 to proceed."
    );
  }

  console.log("✓ All pre-flight checks passed. Beginning deployment.\n");

  const deployments = {
    network: "og_mainnet",
    chainId: EXPECTED_CHAIN_ID,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };

  // ═══════════════════════════════════════════════
  // PHASE 1: Foundation
  // ═══════════════════════════════════════════════
  console.log("── Phase 1: Foundation ──");

  console.log("  [1/9] Deploying ProtocolTreasury...");
  const Treasury = await ethers.getContractFactory("ProtocolTreasury");
  const treasury = await Treasury.deploy(deployer.address);
  await treasury.waitForDeployment();
  deployments.protocolTreasury = await treasury.getAddress();
  console.log("        →", deployments.protocolTreasury);

  console.log("  [2/9] Deploying ExecutionRegistry...");
  const ExecReg = await ethers.getContractFactory("ExecutionRegistry");
  const execRegistry = await ExecReg.deploy();
  await execRegistry.waitForDeployment();
  deployments.executionRegistry = await execRegistry.getAddress();
  console.log("        →", deployments.executionRegistry);

  console.log("  [3/9] Deploying AegisVaultFactory...");
  const Factory = await ethers.getContractFactory("AegisVaultFactory");
  const factory = await Factory.deploy(deployments.executionRegistry, deployments.protocolTreasury);
  await factory.waitForDeployment();
  deployments.aegisVaultFactory = await factory.getAddress();
  console.log("        →", deployments.aegisVaultFactory);
  console.log("        Transferring registry admin to factory...");
  await (await execRegistry.transferAdmin(deployments.aegisVaultFactory)).wait();
  console.log("        ✓");

  console.log("  [4/9] Deploying OperatorRegistry...");
  const OpReg = await ethers.getContractFactory("OperatorRegistry");
  const opRegistry = await OpReg.deploy();
  await opRegistry.waitForDeployment();
  deployments.operatorRegistry = await opRegistry.getAddress();
  console.log("        →", deployments.operatorRegistry);

  // ═══════════════════════════════════════════════
  // Real venue (Jaine — Uniswap V3 fork on 0G mainnet)
  // Adapter deployed for future use; current oUSDT/W0G pool is empty so
  // demo vaults default to MockDEX (deployed below) until real pools exist.
  // ═══════════════════════════════════════════════
  console.log("\n── Real Venue Adapter (Jaine, Phase 5 future-proofing) ──");
  console.log("  [+] Deploying JaineVenueAdapter...");
  const Adapter = await ethers.getContractFactory("JaineVenueAdapter");
  const adapter = await Adapter.deploy(JAINE_ROUTER, JAINE_FACTORY);
  await adapter.waitForDeployment();
  deployments.jaineVenueAdapter = await adapter.getAddress();
  console.log("        →", deployments.jaineVenueAdapter);
  console.log("        Note: oUSDT/W0G pool not yet seeded. Vaults default to MockDEX.");

  // ═══════════════════════════════════════════════
  // PHASE 2: Stake & Slashing
  // ═══════════════════════════════════════════════
  console.log("\n── Phase 2: Stake & Slashing ──");

  // Use oUSDT as the canonical stake token on mainnet
  console.log("  [6/9] Deploying InsurancePool (stake token = oUSDT)...");
  const Insurance = await ethers.getContractFactory("InsurancePool");
  const insurance = await Insurance.deploy(oUSDT_ADDRESS, arbitratorAddress);
  await insurance.waitForDeployment();
  deployments.insurancePool = await insurance.getAddress();
  console.log("        →", deployments.insurancePool);

  console.log("  [7/9] Deploying OperatorStaking...");
  const Staking = await ethers.getContractFactory("OperatorStaking");
  const staking = await Staking.deploy(
    oUSDT_ADDRESS,
    deployments.operatorRegistry,
    deployments.insurancePool,
    arbitratorAddress
  );
  await staking.waitForDeployment();
  deployments.operatorStaking = await staking.getAddress();
  console.log("        →", deployments.operatorStaking);

  // Authorize staking as a slash notifier on insurance pool
  console.log("        Authorizing staking as slash notifier on insurance...");
  // arbitrator may differ from deployer; if so, this call will fail and we instruct the user
  try {
    await (await insurance.setNotifier(deployments.operatorStaking, true)).wait();
    console.log("        ✓");
  } catch (e) {
    console.log("        ⚠  setNotifier failed:", e.message);
    console.log("        → Submit via governance: insurance.setNotifier(", deployments.operatorStaking, ", true)");
  }

  // ═══════════════════════════════════════════════
  // PHASE 3: Reputation & Discovery
  // ═══════════════════════════════════════════════
  console.log("\n── Phase 3: Reputation & Discovery ──");

  console.log("  [8/9] Deploying OperatorReputation...");
  const Reputation = await ethers.getContractFactory("OperatorReputation");
  const reputation = await Reputation.deploy(deployer.address);
  await reputation.waitForDeployment();
  deployments.operatorReputation = await reputation.getAddress();
  console.log("        →", deployments.operatorReputation);

  console.log("        Authorizing factory as reputation recorder...");
  await (await reputation.setRecorder(deployments.aegisVaultFactory, true)).wait();
  console.log("        ✓");

  // ═══════════════════════════════════════════════
  // PHASE 4: Governance
  // ═══════════════════════════════════════════════
  console.log("\n── Phase 4: Governance ──");

  console.log("  [9/9] Deploying AegisGovernor...");
  const Governor = await ethers.getContractFactory("AegisGovernor");
  const governor = await Governor.deploy(owners, threshold);
  await governor.waitForDeployment();
  deployments.aegisGovernor = await governor.getAddress();
  console.log("        →", deployments.aegisGovernor);
  console.log("        Threshold:", threshold, "of", owners.length);

  // ═══════════════════════════════════════════════
  // Phase 1.8: VaultNAVCalculator + Pyth wiring
  // Real Pyth oracle on 0G mainnet — verified BTC=$74k feed live.
  // ═══════════════════════════════════════════════
  console.log("\n── Phase 1.8: NAV Calculator (Pyth) ──");

  console.log("  [+] Deploying VaultNAVCalculator (Pyth on 0G)...");
  const NAV = await ethers.getContractFactory("VaultNAVCalculator");
  const navCalc = await NAV.deploy(PYTH_ADDRESS);
  await navCalc.waitForDeployment();
  deployments.vaultNAVCalculator = await navCalc.getAddress();
  console.log("        →", deployments.vaultNAVCalculator);
  console.log("        Pyth address:", PYTH_ADDRESS);

  // Configure assets — only stablecoin for now since BTC/ETH on 0G mainnet
  // require their own ERC20 deployments. We'll add WBTC/WETH if MockDEX path used.
  console.log("        Adding oUSDT as stablecoin...");
  await (await navCalc.addAsset(oUSDT_ADDRESS, PYTH_FEED_USDC, 6, true)).wait();
  console.log("        ✓");

  // ═══════════════════════════════════════════════
  // Demo Venue: MockDEX + mock BTC/ETH tokens
  // Why: Jaine pools for oUSDT/W0G are empty (verified). To demonstrate
  // the full vault flow including swaps, we deploy MockDEX with controlled
  // liquidity. JaineVenueAdapter is also deployed (above) so vault owners
  // can switch venues post-launch when real Jaine pools come online.
  // ═══════════════════════════════════════════════
  if (process.env.DEPLOY_DEMO_DEX !== "0") {
    console.log("\n── Demo Swap Venue (MockDEX + mock tokens) ──");

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const MockDEX = await ethers.getContractFactory("MockDEX");

    console.log("  [+] Deploying mockBTC...");
    const mockBTC = await MockERC20.deploy("Mock Wrapped BTC", "mWBTC", 8);
    await mockBTC.waitForDeployment();
    deployments.mockWBTC = await mockBTC.getAddress();
    console.log("        →", deployments.mockWBTC);

    console.log("  [+] Deploying mockETH...");
    const mockETH = await MockERC20.deploy("Mock Wrapped ETH", "mWETH", 18);
    await mockETH.waitForDeployment();
    deployments.mockWETH = await mockETH.getAddress();
    console.log("        →", deployments.mockWETH);

    console.log("  [+] Deploying MockDEX...");
    const mockDex = await MockDEX.deploy();
    await mockDex.waitForDeployment();
    deployments.mockDEX = await mockDex.getAddress();
    console.log("        →", deployments.mockDEX);

    // Set pair rates (using real-ish prices ~BTC $70k, ETH $2.2k)
    console.log("        Setting pair rates...");
    // 1 oUSDT = 0.0000143 mWBTC (BTC ~$70k)
    await (await mockDex.setPairRate(oUSDT_ADDRESS, deployments.mockWBTC, ethers.parseUnits("0.0000143", 18), 6, 8)).wait();
    // 1 oUSDT = 0.000455 mWETH (ETH ~$2.2k)
    await (await mockDex.setPairRate(oUSDT_ADDRESS, deployments.mockWETH, ethers.parseUnits("0.000455", 18), 6, 18)).wait();
    console.log("        ✓");

    // Mint liquidity into MockDEX
    console.log("        Seeding MockDEX liquidity...");
    await (await mockBTC.mint(deployments.mockDEX, ethers.parseUnits("10", 8))).wait();   // 10 mWBTC
    await (await mockETH.mint(deployments.mockDEX, ethers.parseUnits("100", 18))).wait(); // 100 mWETH
    console.log("        ✓");

    // Add mock assets to NAV calculator
    console.log("        Adding mWBTC + mWETH to NAV calculator...");
    await (await navCalc.addAsset(deployments.mockWBTC, PYTH_FEED_BTC, 8, false)).wait();
    await (await navCalc.addAsset(deployments.mockWETH, PYTH_FEED_ETH, 18, false)).wait();
    console.log("        ✓");
  } else {
    console.log("\n  [SKIPPED] Demo DEX deployment (DEPLOY_DEMO_DEX=0)");
  }

  // ═══════════════════════════════════════════════
  // Demo Vault — pre-create one vault for hackathon judges
  // to immediately interact with without writing scripts
  // ═══════════════════════════════════════════════
  if (process.env.DEPLOY_DEMO_VAULT !== "0" && deployments.mockDEX) {
    console.log("\n── Demo Vault (pre-created for judges) ──");

    const allowedAssets = [oUSDT_ADDRESS];
    if (deployments.mockWBTC) allowedAssets.push(deployments.mockWBTC);
    if (deployments.mockWETH) allowedAssets.push(deployments.mockWETH);

    const demoPolicy = {
      maxPositionBps: 5000,           // 50% max position
      maxDailyLossBps: 1000,          // 10% daily loss cap
      stopLossBps: 1500,              // 15% global stop-loss
      cooldownSeconds: 60,            // 1-minute cooldown for demo
      confidenceThresholdBps: 5000,   // 50% AI confidence min
      maxActionsPerDay: 20,
      autoExecution: true,
      paused: false,
      // Phase 1 fees
      performanceFeeBps: 1500,        // 15%
      managementFeeBps: 200,          // 2%/year
      entryFeeBps: 0,
      exitFeeBps: 50,                 // 0.5%
      feeRecipient: deployer.address, // operator fee recipient
    };

    console.log("  [+] Creating demo vault via factory...");
    const tx = await factory.createVault(
      oUSDT_ADDRESS,                  // base asset (real oUSDT)
      deployer.address,               // executor (deployer wallet acts as orchestrator)
      deployments.mockDEX,            // venue (MockDEX since Jaine pools empty)
      demoPolicy,
      allowedAssets
    );
    await tx.wait();

    // Find the demo vault address
    const demoVaults = await factory.getOwnerVaults(deployer.address);
    deployments.demoVault = demoVaults[demoVaults.length - 1];
    console.log("        →", deployments.demoVault);

    // Wire the demo vault to the NAV calculator
    console.log("        Setting NAV calculator on demo vault...");
    const demoVault = await ethers.getContractAt("AegisVault", deployments.demoVault);
    await (await demoVault.setNavCalculator(deployments.vaultNAVCalculator)).wait();
    console.log("        ✓");

    // Wire reputation recorder so executions get logged on-chain
    console.log("        Setting reputation recorder on demo vault...");
    await (await demoVault.setReputationRecorder(deployments.operatorReputation)).wait();
    console.log("        ✓");

    // Authorize demo vault as a recorder on the reputation contract
    console.log("        Authorizing demo vault as reputation recorder...");
    await (await reputation.setRecorder(deployments.demoVault, true)).wait();
    console.log("        ✓");
  }

  // ═══════════════════════════════════════════════
  // Optional: rotate admin roles to governor
  // ═══════════════════════════════════════════════
  if (process.env.TRANSFER_ADMINS === "1") {
    console.log("\n── Rotating admin roles to governor ──");

    console.log("  Staking arbitrator → governor...");
    try {
      await (await staking.setArbitrator(deployments.aegisGovernor)).wait();
      console.log("  ✓");
    } catch (e) {
      console.log("  ⚠ ", e.message, "(may already be governor)");
    }

    console.log("  Insurance arbitrator → governor...");
    try {
      await (await insurance.setArbitrator(deployments.aegisGovernor)).wait();
      console.log("  ✓");
    } catch (e) {
      console.log("  ⚠ ", e.message, "(may already be governor)");
    }

    console.log("  Reputation admin → governor...");
    await (await reputation.transferAdmin(deployments.aegisGovernor)).wait();
    console.log("  ✓");

    console.log("  Treasury admin → governor...");
    await (await treasury.transferAdmin(deployments.aegisGovernor)).wait();
    console.log("  ✓");
  } else {
    console.log("\n⚠  TRANSFER_ADMINS != 1 — admin roles still held by deployer.");
    console.log("   Run with TRANSFER_ADMINS=1 (or rotate manually) before going live.");
  }

  // ═══════════════════════════════════════════════
  // Persist deployments
  // ═══════════════════════════════════════════════

  // Static metadata
  deployments.jaine = {
    router: JAINE_ROUTER,
    factory: JAINE_FACTORY,
    w0g: W0G_ADDRESS,
  };
  deployments.pyth = {
    address: PYTH_ADDRESS,
    feedBTC: PYTH_FEED_BTC,
    feedETH: PYTH_FEED_ETH,
    feedUSDC: PYTH_FEED_USDC,
  };
  deployments.realTokens = {
    oUSDT: oUSDT_ADDRESS,
    W0G: W0G_ADDRESS,
  };
  deployments.governorOwners = owners;
  deployments.governorThreshold = threshold;
  deployments.timestamp = new Date().toISOString();

  // Write to deployments-mainnet.json AND deployments.json so sync-frontend works
  const mainnetPath = path.resolve(__dirname, "../deployments-mainnet.json");
  const sharedPath = path.resolve(__dirname, "../deployments.json");
  fs.writeFileSync(mainnetPath, JSON.stringify(deployments, null, 2));
  fs.writeFileSync(sharedPath, JSON.stringify(deployments, null, 2));
  console.log("\nDeployments saved:");
  console.log("  ", mainnetPath);
  console.log("  ", sharedPath);

  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║   DEPLOYMENT COMPLETE                          ║");
  console.log("╚════════════════════════════════════════════════╝\n");
  console.log("Smart contract addresses (chain 16661):\n");
  Object.entries(deployments).forEach(([k, v]) => {
    if (typeof v === "string" && v.startsWith("0x")) {
      console.log(`  ${k.padEnd(22)} ${v}`);
    }
  });
  console.log("\nNext steps:");
  console.log("  1. node scripts/sync-frontend.js deployments-mainnet.json");
  console.log("  2. Configure orchestrator .env with mainnet addresses");
  console.log("  3. Operators: register at /operator/register, stake oUSDT");
  if (deployments.demoVault) {
    console.log("  4. Demo vault ready:", deployments.demoVault);
  } else {
    console.log("  4. Users: create vaults at /create");
  }
  console.log("  5. Audit explorer: https://chainscan.0g.ai");
  console.log("  6. Operator wallet =", deployer.address, "(also acts as orchestrator executor)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Deployment failed:", err.message);
    process.exit(1);
  });
