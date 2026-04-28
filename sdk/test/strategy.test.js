// Tests for the strategy manifest SDK module.
//
// Two non-negotiable invariants live here:
//
//   1. `computeStrategyHash` of every reference template MUST match the
//      hash committed in orchestrator/strategies/README.md. The orchestrator
//      side already pins these hashes; we pin them here too so any drift
//      between the SDK canonicaliser and the orchestrator's
//      `src/strategy/hash.js` trips CI on both sides simultaneously.
//
//   2. `validateStrategy` MUST mirror the orchestrator validator's accept /
//      reject set for the cases UIs care about (weights sum, schemaVersion,
//      missing required fields).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  computeStrategyHash,
  validateStrategy,
  fetchOperatorStrategy,
  summarizeStrategy,
  supportedStrategySchemaVersions,
} from '../src/strategy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STRATEGIES_DIR = resolve(__dirname, '../../orchestrator/strategies');

function loadTemplate(name) {
  return JSON.parse(readFileSync(resolve(STRATEGIES_DIR, name), 'utf8'));
}

const TREND = loadTemplate('trend-following-v1.json');
const MEAN_REVERSION = loadTemplate('mean-reversion-v1.json');
const MOMENTUM = loadTemplate('momentum-breakout-v1.json');
const ARB = loadTemplate('arbitrage-stable-v1.json');
const MARKET_NEUTRAL = loadTemplate('market-neutral-v1.json');

// ── Hash determinism / shape ──

test('computeStrategyHash: deterministic 0x-prefixed 32-byte hex', () => {
  const h = computeStrategyHash(TREND);
  assert.match(h, /^0x[0-9a-f]{64}$/);
  // Re-hash same object — must match.
  assert.equal(computeStrategyHash(TREND), h);
});

test('computeStrategyHash: insensitive to JS object key insertion order', () => {
  const a = { schemaVersion: 1, b: 2, a: 1 };
  const b = { a: 1, b: 2, schemaVersion: 1 };
  assert.equal(computeStrategyHash(a), computeStrategyHash(b));
});

test('computeStrategyHash: changes when any byte changes', () => {
  const tweaked = JSON.parse(JSON.stringify(TREND));
  tweaked.scoring.weights.trend += 0.01;
  tweaked.scoring.weights.momentum -= 0.01;
  assert.notEqual(computeStrategyHash(TREND), computeStrategyHash(tweaked));
});

// Pin every template hash so SDK ↔ orchestrator drift is impossible to land
// silently. Values lifted from orchestrator/strategies/README.md.
test('computeStrategyHash: trend-following-v1 matches pinned hash', () => {
  assert.equal(
    computeStrategyHash(TREND),
    '0x18131f3fba7dbf12ad280f1fc52e6ff3ec1a896c98c1f697169418c8c523f3f3',
  );
});

test('computeStrategyHash: mean-reversion-v1 matches pinned hash', () => {
  assert.equal(
    computeStrategyHash(MEAN_REVERSION),
    '0x446fdb78acf5a1377891941128cdda82e6170cb31a909a7d68b25254b2d1d1b1',
  );
});

test('computeStrategyHash: momentum-breakout-v1 matches pinned hash', () => {
  assert.equal(
    computeStrategyHash(MOMENTUM),
    '0x4a6a45f0aaae96852e0c0aae0cb8541ea3337d10340c907ec90edc3b78b29691',
  );
});

test('computeStrategyHash: arbitrage-stable-v1 matches pinned hash', () => {
  assert.equal(
    computeStrategyHash(ARB),
    '0x529e865bb885ea8b91f3b0e3d0d9d9c9e5647397abd9c5b951347695e058fc1e',
  );
});

test('computeStrategyHash: market-neutral-v1 matches pinned hash', () => {
  assert.equal(
    computeStrategyHash(MARKET_NEUTRAL),
    '0x85c261f37fea48cd24a583727a92dcb850b358b4f4d7c6d984c254a49ecc9b4f',
  );
});

// ── validateStrategy ──

