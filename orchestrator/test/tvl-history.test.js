import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  shouldRecordSnapshot,
  boundHistory,
  selectHistory,
  createTvlHistoryStore,
} from '../src/services/tvlHistory.js';

// The hero sparkline on the dashboard reads a platform-TVL time-series. The
// live TVL number was always real (Σ NAV per vault); only the *history* was
// missing, so the chart rendered the honest "awaiting indexer" placeholder.
// tvlHistory records one bounded, downsampled point per orchestrator cycle.
// These tests cover the pure logic (guard / retention / selection) and the
// injectable store's persistence round-trip.

// ── shouldRecordSnapshot: never write a misleading point ──

test('records a finite TVL when at least one vault exists', () => {
  assert.equal(shouldRecordSnapshot(1234.5, 2), true);
});

test('records a genuine zero TVL when vaults exist (real, not synthesized)', () => {
  assert.equal(shouldRecordSnapshot(0, 1), true);
});

test('skips when there are no vaults (no flatline-at-zero artifact)', () => {
  assert.equal(shouldRecordSnapshot(0, 0), false);
});

test('skips when the TVL computation failed (NaN / non-finite)', () => {
  assert.equal(shouldRecordSnapshot(NaN, 2), false);
  assert.equal(shouldRecordSnapshot(Infinity, 2), false);
});

test('skips a negative TVL (impossible value => treat as failure)', () => {
  assert.equal(shouldRecordSnapshot(-5, 2), false);
});

// ── boundHistory: cap total points, downsample the OLDEST, keep recent detail ──

test('leaves history untouched when under the cap', () => {
  const h = [
    { t: '2026-01-01T01:00:00.000Z', tvl: 10, vaults: 1 },
    { t: '2026-01-01T02:00:00.000Z', tvl: 20, vaults: 1 },
  ];
  assert.deepEqual(boundHistory(h, 5), h);
});

test('caps to maxPoints by merging the oldest points, leaving recent ones raw', () => {
  const h = [
    { t: '2026-01-01T01:00:00.000Z', tvl: 10, vaults: 1 },
    { t: '2026-01-01T02:00:00.000Z', tvl: 20, vaults: 1 },
    { t: '2026-01-01T03:00:00.000Z', tvl: 30, vaults: 1 },
    { t: '2026-01-01T04:00:00.000Z', tvl: 40, vaults: 1 },
    { t: '2026-01-01T05:00:00.000Z', tvl: 50, vaults: 1 },
  ];
  const out = boundHistory(h, 3);
  assert.equal(out.length, 3);
  // Two most-recent points are preserved exactly.
  assert.equal(out[2].tvl, 50);
  assert.equal(out[1].tvl, 40);
  // Oldest bucket is a merge of the four oldest: ((10+20)/2 + 30)/2 = 22.5.
  assert.equal(out[0].tvl, 22.5);
  // A merged bucket is timestamped by its newest member (monotonic ascending).
  const ts = out.map((p) => Date.parse(p.t));
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
});

// ── selectHistory: ascending slice with optional limit + time window ──

const SERIES = [
  { t: '2026-01-01T01:00:00.000Z', tvl: 10, vaults: 1 },
  { t: '2026-01-01T02:00:00.000Z', tvl: 20, vaults: 1 },
  { t: '2026-01-01T03:00:00.000Z', tvl: 30, vaults: 1 },
  { t: '2026-01-01T04:00:00.000Z', tvl: 40, vaults: 1 },
  { t: '2026-01-01T05:00:00.000Z', tvl: 50, vaults: 1 },
];

test('returns the whole series ascending when no options are given', () => {
  assert.deepEqual(selectHistory(SERIES), SERIES);
});

test('limit keeps the most recent N points, still ascending', () => {
  const out = selectHistory(SERIES, { limit: 2 });
  assert.deepEqual(out.map((p) => p.tvl), [40, 50]);
});

test('sinceMs keeps only points within the window relative to nowMs', () => {
  const nowMs = Date.parse('2026-01-01T05:00:00.000Z');
  const out = selectHistory(SERIES, { sinceMs: 2 * 3600_000, nowMs });
  // cutoff = 03:00 inclusive
  assert.deepEqual(out.map((p) => p.tvl), [30, 40, 50]);
});

test('does not mutate the input array', () => {
  const copy = SERIES.slice();
  selectHistory(SERIES, { limit: 1 });
  assert.deepEqual(SERIES, copy);
});

// ── createTvlHistoryStore: DI persistence round-trip via a temp file ──

function tmpFile() {
  const dir = mkdtempSync(join(tmpdir(), 'tvlhist-'));
  return { file: join(dir, 'tvl-history.json'), dir };
}

test('records, persists, and reloads the series from disk', () => {
  const { file, dir } = tmpFile();
  try {
    const a = createTvlHistoryStore({ filePath: file });
    a.recordSnapshot({ tvl: 100, vaults: 1, at: '2026-01-01T01:00:00.000Z' });
    a.recordSnapshot({ tvl: 110, vaults: 2, at: '2026-01-01T02:00:00.000Z' });
    assert.equal(a.size(), 2);

    // A fresh store over the same file restores what was written.
    const b = createTvlHistoryStore({ filePath: file });
    b.load();
    assert.deepEqual(b.getHistory().map((p) => p.tvl), [100, 110]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store skips snapshots that should not be recorded', () => {
  const { file, dir } = tmpFile();
  try {
    const s = createTvlHistoryStore({ filePath: file });
    assert.equal(s.recordSnapshot({ tvl: 0, vaults: 0, at: '2026-01-01T01:00:00.000Z' }), null);
    assert.equal(s.size(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store enforces the cap as snapshots accumulate', () => {
  const { file, dir } = tmpFile();
  try {
    const s = createTvlHistoryStore({ filePath: file, maxPoints: 3 });
    for (let i = 1; i <= 6; i++) {
      s.recordSnapshot({ tvl: i * 10, vaults: 1, at: `2026-01-01T0${i}:00:00.000Z` });
    }
    assert.equal(s.size(), 3);
    // newest point survives untouched
    assert.equal(s.getHistory().at(-1).tvl, 60);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
