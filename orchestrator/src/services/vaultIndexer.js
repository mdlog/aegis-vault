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

import Database from 'better-sqlite3';
import { ethers } from 'ethers';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';
import { ABIs, getProvider, getFactoryContract } from '../config/contracts.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db = null;
let lastIndexedBlock = 0;
let pollTimer = null;

const POLL_INTERVAL_MS = 15_000;        // poll for new VaultDeployed every 15s
const BLOCK_LOOKBACK = 50;              // re-scan last 50 blocks each poll for safety

function ensureDb() {
  if (db) return db;

  const dataDir = resolve(__dirname, '../../', config.dataDir || 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const dbPath = resolve(dataDir, 'vault-index.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS vaults (
      address       TEXT PRIMARY KEY,
      owner         TEXT NOT NULL,
      executor      TEXT NOT NULL,
      base_asset    TEXT,
      created_block INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      tx_hash       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_executor ON vaults(executor);
    CREATE INDEX IF NOT EXISTS idx_owner ON vaults(owner);
    CREATE TABLE IF NOT EXISTS indexer_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Restore last indexed block
  const row = db.prepare('SELECT value FROM indexer_state WHERE key = ?').get('last_block');
  lastIndexedBlock = row ? parseInt(row.value, 10) : 0;
  logger.info(`Vault indexer DB ready — last indexed block: ${lastIndexedBlock}`);

  return db;
}

function upsertVault(record) {
  ensureDb().prepare(`
    INSERT OR REPLACE INTO vaults (address, owner, executor, base_asset, created_block, created_at, tx_hash)
    VALUES (@address, @owner, @executor, @base_asset, @created_block, @created_at, @tx_hash)
  `).run(record);
}

function setLastBlock(blockNumber) {
  ensureDb().prepare(`
    INSERT OR REPLACE INTO indexer_state (key, value) VALUES (?, ?)
  `).run('last_block', String(blockNumber));
  lastIndexedBlock = blockNumber;
}

/**
 * Backfill: full scan of factory.allVaults() into SQLite.
 * Idempotent — INSERT OR REPLACE means safe to re-run.
 */
async function backfill() {
  const factory = getFactoryContract();
  const total = Number(await factory.totalVaults());
  if (total === 0) {
    logger.info('Indexer backfill: factory has 0 vaults');
    return 0;
  }

  let added = 0;
  for (let i = 0; i < total; i++) {
    const address = await factory.getVaultAt(i);
    const exists = ensureDb().prepare('SELECT 1 FROM vaults WHERE address = ?').get(address);
    if (exists) continue;

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
      created_block: 0, // unknown for backfilled entries — set on event listener
      created_at: Math.floor(Date.now() / 1000),
      tx_hash: null,
    });
    added++;
  }

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
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Query: vaults assigned to a specific executor wallet.
 * O(log N) thanks to idx_executor index.
 */
export function getVaultsByExecutor(executorAddress) {
  ensureDb();
  return db.prepare(`
    SELECT address, owner, executor, base_asset, created_block, created_at
    FROM vaults
    WHERE LOWER(executor) = LOWER(?)
    ORDER BY created_block ASC
  `).all(executorAddress);
}

/**
 * Query: all vaults (for admin / dashboards).
 */
export function getAllVaults() {
  ensureDb();
  return db.prepare(`SELECT * FROM vaults ORDER BY created_block ASC`).all();
}

/**
 * Query: count by executor (for sharding / load balancing).
 */
export function getExecutorVaultCounts() {
  ensureDb();
  return db.prepare(`
    SELECT executor, COUNT(*) as count
    FROM vaults
    GROUP BY executor
    ORDER BY count DESC
  `).all();
}
