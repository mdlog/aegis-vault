import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseExpression,
  parseDsl,
  evaluateAst,
  evaluateExpression,
  EvaluationError,
  ParseError,
  listAllowedIdentifiers,
  _resetAstCache,
} from '../../src/strategy/dsl.js';

// ── Helpers ──
//
// `ev(src, ctx)` is a parse+eval helper used by most tests. It exercises
// both the spec-named `parseExpression` and the AST-form `evaluateAst`.

function ev(src, ctx) {
  const ast = parseExpression(src);
  return evaluateAst(ast, ctx);
}

const baseCtx = () => ({
  indicators: {
    rsi_14: 50,
    macd_histogram: 0.5,
    ema_20: 100,
    ema_50: 99,
    ema_200: 98,
    atr_14_pct: 1.5,
    vwap_distance_pct: -0.2,
    volume_zscore: 0.4,
  },
  regime: 'RANGE_NOISY',
  ai: { confidence: 0.7, risk_score: 0.3, ai_context_score: 0.6, timing_score: 0.55 },
  position: { pnl_pct: 0, holding_seconds: 0 },
  vault: { maxPositionBps: 2000, consecutive_losses: 0, balance: 1000 },
});

// ── Basic evaluation ──

test('parses + evaluates simple boolean — rsi_14 < 30', () => {
  const ctx = baseCtx();
  ctx.indicators.rsi_14 = 20;
  assert.equal(ev('rsi_14 < 30', ctx), true);
  ctx.indicators.rsi_14 = 40;
  assert.equal(ev('rsi_14 < 30', ctx), false);
});

test('parses + evaluates compound — rsi_14 < 30 && macd_histogram > 0', () => {
  const ctx = baseCtx();
  ctx.indicators.rsi_14 = 25;
  ctx.indicators.macd_histogram = 0.5;
  assert.equal(ev('rsi_14 < 30 && macd_histogram > 0', ctx), true);

  ctx.indicators.macd_histogram = -0.1;
  assert.equal(ev('rsi_14 < 30 && macd_histogram > 0', ctx), false);
});

test('member access — ai.confidence > 0.5', () => {
  const ctx = baseCtx();
  ctx.ai.confidence = 0.7;
  assert.equal(ev('ai.confidence > 0.5', ctx), true);
  ctx.ai.confidence = 0.3;
  assert.equal(ev('ai.confidence > 0.5', ctx), false);
});

test('member access — position.pnl_pct + vault.maxPositionBps math', () => {
  const ctx = baseCtx();
  ctx.position.pnl_pct = 2.5;
  ctx.vault.maxPositionBps = 1500;
  assert.equal(ev('position.pnl_pct + vault.maxPositionBps', ctx), 1502.5);
});

test('in operator — regime in array', () => {
  const ctx = baseCtx();
  ctx.regime = 'RANGE_NOISY';
  assert.equal(ev("regime in ['RANGE_NOISY', 'TREND_UP_STRONG']", ctx), true);
  assert.equal(ev("regime in ['TREND_DOWN_STRONG']", ctx), false);
});

test('in operator — single-element array', () => {
  const ctx = baseCtx();
  ctx.regime = 'TREND_UP_WEAK';
  assert.equal(ev("regime in ['TREND_UP_WEAK']", ctx), true);
  assert.equal(ev("regime in ['RANGE_STABLE']", ctx), false);
});

test('in operator — empty array always false', () => {
  const ctx = baseCtx();
  assert.equal(ev('regime in []', ctx), false);
});

test('in operator — nested arrays rejected at parse time', () => {
  assert.throws(() => parseExpression("regime in [['RANGE_NOISY']]"), ParseError);
});

test('function call — min(2000, ai.confidence * 1500)', () => {
  const ctx = baseCtx();
  ctx.ai.confidence = 0.7;
  // min(2000, 0.7*1500) = min(2000, 1050) = 1050
  assert.equal(ev('min(2000, ai.confidence * 1500)', ctx), 1050);

  ctx.ai.confidence = 1.5;
  // min(2000, 2250) = 2000
  assert.equal(ev('min(2000, ai.confidence * 1500)', ctx), 2000);
});

test('function call — max(...)', () => {
  const ctx = baseCtx();
  ctx.indicators.rsi_14 = 70;
  assert.equal(ev('max(rsi_14, 50, 60)', ctx), 70);
});

