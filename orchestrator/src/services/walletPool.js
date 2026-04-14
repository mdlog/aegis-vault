/**
 * Wallet Pool — multi-executor sharding for parallel tx submission
 *
 * Why: ethers v6 NonceManager is per-wallet. With N vaults executing
 * concurrently from one signer, nonces collide and txs get stuck. With
 * a pool of M wallets, we shard N vaults across M wallets — each wallet
 * gets at most ceil(N/M) concurrent txs and its own nonce sequence.
 *
 * Sharding strategy: stable hash(vaultAddress) % poolSize → vault always
 * uses the same wallet. Avoids "nonce too low" from wallet rotation.
 *
 * Config: EXECUTOR_PRIVATE_KEYS env (comma-separated). Falls back to
 * single PRIVATE_KEY if pool not configured (backwards compat).
 *
 * IMPORTANT: every wallet in the pool must be configured as an executor
 * for the vaults it shards onto. The simplest way is to either:
 *   (a) Update each vault.executor to the assigned shard wallet, or
 *   (b) Set a single canonical executor and use this pool only as a
 *       transaction submission pool — sign as canonical, submit as shard.
 * This implementation uses approach (a) — set vault.executor at create time
 * to the wallet returned by walletForVault(vaultAddress).
 */

import { ethers, NonceManager } from 'ethers';
import { getProvider } from '../config/contracts.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let _pool = null;
let _addresses = null;

function buildPool() {
  if (_pool) return _pool;

  const provider = getProvider();
  const raw = process.env.EXECUTOR_PRIVATE_KEYS || '';
  const keys = raw.split(',').map((k) => k.trim()).filter(Boolean);

  // Backwards compat: if no pool configured, fall back to single PRIVATE_KEY
  if (keys.length === 0) {
    const fallback = (config.privateKey || '').replace(/^0x/, '');
    if (!fallback) {
      throw new Error('Wallet pool: no EXECUTOR_PRIVATE_KEYS or PRIVATE_KEY configured');
    }
    const wallet = new NonceManager(new ethers.Wallet(fallback, provider));
    _pool = [wallet];
  } else {
    _pool = keys.map((k) => {
      const clean = k.replace(/^0x/, '');
      return new NonceManager(new ethers.Wallet(clean, provider));
    });
  }

  // Resolve addresses (NonceManager doesn't expose .address synchronously in v6)
  _addresses = _pool.map((w) => w.signer?.address || (w._signer?.address) || null);
  // Fallback: derive from underlying signer
  _pool.forEach((w, i) => {
    if (!_addresses[i]) {
      const inner = w.signer || w._signer;
      _addresses[i] = inner.address;
    }
  });

  logger.info(`Wallet pool initialized — ${_pool.length} executor wallet(s):`);
  _addresses.forEach((addr, i) => logger.info(`  [${i}] ${addr}`));

  return _pool;
}

/**
 * Stable hash → wallet index. Same vault always picks the same wallet.
 * Avoids nonce conflicts from rotation.
 */
function shardIndex(vaultAddress) {
  const pool = buildPool();
  // Use last 4 bytes of address as deterministic shard key
  const lower = vaultAddress.toLowerCase().replace(/^0x/, '');
  const shardKey = parseInt(lower.slice(-8), 16);
  return shardKey % pool.length;
}

/**
 * Get the wallet (NonceManager-wrapped) assigned to handle this vault's txs.
 */
export function walletForVault(vaultAddress) {
  const pool = buildPool();
  return pool[shardIndex(vaultAddress)];
}

/**
 * Get the public address of the wallet assigned to a vault.
 * Use this to set vault.executor at creation time.
 */
export function addressForVault(vaultAddress) {
  buildPool();
  return _addresses[shardIndex(vaultAddress)];
}

/**
 * Get all wallet addresses in the pool.
 * Useful for status endpoints, indexer filtering, and operator dashboards.
 */
export function getPoolAddresses() {
  buildPool();
  return [..._addresses];
}

export function getPoolSize() {
  return buildPool().length;
}

/**
 * Pool stats for /api/status — show load distribution.
 */
export function getPoolStats(vaultsByExecutor = {}) {
  buildPool();
  return _addresses.map((addr, i) => ({
    index: i,
    address: addr,
    vaultCount: vaultsByExecutor[addr.toLowerCase()] || 0,
  }));
}
