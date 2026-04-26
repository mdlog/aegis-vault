/**
 * Deploy AegisVault v3 stack:
 *   - CrossChainLib            (deploy if absent)
 *   - AegisVault_v3 impl       (linked: ExecLib + SealedLib + IOLib + CrossChainLib)
 *   - AegisVaultFactoryV3      (clones v3 impl, shares executionRegistryV2 + treasury)
 *
 * Reuses existing libraries (ExecLib / SealedLib / IOLib), the v2
 * ExecutionRegistry, and the shared ProtocolTreasury so the v3 stack
 * inherits the v2 replay map and treasury address book unchanged.
 *
 * Idempotent: if a v3 implementation / factory address already exists in
 * deployments-mainnet.json the script skips that step and re-uses the on-chain
 * contract. Re-running is safe and prints a "no-op" summary.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-vault-factory-v3.js --network og_mainnet
 *
 *   # Allow non-mainnet (testnet / hardhat) for shakeout:
 *   ALLOW_NON_MAINNET=1 npx hardhat run scripts/deploy-vault-factory-v3.js --network og_testnet
 *
 * Writes back into:
 *   contracts/deployments-mainnet.json   (chainId 16661)
 *   contracts/deployments.json           (any other chain)
 *
 * New keys written:
 *   crossChainLibrary           (if newly deployed)
 *   aegisVaultImplementationV3
 *   aegisVaultFactoryV3
 *   v3DeployedAt
 *   v3Deployer
 *
 * Operational notes:
 *   - ExecutionRegistry now exposes `authorizedFactories` so v1, v2 and v3
 *     factories can coexist on a single registry without rotating `admin`.
 *     The script tries (in order): (a) check the v3 factory is already
 *     authorized via legacy admin OR `authorizedFactories[v3]==true`; (b) if
 *     the deployer still holds registry admin, call `authorizeFactory(v3)`
 *     inline; (c) otherwise print the manual step the current admin signer
 *     must run. v1/v2 authorizations are never touched.
 *
 *   - AegisVault_v3.initialize() takes `_maxCrossChainFeeBps` directly so
 *     the user-requested cap is sealed at creation time in a single tx.
 *     The factory still records the value in `requestedMaxCrossChainFeeBps`
 *     for off-chain consumers that want to read it without an additional
 *     vault round-trip. No follow-up `setMaxCrossChainFeeBps` call is
 *     required after createVault.
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const MAINNET_CHAIN_ID = 16661;

// ── Helpers ────────────────────────────────────────────────────────────────

function loadDeployments(chainId) {
  const file = Number(chainId) === MAINNET_CHAIN_ID
    ? "deployments-mainnet.json"
    : "deployments.json";
  const p = path.resolve(__dirname, "..", file);
  if (!fs.existsSync(p)) {
    throw new Error(`${file} not found — run phase 1 / 2 / v2 deploys first`);
  }
  return { path: p, data: JSON.parse(fs.readFileSync(p, "utf8")) };
}

function requireField(deployments, key, hint) {
  const v = deployments[key];
  if (!v) throw new Error(`${key} missing in deployments file — ${hint}`);
  return v;
}

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

// ── Khalani route registry config ──
//
//   Initial allowlist seeded into KhalaniVenueAdapter at deploy time. Editable
//   post-deploy via adapter.setChainAllowed / setTokenAllowed (owner-only).
//
//   Chains: every Khalani-supported origin we want vaults to accept fills
//   from. Add entries as Khalani expands chain coverage.
//
//   Tokens: pulled from `realTokens` in deployments. We allowlist only assets
//   we want vaults to receive as `assetOut` on 0G — base assets the AI may
//   buy or sell. SealedLib + acceptCrossChainFill will reject any other
//   destination token even if Khalani would route it.
//
//   `defaultMaxFeeBps` is the protocol-wide ceiling the orchestrator uses as
//   a default `intent.maxFeeBps`. Per-vault `maxCrossChainFeeBps` overrides
//   this in the stricter direction; neither can exceed 200 bps (vault hard
//   cap).
const KHALANI_ALLOWED_CHAIN_IDS = [
  16661n, // 0G mainnet — destination, but also useful for 0G-to-0G routing
  1n,     // Ethereum mainnet
  42161n, // Arbitrum One
  8453n,  // Base
];

const KHALANI_ALLOWED_TOKEN_KEYS = [
  "USDCe",
  "WETH",
  "cbBTC",
  "W0G",
  // WBTC + USDT can be added later via setTokenAllowed if needed.
];

const KHALANI_DEFAULT_MAX_FEE_BPS = 50; // 0.5%

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("─".repeat(64));
  console.log("Deploying AegisVault v3 factory stack");
  console.log("  Network:  ", net.name, "(chainId", chainId + ")");
  console.log("  Deployer: ", deployer.address);
  console.log("  Balance:  ", ethers.formatEther(balance), "ETH/0G");
  console.log("─".repeat(64));

  // Pre-flight: refuse to run on non-mainnet unless explicitly allowed.
  const allowNonMainnet =
    process.env.ALLOW_NON_MAINNET === "1" || process.argv.includes("--allow-non-mainnet");
  if (chainId !== MAINNET_CHAIN_ID && !allowNonMainnet) {
    throw new Error(
      `Refusing to deploy on chainId ${chainId}. Expected ${MAINNET_CHAIN_ID} (0G mainnet). ` +
        `Re-run with ALLOW_NON_MAINNET=1 (or --allow-non-mainnet) for testnet / hardhat shakeout.`
    );
  }
  if (chainId !== MAINNET_CHAIN_ID) {
    console.log("⚠  Non-mainnet deploy (chainId " + chainId + ") — ALLOW_NON_MAINNET=1 set\n");
  }

  const { path: deployFile, data: deployments } = loadDeployments(chainId);

  // ── Pre-flight: which artefacts are V3-private vs reusable ──
  //
  //   v3 needs FRESH copies of:
  //     - ExecLib            (audit Fix #3 added `totalDeposited` arg —
  //                           old library bytecode has incompatible signature)
  //     - IOLib              (audit Fix #8 added doDepositV3/doWithdrawV3 —
  //                           v1/v2 only call doDeposit/doWithdraw, but v3 uses
  //                           the new entrypoints)
  //     - CrossChainLib      (V3-only)
  //     - ExecutionRegistry  (audit Fix #6 added authorizedFactories — old
  //                           on-chain instance has no such function, would
  //                           revert v3 factory's pre-flight check)
  //
  //   v3 REUSES from existing v2 deployment when present:
  //     - SealedLib          (unchanged across v1 → v3)
  //     - protocolTreasury   (no behavioural change)
  //
  //   The fresh ExecutionRegistry is private to v3 — v1/v2 vaults stay on the
  //   old `executionRegistryV2`. Cross-version replay is impossible regardless
  //   because intent hashes are vault-bound (vault address in EIP-712 domain).
  const treasury =
    deployments.protocolTreasury &&
    checksum(requireField(deployments, "protocolTreasury", "deploy phase 1 first"));

  const sealedLibAddr = checksum(
    requireField(deployments, "sealedLibrary", "deploy v1/v2 stack first")
  );

  console.log("\nReused inputs:");
  console.log("  protocolTreasury    :", treasury);
  console.log("  sealedLibrary       :", sealedLibAddr);

  // Sanity: reused contracts must actually exist on-chain.
  for (const [label, addr] of [
    ["protocolTreasury", treasury],
    ["sealedLibrary", sealedLibAddr],
  ]) {
    if (!(await isContract(ethers.provider, addr))) {
      throw new Error(`${label} (${addr}) has no code on chain ${chainId} — wrong deployments file?`);
    }
  }

  // ── 1. ExecLib (v3) ──
  // V3 uses the post-audit-Fix-#3 ExecLib (param `totalDeposited`).
  // Idempotent: keyed under `execLibraryV3` to avoid clobbering the v1/v2
  // library address (`execLibrary`) which existing vaults still link to.
  console.log("\n[1/7] ExecLib (v3)");
  let execLibV3Addr = deployments.execLibraryV3;
  if (execLibV3Addr && (await isContract(ethers.provider, execLibV3Addr))) {
    execLibV3Addr = checksum(execLibV3Addr);
    console.log("      reused   :", execLibV3Addr);
  } else {
    const ExecLib = await ethers.getContractFactory("ExecLib");
    const lib = await ExecLib.deploy();
    await lib.waitForDeployment();
    execLibV3Addr = checksum(await lib.getAddress());
    console.log("      deployed :", execLibV3Addr);
  }

  // ── 2. IOLib (v3) ──
  // V3 uses post-audit-Fix-#8 IOLib (adds doDepositV3/doWithdrawV3 with
  // 80/20 fee split). v1/v2 keep their own IOLib at `ioLibrary`.
  console.log("\n[2/7] IOLib (v3)");
  let ioLibV3Addr = deployments.ioLibraryV3;
  if (ioLibV3Addr && (await isContract(ethers.provider, ioLibV3Addr))) {
    ioLibV3Addr = checksum(ioLibV3Addr);
    console.log("      reused   :", ioLibV3Addr);
  } else {
    const IOLib = await ethers.getContractFactory("IOLib");
    const lib = await IOLib.deploy();
    await lib.waitForDeployment();
    ioLibV3Addr = checksum(await lib.getAddress());
    console.log("      deployed :", ioLibV3Addr);
  }

  // ── 3. CrossChainLib ──
  console.log("\n[3/7] CrossChainLib");
  let crossChainLibAddr = deployments.crossChainLibrary;
  if (crossChainLibAddr && (await isContract(ethers.provider, crossChainLibAddr))) {
    crossChainLibAddr = checksum(crossChainLibAddr);
    console.log("      reused   :", crossChainLibAddr);
  } else {
    const CrossChainLib = await ethers.getContractFactory("CrossChainLib");
    const lib = await CrossChainLib.deploy();
    await lib.waitForDeployment();
    crossChainLibAddr = checksum(await lib.getAddress());
    console.log("      deployed :", crossChainLibAddr);
  }

  // ── 4. ExecutionRegistry (v3) ──
  // V3 uses the post-audit-Fix-#6 registry (adds authorizedFactories +
  // events + Ownable2Step admin). v1/v2 vaults stay on the old registry.
  // Cross-version intent collision is impossible because intent hashes
  // bind the vault address into the EIP-712 domain.
  console.log("\n[4/7] ExecutionRegistry (v3)");
  let registryV3Addr = deployments.executionRegistryV3;
  if (registryV3Addr && (await isContract(ethers.provider, registryV3Addr))) {
    registryV3Addr = checksum(registryV3Addr);
    console.log("      reused   :", registryV3Addr);
  } else {
    const Registry = await ethers.getContractFactory("ExecutionRegistry");
    const reg = await Registry.deploy();
    await reg.waitForDeployment();
    registryV3Addr = checksum(await reg.getAddress());
    console.log("      deployed :", registryV3Addr);
  }

  // ── 5. AegisVault_v3 implementation ──
  console.log("\n[5/7] AegisVault_v3 implementation");
  let implV3Addr = deployments.aegisVaultImplementationV3;
  if (implV3Addr && (await isContract(ethers.provider, implV3Addr))) {
    implV3Addr = checksum(implV3Addr);
    console.log("      reused   :", implV3Addr);
  } else {
    const VaultV3 = await ethers.getContractFactory("AegisVault_v3", {
      libraries: {
        ExecLib: execLibV3Addr,
        SealedLib: sealedLibAddr,
        IOLib: ioLibV3Addr,
        CrossChainLib: crossChainLibAddr,
      },
    });
    const impl = await VaultV3.deploy();
    await impl.waitForDeployment();
    implV3Addr = checksum(await impl.getAddress());
    console.log("      deployed :", implV3Addr);
  }

  // ── 6. AegisVaultFactoryV3 ──
  console.log("\n[6/7] AegisVaultFactoryV3");
  let factoryV3Addr = deployments.aegisVaultFactoryV3;
  let factoryAlreadyDeployed = false;
  if (factoryV3Addr && (await isContract(ethers.provider, factoryV3Addr))) {
    factoryV3Addr = checksum(factoryV3Addr);
    factoryAlreadyDeployed = true;
    console.log("      reused   :", factoryV3Addr);

    // Sanity check the reused factory is still wired at the same impl.
    const reusedFactory = await ethers.getContractAt("AegisVaultFactoryV3", factoryV3Addr);
    const seenImpl = checksum(await reusedFactory.vaultImplementation());
    if (seenImpl !== implV3Addr) {
      throw new Error(
        `Reused factory ${factoryV3Addr} points at impl ${seenImpl}, expected ${implV3Addr} — ` +
          `delete aegisVaultFactoryV3 from deployments file to redeploy.`
      );
    }
  } else {
    const FactoryV3 = await ethers.getContractFactory("AegisVaultFactoryV3");
    const factory = await FactoryV3.deploy(implV3Addr, registryV3Addr, treasury || ethers.ZeroAddress);
    await factory.waitForDeployment();
    factoryV3Addr = checksum(await factory.getAddress());
    console.log("      deployed :", factoryV3Addr);
  }

  // ── 7. KhalaniVenueAdapter ──
  //
  //   Route registry for cross-chain intents. Vault contract does NOT call
  //   this adapter at execution time (acceptCrossChainFill is venue-less);
  //   the orchestrator queries `isRouteAllowed(chainId, tokenIn, tokenOut)`
  //   before publishing a Khalani intent. Adapter is owned by the deployer
  //   initially — production should rotate ownership to AegisGovernor or a
  //   protocol multisig once the initial allowlist is verified.
  console.log("\n[7/7] KhalaniVenueAdapter");
  let khalaniAdapterAddr = deployments.khalaniVenueAdapter;
  let khalaniAdapter;
  if (khalaniAdapterAddr && (await isContract(ethers.provider, khalaniAdapterAddr))) {
    khalaniAdapterAddr = checksum(khalaniAdapterAddr);
    khalaniAdapter = await ethers.getContractAt("KhalaniVenueAdapter", khalaniAdapterAddr);
    console.log("      reused   :", khalaniAdapterAddr);
  } else {
    const KhalaniAdapter = await ethers.getContractFactory("KhalaniVenueAdapter");
    khalaniAdapter = await KhalaniAdapter.deploy(KHALANI_DEFAULT_MAX_FEE_BPS);
    await khalaniAdapter.waitForDeployment();
    khalaniAdapterAddr = checksum(await khalaniAdapter.getAddress());
    console.log("      deployed :", khalaniAdapterAddr);
    console.log("      defaultMaxFeeBps:", KHALANI_DEFAULT_MAX_FEE_BPS);
  }

  // Initial allowlist — only run when deployer still holds adapter ownership.
  // (If governance has already rotated owner, skip silently and print the
  //  manual coordination note.)
  const adapterOwner = checksum(await khalaniAdapter.owner());
  if (adapterOwner === checksum(deployer.address)) {
    console.log("\nKhalani allowlist:");
    // Filter out chains/tokens that are already allowed so re-runs don't burn
    // gas re-emitting events. Whatever is missing is set in a single batched
    // tx via the audit-LOW-#4 setChainsAllowed/setTokensAllowed helpers.
    console.log("  Chains:");
    const chainsToSet = [];
    for (const cid of KHALANI_ALLOWED_CHAIN_IDS) {
      if (await khalaniAdapter.allowedChains(cid)) {
        console.log(`    chainId ${cid.toString().padStart(6)}  → already allowed ✓`);
      } else {
        chainsToSet.push(cid);
      }
    }
    if (chainsToSet.length > 0) {
      const flags = chainsToSet.map(() => true);
      await (await khalaniAdapter.setChainsAllowed(chainsToSet, flags)).wait();
      for (const cid of chainsToSet) console.log(`    chainId ${cid.toString().padStart(6)}  → set ✓`);
    }

    const realTokens = deployments.realTokens || {};
    console.log("  Tokens:");
    const tokensToSet = [];
    const tokenLabels = [];
    for (const key of KHALANI_ALLOWED_TOKEN_KEYS) {
      const addr = realTokens[key];
      if (!addr) {
        console.log(`    ${key.padEnd(8)} → SKIPPED (not in deployments.realTokens)`);
        continue;
      }
      const cs = checksum(addr);
      if (await khalaniAdapter.allowedTokens(cs)) {
        console.log(`    ${key.padEnd(8)} ${cs} → already allowed ✓`);
      } else {
        tokensToSet.push(cs);
        tokenLabels.push(key);
      }
    }
    if (tokensToSet.length > 0) {
      const flags = tokensToSet.map(() => true);
      await (await khalaniAdapter.setTokensAllowed(tokensToSet, flags)).wait();
      for (let i = 0; i < tokensToSet.length; i++) {
        console.log(`    ${tokenLabels[i].padEnd(8)} ${tokensToSet[i]} → set ✓`);
      }
    }
  } else {
    console.log("\nKhalani allowlist:");
    console.log("  ⚠  Adapter owner =", adapterOwner, "(not deployer)");
    console.log("     Skipping inline allowlist setup. Coordinate the following from owner:");
    for (const cid of KHALANI_ALLOWED_CHAIN_IDS) {
      console.log(`       adapter.setChainAllowed(${cid}, true)`);
    }
    const realTokens = deployments.realTokens || {};
    for (const key of KHALANI_ALLOWED_TOKEN_KEYS) {
      const addr = realTokens[key];
      if (addr) console.log(`       adapter.setTokenAllowed(${checksum(addr)}, true)  // ${key}`);
    }
  }

  // ── Registry authorization ──
  //
  //   The fresh v3 ExecutionRegistry was deployed in step [4/7] with the
  //   deployer as admin (audit Fix #1: Ownable2Step admin transfer). The
  //   deployer adds the v3 factory to `authorizedFactories` so the factory's
  //   pre-flight check passes and `authorizeVault(...)` succeeds inside
  //   `createVault`. v1/v2 factories are NOT in this registry — they keep
  //   running against the original v2 registry untouched.
  console.log("\nRegistry authorization:");
  const registry = await ethers.getContractAt("ExecutionRegistry", registryV3Addr);
  const currentAdmin = checksum(await registry.admin());
  const alreadyAuthorized = await registry.authorizedFactories(factoryV3Addr);
  console.log("  registry (v3)           :", registryV3Addr);
  console.log("  current admin           :", currentAdmin);
  console.log("  v3 factory              :", factoryV3Addr);
  console.log("  authorizedFactories[v3] :", alreadyAuthorized);

  if (currentAdmin === factoryV3Addr) {
    console.log("  → v3 factory holds registry admin (legacy path) ✓");
  } else if (alreadyAuthorized) {
    console.log("  → v3 factory already in authorizedFactories ✓");
  } else if (currentAdmin === checksum(deployer.address)) {
    console.log("  → deployer holds admin; calling authorizeFactory(v3)…");
    await (await registry.authorizeFactory(factoryV3Addr)).wait();
    const post = await registry.authorizedFactories(factoryV3Addr);
    if (!post) {
      throw new Error("authorizeFactory failed: post-state still unauthorized");
    }
    console.log("  → v3 factory authorized via authorizedFactories ✓");
  } else {
    console.log("  ⚠  Registry admin held by", currentAdmin);
    console.log("     Coordinate the following call from that account before");
    console.log("     v3 factory.createVault can succeed:");
    console.log(`       registry.authorizeFactory(${factoryV3Addr})`);
    console.log("     This adds v3 to the multi-factory set and leaves v1/v2");
    console.log("     authorizations untouched.");
  }

  // ── Persist ──
  const patch = {
    execLibraryV3:               execLibV3Addr,
    ioLibraryV3:                 ioLibV3Addr,
    crossChainLibrary:           crossChainLibAddr,
    executionRegistryV3:         registryV3Addr,
    aegisVaultImplementationV3:  implV3Addr,
    aegisVaultFactoryV3:         factoryV3Addr,
    khalaniVenueAdapter:         khalaniAdapterAddr,
    v3DeployedAt:                deployments.v3DeployedAt || new Date().toISOString(),
    v3Deployer:                  deployments.v3Deployer || deployer.address,
  };
  // Only stamp NEW deployedAt/deployer if we actually deployed the factory now.
  if (!factoryAlreadyDeployed) {
    patch.v3DeployedAt = new Date().toISOString();
    patch.v3Deployer = deployer.address;
  }

  const merged = { ...deployments, ...patch };
  fs.writeFileSync(deployFile, JSON.stringify(merged, null, 2));

  console.log("\n" + "═".repeat(64));
  console.log("AegisVault v3 factory deploy complete");
  console.log("═".repeat(64));
  console.log("execLibraryV3               :", execLibV3Addr);
  console.log("ioLibraryV3                 :", ioLibV3Addr);
  console.log("crossChainLibrary           :", crossChainLibAddr);
  console.log("executionRegistryV3         :", registryV3Addr);
  console.log("aegisVaultImplementationV3  :", implV3Addr);
  console.log("aegisVaultFactoryV3         :", factoryV3Addr);
  console.log("khalaniVenueAdapter         :", khalaniAdapterAddr);
  console.log("\nDeployments written:", deployFile);
  console.log("\nNext steps:");
  console.log("  1. node scripts/sync-frontend.js   (publishes new ABIs + addresses)");
  console.log("  2. Frontend: wire aegisVaultFactoryV3 into /create for cross-chain vaults.");
  console.log("     Pass the user-requested _maxCrossChainFeeBps as the last arg to");
  console.log("     factory.createVault(...) — v3 seals the cap at init, no follow-up tx needed.");
  console.log("  3. Orchestrator: set KHALANI_VENUE_ADAPTER env / config to the address above");
  console.log("     so quoteRouter can reach `isRouteAllowed` (governance metadata).");
  console.log("  4. (Recommended) Rotate v3 registry admin to AegisGovernor multisig:");
  console.log(`       registry.transferAdmin(<multisig>); then multisig calls acceptAdmin().`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Deploy failed:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
