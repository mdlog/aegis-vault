import logger from '../utils/logger.js';

/**
 * PolicyCheckService
 * Off-chain mirror of the on-chain PolicyLibrary.
 * Pre-validates AI decisions before submitting to the contract.
 * This avoids wasting gas on intents that will be rejected.
 */

/**
 * Run all policy checks off-chain
 * @param {object} decision - AI decision from inference
 * @param {object} vaultState - Current vault state
 * @param {object} policy - Current vault policy
 * @returns {{ valid: boolean, reason: string }}
 */
export function preCheckPolicy(decision, vaultState, policy) {
  const checks = [
    checkAutoExecution(policy),
    checkNotPaused(policy),
    checkConfidence(decision, policy),
    checkPositionSize(decision, vaultState, policy),
    checkDailyActions(vaultState, policy),
    checkCooldown(vaultState, policy),
    checkAssetWhitelist(decision, vaultState),
    checkDailyLoss(vaultState, policy),
    checkRiskScore(decision),
  ];

  for (const check of checks) {
    if (!check.valid) {
      logger.warn(`Policy pre-check failed: ${check.reason}`);
      return check;
    }
  }

  logger.info('All policy pre-checks passed');
  return { valid: true, reason: '' };
}

function checkAutoExecution(policy) {
  if (!policy.autoExecution) {
    return { valid: false, reason: 'Auto-execution is disabled' };
  }
  return { valid: true, reason: '' };
}

function checkNotPaused(policy) {
  if (policy.paused) {
    return { valid: false, reason: 'Vault is paused' };
  }
  return { valid: true, reason: '' };
}

function checkConfidence(decision, policy) {
  const thresholdPct = policy.confidenceThresholdBps / 100;
  const confidencePct = decision.confidence * 100;
  if (confidencePct < thresholdPct) {
    return {
      valid: false,
      reason: `Confidence ${confidencePct.toFixed(0)}% below threshold ${thresholdPct.toFixed(0)}%`,
    };
  }
  return { valid: true, reason: '' };
}

function checkPositionSize(decision, vaultState, policy) {
  if (decision.action === 'hold') return { valid: true, reason: '' };

  const maxPct = policy.maxPositionBps / 100;
  const sizePct = decision.size_bps / 100;
  if (sizePct > maxPct) {
    return {
      valid: false,
      reason: `Position size ${sizePct}% exceeds max ${maxPct}%`,
    };
  }
  return { valid: true, reason: '' };
}

function checkDailyActions(vaultState, policy) {
  if (vaultState.dailyActionsUsed >= policy.maxActionsPerDay) {
    return {
      valid: false,
      reason: `Daily action limit reached (${vaultState.dailyActionsUsed}/${policy.maxActionsPerDay})`,
    };
  }
  return { valid: true, reason: '' };
}

function checkCooldown(vaultState, policy) {
  if (!vaultState.lastExecutionTimestamp) return { valid: true, reason: '' };

  const elapsed = Math.floor(Date.now() / 1000) - vaultState.lastExecutionTimestamp;
  if (elapsed < policy.cooldownSeconds) {
    const remaining = policy.cooldownSeconds - elapsed;
    return {
      valid: false,
      reason: `Cooldown active. ${remaining}s remaining.`,
    };
  }
  return { valid: true, reason: '' };
}

function checkAssetWhitelist(decision, vaultState) {
  if (decision.action === 'hold') return { valid: true, reason: '' };

  const allowed = vaultState.allowedAssets || [];
  const assetSymbol = decision.asset;

  // Check if the symbol maps to an address in allowedAssets
  // For the pre-check, we verify the symbol exists in our known mapping
  if (!['BTC', 'ETH', 'USDC', '0G'].includes(assetSymbol)) {
    return {
      valid: false,
      reason: `Asset ${assetSymbol} not recognized`,
    };
  }
  return { valid: true, reason: '' };
}

function checkDailyLoss(vaultState, policy) {
  const maxLossPct = policy.maxDailyLossBps / 100;
  const currentLossPct = vaultState.currentDailyLossPct || 0;
  if (currentLossPct > maxLossPct) {
    return {
      valid: false,
      reason: `Daily loss ${currentLossPct.toFixed(1)}% exceeds limit ${maxLossPct}%`,
    };
  }
  return { valid: true, reason: '' };
}

function checkRiskScore(decision) {
  // If risk score is very high and action is not hold, flag it
  if (decision.risk_score > 0.8 && decision.action !== 'hold') {
    return {
      valid: false,
      reason: `Risk score ${(decision.risk_score * 100).toFixed(0)}% too high for active trade`,
    };
  }
  return { valid: true, reason: '' };
}
