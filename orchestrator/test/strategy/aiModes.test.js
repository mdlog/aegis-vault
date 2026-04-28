import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAiMode,
  resolveGateOverride,
  _internal,
} from '../../src/strategy/aiModes.js';

const { normaliseAction, NEUTRAL_AI_VIEW, VALID_MODES, pickMode, sanitiseAiView } = _internal;

// ── Helpers ──

function strategy(mode) {
  return { ai: { mode } };
}

function fullAiView() {
  return {
    confidence: 0.82,
    risk_score: 0.21,
    ai_context_score: 71,
    timing_score: 65,
    action_hint: 'buy',
    reason_hint: 'momentum building',
  };
}

// ── scoring_input mode ──

test('scoring_input — passes AI view through unchanged (no gateOverride)', () => {
  const ai = fullAiView();
  const { aiView, gateOverride } = applyAiMode(ai, strategy('scoring_input'));

  assert.equal(gateOverride, null);
  // Numeric fields preserved.
  assert.equal(aiView.confidence, 0.82);
  assert.equal(aiView.risk_score, 0.21);
  assert.equal(aiView.ai_context_score, 71);
  assert.equal(aiView.timing_score, 65);
  assert.equal(aiView.action_hint, 'buy');
  assert.equal(aiView.reason_hint, 'momentum building');
});

test('scoring_input — fills numeric defaults when fields missing', () => {
  const { aiView } = applyAiMode({ confidence: 0.9 }, strategy('scoring_input'));
  assert.equal(aiView.confidence, 0.9);
  assert.equal(aiView.risk_score, NEUTRAL_AI_VIEW.risk_score);
  assert.equal(aiView.ai_context_score, NEUTRAL_AI_VIEW.ai_context_score);
  assert.equal(aiView.timing_score, NEUTRAL_AI_VIEW.timing_score);
});

test('scoring_input — null aiView coerces to neutral', () => {
  const { aiView, gateOverride } = applyAiMode(null, strategy('scoring_input'));
  assert.equal(gateOverride, null);
  assert.equal(aiView.confidence, NEUTRAL_AI_VIEW.confidence);
  assert.equal(aiView.action_hint, null);
  assert.equal(aiView.reason_hint, null);
});

test('scoring_input — does not mutate caller object', () => {
  const ai = fullAiView();
  const snapshot = { ...ai };
  applyAiMode(ai, strategy('scoring_input'));
  assert.deepEqual(ai, snapshot);
});

// ── hard_gate mode ──

test('hard_gate — returns deferred gateOverride descriptor with normalised AI action', () => {
  const ai = { ...fullAiView(), action_hint: 'sell' };
  const { aiView, gateOverride } = applyAiMode(ai, strategy('hard_gate'));

  assert.equal(aiView.confidence, 0.82); // numbers preserved
  assert.ok(gateOverride);
  assert.equal(gateOverride.mode, 'hard_gate');
  assert.equal(gateOverride.ai_action, 'sell');
});

test('hard_gate — overrides BUY engine action when AI says hold', () => {
  const ai = { ...fullAiView(), action_hint: 'hold' };
  const { gateOverride } = applyAiMode(ai, strategy('hard_gate'));
  const result = resolveGateOverride(gateOverride, 'buy');

  assert.ok(result);
  assert.equal(result.force_action, 'hold');
  assert.match(result.reason, /AI vetoed BUY/);
});

test('hard_gate — overrides BUY engine action when AI says sell (contradiction)', () => {
  const ai = { ...fullAiView(), action_hint: 'sell' };
  const { gateOverride } = applyAiMode(ai, strategy('hard_gate'));
  const result = resolveGateOverride(gateOverride, 'BUY');

  assert.ok(result);
  assert.equal(result.force_action, 'hold');
  assert.match(result.reason, /AI vetoed BUY/);
});

test('hard_gate — overrides SELL engine action when AI says buy', () => {
  const ai = { ...fullAiView(), action_hint: 'buy' };
  const { gateOverride } = applyAiMode(ai, strategy('hard_gate'));
  const result = resolveGateOverride(gateOverride, 'sell');

  assert.ok(result);
  assert.equal(result.force_action, 'hold');
  assert.match(result.reason, /AI vetoed SELL/);
});

