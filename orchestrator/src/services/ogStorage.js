import {
  Indexer,
  KvClient,
  ZgFile,
  getFlowContract,
  Batcher,
} from '@0glabs/0g-ts-sdk';
import { ethers } from 'ethers';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import config from '../config/index.js';
import { getSigner, getProvider } from '../config/contracts.js';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDataDir = config.dataDir
  ? resolve(process.cwd(), config.dataDir)
  : resolve(__dirname, '../../data');
const TMP_DIR = resolve(baseDataDir, 'tmp');

if (!existsSync(TMP_DIR)) {
  mkdirSync(TMP_DIR, { recursive: true });
}

// ── 0G Storage Configuration ──

// Default to 0G Aristotle mainnet endpoints (per docs.0g.ai/developer-hub/
// mainnet/mainnet-overview). Operators can override via env to switch to
// Galileo testnet or a private deployment. KV_RPC has no official mainnet
// endpoint published yet — leave empty in env to disable kvGet (kvSet
// write-side still works through Indexer + Flow contract).
const OG_INDEXER_RPC = process.env.OG_INDEXER_RPC ?? 'https://indexer-storage-turbo.0g.ai';
const OG_KV_RPC = process.env.OG_KV_RPC ?? '';
const OG_FLOW_CONTRACT = process.env.OG_FLOW_CONTRACT ?? '0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526';

// Write toggle. The mainnet FixedPriceFlow contract is currently
// rejecting our `submit()` calls with a bare `require(false)` — same
// shape as the contract's `Can not find proper context` revert in
// `Flow.queryContextAtPosition()`. Until the upstream condition is
// understood (newer SDK release, mainnet stake/registration step, or
// docs from the 0G team), let operators turn writes off without
// disabling the indexer reads or breaking the rest of init.
//
// `false` (default) skips kvSet + uploadJsonBlob without error. The
// frontend keeps reading from the local mirror under `data/`. Set
// `OG_STORAGE_WRITES_ENABLED=true` once submissions land cleanly to
// resume on-chain anchoring.
const OG_WRITES_ENABLED = String(process.env.OG_STORAGE_WRITES_ENABLED ?? 'false').toLowerCase() === 'true';

// Stream ID for KV store — derived from vault address for uniqueness
let STREAM_ID = process.env.OG_STREAM_ID || null;

// ── Client Instances ──

let _indexer = null;
let _kvClient = null;
let _flowContract = null;
let _initialized = false;

/**
 * Initialize 0G Storage clients
 */
export async function initOGStorage() {
  try {
    // Skip entirely if OG_INDEXER_RPC is explicitly empty in .env
    if (process.env.OG_INDEXER_RPC === '') {
      logger.info('0G Storage disabled (OG_INDEXER_RPC empty in .env)');
      return false;
    }
    logger.info('Initializing 0G Storage...');

    _indexer = new Indexer(OG_INDEXER_RPC);

    // Workaround for @0glabs/0g-ts-sdk@0.3.3 against the Aristotle mainnet
    // indexer. The SDK's `selectNodes()` does `nodes.trusted.sort()` without
    // a null check, which crashes because the mainnet indexer returns
    // `trusted: null` (curated list not populated yet) and only fills
    // `discovered`. Patch the per-instance `getShardedNodes()` so the
    // returned shape always has a non-null `trusted` array.
    //
    // Removable when 0G publishes either (a) a populated trusted set, or
    // (b) a SDK release that handles `trusted=null`.
    const origGetShardedNodes = _indexer.getShardedNodes.bind(_indexer);
    _indexer.getShardedNodes = async function patchedGetShardedNodes() {
      const nodes = await origGetShardedNodes();
      if (!Array.isArray(nodes?.trusted) || nodes.trusted.length === 0) {
        nodes.trusted = Array.isArray(nodes?.discovered) ? nodes.discovered : [];
      }
      return nodes;
    };
    // KV node URL is optional. Mainnet has no official public endpoint as
    // of this writing — operators host their own. When unset, kvSet still
    // works (it uploads via the indexer + Flow contract), but kvGet returns
    // null and the caller falls back to local journal/state.
    _kvClient = OG_KV_RPC ? new KvClient(OG_KV_RPC) : null;

    // Get flow contract for uploads
    const signer = getSigner();
    _flowContract = getFlowContract(OG_FLOW_CONTRACT, signer);

    // Derive a stream ID. Priority:
    //   1. OG_STREAM_ID env (manual override)
    //   2. Per-vault stream when a single VAULT_ADDRESS is configured
    //   3. Per-chain orchestrator stream as fallback (multi-vault setups)
    // Without any of these, KV operations would receive `null` as the
    // stream ID and ethers would reject it with "invalid BytesLike value".
    if (!STREAM_ID) {
      if (config.contracts.vault) {
        STREAM_ID = ethers.keccak256(
          ethers.toUtf8Bytes(`aegis-vault-${config.contracts.vault}`)
        );
      } else {
        const chainId = config.chainId || process.env.CHAIN_ID || 'default';
        STREAM_ID = ethers.keccak256(
          ethers.toUtf8Bytes(`aegis-orchestrator-${chainId}`)
        );
      }
    }

    _initialized = true;
    logger.info(`0G Storage initialized`);
    logger.info(`  Indexer: ${OG_INDEXER_RPC}`);
    logger.info(`  KV Node: ${OG_KV_RPC || '(unset — kvGet disabled, writes still work)'}`);
    logger.info(`  Flow:    ${OG_FLOW_CONTRACT}`);
    logger.info(`  Stream:  ${STREAM_ID || 'Not set'}`);

    return true;
  } catch (err) {
    logger.warn(`0G Storage initialization failed: ${err.message}`);
    logger.warn('Falling back to local-only storage');
    _initialized = false;
    return false;
  }
}

