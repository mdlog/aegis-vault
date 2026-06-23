/**
 * Vault Indexer (in-process)
 *
 * Production-grade replacement for `factory.allVaults()` polling. Instead of
 * scanning the full factory array every cycle, we:
 *
 *   1. Backfill once on startup: query `factory.allVaults()` length + iterate
 *      `getVaultAt(i)` to populate SQLite cache.
 *   2. Subscribe to `VaultDeployed` events going forward — append-only.
 *   3. Cycle reads vault list from SQLite (microseconds, scales to 100k+ vaults).
 *
 * Compared to the naive polling approach this gives:
 *   - O(1) vault list reads per cycle instead of O(N) RPC calls
 *   - Vault metadata persisted across orchestrator restarts
 *   - Hot-reload: new vaults visible the moment VaultDeployed fires (no wait
 *     for next cycle to pick them up)
 *
 * Storage: better-sqlite3 (embedded, zero infra). For ≥100k vaults or
 * multi-instance orchestrators, swap the IndexerStore impl for Postgres
 * without touching consumers.
 */

import { ethers } from 'ethers';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { ABIs, getProvider, getFactoryContract } from '../config/contracts.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// In-memory store (Map for O(1) lookups by address) + JSON file backup
// Avoids native bindings (better-sqlite3) so the orchestrator runs on any Node
// version without rebuild. Scales to ~10k vaults comfortably; for >10k swap to
// SQLite or Postgres.
let initialized = false;
let vaults = new Map();              // address.toLowerCase() => record
let executorIndex = new Map();        // executor.toLowerCase() => Set<address>
let lastIndexedBlock = 0;
let dbPath = null;
let pollTimer = null;

const POLL_INTERVAL_MS = 15_000;        // poll for new VaultDeployed every 15s
const BLOCK_LOOKBACK = 50;              // re-scan last 50 blocks each poll for safety

