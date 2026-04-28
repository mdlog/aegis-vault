// Strategy manifest loader.
//
// Responsibilities:
//   1. Resolve manifest URI (ipfs://, https://, 0gstorage://, file:)
//   2. Fetch manifest content
//   3. Verify keccak256(content) matches the on-chain manifestHash
//   4. Validate against JSON Schema
//   5. Validate scoring weights sum to 1.0 ±0.01
//   6. Cache by (operatorAddress, manifestHash) — invalidate on hash change
//   7. Return parsed + validated strategy object
//
// Failure modes (handled here, raised as typed errors so caller can branch):
//   - StrategyFetchError      — URI unreachable
//   - StrategyHashMismatch    — content doesn't match committed hash (tampering)
//   - StrategySchemaError     — JSON invalid against schema
//   - StrategyVersionError    — schemaVersion not supported by this orchestrator
//   - StrategyWeightsError    — scoring weights don't sum to ~1.0
//
// Phase 2 integration wires this into orchestrator.runVaultCycle so each
// vault's operator strategy is loaded once per cycle and passed to the
// decision engine.

import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { computeStrategyHash, extractSchemaVersion } from './hash.js';
import { validateManifest } from './validator.js';
import { parseDsl, ParseError } from './dsl.js';
import logger from '../utils/logger.js';

// Supported schema versions — orchestrator can run multiple.
// Each entry maps schemaVersion → validator function returning {ok, errors}.
const SCHEMA_VALIDATORS = {
  1: validateManifest,
};

// In-memory cache. Key = `${operatorAddress.toLowerCase()}:${manifestHash}`.
// Invalidated automatically when hash changes. Optionally backed by disk
// (see persist() below) so restart doesn't refetch every manifest.
const cache = new Map();
const MAX_CACHE_ENTRIES = 256;

// ── Typed errors ──

export class StrategyFetchError extends Error {
  constructor(uri, cause) {
    super(`Strategy fetch failed for ${uri}: ${cause?.message || cause}`);
    this.name = 'StrategyFetchError';
    this.uri = uri;
  }
}

export class StrategyHashMismatch extends Error {
  constructor(uri, expected, actual) {
    super(`Strategy hash mismatch at ${uri}: expected ${expected}, got ${actual}`);
    this.name = 'StrategyHashMismatch';
    this.uri = uri;
    this.expected = expected;
    this.actual = actual;
  }
}

export class StrategySchemaError extends Error {
  constructor(errors) {
    super(`Strategy schema validation failed: ${JSON.stringify(errors).slice(0, 500)}`);
    this.name = 'StrategySchemaError';
    this.errors = errors;
  }
}

export class StrategyVersionError extends Error {
  constructor(version, supported) {
    super(`Strategy schema version ${version} not supported by this orchestrator. Supported: ${supported.join(', ')}`);
    this.name = 'StrategyVersionError';
    this.version = version;
    this.supported = supported;
  }
}

export class StrategyWeightsError extends Error {
  constructor(weights, sum) {
    super(`Strategy scoring weights must sum to 1.0 (got ${sum.toFixed(4)})`);
    this.name = 'StrategyWeightsError';
    this.weights = weights;
    this.sum = sum;
  }
}

export class StrategyDslError extends Error {
  constructor(rule, parseError) {
    super(`Strategy DSL ${rule} expression invalid: ${parseError?.message || parseError}`);
    this.name = 'StrategyDslError';
    this.rule = rule;
    this.cause = parseError;
  }
}

// ── Public API ──

/**
 * Load + verify + parse a strategy manifest.
 *
 * @param {object} args
 * @param {string} args.uri              Manifest location (ipfs:// | https:// | 0gstorage:// | file:)
 * @param {string} args.expectedHash     keccak256 hash committed on-chain
 * @param {string} args.operatorAddress  Operator wallet (used as cache key)
 * @returns {Promise<{strategy: object, hash: string, schemaVersion: number, raw: string}>}
 */
