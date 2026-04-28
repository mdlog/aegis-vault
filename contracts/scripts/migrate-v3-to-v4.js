#!/usr/bin/env node
/**
 * migrate-v3-to-v4.js
 *
 * Read-only planner that walks every V3 vault deployed by the canonical
 * AegisVaultFactoryV3, snapshots the state needed to recreate it as a V4
 * vault, and emits a JSON migration plan + human-readable summary.
 *
 * The V4 architecture binds an operator strategy manifest hash to each
 * vault at create-time (see contracts/v4/AegisVault_v4.sol). V3 vaults
 * have no equivalent storage slot, so an in-place upgrade would require
 * extending the EIP-1167 clone's storage map — which is not possible
 * without breaking the existing layout. The migration is therefore an
 * OPT-IN, USER-DRIVEN flow: each depositor withdraws from V3, then
 * creates a fresh V4 vault and re-deposits.
 *
 * This script DOES NOT submit any transactions. It only:
 *   1. Reads V3 factory + per-vault state via eth_call.
 *   2. Resolves a recommended `acceptedManifestHash` per vault by
 *      consulting the OperatorRegistryV2 for the operator's most recent
 *      published manifest (when present).
 *   3. Emits a plan JSON the frontend's migration wizard can consume,
 *      plus a console-printed summary humans can audit.
 *
 * Idempotent: running it twice produces the same plan (modulo a
 * `generatedAt` timestamp). Safe to point at mainnet at any time.
 *
 * Usage:
 *   node scripts/migrate-v3-to-v4.js [--output PATH] [--rpc URL] [--deployments PATH]
 *
 * Examples:
 *   node scripts/migrate-v3-to-v4.js --output ./v3-to-v4-plan.json
 *   node scripts/migrate-v3-to-v4.js --rpc https://evmrpc.0g.ai
 *   node scripts/migrate-v3-to-v4.js --deployments ./deployments-mainnet.json --output /tmp/plan.json
 *
 * Env overrides (CLI flags win):
 *   RPC_URL, DEPLOYMENTS_FILE, MIGRATION_OUTPUT
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── ABIs (minimal — only what we read) ──

const FACTORY_V3_ABI = [
  'function totalVaults() view returns (uint256)',
  'function getVaultAt(uint256 index) view returns (address)',
  'function isVault(address) view returns (bool)',
  'function requestedMaxCrossChainFeeBps(address) view returns (uint16)',
  'function vaultImplementation() view returns (address)',
];

// V3 vault — only the slots we need to reconstruct V4 init args.
const VAULT_V3_ABI = [
  'function owner() view returns (address)',
  'function executor() view returns (address)',
  'function baseAsset() view returns (address)',
  'function venue() view returns (address)',
  'function totalDeposited() view returns (uint256)',
  'function maxCrossChainFeeBps() view returns (uint16)',
  'function getAllowedAssets() view returns (address[])',
  'function getPolicy() view returns (tuple(uint256 maxPositionBps, uint256 maxDailyLossBps, uint256 stopLossBps, uint256 cooldownSeconds, uint256 confidenceThresholdBps, uint256 maxActionsPerDay, bool autoExecution, bool paused, uint256 performanceFeeBps, uint256 managementFeeBps, uint256 entryFeeBps, uint256 exitFeeBps, address feeRecipient, bool sealedMode, address attestedSigner))',
];

// OperatorRegistryV2 — used to look up the operator's currently published
// manifest hash so we can suggest an acceptedManifestHash for V4.
const OPERATOR_REGISTRY_ABI = [
  'function getOperator(address) view returns (tuple(address operator, string name, string description, string manifestUri, bytes32 manifestHash, bool active, uint8 tier, uint256 stake, uint256 registeredAt, uint256 updatedAt, uint256 reputation))',
];

// ── CLI ──

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--output' || a === '-o') out.output = argv[++i];
    else if (a === '--rpc') out.rpc = argv[++i];
    else if (a === '--deployments') out.deployments = argv[++i];
    else if (a === '--dry-run') out.dryRun = true; // accepted for symmetry; this script is always read-only
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) {
      console.warn(`unknown flag: ${a}`);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`migrate-v3-to-v4.js — V3 → V4 migration planner (read-only)

Options:
  --output, -o <path>      Where to write the plan JSON (default: ./v3-to-v4-plan.json)
  --rpc <url>              RPC URL (default: env RPC_URL or https://evmrpc.0g.ai)
  --deployments <path>     Deployments JSON (default: ../deployments-mainnet.json)
  --dry-run                Accepted for symmetry — this script is always read-only
  --help, -h               Show this help

Output:
  Writes a JSON document with one entry per V3 vault, each containing the
  parameters the frontend wizard (or a human) needs to call
  AegisVaultFactoryV4.createVault(). NO transactions are submitted.
`);
}

// ── Helpers ──

function loadDeployments(deploymentsPath) {
  const filePath = deploymentsPath
    || process.env.DEPLOYMENTS_FILE
    || path.join(__dirname, '..', 'deployments-mainnet.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`deployments file not found: ${filePath}`);
  }
  return { path: filePath, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
}

// V4 createVault expects the SAME VaultPolicy struct V3 uses. We forward
// the V3 policy verbatim; the V4 vault adds the strategy hash as a
// SEPARATE init arg so the policy struct itself is unchanged.
function policyToCreateArgs(policy) {
  return {
    maxPositionBps:         policy.maxPositionBps.toString(),
    maxDailyLossBps:        policy.maxDailyLossBps.toString(),
    stopLossBps:            policy.stopLossBps.toString(),
    cooldownSeconds:        policy.cooldownSeconds.toString(),
    confidenceThresholdBps: policy.confidenceThresholdBps.toString(),
    maxActionsPerDay:       policy.maxActionsPerDay.toString(),
    autoExecution:          policy.autoExecution,
    paused:                 policy.paused,
    performanceFeeBps:      policy.performanceFeeBps.toString(),
    managementFeeBps:       policy.managementFeeBps.toString(),
    entryFeeBps:            policy.entryFeeBps.toString(),
    exitFeeBps:             policy.exitFeeBps.toString(),
    feeRecipient:           policy.feeRecipient,
    sealedMode:             policy.sealedMode,
    attestedSigner:         policy.attestedSigner,
  };
}

// Resolve the recommended acceptedManifestHash for a vault.
//   1. Read the operator's currently published manifest hash from the
//      OperatorRegistryV2.
//   2. If the registry returns ZeroHash (operator hasn't published yet),
//      fall back to ZeroHash — V4 supports this as the "backwards-compat
//      valve" mode (see AegisVault_v4 NatSpec).
async function resolveManifestHash(operatorRegistry, operatorAddress) {
  if (!operatorRegistry) return { hash: ethers.ZeroHash, source: 'no-registry' };
  try {
    const op = await operatorRegistry.getOperator(operatorAddress);
    const h = op.manifestHash;
    if (!h || h === ethers.ZeroHash) {
      return { hash: ethers.ZeroHash, source: 'operator-unpublished' };
    }
    return { hash: h, source: 'operator-registry', manifestUri: op.manifestUri };
  } catch (err) {
    return { hash: ethers.ZeroHash, source: `registry-error:${err.message?.slice(0, 80)}` };
  }
}

// Fail-soft snapshot of one vault — never throws on a single bad vault;
// returns an entry with `error` populated so the operator can see which
// addresses misbehaved without losing the rest of the plan.
async function snapshotVault(provider, vaultAddr, factory, operatorRegistry) {
  try {
    const vault = new ethers.Contract(vaultAddr, VAULT_V3_ABI, provider);
    const [
      owner, executor, baseAsset, venue, totalDeposited,
      maxCrossChainFeeBps, allowedAssets, policy,
    ] = await Promise.all([
      vault.owner(),
      vault.executor(),
      vault.baseAsset(),
      vault.venue(),
      vault.totalDeposited(),
      vault.maxCrossChainFeeBps(),
      vault.getAllowedAssets(),
      vault.getPolicy(),
    ]);

    let requestedFee = maxCrossChainFeeBps;
    try {
      // Factory mirror is the value the user originally requested at
      // create time — may differ from the on-vault setting if the owner
      // later called setMaxCrossChainFeeBps.
      requestedFee = await factory.requestedMaxCrossChainFeeBps(vaultAddr);
    } catch { /* legacy vault not in factory mapping */ }

    const manifest = await resolveManifestHash(operatorRegistry, executor);

    return {
      v3Vault: vaultAddr,
      owner,
      executor,
      baseAsset,
      venue,
      totalDeposited: totalDeposited.toString(),
      allowedAssets,
      policy: policyToCreateArgs(policy),
      currentMaxCrossChainFeeBps: Number(maxCrossChainFeeBps),
      requestedMaxCrossChainFeeBps: Number(requestedFee),
      // V4 createVault arg recipe — exactly what the frontend wizard
      // (or a human) needs to call factory.createVault on V4.
      v4CreateArgs: {
        operator: executor,
        baseAsset,
        venue,
        policy: policyToCreateArgs(policy),
        allowedAssets,
        maxCrossChainFeeBps: Number(requestedFee),
        acceptedManifestHash: manifest.hash,
      },
      acceptedManifestHashSource: manifest.source,
      acceptedManifestUri: manifest.manifestUri || null,
      suggestedInitialDeposit: totalDeposited.toString(),
      // Ordered checklist the wizard can render verbatim.
      migrationSteps: [
        `1. Pause the V3 vault (owner-only): vault.pause() at ${vaultAddr}`,
        `2. Withdraw all non-base tokens: vault.withdrawAllNonBase()`,
        `3. Withdraw the base asset: vault.withdraw(${totalDeposited.toString()})`,
        `4. Approve V4 factory + call createVault(...) with v4CreateArgs above`,
        `5. Deposit into the new V4 vault (suggested: ${totalDeposited.toString()} of ${baseAsset})`,
      ],
    };
  } catch (err) {
    return {
      v3Vault: vaultAddr,
      error: `snapshot failed: ${err.message?.slice(0, 200)}`,
    };
  }
}

