// AI integration mode handler for declarative strategy manifests.
//
// Each operator's strategy manifest declares an AI integration mode under
// `strategy.ai.mode`. This module adapts a raw AI view to what the
// decision engine should consume, plus emits a deferred-veto descriptor
// (`gateOverride`) that the engine consults AFTER it has produced a
// tentative action.
//
// Modes (RFC §AI integration modes, schema-v1.json $defs.ai.mode):
//
//   * scoring_input — default. AI confidence/risk/context numbers feed
//                     directly into the decision engine's scoring formula.
//                     Most permissive: AI is one signal among many.
//
//   * hard_gate     — AI's `action_hint` acts as a veto. If the engine
//                     wants to BUY but AI says SELL or HOLD, decision is
//                     forced to HOLD. Symmetric for SELL.
//
//   * context_only  — AI numbers are neutralised (confidence=0.5, ctx=50).
//                     Only the human-readable `reason_hint` is kept for
//                     log/journal display. Decision math ignores AI.
//
// Phase 2 integration (decisionEngine refactor):
//
//   import { applyAiMode, resolveGateOverride } from '../strategy/aiModes.js';
//
//   const { aiView, gateOverride } = applyAiMode(rawAiView, strategy);
//   // ... run scoring with adapted aiView ...
//   const tentative = decideFromScoring(aiView, ctx);  // 'buy'|'sell'|'hold'
//   const force = resolveGateOverride(gateOverride, tentative);
//   if (force) decision = { ...decision, action: 'hold', reason: force.reason };
//
// Design notes:
//   * `applyAiMode` is pure: no I/O, no logger, no global state. Side
//     effects (logging the override, journal writes) belong to the caller.
//   * `gateOverride` is a deferred descriptor — `applyAiMode` cannot know
//     the engine's eventual action, so `resolveGateOverride()` does the
//     final reduction once the engine has decided.
//   * Defensive defaults: a missing/unknown `strategy.ai.mode` falls back
//     to `scoring_input` so an incomplete manifest never silently blocks
//     all trades.

// Default AI view used when context_only neutralises numeric fields.
// confidence=0.5 + risk_score=0.5 yield neutral scoring weight; both
// score bands sit at the [0, 100] midpoint.
const NEUTRAL_AI_VIEW = Object.freeze({
  confidence: 0.5,
  risk_score: 0.5,
  ai_context_score: 50,
  timing_score: 50,
});

const VALID_MODES = new Set(['scoring_input', 'hard_gate', 'context_only']);

/**
 * Adapt a raw AI view for consumption by the decision engine, based on
 * the strategy's declared `ai.mode`.
 *
 * @param {object} aiView   Raw AI assessment (see inference.js for canonical
 *                          shape: { confidence, risk_score, ai_context_score,
 *                          timing_score, action_hint, reason_hint }).
 * @param {object} strategy Parsed strategy manifest (see schema-v1.json).
 * @returns {{ aiView: object, gateOverride: object|null }}
 *   aiView       — possibly-neutralised view to feed the scoring engine.
 *   gateOverride — null OR a deferred-veto descriptor consumed by
 *                  `resolveGateOverride()` once the engine produces an
 *                  action. Phase 2 callers should treat null as "no veto".
 */
export function applyAiMode(aiView, strategy) {
  const safeAiView = sanitiseAiView(aiView);
  const mode = pickMode(strategy);

  switch (mode) {
    case 'scoring_input':
      // Default — pass through unchanged. Decision engine consumes
      // ai.confidence / ai.risk_score / ai.ai_context_score / ai.timing_score
      // as part of its weighted scoring formula.
      return { aiView: safeAiView, gateOverride: null };

    case 'hard_gate': {
      // AI acts as a deferred veto. We don't yet know the engine's action,
      // so we publish a descriptor that resolveGateOverride() reduces
      // once the engine produces its tentative decision.
      const aiAction = normaliseAction(safeAiView.action_hint);
      return {
        aiView: safeAiView,
        gateOverride: {
          mode: 'hard_gate',
          ai_action: aiAction, // 'buy' | 'sell' | 'hold' | 'unknown'
        },
      };
    }

    case 'context_only': {
      // Neutralise all numbers, keep human-readable hints (action_hint /
      // reason_hint) so they can still appear in journal entries without
      // influencing decision math.
      const neutralised = {
        ...NEUTRAL_AI_VIEW,
        action_hint: safeAiView.action_hint ?? null,
        reason_hint: safeAiView.reason_hint ?? null,
      };
      return { aiView: neutralised, gateOverride: null };
    }

    default:
      // Defensive fallback. pickMode() coerces unknowns to 'scoring_input',
      // so this branch is unreachable today but kept for future modes.
      return { aiView: safeAiView, gateOverride: null };
  }
}