test('validateStrategy: accepts every shipped template', () => {
  for (const [name, m] of Object.entries({ TREND, MEAN_REVERSION, MOMENTUM, ARB, MARKET_NEUTRAL })) {
    const r = validateStrategy(m);
    assert.equal(r.ok, true, `${name} should be valid: ${JSON.stringify(r.errors)}`);
    assert.deepEqual(r.errors, [], `${name} should produce no errors`);
  }
});

test('validateStrategy: rejects weights that do not sum to 1.0', () => {
  const bad = JSON.parse(JSON.stringify(TREND));
  bad.scoring.weights.trend = 0.50; // sum becomes 1.15
  const r = validateStrategy(bad);
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.path === '$.scoring.weights' && /sum must be 1\.0/.test(e.message)),
    `expected weight-sum error, got ${JSON.stringify(r.errors)}`,
  );
});

test('validateStrategy: tolerates small drift in weight sum (within ±0.01)', () => {
  const ok = JSON.parse(JSON.stringify(TREND));
  // Bump trend by +0.005 — total becomes ~1.005, within tolerance.
  ok.scoring.weights.trend = 0.355;
  // sum: 0.355 + 0.20 + 0.10 + 0.15 + 0.10 + 0.10 = 1.005
  const r = validateStrategy(ok);
  assert.equal(r.ok, true, `should pass with sum 1.005: ${JSON.stringify(r.errors)}`);
});

test('validateStrategy: rejects schemaVersion != 1', () => {
  const bad = { ...TREND, schemaVersion: 2 };
  const r = validateStrategy(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '$.schemaVersion'));
});

test('validateStrategy: rejects missing top-level required fields', () => {
  for (const key of ['strategy', 'indicators', 'scoring', 'rules', 'gates', 'veto', 'ai']) {
    const bad = { ...TREND };
    delete bad[key];
    const r = validateStrategy(bad);
    assert.equal(r.ok, false, `removing ${key} should fail validation`);
    assert.ok(r.errors.some((e) => e.path === `$.${key}`));
  }
});

test('validateStrategy: rejects bad strategy.id pattern', () => {
  const bad = JSON.parse(JSON.stringify(TREND));
  bad.strategy.id = 'BAD ID with spaces';
  const r = validateStrategy(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '$.strategy.id'));
});

test('validateStrategy: rejects unknown ai.mode', () => {
  const bad = JSON.parse(JSON.stringify(TREND));
  bad.ai.mode = 'fully-autonomous';
  const r = validateStrategy(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '$.ai.mode'));
});

test('validateStrategy: rejects bad ai.providerAddress', () => {
  const bad = JSON.parse(JSON.stringify(TREND));
  bad.ai.providerAddress = 'not-an-address';
  const r = validateStrategy(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.path === '$.ai.providerAddress'));
});

test('validateStrategy: returns ok=false for non-objects', () => {
  for (const v of [null, undefined, 42, 'string', []]) {
    const r = validateStrategy(v);
    assert.equal(r.ok, false);
  }
});

// ── summarizeStrategy ──

test('summarizeStrategy: returns expected shape for a valid manifest', () => {
  const s = summarizeStrategy(TREND);
  assert.equal(s.id, 'trend-following-v1');
  assert.equal(s.type, 'trend_following');
  assert.equal(s.timeframe, '1h');
  assert.equal(s.aiModel, 'zai-org/GLM-5-FP8');
  assert.equal(s.aiMode, 'scoring_input');
  assert.deepEqual(s.weights, TREND.scoring.weights);
  assert.deepEqual(s.allowedRegimes, ['TREND_UP_STRONG', 'TREND_UP_WEAK']);
  assert.equal(s.minConfidence, 0.55);
  assert.equal(s.minEdge, 60);
  assert.equal(s.schemaVersion, 1);
});

test('summarizeStrategy: returns null for malformed input', () => {
  assert.equal(summarizeStrategy(null), null);
  assert.equal(summarizeStrategy({}), null);
  assert.equal(summarizeStrategy({ strategy: {} }), null);
});

// ── fetchOperatorStrategy (mocked) ──
//
// fetchOperatorStrategy accepts an internal `_contractFactory` hook so tests
// don't need to mock the ethers Contract constructor (which lives behind a
// dynamic import + immutable ESM namespace and can't be patched in place).
// Production callers never set this — it defaults to ethers.Contract.

