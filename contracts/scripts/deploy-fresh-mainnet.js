/**
 * Aegis Vault — fresh full deploy (V3 + Khalani only).
 *
 * Single-shot script that deploys the entire V3 stack from scratch on a
 * given chain, with no leftover references to the legacy V1/V2 contracts.
 * The output is written to a fresh deployments file (default
 * `deployments-mainnet.json`, override with --out <path>) so the frontend
 * sync script picks up only the new addresses — clean integration, no
 * cutover priority lookups.
 *
 *   Sequence (every step idempotent — re-runs reuse what's already on chain):
 *     [ 1/14] ProtocolTreasury
 *     [ 2/14] AegisGovernor (M-of-N multisig)
 *     [ 3/14] OperatorRegistry
 *     [ 4/14] InsurancePool_v2
 *     [ 5/14] OperatorStaking_v2
 *     [ 6/14] OperatorReputation
 *     [ 7/14] VaultNAVCalculator        (constructor binds the Pyth oracle)
 *     [ 8/14] Libraries: SealedLib + ExecLib + IOLib + CrossChainLib
 *     [ 9/14] ExecutionRegistry (v3, audit Fix #6 surface)
 *     [10/14] AegisVault_v3 implementation
 *     [11/14] AegisVaultFactoryV3
 *     [12/14] JaineVenueAdapterV2
 *     [13/14] KhalaniVenueAdapter        (+ initial chain/token allowlist)
 *     [14/14] Wiring                     (registry.authorizeFactory,
 *                                         nav.addAsset for each whitelisted
 *                                         token, reputation.setRecorder)
 *
 *   Run on 0G mainnet:
 *     DEPLOYER_PRIVATE_KEY=0x... \
 *     GOVERNOR_OWNERS=0xaaa,0xbbb,0xccc \
 *     GOVERNOR_THRESHOLD=2 \
 *     EXECUTOR_ADDRESS=0x...                 (optional; defaults to deployer) \
 *     CONFIRM_MAINNET=1 \
 *       npx hardhat run scripts/deploy-fresh-mainnet.js --network og_mainnet
 *
 *   On testnet / hardhat for shakeout:
 *     ALLOW_NON_MAINNET=1 \
 *     GOVERNOR_OWNERS=$DEPLOYER_ADDR \
 *     GOVERNOR_THRESHOLD=1 \
 *       npx hardhat run scripts/deploy-fresh-mainnet.js
 *
 *   Output:
 *     deployments-mainnet.json (or --out <path>)
 *
 *   Outputs the canonical V3 keys and intentionally OMITS legacy keys
 *   (`aegisVaultFactory`, `aegisVaultImplementation`, `executionRegistry`,
 *   `operatorRegistry` without `V2`/`V3` suffix, etc.). Frontend
 *   `sync-frontend.js` reads only V3 keys after this run.
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const MAINNET_CHAIN_ID = 16661;

// ── Khalani allowlist seed (audit-LOW-#4 batch helpers) ──
const KHALANI_ALLOWED_CHAIN_IDS = [
  16661n, // 0G mainnet — destination + same-chain routing
  1n,     // Ethereum
  42161n, // Arbitrum
  8453n,  // Base
];

// Tokens on 0G we'll allow as Khalani assetOut. WBTC + USDT can be added later.
const KHALANI_ALLOWED_TOKEN_KEYS = ["USDCe", "WETH", "cbBTC", "W0G"];

const KHALANI_DEFAULT_MAX_FEE_BPS = 50; // 0.5%

// ── NAV calculator asset config (Pyth feed IDs from existing on-chain data) ──
const NAV_ASSETS = [
  { tokenKey: "USDCe", feedField: "feedUSDC", decimals: 6,  isStablecoin: true  },
  { tokenKey: "W0G",   feedField: "feed0G",   decimals: 18, isStablecoin: false },
  { tokenKey: "WETH",  feedField: "feedETH",  decimals: 18, isStablecoin: false },
  { tokenKey: "cbBTC", feedField: "feedBTC",  decimals: 8,  isStablecoin: false },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function checksum(addr) {
  return ethers.getAddress(addr);
}

async function isContract(provider, addr) {
  if (!addr) return false;
  try {
    const code = await provider.getCode(addr);
    return code && code !== "0x";
  } catch {
    return false;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--out");
  const out = idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  return { out };
}

function loadOrInit(deployFile) {
  if (fs.existsSync(deployFile)) {
    return JSON.parse(fs.readFileSync(deployFile, "utf8"));
  }
  return {};
}

function envList(name) {
  const raw = process.env[name];
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function require0xAddr(value, label) {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${label}: expected an address, got ${JSON.stringify(value)}`);
  }
  return checksum(value);
}

async function deployIfMissing(label, key, deployments, factoryName, args = []) {
  const existing = deployments[key];
  if (existing && (await isContract(ethers.provider, existing))) {
    console.log(`      reused   :`, checksum(existing));
    return checksum(existing);
  }
  const F = await ethers.getContractFactory(factoryName);
  const c = await F.deploy(...args);
  await c.waitForDeployment();
  const addr = checksum(await c.getAddress());
  console.log(`      deployed :`, addr);
  return addr;
}

async function deployLibIfMissing(label, key, deployments, factoryName) {
  return deployIfMissing(label, key, deployments, factoryName);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("─".repeat(72));
  console.log("Aegis Vault — fresh full deploy (V3 + Khalani only)");
  console.log("  Network:  ", net.name, "(chainId", chainId + ")");
  console.log("  Deployer: ", deployer.address);
  console.log("  Balance:  ", ethers.formatEther(balance), "0G/ETH");
  console.log("─".repeat(72));

  // ── Pre-flight ──
  const allowNonMainnet =
    process.env.ALLOW_NON_MAINNET === "1" || process.argv.includes("--allow-non-mainnet");
  if (chainId !== MAINNET_CHAIN_ID && !allowNonMainnet) {
    throw new Error(
      `Refusing to deploy on chainId ${chainId}. Expected ${MAINNET_CHAIN_ID} (0G mainnet). ` +
      `Re-run with ALLOW_NON_MAINNET=1 for testnet / hardhat shakeout.`
    );
  }
  if (chainId === MAINNET_CHAIN_ID && process.env.CONFIRM_MAINNET !== "1") {
    throw new Error(
      "Mainnet deploy requires CONFIRM_MAINNET=1 to prevent accidental burns. " +
      "Set the env var only after reviewing the deploy plan."
    );
  }

  const { out } = parseArgs();
  const defaultPath = chainId === MAINNET_CHAIN_ID
    ? "deployments-mainnet.json"
    : `deployments-${chainId}.json`;
  const deployFile = path.resolve(__dirname, "..", out || defaultPath);
  const deployments = loadOrInit(deployFile);

  // External references (must be on chain already; we don't deploy these).
  const pythAddr  = require0xAddr(deployments?.pyth?.address, "deployments.pyth.address");
  const realTokens = deployments.realTokens || {};
  for (const k of KHALANI_ALLOWED_TOKEN_KEYS) {
    if (!realTokens[k]) throw new Error(`deployments.realTokens.${k} missing`);
  }
  const jaineCfg = deployments.jaine || {};
  const jaineRouter = require0xAddr(jaineCfg.router, "deployments.jaine.router");
  const jaineFactory = require0xAddr(jaineCfg.factory, "deployments.jaine.factory");
  const jaineHub = require0xAddr(jaineCfg.w0g, "deployments.jaine.w0g (hub)");

  const ownersRaw = envList("GOVERNOR_OWNERS");
  if (ownersRaw.length === 0) throw new Error("GOVERNOR_OWNERS env required (comma-separated addrs)");
  const owners = ownersRaw.map((a) => require0xAddr(a, `GOVERNOR_OWNERS entry ${a}`));
  const threshold = Number(process.env.GOVERNOR_THRESHOLD || "1");
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) {
    throw new Error(`GOVERNOR_THRESHOLD invalid: ${process.env.GOVERNOR_THRESHOLD} (1..${owners.length})`);
  }

  const executorAddr = process.env.EXECUTOR_ADDRESS
    ? require0xAddr(process.env.EXECUTOR_ADDRESS, "EXECUTOR_ADDRESS")
    : deployer.address;

  console.log("\nPre-flight references (must already exist on chain):");
  console.log("  pyth                :", pythAddr);
  console.log("  jaine.router        :", jaineRouter);
  console.log("  jaine.factory       :", jaineFactory);
  console.log("  jaine.hub (w0g)     :", jaineHub);
  console.log("  realTokens          :", KHALANI_ALLOWED_TOKEN_KEYS.map((k) => `${k}=${checksum(realTokens[k])}`).join(", "));
  console.log("\nGovernance + ops:");
  console.log("  governor.owners     :", owners.join(", "));
  console.log("  governor.threshold  :", threshold);
  console.log("  reputation.recorder :", executorAddr);

  // Verify external refs really exist.
  for (const [label, addr] of [
    ["pyth", pythAddr],
    ["jaine.router", jaineRouter],
    ["jaine.factory", jaineFactory],
    ["jaine.hub", jaineHub],
  ]) {
    if (!(await isContract(ethers.provider, addr))) {
      throw new Error(`${label} (${addr}) has no code on chain ${chainId}`);
    }
  }

  // ── 1. ProtocolTreasury ──
  console.log("\n[ 1/14] ProtocolTreasury");
  const treasuryAddr = await deployIfMissing(
    "ProtocolTreasury", "protocolTreasury", deployments, "ProtocolTreasury",
    [deployer.address] // admin = deployer; rotate to multisig post-deploy
  );

  // ── 2. AegisGovernor ──
  console.log("\n[ 2/14] AegisGovernor");
  const governorAddr = await deployIfMissing(
    "AegisGovernor", "aegisGovernor", deployments, "AegisGovernor",
    [owners, threshold]
  );

  // ── 3. OperatorRegistry ──
  console.log("\n[ 3/14] OperatorRegistry");
  const operatorRegistryAddr = await deployIfMissing(
    "OperatorRegistry", "operatorRegistryV2", deployments, "OperatorRegistry"
  );

  // ── 4. InsurancePool_v2 (USDC.e payout token, governor as arbitrator) ──
  console.log("\n[ 4/14] InsurancePool_v2");
  const insuranceAddr = await deployIfMissing(
    "InsurancePool_v2", "insurancePoolV2", deployments, "InsurancePool_v2",
    [checksum(realTokens.USDCe), governorAddr]
  );

  // ── 5. OperatorStaking_v2 ──
  console.log("\n[ 5/14] OperatorStaking_v2");
  const stakingAddr = await deployIfMissing(
    "OperatorStaking_v2", "operatorStakingV2", deployments, "OperatorStaking_v2",
    [checksum(realTokens.USDCe), operatorRegistryAddr, insuranceAddr, governorAddr]
  );

  // ── 6. OperatorReputation ──
  console.log("\n[ 6/14] OperatorReputation");
  const reputationAddr = await deployIfMissing(
    "OperatorReputation", "operatorReputation", deployments, "OperatorReputation",
    [deployer.address] // admin = deployer; rotate to multisig later
  );

  // ── 7. VaultNAVCalculator ──
  console.log("\n[ 7/14] VaultNAVCalculator");
  const navAddr = await deployIfMissing(
    "VaultNAVCalculator", "vaultNAVCalculator", deployments, "VaultNAVCalculator",
    [pythAddr]
  );

  // ── 8. Libraries ──
  console.log("\n[ 8/14] Libraries");
  const sealedLibAddr = await deployLibIfMissing("SealedLib",     "sealedLibrary",   deployments, "SealedLib");
  const execLibAddr   = await deployLibIfMissing("ExecLib (v3)",  "execLibraryV3",   deployments, "ExecLib");
  const ioLibAddr     = await deployLibIfMissing("IOLib (v3)",    "ioLibraryV3",     deployments, "IOLib");
  const crossChainLibAddr = await deployLibIfMissing("CrossChainLib", "crossChainLibrary", deployments, "CrossChainLib");

  // ── 9. ExecutionRegistry V3 ──
  console.log("\n[ 9/14] ExecutionRegistry (v3)");
  const registryAddr = await deployIfMissing(
    "ExecutionRegistry", "executionRegistryV3", deployments, "ExecutionRegistry"
  );

  // ── 10. AegisVault_v3 implementation ──
  console.log("\n[10/14] AegisVault_v3 implementation");
  let implV3Addr = deployments.aegisVaultImplementationV3;
  if (implV3Addr && (await isContract(ethers.provider, implV3Addr))) {
    implV3Addr = checksum(implV3Addr);
    console.log("      reused   :", implV3Addr);
  } else {
    const VaultV3 = await ethers.getContractFactory("AegisVault_v3", {
      libraries: {
        ExecLib: execLibAddr,
        SealedLib: sealedLibAddr,
        IOLib: ioLibAddr,
        CrossChainLib: crossChainLibAddr,
      },
    });
    const impl = await VaultV3.deploy();
    await impl.waitForDeployment();
    implV3Addr = checksum(await impl.getAddress());
    console.log("      deployed :", implV3Addr);
  }

  // ── 11. AegisVaultFactoryV3 ──
  console.log("\n[11/14] AegisVaultFactoryV3");
  const factoryV3Addr = await deployIfMissing(
    "AegisVaultFactoryV3", "aegisVaultFactoryV3", deployments, "AegisVaultFactoryV3",
    [implV3Addr, registryAddr, treasuryAddr]
  );

  // ── 12. JaineVenueAdapterV2 ──
  console.log("\n[12/14] JaineVenueAdapterV2");
  const jaineAdapterAddr = await deployIfMissing(
    "JaineVenueAdapterV2", "jaineVenueAdapterV2", deployments, "JaineVenueAdapterV2",
    [jaineRouter, jaineFactory, jaineHub]
  );

  // ── 13. KhalaniVenueAdapter ──
  console.log("\n[13/14] KhalaniVenueAdapter");
  const khalaniAdapterAddr = await deployIfMissing(
    "KhalaniVenueAdapter", "khalaniVenueAdapter", deployments, "KhalaniVenueAdapter",
    [KHALANI_DEFAULT_MAX_FEE_BPS]
  );

  // ── 14. Wiring ──
  console.log("\n[14/14] Wiring");

  const registry = await ethers.getContractAt("ExecutionRegistry", registryAddr);
  const reputation = await ethers.getContractAt("OperatorReputation", reputationAddr);
  const nav = await ethers.getContractAt("VaultNAVCalculator", navAddr);
  const khalani = await ethers.getContractAt("KhalaniVenueAdapter", khalaniAdapterAddr);

  // (a) Authorize v3 factory in the new registry. Deployer is admin out of
  //     the box (constructor sets admin = msg.sender).
  if (await registry.authorizedFactories(factoryV3Addr)) {
    console.log("  registry.authorizedFactories[v3]      → already ✓");
  } else {
    await (await registry.authorizeFactory(factoryV3Addr)).wait();
    console.log("  registry.authorizeFactory(v3)         → set ✓");
  }

  // (b) Reputation: set the orchestrator wallet as authorized recorder so
  //     orchestrator's `recordExecution` can write back per-trade results.
  const repAdmin = checksum(await reputation.admin());
  if (repAdmin === checksum(deployer.address)) {
    if (await reputation.authorizedRecorders(executorAddr)) {
      console.log("  reputation.authorizedRecorders[exec]  → already ✓");
    } else {
      await (await reputation.setRecorder(executorAddr, true)).wait();
      console.log("  reputation.setRecorder(executor)      → set ✓");
    }
  } else {
    console.log("  reputation admin ≠ deployer — skip setRecorder; coordinate manually:");
    console.log(`     reputation.setRecorder(${executorAddr}, true)`);
  }

  // (c) NAV calculator: register all four whitelisted tokens.
  const navAdmin = checksum(await nav.admin());
  if (navAdmin === checksum(deployer.address)) {
    const existingCount = Number(await nav.getAssetCount());
    if (existingCount === 0) {
      for (const a of NAV_ASSETS) {
        const tokenAddr = checksum(realTokens[a.tokenKey]);
        const feedId = deployments.pyth?.[a.feedField];
        if (!feedId) {
          console.log(`  nav.addAsset(${a.tokenKey})           → SKIPPED (pyth.${a.feedField} missing)`);
          continue;
        }
        await (await nav.addAsset(tokenAddr, feedId, a.decimals, a.isStablecoin)).wait();
        console.log(`  nav.addAsset(${a.tokenKey.padEnd(6)}, ${a.decimals}d, ${a.isStablecoin ? "stable" : "volatile"}) → set ✓`);
      }
    } else {
      console.log(`  nav already has ${existingCount} assets        → skipping seed`);
    }
  } else {
    console.log("  nav admin ≠ deployer — skip addAsset; coordinate manually");
  }

  // (d) Khalani adapter: chain + token allowlist via batch helpers.
  const khalaniOwner = checksum(await khalani.owner());
  if (khalaniOwner === checksum(deployer.address)) {
    const chainsToSet = [];
    for (const cid of KHALANI_ALLOWED_CHAIN_IDS) {
      if (!(await khalani.allowedChains(cid))) chainsToSet.push(cid);
    }
    if (chainsToSet.length > 0) {
      await (await khalani.setChainsAllowed(chainsToSet, chainsToSet.map(() => true))).wait();
      console.log(`  khalani.setChainsAllowed([${chainsToSet.join(",")}])    → set ✓`);
    } else {
      console.log("  khalani chains already allowed         → skipping");
    }
    const tokensToSet = [];
    const tokenLabels = [];
    for (const k of KHALANI_ALLOWED_TOKEN_KEYS) {
      const a = checksum(realTokens[k]);
      if (!(await khalani.allowedTokens(a))) {
        tokensToSet.push(a);
        tokenLabels.push(k);
      }
    }
    if (tokensToSet.length > 0) {
      await (await khalani.setTokensAllowed(tokensToSet, tokensToSet.map(() => true))).wait();
      console.log(`  khalani.setTokensAllowed([${tokenLabels.join(",")}])  → set ✓`);
    } else {
      console.log("  khalani tokens already allowed         → skipping");
    }
  } else {
    console.log("  khalani owner ≠ deployer — skip allowlist seed; coordinate manually");
  }

  // ── Persist ──
  const merged = {
    ...deployments,
    network: net.name,
    chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),

    // V3 core
    protocolTreasury:           treasuryAddr,
    aegisGovernor:              governorAddr,
    operatorRegistryV2:         operatorRegistryAddr,
    insurancePoolV2:            insuranceAddr,
    operatorStakingV2:          stakingAddr,
    operatorReputation:         reputationAddr,
    vaultNAVCalculator:         navAddr,
    sealedLibrary:              sealedLibAddr,
    execLibraryV3:              execLibAddr,
    ioLibraryV3:                ioLibAddr,
    crossChainLibrary:          crossChainLibAddr,
    executionRegistryV3:        registryAddr,
    aegisVaultImplementationV3: implV3Addr,
    aegisVaultFactoryV3:        factoryV3Addr,
    jaineVenueAdapterV2:        jaineAdapterAddr,
    khalaniVenueAdapter:        khalaniAdapterAddr,

    // ops
    orchestratorWallet:         executorAddr,
  };

  // Drop legacy V1 keys so the frontend manifest only surfaces V3.
  for (const legacyKey of [
    "executionRegistry",
    "execLibrary",
    "ioLibrary",
    "aegisVaultImplementation",
    "aegisVaultFactory",
    "operatorRegistry",
    "operatorStaking",
    "insurancePool",
    "jaineVenueAdapter",
  ]) {
    delete merged[legacyKey];
  }

  fs.writeFileSync(deployFile, JSON.stringify(merged, null, 2));

  console.log("\n" + "═".repeat(72));
  console.log("Fresh deploy complete");
  console.log("═".repeat(72));
  console.log("Deployments written to :", deployFile);
  console.log("");
  console.log("Core addresses:");
  console.log("  protocolTreasury           :", treasuryAddr);
  console.log("  aegisGovernor              :", governorAddr);
  console.log("  operatorRegistryV2         :", operatorRegistryAddr);
  console.log("  insurancePoolV2            :", insuranceAddr);
  console.log("  operatorStakingV2          :", stakingAddr);
  console.log("  operatorReputation         :", reputationAddr);
  console.log("  vaultNAVCalculator         :", navAddr);
  console.log("  executionRegistryV3        :", registryAddr);
  console.log("  aegisVaultImplementationV3 :", implV3Addr);
  console.log("  aegisVaultFactoryV3        :", factoryV3Addr);
  console.log("  jaineVenueAdapterV2        :", jaineAdapterAddr);
  console.log("  khalaniVenueAdapter        :", khalaniAdapterAddr);
  console.log("");
  console.log("Next steps:");
  console.log("  1. node scripts/sync-frontend.js " + path.basename(deployFile));
  console.log("  2. Restart the orchestrator so it picks up new addresses.");
  console.log("  3. (Recommended) rotate registry + reputation + treasury admin");
  console.log("     to AegisGovernor multisig:");
  console.log("       registry.transferAdmin(" + governorAddr + ");  // multisig must call acceptAdmin()");
  console.log("       treasury.transferAdmin(" + governorAddr + ");");
  console.log("       reputation.transferAdmin(" + governorAddr + ");");
  console.log("       khalani.transferOwnership(" + governorAddr + ");");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Fresh deploy failed:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