/**
 * Check if 0G Storage is available
 */
export function isOGStorageAvailable() {
  return _initialized;
}

// ══════════════════════════════════════════════
//  KV Store Operations
// ══════════════════════════════════════════════

/**
 * Write a key-value pair to 0G KV Storage
 * @param {string} key - The key
 * @param {object|string} value - The value (will be JSON serialized if object)
 */
export async function kvSet(key, value) {
  if (!_initialized) {
    logger.debug('0G Storage not available — skipping KV set');
    return null;
  }
  if (!OG_WRITES_ENABLED) {
    // Writes intentionally disabled (default). Caller falls back to
    // local mirror. See OG_WRITES_ENABLED comment near the top.
    return null;
  }

  try {
    const signer = getSigner();

    // Select storage nodes
    const [nodes, nodesErr] = await _indexer.selectNodes(1);
    if (nodesErr) {
      throw new Error(`Node selection failed: ${nodesErr}`);
    }

    // Create batcher
    const batcher = new Batcher(1, nodes, _flowContract, config.rpcUrl);

    // Encode key and value
    const keyBytes = new Uint8Array(Buffer.from(key, 'utf-8'));
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    const valueBytes = new Uint8Array(Buffer.from(valueStr, 'utf-8'));

    // Set in stream
    batcher.streamDataBuilder.set(STREAM_ID, keyBytes, valueBytes);

    // Execute
    const [tx, execErr] = await batcher.exec();
    if (execErr) {
      throw new Error(`Batcher exec failed: ${execErr}`);
    }

    logger.info(`0G KV set: ${key} (${valueBytes.length} bytes) — TX: ${tx}`);
    return tx;

  } catch (err) {
    logger.warn(`0G KV set failed for key "${key}": ${err.message}`);
    return null;
  }
}

/**
 * Read a value from 0G KV Storage
 * @param {string} key - The key to read
 * @returns {object|string|null} The value, or null if not found
 */
export async function kvGet(key) {
  if (!_initialized) {
    logger.debug('0G Storage not available — skipping KV get');
    return null;
  }
  if (!_kvClient) {
    // No KV node configured — caller falls back to local state. This is the
    // expected path on mainnet today, where no public KV endpoint is published.
    return null;
  }

  try {
    const keyBytes = new Uint8Array(Buffer.from(key, 'utf-8'));
    const keyBase64 = Buffer.from(keyBytes).toString('base64');

    const valueBytes = await _kvClient.getValue(STREAM_ID, keyBase64);

    if (!valueBytes || valueBytes.length === 0) {
      return null;
    }

    const valueStr = Buffer.from(valueBytes).toString('utf-8');

    // Try to parse as JSON
    try {
      return JSON.parse(valueStr);
    } catch {
      return valueStr;
    }

  } catch (err) {
    logger.warn(`0G KV get failed for key "${key}": ${err.message}`);
    return null;
  }
}

// ══════════════════════════════════════════════
//  Blob / File Storage Operations
// ══════════════════════════════════════════════

/**
 * Upload a JSON object as a blob to 0G Storage
 * @param {string} name - Logical name for the blob
 * @param {object} data - Data to serialize and upload
 * @returns {{ rootHash: string, txHash: string } | null}
 */
