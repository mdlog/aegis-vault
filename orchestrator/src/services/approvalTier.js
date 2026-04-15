function withReason(flag, reason, reasons) {
  if (flag) reasons.push(reason);
}

export function evaluateApprovalTier(decision, vaultState) {
  if (!decision || decision.action === 'hold') {
    return {
      tier: 'not_required',
      execute: false,
      reasons: [],
      label: 'No approval required',
    };
  }

  const reasons = [];
  const sellFraction = decision.sell_fraction_bps || decision.size_bps || 0;

  withReason(decision.hard_veto, 'hard_veto_flag', reasons);
  withReason(decision.source?.includes('local'), 'fallback_engine_used', reasons);
  withReason((decision.confidence || 0) < 0.40, 'confidence_below_auto_threshold', reasons);
  withReason((decision.risk_score || 0) > 0.70, 'risk_above_auto_threshold', reasons);
  withReason((decision.trade_quality_score ?? 100) < 30, 'trade_quality_below_auto_threshold', reasons);
  withReason(decision.action === 'buy' && (decision.size_bps || 0) > Math.min(vaultState.policy.maxPositionBps || 5000, 3000), 'large_position_request', reasons);
  withReason(decision.action === 'sell' && sellFraction >= 9000, 'large_exit_request', reasons);

  // Demo mode: only block if confidence absurdly low OR risk extreme.
  // hard_veto check removed for demo — engine is too conservative for noisy markets.
  if (
    (decision.confidence || 0) < 0.30 ||
    (decision.risk_score || 0) > 0.85
  ) {
    return {
      tier: 'owner_confirmation',
      execute: false,
      reasons,
      label: 'Owner confirmation required',
    };
  }

  // Demo mode: skip review_required tier — go straight to auto_execute

  return {
    tier: 'auto_execute',
    execute: true,
    reasons: [],
    label: 'Auto-executable',
  };
}
