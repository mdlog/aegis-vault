import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * tvlHistory — bounded platform-TVL time-series for the dashboard sparkline.
 *
 * The live TVL number is already real (Σ NAV across vaults). What was missing
 * was the *history*, so the hero sparkline rendered an honest "awaiting indexer"
 * placeholder. This module records one point per orchestrator cycle, keeps the
 * series bounded by downsampling the oldest points (recent detail preserved),
 * and persists it to a local file (mirrors storage.js — trivial to swap for 0G
 * Storage later).
 *
 * The pure helpers (shouldRecordSnapshot / boundHistory / selectHistory) hold
 * all the logic and are unit-tested directly. The store is an injectable
 * factory so persistence can be tested against a temp file without globals.
 */

// Cap the series so the file and payload stay small. ~720 points ≈ 30 days at
// one cycle/hour, or proportionally finer at shorter cycle intervals. A
// constant, deliberately not an env flag — retention is an architectural
// property of the series, not a per-deploy knob.
export const MAX_POINTS = 720;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = config.dataDir
  ? resolve(process.cwd(), config.dataDir, 'tvl-history.json')
  : resolve(__dirname, '../../data/tvl-history.json');

// ── Pure logic ──────────────────────────────────────────────────────────────

/**
 * Guard a candidate snapshot. We only record when the point is *meaningful*:
 * a finite, non-negative TVL and at least one vault. Recording 0 when there
 * are no vaults (or when NAV computation failed) would draw a misleading
 * flatline — no point is more honest than a fabricated one.
 */
export function shouldRecordSnapshot(tvl, vaults) {
  return Number.isFinite(tvl) && tvl >= 0 && Number.isInteger(vaults) && vaults > 0;
}

/**
 * Keep the series within `maxPoints` by merging the oldest adjacent points
 * into wider buckets. Recent points stay raw (full detail near "now"); old
 * history is compressed. Each merged bucket is timestamped by its newest
 * member, so the series stays ascending. Pure — returns a new array.
 */
export function boundHistory(history, maxPoints = MAX_POINTS) {
  if (!Array.isArray(history)) return [];
  if (history.length <= maxPoints) return history.slice();
  const out = history.slice();
  while (out.length > maxPoints) {
    const a = out[0];
    const b = out[1];
    out.splice(0, 2, { t: b.t, tvl: (a.tvl + b.tvl) / 2, vaults: b.vaults });
  }
  return out;
}

/**
 * Select an ascending view of the series. `sinceMs` (with `nowMs`) keeps only
 * points within a trailing window; `limit` then keeps the most recent N. Pure.
 */
export function selectHistory(history, { limit, sinceMs, nowMs } = {}) {
  let out = Array.isArray(history) ? history.slice() : [];
  if (Number.isFinite(sinceMs) && Number.isFinite(nowMs)) {
    const cutoff = nowMs - sinceMs;
    out = out.filter((p) => Date.parse(p.t) >= cutoff);
  }
  if (Number.isFinite(limit) && limit >= 0 && out.length > limit) {
    out = out.slice(out.length - limit);
  }
  return out;
}

// ── Injectable store ─────────────────────────────────────────────────────────

function writeJsonAtomic(targetPath, value) {
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}

/**
 * Create a TVL-history store backed by `filePath`. Injectable so tests can
 * point it at a temp file. The module exports a singleton wired to the default
 * data dir below.
 */
export function createTvlHistoryStore({ filePath, maxPoints = MAX_POINTS } = {}) {
  let history = [];

  function load() {
    try {
      if (existsSync(filePath)) {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        if (Array.isArray(parsed)) history = parsed;
      }
    } catch (err) {
      logger.warn(`Failed to load TVL history: ${err.message}. Starting empty.`);
      history = [];
    }
    return history;
  }

  function recordSnapshot({ tvl, vaults, at } = {}) {
    if (!shouldRecordSnapshot(tvl, vaults)) return null;
    const snapshot = { t: at || new Date().toISOString(), tvl, vaults };
    history = boundHistory([...history, snapshot], maxPoints);
    try {
      writeJsonAtomic(filePath, history);
    } catch (err) {
      // Persistence is best-effort: a failed write must never break a cycle.
      logger.warn(`Failed to persist TVL history: ${err.message}`);
    }
    return snapshot;
  }

  function getHistory(opts = {}) {
    return selectHistory(history, opts);
  }

  function size() {
    return history.length;
  }

  return { load, recordSnapshot, getHistory, size };
}

// ── Default singleton (used by the orchestrator + API) ───────────────────────

export const tvlHistoryStore = createTvlHistoryStore({ filePath: DEFAULT_FILE });

export const loadTvlHistory = () => tvlHistoryStore.load();
export const recordTvlSnapshot = (snapshot) => tvlHistoryStore.recordSnapshot(snapshot);
export const getTvlHistory = (opts) => tvlHistoryStore.getHistory(opts);
