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
  for (let i = 0; i < total; i++) {
    const address = await factory.getVaultAt(i);
    if (vaults.has(address.toLowerCase())) continue;

    // Read on-chain metadata
    const vault = new ethers.Contract(address, ABIs.AegisVault, getProvider());
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
      created_block: 0,
      created_at: Math.floor(Date.now() / 1000),
      tx_hash: null,
    });
    added++;
  }

  if (added > 0) persist();
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
    const events = await factory.queryFilter(filter, fromBlock, currentBlock);

    for (const ev of events) {
      const { vault, owner, baseAsset, executor, timestamp } = ev.args;
      upsertVault({
        address: vault,
        owner,
        executor,
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

    setLastBlock(currentBlock);
  } catch (err) {
    logger.warn(`Indexer poll failed: ${err.message?.substring(0, 120)}`);
  }
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
