// Strategy manifest helpers for operator multi-strategy architecture.
//
// Mirror of orchestrator/src/strategy/{hash,validator,loader}.js — operator
// tooling built on the SDK MUST produce byte-identical canonical JSON + hash
// to what the orchestrator computes when it re-fetches the on-chain
// `manifestHash` and verifies it. Any drift between this file and the
// orchestrator side breaks every cycle (StrategyHashMismatch).
//
// Surface:
//   - computeStrategyHash(strategy)         — keccak256(canonicalJson(strategy))
//   - validateStrategy(strategy)            — { ok, errors[] }
//   - fetchOperatorStrategy({...})          — registry read + URI fetch + verify
//   - summarizeStrategy(strategy)           — UI-friendly summary
//
// Hash is intentionally re-implemented on top of the existing manifest
// canonicaliser (`canonicalizeJson` from manifest.js) so we don't ship two
// copies of the canonical JSON serializer.

import { keccak256, toUtf8Bytes } from 'ethers';
import { canonicalizeJson } from './manifest.js';

// ── Enum tables (mirror schema-v1.json + orchestrator/validator.js) ──

const REGIME_ENUM = [
  'TREND_UP_STRONG', 'TREND_UP_WEAK', 'RANGE_STABLE', 'RANGE_NOISY',
  'TREND_DOWN_WEAK', 'TREND_DOWN_STRONG', 'PANIC_VOLATILE', 'LOW_LIQUIDITY',
];
const TIMEFRAME_ENUM = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const STRATEGY_TYPE_ENUM = ['momentum', 'trend_following', 'mean_reversion', 'arbitrage', 'market_neutral', 'custom'];
const AI_MODE_ENUM = ['scoring_input', 'hard_gate', 'context_only'];
const SCORING_KEYS = ['trend', 'momentum', 'volatility', 'liquidity', 'riskState', 'aiContext'];

const HEX32 = /^0x[a-fA-F0-9]{64}$/;
const HEX20 = /^0x[a-fA-F0-9]{40}$/;
const ID_PATTERN = /^[a-z0-9-]{3,64}$/;

const SUPPORTED_SCHEMA_VERSIONS = [1];
const WEIGHT_SUM_TOLERANCE = 0.01;

// Minimal OperatorRegistry fragment — enough to call getOperatorExtended
// without forcing callers to import the full ABI. Names match the on-chain
// signature exactly.
const OPERATOR_REGISTRY_FRAGMENT = [
  'function getOperatorExtended(address) view returns (tuple(address wallet, string name, string description, string endpoint, uint8 mandate, uint64 registeredAt, uint64 updatedAt, bool active, uint16 performanceFeeBps, uint16 managementFeeBps, uint16 entryFeeBps, uint16 exitFeeBps, uint16 recommendedMaxPositionBps, uint16 recommendedConfidenceMinBps, uint16 recommendedStopLossBps, uint32 recommendedCooldownSeconds, uint16 recommendedMaxActionsPerDay, string manifestURI, bytes32 manifestHash, uint256 manifestVersion, uint64 manifestPublishedAt, bool manifestBonded, string aiModel, address aiProvider, string aiEndpoint, uint64 aiCommittedAt))',
];

// ── Public API ──

/**
 * keccak256 of the canonical UTF-8 JSON encoding of a strategy manifest.
 * Returns 0x-prefixed 32-byte hex — matches the format that
 * `OperatorRegistry.publishManifest(uri, hash, bonded)` and (V4)
 * `ExecutionIntent.strategyHash` both expect.
 *
 * MUST stay byte-identical to orchestrator/src/strategy/hash.js. Test
 * `strategy.test.js` pins the hashes of the five reference templates so any
 * drift trips CI immediately.
 *
 * @param {object} strategy
 * @returns {string} 0x… 32-byte hex
 */
export function computeStrategyHash(strategy) {
  const canonical = canonicalizeJson(strategy);
  return keccak256(toUtf8Bytes(canonical));
}

/**
 * Lightweight schema validator for strategy manifests. Mirrors the
 * orchestrator's validator + the loader's weight-sum check so operator UIs
 * can pre-flight a manifest before `publishManifest`.
 *
 * Returns `{ ok, errors }` rather than throwing — UIs typically render the
 * error list inline.
 *
 * @param {object} strategy
 * @returns {{ ok: boolean, errors: Array<{path: string, message: string}> }}
 */
