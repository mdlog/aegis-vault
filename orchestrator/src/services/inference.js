import logger from '../utils/logger.js';
import config from '../config/index.js';
import { buildSystemPrompt, buildUserPrompt, parseAIResponse } from './promptBuilder.js';
import { chatCompletion, isOGComputeAvailable, initOGCompute } from './ogCompute.js';
import { computeAllIndicators } from './indicators.js';
import { classifyRegime } from './regimeClassifier.js';
import { runDecisionEngine, toSimpleDecision } from './decisionEngine.js';
import { normalizeTradeSymbol } from './assets.js';
import { fetchPriceHistory } from './marketData.js';
import { fetchPriceHistoryFromPyth } from './pythPrice.js';

// In-memory cache for CoinGecko historical prices. Keyed by symbol.
// TTL = cycle interval so each cycle reuses the fetch from context-asset
// resolution for the decision-asset resolution without a second HTTP round.
const PRICE_HISTORY_CACHE = new Map();
const PRICE_HISTORY_TTL_MS = 5 * 60 * 1000; // 5 min

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
  const contextAsset = selectContextAsset(vaultState, marketSummary);
  const contextMarket = getAssetMarketView(marketSummary, contextAsset);

  // Use price history if available, otherwise fetch real OHLCV (CoinGecko)
  // with in-memory cache. Falls back to synthetic only when network fails.
  const promptPriceHistory = await buildPriceHistory(vaultState, contextMarket.symbol, contextMarket.price, contextMarket.change24h);

  // ── Step 2: Compute indicators ──
  const indicators = computeAllIndicators(promptPriceHistory, contextMarket.price, contextMarket.volume24h);

  // ── Step 3: Classify regime ──
  const regime = classifyRegime(indicators);
  logger.info(`  Context asset: ${contextMarket.symbol} | Regime: ${regime} | RSI: ${indicators.rsi_14.toFixed(1)} | ATR: ${indicators.atr_14_pct.toFixed(2)}% | MACD: ${indicators.macd_histogram.toFixed(2)}`);

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
      ], { temperature: 0.3, max_tokens: 4096 });

      if (result?.content) {
        logger.debug(`  AI raw response (${result.content.length} chars): ${result.content.substring(0, 200)}`);
        const parsed = parseAIResponse(result.content);
        if (parsed) {
          aiView = {
            confidence: parsed.confidence,
            risk_score: parsed.risk_score,
            ai_context_score: parsed.ai_context_score ?? 60,
            timing_score: parsed.timing_score ?? 65,
            asset: normalizeTradeSymbol(parsed.asset),
            action_hint: parsed.action,
            reason_hint: parsed.reason,
            provider: result.provider,
            model: result.model,
            // Track 2: keep the full compute response so the executor can build the
            // TEE attestation report hash from (provider, chatId, content, model)
            _computeResponse: result,
          };
          logger.info(`  AI assessment: ${parsed.action} ${parsed.asset} conf=${(parsed.confidence * 100).toFixed(0)}% risk=${(parsed.risk_score * 100).toFixed(0)}% ctx=${aiView.ai_context_score} timing=${aiView.timing_score}`);
        } else {
          logger.warn(`  AI response received but failed to parse: "${result.content.substring(0, 100)}"`);
        }
      }
    }
  } catch (err) {
    if (config.strictMode) {
      logger.error(`0G Compute failed in STRICT_MODE: ${err.message}. Aborting inference.`);
      throw new Error(`og_compute_unavailable: ${err.message}`);
    }
    logger.warn(`0G Compute failed: ${err.message}. Using default AI view.`);
  }

  // If AI didn't run, use local assessment (forbidden in strict mode)
  if (!aiView.provider) {
    if (config.strictMode) {
      logger.error('AI inference unavailable in STRICT_MODE — refusing to fall back to local heuristic.');
      throw new Error('ai_inference_unavailable');
    }
    aiView = localAssessment(marketSummary, vaultState, indicators, regime);
    logger.info(`  Local assessment: conf=${(aiView.confidence * 100).toFixed(0)}% risk=${(aiView.risk_score * 100).toFixed(0)}% ctx=${aiView.ai_context_score}`);
  }

  const decisionAsset = selectDecisionAsset(vaultState, aiView, contextMarket.symbol);
  const decisionMarket = getAssetMarketView(marketSummary, decisionAsset);
  const priceHistory = await buildPriceHistory(vaultState, decisionMarket.symbol, decisionMarket.price, decisionMarket.change24h);

  // ── Step 5: Run Decision Engine v1 ──
  const v1Policy = buildV1Policy(vaultState);
  const v1VaultState = buildV1VaultState(vaultState);

  const v1Decision = runDecisionEngine({
    priceHistory,
    currentPrice: decisionMarket.price,
    currentVolume: decisionMarket.volume24h,
    vaultState: v1VaultState,
    policy: v1Policy,
    aiView: {
      ...aiView,
      asset: decisionAsset,
    },
    symbol: `${decisionAsset}/USDC`,
    // Strategy manifest (V4 ext 1+2 wiring) — passed through from cycle when
    // operator publishes a manifest. Null means "no manifest, use defaults"
    // (current V3 vault behavior).
    strategy: vaultState._strategy || null,
  });

  // ── Step 6: Convert to simple format for executor ──
  const decision = toSimpleDecision(v1Decision);
  decision.source = aiView.provider ? '0g-compute + engine-v1' : 'local + engine-v1';
  decision.market_symbol = decisionAsset;
  decision.context_symbol = contextMarket.symbol;
  decision.context_price = decisionMarket.price;
  // Track 2: forward the raw compute response so the executor can derive the
  // TEE attestation report hash. Null when running in local-fallback mode.
  decision._computeResponse = aiView._computeResponse || null;

  return decision;
}

