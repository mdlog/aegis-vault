import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits } from 'viem';
import { AegisVaultABI } from '../lib/contracts.js';

/**
 * Phase 1: Vault fee read & write hooks
 */

// ── Read: full fee state of a vault ──
export function useVaultFeeState(vaultAddress, decimals = 6) {
  const contracts = vaultAddress
    ? [
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'highWaterMark' },
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'accruedManagementFee' },
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'accruedPerformanceFee' },
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'lastFeeAccrual' },
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'protocolTreasury' },
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'pendingFeeChange' },
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'navCalculator' },
      ]
    : [];

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: { enabled: !!vaultAddress, refetchInterval: 15000 },
  });

  if (!data) {
    return { state: null, isLoading, refetch };
  }

  const [hwm, accruedMgmt, accruedPerf, lastAccrual, treasury, pendingFee, navCalc] = data.map(r => r.result);

  const accruedManagement = accruedMgmt ? parseFloat(formatUnits(accruedMgmt, decimals)) : 0;
  const accruedPerformance = accruedPerf ? parseFloat(formatUnits(accruedPerf, decimals)) : 0;

  return {
    state: {
      highWaterMark: hwm ? parseFloat(formatUnits(hwm, decimals)) : 0,
      highWaterMarkRaw: hwm || 0n,
      accruedManagement,
      accruedPerformance,
      accruedTotal: accruedManagement + accruedPerformance,
      lastFeeAccrual: lastAccrual ? Number(lastAccrual) : 0,
      protocolTreasury: treasury || '',
      navCalculator: navCalc || '',
      pendingFeeChange: pendingFee
        ? {
            newPerformanceFeeBps: Number(pendingFee.newPerformanceFeeBps || 0),
            newManagementFeeBps: Number(pendingFee.newManagementFeeBps || 0),
            newEntryFeeBps: Number(pendingFee.newEntryFeeBps || 0),
            newExitFeeBps: Number(pendingFee.newExitFeeBps || 0),
            effectiveAt: Number(pendingFee.effectiveAt || 0),
            pending: pendingFee.pending || false,
          }
        : null,
    },
    isLoading,
    refetch,
  };
}

// ── Read: live multi-asset NAV from vault.getNav() ──
export function useVaultNav(vaultAddress, decimals = 6) {
  const { data, isLoading, refetch } = useReadContract({
    address: vaultAddress,
    abi: AegisVaultABI,
    functionName: 'getNav',
    query: { enabled: !!vaultAddress, refetchInterval: 15000 },
  });

  return {
    navUsd6: data || 0n,
    navUsd: data ? parseFloat(formatUnits(data, decimals)) : 0,
    isLoading,
    refetch,
  };
}

// ── Read: vault fee constants ──
export function useFeeConstants(vaultAddress) {
  const contracts = vaultAddress
    ? [
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'MAX_PERFORMANCE_FEE_BPS' },
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'MAX_MANAGEMENT_FEE_BPS' },
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'MAX_ENTRY_FEE_BPS' },
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'MAX_EXIT_FEE_BPS' },
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'PROTOCOL_FEE_CUT_BPS' },
        { address: vaultAddress, abi: AegisVaultABI, functionName: 'FEE_CHANGE_COOLDOWN' },
      ]
    : [];

  const { data } = useReadContracts({ contracts, query: { enabled: !!vaultAddress } });

  if (!data) return null;
  const [maxPerf, maxMgmt, maxEntry, maxExit, protoCut, cooldown] = data.map(r => r.result);
  return {
    maxPerformanceFeeBps: Number(maxPerf || 3000),
    maxManagementFeeBps: Number(maxMgmt || 500),
    maxEntryFeeBps: Number(maxEntry || 200),
    maxExitFeeBps: Number(maxExit || 200),
    protocolFeeCutBps: Number(protoCut || 2000),
    feeChangeCooldownSeconds: Number(cooldown || 7 * 24 * 3600),
  };
}

// ── Write: claim accrued fees (operator only) ──
export function useClaimFees() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const claim = (vaultAddress) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVaultABI,
      functionName: 'claimFees',
    });
  };

  return { claim, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: trigger fee accrual (anyone) ──
export function useAccrueFees() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const accrue = (vaultAddress) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVaultABI,
      functionName: 'accrueFees',
    });
  };

  return { accrue, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: queue fee change (owner only, 7-day cooldown) ──
export function useQueueFeeChange() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const queue = (vaultAddress, perfBps, mgmtBps, entryBps, exitBps) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVaultABI,
      functionName: 'queueFeeChange',
      args: [BigInt(perfBps), BigInt(mgmtBps), BigInt(entryBps), BigInt(exitBps)],
    });
  };

  return { queue, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: apply queued fee change after cooldown ──
export function useApplyFeeChange() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const apply = (vaultAddress) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVaultABI,
      functionName: 'applyFeeChange',
    });
  };

  return { apply, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: set fee recipient (owner only) ──
export function useSetFeeRecipient() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const setRecipient = (vaultAddress, newRecipient) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVaultABI,
      functionName: 'setFeeRecipient',
      args: [newRecipient],
    });
  };

  return { setRecipient, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: set NAV calculator (owner only) ──
export function useSetNavCalculator() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const setCalculator = (vaultAddress, calculatorAddress) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVaultABI,
      functionName: 'setNavCalculator',
      args: [calculatorAddress],
    });
  };

  return { setCalculator, hash, isPending, isConfirming, isSuccess, error };
}

// ── Helpers ──

/**
 * Format basis points to percentage string.
 * 1500 → "15.00%"
 */
export function formatBps(bps) {
  if (bps === undefined || bps === null) return '—';
  const n = Number(bps);
  return `${(n / 100).toFixed(2)}%`;
}

/**
 * Estimate annual cost on a given vault size given fee bps
 */
export function estimateAnnualFees(navUsd, perfBps, mgmtBps, expectedAnnualReturnPct = 10) {
  const nav = parseFloat(navUsd) || 0;
  const mgmtCost = (nav * Number(mgmtBps || 0)) / 10000;
  const expectedProfit = (nav * expectedAnnualReturnPct) / 100;
  const perfCost = (expectedProfit * Number(perfBps || 0)) / 10000;
  return {
    managementCost: mgmtCost,
    performanceCost: perfCost,
    totalEstimated: mgmtCost + perfCost,
  };
}
