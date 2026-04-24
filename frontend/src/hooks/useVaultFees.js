import { useReadContract, useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { toast } from 'sonner';
import { AegisVaultABI } from '../lib/contracts.js';

/**
 * Phase 1: Vault fee read & write hooks
 *
 * NOTE: the slim AegisVault (the build currently deployed on 0G mainnet)
 * does NOT expose fee-management functions — no highWaterMark, no accrual,
 * no HWM, no pendingFeeChange, no setNavCalculator, no claim/accrue/queue.
 * The write hooks below are neutered to show a clear toast instead of
 * submitting a tx that would revert. The read hooks fall through to wagmi,
 * which returns undefined for missing functions (UI handles gracefully).
 *
 * When the full fee-bearing vault is deployed (e.g. on Arbitrum execution
 * layer), re-wire these hooks to the real `writeContract` calls.
 */
const SLIM_VAULT_UNSUPPORTED_MSG =
  'Fee management requires the full vault build. Only available on the Arbitrum execution layer.';

function unsupportedFeeHook(fnKey) {
  const noop = () => {
    toast.error('Fee control not available', { description: SLIM_VAULT_UNSUPPORTED_MSG });
  };
  const base = {
    hash: undefined,
    isPending: false,
    isConfirming: false,
    isSuccess: false,
    error: null,
    _unsupported: true,
  };
  return { [fnKey]: noop, ...base };
}

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

// ── Write hooks ── (slim vault does not expose fee functions; see header note)

export function useClaimFees()       { return unsupportedFeeHook('claim'); }
export function useAccrueFees()      { return unsupportedFeeHook('accrue'); }
export function useQueueFeeChange()  { return unsupportedFeeHook('queue'); }
export function useApplyFeeChange()  { return unsupportedFeeHook('apply'); }
export function useSetFeeRecipient() { return unsupportedFeeHook('setRecipient'); }
export function useSetNavCalculator(){ return unsupportedFeeHook('setCalculator'); }

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