const TREND_HASH = '0x18131f3fba7dbf12ad280f1fc52e6ff3ec1a896c98c1f697169418c8c523f3f3';

function fakeContractFactory(extended) {
  return () => ({ getOperatorExtended: async () => extended });
}

test('fetchOperatorStrategy: returns null when operator has no manifest URI', async () => {
  const empty = {
    manifestURI: '',
    manifestHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    manifestVersion: 0n,
  };
  const r = await fetchOperatorStrategy({
    operatorAddress: '0x' + 'a'.repeat(40),
    registryAddress: '0x' + 'b'.repeat(40),
    provider: {},
    fetchImpl: async () => { throw new Error('should not fetch'); },
    _contractFactory: fakeContractFactory(empty),
  });
  assert.equal(r, null);
});

test('fetchOperatorStrategy: returns parsed manifest on hash match', async () => {
  const ext = {
    manifestURI: 'https://example.test/trend.json',
    manifestHash: TREND_HASH,
    manifestVersion: 1n,
  };
  const r = await fetchOperatorStrategy({
    operatorAddress: '0x' + 'a'.repeat(40),
    registryAddress: '0x' + 'b'.repeat(40),
    provider: {},
    fetchImpl: async () => JSON.stringify(TREND),
    _contractFactory: fakeContractFactory(ext),
  });
  assert.ok(r);
  assert.equal(r.hash, TREND_HASH);
  assert.equal(r.manifestURI, ext.manifestURI);
  assert.equal(r.manifestVersion, 1);
  assert.equal(r.summary.id, 'trend-following-v1');
  assert.equal(r.strategy.strategy.id, 'trend-following-v1');
});

test('fetchOperatorStrategy: throws on hash mismatch (tampered content)', async () => {
  const tampered = JSON.parse(JSON.stringify(TREND));
  tampered.scoring.weights.trend = 0.40;
  tampered.scoring.weights.momentum = 0.15;
  const ext = {
    manifestURI: 'https://example.test/trend.json',
    manifestHash: TREND_HASH, // points at the unmodified hash
    manifestVersion: 1n,
  };
  await assert.rejects(
    () => fetchOperatorStrategy({
      operatorAddress: '0x' + 'a'.repeat(40),
      registryAddress: '0x' + 'b'.repeat(40),
      provider: {},
      fetchImpl: async () => JSON.stringify(tampered),
      _contractFactory: fakeContractFactory(ext),
    }),
    /hash mismatch/,
  );
});

test('fetchOperatorStrategy: surfaces fetch errors with URI context', async () => {
  const ext = {
    manifestURI: 'https://offline.test/trend.json',
    manifestHash: TREND_HASH,
    manifestVersion: 1n,
  };
  await assert.rejects(
    () => fetchOperatorStrategy({
      operatorAddress: '0x' + 'a'.repeat(40),
      registryAddress: '0x' + 'b'.repeat(40),
      provider: {},
      fetchImpl: async () => { throw new Error('connection refused'); },
      _contractFactory: fakeContractFactory(ext),
    }),
    /fetch failed for https:\/\/offline\.test/,
  );
});

test('fetchOperatorStrategy: rejects bad operator / registry address', async () => {
  await assert.rejects(
    () => fetchOperatorStrategy({
      operatorAddress: 'not-an-address',
      registryAddress: '0x' + 'b'.repeat(40),
      provider: {},
    }),
    /operatorAddress/,
  );
  await assert.rejects(
    () => fetchOperatorStrategy({
      operatorAddress: '0x' + 'a'.repeat(40),
      registryAddress: 'nope',
      provider: {},
    }),
    /registryAddress/,
  );
});

test('fetchOperatorStrategy: requires provider', async () => {
  await assert.rejects(
    () => fetchOperatorStrategy({
      operatorAddress: '0x' + 'a'.repeat(40),
      registryAddress: '0x' + 'b'.repeat(40),
    }),
    /provider is required/,
  );
});

// ── misc ──

test('supportedStrategySchemaVersions: returns [1]', () => {
  assert.deepEqual(supportedStrategySchemaVersions(), [1]);
});

