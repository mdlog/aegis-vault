import config from '../config/index.js';
import logger from '../utils/logger.js';
import { buildSystemPrompt, buildUserPrompt, parseAIResponse } from './promptBuilder.js';
import { chatCompletion, isOGComputeAvailable, initOGCompute } from './ogCompute.js';

/**
 * InferenceService
 * Calls 0G Compute Network for AI inference via the @0glabs/0g-serving-broker SDK.
 * Falls back to a deterministic local decision engine if 0G Compute is unavailable.
 */

/**
 * Request AI inference — tries 0G Compute first, then local fallback.
 * @param {object} marketSummary - Market data from marketData service
 * @param {object} vaultState - Current vault state
 * @returns {object} AI decision { action, asset, size_bps, confidence, risk_score, reason, source }
 */
export async function requestInference(marketSummary, vaultState) {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(marketSummary, vaultState);

  // Try 0G Compute Network first
  try {
    if (!isOGComputeAvailable()) {
      logger.info('0G Compute not initialized, attempting init...');
      await initOGCompute();
    }

    if (isOGComputeAvailable()) {
      logger.info('Requesting inference from 0G Compute Network...');

      const result = await chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], {
        temperature: 0.3,
        max_tokens: 512,
      });

      if (result?.content) {
        logger.info(`0G Compute response received (provider: ${result.provider}, model: ${result.model})`);
        logger.debug(`Raw response: ${result.content}`);

        const decision = parseAIResponse(result.content);
        if (decision) {
          decision.source = '0g-compute';
          decision.provider = result.provider;
          decision.model = result.model;
          return decision;
        }

        logger.warn('Failed to parse 0G Compute response, falling back to local engine');
      } else {
        logger.warn('0G Compute returned no content, falling back to local engine');
      }
    }
  } catch (err) {
    logger.warn(`0G Compute inference failed: ${err.message}. Using local decision engine.`);
  }

  // Fallback to local decision engine
  return localDecisionEngine(marketSummary, vaultState);
}

/**
 * Local deterministic decision engine — fallback when 0G Compute is unavailable.
 * Uses simple rule-based logic to demonstrate the system flow.
 */
export function localDecisionEngine(marketSummary, vaultState) {
  logger.info('Running local decision engine (fallback)');

  const prices = marketSummary.prices;
  const btc = prices.BTC;
  const eth = prices.ETH;

  if (!btc && !eth) {
    return {
      action: 'hold',
      asset: 'USDC',
      size_bps: 0,
      confidence: 0.3,
      risk_score: 0.5,
      reason: 'Insufficient market data to make a decision.',
      source: 'local-fallback',
    };
  }

  // Simple momentum + volatility logic
  const btcChange = btc?.change24h || 0;
  const ethChange = eth?.change24h || 0;

  // High volatility → hold
  const volatilityStr = marketSummary.volatility?.BTC || '0%';
  const btcVol = parseFloat(volatilityStr) || 0;
  if (btcVol > 80) {
    return {
      action: 'hold',
      asset: 'BTC',
      size_bps: 0,
      confidence: 0.55,
      risk_score: 0.72,
      reason: `High BTC volatility (${btcVol.toFixed(0)}% annualized). Holding to protect capital.`,
      source: 'local-fallback',
    };
  }

  // Strong BTC momentum up → cautious buy
  if (btcChange > 2.5) {
    return {
      action: 'buy',
      asset: 'BTC',
      size_bps: 800,
      confidence: 0.72,
      risk_score: 0.35,
      reason: `BTC showing strong momentum (+${btcChange.toFixed(1)}% 24h) with acceptable risk. Cautious entry.`,
      source: 'local-fallback',
    };
  }

  // Strong BTC drop → defensive sell
  if (btcChange < -3) {
    return {
      action: 'sell',
      asset: 'BTC',
      size_bps: 600,
      confidence: 0.68,
      risk_score: 0.52,
      reason: `BTC declining (${btcChange.toFixed(1)}% 24h). Reducing exposure to limit drawdown.`,
      source: 'local-fallback',
    };
  }

  // ETH momentum up
  if (ethChange > 3) {
    return {
      action: 'buy',
      asset: 'ETH',
      size_bps: 600,
      confidence: 0.66,
      risk_score: 0.38,
      reason: `ETH momentum continuation (+${ethChange.toFixed(1)}% 24h). Risk-adjusted entry within mandate.`,
      source: 'local-fallback',
    };
  }

  // ETH drop
  if (ethChange < -3.5) {
    return {
      action: 'sell',
      asset: 'ETH',
      size_bps: 500,
      confidence: 0.65,
      risk_score: 0.48,
      reason: `ETH weakness (${ethChange.toFixed(1)}% 24h). Trimming to reduce exposure.`,
      source: 'local-fallback',
    };
  }

  // Default: mild conditions → hold
  return {
    action: 'hold',
    asset: 'USDC',
    size_bps: 0,
    confidence: 0.45,
    risk_score: 0.30,
    reason: 'Market conditions neutral. No clear signal. Holding current positions.',
    source: 'local-fallback',
  };
}
