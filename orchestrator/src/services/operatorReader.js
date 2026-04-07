import { ethers } from 'ethers';
import config from '../config/index.js';
import {
  getOperatorStakingContract,
  getOperatorReputationContract,
  getOperatorRegistryContract,
} from '../config/contracts.js';
import logger from '../utils/logger.js';

/**
 * OperatorReaderService
 *
 * Reads Phase 2-3 state for an operator wallet:
 *   - Stake tier + max vault size (OperatorStaking)
 *   - Frozen flag (OperatorStaking)
 *   - Reputation stats (OperatorReputation)
 *   - Registration + fees (OperatorRegistry)
 *
 * All reads are best-effort: if a contract isn't deployed, returns null fields
 * rather than throwing. The decision engine then treats the operator as unrestricted
 * (graceful degradation for dev/testnet setups without the full stack).
 */

const TIER_LABELS = ['None', 'Bronze', 'Silver', 'Gold', 'Platinum'];

export async function readOperatorState(operatorAddress) {
  if (!operatorAddress || operatorAddress === ethers.ZeroAddress) {
    return null;
  }

  const state = {
    wallet: operatorAddress,
    registered: false,
    active: false,
    name: null,
    stake: null,
    reputation: null,
  };

  // Registry
  try {
    const registry = getOperatorRegistryContract();
    if (registry) {
      state.registered = await registry.isRegistered(operatorAddress);
      if (state.registered) {
        const op = await registry.getOperator(operatorAddress);
        state.active = op.active;
        state.name = op.name;
        state.mandate = Number(op.mandate);
        state.fees = {
          performanceBps: Number(op.performanceFeeBps || 0),
          managementBps: Number(op.managementFeeBps || 0),
          entryBps: Number(op.entryFeeBps || 0),
          exitBps: Number(op.exitFeeBps || 0),
        };
        state.recommendedPolicy = {
          maxPositionBps: Number(op.recommendedMaxPositionBps || 0),
          confidenceMinBps: Number(op.recommendedConfidenceMinBps || 0),
          stopLossBps: Number(op.recommendedStopLossBps || 0),
          cooldownSeconds: Number(op.recommendedCooldownSeconds || 0),
          maxActionsPerDay: Number(op.recommendedMaxActionsPerDay || 0),
        };
      }
    }
  } catch (err) {
    logger.debug(`operatorReader: registry read failed for ${operatorAddress}: ${err.message}`);
  }

  // Staking
  try {
    const staking = getOperatorStakingContract();
    if (staking) {
      const [stakeRaw, tier, maxSize] = await Promise.all([
        staking.getStake(operatorAddress),
        staking.tierOf(operatorAddress),
        staking.maxVaultSize(operatorAddress),
      ]);
      const tierNum = Number(tier);
      const maxSizeRaw = BigInt(maxSize);
      const UNLIMITED = (1n << 256n) - 1n;
      state.stake = {
        amountUsd: parseFloat(ethers.formatUnits(stakeRaw.amount || 0n, 6)),
        pendingUnstakeUsd: parseFloat(ethers.formatUnits(stakeRaw.pendingUnstake || 0n, 6)),
        frozen: stakeRaw.frozen || false,
        lifetimeSlashedUsd: parseFloat(ethers.formatUnits(stakeRaw.lifetimeSlashed || 0n, 6)),
        tier: tierNum,
        tierLabel: TIER_LABELS[tierNum],
        isUnlimited: maxSizeRaw === UNLIMITED,
        maxVaultSizeUsd: maxSizeRaw === UNLIMITED
          ? Infinity
          : parseFloat(ethers.formatUnits(maxSizeRaw, 6)),
      };
    }
  } catch (err) {
    logger.debug(`operatorReader: staking read failed for ${operatorAddress}: ${err.message}`);
  }

  // Reputation
  try {
    const reputation = getOperatorReputationContract();
    if (reputation) {
      const [stats, successBps, avgScaled] = await Promise.all([
        reputation.getStats(operatorAddress),
        reputation.successRateBps(operatorAddress),
        reputation.averageRatingScaled(operatorAddress),
      ]);
      state.reputation = {
        totalExecutions: Number(stats.totalExecutions || 0n),
        successfulExecutions: Number(stats.successfulExecutions || 0n),
        totalVolumeUsd: parseFloat(ethers.formatUnits(stats.totalVolumeUsd6 || 0n, 6)),
        cumulativePnlUsd: parseFloat(ethers.formatUnits(stats.cumulativePnlUsd6 || 0n, 6)),
        ratingCount: Number(stats.ratingCount || 0),
        verified: stats.verified || false,
        successRatePct: Number(successBps || 0) / 100,
        averageRating: Number(avgScaled || 0) / 100,
      };
    }
  } catch (err) {
    logger.debug(`operatorReader: reputation read failed for ${operatorAddress}: ${err.message}`);
  }

  return state;
}

