import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { encodeFunctionData, parseUnits } from 'viem';
import {
  AegisGovernorABI,
  OperatorStakingABI,
  InsurancePoolABI,
  ProtocolTreasuryABI,
  OperatorReputationABI,
} from '../lib/contracts.js';

/**
 * Phase 4: Multi-sig governance hooks for AegisGovernor.
 *
 * Workflow:
 *   1. submit(target, value, data, description) — owner proposes an action
 *   2. confirm(id) — other owners confirm
 *   3. execute(id) — anyone can execute once threshold reached
 *
 * Helper builders translate domain actions (slash, freeze, payout, treasury spend, set verified)
 * into the (target, data) tuples needed for submit().
 */

// ── Read: governor config ──
export function useGovernorConfig(governorAddress) {
  const { data } = useReadContracts({
    contracts: governorAddress
      ? [
          { address: governorAddress, abi: AegisGovernorABI, functionName: 'getOwners' },
          { address: governorAddress, abi: AegisGovernorABI, functionName: 'threshold' },
          { address: governorAddress, abi: AegisGovernorABI, functionName: 'totalProposals' },
        ]
      : [],
    query: { enabled: !!governorAddress, refetchInterval: 30000 },
  });

  if (!data) return { owners: [], threshold: 0, totalProposals: 0 };
  const [owners, threshold, total] = data.map(r => r.result);
  return {
    owners: owners || [],
    threshold: Number(threshold || 0),
    totalProposals: Number(total || 0),
  };
}

// ── Read: paginated proposals ──
export function useProposals(governorAddress, count) {
  const ids = Array.from({ length: count || 0 }, (_, i) => i);
  const contracts = governorAddress
    ? ids.map((id) => ({
        address: governorAddress,
        abi: AegisGovernorABI,
        functionName: 'getProposal',
        args: [BigInt(id)],
      }))
    : [];

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: { enabled: !!governorAddress && (count || 0) > 0, refetchInterval: 15000 },
  });

  const proposals = (data || []).map((r, i) => {
    const p = r.result;
    if (!p) return null;
    return {
      id: i,
      target: p.target,
      value: p.value,
      data: p.data,
      description: p.description,
      proposer: p.proposer,
      confirmations: Number(p.confirmations || 0),
      executed: p.executed,
      canceled: p.canceled,
      createdAt: Number(p.createdAt || 0),
      executedAt: Number(p.executedAt || 0),
    };
  }).filter(Boolean);

  return { proposals, isLoading, refetch };
}

// ── Read: has wallet confirmed a proposal? ──
export function useHasConfirmed(governorAddress, proposalId, wallet) {
  return useReadContract({
    address: governorAddress,
    abi: AegisGovernorABI,
    functionName: 'hasConfirmed',
    args: [BigInt(proposalId), wallet],
    query: {
      enabled: !!governorAddress && proposalId !== undefined && !!wallet,
      refetchInterval: 15000,
    },
  });
}