test('function call — clamp(rsi_14, 0, 100)', () => {
  const ctx = baseCtx();
  ctx.indicators.rsi_14 = 50;
  assert.equal(ev('clamp(rsi_14, 0, 100)', ctx), 50);

  ctx.indicators.rsi_14 = 120;
  assert.equal(ev('clamp(rsi_14, 0, 100)', ctx), 100);

  ctx.indicators.rsi_14 = -5;
  assert.equal(ev('clamp(rsi_14, 0, 100)', ctx), 0);
});

test('clamp — wrong arity rejected at eval', () => {
  const ctx = baseCtx();
  assert.throws(() => ev('clamp(50, 0)', ctx), EvaluationError);
});

test('clamp — lo > hi rejected', () => {
  const ctx = baseCtx();
  assert.throws(() => ev('clamp(50, 100, 0)', ctx), EvaluationError);
});

test('arithmetic precedence — 2 + 3 * 4 = 14', () => {
  // Using indicator values to ensure number math works through DSL.
  const ctx = baseCtx();
  ctx.indicators.rsi_14 = 14;
  assert.equal(ev('rsi_14 == 2 + 3 * 4', ctx), true);
});

test('parentheses override precedence', () => {
  const ctx = baseCtx();
  ctx.indicators.rsi_14 = 20;
  assert.equal(ev('rsi_14 == (2 + 3) * 4', ctx), true);
});

test('logical short-circuit — left=false skips right (no eval error)', () => {
  // If short-circuit failed, dividing by zero on right would throw.
  const ctx = baseCtx();
  ctx.indicators.rsi_14 = 50;
  // rsi_14 < 0 is false; right side has 1/0 which would throw if eval'd.
  assert.equal(ev('rsi_14 < 0 && (1 / 0) > 1', ctx), false);
});

test('logical short-circuit — left=true skips right on ||', () => {
  const ctx = baseCtx();
  ctx.indicators.rsi_14 = 50;
  assert.equal(ev('rsi_14 == 50 || (1 / 0) > 1', ctx), true);
});

test('unary not — !true = false', () => {
  const ctx = baseCtx();
  assert.equal(ev('!(rsi_14 < 0)', ctx), true);
});

test('unary minus — -rsi_14', () => {
  const ctx = baseCtx();
  ctx.indicators.rsi_14 = 30;
  assert.equal(ev('-rsi_14', ctx), -30);
});

test('strict equality — string equality works', () => {
  const ctx = baseCtx();
  ctx.regime = 'TREND_UP_STRONG';
  assert.equal(ev("regime == 'TREND_UP_STRONG'", ctx), true);
  assert.equal(ev("regime != 'RANGE_NOISY'", ctx), true);
});

test('strict equality — different types unequal', () => {
  const ctx = baseCtx();
  ctx.indicators.rsi_14 = 1;
  // 1 (number) != "1" (string)
  assert.equal(ev("rsi_14 == '1'", ctx), false);
});

// ── Errors ──

test('EvaluationError thrown on division by zero', () => {
  const ctx = baseCtx();
  assert.throws(() => ev('rsi_14 / 0', ctx), EvaluationError);
});

test('EvaluationError thrown on undefined indicator', () => {
  const ctx = baseCtx();
  delete ctx.indicators.rsi_14;
  assert.throws(() => ev('rsi_14 > 0', ctx), EvaluationError);
});

test('EvaluationError thrown on undefined member', () => {
  const ctx = baseCtx();
  delete ctx.ai.confidence;
  assert.throws(() => ev('ai.confidence > 0', ctx), EvaluationError);
});

test('EvaluationError thrown on type mismatch — string vs number compare', () => {
  const ctx = baseCtx();
  ctx.regime = 'RANGE_NOISY';
  // Trying ordering compare on string vs number must throw.
  assert.throws(() => ev('regime < 5', ctx), EvaluationError);
});

test('EvaluationError thrown when && operand is non-boolean', () => {
  const ctx = baseCtx();
  // rsi_14 (number) && true should throw.
  assert.throws(() => ev('rsi_14 && true', ctx), EvaluationError);
});

// ── Security / sandboxing ──

test('security — rejects eval(...) call', () => {
  assert.throws(() => parseExpression("eval('hack')"), ParseError);
});