/**
 * Check whether a vault/operator pair is eligible for execution under Phase 2-5 rules.
 *
 * Returns { eligible: boolean, reason?: string } — suitable for the decision engine's
 * hard-veto pipeline.
 *
 * Behavior when Phase 2+ contracts are NOT deployed:
 *   - STRICT_MODE=1 → reject the cycle (fail-closed). Real funds should never run
 *     on a stack where tier caps and slashing arbitration cannot be enforced.
 *   - STRICT_MODE=0 → allow (graceful degradation for dev/testnet ergonomics).
 *
 * @param {object} vaultState
 * @param {object|null} operatorState
 * @param {{ strictMode?: boolean }} [options] Override strict mode for testing.
 *        Defaults to config.strictMode.
 */
export function checkOperatorEligibility(vaultState, operatorState, options = {}) {
  const strictMode = options.strictMode !== undefined ? options.strictMode : config.strictMode;

  if (!operatorState) {
    if (strictMode) {
      return {
        eligible: false,
        reason: 'OPERATOR_STACK_MISSING',
        detail: 'STRICT_MODE: OperatorRegistry/Staking/Reputation contracts not deployed — refusing to execute',
      };
    }
    // Phase 2+ not deployed — allow execution (graceful degradation, dev only)
    return { eligible: true };
  }

  // In strict mode, an unregistered operator address is also a hard fail
  if (strictMode && !operatorState.registered) {
    return {
      eligible: false,
      reason: 'OPERATOR_NOT_REGISTERED',
      detail: 'STRICT_MODE: operator wallet is not registered in OperatorRegistry',
    };
  }

  // In strict mode, an operator with no stake is also a hard fail
  if (strictMode && (!operatorState.stake || operatorState.stake.amountUsd === 0)) {
    return {
      eligible: false,
      reason: 'OPERATOR_NO_STAKE',
      detail: 'STRICT_MODE: operator has zero active stake',
    };
  }

  if (operatorState.stake?.frozen) {
    return {
      eligible: false,
      reason: 'OPERATOR_FROZEN',
      detail: 'Operator stake is frozen pending governance arbitration',
    };
  }

  if (operatorState.registered && !operatorState.active) {
    return {
      eligible: false,
      reason: 'OPERATOR_DEACTIVATED',
      detail: 'Operator has been deactivated in the registry',
    };
  }

  // Tier cap check (only if staking contract available)
  if (operatorState.stake && !operatorState.stake.isUnlimited) {
    const nav = vaultState?.nav || 0;
    if (nav > operatorState.stake.maxVaultSizeUsd) {
      return {
        eligible: false,
        reason: 'TIER_CAP_EXCEEDED',
        detail: `Vault NAV $${nav.toFixed(0)} exceeds ${operatorState.stake.tierLabel} tier cap of $${operatorState.stake.maxVaultSizeUsd.toFixed(0)}`,
      };
    }
  }

  return { eligible: true };
}