/**
 * Build a usable price series for indicator computation.
 *
 * Preference order:
 *   1. vaultState._priceHistory[symbol] — provided by upstream (if pre-fetched)
 *   2. PRICE_HISTORY_CACHE — 5-min in-memory cache (reused within a cycle)
 *   3. CoinGecko 7-day hourly OHLCV — real market data
 *   4. buildMinimalPriceArray — linear synthetic (LAST RESORT — produces
 *      degenerate indicators; AI will see RSI=0/100 and distrust the signal)
 *
 * Returns { prices: number[], volumes: number[] }. `prices` has ≥30 points
 * whenever a real source succeeds, so RSI-14 / MACD / EMA-50 all have room
 * to compute meaningfully.
 */
async function buildPriceHistory(vaultState, assetSymbol, currentPrice, change24h) {
  const stored = vaultState._priceHistory?.[assetSymbol] || vaultState._priceHistory;
  if (stored?.prices?.length >= 30) {
    return stored;
  }

  // Try cached fetch (fresh within 5 min). Covers both Pyth + CoinGecko results.
  const cached = PRICE_HISTORY_CACHE.get(assetSymbol);
  const now = Date.now();
  if (cached && (now - cached.fetchedAt) < PRICE_HISTORY_TTL_MS) {
    return { prices: cached.prices, volumes: cached.volumes || [] };
  }

  // ── Primary source: Pyth Benchmarks (TradingView shim). Free, no rate
  //    limit, uses same oracle we already trust for live prices. ──
  try {
    const pythHistory = await fetchPriceHistoryFromPyth(assetSymbol, 7);
    if (pythHistory?.length >= 30) {
      const prices = pythHistory.map((h) => h.price);
      PRICE_HISTORY_CACHE.set(assetSymbol, { prices, volumes: [], fetchedAt: now });
      logger.debug(`Price history for ${assetSymbol}: ${prices.length} candles from Pyth Benchmarks`);
      return { prices, volumes: [] };
    }
    if (pythHistory) {
      logger.debug(`Pyth Benchmarks returned ${pythHistory.length} points for ${assetSymbol} (need ≥30); trying CoinGecko`);
    }
  } catch (err) {
    logger.debug(`Pyth Benchmarks fetch threw for ${assetSymbol}: ${err.message?.substring(0, 120)}`);
  }

  // ── Secondary fallback: CoinGecko. Kept around because Pyth may not carry
  //    every asset; also gives a second source if Pyth Benchmarks is down. ──
  const cgId = config.assets?.[assetSymbol]?.coingeckoId;
  if (cgId) {
    try {
      const history = await fetchPriceHistory(cgId, 7);
      if (history?.length >= 30) {
        const prices = history.map((h) => h.price);
        PRICE_HISTORY_CACHE.set(assetSymbol, {
          prices,
          volumes: [],
          fetchedAt: now,
        });
        return { prices, volumes: [] };
      }
      logger.warn(`CoinGecko history for ${assetSymbol} returned ${history?.length || 0} points (need ≥30); falling back to synthetic`);
    } catch (err) {
      logger.warn(`CoinGecko fetch failed for ${assetSymbol} (${cgId}): ${err.message?.substring(0, 120)}`);
    }
  } else {
    logger.debug(`No CoinGecko ID registered for ${assetSymbol} — using synthetic fallback`);
  }

  // Last-resort synthetic. Degenerate for RSI/MACD — only used when network
  // or config prevents a real fetch. Surface a loud warning once per cycle.
  logger.warn(`Using synthetic linear price array for ${assetSymbol} — RSI/MACD will collapse to 0 or 100 and AI will distrust the signal`);
  return {
    prices: buildMinimalPriceArray(currentPrice, change24h || 0),
    volumes: [],
  };
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
    asset: normalizeTradeSymbol(asset),
    action_hint: action,
    reason_hint: action === 'hold'
      ? 'Market conditions neutral. No clear signal.'
      : `${asset} ${action === 'buy' ? 'momentum' : 'weakness'} detected.`,
  };
}

