/**
 * PromptBuilder v1
 * Constructs structured prompts for the AI inference engine.
 * Supports both simple (legacy) and v1 (decision matrix) output formats.
 */

/**
 * Build the system prompt for the AI risk agent (v1)
 */
export function buildSystemPrompt() {
  return `You are Aegis Vault AI — a disciplined, risk-aware autonomous trading agent.

Your role is to analyze market conditions, regime, and technical indicators, then provide your assessment as structured JSON.

RULES:
- Capital preservation is the top priority.
- Never recommend a trade if conditions are ambiguous or volatile.
- Your confidence score must honestly reflect uncertainty.
- If in doubt, set confidence low and recommend hold.
- Your output MUST be valid JSON only. No explanation text outside JSON.

OUTPUT FORMAT (strict JSON):
{
  "action": "buy" | "sell" | "hold",
  "asset": "BTC" | "ETH" | "USDC",
  "size_bps": <number 0-5000>,
  "confidence": <number 0.0-1.0>,
  "risk_score": <number 0.0-1.0>,
  "reason": "<one sentence explanation>",
  "ai_context_score": <number 0-100>,
  "timing_score": <number 0-100>
}

FIELD DEFINITIONS:
- action: what to do. "hold" means no trade.
- asset: which asset to trade. For "hold", use "USDC".
- size_bps: position size in basis points of vault NAV (100 = 1%, max 2000 = 20%)
- confidence: how confident you are (0.0 = no confidence, 1.0 = very confident)
- risk_score: assessed market risk (0.0 = very safe, 1.0 = very risky)
- reason: one-sentence explanation of your decision
- ai_context_score: your assessment of setup clarity and signal quality (0-100)
- timing_score: how good the entry timing is right now (0-100)

CONSTRAINTS:
- size_bps must not exceed 2000 (20%)
- If risk_score > 0.45, you SHOULD recommend "hold"
- If confidence < 0.55, you SHOULD recommend "hold"
- Never trade more than one asset at a time
- Consider the regime classification when making decisions`;
}

/**
 * Build the user prompt with current market data, indicators, regime, and vault state
 */
// Safe number formatter — handles undefined/null/NaN
const fmtNum = (v, defaultVal = 0) => {
  const n = typeof v === 'number' && isFinite(v) ? v : defaultVal;
  return n.toLocaleString();
};
const fmtFixed = (v, digits = 2, defaultVal = 0) => {
  const n = typeof v === 'number' && isFinite(v) ? v : defaultVal;
  return n.toFixed(digits);
};

