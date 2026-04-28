/**
 * Decision Engine v1 — Full decision matrix implementation.
 *
 * Combines: indicators → regime → scores → veto → action → sizing → intent JSON.
 *
 * Actions: BUY, SELL, REDUCE, HOLD_POSITION, HOLD_FLAT, NO_TRADE
 */

import { computeAllIndicators } from './indicators.js';
import { classifyRegime, regimeSuitability, regimeBias, REGIMES } from './regimeClassifier.js';
import { computeAllScores, computeTradeQualityScore } from './signalScoring.js';
import { evaluateHardVeto, evaluateSoftFilters } from './riskVeto.js';
import { evaluateExpression, EvaluationError } from '../strategy/dsl.js';
import { applyAiMode, resolveGateOverride } from '../strategy/aiModes.js';
import logger from '../utils/logger.js';

// Helper to safely evaluate a strategy DSL expression. Returns `defaultValue`
// when the expression is missing or evaluation throws (logs a warning).
function safeEval(expression, ctx, defaultValue, label = '') {
  if (!expression) return defaultValue;
  try {
    return evaluateExpression(expression, ctx);
  } catch (err) {
    if (err instanceof EvaluationError) {
      logger.warn(`Strategy DSL ${label} eval failed: ${err.message}. Using default ${defaultValue}.`);
    } else {
      logger.warn(`Strategy DSL ${label} unexpected error: ${err.message}`);
    }
    return defaultValue;
  }
}

// Build the DSL evaluation context from runtime state. Indicators live both
// flat (legacy) and nested under `indicators.X` (DSL convention).
function buildDslContext(indicators, regime, aiView, vaultState, position) {
  return {
    ...indicators,                  // flat: rsi_14, macd_histogram, etc.
    indicators,                     // nested: ctx.indicators.rsi_14
    regime,
    ai: {
      confidence: aiView?.confidence ?? 0.5,
      risk_score: aiView?.risk_score ?? 0.5,
      ai_context_score: aiView?.ai_context_score ?? 50,
      timing_score: aiView?.timing_score ?? 50,
      action_hint: aiView?.action_hint || null,
    },
    position: {
      pnl_pct: position?.pnl_pct ?? 0,
      holding_seconds: position?.holding_seconds ?? 0,
      notional_usd: position?.notional_usd ?? 0,
    },
    vault: {
      maxPositionBps: vaultState?.policy?.max_position_bps ?? vaultState?.maxPositionBps ?? 1500,
      consecutive_losses: vaultState?.consecutive_losses ?? 0,
      balance: vaultState?.balance ?? 0,
      nav: vaultState?.nav ?? 0,
    },
  };
}

// ── Hysteresis Thresholds ──
const THRESHOLDS = {
  ENTER_BUY: 72,
  STAY_POSITION: 58,
  REDUCE: 52,
  EXIT: 48,
};

// ── Position Sizing ──
function computePositionSize(confidence, atrPct, rollingDrawdownPct, mandate, maxPositionBps, softPenalty = 0) {
  const baseSizes = { conservative: 700, balanced: 1000, aggressive: 1300 };
  const baseBps = baseSizes[mandate] || 1000;

  // Confidence multiplier
  let confMul = 0.8;
  if (confidence > 0.87) confMul = 1.15;
  else if (confidence > 0.80) confMul = 1.0;

  // Volatility multiplier
  let volMul = 1.0;
  if (atrPct > 3.2) volMul = 0.5;
  else if (atrPct > 2.8) volMul = 0.75;
  else if (atrPct > 2.0) volMul = 0.9;

  // Drawdown multiplier
  let ddMul = 1.0;
  if (rollingDrawdownPct > 6) ddMul = 0.0;
  else if (rollingDrawdownPct > 4) ddMul = 0.6;
  else if (rollingDrawdownPct > 2) ddMul = 0.8;

  // Soft filter penalty
  const softMul = Math.max(0.5, 1.0 - softPenalty);

  let sizeBps = Math.round(baseBps * confMul * volMul * ddMul * softMul);
  sizeBps = Math.max(300, Math.min(sizeBps, maxPositionBps));

  return sizeBps;
}