function selectContextAsset(vaultState, marketSummary) {
  // 1. If vault holds an asset, analyze that (avoid context-switching while in position)
  const positionAsset = vaultState.current_position_asset || vaultState.primaryPositionAsset;
  if (positionAsset) return normalizeTradeSymbol(positionAsset);

  // 2. Otherwise pick asset with largest absolute 24h move (highest opportunity)
  if (marketSummary?.prices) {
    const candidates = ['BTC', 'ETH'].filter(s => marketSummary.prices[s]);
    if (candidates.length > 0) {
      const sorted = candidates.sort((a, b) =>
        Math.abs(marketSummary.prices[b].change24h || 0) - Math.abs(marketSummary.prices[a].change24h || 0)
      );
      return normalizeTradeSymbol(sorted[0]);
    }
  }

  return 'BTC';
}

function selectDecisionAsset(vaultState, aiView, fallbackAsset = 'BTC') {
  // Pick the first non-USDC candidate that is also present in the vault's
  // allowedAssetSymbols (if configured). USDC is the base/cash asset — BUY
  // with assetIn == assetOut would revert on-chain with SameToken().
  //
  // Additionally, non-base assets that aren't in the allowlist have no path
  // to settle: on 0G mainnet Jaine carries only USDC↔W0G / WBTC↔W0G /
  // WETH↔W0G pools, so a vault whose allowlist lacks W0G cannot route
  // BTC/ETH trades directly against USDC. Respecting the allowlist here
  // keeps the engine from proposing trades the venue cannot quote.
  const allowed = (vaultState.allowedAssetSymbols || [])
    .map((s) => normalizeTradeSymbol(s))
    .filter(Boolean);

  // Priority order: preserve existing position first, then AI's suggestion,
  // then 0G (deepest Jaine liquidity as USDC↔W0G hub on 0G mainnet — BTC/ETH
  // would need multi-hop routing which the single-hop adapter doesn't support).
  // `fallbackAsset` from caller comes last so explicit caller overrides are
  // still honored when the vault is on a chain where BTC/ETH pools exist.
  const candidates = [
    vaultState.current_position_asset,
    vaultState.primaryPositionAsset,
    aiView?.asset,
    '0G',
    fallbackAsset,
    'BTC',
  ];

  // First pass: prefer a candidate that's also in the vault allowlist.
  if (allowed.length > 0) {
    for (const c of candidates) {
      const sym = normalizeTradeSymbol(c);
      if (sym && sym !== 'USDC' && allowed.includes(sym)) return sym;
    }
    // No candidate matched the allowlist — fall back to the first non-USDC
    // allowlist entry so at least the engine suggests something routable.
    const firstAllowed = allowed.find((s) => s !== 'USDC');
    if (firstAllowed) return firstAllowed;
  }

  // No allowlist info available — fall through to candidate ordering.
  for (const c of candidates) {
    const sym = normalizeTradeSymbol(c);
    if (sym && sym !== 'USDC') return sym;
  }
  return '0G';
}

