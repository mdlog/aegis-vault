import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { OperatorStakingABI, InsurancePoolABI, MockERC20ABI } from '../lib/contracts.js';

/**
 * Phase 2: Operator Staking + Insurance Pool hooks
 *
 * Tier mapping (mirrors contract):
 *   0 None      → cap $5k
 *   1 Bronze    → cap $50k
 *   2 Silver    → cap $500k
 *   3 Gold      → cap $5M
 *   4 Platinum  → unlimited
 */

export const TIER_LABELS = {
  0: 'None',
  1: 'Bronze',
  2: 'Silver',
  3: 'Gold',
  4: 'Platinum',
};

export const TIER_THRESHOLDS = {
  0: 0,
  1: 1_000,
  2: 10_000,
  3: 100_000,
  4: 1_000_000,
};

export const TIER_CAPS = {
  0: 5_000,
  1: 50_000,
  2: 500_000,
  3: 5_000_000,
  4: Infinity,
};

export const TIER_COLORS = {
  0: 'text-steel/40',
  1: 'text-amber-warn/70',
  2: 'text-steel/60',
  3: 'text-gold',
  4: 'text-cyan',
};

// ── Read: full stake state for an operator ──
export function useOperatorStake(stakingAddress, operatorAddress, decimals = 6) {
  const contracts = stakingAddress && operatorAddress
    ? [
        { address: stakingAddress, abi: OperatorStakingABI, functionName: 'getStake', args: [operatorAddress] },
        { address: stakingAddress, abi: OperatorStakingABI, functionName: 'tierOf', args: [operatorAddress] },
        { address: stakingAddress, abi: OperatorStakingABI, functionName: 'maxVaultSize', args: [operatorAddress] },
      ]
    : [];

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: { enabled: !!stakingAddress && !!operatorAddress, refetchInterval: 15000 },
  });

  if (!data) {
    return { state: null, isLoading, refetch };
  }

  const [stakeRaw, tier, maxSize] = data.map(r => r.result);

  if (!stakeRaw) {
    return { state: null, isLoading, refetch };
  }

  const tierNum = Number(tier || 0);
  const isUnlimited = tierNum === 4;
  // type(uint256).max represents unlimited — don't try to format it as a USD number
  const maxSizeNum = isUnlimited
    ? Infinity
    : (maxSize ? parseFloat(formatUnits(maxSize, decimals)) : 0);

  return {
    state: {
      amount: parseFloat(formatUnits(stakeRaw.amount || 0n, decimals)),
      amountRaw: stakeRaw.amount || 0n,
      pendingUnstake: parseFloat(formatUnits(stakeRaw.pendingUnstake || 0n, decimals)),
      pendingUnstakeRaw: stakeRaw.pendingUnstake || 0n,
      unstakeAvailableAt: Number(stakeRaw.unstakeAvailableAt || 0),
      lifetimeStaked: parseFloat(formatUnits(stakeRaw.lifetimeStaked || 0n, decimals)),
      lifetimeSlashed: parseFloat(formatUnits(stakeRaw.lifetimeSlashed || 0n, decimals)),
      frozen: stakeRaw.frozen || false,
      tier: tierNum,
      tierLabel: TIER_LABELS[tierNum],
      maxVaultSize: maxSizeNum,
      isUnlimited,
    },
    isLoading,
    refetch,
  };
}

// ── Read: tier + maxVaultSize for many operators (batched) ──
export function useOperatorTiers(stakingAddress, operatorAddresses, decimals = 6) {
  const list = operatorAddresses || [];
  // Build interleaved [tierOf, maxVaultSize] calls per operator
  const contracts = stakingAddress
    ? list.flatMap((addr) => [
        { address: stakingAddress, abi: OperatorStakingABI, functionName: 'tierOf', args: [addr] },
        { address: stakingAddress, abi: OperatorStakingABI, functionName: 'maxVaultSize', args: [addr] },
        { address: stakingAddress, abi: OperatorStakingABI, functionName: 'getStake', args: [addr] },
      ])
    : [];

  const { data, isLoading } = useReadContracts({
    contracts,
    query: { enabled: !!stakingAddress && list.length > 0, refetchInterval: 30000 },
  });

  const tiersByAddress = {};
  if (data) {
    for (let i = 0; i < list.length; i++) {
      const tierResult = data[i * 3]?.result;
      const maxResult = data[i * 3 + 1]?.result;
      const stakeResult = data[i * 3 + 2]?.result;
      const tierNum = Number(tierResult || 0);
      const isUnlimited = tierNum === 4;
      tiersByAddress[list[i].toLowerCase()] = {
        tier: tierNum,
        tierLabel: TIER_LABELS[tierNum],
        maxVaultSize: isUnlimited
          ? Infinity
          : (maxResult ? parseFloat(formatUnits(maxResult, decimals)) : 0),
        isUnlimited,
        stakeAmount: stakeResult ? parseFloat(formatUnits(stakeResult.amount || 0n, decimals)) : 0,
        frozen: stakeResult?.frozen || false,
      };
    }
  }

  return { tiersByAddress, isLoading };
}

