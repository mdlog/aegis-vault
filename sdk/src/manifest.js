// Manifest utilities — canonical JSON serialisation, content hashing, and
// schema validation for operator strategy manifests.
//
// The on-chain `publishManifest(uri, hash, bonded)` call binds an operator to
// a specific manifest via `hash = keccak256(canonicalJson(manifest))`. Any LP
// can re-fetch the manifest from `uri` and verify that the file hasn't been
// tampered with. "Canonical" here means: UTF-8 encoded JSON with all object
// keys sorted recursively — otherwise two visually-identical manifests
// serialize to different bytes and produce different hashes.
//
// This module ships the canonicaliser + hasher + validator + a builder.
// Uploading (IPFS / 0G Storage / HTTPS) is left to the caller because the
// choice of storage layer is deployment-specific.

import { keccak256, toUtf8Bytes } from 'ethers';

const REQUIRED_TOP_KEYS = ['name', 'version', 'operator', 'mandate', 'policy', 'fees', 'allowedAssets'];
const REQUIRED_POLICY_KEYS = ['maxPositionBps', 'confidenceThresholdBps', 'stopLossBps', 'cooldownSeconds', 'maxActionsPerDay'];
const REQUIRED_FEE_KEYS = ['performanceBps', 'managementBps'];

/**
 * Deterministically serialize a JSON-compatible value. Object keys are sorted
 * alphabetically at every level; arrays keep their order. Whitespace is
 * stripped (no indent). The output is stable across:
 *
 *   - key insertion order (sorted)
 *   - JSON.stringify defaults (no trailing spaces)
 *   - node version differences
 *
 * Throws on `undefined`, functions, circular refs, or non-finite numbers —
 * none of which belong in a manifest.
 *
 * @param {unknown} value
 * @returns {string}
 */
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
    // No native JSON bigint — serialise as string so the hash is deterministic.
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
 * keccak256 of the canonical UTF-8 JSON encoding. Returns `0x`-prefixed
 * 32-byte hex — the exact shape `publishManifest(uri, hash, bonded)` expects.
 *
 * @param {unknown} manifest
 * @returns {string}
 */
export function computeManifestHash(manifest) {
  const canonical = canonicalizeJson(manifest);
  return keccak256(toUtf8Bytes(canonical));
}

/**
 * Check a manifest object against the minimum schema the Aegis protocol
 * expects. Throws on first problem (collecting all errors is out of scope —
 * use a real schema tool like zod if you need that).
 *
 * Contract-side caps (fee bps, string lengths, …) are NOT validated here —
 * the chain does that at `register` / `publishManifest` time.
 *
 * @param {object} manifest
 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('validateManifest: manifest must be a plain object');
  }
  for (const key of REQUIRED_TOP_KEYS) {
    if (!(key in manifest)) {
      throw new Error(`validateManifest: missing top-level field "${key}"`);
    }
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    throw new Error('validateManifest: `name` must be a non-empty string');
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(manifest.operator)) {
    throw new Error('validateManifest: `operator` must be a 0x-prefixed 20-byte address');
  }
  if (!['Conservative', 'Balanced', 'Tactical'].includes(manifest.mandate)) {
    throw new Error('validateManifest: `mandate` must be Conservative | Balanced | Tactical');
  }

  const policy = manifest.policy;
  if (!policy || typeof policy !== 'object') {
    throw new Error('validateManifest: `policy` must be an object');
  }
  for (const key of REQUIRED_POLICY_KEYS) {
    if (typeof policy[key] !== 'number' || !Number.isFinite(policy[key])) {
      throw new Error(`validateManifest: policy.${key} must be a finite number`);
    }
  }

  const fees = manifest.fees;
  if (!fees || typeof fees !== 'object') {
    throw new Error('validateManifest: `fees` must be an object');
  }
  for (const key of REQUIRED_FEE_KEYS) {
    if (typeof fees[key] !== 'number' || !Number.isFinite(fees[key])) {
      throw new Error(`validateManifest: fees.${key} must be a finite number`);
    }
  }

  if (!Array.isArray(manifest.allowedAssets) || manifest.allowedAssets.length === 0) {
    throw new Error('validateManifest: `allowedAssets` must be a non-empty array');
  }
  for (let i = 0; i < manifest.allowedAssets.length; i++) {
    const asset = manifest.allowedAssets[i];
    if (!asset || typeof asset !== 'object' ||
        typeof asset.symbol !== 'string' ||
        !/^0x[a-fA-F0-9]{40}$/.test(asset.address) ||
        typeof asset.decimals !== 'number') {
      throw new Error(`validateManifest: allowedAssets[${i}] must have { symbol, address (0x…20b), decimals }`);
    }
  }
}

/**
 * Parse + validate a JSON string. Returns the parsed object.
 * @param {string} text
 */
export function parseManifest(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`parseManifest: invalid JSON — ${e.message}`);
  }
  validateManifest(parsed);
  return parsed;
}

/**
 * Build a manifest object from structured params. Applies sensible defaults
 * (`version: "1.0.0"`, `publishedAt: now`, empty strategy notes). The result
 * still passes `validateManifest` — callers can extend it freely before
 * hashing.
 *
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.operator                 0x-address
 * @param {'Conservative'|'Balanced'|'Tactical'} params.mandate
 * @param {object} params.policy                   { maxPositionBps, confidenceThresholdBps, stopLossBps, cooldownSeconds, maxActionsPerDay, ... }
 * @param {object} params.fees                     { performanceBps, managementBps, entryBps?, exitBps? }
 * @param {Array<{symbol:string, address:string, decimals:number, role?:string}>} params.allowedAssets
 * @param {string} [params.version='1.0.0']
 * @param {string} [params.publishedAt]            ISO8601 — defaults to now
 * @param {object} [params.network]
 * @param {object} [params.strategy]               { summary?, thesis?, venues?, executionMode? }
 * @param {object} [params.extra]                  Merged at the top level (for forward-compat)
 */
export function buildManifest(params) {
  if (!params) throw new Error('buildManifest: params required');
  const manifest = {
    name: params.name,
    version: params.version || '1.0.0',
    operator: params.operator,
    publishedAt: params.publishedAt || new Date().toISOString(),
    ...(params.network ? { network: params.network } : {}),
    mandate: params.mandate,
    ...(params.strategy ? { strategy: params.strategy } : {}),
    allowedAssets: params.allowedAssets,
    policy: params.policy,
    fees: params.fees,
    ...(params.extra || {}),
  };
  validateManifest(manifest);
  return manifest;
}