export async function loadStrategy({ uri, expectedHash, operatorAddress }) {
  const cacheKey = `${operatorAddress?.toLowerCase()}:${expectedHash?.toLowerCase()}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  // 1. Fetch
  let raw;
  try {
    raw = await fetchManifestContent(uri);
  } catch (err) {
    throw new StrategyFetchError(uri, err);
  }

  // 2. Hash verify
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StrategySchemaError([{ message: `JSON parse: ${err.message}` }]);
  }
  const actualHash = computeStrategyHash(parsed);
  if (expectedHash && actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new StrategyHashMismatch(uri, expectedHash, actualHash);
  }

  // 3. Schema version check
  const version = extractSchemaVersion(parsed);
  const validator = SCHEMA_VALIDATORS[version];
  if (!validator) {
    throw new StrategyVersionError(version, Object.keys(SCHEMA_VALIDATORS));
  }

  // 4. Schema validate
  const validation = validator(parsed);
  if (!validation.ok) {
    throw new StrategySchemaError(validation.errors);
  }

  // 5. Scoring weights sum check
  const weights = parsed.scoring.weights;
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) > 0.01) {
    throw new StrategyWeightsError(weights, sum);
  }

  // 6. Pre-parse all DSL rule expressions — fail fast at load, not at runtime.
  // Closes the audit gap where the validator only checks expression length.
  // Without this, a typo or unknown identifier only surfaces during a live
  // cycle (potentially after burning gas on a commit) instead of at publish.
  const ruleKeys = ['entry_long', 'exit_long', 'entry_short', 'exit_short', 'size_bps'];
  for (const ruleKey of ruleKeys) {
    const rule = parsed.rules?.[ruleKey];
    if (!rule?.expression) continue;
    try {
      parseDsl(rule.expression);
    } catch (err) {
      if (err instanceof ParseError) {
        throw new StrategyDslError(ruleKey, err);
      }
      throw err;
    }
  }

  const result = {
    strategy: parsed,
    hash: actualHash,
    schemaVersion: version,
    raw,
  };

  // 6. Cache (LRU eviction)
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(cacheKey, result);

  logger.info(`Strategy loaded: ${parsed.strategy.id} (schema v${version}, hash ${actualHash.slice(0, 10)}...) for operator ${operatorAddress?.slice(0, 8)}...`);
  return result;
}

/**
 * Fetch raw manifest content from a URI. Handles common storage layers.
 * For unknown schemes, falls back to https:// fetch.
 */
async function fetchManifestContent(uri) {
  if (!uri) throw new Error('Empty URI');
  const lower = uri.toLowerCase();

  // file:// — local filesystem (testing only)
  if (lower.startsWith('file:')) {
    const path = uri.replace(/^file:(\/\/)?/, '');
    return readFileSync(resolvePath(path), 'utf8');
  }

  // ipfs:// — fall through to gateway. Production should use a pinned gateway.
  if (lower.startsWith('ipfs://')) {
    const cid = uri.replace(/^ipfs:\/\//, '');
    const gateway = process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/';
    const res = await fetch(`${gateway}${cid}`);
    if (!res.ok) throw new Error(`IPFS gateway ${res.status}`);
    return await res.text();
  }

  // 0gstorage:// — 0G Storage native fetch. Stub for now.
  if (lower.startsWith('0gstorage://')) {
    // TODO: integrate @0gfoundation/0g-ts-sdk for native KV fetch
    throw new Error('0gstorage:// not yet implemented — use ipfs:// or https:// for now');
  }

  // https:// or http:// — direct fetch
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }

  throw new Error(`Unknown URI scheme: ${uri}`);
}

/**
 * Drop cache (testing / forced refresh).
 */
export function clearStrategyCache() {
  cache.clear();
}

/**
 * Returns supported schema versions.
 */
export function supportedSchemaVersions() {
  return Object.keys(SCHEMA_VALIDATORS).map(Number);
}