// ── Read: total stakers + total staked ──
export function useStakingStats(stakingAddress) {
  const { data } = useReadContracts({
    contracts: stakingAddress
      ? [
          { address: stakingAddress, abi: OperatorStakingABI, functionName: 'totalStakers' },
          { address: stakingAddress, abi: OperatorStakingABI, functionName: 'totalStaked' },
        ]
      : [],
    query: { enabled: !!stakingAddress, refetchInterval: 30000 },
  });

  if (!data) return { totalStakers: 0, totalStakedUsd: 0 };

  const [stakers, totalStaked] = data.map(r => r.result);
  return {
    totalStakers: Number(stakers || 0),
    totalStakedUsd: totalStaked ? parseFloat(formatUnits(totalStaked, 6)) : 0,
  };
}

// ── Read: token allowance (USDC → staking contract) ──
export function useStakingAllowance(tokenAddress, walletAddress, stakingAddress) {
  return useReadContract({
    address: tokenAddress,
    abi: MockERC20ABI,
    functionName: 'allowance',
    args: [walletAddress, stakingAddress],
    query: {
      enabled: !!tokenAddress && !!walletAddress && !!stakingAddress,
      refetchInterval: 10000,
    },
  });
}

// ── Write: approve USDC for staking ──
export function useApproveStake() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const approve = (tokenAddress, stakingAddress, amount, decimals = 6) => {
    writeContract({
      address: tokenAddress,
      abi: MockERC20ABI,
      functionName: 'approve',
      args: [stakingAddress, parseUnits(amount.toString(), decimals)],
    });
  };

  return { approve, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: stake ──
export function useStake() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const stake = (stakingAddress, amount, decimals = 6) => {
    writeContract({
      address: stakingAddress,
      abi: OperatorStakingABI,
      functionName: 'stake',
      args: [parseUnits(amount.toString(), decimals)],
    });
  };

  return { stake, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: request unstake ──
export function useRequestUnstake() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const requestUnstake = (stakingAddress, amount, decimals = 6) => {
    writeContract({
      address: stakingAddress,
      abi: OperatorStakingABI,
      functionName: 'requestUnstake',
      args: [parseUnits(amount.toString(), decimals)],
    });
  };

  return { requestUnstake, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: claim unstake ──
export function useClaimUnstake() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const claimUnstake = (stakingAddress) => {
    writeContract({
      address: stakingAddress,
      abi: OperatorStakingABI,
      functionName: 'claimUnstake',
    });
  };

  return { claimUnstake, hash, isPending, isConfirming, isSuccess, error };
}

// ── Read: insurance pool stats ──
export function useInsurancePoolStats(insurancePoolAddress, tokenAddress) {
  const { data } = useReadContracts({
    contracts: insurancePoolAddress && tokenAddress
      ? [
          { address: insurancePoolAddress, abi: InsurancePoolABI, functionName: 'totalDeposited' },
          { address: insurancePoolAddress, abi: InsurancePoolABI, functionName: 'totalPaidOut' },
          { address: insurancePoolAddress, abi: InsurancePoolABI, functionName: 'claimCount' },
          { address: tokenAddress, abi: MockERC20ABI, functionName: 'balanceOf', args: [insurancePoolAddress] },
        ]
      : [],
    query: { enabled: !!insurancePoolAddress && !!tokenAddress, refetchInterval: 30000 },
  });

  if (!data) return { totalDeposited: 0, totalPaidOut: 0, claimCount: 0, balance: 0 };

  const [deposited, paid, count, bal] = data.map(r => r.result);
  return {
    totalDeposited: deposited ? parseFloat(formatUnits(deposited, 6)) : 0,
    totalPaidOut: paid ? parseFloat(formatUnits(paid, 6)) : 0,
    claimCount: Number(count || 0),
    balance: bal ? parseFloat(formatUnits(bal, 6)) : 0,
  };
}

// ── Helpers ──

export function nextTier(currentTier) {
  if (currentTier >= 4) return null;
  return currentTier + 1;
}

export function tierGapUsd(currentStake, currentTier) {
  const next = nextTier(currentTier);
  if (next === null) return 0;
  return Math.max(0, TIER_THRESHOLDS[next] - currentStake);
}

export function formatVaultCap(maxSizeUsd, isUnlimited) {
  if (isUnlimited || !Number.isFinite(maxSizeUsd)) return 'Unlimited';
  if (maxSizeUsd >= 1_000_000) return `$${(maxSizeUsd / 1_000_000).toFixed(1)}M`;
  if (maxSizeUsd >= 1_000) return `$${(maxSizeUsd / 1_000).toFixed(0)}k`;
  return `$${maxSizeUsd.toLocaleString()}`;
}