export function validateStrategy(strategy) {
  const errors = [];
  if (!isObj(strategy)) {
    errors.push({ path: '$', message: 'must be an object' });
    return { ok: false, errors };
  }

  // schemaVersion
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(strategy.schemaVersion)) {
    errors.push({
      path: '$.schemaVersion',
      message: `must be one of ${SUPPORTED_SCHEMA_VERSIONS.join('|')}`,
    });
  }

  // Top-level required fields
  for (const key of ['strategy', 'indicators', 'scoring', 'rules', 'gates', 'veto', 'ai']) {
    if (!(key in strategy)) errors.push({ path: `$.${key}`, message: 'required' });
  }

  if (strategy.strategy) checkStrategyBlock(strategy.strategy, errors);
  if (strategy.indicators) checkIndicators(strategy.indicators, errors);
  if (strategy.scoring) checkScoring(strategy.scoring, errors);
  if (strategy.rules) checkRules(strategy.rules, errors);
  if (strategy.gates) checkGates(strategy.gates, errors);
  if (strategy.veto) checkVeto(strategy.veto, errors);
  if (strategy.ai) checkAi(strategy.ai, errors);

  return { ok: errors.length === 0, errors };
}

/**
 * Fetch + verify an operator's currently-published strategy manifest from
 * the on-chain registry.
 *
 * Steps:
 *   1. `OperatorRegistry.getOperatorExtended(operator)` → manifestURI, manifestHash
 *   2. If the operator has not published a manifest (empty URI or zero hash):
 *      returns `null` so the caller can fall back to the default Decision Engine.
 *   3. Fetch URI content (https/http/ipfs/file).
 *   4. Recompute `keccak256(canonicalJson(parsed))` and compare to manifestHash.
 *      Mismatch raises so callers don't trust tampered content.
 *   5. Parse + return.
 *
 * The default `fetchImpl` is the global `fetch`, but tests can inject a stub.
 * Same for `provider` — pass any ethers ContractRunner (signer or provider).
 *
 * @param {object} args
 * @param {string} args.operatorAddress
 * @param {string} args.registryAddress
 * @param {import('ethers').ContractRunner} args.provider
 * @param {(uri: string) => Promise<string>} [args.fetchImpl]    Override for tests
 * @param {string} [args.ipfsGateway='https://ipfs.io/ipfs/']
 * @param {(addr: string, abi: string[], runner: any) => any} [args._contractFactory]
 *     Internal hook for tests — substitute the ethers Contract constructor.
 *     The default uses ethers' real Contract; tests pass a stub that
 *     returns `{ getOperatorExtended: () => extended }`.
 * @returns {Promise<null | {strategy, hash, manifestURI, manifestHash, manifestVersion, summary}>}
 */