export function buildUserPrompt(marketSummary, vaultState, indicators = null, regime = null) {
  const lines = [
    '=== CURRENT MARKET DATA ===',
    `Timestamp: ${new Date(marketSummary.timestamp).toISOString()}`,
    '',
  ];

  // Price data
  for (const [symbol, data] of Object.entries(marketSummary.prices || {})) {
    if (!data) continue;
    lines.push(`${symbol}:`);
    lines.push(`  Price: $${fmtNum(data.price)}`);
    lines.push(`  24h Change: ${(data.change24h || 0) >= 0 ? '+' : ''}${fmtFixed(data.change24h)}%`);
    lines.push(`  24h Volume: $${fmtFixed((data.volume24h || 0) / 1e9)}B`);
  }

  // Volatility
  lines.push('');
  lines.push('=== VOLATILITY (7d annualized) ===');
  for (const [sym, vol] of Object.entries(marketSummary.volatility)) {
    lines.push(`${sym}: ${vol}`);
  }

  // Technical indicators (v1)
  if (indicators) {
    lines.push('');
    lines.push('=== TECHNICAL INDICATORS ===');
    lines.push(`EMA 20: $${fmtFixed(indicators.ema_20)}`);
    lines.push(`EMA 50: $${fmtFixed(indicators.ema_50)}`);
    lines.push(`EMA 200: $${fmtFixed(indicators.ema_200)}`);
    lines.push(`RSI-14: ${fmtFixed(indicators.rsi_14, 1)}`);
    lines.push(`MACD Histogram: ${fmtFixed(indicators.macd_histogram)}`);
    lines.push(`ATR-14 (%): ${fmtFixed(indicators.atr_14_pct)}%`);
    lines.push(`Realized Vol 1h: ${fmtFixed(indicators.realized_vol_1h_pct)}%`);
    lines.push(`Volume Z-Score: ${fmtFixed(indicators.volume_zscore)}`);
    lines.push(`Price vs VWAP: ${fmtFixed(indicators.price_vs_vwap_pct)}%`);
    lines.push(`MTF Alignment: ${indicators.mtf_alignment || 'unknown'}`);
  }

  // Regime classification (v1)
  if (regime) {
    lines.push('');
    lines.push(`=== REGIME CLASSIFICATION ===`);
    lines.push(`Current Regime: ${regime}`);
  }

  // Vault state
  lines.push('');
  lines.push('=== VAULT STATE ===');
  lines.push(`NAV: $${fmtNum(vaultState.nav)}`);
  lines.push(`Base Asset: ${vaultState.baseAsset || 'unknown'}`);
  lines.push(`Mandate: ${vaultState.mandate || 'Balanced'}`);
  lines.push(`Max Position: ${fmtFixed(vaultState.maxPositionPct, 0)}%`);
  lines.push(`Max Drawdown: ${fmtFixed(vaultState.maxDrawdownPct, 0)}%`);
  lines.push(`Confidence Threshold: ${fmtFixed(vaultState.confidenceThreshold, 0)}%`);
  lines.push(`Daily Actions Used: ${vaultState.dailyActionsUsed || 0}/${vaultState.maxActionsPerDay || 0}`);
  lines.push(`Last Execution: ${vaultState.lastExecution || 'Never'}`);
  lines.push(`Position: ${vaultState.current_position_side || 'flat'}`);
  if (typeof vaultState.current_position_pnl_pct === 'number') {
    lines.push(`Position PnL: ${fmtFixed(vaultState.current_position_pnl_pct)}%`);
  }
  if (vaultState.consecutive_losses) {
    lines.push(`Consecutive Losses: ${vaultState.consecutive_losses}`);
  }
  if (typeof vaultState.rolling_drawdown_pct === 'number') {
    lines.push(`Rolling Drawdown: ${fmtFixed(vaultState.rolling_drawdown_pct)}%`);
  }

  if (vaultState.allocation && vaultState.allocation.length > 0) {
    lines.push('');
    lines.push('Current Allocation:');
    for (const pos of vaultState.allocation) {
      lines.push(`  ${pos.symbol || '?'}: ${fmtFixed(pos.pct, 1)}% ($${fmtNum(pos.value)})`);
    }
  }

  lines.push('');
  lines.push('Based on the above data, what is your recommended action? Respond with JSON only.');

  return lines.join('\n');
}

/**
 * Parse the AI response into a structured decision
 * Returns null if parsing fails
 */
export function parseAIResponse(responseText) {
  try {
    let jsonStr = responseText.trim();

    // Remove markdown code fences if present
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    // Try to extract JSON from mixed text
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const decision = JSON.parse(jsonStr);

    // Validate required fields
    const required = ['action', 'asset', 'size_bps', 'confidence', 'risk_score', 'reason'];
    for (const field of required) {
      if (!(field in decision)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate action
    if (!['buy', 'sell', 'hold'].includes(decision.action)) {
      throw new Error(`Invalid action: ${decision.action}`);
    }

    // Normalize values — some models return 0-100 instead of 0-1
    decision.size_bps = Math.min(Math.max(0, Math.round(decision.size_bps)), 5000);
    decision.confidence = decision.confidence > 1 ? decision.confidence / 100 : decision.confidence;
    decision.confidence = Math.min(Math.max(0, decision.confidence), 1.0);
    decision.risk_score = decision.risk_score > 1 ? decision.risk_score / 100 : decision.risk_score;
    decision.risk_score = Math.min(Math.max(0, decision.risk_score), 1.0);

    // Normalize optional v1 fields
    if (decision.ai_context_score !== undefined) {
      decision.ai_context_score = Math.min(Math.max(0, Math.round(decision.ai_context_score)), 100);
    }
    if (decision.timing_score !== undefined) {
      decision.timing_score = Math.min(Math.max(0, Math.round(decision.timing_score)), 100);
    }

    // If hold, zero out size
    if (decision.action === 'hold') {
      decision.size_bps = 0;
    }

    return decision;

  } catch (err) {
    return null;
  }
}