// ── Write: submit proposal ──
export function useSubmitProposal() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const submit = (governorAddress, target, value, data, description) => {
    writeContract({
      address: governorAddress,
      abi: AegisGovernorABI,
      functionName: 'submit',
      args: [target, BigInt(value || 0), data, description],
    });
  };

  return { submit, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: confirm proposal ──
export function useConfirmProposal() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const confirm = (governorAddress, proposalId) => {
    writeContract({
      address: governorAddress,
      abi: AegisGovernorABI,
      functionName: 'confirm',
      args: [BigInt(proposalId)],
    });
  };

  return { confirm, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: revoke confirmation ──
export function useRevokeConfirmation() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const revoke = (governorAddress, proposalId) => {
    writeContract({
      address: governorAddress,
      abi: AegisGovernorABI,
      functionName: 'revokeConfirmation',
      args: [BigInt(proposalId)],
    });
  };

  return { revoke, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: execute proposal ──
export function useExecuteProposal() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const execute = (governorAddress, proposalId) => {
    writeContract({
      address: governorAddress,
      abi: AegisGovernorABI,
      functionName: 'execute',
      args: [BigInt(proposalId)],
    });
  };

  return { execute, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: cancel proposal ──
export function useCancelProposal() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const cancel = (governorAddress, proposalId) => {
    writeContract({
      address: governorAddress,
      abi: AegisGovernorABI,
      functionName: 'cancel',
      args: [BigInt(proposalId)],
    });
  };

  return { cancel, hash, isPending, isConfirming, isSuccess, error };
}

// ── Action builders: domain → (target, data) ──

export const ProposalBuilders = {
  /**
   * Slash an operator's stake. Slashed funds flow to insurance pool.
   */
  slash(stakingAddress, operatorAddress, amountUsd, reason) {
    const data = encodeFunctionData({
      abi: OperatorStakingABI,
      functionName: 'slash',
      args: [operatorAddress, parseUnits(String(amountUsd), 6), reason],
    });
    return { target: stakingAddress, value: 0n, data };
  },

  /**
   * Freeze an operator's stake during arbitration.
   */
  freeze(stakingAddress, operatorAddress) {
    const data = encodeFunctionData({
      abi: OperatorStakingABI,
      functionName: 'freeze',
      args: [operatorAddress],
    });
    return { target: stakingAddress, value: 0n, data };
  },

  /**
   * Unfreeze an operator's stake.
   */
  unfreeze(stakingAddress, operatorAddress) {
    const data = encodeFunctionData({
      abi: OperatorStakingABI,
      functionName: 'unfreeze',
      args: [operatorAddress],
    });
    return { target: stakingAddress, value: 0n, data };
  },

  /**
   * Pay out a claim from the insurance pool.
   */
  payoutClaim(insuranceAddress, claimId, amountUsd) {
    const data = encodeFunctionData({
      abi: InsurancePoolABI,
      functionName: 'payoutClaim',
      args: [BigInt(claimId), parseUnits(String(amountUsd), 6)],
    });
    return { target: insuranceAddress, value: 0n, data };
  },

  /**
   * Spend funds from the protocol treasury.
   */
  treasurySpend(treasuryAddress, tokenAddress, recipient, amountUsd, purpose) {
    const data = encodeFunctionData({
      abi: ProtocolTreasuryABI,
      functionName: 'spend',
      args: [tokenAddress, recipient, parseUnits(String(amountUsd), 6), purpose],
    });
    return { target: treasuryAddress, value: 0n, data };
  },

  /**
   * Grant or revoke verified badge on an operator.
   */
  setVerified(reputationAddress, operatorAddress, verified) {
    const data = encodeFunctionData({
      abi: OperatorReputationABI,
      functionName: 'setVerified',
      args: [operatorAddress, verified],
    });
    return { target: reputationAddress, value: 0n, data };
  },

  /**
   * Add a new owner to the multi-sig (self-call).
   */
  addOwner(governorAddress, newOwner) {
    const data = encodeFunctionData({
      abi: AegisGovernorABI,
      functionName: 'addOwner',
      args: [newOwner],
    });
    return { target: governorAddress, value: 0n, data };
  },

  /**
   * Remove an owner from the multi-sig (self-call).
   */
  removeOwner(governorAddress, oldOwner) {
    const data = encodeFunctionData({
      abi: AegisGovernorABI,
      functionName: 'removeOwner',
      args: [oldOwner],
    });
    return { target: governorAddress, value: 0n, data };
  },

  /**
   * Change the M-of-N threshold (self-call).
   */
  changeThreshold(governorAddress, newThreshold) {
    const data = encodeFunctionData({
      abi: AegisGovernorABI,
      functionName: 'changeThreshold',
      args: [BigInt(newThreshold)],
    });
    return { target: governorAddress, value: 0n, data };
  },
};

// ── Helpers ──

export function decodeProposalAction(proposal, knownAddresses) {
  // Best-effort label for display
  if (!proposal || !proposal.target) return 'Unknown';
  const target = proposal.target.toLowerCase();
  if (target === knownAddresses.operatorStaking?.toLowerCase()) return 'Operator Staking';
  if (target === knownAddresses.insurancePool?.toLowerCase()) return 'Insurance Pool';
  if (target === knownAddresses.protocolTreasury?.toLowerCase()) return 'Protocol Treasury';
  if (target === knownAddresses.operatorReputation?.toLowerCase()) return 'Reputation';
  if (target === knownAddresses.aegisGovernor?.toLowerCase()) return 'Governor (self)';
  return 'External';
}

export function shortHex(hex, leading = 6, trailing = 4) {
  if (!hex) return '';
  return `${hex.slice(0, leading)}...${hex.slice(-trailing)}`;
}
