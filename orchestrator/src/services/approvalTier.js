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
  withReason((decision.confidence || 0) < 0.72, 'confidence_below_auto_threshold', reasons);
  withReason((decision.risk_score || 0) > 0.35, 'risk_above_auto_threshold', reasons);
  withReason((decision.trade_quality_score ?? 100) < 78, 'trade_quality_below_auto_threshold', reasons);
  withReason(decision.action === 'buy' && (decision.size_bps || 0) > Math.min(vaultState.policy.maxPositionBps || 5000, 3000), 'large_position_request', reasons);
  withReason(decision.action === 'sell' && sellFraction >= 7500, 'large_exit_request', reasons);

  if (
    decision.hard_veto ||
    (decision.confidence || 0) < 0.55 ||
    (decision.trade_quality_score ?? 100) < 60 ||
    (decision.risk_score || 0) > 0.65
  ) {
    return {
      tier: 'owner_confirmation',
      execute: false,
      reasons,
      label: 'Owner confirmation required',
    };
  }

  if (reasons.length > 0) {
    return {
      tier: 'review_required',
      execute: false,
      reasons,
      label: 'Manual review required',
    };
  }

  return {
    tier: 'auto_execute',
    execute: true,
    reasons: [],
    label: 'Auto-executable',
  };
}