test('security — rejects access to console / globals', () => {
  // `console` is not in the identifier whitelist.
  assert.throws(() => parseExpression('console'), ParseError);
  assert.throws(() => parseExpression('console.log'), ParseError);
});

test('security — rejects Function constructor', () => {
  assert.throws(() => parseExpression("Function('return 1')"), ParseError);
});

test('security — rejects unknown identifier', () => {
  assert.throws(() => parseExpression('not_a_real_indicator > 0'), ParseError);
});

test('security — rejects unknown member name', () => {
  assert.throws(() => parseExpression('ai.unknown_field > 0'), ParseError);
});

test('security — rejects unknown namespace', () => {
  assert.throws(() => parseExpression('strategy.id == "x"'), ParseError);
});

test('security — rejects chained member access (a.b.c)', () => {
  assert.throws(() => parseExpression('ai.confidence.foo > 0'), ParseError);
});

test('security — rejects __proto__ / prototype access', () => {
  assert.throws(() => parseExpression('__proto__'), ParseError);
  assert.throws(() => parseExpression('ai.__proto__'), ParseError);
});

test('security — rejects unexpected punctuation (semicolons, braces)', () => {
  assert.throws(() => parseExpression('rsi_14 < 30; true'), ParseError);
  assert.throws(() => parseExpression('{ rsi_14 }'), ParseError);
});

test('security — rejects trailing tokens', () => {
  assert.throws(() => parseExpression('rsi_14 < 30 extra'), ParseError);
});

test('security — handles deep nested expressions without stack overflow', () => {
  // Build deeply nested but legal expression: ((((1 < 2)))).
  // Up to MAX_PARSE_DEPTH should parse; beyond should reject cleanly.
  const inner = '1 < 2';
  let safe = inner;
  for (let i = 0; i < 20; i += 1) safe = `(${safe})`;
  assert.equal(ev(safe, baseCtx()), true);

  // Way past limit — parser must throw, not crash.
  let toxic = inner;
  for (let i = 0; i < 200; i += 1) toxic = `(${toxic})`;
  assert.throws(() => parseExpression(toxic), ParseError);
});

test('security — rejects expression longer than 4096 chars', () => {
  const huge = 'rsi_14 < ' + '9'.repeat(5000);
  assert.throws(() => parseExpression(huge), ParseError);
});

test('security — context lookup uses hasOwnProperty (no proto pollution)', () => {
  // Even if the context was tampered with via Object.prototype, our member
  // resolver only honours own properties.
  const ctx = baseCtx();
  // We don't pollute the global prototype here (would affect other tests);
  // instead we sanity-check the resolver path by adding a non-own key.
  Object.setPrototypeOf(ctx.ai, { confidence: 999 });
  // own-property `confidence` still wins.
  assert.equal(ev('ai.confidence > 0', ctx), true);

  // Now remove own key — resolver must NOT see prototype value.
  delete ctx.ai.confidence;
  assert.throws(() => ev('ai.confidence > 0', ctx), EvaluationError);
});

// ── Alternate API surface (parseDsl + cached evaluateExpression) ──

test('parseDsl is the same function as parseExpression', () => {
  assert.equal(parseDsl, parseExpression);
});

test('evaluateExpression(source, ctx) caches AST across calls', () => {
  _resetAstCache();
  const ctx = baseCtx();
  ctx.indicators.rsi_14 = 25;
  // First call parses + caches.
  assert.equal(evaluateExpression('rsi_14 < 30', ctx), true);
  // Second call should hit cache and produce same result.
  assert.equal(evaluateExpression('rsi_14 < 30', ctx), true);
  // Different value still evaluated against new ctx.
  ctx.indicators.rsi_14 = 50;
  assert.equal(evaluateExpression('rsi_14 < 30', ctx), false);
});

// ── Introspection ──

test('listAllowedIdentifiers returns whitelist surface', () => {
  const allowed = listAllowedIdentifiers();
  assert.ok(allowed.root.includes('rsi_14'));
  assert.ok(allowed.root.includes('regime'));
  assert.ok(allowed.members.includes('ai.confidence'));
  assert.ok(allowed.members.includes('position.pnl_pct'));
  assert.ok(allowed.members.includes('vault.maxPositionBps'));
  // Spec-required functions; impl may add more (e.g. abs).
  for (const fn of ['min', 'max', 'clamp']) {
    assert.ok(allowed.functions.includes(fn), `expected function '${fn}' in whitelist`);
  }
});