export async function fetchOperatorStrategy({
  operatorAddress,
  registryAddress,
  provider,
  fetchImpl,
  ipfsGateway = 'https://ipfs.io/ipfs/',
  _contractFactory,
}) {
  if (!operatorAddress || !HEX20.test(operatorAddress)) {
    throw new Error('fetchOperatorStrategy: operatorAddress must be a 0x-prefixed 20-byte hex address');
  }
  if (!registryAddress || !HEX20.test(registryAddress)) {
    throw new Error('fetchOperatorStrategy: registryAddress must be a 0x-prefixed 20-byte hex address');
  }
  if (!provider) {
    throw new Error('fetchOperatorStrategy: provider is required (pass an ethers signer or provider)');
  }

  let registry;
  if (_contractFactory) {
    registry = _contractFactory(registryAddress, OPERATOR_REGISTRY_FRAGMENT, provider);
  } else {
    // Lazy import: keep ethers a peer dep — the manifest hashing path doesn't
    // need a full Contract instance.
    const { Contract } = await import('ethers');
    registry = new Contract(registryAddress, OPERATOR_REGISTRY_FRAGMENT, provider);
  }

  let extended;
  try {
    extended = await registry.getOperatorExtended(operatorAddress);
  } catch (err) {
    throw new Error(`fetchOperatorStrategy: registry read failed — ${err?.message || err}`);
  }

  // ethers returns a Result with both numeric and named accessors.
  const manifestURI = extended.manifestURI ?? extended[17];
  const manifestHash = extended.manifestHash ?? extended[18];
  const manifestVersion = Number(extended.manifestVersion ?? extended[19] ?? 0);

  if (!manifestURI || manifestHash === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    return null;
  }

  // Fetch content
  const fetcher = fetchImpl || createDefaultFetcher(ipfsGateway);
  let raw;
  try {
    raw = await fetcher(manifestURI);
  } catch (err) {
    throw new Error(`fetchOperatorStrategy: fetch failed for ${manifestURI} — ${err?.message || err}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`fetchOperatorStrategy: manifest at ${manifestURI} is not valid JSON — ${err.message}`);
  }

  const actualHash = computeStrategyHash(parsed);
  if (actualHash.toLowerCase() !== String(manifestHash).toLowerCase()) {
    throw new Error(
      `fetchOperatorStrategy: hash mismatch — expected ${manifestHash}, got ${actualHash} (manifest at ${manifestURI} may have been tampered with)`,
    );
  }

  return {
    strategy: parsed,
    hash: actualHash,
    manifestURI,
    manifestHash,
    manifestVersion,
    summary: summarizeStrategy(parsed),
  };
}

/**
 * Reduce a parsed strategy manifest to the fields a UI cares about. Returns
 * `null` if the input is missing core blocks — easier for callers than
 * sprinkling defensive `?.` everywhere.
 *
 * @param {object} strategy
 * @returns {null | {
 *   id: string, name: string, type: string, timeframe: string,
 *   aiModel: string, aiMode: string,
 *   weights: object,
 *   allowedRegimes: string[],
 *   minConfidence: number|null,
 *   minEdge: number|null,
 *   schemaVersion: number,
 * }}
 */
export function summarizeStrategy(strategy) {
  if (!isObj(strategy) || !isObj(strategy.strategy) || !isObj(strategy.scoring) || !isObj(strategy.ai)) {
    return null;
  }
  return {
    schemaVersion: strategy.schemaVersion,
    id: strategy.strategy.id,
    name: strategy.strategy.name,
    type: strategy.strategy.type,
    timeframe: strategy.strategy.timeframe,
    description: strategy.strategy.description ?? null,
    aiModel: strategy.ai.model,
    aiMode: strategy.ai.mode,
    aiProviderAddress: strategy.ai.providerAddress,
    weights: strategy.scoring.weights,
    allowedRegimes: strategy.gates?.allowedBuyRegimes || [],
    allowedSellRegimes: strategy.gates?.allowedSellRegimes || [],
    minConfidence: strategy.gates?.minConfidenceBuy ?? null,
    minEdge: strategy.gates?.minEdgeBuy ?? null,
    maxRisk: strategy.gates?.maxRiskBuy ?? null,
  };
}

// ── Internals ──

function createDefaultFetcher(ipfsGateway) {
  return async (uri) => {
    if (typeof uri !== 'string' || uri.length === 0) {
      throw new Error('Empty URI');
    }
    const lower = uri.toLowerCase();
    if (lower.startsWith('ipfs://')) {
      const cid = uri.slice('ipfs://'.length);
      const url = `${ipfsGateway}${cid}`;
      const res = await globalFetch(url);
      if (!res.ok) throw new Error(`IPFS gateway HTTP ${res.status}`);
      return await res.text();
    }
    if (lower.startsWith('http://') || lower.startsWith('https://')) {
      const res = await globalFetch(uri);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    }
    if (lower.startsWith('file:')) {
      // Node-only convenience for tests; bundlers tree-shake fs out of the
      // browser build because this branch is never hit there.
      const { readFileSync } = await import('fs');
      const path = uri.replace(/^file:(\/\/)?/, '');
      return readFileSync(path, 'utf8');
    }
    throw new Error(`Unknown URI scheme: ${uri}`);
  };
}

function globalFetch(url) {
  if (typeof fetch !== 'function') {
    throw new Error('global fetch is not available — run on Node 18+ or supply a custom fetchImpl');
  }
  return fetch(url);
}

// ── validator helpers ──

function checkStrategyBlock(s, errors) {
  if (!isObj(s)) { errors.push({ path: '$.strategy', message: 'must be an object' }); return; }
  required(s, ['id', 'name', 'type', 'timeframe'], 'strategy', errors);
  if (s.id != null && !ID_PATTERN.test(String(s.id))) errors.push({ path: '$.strategy.id', message: 'must match /^[a-z0-9-]{3,64}$/' });
  if (s.name != null && (typeof s.name !== 'string' || s.name.length === 0 || s.name.length > 80)) {
    errors.push({ path: '$.strategy.name', message: '1..80 chars' });
  }
  if (s.type != null && !STRATEGY_TYPE_ENUM.includes(s.type)) {
    errors.push({ path: '$.strategy.type', message: `must be one of ${STRATEGY_TYPE_ENUM.join('|')}` });
  }
  if (s.timeframe != null && !TIMEFRAME_ENUM.includes(s.timeframe)) {
    errors.push({ path: '$.strategy.timeframe', message: `must be one of ${TIMEFRAME_ENUM.join('|')}` });
  }
  if (s.basedOnHash != null && s.basedOnHash !== null && !HEX32.test(s.basedOnHash)) {
    errors.push({ path: '$.strategy.basedOnHash', message: 'must be 0x-prefixed 32-byte hex or null' });
  }
}

function checkIndicators(ind, errors) {
  if (!isObj(ind)) { errors.push({ path: '$.indicators', message: 'must be an object' }); return; }
  if (ind.rsi) {
    if (ind.rsi.period != null) numRange('indicators.rsi.period', ind.rsi.period, 2, 200, errors);
    if (ind.rsi.buyMin != null) numRange('indicators.rsi.buyMin', ind.rsi.buyMin, 0, 100, errors);
    if (ind.rsi.buyMax != null) numRange('indicators.rsi.buyMax', ind.rsi.buyMax, 0, 100, errors);
  }
  if (ind.macd) {
    if (ind.macd.fast != null) numRange('indicators.macd.fast', ind.macd.fast, 2, 200, errors);
    if (ind.macd.slow != null) numRange('indicators.macd.slow', ind.macd.slow, 2, 200, errors);
    if (ind.macd.signal != null) numRange('indicators.macd.signal', ind.macd.signal, 2, 200, errors);
  }
  if (ind.ema) {
    if (!Array.isArray(ind.ema.periods)) errors.push({ path: '$.indicators.ema.periods', message: 'must be array' });
    else if (ind.ema.periods.length < 1 || ind.ema.periods.length > 5) {
      errors.push({ path: '$.indicators.ema.periods', message: '1..5 entries' });
    }
  }
}

function checkScoring(sc, errors) {
  if (!isObj(sc)) { errors.push({ path: '$.scoring', message: 'must be an object' }); return; }
  if (!isObj(sc.weights)) {
    errors.push({ path: '$.scoring.weights', message: 'must be an object' });
    return;
  }
  let sum = 0;
  for (const k of SCORING_KEYS) {
    const v = sc.weights[k];
    if (v == null) {
      errors.push({ path: `$.scoring.weights.${k}`, message: 'required' });
    } else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
      errors.push({ path: `$.scoring.weights.${k}`, message: 'must be a number in [0, 1]' });
    } else {
      sum += v;
    }
  }
  // Only enforce sum check if all weights were numerically valid
  const allValid = SCORING_KEYS.every((k) => typeof sc.weights[k] === 'number' && Number.isFinite(sc.weights[k]));
  if (allValid && Math.abs(sum - 1.0) > WEIGHT_SUM_TOLERANCE) {
    errors.push({
      path: '$.scoring.weights',
      message: `sum must be 1.0 ±${WEIGHT_SUM_TOLERANCE} (got ${sum.toFixed(4)})`,
    });
  }
}

function checkRules(rs, errors) {
  if (!isObj(rs)) { errors.push({ path: '$.rules', message: 'must be an object' }); return; }
  for (const k of ['entry_long', 'exit_long', 'entry_short', 'exit_short', 'size_bps']) {
    if (rs[k] == null) continue;
    if (!isObj(rs[k])) { errors.push({ path: `$.rules.${k}`, message: 'must be an object' }); continue; }
    if (typeof rs[k].expression !== 'string' || rs[k].expression.length === 0 || rs[k].expression.length > 1024) {
      errors.push({ path: `$.rules.${k}.expression`, message: '1..1024 char string' });
    }
  }
}

function checkGates(g, errors) {
  if (!isObj(g)) { errors.push({ path: '$.gates', message: 'must be an object' }); return; }
  const intRange = (k, lo, hi) => {
    if (g[k] != null) numRange(`gates.${k}`, g[k], lo, hi, errors);
  };
  intRange('minEdgeBuy', 0, 100);
  intRange('minQualityBuy', 0, 100);
  intRange('minEdgeSell', 0, 100);
  intRange('minQualitySell', 0, 100);
  if (g.minConfidenceBuy != null) numRange('gates.minConfidenceBuy', g.minConfidenceBuy, 0, 1, errors);
  if (g.maxRiskBuy != null) numRange('gates.maxRiskBuy', g.maxRiskBuy, 0, 1, errors);
  for (const listKey of ['allowedBuyRegimes', 'allowedSellRegimes']) {
    if (g[listKey] == null) continue;
    if (!Array.isArray(g[listKey])) { errors.push({ path: `$.gates.${listKey}`, message: 'must be array' }); continue; }
    g[listKey].forEach((r, i) => {
      if (!REGIME_ENUM.includes(r)) errors.push({ path: `$.gates.${listKey}[${i}]`, message: `must be one of ${REGIME_ENUM.join('|')}` });
    });
  }
}

function checkVeto(v, errors) {
  if (!isObj(v)) { errors.push({ path: '$.veto', message: 'must be an object' }); return; }
  if (v.maxAtrPct != null) numRange('veto.maxAtrPct', v.maxAtrPct, 0, 100, errors);
  if (v.rsiOverbought != null) numRange('veto.rsiOverbought', v.rsiOverbought, 50, 100, errors);
  if (v.rsiOversold != null) numRange('veto.rsiOversold', v.rsiOversold, 0, 50, errors);
  if (v.maxSpreadBps != null) numRange('veto.maxSpreadBps', v.maxSpreadBps, 0, 10000, errors);
  if (v.maxSlippageBps != null) numRange('veto.maxSlippageBps', v.maxSlippageBps, 0, 10000, errors);
  if (v.maxConsecutiveLosses != null) numRange('veto.maxConsecutiveLosses', v.maxConsecutiveLosses, 0, 100, errors);
}

function checkAi(a, errors) {
  if (!isObj(a)) { errors.push({ path: '$.ai', message: 'must be an object' }); return; }
  required(a, ['mode', 'model', 'providerAddress'], 'ai', errors);
  if (a.mode != null && !AI_MODE_ENUM.includes(a.mode)) errors.push({ path: '$.ai.mode', message: `must be one of ${AI_MODE_ENUM.join('|')}` });
  if (a.model != null && (typeof a.model !== 'string' || a.model.length === 0 || a.model.length > 128)) {
    errors.push({ path: '$.ai.model', message: '1..128 chars' });
  }
  if (a.providerAddress != null && !HEX20.test(a.providerAddress)) {
    errors.push({ path: '$.ai.providerAddress', message: 'must be 0x-prefixed 20-byte hex' });
  }
  if (a.temperature != null) numRange('ai.temperature', a.temperature, 0, 2, errors);
  if (a.scoringWeight != null) numRange('ai.scoringWeight', a.scoringWeight, 0, 1, errors);
}

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

function required(obj, keys, base, errors) {
  for (const k of keys) {
    if (!(k in obj)) errors.push({ path: `$.${base}.${k}`, message: 'required' });
  }
}

function numRange(path, value, lo, hi, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ path: `$.${path}`, message: 'must be a finite number' });
  } else if (value < lo || value > hi) {
    errors.push({ path: `$.${path}`, message: `must be in [${lo}, ${hi}]` });
  }
}

/**
 * Supported schema versions — exposed for parity with the orchestrator's
 * `supportedSchemaVersions()` helper.
 */
export function supportedStrategySchemaVersions() {
  return [...SUPPORTED_SCHEMA_VERSIONS];
}