function ensureDb() {
  if (initialized) return;

  const dataDir = resolve(__dirname, '../../', config.dataDir || 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  dbPath = resolve(dataDir, 'vault-index.json');

  // Restore from disk if available
  if (existsSync(dbPath)) {
    try {
      const raw = JSON.parse(readFileSync(dbPath, 'utf8'));
      lastIndexedBlock = raw.lastIndexedBlock || 0;
      for (const v of raw.vaults || []) {
        const key = v.address.toLowerCase();
        vaults.set(key, v);
        const exKey = (v.executor || '').toLowerCase();
        if (!executorIndex.has(exKey)) executorIndex.set(exKey, new Set());
        executorIndex.get(exKey).add(key);
      }
    } catch (err) {
      logger.warn(`Vault indexer: failed to restore from disk (${err.message}). Starting fresh.`);
    }
  }

  initialized = true;
  logger.info(`Vault indexer ready — ${vaults.size} cached vault(s), last block: ${lastIndexedBlock}`);
}

function persist() {
  if (!dbPath) return;
  try {
    writeFileSync(dbPath, JSON.stringify({
      lastIndexedBlock,
      vaults: Array.from(vaults.values()),
    }, null, 2));
  } catch (err) {
    logger.debug(`Vault indexer: persist failed (${err.message})`);
  }
}

function upsertVault(record) {
  ensureDb();
  const key = record.address.toLowerCase();
  const exKey = (record.executor || '').toLowerCase();

  // Update executor index (remove from old, add to new)
  const old = vaults.get(key);
  if (old) {
    const oldExKey = (old.executor || '').toLowerCase();
    if (oldExKey !== exKey && executorIndex.has(oldExKey)) {
      executorIndex.get(oldExKey).delete(key);
    }
  }
  if (!executorIndex.has(exKey)) executorIndex.set(exKey, new Set());
  executorIndex.get(exKey).add(key);

  vaults.set(key, record);
}

function setLastBlock(blockNumber) {
  lastIndexedBlock = blockNumber;
}

// Lazily-built interface for decoding vault events. Built on first use (not at
// module load) so pure helpers below stay importable in tests without needing a
// live ABI/provider.
let _vaultIface = null;
function vaultIface() {
  if (!_vaultIface) _vaultIface = new ethers.Interface(ABIs.AegisVault);
  return _vaultIface;
}

/**
 * Pure: reduce decoded ExecutorUpdated events into the executor reassignments to
 * apply. Filters to vaults the indexer already knows (knownKeys, lowercased) and
 * keeps the latest executor per vault, ordered by (blockNumber, logIndex).
 * Exported for unit testing — this is the core of operator-switch re-routing.
 *
 * @param {{vault:string,newExecutor:string,blockNumber:number,logIndex:number}[]} decoded
 * @param {Set<string>} knownKeys lowercased vault addresses present in the index
 * @returns {{address:string,executor:string}[]}
 */
export function buildExecutorUpdates(decoded, knownKeys) {
  const latest = new Map(); // key -> { executor, blockNumber, logIndex }
  for (const d of decoded || []) {
    const key = (d.vault || '').toLowerCase();
    if (!knownKeys.has(key)) continue;
    const prev = latest.get(key);
    const isNewer =
      !prev ||
      d.blockNumber > prev.blockNumber ||
      (d.blockNumber === prev.blockNumber && d.logIndex >= prev.logIndex);
    if (isNewer) latest.set(key, { executor: d.newExecutor, blockNumber: d.blockNumber, logIndex: d.logIndex });
  }
  return Array.from(latest.entries()).map(([address, v]) => ({ address, executor: v.executor }));
}

/**
 * Backfill: full scan of factory.allVaults() into SQLite.
 * Idempotent — INSERT OR REPLACE means safe to re-run.
 */
async function backfill() {
  ensureDb();
  const factory = getFactoryContract();
  const total = Number(await factory.totalVaults());
  if (total === 0) {
    logger.info('Indexer backfill: factory has 0 vaults');
    return 0;
  }

  let added = 0;
  let healed = 0;
  for (let i = 0; i < total; i++) {
    const address = await factory.getVaultAt(i);
    const cached = vaults.get(address.toLowerCase());
    const vault = new ethers.Contract(address, ABIs.AegisVault, getProvider());

    // Heal path: a vault already cached with an executor only needs its executor
    // re-read (1 RPC) so a setExecutor() that happened while the orchestrator was
    // DOWN is reflected and re-routed on next start (cold-start complement to the
    // live ExecutorUpdated poll).
    if (cached && cached.executor) {
      const executor = await vault.executor().catch(() => null);
      if (executor && executor.toLowerCase() !== cached.executor.toLowerCase()) {
        upsertVault({ ...cached, executor });
        healed++;
      }
      continue;
    }

    // New (or missing-executor) vault: read full metadata.
    const [owner, executor, baseAsset] = await Promise.all([
      vault.owner().catch(() => ethers.ZeroAddress),
      vault.executor().catch(() => ethers.ZeroAddress),
      vault.baseAsset().catch(() => ethers.ZeroAddress),
    ]);

    upsertVault({
      address,
      owner,
      executor,
      base_asset: baseAsset,
      created_block: cached?.created_block ?? 0,
      created_at: cached?.created_at ?? Math.floor(Date.now() / 1000),
      tx_hash: cached?.tx_hash ?? null,
    });
    if (cached) healed++; else added++;
  }

  if (healed > 0) logger.info(`Indexer backfill: healed ${healed} vault(s) (missing/changed executor)`);

  if (added > 0 || healed > 0) persist();
  logger.info(`Indexer backfill: ${added}/${total} vaults added`);
  return added;
}

/**
 * Poll for new VaultDeployed events since lastIndexedBlock.
 * Re-scans BLOCK_LOOKBACK blocks each poll for chain reorg safety.
 */
async function pollForNewVaults() {
  try {
    const provider = getProvider();
    const factory = getFactoryContract();
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, lastIndexedBlock - BLOCK_LOOKBACK, currentBlock - 5000); // cap lookback

    if (fromBlock >= currentBlock) return;

    const filter = factory.filters.VaultDeployed();
    // 0G RPC caps eth_getLogs to a 1000-block window. Chunk so cold-start
    // scans (up to 5000 blocks back) don't hang the request.
    const RPC_LOG_RANGE = 999;
    let events = [];
    for (let from = fromBlock; from <= currentBlock; from += RPC_LOG_RANGE) {
      const to = Math.min(from + RPC_LOG_RANGE - 1, currentBlock);
      const chunk = await factory.queryFilter(filter, from, to);
      events = events.concat(chunk);
    }

    for (const ev of events) {
      // V1/V2 emit `executor`; V3 renamed it to `operator` (and added `venue`
      // + `requestedMaxCrossChainFeeBps`). Accept both so the same indexer
      // path covers every factory generation.
      const { vault, owner, baseAsset, executor, operator, timestamp } = ev.args;
      upsertVault({
        address: vault,
        owner,
        executor: executor || operator,
        base_asset: baseAsset,
        created_block: ev.blockNumber,
        created_at: Number(timestamp || Math.floor(Date.now() / 1000)),
        tx_hash: ev.transactionHash,
      });
    }

    if (events.length > 0) {
      logger.info(`Indexer: ingested ${events.length} VaultDeployed events (blocks ${fromBlock}-${currentBlock})`);
      persist();
    }

    // Re-route vaults whose executor changed (owner called setExecutor →
    // ExecutorUpdated) so a switched vault is handed to the new executor's
    // orchestrator next cycle and the old one drops it.
    await pollExecutorChanges(fromBlock, currentBlock);

    setLastBlock(currentBlock);
  } catch (err) {
    logger.warn(`Indexer poll failed: ${err.message?.substring(0, 120)}`);
  }
}