export async function uploadBlob(name, data) {
  if (!_initialized) {
    logger.debug('0G Storage not available — skipping blob upload');
    return null;
  }
  if (!OG_WRITES_ENABLED) {
    // Writes intentionally disabled (default). Caller falls back to
    // local journal. See OG_WRITES_ENABLED comment near the top.
    return null;
  }

  try {
    const signer = getSigner();
    const jsonStr = JSON.stringify(data, null, 2);

    // Write to temp file (SDK requires file path)
    const tmpPath = resolve(TMP_DIR, `${name}-${Date.now()}.json`);
    writeFileSync(tmpPath, jsonStr);

    // Create ZgFile
    const zgFile = await ZgFile.fromFilePath(tmpPath);
    const [tree, treeErr] = await zgFile.merkleTree();
    if (treeErr) {
      await zgFile.close();
      throw new Error(`Merkle tree error: ${treeErr}`);
    }

    const rootHash = tree.rootHash();
    logger.info(`Uploading blob "${name}" — Root: ${rootHash.substring(0, 18)}... (${jsonStr.length} bytes)`);

    // Upload
    const [tx, uploadErr] = await _indexer.upload(zgFile, config.rpcUrl, signer);
    await zgFile.close();

    // Cleanup temp file
    try { unlinkSync(tmpPath); } catch {}

    if (uploadErr) {
      throw new Error(`Upload error: ${uploadErr}`);
    }

    logger.info(`Blob "${name}" uploaded — TX: ${tx}`);

    return {
      rootHash,
      name,
      size: jsonStr.length,
      timestamp: new Date().toISOString(),
    };

  } catch (err) {
    logger.warn(`Blob upload failed for "${name}": ${err.message}`);
    return null;
  }
}

/**
 * Download a blob from 0G Storage by root hash
 * @param {string} rootHash - The root hash of the blob
 * @returns {object|null} Parsed JSON data
 */
export async function downloadBlob(rootHash) {
  if (!_initialized) {
    logger.debug('0G Storage not available — skipping blob download');
    return null;
  }

  try {
    const outputPath = resolve(TMP_DIR, `download-${Date.now()}.json`);

    const err = await _indexer.download(rootHash, outputPath, true);
    if (err) {
      throw new Error(`Download error: ${err}`);
    }

    const { readFileSync } = await import('fs');
    const data = JSON.parse(readFileSync(outputPath, 'utf-8'));

    // Cleanup
    try { unlinkSync(outputPath); } catch {}

    return data;

  } catch (err) {
    logger.warn(`Blob download failed for ${rootHash}: ${err.message}`);
    return null;
  }
}

// ══════════════════════════════════════════════
//  High-level Aegis Vault Storage Operations
// ══════════════════════════════════════════════

/**
 * Sync vault KV state to 0G Storage
 * Writes current snapshot under the key "vault-state"
 */
export async function syncVaultState(state) {
  return kvSet('vault-state', {
    ...state,
    syncedAt: new Date().toISOString(),
  });
}

/**
 * Read vault KV state from 0G Storage
 */
export async function readVaultStateFromOG() {
  return kvGet('vault-state');
}

/**
 * Upload a journal batch to 0G Storage as a blob
 * Batches entries to avoid uploading one-by-one
 */
export async function uploadJournalBatch(entries) {
  if (!entries || entries.length === 0) return null;

  const batch = {
    type: 'journal-batch',
    vault: config.contracts.vault,
    entries,
    count: entries.length,
    createdAt: new Date().toISOString(),
  };

  const result = await uploadBlob(`journal-${Date.now()}`, batch);

  if (result) {
    // Store the root hash reference in KV
    const refs = (await kvGet('journal-refs')) || [];
    refs.push({
      rootHash: result.rootHash,
      count: entries.length,
      timestamp: result.timestamp,
    });
    // Keep last 100 references
    await kvSet('journal-refs', refs.slice(-100));
  }

  return result;
}

/**
 * Upload an AI decision snapshot to 0G Storage
 */
export async function uploadDecisionSnapshot(decision, marketData, vaultState) {
  const snapshot = {
    type: 'decision-snapshot',
    vault: config.contracts.vault,
    decision,
    marketPrices: Object.entries(marketData.prices || {}).map(([sym, d]) => ({
      symbol: sym,
      price: d.price,
      change24h: d.change24h,
    })),
    vaultNAV: vaultState.nav,
    timestamp: new Date().toISOString(),
  };

  return uploadBlob(`decision-${Date.now()}`, snapshot);
}

/**
 * Upload execution report to 0G Storage
 */
export async function uploadExecutionReport(intent, result, decision) {
  const report = {
    type: 'execution-report',
    vault: config.contracts.vault,
    intentHash: intent?.intentHash,
    action: decision.action,
    asset: decision.asset,
    confidence: decision.confidence,
    riskScore: decision.risk_score,
    reason: decision.reason,
    success: result.success,
    txHash: result.txHash || null,
    error: result.error || null,
    timestamp: new Date().toISOString(),
  };

  return uploadBlob(`execution-${Date.now()}`, report);
}
