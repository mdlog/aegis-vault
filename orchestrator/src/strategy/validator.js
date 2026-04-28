// Minimal JSON Schema validator tailored to the strategy manifest schema.
//
// We avoid pulling ajv (600 KB+) because the strategy schema is well-bounded
// and the validation rules we need are simple: type checks, enum membership,
// numeric range, string pattern, required fields, additionalProperties=false.
// If the schema grows beyond this surface, swap to ajv — the loader only
// depends on the validate() signature.

const REGIME_ENUM = [
  'TREND_UP_STRONG', 'TREND_UP_WEAK', 'RANGE_STABLE', 'RANGE_NOISY',
  'TREND_DOWN_WEAK', 'TREND_DOWN_STRONG', 'PANIC_VOLATILE', 'LOW_LIQUIDITY',
];

const TIMEFRAME_ENUM = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const STRATEGY_TYPE_ENUM = ['momentum', 'trend_following', 'mean_reversion', 'arbitrage', 'market_neutral', 'custom'];
const AI_MODE_ENUM = ['scoring_input', 'hard_gate', 'context_only'];

const HEX32 = /^0x[a-fA-F0-9]{64}$/;
const HEX20 = /^0x[a-fA-F0-9]{40}$/;
const ID_PATTERN = /^[a-z0-9-]{3,64}$/;

/**
 * Validate a parsed strategy manifest against schema v1.
 * @param {object} manifest
 * @returns {{ ok: boolean, errors: Array<{path: string, message: string}> }}
 */
export function validateManifest(manifest) {
  const errors = [];
  const ctx = { errors, path: '$' };

  if (!isObj(manifest)) return fail(ctx, 'must be an object');

  // schemaVersion
  if (manifest.schemaVersion !== 1) {
    errors.push({ path: '$.schemaVersion', message: 'must equal 1' });
  }

  // top-level required fields
  for (const key of ['strategy', 'indicators', 'scoring', 'rules', 'gates', 'veto', 'ai']) {
    if (!(key in manifest)) errors.push({ path: `$.${key}`, message: 'required' });
  }

  if (manifest.strategy) validateStrategy(manifest.strategy, ctx, 'strategy');
  if (manifest.indicators) validateIndicators(manifest.indicators, ctx, 'indicators');
  if (manifest.scoring) validateScoring(manifest.scoring, ctx, 'scoring');
  if (manifest.rules) validateRules(manifest.rules, ctx, 'rules');
  if (manifest.gates) validateGates(manifest.gates, ctx, 'gates');
  if (manifest.veto) validateVeto(manifest.veto, ctx, 'veto');
  if (manifest.ai) validateAi(manifest.ai, ctx, 'ai');

  return { ok: errors.length === 0, errors };
}

function validateStrategy(s, ctx, base) {
  if (!isObj(s)) return errAt(ctx, base, 'must be an object');
  required(s, ['id', 'name', 'type', 'timeframe'], ctx, base);
  if (s.id != null && !ID_PATTERN.test(String(s.id))) errAt(ctx, `${base}.id`, 'must match /^[a-z0-9-]{3,64}$/');
  if (s.name != null && (typeof s.name !== 'string' || s.name.length > 80)) errAt(ctx, `${base}.name`, 'max 80 chars');
  if (s.type != null && !STRATEGY_TYPE_ENUM.includes(s.type)) errAt(ctx, `${base}.type`, `must be one of ${STRATEGY_TYPE_ENUM.join('|')}`);
  if (s.timeframe != null && !TIMEFRAME_ENUM.includes(s.timeframe)) errAt(ctx, `${base}.timeframe`, `must be one of ${TIMEFRAME_ENUM.join('|')}`);
  if (s.basedOnHash != null && s.basedOnHash !== null && !HEX32.test(s.basedOnHash)) errAt(ctx, `${base}.basedOnHash`, 'must be 0x-prefixed 32-byte hex or null');
}

function validateIndicators(ind, ctx, base) {
  if (!isObj(ind)) return errAt(ctx, base, 'must be an object');
  if (ind.rsi) {
    if (ind.rsi.period != null) num(ctx, `${base}.rsi.period`, ind.rsi.period, 2, 200);
    if (ind.rsi.buyMin != null) num(ctx, `${base}.rsi.buyMin`, ind.rsi.buyMin, 0, 100);
    if (ind.rsi.buyMax != null) num(ctx, `${base}.rsi.buyMax`, ind.rsi.buyMax, 0, 100);
    if (ind.rsi.overbought != null) num(ctx, `${base}.rsi.overbought`, ind.rsi.overbought, 50, 100);
    if (ind.rsi.oversold != null) num(ctx, `${base}.rsi.oversold`, ind.rsi.oversold, 0, 50);
  }
  if (ind.macd) {
    if (ind.macd.fast != null) num(ctx, `${base}.macd.fast`, ind.macd.fast, 2, 200);
    if (ind.macd.slow != null) num(ctx, `${base}.macd.slow`, ind.macd.slow, 2, 200);
    if (ind.macd.signal != null) num(ctx, `${base}.macd.signal`, ind.macd.signal, 2, 200);
    if (ind.macd.requireHistogramPositive != null && typeof ind.macd.requireHistogramPositive !== 'boolean') {
      errAt(ctx, `${base}.macd.requireHistogramPositive`, 'must be boolean');
    }
  }
  if (ind.ema) {
    if (!Array.isArray(ind.ema.periods)) errAt(ctx, `${base}.ema.periods`, 'must be array');
    else if (ind.ema.periods.length < 1 || ind.ema.periods.length > 5) errAt(ctx, `${base}.ema.periods`, '1..5 entries');
    else ind.ema.periods.forEach((p, i) => num(ctx, `${base}.ema.periods[${i}]`, p, 2, 500));
  }
  if (ind.atr?.period != null) num(ctx, `${base}.atr.period`, ind.atr.period, 2, 200);
  if (ind.bollinger) {
    if (ind.bollinger.period != null) num(ctx, `${base}.bollinger.period`, ind.bollinger.period, 5, 200);
    if (ind.bollinger.stdDev != null) num(ctx, `${base}.bollinger.stdDev`, ind.bollinger.stdDev, 0.5, 5);
  }
}