test('hard_gate — overrides SELL engine action when AI says hold', () => {
  const ai = { ...fullAiView(), action_hint: 'hold' };
  const { gateOverride } = applyAiMode(ai, strategy('hard_gate'));
  const result = resolveGateOverride(gateOverride, 'sell');

  assert.ok(result);
  assert.equal(result.force_action, 'hold');
  assert.match(result.reason, /AI vetoed SELL/);
});

test('hard_gate — allows BUY when AI also says buy (no override)', () => {
  const ai = { ...fullAiView(), action_hint: 'buy' };
  const { gateOverride } = applyAiMode(ai, strategy('hard_gate'));
  const result = resolveGateOverride(gateOverride, 'buy');
  assert.equal(result, null);
});

test('hard_gate — allows SELL when AI also says sell', () => {
  const ai = { ...fullAiView(), action_hint: 'sell' };
  const { gateOverride } = applyAiMode(ai, strategy('hard_gate'));
  const result = resolveGateOverride(gateOverride, 'sell');
  assert.equal(result, null);
});

test('hard_gate — engine HOLD never overridden (engine already at HOLD)', () => {
  const ai = { ...fullAiView(), action_hint: 'buy' };
  const { gateOverride } = applyAiMode(ai, strategy('hard_gate'));
  const result = resolveGateOverride(gateOverride, 'hold');
  assert.equal(result, null);
});

test('hard_gate — unknown AI hint does NOT override (abstains)', () => {
  const ai = { ...fullAiView(), action_hint: 'something-weird' };
  const { gateOverride } = applyAiMode(ai, strategy('hard_gate'));
  assert.equal(gateOverride.ai_action, 'unknown');
  assert.equal(resolveGateOverride(gateOverride, 'buy'), null);
  assert.equal(resolveGateOverride(gateOverride, 'sell'), null);
});

test('hard_gate — accepts action_hint synonyms (enter_long, exit, close)', () => {
  // enter_long → buy; agrees with BUY engine → no override
  const r1 = applyAiMode({ action_hint: 'enter_long' }, strategy('hard_gate'));
  assert.equal(r1.gateOverride.ai_action, 'buy');
  assert.equal(resolveGateOverride(r1.gateOverride, 'buy'), null);

  // exit → sell; contradicts BUY engine → override
  const r2 = applyAiMode({ action_hint: 'exit' }, strategy('hard_gate'));
  assert.equal(r2.gateOverride.ai_action, 'sell');
  assert.equal(resolveGateOverride(r2.gateOverride, 'buy').force_action, 'hold');

  // close → sell
  const r3 = applyAiMode({ action_hint: 'close' }, strategy('hard_gate'));
  assert.equal(r3.gateOverride.ai_action, 'sell');
});

// ── context_only mode ──

test('context_only — strips AI numerics to neutral values', () => {
  const ai = fullAiView();
  const { aiView, gateOverride } = applyAiMode(ai, strategy('context_only'));

  assert.equal(gateOverride, null);
  assert.equal(aiView.confidence, NEUTRAL_AI_VIEW.confidence);
  assert.equal(aiView.risk_score, NEUTRAL_AI_VIEW.risk_score);
  assert.equal(aiView.ai_context_score, NEUTRAL_AI_VIEW.ai_context_score);
  assert.equal(aiView.timing_score, NEUTRAL_AI_VIEW.timing_score);
});

test('context_only — preserves text reasoning hints for journal display', () => {
  const ai = fullAiView();
  const { aiView } = applyAiMode(ai, strategy('context_only'));
  assert.equal(aiView.action_hint, 'buy');
  assert.equal(aiView.reason_hint, 'momentum building');
});

test('context_only — null hints when AI provides none', () => {
  const { aiView } = applyAiMode({}, strategy('context_only'));
  assert.equal(aiView.action_hint, null);
  assert.equal(aiView.reason_hint, null);
});