/**
 * Poll ExecutorUpdated logs and re-route any KNOWN vault whose executor changed.
 * ExecutorUpdated is emitted from vault addresses (not the factory), so this is a
 * topic-only getLogs across the block range; same-signature logs from non-vault
 * contracts are dropped by the known-vault filter in buildExecutorUpdates.
 * Re-uses upsertVault, which moves the vault between executor-index buckets — so
 * getVaultsByExecutor (the cycle's discovery path) is immediately correct.
 */
async function pollExecutorChanges(fromBlock, currentBlock) {
  if (vaults.size === 0) return 0; // nothing indexed yet → nothing to re-route
  const provider = getProvider();
  const topic = vaultIface().getEvent('ExecutorUpdated').topicHash;
  const RPC_LOG_RANGE = 999;
  const decoded = [];
  for (let from = fromBlock; from <= currentBlock; from += RPC_LOG_RANGE) {
    const to = Math.min(from + RPC_LOG_RANGE - 1, currentBlock);
    const logs = await provider.getLogs({ topics: [topic], fromBlock: from, toBlock: to });
    for (const log of logs) {
      try {
        const parsed = vaultIface().parseLog(log);
        decoded.push({
          vault: parsed.args.vault,
          newExecutor: parsed.args.newExecutor,
          blockNumber: log.blockNumber,
          logIndex: log.index ?? log.logIndex ?? 0,
        });
      } catch {
        // not an AegisVault ExecutorUpdated (event-signature collision) — skip
      }
    }
  }

  const updates = buildExecutorUpdates(decoded, new Set(vaults.keys()));
  let changed = 0;
  for (const u of updates) {
    const existing = vaults.get(u.address);
    if (!existing) continue;
    if ((existing.executor || '').toLowerCase() === (u.executor || '').toLowerCase()) continue;
    upsertVault({ ...existing, executor: u.executor });
    changed++;
  }
  if (changed > 0) {
    logger.info(`Indexer: re-routed ${changed} vault(s) via ExecutorUpdated`);
    persist();
  }
  return changed;
}

/**
 * Start the indexer: backfill + start polling.
 */
export async function startIndexer() {
  ensureDb();
  await backfill().catch((err) => {
    logger.warn(`Indexer backfill error (will retry on poll): ${err.message}`);
  });

  // Start polling loop
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => pollForNewVaults().catch(() => {}), POLL_INTERVAL_MS);

  // Initial poll immediately
  pollForNewVaults().catch(() => {});

  logger.info(`Indexer started — polling every ${POLL_INTERVAL_MS / 1000}s`);
}

export function stopIndexer() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  persist();
}

/**
 * Query: vaults assigned to a specific executor wallet.
 * O(1) lookup via executor index.
 */
export function getVaultsByExecutor(executorAddress) {
  ensureDb();
  const exKey = (executorAddress || '').toLowerCase();
  const addrSet = executorIndex.get(exKey);
  if (!addrSet || addrSet.size === 0) return [];

  return Array.from(addrSet)
    .map((a) => vaults.get(a))
    .filter(Boolean)
    .sort((a, b) => (a.created_block || 0) - (b.created_block || 0));
}

/**
 * Query: all vaults (for admin / dashboards).
 */
export function getAllVaults() {
  ensureDb();
  return Array.from(vaults.values()).sort((a, b) => (a.created_block || 0) - (b.created_block || 0));
}

/**
 * Query: count by executor (for sharding / load balancing).
 */
export function getExecutorVaultCounts() {
  ensureDb();
  return Array.from(executorIndex.entries())
    .map(([executor, addrs]) => ({ executor, count: addrs.size }))
    .sort((a, b) => b.count - a.count);
}
