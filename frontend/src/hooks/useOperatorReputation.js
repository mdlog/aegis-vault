import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits } from 'viem';
import { OperatorReputationABI } from '../lib/contracts.js';

/**
 * Phase 3: Operator Reputation hooks
 *
 * Stats sourced from on-chain OperatorReputation contract.
 * Vaults call recordExecution() after each successful executeIntent.
 * Users submit 1..5 star ratings (one per operator per wallet).
 * Protocol admin grants verified badges.
 */

// ── Read: who is the reputation admin ──
export function useReputationAdmin(reputationAddress) {
  return useReadContract({
    address: reputationAddress,
    abi: OperatorReputationABI,
    functionName: 'admin',
    query: { enabled: !!reputationAddress, refetchInterval: 60000 },
  });
}

// ── Read: full reputation state for a single operator ──
export function useOperatorReputation(reputationAddress, operatorAddress) {
  const contracts = reputationAddress && operatorAddress
    ? [
        { address: reputationAddress, abi: OperatorReputationABI, functionName: 'getStats', args: [operatorAddress] },
        { address: reputationAddress, abi: OperatorReputationABI, functionName: 'successRateBps', args: [operatorAddress] },
        { address: reputationAddress, abi: OperatorReputationABI, functionName: 'averageRatingScaled', args: [operatorAddress] },
      ]
    : [];

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: { enabled: !!reputationAddress && !!operatorAddress, refetchInterval: 30000 },
  });

  if (!data) {
    return { state: null, isLoading, refetch };
  }

  const [statsRaw, successBps, avgScaled] = data.map(r => r.result);
  if (!statsRaw) {
    return { state: null, isLoading, refetch };
  }

  return {
    state: {
      totalExecutions: Number(statsRaw.totalExecutions || 0n),
      successfulExecutions: Number(statsRaw.successfulExecutions || 0n),
      totalVolumeUsd: statsRaw.totalVolumeUsd6 ? parseFloat(formatUnits(statsRaw.totalVolumeUsd6, 6)) : 0,
      cumulativePnlUsd: statsRaw.cumulativePnlUsd6
        ? parseFloat(formatUnits(statsRaw.cumulativePnlUsd6, 6))
        : 0,
      lastExecutionAt: Number(statsRaw.lastExecutionAt || 0),
      firstExecutionAt: Number(statsRaw.firstExecutionAt || 0),
      ratingCount: Number(statsRaw.ratingCount || 0),
      ratingSumScaled: Number(statsRaw.ratingSumScaled || 0),
      verified: statsRaw.verified || false,
      successRatePct: Number(successBps || 0) / 100,
      averageRating: Number(avgScaled || 0) / 100,
    },
    isLoading,
    refetch,
  };
}

// ── Read: batched reputation for many operators (for marketplace) ──
export function useOperatorReputations(reputationAddress, operatorAddresses) {
  const list = operatorAddresses || [];
  const contracts = reputationAddress
    ? list.flatMap((addr) => [
        { address: reputationAddress, abi: OperatorReputationABI, functionName: 'getStats', args: [addr] },
        { address: reputationAddress, abi: OperatorReputationABI, functionName: 'successRateBps', args: [addr] },
        { address: reputationAddress, abi: OperatorReputationABI, functionName: 'averageRatingScaled', args: [addr] },
      ])
    : [];

  const { data } = useReadContracts({
    contracts,
    query: { enabled: !!reputationAddress && list.length > 0, refetchInterval: 60000 },
  });

  const byAddress = {};
  if (data) {
    for (let i = 0; i < list.length; i++) {
      const stats = data[i * 3]?.result;
      const successBps = data[i * 3 + 1]?.result;
      const avgScaled = data[i * 3 + 2]?.result;
      if (stats) {
        byAddress[list[i].toLowerCase()] = {
          totalExecutions: Number(stats.totalExecutions || 0n),
          successfulExecutions: Number(stats.successfulExecutions || 0n),
          totalVolumeUsd: stats.totalVolumeUsd6 ? parseFloat(formatUnits(stats.totalVolumeUsd6, 6)) : 0,
          cumulativePnlUsd: stats.cumulativePnlUsd6 ? parseFloat(formatUnits(stats.cumulativePnlUsd6, 6)) : 0,
          ratingCount: Number(stats.ratingCount || 0),
          verified: stats.verified || false,
          successRatePct: Number(successBps || 0) / 100,
          averageRating: Number(avgScaled || 0) / 100,
        };
      }
    }
  }

  return { reputationByAddress: byAddress };
}

// ── Read: has the connected wallet already rated this operator? ──
export function useHasRated(reputationAddress, operatorAddress, raterAddress) {
  return useReadContract({
    address: reputationAddress,
    abi: OperatorReputationABI,
    functionName: 'hasRated',
    args: [operatorAddress, raterAddress],
    query: { enabled: !!reputationAddress && !!operatorAddress && !!raterAddress, refetchInterval: 15000 },
  });
}

// ── Write: submit a rating ──
export function useSubmitRating() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const submitRating = (reputationAddress, operatorAddress, stars, comment) => {
    writeContract({
      address: reputationAddress,
      abi: OperatorReputationABI,
      functionName: 'submitRating',
      args: [operatorAddress, stars, comment],
    });
  };

  return { submitRating, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: admin sets verified badge ──
export function useSetVerified() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const setVerified = (reputationAddress, operatorAddress, verified) => {
    writeContract({
      address: reputationAddress,
      abi: OperatorReputationABI,
      functionName: 'setVerified',
      args: [operatorAddress, verified],
    });
  };

  return { setVerified, hash, isPending, isConfirming, isSuccess, error };
}

// ── Helpers ──

export function formatPnl(usd) {
  // Negative PnL must be visually distinct from positive — never drop the sign.
  const sign = usd >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function reputationScore(state) {
  // Composite 0..100 score for sorting/ranking
  if (!state || state.totalExecutions === 0) return 0;
  const successWeight = state.successRatePct * 0.5;          // 0..50
  const ratingWeight = (state.averageRating / 5) * 100 * 0.3; // 0..30
  const verifiedBonus = state.verified ? 20 : 0;             // 0 or 20
  return Math.round(Math.min(100, successWeight + ratingWeight + verifiedBonus));
}