function getAssetMarketView(marketSummary, assetSymbol) {
  const symbol = normalizeTradeSymbol(assetSymbol) || 'BTC';
  const fallback = symbol === 'ETH'
    ? { price: 2100, change24h: 0, volume24h: 0 }
    : { price: 69000, change24h: 0, volume24h: 0 };
  const data = marketSummary.prices?.[symbol] || fallback;

  return {
    symbol,
    price: data.price || fallback.price,
    change24h: data.change24h || 0,
    volume24h: data.volume24h || 0,
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
  const allowedAssets = (vaultState.allowedAssetSymbols || []).filter((symbol) => symbol !== 'USDC');

  // ── Engine thresholds derived from vault policy ──
  //
  // The vault's `confidenceThresholdBps` is the user-declared risk budget:
  // "I'm comfortable trading when AI confidence ≥ X%". We scale the engine's
  // internal gates around that single knob so the engine respects user intent
  // instead of overriding with hardcoded 75% / 28% / 78% that were tuned for
  // a single default profile.
  //
  // Scaling:
  //   min_confidence_buy            = vault threshold (direct)
  //   min_confidence_reduce_or_sell = vault threshold − 10pp, floor 20%
  //                                   (sell should be a touch more permissive
  //                                   than buy — easier to exit than to enter)
  //   max_risk_score_buy            = inversely scaled: strict vault (high
  //                                   conf threshold) → low risk tolerance;
  //                                   permissive vault → up to 70% risk OK
  //   min_quality_buy               = scaled with confidence threshold: the
  //                                   quality bar should only be tall when
  //                                   confidence bar is tall
  //
  // Result: a vault with confidenceThresholdBps=6000 (60%) keeps roughly
  // today's production-strict behavior. A vault with 3000 (30%) opens up to
  // demo-friendly execution without bypassing any safety logic — the user
  // explicitly asked for more aggressive trading when they set that value.
  const vaultMinConf = (p.confidenceThresholdBps || 6000) / 10000;
  const minConfidenceBuy            = vaultMinConf;
  const minConfidenceReduceOrSell   = Math.max(0.20, vaultMinConf - 0.10);
  const maxRiskScoreBuy             = Math.max(0.28, Math.min(0.70, 1 - vaultMinConf + 0.05));
  const minQualityBuy               = Math.max(25, Math.min(85, Math.round(vaultMinConf * 100 + 5)));
  // Edge score threshold scales with confidence threshold too. The default 72
  // in decisionEngine matches a strict vault (vaultMinConf ≈ 0.75); permissive
  // vaults proportionally lower the edge bar.
  const minEdgeBuy                  = Math.max(30, Math.min(80, Math.round(35 + vaultMinConf * 55)));

  // Allowed regimes for BUY scale with vault risk tolerance. LOW_LIQUIDITY,
  // PANIC_VOLATILE, and TREND_DOWN_STRONG are never permitted regardless of
  // vault policy — those regimes indicate dangerous conditions unrelated to
  // user risk tolerance. Permissive vaults additionally tolerate NOISY range
  // and weak downtrends where a strict vault would sit on the sidelines.
  const allowedBuyRegimes = ['TREND_UP_STRONG', 'TREND_UP_WEAK', 'RANGE_STABLE'];
  if (vaultMinConf < 0.65) allowedBuyRegimes.push('RANGE_NOISY');
  if (vaultMinConf < 0.40) allowedBuyRegimes.push('TREND_DOWN_WEAK');

  return {
    allowed_assets: allowedAssets.length > 0 ? allowedAssets : ['BTC', 'ETH'],
    max_position_bps: p.maxPositionBps || 5000,
    max_daily_loss_bps: p.maxDailyLossBps || 500,
    stop_loss_bps: p.stopLossBps || 220,
    take_profit_bps: 450,
    trail_stop_bps: 180,
    cooldown_seconds: p.cooldownSeconds || 60,
    max_actions_per_60m: 2,
    min_confidence_buy: minConfidenceBuy,
    min_confidence_reduce_or_sell: minConfidenceReduceOrSell,
    max_risk_score_buy: maxRiskScoreBuy,
    min_quality_buy: minQualityBuy,
    min_edge_buy: minEdgeBuy,
    allowed_buy_regimes: allowedBuyRegimes,
    max_slippage_bps: 30,
    max_spread_bps: 20,
    pause: p.paused || false,
    mandate: (p.maxPositionBps || 5000) <= 1000 ? 'conservative' : (p.maxPositionBps || 5000) <= 1500 ? 'balanced' : 'aggressive',
  };
}

// Keep legacy export for backward compatibility
export { localAssessment as localDecisionEngine };
