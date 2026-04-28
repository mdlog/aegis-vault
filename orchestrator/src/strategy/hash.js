// Canonical JSON serialization + keccak256 hash for strategy manifests.
//
// Mirrors the SDK's manifest.js canonicaliser (sdk/src/manifest.js). The two
// MUST stay byte-for-byte aligned — operator tooling computes the hash off
// either side, then publishes the result via OperatorRegistry.publishManifest.
// On-chain V4 vaults bind the same hash into ExecutionIntent.strategyHash so
// auditors can prove "intent X was produced under strategy Y".
//
// Determinism rules:
//   - object keys sorted alphabetically at every level (recursive)
//   - arrays preserve order
//   - no whitespace
//   - undefined / functions / non-finite numbers throw
//   - bigints serialised as quoted strings (no native JSON bigint)

import { keccak256, toUtf8Bytes } from 'ethers';

export function canonicalizeJson(value) {
  return stringify(value, new Set());
}

function stringify(value, seen) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalizeJson: non-finite number ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    return JSON.stringify(value.toString());
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('canonicalizeJson: circular reference');
    seen.add(value);
    const out = '[' + value.map((v) => stringify(v, seen)).join(',') + ']';
    seen.delete(value);
    return out;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new Error('canonicalizeJson: circular reference');
    seen.add(value);
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ':' + stringify(value[k], seen));
    seen.delete(value);
    return '{' + parts.join(',') + '}';
  }
  throw new Error(`canonicalizeJson: cannot serialize ${typeof value}`);
}

/**
 * keccak256 of the canonical UTF-8 JSON encoding of a strategy manifest.
 * Returns 0x-prefixed 32-byte hex — matches the format that
 * OperatorRegistry.publishManifest(uri, hash, bonded) and (V4)
 * ExecutionIntent.strategyHash both expect.
 */
export function computeStrategyHash(manifest) {
  const canonical = canonicalizeJson(manifest);
  return keccak256(toUtf8Bytes(canonical));
}

/**
 * Compute the schema version field directly. Useful when you have only the
 * raw canonical JSON without a parsed object.
 */
export function extractSchemaVersion(manifest) {
  const v = manifest?.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new Error(`Invalid schemaVersion: ${v}. Must be a positive integer.`);
  }
  return v;
}
