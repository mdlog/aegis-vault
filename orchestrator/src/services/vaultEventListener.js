// Watches managed vaults for Deposited / Withdrawn events and writes a NAV
// snapshot to the journal when either fires. Cycle journal entries only happen
// every N minutes, so without this listener the dashboard's NAV chart would
// stay flat until the next cycle even after a deposit. This closes that gap by
// appending a `balance_change` entry shaped like a cycle result so the frontend
// (which already reads cycle.vaultResults) can render it with a minimal filter
// extension.
import { ethers } from 'ethers';
import config from '../config/index.js';
import { getProvider, getVaultContract } from '../config/contracts.js';
import { calculateMultiAssetNAV } from './pythPrice.js';
import { appendJournal } from './storage.js';
import logger from '../utils/logger.js';

const POLL_INTERVAL_MS = 30_000; // 30s — balance events don't need sub-block latency
const MAX_BLOCK_RANGE = 5_000;   // guard against RPCs that reject large ranges

let pollHandle = null;
let lastProcessedBlock = null;
// In-memory de-dup to survive a stray repoll before `lastProcessedBlock` bumps.
const seenEventKeys = new Set();
const SEEN_CAP = 256;

function markSeen(key) {
  seenEventKeys.add(key);
  if (seenEventKeys.size > SEEN_CAP) {
    // Drop oldest by rebuilding (Set iteration preserves insertion order).
    const fresh = Array.from(seenEventKeys).slice(-Math.floor(SEEN_CAP / 2));
    seenEventKeys.clear();
    fresh.forEach((k) => seenEventKeys.add(k));
  }
}

export async function startVaultEventListener() {
  if (pollHandle) return;
  const provider = getProvider();
  try {
    lastProcessedBlock = await provider.getBlockNumber();
  } catch (err) {
    logger.warn(`Vault event listener: unable to read current block (${err.message}). Will retry on first poll.`);
    lastProcessedBlock = 0;
  }
  logger.info(`Vault event listener started · starting block ${lastProcessedBlock} · interval ${POLL_INTERVAL_MS / 1000}s`);

  pollHandle = setInterval(() => { pollOnce().catch(() => {}); }, POLL_INTERVAL_MS);
  // Kick off first run immediately so a fresh start picks up any events that
  // arrived in the backfill window before the listener came up.
  setImmediate(() => { pollOnce().catch(() => {}); });
}

export function stopVaultEventListener() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
    logger.info('Vault event listener stopped');
  }
}

async function pollOnce() {
  const provider = getProvider();
  let currentBlock;
  try {
    currentBlock = await provider.getBlockNumber();
  } catch (err) {
    logger.warn(`Vault event poll: block fetch failed (${err.message})`);
    return;
  }

  if (!lastProcessedBlock || lastProcessedBlock === 0) {
    lastProcessedBlock = currentBlock;
    return;
  }
  if (currentBlock <= lastProcessedBlock) return;

  const fromBlock = lastProcessedBlock + 1;
  const toBlock = Math.min(currentBlock, fromBlock + MAX_BLOCK_RANGE - 1);

  let vaults = [];
  try {
    // Lazy-import to avoid circular dependency: orchestrator.js starts this
    // listener during initialize(), so a top-level import creates a cycle.
    const { collectManagedVaultAddresses } = await import('./orchestrator.js');
    vaults = collectManagedVaultAddresses();
  } catch (err) {
    logger.warn(`Vault event poll: managed vault lookup failed (${err.message})`);
    return;
  }
  if (vaults.length === 0) {
    // Nothing to watch yet — advance the cursor so we don't replay once vaults
    // register later.
    lastProcessedBlock = toBlock;
    return;
  }

  for (const vaultAddr of vaults) {
    try {
      await scanVault(vaultAddr, fromBlock, toBlock, provider);
    } catch (err) {
      logger.warn(`Vault event scan failed for ${shortAddr(vaultAddr)}: ${err.message}`);
    }
  }

  lastProcessedBlock = toBlock;
}

async function scanVault(vaultAddr, fromBlock, toBlock, provider) {
  const vault = getVaultContract(vaultAddr);
  const depositedFilter = vault.filters.Deposited();
  const withdrawnFilter = vault.filters.Withdrawn();

  const [deposited, withdrawn] = await Promise.all([
    vault.queryFilter(depositedFilter, fromBlock, toBlock).catch((err) => {
      logger.debug(`Deposited queryFilter failed: ${err.message}`);
      return [];
    }),
    vault.queryFilter(withdrawnFilter, fromBlock, toBlock).catch((err) => {
      logger.debug(`Withdrawn queryFilter failed: ${err.message}`);
      return [];
    }),
  ]);

  const tagged = [
    ...deposited.map((e) => ({ e, kind: 'deposited' })),
    ...withdrawn.map((e) => ({ e, kind: 'withdrawn' })),
  ].sort((a, b) =>
    (a.e.blockNumber - b.e.blockNumber)
    || (a.e.transactionIndex - b.e.transactionIndex)
    || (a.e.logIndex - b.e.logIndex),
  );

  for (const { e, kind } of tagged) {
    const key = `${e.transactionHash}:${e.logIndex}`;
    if (seenEventKeys.has(key)) continue;
    await writeNavSnapshot(vaultAddr, e, kind, provider);
    markSeen(key);
  }
}

async function writeNavSnapshot(vaultAddr, event, kind, provider) {
  let navSnapshot;
  try {
    navSnapshot = await calculateMultiAssetNAV(vaultAddr);
  } catch (err) {
    logger.warn(`NAV snapshot failed on ${kind} (${shortAddr(vaultAddr)}): ${err.message}`);
    return;
  }

  let blockTimestamp = null;
  try {
    const block = await provider.getBlock(event.blockNumber);
    if (block?.timestamp) blockTimestamp = new Date(block.timestamp * 1000).toISOString();
  } catch {
    // non-fatal; appendJournal will fall back to Date.now()
  }

  const amountRaw = event.args?.amount
    ?? event.args?.[event.args?.length ? event.args.length - 1 : 2]
    ?? null;
  const amountHuman = amountRaw != null
    ? (() => {
        try { return ethers.formatUnits(amountRaw, 6); }
        catch { return amountRaw.toString(); }
      })()
    : null;

  // Shape mirrors the `cycle` journal entry so the frontend's existing NAV
  // history derivation (filter by vaultResults[].vaultState.nav) picks this up
  // once the filter is extended to include `balance_change`.
  appendJournal({
    type: 'balance_change',
    event: kind,
    vault: vaultAddr,
    amount: amountHuman,
    amountRaw: amountRaw != null ? amountRaw.toString() : null,
    txHash: event.transactionHash,
    blockNumber: event.blockNumber,
    // Use the block's own timestamp so the chart x-axis reflects when the
    // deposit actually landed on-chain, not when we processed the event.
    timestamp: blockTimestamp || new Date().toISOString(),
    vaultResults: [{
      vault: vaultAddr,
      vaultState: {
        nav: String(navSnapshot?.totalNav ?? 0),
        breakdown: navSnapshot?.breakdown || [],
        prices: navSnapshot?.prices || null,
      },
    }],
  });

  const navLabel = typeof navSnapshot?.totalNav === 'number'
    ? `$${navSnapshot.totalNav.toFixed(2)}`
    : '—';
  logger.info(
    `NAV snapshot · ${kind} · vault ${shortAddr(vaultAddr)} · NAV ${navLabel}` +
    (amountHuman ? ` · amount ${amountHuman}` : '') +
    ` · tx ${event.transactionHash.slice(0, 10)}…`,
  );
}

function shortAddr(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}
