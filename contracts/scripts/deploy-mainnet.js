/**
 * Aegis Vault — 0G Mainnet (Aristotle, chain 16661) deployment.
 *
 * Production-grade Phase 1-5 stack with Jaine DEX as the real venue. Uses real
 * on-chain canonical tokens (USDC.e, WETH, WBTC, W0G) — the same tokens Jaine
 * pools are actually seeded with. NO MockDEX, NO mock tokens, NO demo vault.
 *
 * Verified real tokens on 0G mainnet (addresses derived from Jaine pool swap
 * events at block #31141171):
 *   USDC.e:  0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E (6 decimals)
 *   WETH:    0x564770837Ef8bbF077cFe54E5f6106538c815B22 (18 decimals)
 *   WBTC:    0x0555E30da8f98308EdB960aa94C0Db47230d2B9c (8 decimals)
 *   W0G:     0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c (18 decimals)
 *
 * Known active Jaine pools (live TVL as of 2026-04-21):
 *   USDC.e/W0G  0.3% fee   ~$360K TVL
 *   USDC.e/W0G  1%   fee   ~$360K TVL
 *   WETH/W0G    0.3% fee   ~$278K TVL
 *   WBTC/W0G    0.3% fee   ~$189K TVL
 *   USDC.e/WETH 0.3% fee   ~$3K   TVL
 *   plus st0G / cbBTC / PAI pools
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
 * Jaine canonical infra:
 *   SwapRouter: 0x8b598a7c136215a95ba0282b4d832b9f9801f2e2
 *   Factory:    0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ── Verified live addresses on 0G Aristotle Mainnet (chain 16661) ──
// Verified by direct RPC eth_getCode + Jaine pool swap event probing
const JAINE_ROUTER  = "0x8b598a7c136215a95ba0282b4d832b9f9801f2e2";
const JAINE_FACTORY = "0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4";
const W0G_ADDRESS   = "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c";

// Real Jaine-pair tokens (swap events confirm these are used in live pools)
const USDCE_ADDRESS = "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E"; // bridged Circle USDC
const WETH_ADDRESS  = "0x564770837Ef8bbF077cFe54E5f6106538c815B22";
const WBTC_ADDRESS  = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

// Pyth Oracle on 0G mainnet (verified live with real BTC feed)
const PYTH_ADDRESS = "0x2880ab155794e7179c9ee2e38200202908c17b43";

// Pyth feed IDs (cross-chain stable)
const PYTH_FEED_BTC = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const PYTH_FEED_ETH = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const PYTH_FEED_USDC = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
const PYTH_FEED_0G   = "0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070";

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
  const chainId = Number(network.chainId);
  const isTestnet = chainId === 16602;
  if (chainId !== EXPECTED_CHAIN_ID && !isTestnet) {
    throw new Error(
      `Wrong network: expected chain ${EXPECTED_CHAIN_ID} (0G mainnet) or 16602 (testnet), got ${chainId}. ` +
      `Run with --network og_mainnet or --network og_testnet.`
    );
  }
  if (isTestnet) {
    console.log("⚠  TESTNET MODE (chain 16602) — for Track 2 demo\n");
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

  // Slim build: deploy 3 small external libraries, then link the slim vault
  console.log("  [3a/9] Deploying SealedLib (TEE attestation)...");
  const SealedLib = await ethers.getContractFactory("SealedLib");
  const sealedLib = await SealedLib.deploy();
  await sealedLib.waitForDeployment();
  deployments.sealedLibrary = await sealedLib.getAddress();
  console.log("        →", deployments.sealedLibrary);

  console.log("  [3b/9] Deploying ExecLib (run pipeline + swap)...");
  const ExecLib = await ethers.getContractFactory("ExecLib");
  const execLib = await ExecLib.deploy();
  await execLib.waitForDeployment();
  deployments.execLibrary = await execLib.getAddress();
  console.log("        →", deployments.execLibrary);

  console.log("  [3c/9] Deploying IOLib (deposit/withdraw)...");
  const IOLib = await ethers.getContractFactory("IOLib");
  const ioLib = await IOLib.deploy();
  await ioLib.waitForDeployment();
  deployments.ioLibrary = await ioLib.getAddress();
  console.log("        →", deployments.ioLibrary);

  console.log("  [3d/9] Deploying AegisVault implementation (linked clone template)...");
  const VaultImpl = await ethers.getContractFactory("AegisVault", {
    libraries: {
      SealedLib: deployments.sealedLibrary,
      ExecLib: deployments.execLibrary,
      IOLib: deployments.ioLibrary,
    },
  });
  const vaultImpl = await VaultImpl.deploy();
  await vaultImpl.waitForDeployment();
  deployments.aegisVaultImplementation = await vaultImpl.getAddress();
  console.log("        →", deployments.aegisVaultImplementation);

  console.log("  [3b/9] Deploying AegisVaultFactory (EIP-1167 clone factory)...");
  const Factory = await ethers.getContractFactory("AegisVaultFactory");
  const factory = await Factory.deploy(
    deployments.aegisVaultImplementation,
    deployments.executionRegistry,
    deployments.protocolTreasury
  );
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
  // Real venue (Jaine — Uniswap V3 fork on 0G mainnet).
  // Pools verified live via swap-event scan: USDC.e/W0G (~$360K TVL),
  // WETH/W0G (~$278K TVL), WBTC/W0G (~$189K TVL), USDC.e/cbBTC, USDC.e/WETH.
  // Vaults on 0G route through this adapter against those real pools — no
  // MockDEX fallback in this build.
  // ═══════════════════════════════════════════════
  console.log("\n── Real Venue Adapter (Jaine) ──");
  console.log("  [+] Deploying JaineVenueAdapter...");
  const Adapter = await ethers.getContractFactory("JaineVenueAdapter");
  const adapter = await Adapter.deploy(JAINE_ROUTER, JAINE_FACTORY);
  await adapter.waitForDeployment();
  deployments.jaineVenueAdapter = await adapter.getAddress();
  console.log("        →", deployments.jaineVenueAdapter);
  console.log("        Active pools (USDC.e/W0G, WETH/W0G, WBTC/W0G) via factory", JAINE_FACTORY);

  // Oracle guard — reject AI-supplied minAmountOut that deviates > maxSlippageBps
  // from fair market price (Pyth). Only enforced for registered tokens; swaps
  // involving unregistered assets (e.g. W0G, which has no Pyth feed on 0G) skip
  // the check and fall back to the router's own slippage enforcement.
  console.log("        Wiring oracle guard (Pyth at", PYTH_ADDRESS + ")...");
  await (await adapter.setPyth(PYTH_ADDRESS)).wait();
  await (await adapter.setMaxSlippageBps(500)).wait(); // 5% — allow for Pyth update lag on crypto pairs
  await (await adapter.registerAsset(USDCE_ADDRESS, PYTH_FEED_USDC, 6)).wait();
  await (await adapter.registerAsset(WETH_ADDRESS,  PYTH_FEED_ETH,  18)).wait();
  await (await adapter.registerAsset(WBTC_ADDRESS,  PYTH_FEED_BTC,  8)).wait();
  await (await adapter.registerAsset(W0G_ADDRESS,   PYTH_FEED_0G,   18)).wait();
  console.log("        ✓ guard armed for USDC.e / WETH / WBTC / W0G (maxSlippage 5%)");

  // ═══════════════════════════════════════════════
  // PHASE 2: Stake & Slashing
  // ═══════════════════════════════════════════════
  console.log("\n── Phase 2: Stake & Slashing ──");

  // USDC.e is the canonical Jaine-pair stablecoin — operators stake in USDC.e
  // so the stake denomination matches the vault base-asset denomination.
  console.log("  [6/9] Deploying InsurancePool (stake token = USDC.e)...");
  const Insurance = await ethers.getContractFactory("InsurancePool");
  const insurance = await Insurance.deploy(USDCE_ADDRESS, arbitratorAddress);
  await insurance.waitForDeployment();
  deployments.insurancePool = await insurance.getAddress();
  console.log("        →", deployments.insurancePool);

  console.log("  [7/9] Deploying OperatorStaking (stake token = USDC.e)...");
  const Staking = await ethers.getContractFactory("OperatorStaking");
  const staking = await Staking.deploy(
    USDCE_ADDRESS,
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

  // Configure NAV calculator with the real Jaine-pair tokens. These are the
  // exact tokens the Jaine pools are seeded with — same USDC.e that backs the
  // ~$360K TVL USDC.e/W0G pool, same WETH that backs the USDC.e/WETH pool, etc.
  console.log("        Adding USDC.e (Jaine stablecoin)...");
  await (await navCalc.addAsset(USDCE_ADDRESS, PYTH_FEED_USDC, 6, true)).wait();
  console.log("        ✓");
  console.log("        Adding WETH...");
  await (await navCalc.addAsset(WETH_ADDRESS, PYTH_FEED_ETH, 18, false)).wait();
  console.log("        ✓");
  console.log("        Adding WBTC...");
  await (await navCalc.addAsset(WBTC_ADDRESS, PYTH_FEED_BTC, 8, false)).wait();
  console.log("        ✓");
  console.log("        Adding W0G (wrapped native 0G)...");
  await (await navCalc.addAsset(W0G_ADDRESS, PYTH_FEED_0G, 18, false)).wait();
  console.log("        ✓");

  // ═══════════════════════════════════════════════
  // No MockDEX, no mock tokens, no demo vault.
  //
  // This deployment targets the REAL Jaine DEX on 0G mainnet. Judges + users
  // create their own vault via the frontend (`/create`), pointing at the
  // JaineVenueAdapter deployed above. The adapter reads live pools from
  // JaineFactory (`0x9bdcA5...`) and executes swaps against real liquidity
  // (USDC.e/W0G 0.3% ≈ $360K TVL, WETH/W0G 0.3% ≈ $278K TVL, etc).
  //
  // The previous deploy had a demo vault pre-wired to MockDEX; we remove it
  // here to keep the on-chain surface clean for a hackathon-ready mainnet.
  // ═══════════════════════════════════════════════

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
    feed0G: PYTH_FEED_0G,
  };
  // Real Jaine-pair tokens live on 0G mainnet — derived from Jaine pool
  // swap events. These are the addresses the frontend chain profile maps
  // USDC / WETH / WBTC to for chain 16661 (real liquidity mode).
  deployments.realTokens = {
    USDCe: USDCE_ADDRESS,
    WETH:  WETH_ADDRESS,
    WBTC:  WBTC_ADDRESS,
    W0G:   W0G_ADDRESS,
  };
  deployments.jainePools = [
    { pair: "USDC.e/W0G",  fee: 3000,  tvl: "~$360K" },
    { pair: "USDC.e/W0G",  fee: 10000, tvl: "~$360K" },
    { pair: "WETH/W0G",    fee: 3000,  tvl: "~$278K" },
    { pair: "WBTC/W0G",    fee: 3000,  tvl: "~$189K" },
    { pair: "USDC.e/WETH", fee: 3000,  tvl: "~$3K"   },
    { pair: "USDC.e/cbBTC",fee: 3000,  tvl: "~$92K"  },
  ];
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
  console.log("  3. Operators: register at /operator/register, stake USDC.e");
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
