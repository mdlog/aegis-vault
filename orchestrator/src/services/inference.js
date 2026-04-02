import config from '../config/index.js';
import logger from '../utils/logger.js';
import { buildSystemPrompt, buildUserPrompt, parseAIResponse } from './promptBuilder.js';
import { chatCompletion, isOGComputeAvailable, initOGCompute } from './ogCompute.js';
import { computeAllIndicators } from './indicators.js';
import { classifyRegime } from './regimeClassifier.js';
import { runDecisionEngine, toSimpleDecision } from './decisionEngine.js';

/**
 * InferenceService v1
 *
 * Pipeline:
 *   1. Compute technical indicators from price history
 *   2. Classify market regime
 *   3. Call 0G Compute AI for context assessment (confidence, risk, timing)
 *   4. Run Decision Engine v1 (indicators + regime + scores + veto → action)
 *   5. Return structured decision for executor
 *
 * The AI model is an INPUT to the decision engine, not the sole decider.
 * The engine applies rules, thresholds, hysteresis, and hard veto on top.
 */

/**
 * Request AI inference — v1 pipeline
 * @param {object} marketSummary - Market data from marketData service
 * @param {object} vaultState - Current vault state (extended with position tracking)
 * @returns {object} Decision for executor
 */
export async function requestInference(marketSummary, vaultState) {
  // ── Step 1: Build price history for indicators ──
  const btcPrice = marketSummary.prices?.BTC?.price || 69000;
  const ethPrice = marketSummary.prices?.ETH?.price || 2100;

  // Use price history if available, otherwise build minimal array from current data
  const priceHistory = vaultState._priceHistory || {
    prices: buildMinimalPriceArray(btcPrice, marketSummary.prices?.BTC?.change24h || 0),
    volumes: [],
  };

  // ── Step 2: Compute indicators ──
  const indicators = computeAllIndicators(priceHistory, btcPrice, marketSummary.prices?.BTC?.volume24h || 0);

  // ── Step 3: Classify regime ──
  const regime = classifyRegime(indicators);
  logger.info(`  Regime: ${regime} | RSI: ${indicators.rsi_14.toFixed(1)} | ATR: ${indicators.atr_14_pct.toFixed(2)}% | MACD: ${indicators.macd_histogram.toFixed(2)}`);

  // ── Step 4: Get AI assessment from 0G Compute ──
  let aiView = { confidence: 0.5, risk_score: 0.5, ai_context_score: 50, timing_score: 50 };

  try {
    if (!isOGComputeAvailable()) {
      await initOGCompute();
    }

    if (isOGComputeAvailable()) {
      const systemPrompt = buildSystemPrompt();
      const userPrompt = buildUserPrompt(marketSummary, vaultState, indicators, regime);

      logger.info('Requesting AI assessment from 0G Compute...');
      const result = await chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], { temperature: 0.3, max_tokens: 1024 });

      if (result?.content) {
        logger.debug(`  AI raw response (${result.content.length} chars): ${result.content.substring(0, 200)}`);
        const parsed = parseAIResponse(result.content);
        if (parsed) {
          aiView = {
            confidence: parsed.confidence,
            risk_score: parsed.risk_score,
            ai_context_score: parsed.ai_context_score ?? 60,
            timing_score: parsed.timing_score ?? 65,
            asset: parsed.asset,
            action_hint: parsed.action,
            reason_hint: parsed.reason,
            provider: result.provider,
            model: result.model,
          };
          logger.info(`  AI assessment: ${parsed.action} ${parsed.asset} conf=${(parsed.confidence * 100).toFixed(0)}% risk=${(parsed.risk_score * 100).toFixed(0)}% ctx=${aiView.ai_context_score} timing=${aiView.timing_score}`);
        } else {
          logger.warn(`  AI response received but failed to parse: "${result.content.substring(0, 100)}"`);
        }
      }
    }
  } catch (err) {
    logger.warn(`0G Compute failed: ${err.message}. Using default AI view.`);
  }

  // If AI didn't run, use local assessment
  if (!aiView.provider) {
    aiView = localAssessment(marketSummary, vaultState, indicators, regime);
    logger.info(`  Local assessment: conf=${(aiView.confidence * 100).toFixed(0)}% risk=${(aiView.risk_score * 100).toFixed(0)}% ctx=${aiView.ai_context_score}`);
  }

  // ── Step 5: Run Decision Engine v1 ──
  const v1Policy = buildV1Policy(vaultState);
  const v1VaultState = buildV1VaultState(vaultState);

  const v1Decision = runDecisionEngine({
    priceHistory,
    currentPrice: btcPrice,
    currentVolume: marketSummary.prices?.BTC?.volume24h || 0,
    vaultState: v1VaultState,
    policy: v1Policy,
    aiView,
    symbol: `${aiView.asset || 'BTC'}/USDC`,
  });

  // ── Step 6: Convert to simple format for executor ──
  const decision = toSimpleDecision(v1Decision);
  decision.source = aiView.provider ? '0g-compute + engine-v1' : 'local + engine-v1';

  return decision;
}