// ── Main ──

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return; }

  const rpcUrl = args.rpc || process.env.RPC_URL || 'https://evmrpc.0g.ai';
  const outputPath = args.output || process.env.MIGRATION_OUTPUT || path.join(process.cwd(), 'v3-to-v4-plan.json');

  const { path: deploymentsPath, data: deployments } = loadDeployments(args.deployments);
  const v3FactoryAddr = deployments.aegisVaultFactoryV3;
  if (!v3FactoryAddr) {
    throw new Error(`aegisVaultFactoryV3 not in ${deploymentsPath}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();

  const factory = new ethers.Contract(v3FactoryAddr, FACTORY_V3_ABI, provider);
  const operatorRegistry = deployments.operatorRegistryV2
    ? new ethers.Contract(deployments.operatorRegistryV2, OPERATOR_REGISTRY_ABI, provider)
    : null;

  const total = Number(await factory.totalVaults());
  console.log(`migrate-v3-to-v4 — chain ${network.chainId} via ${rpcUrl}`);
  console.log(`  V3 factory       : ${v3FactoryAddr}`);
  console.log(`  operator registry: ${deployments.operatorRegistryV2 || '(none)'}`);
  console.log(`  V3 vault count   : ${total}`);

  const vaults = [];
  for (let i = 0; i < total; i++) {
    const addr = await factory.getVaultAt(i);
    process.stdout.write(`  · snapshot ${i + 1}/${total} @ ${addr}\r`);
    vaults.push(await snapshotVault(provider, addr, factory, operatorRegistry));
  }
  if (total > 0) process.stdout.write('\n');

  const plan = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    chainId: Number(network.chainId),
    rpcUrl,
    v3Factory: v3FactoryAddr,
    v4FactoryHint: deployments.aegisVaultFactoryV4 || null,
    operatorRegistry: deployments.operatorRegistryV2 || null,
    totalVaults: total,
    vaults,
    notes: [
      'This plan is READ-ONLY. No transactions are submitted by this script.',
      'Each vault entry contains v4CreateArgs ready to feed into AegisVaultFactoryV4.createVault().',
      'acceptedManifestHash defaults to the operator\'s currently-published manifest hash; falls back to bytes32(0) when none is published.',
      'Migration is opt-in, per-vault. V3 stays operational until the depositor withdraws.',
    ],
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(plan, null, 2));
  console.log(`  plan written     : ${outputPath}`);

  // Human-readable summary
  console.log('\n── summary ──');
  if (vaults.length === 0) {
    console.log('  no V3 vaults found — nothing to migrate');
  } else {
    for (const v of vaults) {
      if (v.error) {
        console.log(`  [skip] ${v.v3Vault} — ${v.error}`);
        continue;
      }
      const totalUnits = v.totalDeposited;
      const manifestNote = v.v4CreateArgs.acceptedManifestHash === ethers.ZeroHash
        ? `(${v.acceptedManifestHashSource})`
        : `from ${v.acceptedManifestHashSource}`;
      console.log(`  ${v.v3Vault}`);
      console.log(`    owner=${v.owner}`);
      console.log(`    operator=${v.executor}`);
      console.log(`    baseAsset=${v.baseAsset}  totalDeposited=${totalUnits}`);
      console.log(`    acceptedManifestHash=${v.v4CreateArgs.acceptedManifestHash} ${manifestNote}`);
    }
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