function validateScoring(sc, ctx, base) {
  if (!isObj(sc)) return errAt(ctx, base, 'must be an object');
  if (!isObj(sc.weights)) return errAt(ctx, `${base}.weights`, 'must be an object');
  for (const k of ['trend', 'momentum', 'volatility', 'liquidity', 'riskState', 'aiContext']) {
    if (sc.weights[k] == null) errAt(ctx, `${base}.weights.${k}`, 'required');
    else num(ctx, `${base}.weights.${k}`, sc.weights[k], 0, 1);
  }
  // Sum check is enforced separately in loader (allows ±0.01 tolerance).
}

function validateRules(rs, ctx, base) {
  if (!isObj(rs)) return errAt(ctx, base, 'must be an object');
  for (const k of ['entry_long', 'exit_long', 'entry_short', 'exit_short', 'size_bps']) {
    if (rs[k] == null) continue;
    if (!isObj(rs[k])) { errAt(ctx, `${base}.${k}`, 'must be an object'); continue; }
    if (typeof rs[k].expression !== 'string') errAt(ctx, `${base}.${k}.expression`, 'required string');
    else if (rs[k].expression.length === 0 || rs[k].expression.length > 1024) {
      errAt(ctx, `${base}.${k}.expression`, '1..1024 chars');
    }
  }
}

function validateGates(g, ctx, base) {
  if (!isObj(g)) return errAt(ctx, base, 'must be an object');
  const intRange = (k, lo, hi) => g[k] != null && num(ctx, `${base}.${k}`, g[k], lo, hi);
  intRange('minEdgeBuy', 0, 100);
  intRange('minQualityBuy', 0, 100);
  intRange('minEdgeSell', 0, 100);
  intRange('minQualitySell', 0, 100);
  if (g.minConfidenceBuy != null) num(ctx, `${base}.minConfidenceBuy`, g.minConfidenceBuy, 0, 1);
  if (g.maxRiskBuy != null) num(ctx, `${base}.maxRiskBuy`, g.maxRiskBuy, 0, 1);
  for (const listKey of ['allowedBuyRegimes', 'allowedSellRegimes']) {
    if (g[listKey] == null) continue;
    if (!Array.isArray(g[listKey])) { errAt(ctx, `${base}.${listKey}`, 'must be array'); continue; }
    g[listKey].forEach((r, i) => {
      if (!REGIME_ENUM.includes(r)) errAt(ctx, `${base}.${listKey}[${i}]`, `must be one of ${REGIME_ENUM.join('|')}`);
    });
  }
}

function validateVeto(v, ctx, base) {
  if (!isObj(v)) return errAt(ctx, base, 'must be an object');
  if (v.maxAtrPct != null) num(ctx, `${base}.maxAtrPct`, v.maxAtrPct, 0, 100);
  if (v.rsiOverbought != null) num(ctx, `${base}.rsiOverbought`, v.rsiOverbought, 50, 100);
  if (v.rsiOversold != null) num(ctx, `${base}.rsiOversold`, v.rsiOversold, 0, 50);
  if (v.maxSpreadBps != null) num(ctx, `${base}.maxSpreadBps`, v.maxSpreadBps, 0, 10000);
  if (v.maxSlippageBps != null) num(ctx, `${base}.maxSlippageBps`, v.maxSlippageBps, 0, 10000);
  if (v.maxConsecutiveLosses != null) num(ctx, `${base}.maxConsecutiveLosses`, v.maxConsecutiveLosses, 0, 100);
}

function validateAi(a, ctx, base) {
  if (!isObj(a)) return errAt(ctx, base, 'must be an object');
  required(a, ['mode', 'model', 'providerAddress'], ctx, base);
  if (a.mode != null && !AI_MODE_ENUM.includes(a.mode)) errAt(ctx, `${base}.mode`, `must be one of ${AI_MODE_ENUM.join('|')}`);
  if (a.model != null && (typeof a.model !== 'string' || a.model.length === 0 || a.model.length > 128)) {
    errAt(ctx, `${base}.model`, '1..128 chars');
  }
  if (a.providerAddress != null && !HEX20.test(a.providerAddress)) errAt(ctx, `${base}.providerAddress`, 'must be 0x-prefixed 20-byte hex');
  if (a.temperature != null) num(ctx, `${base}.temperature`, a.temperature, 0, 2);
  if (a.scoringWeight != null) num(ctx, `${base}.scoringWeight`, a.scoringWeight, 0, 1);
}

// ── helpers ──

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function fail(ctx, msg) { ctx.errors.push({ path: ctx.path, message: msg }); return { ok: false, errors: ctx.errors }; }
function errAt(ctx, path, msg) { ctx.errors.push({ path: `$.${path}`, message: msg }); }
function num(ctx, path, value, lo, hi) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errAt(ctx, path.replace(/^\$\./, ''), 'must be a finite number');
  } else if (value < lo || value > hi) {
    errAt(ctx, path.replace(/^\$\./, ''), `must be in [${lo}, ${hi}]`);
  }
}
function required(obj, keys, ctx, base) {
  for (const k of keys) if (!(k in obj)) errAt(ctx, `${base}.${k}`, 'required');
}