// ── Reduce fraction based on score ──
function computeReduceFraction(finalEdgeScore) {
  if (finalEdgeScore >= 54) return 2500; // reduce 25%
  if (finalEdgeScore >= 50) return 5000; // reduce 50%
  return 7500; // reduce 75%
}

/**
 * Run the full decision engine.
 *
 * @param {object} params
 * @param {object} params.priceHistory - { prices: number[], volumes: number[], highs?, lows? }
 * @param {number} params.currentPrice - Current asset price
 * @param {number} params.currentVolume - Current volume
 * @param {object} params.vaultState - Extended vault state (see Decision Matrix v1 §4.2)
 * @param {object} params.policy - Extended policy (see Decision Matrix v1 §4.3)
 * @param {object} params.aiView - Optional AI model output { confidence, risk_score, ai_context_score, timing_score }
 * @param {string} params.symbol - Trading pair, e.g. "BTC/USDC"
 * @returns {object} Full v1 JSON decision
 */
export function runDecisionEngine(params) {
  const {
    priceHistory, currentPrice, currentVolume = 0,
    vaultState, policy, aiView: rawAiView = {}, symbol = 'BTC/USDC',
    strategy = null,  // optional strategy manifest (Phase 2 addition)
  } = params;

  const now = Math.floor(Date.now() / 1000);

  // ── Step 0 (NEW): Apply AI integration mode ──
  // When a strategy is provided, route AI view through the mode handler.
  // Returns { aiView, gateOverride }: gateOverride is checked AFTER engine
  // decides an action (hard_gate mode can veto a BUY/SELL post-hoc).
  let aiView = rawAiView;
  let gateOverride = null;
  if (strategy) {
    const aiResult = applyAiMode(rawAiView, strategy);
    aiView = aiResult.aiView;
    gateOverride = aiResult.gateOverride;
  }

  // ── Step 1: Compute indicators ──
  // V4: pass strategy.indicators so per-operator RSI/MACD/ATR/EMA/Bollinger
  // periods take effect. Backwards compatible — null config = legacy defaults.
  const indicators = computeAllIndicators(priceHistory, currentPrice, currentVolume, strategy?.indicators || null);

  // ── Step 2: Classify regime ──
  const regime = classifyRegime(indicators);
  const bias = regimeBias(regime);
  const regimeSuit = regimeSuitability(regime);

  // ── Step 3: Compute scores ──
  // When strategy is provided, use its custom scoring weights; else default.
  const aiContextScore = aiView.ai_context_score ?? 50;
  const strategyWeights = strategy?.scoring?.weights || null;
  const scores = computeAllScores(indicators, vaultState, policy, aiContextScore, strategyWeights);

  const timingScore = aiView.timing_score ?? 70;
  const tradeQualityScore = computeTradeQualityScore({
    finalEdgeScore: scores.final_edge_score,
    executionScore: scores.liquidity_score,
    timingScore,
    regimeSuitabilityScore: regimeSuit,
    confidenceScaled: (aiView.confidence || 0.5) * 100,
  });

  // ── Step 4: Soft filters ──
  const softFilters = evaluateSoftFilters(indicators, regime);
  const adjustedQuality = tradeQualityScore - softFilters.qualityPenalty;

  // ── Step 5: Hard veto (V4: include strategy.veto thresholds) ──
  const veto = evaluateHardVeto(indicators, vaultState, policy, regime, aiView, strategy);

  // ── Step 6: Determine action ──
  const confidence = aiView.confidence ?? 0.5;
  const riskScore = aiView.risk_score ?? 0.5;
  const positionSide = vaultState.current_position_side || 'flat';
  const positionPnlPct = vaultState.current_position_pnl_pct || 0;
  const edgeScore = scores.final_edge_score;

  let action, executionMode, entryTrigger, sizeBps, reduceFractionBps;
  let assetIn, assetOut;

  const baseAsset = 'USDC';
  const tradeAsset = symbol.split('/')[0] || 'BTC';

  if (veto.veto) {
    // ── VETO PATH ──
    if (positionSide === 'flat') {
      action = regime === REGIMES.LOW_LIQUIDITY || regime === REGIMES.PANIC_VOLATILE
        ? 'NO_TRADE' : 'HOLD_FLAT';
      executionMode = 'DO_NOT_EXECUTE';
      entryTrigger = 'veto_active';
      sizeBps = 0;
    } else {
      // Has position — check if defensive sell needed
      if (
        positionPnlPct <= -((policy.stop_loss_bps || 220) / 100) ||
        (vaultState.rolling_drawdown_pct || 0) >= 6.0 ||
        indicators.atr_14_pct > 4.2 ||
        confidence < 0.40 ||
        riskScore > 0.55 ||
        regime === REGIMES.TREND_DOWN_STRONG ||
        regime === REGIMES.PANIC_VOLATILE
      ) {
        action = 'SELL';
        executionMode = 'MARKETABLE_SWAP';
        entryTrigger = 'defensive_exit';
        sizeBps = 10000; // full exit
        assetIn = tradeAsset;
        assetOut = baseAsset;
      } else if (edgeScore < THRESHOLDS.REDUCE) {
        action = 'REDUCE';
        executionMode = 'MARKETABLE_SWAP';
        entryTrigger = 'score_deterioration';
        reduceFractionBps = computeReduceFraction(edgeScore);
        sizeBps = reduceFractionBps;
        assetIn = tradeAsset;
        assetOut = baseAsset;
      } else {
        action = 'HOLD_POSITION';
        executionMode = 'DO_NOT_EXECUTE';
        entryTrigger = 'hold_existing';
        sizeBps = 0;
      }
    }
  } else if (positionSide === 'flat') {
    // ── FLAT PATH — check BUY conditions ──
    // Tier separation rule (RFC §"Layer separation"):
    //   Vault policy is HARD CEILING/FLOOR set by depositor at create.
    //   Strategy can only make gates MORE restrictive — never relax them.
    //
    // For "min" thresholds (minEdge, minQuality, minConfidence): strategy
    //   value applies only if it raises the bar. Lowering would let an
    //   operator silently weaken a depositor-chosen safety floor.
    //
    // For "max" thresholds (maxRisk, allowed regimes): strategy can tighten
    //   by lowering the cap or shrinking the regime list, never widen.
    //
    // Hardcoded engine defaults (THRESHOLDS.ENTER_BUY etc.) act only as
    // fallback when both strategy AND policy leave the value unset.
    const sgGates = strategy?.gates || {};
    const policyMinQuality = policy.min_quality_buy ?? 78;
    const policyMinEdge    = policy.min_edge_buy ?? THRESHOLDS.ENTER_BUY;
    const policyMinConf    = policy.min_confidence_buy ?? 0.75;
    const policyMaxRisk    = policy.max_risk_score_buy ?? 0.28;
    // Strategy's "min" threshold takes effect only if it's stricter (higher).
    const minQuality = sgGates.minQualityBuy != null
      ? Math.max(sgGates.minQualityBuy, policyMinQuality)
      : policyMinQuality;
    const minEdge = sgGates.minEdgeBuy != null
      ? Math.max(sgGates.minEdgeBuy, policyMinEdge)
      : policyMinEdge;
    const minConf = sgGates.minConfidenceBuy != null
      ? Math.max(sgGates.minConfidenceBuy, policyMinConf)
      : policyMinConf;
    // Strategy's "max" threshold takes effect only if it's stricter (lower).
    const maxRisk = sgGates.maxRiskBuy != null
      ? Math.min(sgGates.maxRiskBuy, policyMaxRisk)
      : policyMaxRisk;
    // Allowed regimes: intersect strategy choice with vault policy whitelist.
    // Empty intersection → no BUY allowed (strict + audited semantics).
    const policyRegimes = policy.allowed_buy_regimes ||
      [REGIMES.TREND_UP_STRONG, REGIMES.TREND_UP_WEAK, REGIMES.RANGE_STABLE,
       REGIMES.RANGE_NOISY, REGIMES.TREND_DOWN_WEAK, REGIMES.TREND_DOWN_STRONG,
       REGIMES.PANIC_VOLATILE, REGIMES.LOW_LIQUIDITY];
    const allowedRegimes = sgGates.allowedBuyRegimes
      ? sgGates.allowedBuyRegimes.filter((r) => policyRegimes.includes(r))
      : policyRegimes;

    // Strategy entry_long DSL expression (ext 1) — when present, must also
    // evaluate true alongside the gate checks. Empty/missing = pass-through.
    const dslCtx = buildDslContext(indicators, regime, aiView, vaultState, {
      pnl_pct: positionPnlPct,
      holding_seconds: vaultState.position_holding_seconds || 0,
      notional_usd: vaultState.position_notional_usd || 0,
    });
    const dslEntryAllowed = strategy?.rules?.entry_long?.expression
      ? safeEval(strategy.rules.entry_long.expression, dslCtx, false, 'entry_long')
      : true;

    // Debug instrumentation: evaluate each gate separately so we can log which
    // specific condition blocked a BUY when conditions look like they should
    // have passed. Remove once execution flow is stable.
    const gates = {
      regime_ok:        allowedRegimes.includes(regime),
      edge_ok:          edgeScore >= minEdge,
      confidence_ok:    confidence >= minConf,
      risk_ok:          riskScore <= maxRisk,
      quality_ok:       adjustedQuality >= minQuality,
      losses_ok:        (vaultState.consecutive_losses || 0) <= 1,
      slippage_ok:      (indicators.slippage_estimate_bps || 0) <= (policy.max_slippage_bps || 30),
      spread_ok:        (indicators.spread_bps || 0) <= (policy.max_spread_bps || 20),
      strategy_dsl_ok:  dslEntryAllowed,
    };
    const buyAllowed = Object.values(gates).every(Boolean);
    if (!buyAllowed) {
      const failed = Object.entries(gates).filter(([, ok]) => !ok).map(([k]) => k);
      logger.info(`  BUY gates · passed: ${Object.entries(gates).filter(([, ok]) => ok).map(([k]) => k).join(', ') || '(none)'} · FAILED: ${failed.join(', ')}`);
      logger.info(`  BUY inputs · edge=${edgeScore} minEdge=${minEdge} · conf=${confidence.toFixed(2)} minConf=${(policy.min_confidence_buy || 0.75).toFixed(2)} · risk=${riskScore.toFixed(2)} maxRisk=${(policy.max_risk_score_buy || 0.28).toFixed(2)} · quality=${adjustedQuality} minQ=${minQuality} · slip=${indicators.slippage_estimate_bps || 0}/${policy.max_slippage_bps || 30} spread=${indicators.spread_bps || 0}/${policy.max_spread_bps || 20} losses=${vaultState.consecutive_losses || 0}`);
    }

    if (buyAllowed) {
      action = 'BUY';
      // Tier thresholds stay at (minQuality + 0), (minQuality - 8), floor.
      // For a strict vault (minQuality=78) this matches the previous
      // 78/70 split; for a permissive one (minQuality=40) it becomes 40/32.
      executionMode = adjustedQuality >= minQuality
        ? 'MARKETABLE_SWAP'
        : (adjustedQuality >= minQuality - 8 ? 'WAIT_RETEST' : 'DO_NOT_EXECUTE');
      entryTrigger = indicators.price_vs_vwap_pct > 0 ? 'above_vwap_momentum' : 'dip_to_ema20_bounce';
      const mandate = policy.mandate || (policy.max_position_bps <= 1000 ? 'conservative' : policy.max_position_bps <= 1500 ? 'balanced' : 'aggressive');
      // Sizing: when strategy provides a size_bps DSL expression, evaluate it.
      // It returns a bps number — clamped against vault.maxPositionBps + sanity
      // floor/ceiling. Otherwise fall back to legacy heuristic computePositionSize.
      const dslSizeExpr = strategy?.rules?.size_bps?.expression;
      if (dslSizeExpr) {
        const dslSize = safeEval(dslSizeExpr, dslCtx, null, 'size_bps');
        if (typeof dslSize === 'number' && Number.isFinite(dslSize) && dslSize > 0) {
          // Strategy can only be MORE conservative than vault policy ceiling
          sizeBps = Math.min(Math.max(Math.round(dslSize), 100), policy.max_position_bps || 1500);
        } else {
          // DSL returned junk → fall back to default sizing
          sizeBps = computePositionSize(
            confidence, indicators.atr_14_pct,
            vaultState.rolling_drawdown_pct || 0,
            mandate, policy.max_position_bps || 1500,
            softFilters.sizeMultiplierPenalty,
          );
        }
      } else {
        sizeBps = computePositionSize(
          confidence, indicators.atr_14_pct,
          vaultState.rolling_drawdown_pct || 0,
          mandate, policy.max_position_bps || 1500,
          softFilters.sizeMultiplierPenalty,
        );
      }
      assetIn = baseAsset;
      assetOut = tradeAsset;
    } else {
      action = (regime === REGIMES.LOW_LIQUIDITY || regime === REGIMES.PANIC_VOLATILE)
        ? 'NO_TRADE' : 'HOLD_FLAT';
      executionMode = 'DO_NOT_EXECUTE';
      entryTrigger = 'none';
      sizeBps = 0;
    }
  } else {
    // ── OPEN POSITION PATH ──
    // V4 strategy: evaluate strategy.rules.exit_long FIRST. If true → SELL
    // (strategy authority overrides legacy heuristic). Strategy is an
    // operator commitment; if their rule says exit, they want exit.
    const exitDslCtx = buildDslContext(indicators, regime, aiView, vaultState, {
      pnl_pct: positionPnlPct,
      holding_seconds: vaultState.position_holding_seconds || 0,
      notional_usd: vaultState.position_notional_usd || 0,
    });
    const dslExitTriggered = strategy?.rules?.exit_long?.expression
      ? safeEval(strategy.rules.exit_long.expression, exitDslCtx, false, 'exit_long')
      : false;

    if (dslExitTriggered) {
      action = 'SELL';
      executionMode = 'MARKETABLE_SWAP';
      entryTrigger = 'strategy_dsl_exit';
      sizeBps = 10000;
      assetIn = tradeAsset;
      assetOut = baseAsset;
    }
    // Check defensive sell (preserved as safety net even when strategy is bound)
    else if (
      positionPnlPct <= -((policy.stop_loss_bps || 220) / 100) ||
      (vaultState.rolling_drawdown_pct || 0) >= 6.0 ||
      indicators.atr_14_pct > 4.2 ||
      regime === REGIMES.TREND_DOWN_STRONG ||
      regime === REGIMES.PANIC_VOLATILE
    ) {
      action = 'SELL';
      executionMode = 'MARKETABLE_SWAP';
      entryTrigger = 'defensive_exit';
      sizeBps = 10000;
      assetIn = tradeAsset;
      assetOut = baseAsset;
    }
    // Tactical sell
    else if (edgeScore < THRESHOLDS.EXIT && confidence < 0.55) {
      action = 'SELL';
      executionMode = 'MARKETABLE_SWAP';
      entryTrigger = 'tactical_exit';
      sizeBps = 10000;
      assetIn = tradeAsset;
      assetOut = baseAsset;
    }
    // Profit realization
    else if (positionPnlPct >= 4.5 && edgeScore < THRESHOLDS.STAY_POSITION) {
      action = 'SELL';
      executionMode = 'MARKETABLE_SWAP';
      entryTrigger = 'profit_realization';
      sizeBps = 10000;
      assetIn = tradeAsset;
      assetOut = baseAsset;
    }
    // Reduce
    else if (edgeScore >= THRESHOLDS.EXIT && edgeScore < THRESHOLDS.STAY_POSITION) {
      action = 'REDUCE';
      executionMode = 'MARKETABLE_SWAP';
      entryTrigger = 'score_deterioration';
      reduceFractionBps = computeReduceFraction(edgeScore);
      sizeBps = reduceFractionBps;
      assetIn = tradeAsset;
      assetOut = baseAsset;
    }
    // Partial profit take
    else if (positionPnlPct >= 2.5 && edgeScore < THRESHOLDS.STAY_POSITION) {
      action = 'REDUCE';
      executionMode = 'MARKETABLE_SWAP';
      entryTrigger = 'partial_profit_take';
      reduceFractionBps = 2500;
      sizeBps = 2500;
      assetIn = tradeAsset;
      assetOut = baseAsset;
    }
    // Hold position
    else {
      action = 'HOLD_POSITION';
      executionMode = 'DO_NOT_EXECUTE';
      entryTrigger = 'hold_existing';
      sizeBps = 0;
    }
  }

  // ── Apply hard_gate AI veto (post-engine, ext 2) ──
  // When strategy.ai.mode === 'hard_gate' and the AI's action_hint contradicts
  // the engine's tentative action, force HOLD. This runs AFTER the engine
  // decides because hard_gate semantics depend on what the engine chose.
  let aiOverride = null;
  if (gateOverride) {
    aiOverride = resolveGateOverride(gateOverride, action);
    if (aiOverride?.force_action) {
      logger.warn(`AI hard_gate override: ${aiOverride.reason}. ${action} → ${aiOverride.force_action.toUpperCase()}`);
      action = aiOverride.force_action.toUpperCase() === 'HOLD'
        ? (positionSide === 'flat' ? 'HOLD_FLAT' : 'HOLD_POSITION')
        : aiOverride.force_action.toUpperCase();
      executionMode = 'DO_NOT_EXECUTE';
      sizeBps = 0;
      reduceFractionBps = undefined;
      assetIn = undefined;
      assetOut = undefined;
      entryTrigger = `ai_hard_gate_veto:${aiOverride.reason || 'AI disagreement'}`;
    }
  }

  // ── Build exit plan ──
  const exitPlan = {
    stop_loss_bps: policy.stop_loss_bps || 220,
    take_profit_bps: policy.take_profit_bps || 450,
    trail_stop_bps: policy.trail_stop_bps || 180,
    reduce_at_score_below: THRESHOLDS.STAY_POSITION,
    full_exit_at_score_below: THRESHOLDS.EXIT,
  };

  // ── Map action to simple category for UI / smart contract ──
  let simpleAction;
  if (action === 'BUY') simpleAction = 'buy';
  else if (action === 'SELL' || action === 'REDUCE') simpleAction = 'sell';
  else simpleAction = 'hold';

  // ── Build reason summary ──
  let reasonSummary;
  if (action === 'BUY') {
    reasonSummary = `${regime} regime with edge score ${edgeScore}, confidence ${(confidence * 100).toFixed(0)}%, risk ${(riskScore * 100).toFixed(0)}%. ${entryTrigger.replace(/_/g, ' ')}.`;
  } else if (action === 'SELL') {
    reasonSummary = `${entryTrigger.replace(/_/g, ' ')} triggered. Regime: ${regime}, edge score ${edgeScore}, confidence ${(confidence * 100).toFixed(0)}%.`;
  } else if (action === 'REDUCE') {
    reasonSummary = `Edge score ${edgeScore} below hold threshold ${THRESHOLDS.STAY_POSITION}. Reducing ${(reduceFractionBps / 100).toFixed(0)}% of position.`;
  } else if (action === 'HOLD_POSITION') {
    reasonSummary = `Position held. Edge score ${edgeScore} >= ${THRESHOLDS.STAY_POSITION}, conditions acceptable.`;
  } else if (action === 'HOLD_FLAT') {
    reasonSummary = `No entry. Edge score ${edgeScore} < ${THRESHOLDS.ENTER_BUY} or conditions not met.${veto.veto ? ' Veto: ' + veto.reasons.join(', ') : ''}`;
  } else {
    reasonSummary = `No trade. ${veto.reasons.join(', ') || regime + ' regime, capital preservation mode.'}`;
  }

  // ── Build full v1 output ──
  const output = {
    version: '1.0',
    timestamp: now,
    symbol,
    regime,
    action,
    simple_action: simpleAction,
    bias,
    confidence,
    risk_score: riskScore,
    ...scores,
    timing_score: timingScore,
    trade_quality_score: adjustedQuality,
    size_bps: sizeBps || 0,
    reduce_fraction_bps: reduceFractionBps || 0,
    execution_mode: executionMode,
    entry_trigger: entryTrigger,
    exit_plan: exitPlan,
    hard_veto: veto.veto,
    hard_veto_reasons: veto.reasons,
    soft_flags: softFilters.flags,
    reason_summary: reasonSummary,
    ttl_sec: 180,
    recommended_asset_in: assetIn || baseAsset,
    recommended_asset_out: assetOut || tradeAsset,
    source: 'decision-engine-v1',
    // Strategy provenance — null when no strategy provided (V3 vault).
    strategy_id: strategy?.strategy?.id || null,
    strategy_type: strategy?.strategy?.type || null,
    ai_mode: strategy?.ai?.mode || null,
    ai_override: aiOverride,  // populated only when hard_gate veto fired
  };

  logger.info(`Decision Engine v1: ${action} ${symbol} | regime=${regime} edge=${edgeScore} conf=${(confidence * 100).toFixed(0)}% risk=${(riskScore * 100).toFixed(0)}% quality=${adjustedQuality} veto=${veto.veto}${strategy ? ` | strategy=${strategy.strategy.id}` : ''}${aiOverride ? ` | ai_override=${aiOverride.reason}` : ''}`);

  return output;
}

/**
 * Convert v1 decision to the simple format used by executor.
 * Maps BUY/SELL/REDUCE → buy/sell, everything else → hold.
 */
export function toSimpleDecision(v1Decision) {
  const sellFractionBps = v1Decision.simple_action === 'sell'
    ? (v1Decision.reduce_fraction_bps || v1Decision.size_bps || 10000)
    : 0;

  return {
    action: v1Decision.simple_action,
    asset: v1Decision.recommended_asset_out === 'USDC' ? v1Decision.recommended_asset_in : v1Decision.recommended_asset_out,
    size_bps: v1Decision.size_bps,
    sell_fraction_bps: sellFractionBps,
    confidence: v1Decision.confidence,
    risk_score: v1Decision.risk_score,
    reason: v1Decision.reason_summary,
    source: v1Decision.source,
    // Extended v1 fields
    regime: v1Decision.regime,
    v1_action: v1Decision.action,
    final_edge_score: v1Decision.final_edge_score,
    trade_quality_score: v1Decision.trade_quality_score,
    hard_veto: v1Decision.hard_veto,
    hard_veto_reasons: v1Decision.hard_veto_reasons,
    entry_trigger: v1Decision.entry_trigger,
  };
}
