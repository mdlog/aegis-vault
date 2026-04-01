/**
 * PromptBuilder
 * Constructs a structured prompt for the AI inference engine.
 * The prompt instructs the model to output a strict JSON decision.
 */

/**
 * Build the system prompt for the AI risk agent
 */
export function buildSystemPrompt() {
  return `You are Aegis Vault AI — a disciplined, risk-aware autonomous trading agent.

Your role is to analyze market conditions and propose a single trading action for the vault.

RULES:
- You must be conservative. Capital preservation is the top priority.
- Never recommend a trade if conditions are ambiguous or volatile.
- Your confidence score must honestly reflect uncertainty.
- If in doubt, recommend "hold" with low confidence.
- Your output MUST be valid JSON only. No explanation text outside JSON.

OUTPUT FORMAT (strict JSON):
{
  "action": "buy" | "sell" | "hold",
  "asset": "BTC" | "ETH" | "USDC",
  "size_bps": <number 0-2000>,
  "confidence": <number 0.0-1.0>,
  "risk_score": <number 0.0-1.0>,
  "reason": "<one sentence explanation>"
}

FIELD DEFINITIONS:
- action: what to do. "hold" means no trade.
- asset: which asset to trade. For "hold", use the largest position.
- size_bps: position size in basis points of vault NAV (100 = 1%, 2000 = 20% max)
- confidence: how confident you are (0.0 = no confidence, 1.0 = very confident)
- risk_score: assessed market risk (0.0 = very safe, 1.0 = very risky)
- reason: one-sentence explanation of your decision

CONSTRAINTS:
- size_bps must not exceed 2000 (20%)
- If risk_score > 0.7, you SHOULD recommend "hold"
- If confidence < 0.5, you SHOULD recommend "hold"
- Never trade more than one asset at a time`;
}

/**
 * Build the user prompt with current market data and vault state
 */
export function buildUserPrompt(marketSummary, vaultState) {
  const lines = [
    '=== CURRENT MARKET DATA ===',
    `Timestamp: ${new Date(marketSummary.timestamp).toISOString()}`,
    '',
  ];

  // Price data
  for (const [symbol, data] of Object.entries(marketSummary.prices)) {
    lines.push(`${symbol}:`);
    lines.push(`  Price: $${data.price.toLocaleString()}`);
    lines.push(`  24h Change: ${data.change24h >= 0 ? '+' : ''}${data.change24h.toFixed(2)}%`);
    lines.push(`  24h Volume: $${(data.volume24h / 1e9).toFixed(2)}B`);
  }

  // Volatility
  lines.push('');
  lines.push('=== VOLATILITY (7d annualized) ===');
  for (const [sym, vol] of Object.entries(marketSummary.volatility)) {
    lines.push(`${sym}: ${vol}`);
  }

  // Vault state
  lines.push('');
  lines.push('=== VAULT STATE ===');
  lines.push(`NAV: $${vaultState.nav.toLocaleString()}`);
  lines.push(`Base Asset: ${vaultState.baseAsset}`);
  lines.push(`Mandate: ${vaultState.mandate}`);
  lines.push(`Max Position: ${vaultState.maxPositionPct}%`);
  lines.push(`Max Drawdown: ${vaultState.maxDrawdownPct}%`);
  lines.push(`Confidence Threshold: ${vaultState.confidenceThreshold}%`);
  lines.push(`Daily Actions Used: ${vaultState.dailyActionsUsed}/${vaultState.maxActionsPerDay}`);
  lines.push(`Last Execution: ${vaultState.lastExecution || 'Never'}`);

  if (vaultState.allocation && vaultState.allocation.length > 0) {
    lines.push('');
    lines.push('Current Allocation:');
    for (const pos of vaultState.allocation) {
      lines.push(`  ${pos.symbol}: ${pos.pct}% ($${pos.value.toLocaleString()})`);
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
    // Extract JSON from response (handle cases where model wraps in markdown)
    let jsonStr = responseText.trim();

    // Remove markdown code fences if present
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
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

    // If hold, zero out size
    if (decision.action === 'hold') {
      decision.size_bps = 0;
    }

    return decision;

  } catch (err) {
    return null;
  }
}