// ── Mode dispatch / fallbacks ──

test('unknown mode falls back to scoring_input (defensive default)', () => {
  const ai = fullAiView();
  const { aiView, gateOverride } = applyAiMode(ai, strategy('totally-fake-mode'));
  // Numbers preserved like scoring_input.
  assert.equal(aiView.confidence, 0.82);
  assert.equal(gateOverride, null);
});

test('missing strategy.ai falls back to scoring_input', () => {
  const { aiView, gateOverride } = applyAiMode(fullAiView(), {});
  assert.equal(aiView.confidence, 0.82);
  assert.equal(gateOverride, null);
});

test('null strategy falls back to scoring_input', () => {
  const { gateOverride } = applyAiMode(fullAiView(), null);
  assert.equal(gateOverride, null);
});

// ── resolveGateOverride direct tests ──

test('resolveGateOverride returns null for null descriptor', () => {
  assert.equal(resolveGateOverride(null, 'buy'), null);
});

test('resolveGateOverride returns null for non-hard_gate descriptor', () => {
  assert.equal(resolveGateOverride({ mode: 'something-else' }, 'buy'), null);
});

// ── pickMode + sanitiseAiView (internal) ──

test('pickMode returns valid mode from strategy', () => {
  assert.equal(pickMode({ ai: { mode: 'hard_gate' } }), 'hard_gate');
  assert.equal(pickMode({ ai: { mode: 'context_only' } }), 'context_only');
  assert.equal(pickMode({ ai: { mode: 'scoring_input' } }), 'scoring_input');
});

test('pickMode falls back to scoring_input on bad input', () => {
  assert.equal(pickMode({}), 'scoring_input');
  assert.equal(pickMode(null), 'scoring_input');
  assert.equal(pickMode({ ai: { mode: 'unknown' } }), 'scoring_input');
  assert.equal(pickMode({ ai: { mode: 42 } }), 'scoring_input');
});

test('sanitiseAiView returns neutral defaults for null/invalid input', () => {
  const out = sanitiseAiView(null);
  assert.equal(out.confidence, NEUTRAL_AI_VIEW.confidence);
  assert.equal(out.action_hint, null);
  assert.equal(out.reason_hint, null);
});

test('sanitiseAiView coerces non-finite numbers to defaults', () => {
  const out = sanitiseAiView({
    confidence: NaN,
    risk_score: Infinity,
    ai_context_score: 'not a number',
    timing_score: 75,
  });
  assert.equal(out.confidence, NEUTRAL_AI_VIEW.confidence);
  assert.equal(out.risk_score, NEUTRAL_AI_VIEW.risk_score);
  assert.equal(out.ai_context_score, NEUTRAL_AI_VIEW.ai_context_score);
  assert.equal(out.timing_score, 75);
});

test('VALID_MODES contains the three documented modes', () => {
  assert.ok(VALID_MODES.has('scoring_input'));
  assert.ok(VALID_MODES.has('hard_gate'));
  assert.ok(VALID_MODES.has('context_only'));
});

// ── normaliseAction (internal) ──

test('normaliseAction — maps known synonyms to 3-value space', () => {
  assert.equal(normaliseAction('BUY'), 'buy');
  assert.equal(normaliseAction('enter_long'), 'buy');
  assert.equal(normaliseAction('long'), 'buy');
  assert.equal(normaliseAction('SELL'), 'sell');
  assert.equal(normaliseAction('reduce'), 'sell');
  assert.equal(normaliseAction('exit'), 'sell');
  assert.equal(normaliseAction('close'), 'sell');
  assert.equal(normaliseAction('HOLD'), 'hold');
  assert.equal(normaliseAction('flat'), 'hold');
  assert.equal(normaliseAction('wait'), 'hold');
});

test('normaliseAction — returns "unknown" for unknown / nullish', () => {
  assert.equal(normaliseAction(null), 'unknown');
  assert.equal(normaliseAction(undefined), 'unknown');
  assert.equal(normaliseAction(''), 'unknown');
  assert.equal(normaliseAction('garbage'), 'unknown');
});
