// Manifest util tests — canonicalisation stability (the whole point), hash
// determinism, validation, and roundtrip via parseManifest.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeJson,
  computeManifestHash,
  validateManifest,
  parseManifest,
  buildManifest,
} from '../src/manifest.js';

test('canonicalizeJson: keys sorted recursively regardless of insertion order', () => {
  const a = { b: 1, a: { z: 2, y: 1 } };
  const b = { a: { y: 1, z: 2 }, b: 1 };
  assert.equal(canonicalizeJson(a), canonicalizeJson(b));
  assert.equal(canonicalizeJson(a), '{"a":{"y":1,"z":2},"b":1}');
});

test('canonicalizeJson: arrays preserve order, scalars serialise cleanly', () => {
  assert.equal(canonicalizeJson([3, 1, 2]), '[3,1,2]');
  assert.equal(canonicalizeJson(null), 'null');
  assert.equal(canonicalizeJson(true), 'true');
  assert.equal(canonicalizeJson('hi "'), '"hi \\""');
  assert.equal(canonicalizeJson(0.1), '0.1');
});

test('canonicalizeJson: bigint serialises as string for stability', () => {
  assert.equal(canonicalizeJson(10n), '"10"');
  assert.equal(canonicalizeJson({ n: 123n }), '{"n":"123"}');
});

test('canonicalizeJson: rejects non-finite numbers, undefined, cycles', () => {
  assert.throws(() => canonicalizeJson(NaN), /non-finite/);
  assert.throws(() => canonicalizeJson(Infinity), /non-finite/);
  assert.throws(() => canonicalizeJson(() => {}), /cannot serialize/);
  const cyc = {};
  cyc.self = cyc;
  assert.throws(() => canonicalizeJson(cyc), /circular/);
});

test('computeManifestHash: deterministic across key orderings', () => {
  const m1 = { b: 1, a: 'x', nested: { z: [1, 2], y: 5 } };
  const m2 = { nested: { y: 5, z: [1, 2] }, a: 'x', b: 1 };
  const h1 = computeManifestHash(m1);
  const h2 = computeManifestHash(m2);
  assert.equal(h1, h2);
  assert.match(h1, /^0x[0-9a-f]{64}$/);
});

test('computeManifestHash: changes when any byte changes', () => {
  const h1 = computeManifestHash({ a: 1 });
  const h2 = computeManifestHash({ a: 2 });
  assert.notEqual(h1, h2);
});

// ── Validation ─────────────────────────────────────────────────────

const VALID_MANIFEST = {
  name: 'Aegis Alpha',
  version: '1.0.0',
  operator: '0x98cC8351C1310FD54B9090dF3fcA80CB61d7b5E7',
  publishedAt: '2026-04-24T00:00:00Z',
  mandate: 'Balanced',
  policy: {
    maxPositionBps: 5000,
    confidenceThresholdBps: 6000,
    stopLossBps: 1500,
    cooldownSeconds: 900,
    maxActionsPerDay: 6,
  },
  fees: {
    performanceBps: 1500,
    managementBps: 200,
  },
  allowedAssets: [
    { symbol: 'USDC.e', address: '0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E', decimals: 6 },
    { symbol: 'WETH',   address: '0x564770837Ef8bbF077cFe54E5f6106538c815B22', decimals: 18 },
  ],
};

test('validateManifest: accepts a fully-formed manifest', () => {
  assert.doesNotThrow(() => validateManifest(VALID_MANIFEST));
});

test('validateManifest: rejects missing top-level fields', () => {
  for (const key of ['name', 'version', 'operator', 'mandate', 'policy', 'fees', 'allowedAssets']) {
    const bad = { ...VALID_MANIFEST };
    delete bad[key];
    assert.throws(() => validateManifest(bad), new RegExp(`missing top-level field "${key}"`));
  }
});

test('validateManifest: rejects bad operator address / bad mandate', () => {
  assert.throws(
    () => validateManifest({ ...VALID_MANIFEST, operator: 'not-an-address' }),
    /20-byte address/,
  );
  assert.throws(
    () => validateManifest({ ...VALID_MANIFEST, mandate: 'YOLO' }),
    /Conservative \| Balanced \| Tactical/,
  );
});

test('validateManifest: rejects non-number policy fields', () => {
  assert.throws(
    () => validateManifest({
      ...VALID_MANIFEST,
      policy: { ...VALID_MANIFEST.policy, maxPositionBps: '5000' },
    }),
    /policy.maxPositionBps/,
  );
});

test('validateManifest: rejects empty allowedAssets', () => {
  assert.throws(
    () => validateManifest({ ...VALID_MANIFEST, allowedAssets: [] }),
    /non-empty array/,
  );
});

test('parseManifest: roundtrips through JSON.stringify', () => {
  const text = JSON.stringify(VALID_MANIFEST);
  const parsed = parseManifest(text);
  assert.deepEqual(parsed, VALID_MANIFEST);
});

test('parseManifest: bubbles invalid JSON', () => {
  assert.throws(() => parseManifest('not json'), /invalid JSON/);
});

test('buildManifest: applies defaults and passes validation', () => {
  const m = buildManifest({
    name: 'Test',
    operator: '0x' + 'a'.repeat(40),
    mandate: 'Balanced',
    policy: VALID_MANIFEST.policy,
    fees: VALID_MANIFEST.fees,
    allowedAssets: VALID_MANIFEST.allowedAssets,
  });
  assert.equal(m.version, '1.0.0');
  assert.match(m.publishedAt, /^\d{4}-\d{2}-\d{2}T/); // ISO-8601 prefix
  assert.doesNotThrow(() => validateManifest(m));
});

test('buildManifest: merges `extra` at top level', () => {
  const m = buildManifest({
    name: 'Test',
    operator: '0x' + 'a'.repeat(40),
    mandate: 'Balanced',
    policy: VALID_MANIFEST.policy,
    fees: VALID_MANIFEST.fees,
    allowedAssets: VALID_MANIFEST.allowedAssets,
    extra: { customField: 'hello' },
  });
  assert.equal(m.customField, 'hello');
});
