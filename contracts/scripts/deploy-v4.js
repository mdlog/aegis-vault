/**
 * Deploy AegisVault v4 stack:
 *   - ExecLibV4                (V4-only library; carries strategyHash typehash)
 *   - CrossChainLibV4          (V4-only library; cross-chain typehash also binds
 *                                strategyHash + strategySchemaVer, so V3
 *                                CrossChainLib is NOT reused)
 *   - AegisVault_v4 impl       (linked: ExecLibV4 + SealedLib + IOLib + CrossChainLibV4)
 *   - AegisVaultFactoryV4      (clones v4 impl, shares executionRegistryV3 + treasury)
 *
 * V4 introduces strategy-binding: every clone commits an `acceptedManifestHash`
 * at create time, and `executeIntent` requires `intent.strategyHash` to match
 * before allowing the swap. Strategy upgrades go through a 24-hour timelock.
 *
 * Reuses the existing V3 ExecutionRegistry + ProtocolTreasury + SealedLib +
 * IOLib so V4 inherits the V3 replay map and treasury address book unchanged.
 * CrossChainLib is V4-forked (different typehash) and is deployed fresh in
 * this script. Cross-version replay is impossible because intent hashes bind
 * the vault address into the EIP-712 domain.
 *
 * Idempotent: if a V4 implementation / factory address already exists in
 * deployments-mainnet.json the script skips that step and reuses the on-chain
 * contract. Re-running is safe and prints a "no-op" summary.
 *
 * Usage:
 *   CONFIRM_MAINNET=1 npx hardhat run scripts/deploy-v4.js --network og_mainnet
 *
 *   # Allow non-mainnet (testnet / hardhat) for shakeout:
 *   ALLOW_NON_MAINNET=1 npx hardhat run scripts/deploy-v4.js --network og_testnet
 *
 * Writes back into:
 *   contracts/deployments-mainnet.json   (chainId 16661)
 *   contracts/deployments.json           (any other chain)
 *
 * New keys written:
 *   execLibraryV4
 *   crossChainLibraryV4
 *   aegisVaultImplementationV4
 *   aegisVaultFactoryV4
 *   v4DeployedAt
 *   v4Deployer
 *
 * After this script:
 *   1. Run `node scripts/sync-frontend.js deployments-mainnet.json` to
 *      propagate to the frontend manifest + SDK.
 *   2. Restart orchestrator — V4 vault discovery is automatic via
 *      `KNOWN_FACTORIES` (vaultEventListener.js) + factory version detection.
 *
 * See docs/V4_DEPLOYMENT_PLAN.md for the full operational runbook + cost
 * estimate + rollback plan.
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
    throw new Error(`${file} not found — run V3 deploy first`);
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

  console.log("─".repeat(72));
  console.log("Deploying AegisVault v4 (strategy-bound) stack");
  console.log("  Network:  ", net.name, "(chainId", chainId + ")");
  console.log("  Deployer: ", deployer.address);
  console.log("  Balance:  ", ethers.formatEther(balance), "0G/ETH");
  console.log("─".repeat(72));

  // Pre-flight: refuse to run on non-mainnet unless explicitly allowed.
  const allowNonMainnet =
    process.env.ALLOW_NON_MAINNET === "1" || process.argv.includes("--allow-non-mainnet");
  if (chainId !== MAINNET_CHAIN_ID && !allowNonMainnet) {
    throw new Error(
      `Refusing to deploy on chainId ${chainId}. Expected ${MAINNET_CHAIN_ID} (0G mainnet). ` +
        `Re-run with ALLOW_NON_MAINNET=1 (or --allow-non-mainnet) for testnet / hardhat shakeout.`
    );
  }
  // Mainnet guard: require explicit confirmation env var.
  if (chainId === MAINNET_CHAIN_ID && process.env.CONFIRM_MAINNET !== "1") {
    throw new Error(
      "Mainnet deploy requires CONFIRM_MAINNET=1 to prevent accidental burns. " +
      "Set the env var only after reviewing the deploy plan."
    );
  }

  const { path: deployFile, data: deployments } = loadDeployments(chainId);

  // ── Pre-flight: V4 reuses V3 infra; V3 must already be deployed ──
  //
  //   v4 needs FRESH copies of:
  //     - ExecLibV4         (V4-only library — has the new ExecutionIntentV4
  //                          struct + strategyHash typehash)
  //     - AegisVault_v4     (independent implementation; clones share storage
  //                          slots with V3 prefix + V4-only suffix)
  //     - AegisVaultFactoryV4
  //
  //   v4 REUSES from existing v3 deployment:
  //     - SealedLib            (unchanged across v1 → v4)
  //     - IOLib (v3)           (V4 calls doDepositV3 / doWithdrawV3 — same
  //                              as V3, no V4 fork needed)
  //     - ExecutionRegistry V3 (V4 factory will be authorized as a second
  //                              factory in the same registry — no fork)
  //     - ProtocolTreasury     (no behavioural change)
  //
  //   v4 FORKS (deployed fresh in this script):
  //     - ExecLibV4            (V4 typehash binds strategyHash + schemaVer)
  //     - CrossChainLibV4      (cross-chain typehash also binds strategyHash;
  //                              V3 CrossChainLib MUST NOT be reused — wrong
  //                              digest → signatures fail recovery)
  const treasury = checksum(
    requireField(deployments, "protocolTreasury", "deploy V3 stack first")
  );
  const sealedLibAddr = checksum(
    requireField(deployments, "sealedLibrary", "deploy v1/v2 stack first")
  );
  const ioLibAddr = checksum(
    requireField(deployments, "ioLibraryV3", "deploy V3 stack first")
  );
  const registryV3Addr = checksum(
    requireField(deployments, "executionRegistryV3", "deploy V3 stack first")
  );

  console.log("\nReused V3 inputs:");
  console.log("  protocolTreasury    :", treasury);
  console.log("  sealedLibrary       :", sealedLibAddr);
  console.log("  ioLibraryV3         :", ioLibAddr);
  console.log("  executionRegistryV3 :", registryV3Addr);

  // Sanity: reused contracts must actually exist on-chain.
  // CrossChainLibV4 is NOT reused — V4 binds strategyHash + strategySchemaVer
  // into the cross-chain EIP-712 typehash, so the V4 vault links a V4-only
  // library (deployed fresh in step [2/5] below).
  for (const [label, addr] of [
    ["protocolTreasury", treasury],
    ["sealedLibrary", sealedLibAddr],
    ["ioLibraryV3", ioLibAddr],
    ["executionRegistryV3", registryV3Addr],
  ]) {
    if (!(await isContract(ethers.provider, addr))) {
      throw new Error(
        `${label} (${addr}) has no code on chain ${chainId} — wrong deployments file?`
      );
    }
  }

  // ── 1. ExecLibV4 ──
  // V4-only library. Carries the new ExecutionIntentV4 struct (adds
  // strategyHash + strategySchemaVer) and the V4 EIP-712 typehash. v1/v2/v3
  // vaults link to ExecLib (legacy) — V4 vaults link to ExecLibV4.
  console.log("\n[1/5] ExecLibV4");
  let execLibV4Addr = deployments.execLibraryV4;
  if (execLibV4Addr && (await isContract(ethers.provider, execLibV4Addr))) {
    execLibV4Addr = checksum(execLibV4Addr);
    console.log("      reused   :", execLibV4Addr);
  } else {
    const ExecLibV4 = await ethers.getContractFactory("ExecLibV4");
    const lib = await ExecLibV4.deploy();
    await lib.waitForDeployment();
    execLibV4Addr = checksum(await lib.getAddress());
    console.log("      deployed :", execLibV4Addr);
  }

  // ── 2. CrossChainLibV4 ──
  // V4-only library. Independent of V3 CrossChainLib because V4 binds
  // `strategyHash` + `strategySchemaVer` into the cross-chain EIP-712
  // typehash. Linking the V3 lib here would silently produce intents
  // whose signatures cannot be verified against V4 vaults (different
  // typehash → different digest → ecrecover returns the wrong signer).
  // V4 vaults link to CrossChainLibV4 — see AegisVault_v4.sol imports.
  console.log("\n[2/5] CrossChainLibV4");
  let crossChainLibV4Addr = deployments.crossChainLibraryV4;
  if (crossChainLibV4Addr && (await isContract(ethers.provider, crossChainLibV4Addr))) {
    crossChainLibV4Addr = checksum(crossChainLibV4Addr);
    console.log("      reused   :", crossChainLibV4Addr);
  } else {
    const CrossChainLibV4 = await ethers.getContractFactory("CrossChainLibV4");
    const lib = await CrossChainLibV4.deploy();
    await lib.waitForDeployment();
    crossChainLibV4Addr = checksum(await lib.getAddress());
    console.log("      deployed :", crossChainLibV4Addr);
  }

  // ── 3. AegisVault_v4 implementation ──
  console.log("\n[3/5] AegisVault_v4 implementation");
  let implV4Addr = deployments.aegisVaultImplementationV4;
  if (implV4Addr && (await isContract(ethers.provider, implV4Addr))) {
    implV4Addr = checksum(implV4Addr);
    console.log("      reused   :", implV4Addr);
  } else {
    const VaultV4 = await ethers.getContractFactory("AegisVault_v4", {
      libraries: {
        ExecLibV4:       execLibV4Addr,
        SealedLib:       sealedLibAddr,
        IOLib:           ioLibAddr,
        CrossChainLibV4: crossChainLibV4Addr,
      },
    });
    const impl = await VaultV4.deploy();
    await impl.waitForDeployment();
    implV4Addr = checksum(await impl.getAddress());
    console.log("      deployed :", implV4Addr);
  }

  // ── 4. AegisVaultFactoryV4 ──
  console.log("\n[4/5] AegisVaultFactoryV4");
  let factoryV4Addr = deployments.aegisVaultFactoryV4;
  let factoryAlreadyDeployed = false;
  if (factoryV4Addr && (await isContract(ethers.provider, factoryV4Addr))) {
    factoryV4Addr = checksum(factoryV4Addr);
    factoryAlreadyDeployed = true;
    console.log("      reused   :", factoryV4Addr);

    // Sanity check the reused factory points at the impl we expect.
    const reusedFactory = await ethers.getContractAt(
      "AegisVaultFactoryV4",
      factoryV4Addr
    );
    const seenImpl = checksum(await reusedFactory.vaultImplementation());
    if (seenImpl !== implV4Addr) {
      throw new Error(
        `Reused factory ${factoryV4Addr} points at impl ${seenImpl}, expected ${implV4Addr} — ` +
          `delete aegisVaultFactoryV4 from deployments file to redeploy.`
      );
    }
  } else {
    const FactoryV4 = await ethers.getContractFactory("AegisVaultFactoryV4");
    const factory = await FactoryV4.deploy(implV4Addr, registryV3Addr, treasury);
    await factory.waitForDeployment();
    factoryV4Addr = checksum(await factory.getAddress());
    console.log("      deployed :", factoryV4Addr);
  }

  // ── 5. Authorize V4 factory in the shared ExecutionRegistry ──
  //
  //   ExecutionRegistry exposes `authorizedFactories` so multiple factory
  //   versions can coexist on a single registry. V4 needs to be added to
  //   that set so its clones can call `registry.authorizeVault` during
  //   their own deployment. v1/v2/v3 authorisations are never touched.
  console.log("\n[5/5] Wire V4 factory into ExecutionRegistry");
  const registry = await ethers.getContractAt("ExecutionRegistry", registryV3Addr);
  const alreadyAuthorized = await registry.authorizedFactories(factoryV4Addr);
  if (alreadyAuthorized) {
    console.log("      already authorized → no-op");
  } else {
    const regAdmin = checksum(await registry.admin());
    if (regAdmin !== checksum(deployer.address)) {
      console.log(
        `\n  ⚠  Registry admin is ${regAdmin}, not the current deployer.\n` +
        `     Run this from the admin signer:\n` +
        `       cast send ${registryV3Addr} \\\n` +
        `         "authorizeFactory(address)" ${factoryV4Addr} \\\n` +
        `         --rpc-url <RPC> --private-key <ADMIN_KEY>`
      );
    } else {
      const tx = await registry.authorizeFactory(factoryV4Addr);
      await tx.wait();
      console.log("      authorizeFactory(v4) → set ✓ (tx", tx.hash + ")");
    }
  }

  // ── Persist deployment record ──
  if (!factoryAlreadyDeployed) {
    deployments.execLibraryV4 = execLibV4Addr;
    deployments.crossChainLibraryV4 = crossChainLibV4Addr;
    deployments.aegisVaultImplementationV4 = implV4Addr;
    deployments.aegisVaultFactoryV4 = factoryV4Addr;
    deployments.v4DeployedAt = new Date().toISOString();
    deployments.v4Deployer = deployer.address;
    fs.writeFileSync(deployFile, JSON.stringify(deployments, null, 2));
    console.log("\n📝 Wrote V4 addresses to", path.basename(deployFile));
  } else {
    console.log("\n📝 No deployment-file write needed (V4 reused).");
  }

  // ── Summary ──
  console.log("\n" + "─".repeat(72));
  console.log("V4 deploy complete");
  console.log("─".repeat(72));
  console.log("  ExecLibV4               :", execLibV4Addr);
  console.log("  AegisVault_v4 impl      :", implV4Addr);
  console.log("  AegisVaultFactoryV4     :", factoryV4Addr);
  console.log("  ExecutionRegistry (v3)  :", registryV3Addr);
  console.log("\nNext steps:");
  console.log("  1. node scripts/sync-frontend.js deployments-mainnet.json");
  console.log("  2. Verify on chainscan: " + factoryV4Addr);
  console.log("  3. Restart orchestrator — V4 vault discovery is automatic.");
  console.log("  4. Smoke-test: create a V4 vault with a known operator manifest hash.");
  console.log("─".repeat(72));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ V4 deploy failed:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