/**
 * Resolve a `hard_gate` override descriptor against the engine's tentative
 * action. Returns null if no override should fire, or
 * `{ force_action: 'hold', reason }` if it should.
 *
 * @param {object|null} gateOverride - descriptor returned by applyAiMode
 * @param {string} engineAction      - 'buy' | 'sell' | 'hold' (case-insensitive)
 * @returns {{ force_action: 'hold', reason: string }|null}
 */
export function resolveGateOverride(gateOverride, engineAction) {
  if (!gateOverride || gateOverride.mode !== 'hard_gate') return null;
  const eng = normaliseAction(engineAction);
  const ai = gateOverride.ai_action;

  // Engine wants BUY but AI says SELL or HOLD → veto.
  if (eng === 'buy' && (ai === 'sell' || ai === 'hold')) {
    return {
      force_action: 'hold',
      reason: `AI vetoed BUY decision (ai.action_hint='${ai}')`,
    };
  }
  // Engine wants SELL but AI says BUY or HOLD → veto.
  if (eng === 'sell' && (ai === 'buy' || ai === 'hold')) {
    return {
      force_action: 'hold',
      reason: `AI vetoed SELL decision (ai.action_hint='${ai}')`,
    };
  }
  // Otherwise (engine HOLD, both agree, or AI hint missing) no override.
  return null;
}

// ── Helpers ──

function pickMode(strategy) {
  const mode = strategy && strategy.ai && strategy.ai.mode;
  if (typeof mode === 'string' && VALID_MODES.has(mode)) return mode;
  // Fallback to default to preserve legacy behaviour for malformed manifests.
  return 'scoring_input';
}

function sanitiseAiView(aiView) {
  // Never mutate the caller's object; return a shallow copy with safe
  // defaults for the canonical numeric fields. Numeric overrides on
  // aiView are honoured here. Textual fields (action_hint, reason_hint)
  // are preserved as-is.
  if (!aiView || typeof aiView !== 'object') {
    return { ...NEUTRAL_AI_VIEW, action_hint: null, reason_hint: null };
  }
  return {
    confidence: numericOr(aiView.confidence, NEUTRAL_AI_VIEW.confidence),
    risk_score: numericOr(aiView.risk_score, NEUTRAL_AI_VIEW.risk_score),
    ai_context_score: numericOr(aiView.ai_context_score, NEUTRAL_AI_VIEW.ai_context_score),
    timing_score: numericOr(aiView.timing_score, NEUTRAL_AI_VIEW.timing_score),
    action_hint: typeof aiView.action_hint === 'string' ? aiView.action_hint : null,
    reason_hint: typeof aiView.reason_hint === 'string' ? aiView.reason_hint : null,
  };
}

function numericOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// Normalise free-form action strings into the 3-value space.
//   'BUY' / 'enter' / 'enter_long' / 'long'  → 'buy'
//   'SELL' / 'exit' / 'exit_long' / 'reduce' / 'short' / 'close' → 'sell'
//   'HOLD' / 'flat' / 'wait' / 'no_action'  → 'hold'
//   anything else → 'unknown'
function normaliseAction(raw) {
  if (raw === undefined || raw === null) return 'unknown';
  const s = String(raw).trim().toLowerCase();
  if (!s) return 'unknown';
  if (s === 'buy' || s === 'enter' || s === 'enter_long' || s === 'long') return 'buy';
  if (
    s === 'sell' ||
    s === 'reduce' ||
    s === 'exit' ||
    s === 'exit_long' ||
    s === 'short' ||
    s === 'close'
  ) return 'sell';
  if (s === 'hold' || s === 'flat' || s === 'wait' || s === 'no_action' || s === 'none') return 'hold';
  return 'unknown';
}

// Test/introspection exports.
export const _internal = Object.freeze({
  NEUTRAL_AI_VIEW,
  VALID_MODES,
  pickMode,
  sanitiseAiView,
  normaliseAction,
});
