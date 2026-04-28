// End-to-end coverage for src/strategy/loader.js.
//
// loader.js is the entry point the orchestrator uses to materialise an
// operator's declarative strategy manifest into a validated, hash-bound,
// schema-checked object before it is allowed to influence on-chain
// decisions. The contract that matters in production:
//
//   1. Each of the five shipped templates in `orchestrator/strategies/`
//      loads cleanly through the full pipeline (fetch → hash → schema →
//      weights). They are the documented golden inputs for new operators
//      so any drift in the loader that breaks them is a regression.
//   2. Tampering with the manifest body — even by one byte — must surface
//      as `StrategyHashMismatch`. This is the trust anchor that ties the
//      on-chain `acceptedManifestHash` to the off-chain config.
//   3. Each typed error class is reachable from real-world failure modes,
//      because callers in decisionEngine.js / orchestrator.js branch on
//      `err.name` to decide whether to journal-and-skip vs hard-stop.
//   4. The cache is content-addressed by `(operator, hash)` so a hot
//      orchestrator does not refetch + revalidate every cycle, but a hash
//      change correctly evicts.
//
// We deliberately do not exercise IPFS / 0G storage URI schemes here —
// those involve network and live in a separate fixture layer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadStrategy,
  clearStrategyCache,
  supportedSchemaVersions,
  StrategyFetchError,
  StrategyHashMismatch,
  StrategySchemaError,
  StrategyVersionError,
  StrategyWeightsError,
} from '../../src/strategy/loader.js';
import { computeStrategyHash } from '../../src/strategy/hash.js';

const STRATEGIES_DIR = join(process.cwd(), 'strategies');
const TEMPLATE_NAMES = [
  'trend-following-v1',
  'mean-reversion-v1',
  'momentum-breakout-v1',
  'arbitrage-stable-v1',
  'market-neutral-v1',
];

// Use a deterministic operator address per test so cache keys stay isolated
// from each other (cache is module-scoped Map keyed on operator+hash).
const OPERATOR = '0x98cC8351C1310FD54B9090dF3fcA80CB61d7b5E7';

function fileUri(absPath) {
  // loader.fetchManifestContent strips `file://` and resolves the rest as
  // a normal path. Absolute paths work because resolvePath is identity on
  // them.
  return `file://${absPath}`;
}

