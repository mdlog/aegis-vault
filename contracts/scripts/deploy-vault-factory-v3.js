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

  // ── Pre-flight: required reused fields ──
  const treasury =
    deployments.protocolTreasury &&
    checksum(requireField(deployments, "protocolTreasury", "deploy phase 1 first"));

  const registryV2 = checksum(
    requireField(
      deployments,
      "executionRegistryV2",
      "deploy v2 stack first (scripts/deploy-v2.js)"
    )
  );

  const execLibAddr = checksum(
    requireField(deployments, "execLibrary", "deploy v1/v2 stack first")
  );
  const sealedLibAddr = checksum(
    requireField(deployments, "sealedLibrary", "deploy v1/v2 stack first")
  );
  const ioLibAddr = checksum(
    requireField(deployments, "ioLibrary", "deploy v1/v2 stack first")
  );

  console.log("\nReused inputs:");
  console.log("  protocolTreasury    :", treasury);
  console.log("  executionRegistryV2 :", registryV2);
  console.log("  execLibrary         :", execLibAddr);
  console.log("  sealedLibrary       :", sealedLibAddr);
  console.log("  ioLibrary           :", ioLibAddr);

  // Sanity: every reused contract must actually exist on-chain (no typo / wrong file)
  for (const [label, addr] of [
    ["protocolTreasury", treasury],
    ["executionRegistryV2", registryV2],
    ["execLibrary", execLibAddr],
    ["sealedLibrary", sealedLibAddr],
    ["ioLibrary", ioLibAddr],
  ]) {
    if (!(await isContract(ethers.provider, addr))) {
      throw new Error(`${label} (${addr}) has no code on chain ${chainId} — wrong deployments file?`);
    }
  }

  // ── 1. CrossChainLib ──
  console.log("\n[1/3] CrossChainLib");
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

  // ── 2. AegisVault_v3 implementation ──
  console.log("\n[2/3] AegisVault_v3 implementation");
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

  // ── 3. AegisVaultFactoryV3 ──
  console.log("\n[3/3] AegisVaultFactoryV3");
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
    const factory = await FactoryV3.deploy(implV3Addr, registryV2, treasury || ethers.ZeroAddress);
    await factory.waitForDeployment();
    factoryV3Addr = checksum(await factory.getAddress());
    console.log("      deployed :", factoryV3Addr);
  }

  // ── 4. Registry authorization ──
  //
  //   ExecutionRegistry now exposes a multi-factory authorization set
  //   (`authorizedFactories`) so v1, v2 and v3 factories can coexist on the
  //   same registry without rotating `admin` away from any of them. Order of
  //   preference for getting the v3 factory authorized:
  //     1. Already authorized (via legacy admin slot OR authorizedFactories)
  //        → no-op.
  //     2. Deployer holds registry admin → call authorizeFactory(v3) inline.
  //        Cheap, single tx, leaves v1/v2 factories' authorizations intact.
  //     3. Some other account holds admin → print the manual step the
  //        operator needs to coordinate with that signer.
  console.log("\nRegistry authorization:");
  const registry = await ethers.getContractAt("ExecutionRegistry", registryV2);
  const currentAdmin = checksum(await registry.admin());
  const alreadyAuthorized = await registry.authorizedFactories(factoryV3Addr);
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
    crossChainLibrary:           crossChainLibAddr,
    aegisVaultImplementationV3:  implV3Addr,
    aegisVaultFactoryV3:         factoryV3Addr,
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
  console.log("crossChainLibrary           :", crossChainLibAddr);
  console.log("aegisVaultImplementationV3  :", implV3Addr);
  console.log("aegisVaultFactoryV3         :", factoryV3Addr);
  console.log("\nDeployments written:", deployFile);
  console.log("\nNext steps:");
  console.log("  1. node scripts/sync-frontend.js");
  console.log("  2. Frontend: wire aegisVaultFactoryV3 into /create for cross-chain vaults.");
  console.log("     Pass the user-requested _maxCrossChainFeeBps as the last arg to");
  console.log("     factory.createVault(...) — v3 seals the cap at init, no follow-up tx needed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Deploy failed:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