/**
 * Local assessment — deterministic AI view when 0G Compute is unavailable
 */
function localAssessment(marketSummary, vaultState, indicators, regime) {
  const btcChange = marketSummary.prices?.BTC?.change24h || 0;
  const ethChange = marketSummary.prices?.ETH?.change24h || 0;

  let confidence = 0.45;
  let riskScore = 0.35;
  let asset = 'USDC';
  let action = 'hold';
  let aiContextScore = 40;
  let timingScore = 40;

  // Strong BTC up
  if (btcChange > 2.5 && indicators.rsi_14 < 72 && indicators.macd_histogram > 0) {
    confidence = 0.72;
    riskScore = 0.22;
    asset = 'BTC';
    action = 'buy';
    aiContextScore = 70;
    timingScore = 68;
  }
  // Strong ETH up
  else if (ethChange > 3 && indicators.rsi_14 < 72) {
    confidence = 0.66;
    riskScore = 0.28;
    asset = 'ETH';
    action = 'buy';
    aiContextScore = 62;
    timingScore = 60;
  }
  // Strong BTC down
  else if (btcChange < -3) {
    confidence = 0.68;
    riskScore = 0.48;
    asset = 'BTC';
    action = 'sell';
    aiContextScore = 65;
    timingScore = 55;
  }
  // Strong ETH down
  else if (ethChange < -3.5) {
    confidence = 0.65;
    riskScore = 0.45;
    asset = 'ETH';
    action = 'sell';
    aiContextScore = 58;
    timingScore = 50;
  }
  // High volatility
  else if (indicators.atr_14_pct > 3.8) {
    confidence = 0.35;
    riskScore = 0.72;
    aiContextScore = 25;
    timingScore = 20;
  }

  return {
    confidence,
    risk_score: riskScore,
    ai_context_score: aiContextScore,
    timing_score: timingScore,
    asset,
    action_hint: action,
    reason_hint: action === 'hold'
      ? 'Market conditions neutral. No clear signal.'
      : `${asset} ${action === 'buy' ? 'momentum' : 'weakness'} detected.`,
  };
}

/**
 * Build minimal price array for indicator calculation when no history is available
 */
function buildMinimalPriceArray(currentPrice, change24hPct, points = 200) {
  const prices = [];
  const dailyChange = change24hPct / 100;
  const hourlyChange = dailyChange / 24;

  for (let i = points; i >= 0; i--) {
    const factor = 1 - (hourlyChange * i);
    prices.push(currentPrice * factor);
  }
  return prices;
}

/**
 * Convert vault state to v1 format
 */
function buildV1VaultState(vaultState) {
  return {
    vault_equity_usd: vaultState.nav || 0,
    base_asset: 'USDC',
    current_position_side: vaultState.current_position_side || 'flat',
    current_position_notional_usd: vaultState.current_position_notional_usd || 0,
    current_position_pnl_pct: vaultState.current_position_pnl_pct || 0,
    last_action: vaultState.last_action || 'HOLD_FLAT',
    last_execution_at: vaultState.lastExecutionTimestamp || 0,
    daily_pnl_pct: vaultState.daily_pnl_pct || 0,
    rolling_drawdown_pct: vaultState.rolling_drawdown_pct || 0,
    consecutive_losses: vaultState.consecutive_losses || 0,
    actions_last_60m: vaultState.actions_last_60m || 0,
    time_since_last_trade_sec: vaultState.lastExecutionTimestamp
      ? Math.floor(Date.now() / 1000) - vaultState.lastExecutionTimestamp
      : 9999,
    open_intents: 0,
  };
}

/**
 * Convert vault policy to v1 format
 */
function buildV1Policy(vaultState) {
  const p = vaultState.policy || {};
  return {
    allowed_assets: ['BTC', 'ETH'],
    max_position_bps: p.maxPositionBps || 5000,
    max_daily_loss_bps: p.maxDailyLossBps || 500,
    stop_loss_bps: p.stopLossBps || 220,
    take_profit_bps: 450,
    trail_stop_bps: 180,
    cooldown_seconds: p.cooldownSeconds || 60,
    max_actions_per_60m: 2,
    min_confidence_buy: 0.75,
    min_confidence_reduce_or_sell: 0.55,
    max_risk_score_buy: 0.28,
    max_slippage_bps: 30,
    max_spread_bps: 20,
    pause: p.paused || false,
    mandate: (p.maxPositionBps || 5000) <= 1000 ? 'conservative' : (p.maxPositionBps || 5000) <= 1500 ? 'balanced' : 'aggressive',
  };
}

// Keep legacy export for backward compatibility
export { localAssessment as localDecisionEngine };