// Write a strategy object to a temp file and return its file:// URI plus
// the on-disk path so callers can clean up.
function writeTempStrategy(strategyObj) {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-strategy-loader-'));
  const path = join(dir, 'strategy.json');
  writeFileSync(path, JSON.stringify(strategyObj, null, 2), 'utf8');
  return { uri: fileUri(path), path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('loader: each shipped template round-trips through the full pipeline', async () => {
  // The five templates are the documented starting points operators copy
  // when registering. They MUST load with an unmodified body because
  // anything else means we are shipping examples that violate our own
  // schema or weight invariants.
  for (const name of TEMPLATE_NAMES) {
    clearStrategyCache();
    const path = join(STRATEGIES_DIR, `${name}.json`);
    const raw = readFileSync(path, 'utf8');
    const expectedHash = computeStrategyHash(JSON.parse(raw));

    const result = await loadStrategy({
      uri: fileUri(path),
      expectedHash,
      operatorAddress: OPERATOR,
    });

    assert.equal(result.strategy.strategy.id, name, `${name} id mismatch`);
    assert.equal(result.hash, expectedHash, `${name} hash mismatch`);
    assert.equal(result.schemaVersion, 1, `${name} schemaVersion`);
    assert.equal(typeof result.raw, 'string');
  }
});

test('loader: omitting expectedHash skips the binding check (development mode)', async () => {
  // The hash check is only enforced when expectedHash is truthy. This
  // matches the loader's documented contract: callers without an on-chain
  // commitment (e.g. local backtesting) can still load a manifest.
  clearStrategyCache();
  const path = join(STRATEGIES_DIR, 'trend-following-v1.json');
  const result = await loadStrategy({
    uri: fileUri(path),
    expectedHash: null,
    operatorAddress: OPERATOR,
  });
  assert.equal(result.strategy.strategy.id, 'trend-following-v1');
});

test('loader: hash mismatch surfaces StrategyHashMismatch with both values', async () => {
  // Tamper detection is the cryptographic backbone that links V4's
  // acceptedManifestHash to the off-chain config. Even a minor mismatch
  // (e.g. operator changed manifest after publishing) MUST raise this
  // exact error class so the orchestrator can refuse to act.
  clearStrategyCache();
  const path = join(STRATEGIES_DIR, 'mean-reversion-v1.json');
  const wrongHash = '0x' + 'ab'.repeat(32);
  const trueHash = computeStrategyHash(JSON.parse(readFileSync(path, 'utf8')));

  await assert.rejects(
    loadStrategy({ uri: fileUri(path), expectedHash: wrongHash, operatorAddress: OPERATOR }),
    (err) => {
      assert.ok(err instanceof StrategyHashMismatch, 'wrong error class');
      assert.equal(err.name, 'StrategyHashMismatch');
      assert.equal(err.expected.toLowerCase(), wrongHash.toLowerCase());
      assert.equal(err.actual.toLowerCase(), trueHash.toLowerCase());
      return true;
    },
  );
});

test('loader: invalid JSON surfaces StrategySchemaError with errors array', async () => {
  // JSON parse failures are channelled into StrategySchemaError so the
  // single error class covers both syntactic (invalid JSON) and semantic
  // (schema violation) problems. The errors array is expected by alerting
  // hooks that publish structured failure events.
  clearStrategyCache();
  const dir = mkdtempSync(join(tmpdir(), 'aegis-strategy-loader-'));
  const path = join(dir, 'broken.json');
  writeFileSync(path, '{ "schemaVersion": 1, ', 'utf8'); // truncated

  try {
    await assert.rejects(
      loadStrategy({ uri: fileUri(path), expectedHash: null, operatorAddress: OPERATOR }),
      (err) => {
        assert.ok(err instanceof StrategySchemaError);
        assert.ok(Array.isArray(err.errors) && err.errors.length > 0);
        assert.match(err.errors[0].message, /JSON parse/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loader: schema violations surface StrategySchemaError with field paths', async () => {
  // A semantically broken manifest (here: missing required `gates`) should
  // produce a StrategySchemaError whose errors array includes the field
  // paths the validator rejected. We do not pin the exact phrasing, only
  // that gates appears among the failures.
  clearStrategyCache();
  const base = JSON.parse(readFileSync(join(STRATEGIES_DIR, 'trend-following-v1.json'), 'utf8'));
  delete base.gates;
  const { uri, cleanup } = writeTempStrategy(base);
  try {
    await assert.rejects(
      loadStrategy({ uri, expectedHash: null, operatorAddress: OPERATOR }),
      (err) => {
        assert.ok(err instanceof StrategySchemaError);
        assert.ok(err.errors.some((e) => e.path && e.path.includes('gates')),
          `expected gates error, got ${JSON.stringify(err.errors)}`);
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test('loader: unsupported schemaVersion surfaces StrategyVersionError', async () => {
  // The orchestrator can run multiple schema versions in parallel
  // (SCHEMA_VALIDATORS map), but anything outside that set is a hard
  // failure — a future-version manifest must NOT be silently downgraded
  // to v1 validation. Callers branch on this error to decide whether to
  // pause the operator.
  clearStrategyCache();
  const base = JSON.parse(readFileSync(join(STRATEGIES_DIR, 'trend-following-v1.json'), 'utf8'));
  base.schemaVersion = 99;
  const { uri, cleanup } = writeTempStrategy(base);
  try {
    await assert.rejects(
      loadStrategy({ uri, expectedHash: null, operatorAddress: OPERATOR }),
      (err) => {
        assert.ok(err instanceof StrategyVersionError);
        assert.equal(err.version, 99);
        // supported versions advertised back to the caller for diagnostics.
        assert.deepEqual(err.supported, supportedSchemaVersions().map(String));
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test('loader: scoring weights that do not sum to 1.0 surface StrategyWeightsError', async () => {
  // Weights are JSON-schema valid as individual numbers in [0,1] but the
  // loader enforces a separate ±0.01 sum invariant so the engine's
  // weighted score formula stays bounded. This guards against a typo
  // where (e.g.) trend=0.95 instead of 0.35.
  clearStrategyCache();
  const base = JSON.parse(readFileSync(join(STRATEGIES_DIR, 'trend-following-v1.json'), 'utf8'));
  base.scoring.weights.trend = 0.95; // makes the sum ~1.60
  const { uri, cleanup } = writeTempStrategy(base);
  try {
    await assert.rejects(
      loadStrategy({ uri, expectedHash: null, operatorAddress: OPERATOR }),
      (err) => {
        assert.ok(err instanceof StrategyWeightsError);
        assert.ok(typeof err.sum === 'number');
        // The error message is human-readable, but `sum` must be the
        // observed total so dashboards can display it.
        assert.ok(err.sum > 1.5, `expected sum > 1.5, got ${err.sum}`);
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test('loader: missing URI / unreachable file surfaces StrategyFetchError', async () => {
  // Fetch errors get the dedicated typed class so callers can distinguish
  // "operator manifest is offline" (transient, retryable) from "manifest
  // is bad" (permanent, requires operator action).
  clearStrategyCache();
  await assert.rejects(
    loadStrategy({
      uri: 'file:///definitely/not/a/real/path/strategy.json',
      expectedHash: null,
      operatorAddress: OPERATOR,
    }),
    (err) => {
      assert.ok(err instanceof StrategyFetchError);
      assert.match(err.message, /fetch failed/);
      return true;
    },
  );
});

test('loader: cache hit returns identical object on second call with same key', async () => {
  // The cache is keyed on (operatorAddress.toLowerCase(), hash.toLowerCase())
  // so two calls with the same arguments must return the SAME reference —
  // the production code deliberately reuses the parsed object so per-cycle
  // strategy access is O(1) after warmup.
  clearStrategyCache();
  const path = join(STRATEGIES_DIR, 'arbitrage-stable-v1.json');
  const expectedHash = computeStrategyHash(JSON.parse(readFileSync(path, 'utf8')));

  const a = await loadStrategy({ uri: fileUri(path), expectedHash, operatorAddress: OPERATOR });
  const b = await loadStrategy({ uri: fileUri(path), expectedHash, operatorAddress: OPERATOR });
  assert.equal(a, b, 'cache should return same reference');
});

test('loader: clearStrategyCache evicts so the next call re-parses', async () => {
  // After clearStrategyCache the next loadStrategy must produce a
  // fresh-parsed object (different reference but equal content). This
  // keeps tests hermetic and matches how operations would force-refresh
  // a manifest after an operator publishes a new one.
  clearStrategyCache();
  const path = join(STRATEGIES_DIR, 'arbitrage-stable-v1.json');
  const expectedHash = computeStrategyHash(JSON.parse(readFileSync(path, 'utf8')));

  const a = await loadStrategy({ uri: fileUri(path), expectedHash, operatorAddress: OPERATOR });
  clearStrategyCache();
  const b = await loadStrategy({ uri: fileUri(path), expectedHash, operatorAddress: OPERATOR });
  assert.notEqual(a, b, 'expected a fresh reference after cache clear');
  assert.deepEqual(a.strategy, b.strategy, 'content should still be equal');
});

test('loader: cache key incorporates operatorAddress (different operator = miss)', async () => {
  // Two operators committing the same hash hash-collide on content but
  // must still occupy distinct cache slots because the orchestrator
  // distinguishes them per-vault. We assert this by loading the same
  // manifest under two operator addresses and confirming they are NOT
  // the same reference.
  clearStrategyCache();
  const path = join(STRATEGIES_DIR, 'arbitrage-stable-v1.json');
  const expectedHash = computeStrategyHash(JSON.parse(readFileSync(path, 'utf8')));

  const a = await loadStrategy({ uri: fileUri(path), expectedHash, operatorAddress: OPERATOR });
  const b = await loadStrategy({
    uri: fileUri(path),
    expectedHash,
    operatorAddress: '0x' + '11'.repeat(20),
  });
  assert.notEqual(a, b, 'cache must be partitioned by operator');
  assert.equal(a.hash, b.hash, 'content hash unchanged across operators');
});
