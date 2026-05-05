import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { parseUnits, formatUnits, decodeEventLog } from 'viem';
import { toast } from 'sonner';
import { AegisVaultABI, AegisVault_v4ABI, AegisVaultFactoryABI, AegisVaultFactoryV3ABI, AegisVaultFactoryV4ABI, MockERC20ABI, getDeployments } from '../lib/contracts.js';

/**
 * Slim AegisVault (the build currently deployed on 0G mainnet) exposes only:
 *   deposit · withdraw · commitIntent · executeIntent · getAllowedAssets ·
 *   getPolicy · getVaultSummary
 *
 * The full vault — with pause, updatePolicy, setExecutor, fee accrual, HWM,
 * NAV calculator, etc. — is deployed only on gas-plentiful chains (Arbitrum
 * execution layer). Hooks that target full-vault-only functions are neutered
 * below: clicking them shows an explanatory toast instead of submitting a tx
 * that would revert with a cryptic error on 0G.
 */
const SLIM_VAULT_UNSUPPORTED_MSG =
  'This control requires the full vault build. Only available on the Arbitrum execution layer.';

function unsupportedWriteHook() {
  const noop = () => {
    toast.error('Control not available', { description: SLIM_VAULT_UNSUPPORTED_MSG });
  };
  return {
    hash: undefined,
    isPending: false,
    isConfirming: false,
    isSuccess: false,
    error: null,
    _unsupported: true,
    _call: noop,
  };
}

// ── Read Vault Summary ──
//
// Caller can pass `decimals` (defaults to 6 for legacy USDC vaults). For vaults
// with non-USDC base assets (WETH=18, WBTC=8) the wrong decimals would silently
// return values off by 10^N — pass the right one resolved from the vault's
// baseAsset address via `useTokenDecimals` / asset metadata.
export function useVaultSummary(vaultAddress, decimals = 6) {
  const { data, isLoading, error, refetch } = useReadContract({
    address: vaultAddress,
    abi: AegisVaultABI,
    functionName: 'getVaultSummary',
    query: { enabled: !!vaultAddress, refetchInterval: 10000 },
  });

  if (!data) return { data: null, isLoading, error, refetch };

  const [owner, executor, baseAsset, balance, totalDeposited, lastExecution, dailyActions, paused, autoExecution] = data;

  return {
    data: {
      owner,
      executor,
      baseAsset,
      balance: formatUnits(balance, decimals),
      balanceRaw: balance,
      totalDeposited: formatUnits(totalDeposited, decimals),
      lastExecution: Number(lastExecution),
      dailyActions: Number(dailyActions),
      paused,
      autoExecution,
      decimals,
    },
    isLoading,
    error,
    refetch,
  };
}

// ── Read Token Decimals ──
// Resolves the decimals of an arbitrary ERC20 (used to pick the right scale
// for a vault's base asset before formatting balances).
export function useTokenDecimals(tokenAddress) {
  const { data, isLoading } = useReadContract({
    address: tokenAddress,
    abi: MockERC20ABI,
    functionName: 'decimals',
    query: { enabled: !!tokenAddress },
  });
  return { decimals: data !== undefined ? Number(data) : null, isLoading };
}

// ── Read Vault Policy ──

export function useVaultPolicy(vaultAddress) {
  const { data, isLoading, error } = useReadContract({
    address: vaultAddress,
    abi: AegisVaultABI,
    functionName: 'getPolicy',
    query: { enabled: !!vaultAddress, refetchInterval: 30000 },
  });

  if (!data) return { data: null, isLoading, error };

  return {
    data: {
      maxPositionBps: Number(data.maxPositionBps),
      maxDailyLossBps: Number(data.maxDailyLossBps),
      stopLossBps: Number(data.stopLossBps),
      cooldownSeconds: Number(data.cooldownSeconds),
      confidenceThresholdBps: Number(data.confidenceThresholdBps),
      maxActionsPerDay: Number(data.maxActionsPerDay),
      autoExecution: data.autoExecution,
      paused: data.paused,
      // Phase 1: fees
      performanceFeeBps: Number(data.performanceFeeBps || 0),
      managementFeeBps: Number(data.managementFeeBps || 0),
      entryFeeBps: Number(data.entryFeeBps || 0),
      exitFeeBps: Number(data.exitFeeBps || 0),
      feeRecipient: data.feeRecipient || '',
      // Track 2: Sealed Strategy Mode
      sealedMode: !!data.sealedMode,
      attestedSigner: data.attestedSigner || '',
      // Derived
      maxPositionPct: Number(data.maxPositionBps) / 100,
      maxDailyLossPct: Number(data.maxDailyLossBps) / 100,
      stopLossPct: Number(data.stopLossBps) / 100,
      confidenceThresholdPct: Number(data.confidenceThresholdBps) / 100,
      performanceFeePct: Number(data.performanceFeeBps || 0) / 100,
      managementFeePct: Number(data.managementFeeBps || 0) / 100,
      entryFeePct: Number(data.entryFeeBps || 0) / 100,
      exitFeePct: Number(data.exitFeeBps || 0) / 100,
    },
    isLoading,
    error,
  };
}

// ── Read Allowed Assets ──

export function useAllowedAssets(vaultAddress) {
  return useReadContract({
    address: vaultAddress,
    abi: AegisVaultABI,
    functionName: 'getAllowedAssets',
    query: { enabled: !!vaultAddress },
  });
}

/**
 * Batch-read the balance of every allowed asset held by the vault itself.
 * Used by the v2 multi-asset withdraw UI to show users exactly which tokens
 * their vault is currently holding (base + any non-base left from trades or
 * legacy transfer-style deposits).
 *
 * Returns: [{ address, balance: bigint, loaded: bool }, ...] in the same
 * order as getAllowedAssets(). balance is raw bigint — caller formats.
 */
export function useVaultAssetBalances(vaultAddress) {
  const { data: allowedAssets } = useAllowedAssets(vaultAddress);
  const assets = allowedAssets || [];

  const balanceCalls = assets.map((addr) => ({
    address: addr,
    abi: MockERC20ABI,
    functionName: 'balanceOf',
    args: [vaultAddress],
  }));

  const { data: balances, isLoading } = useReadContracts({
    contracts: balanceCalls,
    query: { enabled: !!vaultAddress && assets.length > 0, refetchInterval: 15000 },
  });

  const rows = assets.map((addr, i) => ({
    address: addr,
    balance: balances?.[i]?.result ?? 0n,
    loaded: balances?.[i]?.status === 'success',
  }));
  return { assets: rows, isLoading };
}

// ── Read Token Balance of Wallet ──

export function useTokenBalance(tokenAddress, walletAddress, decimals = 6) {
  const { data, isLoading } = useReadContract({
    address: tokenAddress,
    abi: MockERC20ABI,
    functionName: 'balanceOf',
    args: [walletAddress],
    query: { enabled: !!tokenAddress && !!walletAddress, refetchInterval: 10000 },
  });

  return { balance: data ? formatUnits(data, decimals) : '0', balanceRaw: data || 0n, isLoading };
}

// ── Write: Transfer Token (direct ERC20 transfer to vault) ──

export function useTransferToken() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const transfer = (tokenAddress, to, amount, decimals = 18) => {
    writeContract({
      address: tokenAddress,
      abi: MockERC20ABI,
      functionName: 'transfer',
      args: [to, parseUnits(amount.toString(), decimals)],
    });
  };

  return { transfer, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: Wrap Native → Wrapped ERC-20 (WETH9-compatible) ──
//
// W0G on 0G mainnet follows the WETH9 convention: `deposit()` is payable and
// mints wrapped ERC-20 1:1 to the caller. We use this to bridge native 0G into
// the ERC-20 path that AegisVault.deposit / transfer() flows require.

const WETH9_DEPOSIT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
];

export function useWrapNative() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const wrap = (wrappedTokenAddress, amount, decimals = 18) => {
    writeContract({
      address: wrappedTokenAddress,
      abi: WETH9_DEPOSIT_ABI,
      functionName: 'deposit',
      args: [],
      value: parseUnits(amount.toString(), decimals),
    });
  };

  return { wrap, hash, isPending, isConfirming, isSuccess, error, reset };
}

// ── Read Factory Vault List ──

export function useOwnerVaults(factoryAddress, ownerAddress) {
  return useReadContract({
    address: factoryAddress,
    abi: AegisVaultFactoryABI,
    functionName: 'getOwnerVaults',
    args: [ownerAddress],
    query: { enabled: !!factoryAddress && !!ownerAddress },
  });
}

// ── Read: Full Vault List for Owner (addresses + summaries) ──
//
// Multi-factory policy: queries every factory generation present on the
// current chain (V3, then V2, then the V1 fallback the caller passed) and
// merges the results. Post-fresh-deploy this means the dashboard shows V3
// vaults the user just created, while existing V2 vaults stay visible
// (their funds are still accessible). V1 vaults remain accessible only
// via direct URL navigation.

export function useVaultList(factoryAddress, ownerAddress) {
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const factoryV4 = deployments.aegisVaultFactoryV4 || '';
  const factoryV3 = deployments.aegisVaultFactoryV3 || '';
  const factoryV2 = deployments.aegisVaultFactoryV2 || '';
  const factoryV1 = (factoryAddress && factoryAddress !== factoryV4
                                    && factoryAddress !== factoryV3
                                    && factoryAddress !== factoryV2)
    ? factoryAddress
    : '';

  // V4 + V3 + V2 + V1 factories all expose getOwnerVaults with the same
  // signature — the AegisVaultFactoryABI (V1/V2 ABI) covers the read shape
  // for every generation. We don't need V4-specific ABI for this list query.
  const { data: ownerListsRaw, isLoading: addrsLoading } = useReadContracts({
    contracts: [
      factoryV4 && { address: factoryV4, abi: AegisVaultFactoryABI, functionName: 'getOwnerVaults', args: [ownerAddress] },
      factoryV3 && { address: factoryV3, abi: AegisVaultFactoryABI, functionName: 'getOwnerVaults', args: [ownerAddress] },
      factoryV2 && { address: factoryV2, abi: AegisVaultFactoryABI, functionName: 'getOwnerVaults', args: [ownerAddress] },
      factoryV1 && { address: factoryV1, abi: AegisVaultFactoryABI, functionName: 'getOwnerVaults', args: [ownerAddress] },
    ].filter(Boolean),
    query: { enabled: !!ownerAddress && !!(factoryV4 || factoryV3 || factoryV2 || factoryV1), refetchInterval: 30000 },
  });

  // Stitch addresses from each factory back to a version label.
  // Index advances only for present factories so the position math is robust
  // when some factory addresses are empty (typical mid-rollout state).
  const versionedAddrs = [];
  let idx = 0;
  if (factoryV4) {
    if (ownerListsRaw?.[idx]?.result) {
      for (const addr of ownerListsRaw[idx].result) versionedAddrs.push({ addr, version: 'v4' });
    }
    idx++;
  }
  if (factoryV3) {
    if (ownerListsRaw?.[idx]?.result) {
      for (const addr of ownerListsRaw[idx].result) versionedAddrs.push({ addr, version: 'v3' });
    }
    idx++;
  }
  if (factoryV2) {
    if (ownerListsRaw?.[idx]?.result) {
      for (const addr of ownerListsRaw[idx].result) versionedAddrs.push({ addr, version: 'v2' });
    }
    idx++;
  }
  if (factoryV1) {
    if (ownerListsRaw?.[idx]?.result) {
      for (const addr of ownerListsRaw[idx].result) versionedAddrs.push({ addr, version: 'v1' });
    }
  }
  // De-dupe in case a vault somehow shows up under multiple factories.
  const seen = new Set();
  const dedupedVersionedAddrs = versionedAddrs.filter(({ addr }) => {
    const key = (addr || '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const vaultAddrs = dedupedVersionedAddrs.map((v) => v.addr);
  const vaultVersions = dedupedVersionedAddrs.map((v) => v.version);

  // Step 2: batch-read getVaultSummary for each vault. AegisVault V1, V2,
  // and V3 all expose getVaultSummary with the same ABI shape; safe to
  // re-use the V1 ABI here for the summary read regardless of version.
  const summaryContracts = vaultAddrs.map((addr) => ({
    address: addr,
    abi: AegisVaultABI,
    functionName: 'getVaultSummary',
  }));

  const { data: summaries, isLoading: summariesLoading } = useReadContracts({
    contracts: summaryContracts,
    query: { enabled: vaultAddrs.length > 0, refetchInterval: 15000 },
  });

  const vaults = vaultAddrs.map((addr, i) => {
    const raw = summaries?.[i]?.result;
    const version = vaultVersions[i] || 'v1';
    if (!raw) {
      return { address: addr, loaded: false, version };
    }
    const [owner, executor, baseAsset, balance, totalDeposited, lastExecution, dailyActions, paused, autoExecution] = raw;
    return {
      address: addr,
      loaded: true,
      version,
      owner,
      executor,
      baseAsset,
      // NOTE: hardcoded 6 — caller should resolve actual decimals if base
      // asset isn't USDC. Use balanceRaw + useTokenDecimals to format correctly.
      balance: formatUnits(balance, 6),
      balanceRaw: balance,
      totalDeposited: formatUnits(totalDeposited, 6),
      totalDepositedRaw: totalDeposited,
      lastExecution: Number(lastExecution),
      dailyActions: Number(dailyActions),
      paused,
      autoExecution,
    };
  });

  return {
    vaults,
    isLoading: addrsLoading || summariesLoading,
    count: vaultAddrs.length,
  };
}

// ── Read: ALL Platform Vaults (from factory.allVaults) ──
//
// Multi-factory: mirror useVaultList — sum totals across V4 + V3 + V2
// (+ V1 when chain has no later generation) so platform stats reflect
// every vault that can be interacted with through the app. Audit found
// that omitting V4 here would undercount the "All Platform Vaults"
// dashboard once the V4 factory is deployed; we verified parity with
// useVaultList's iteration shape and added V4 first in priority.

export function useAllPlatformVaults(factoryAddress) {
  const chainIdLocal = useChainId();
  const deploymentsLocal = getDeployments(chainIdLocal);
  const factoryV4 = deploymentsLocal.aegisVaultFactoryV4 || '';
  const factoryV3 = deploymentsLocal.aegisVaultFactoryV3 || '';
  const factoryV2 = deploymentsLocal.aegisVaultFactoryV2 || '';
  const factoryV1 = (factoryAddress && factoryAddress !== factoryV4
                                    && factoryAddress !== factoryV3
                                    && factoryAddress !== factoryV2)
    ? factoryAddress
    : '';

  // Step 1: per-factory totalVaults() count. All four generations expose
  // the same `totalVaults()` read shape, so AegisVaultFactoryABI is safe
  // for the V4 read here as well — V4-specific ABI is only required for
  // the createVault write path.
  const { data: totalsRaw, isLoading: countLoading } = useReadContracts({
    contracts: [
      factoryV4 && { address: factoryV4, abi: AegisVaultFactoryABI, functionName: 'totalVaults' },
      factoryV3 && { address: factoryV3, abi: AegisVaultFactoryABI, functionName: 'totalVaults' },
      factoryV2 && { address: factoryV2, abi: AegisVaultFactoryABI, functionName: 'totalVaults' },
      factoryV1 && { address: factoryV1, abi: AegisVaultFactoryABI, functionName: 'totalVaults' },
    ].filter(Boolean),
    query: { enabled: !!(factoryV4 || factoryV3 || factoryV2 || factoryV1), refetchInterval: 30000 },
  });

  const factoryTotals = [];
  let i = 0;
  if (factoryV4) factoryTotals.push({ factory: factoryV4, total: Number(totalsRaw?.[i++]?.result || 0n) });
  if (factoryV3) factoryTotals.push({ factory: factoryV3, total: Number(totalsRaw?.[i++]?.result || 0n) });
  if (factoryV2) factoryTotals.push({ factory: factoryV2, total: Number(totalsRaw?.[i++]?.result || 0n) });
  if (factoryV1) factoryTotals.push({ factory: factoryV1, total: Number(totalsRaw?.[i++]?.result || 0n) });

  // Step 2: build flat (factory, index) tuples and batch-read getVaultAt.
  const indexContracts = factoryTotals.flatMap((ft) =>
    Array.from({ length: ft.total }, (_, idx) => ({
      address: ft.factory,
      abi: AegisVaultFactoryABI,
      functionName: 'getVaultAt',
      args: [BigInt(idx)],
    }))
  );
  const grandTotal = factoryTotals.reduce((acc, ft) => acc + ft.total, 0);

  const { data: addrResults, isLoading: addrsLoading } = useReadContracts({
    contracts: indexContracts,
    query: { enabled: indexContracts.length > 0, refetchInterval: 30000 },
  });

  const allAddrs = addrResults ? addrResults.map((r) => r.result).filter(Boolean) : [];

  // Step 3: batch-read summaries (ABI shape consistent across versions).
  const summaryContracts = allAddrs.map((addr) => ({
    address: addr,
    abi: AegisVaultABI,
    functionName: 'getVaultSummary',
  }));

  const { data: summaries, isLoading: summariesLoading } = useReadContracts({
    contracts: summaryContracts,
    query: { enabled: allAddrs.length > 0, refetchInterval: 15000 },
  });

  const vaults = allAddrs.map((addr, idx) => {
    const raw = summaries?.[idx]?.result;
    if (!raw) return { address: addr, loaded: false };
    const [owner, executor, baseAsset, balance, totalDeposited, lastExecution, dailyActions, paused, autoExecution] = raw;
    return {
      address: addr,
      loaded: true,
      owner,
      executor,
      baseAsset,
      balance: formatUnits(balance, 6),
      balanceRaw: balance,
      totalDeposited: formatUnits(totalDeposited, 6),
      totalDepositedRaw: totalDeposited,
      lastExecution: Number(lastExecution),
      dailyActions: Number(dailyActions),
      paused,
      autoExecution,
    };
  });

  return {
    vaults,
    isLoading: countLoading || addrsLoading || summariesLoading,
    total: grandTotal,
  };
}

// ── Write: Deposit ──

export function useDeposit() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const deposit = (vaultAddress, amount, decimals = 6) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVaultABI,
      functionName: 'deposit',
      args: [parseUnits(amount.toString(), decimals)],
    });
  };

  return { deposit, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: Approve Token ──

export function useApprove() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const approve = (tokenAddress, spender, amount, decimals = 6) => {
    writeContract({
      address: tokenAddress,
      abi: MockERC20ABI,
      functionName: 'approve',
      args: [spender, parseUnits(amount.toString(), decimals)],
    });
  };

  return { approve, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: Withdraw ──

export function useWithdraw() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const withdraw = (vaultAddress, amount, decimals = 6) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVaultABI,
      functionName: 'withdraw',
      args: [parseUnits(amount.toString(), decimals)],
    });
  };

  return { withdraw, hash, isPending, isConfirming, isSuccess, error };
}

// ── v2 rescue path ──
//
// Minimal ABI stub for just the v2-specific functions so we don't need to
// import a separate AegisVault_v2.json artifact. Signatures are fixed and
// tested in V2Rescue.test.js.
const AEGIS_VAULT_V2_ABI = [
  { type: 'function', name: 'withdrawToken',      stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'withdrawAllNonBase', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'version',            stateMutability: 'pure',       inputs: [], outputs: [{ type: 'string' }] },
];

/**
 * Rescue a single non-base ERC-20 from a v2 vault to its owner. Reverts on
 * v1 vaults (function doesn't exist) — callers should gate on vault.version.
 */
export function useWithdrawToken() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const withdrawToken = (vaultAddress, tokenAddress, amount, decimals = 18) => {
    writeContract({
      address: vaultAddress,
      abi: AEGIS_VAULT_V2_ABI,
      functionName: 'withdrawToken',
      args: [tokenAddress, parseUnits(amount.toString(), decimals)],
    });
  };

  return { withdrawToken, hash, isPending, isConfirming, isSuccess, error };
}

/**
 * Drain all allowed non-base assets from a v2 vault in one tx. Bounded by
 * MAX_ALLOWED_ASSETS (10) on-chain.
 */
export function useWithdrawAllNonBase() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const withdrawAllNonBase = (vaultAddress) => {
    writeContract({
      address: vaultAddress,
      abi: AEGIS_VAULT_V2_ABI,
      functionName: 'withdrawAllNonBase',
      args: [],
    });
  };

  return { withdrawAllNonBase, hash, isPending, isConfirming, isSuccess, error };
}

/**
 * Probe vault.version() on-chain. Returns 'v4' / 'v3' / 'v2' / 'v1'. V1
 * vaults don't have a version() function — the call reverts and we default
 * to 'v1'. Non-blocking: while the read is in flight we assume v1 so the
 * UI stays conservative.
 */
export function useVaultVersion(vaultAddress) {
  const { data, isLoading } = useReadContract({
    address: vaultAddress,
    abi: AEGIS_VAULT_V2_ABI,
    functionName: 'version',
    query: { enabled: !!vaultAddress, retry: false },
  });
  const version =
    data === 'v4' ? 'v4'
    : data === 'v3' ? 'v3'
    : data === 'v2' ? 'v2'
    : 'v1';
  return { version, isLoading };
}

/**
 * V2, V3, and V4 vaults expose `withdrawToken` + `withdrawAllNonBase` —
 * the multi-asset rescue surface that lets users withdraw any allowed
 * asset the vault holds, not just the base asset. V1 vaults are base-only.
 */
export function vaultSupportsMultiAssetWithdraw(vaultVersion) {
  return vaultVersion === 'v2' || vaultVersion === 'v3' || vaultVersion === 'v4';
}

// ── V4 manifest binding & upgrade flow ──
//
// V4 vaults bind an `acceptedManifestHash` at create time. When the operator
// publishes a new strategy, the vault owner must approve it through a
// 24-hour timelock:
//
//   1. requestManifestUpgrade(newHash) — queues a pending hash
//   2. (wait MANIFEST_UPGRADE_TIMELOCK = 24h)
//   3. applyManifestUpgrade()         — promotes pending → accepted
//
// Owner can also cancelManifestUpgrade() at any time before apply.
//
// These hooks are V4-only. Calling them on a V3 vault would revert
// (function not found) — gate on `useVaultVersion(vault).version === 'v4'`.

const ZERO_HASH_FRONT = '0x' + '0'.repeat(64);

/**
 * Read all V4 manifest-binding state in one batch:
 *   - acceptedManifestHash      → currently active commitment
 *   - pendingManifestHash       → hash queued by requestManifestUpgrade (zero if none)
 *   - manifestUpgradeRequestedAt → unix timestamp the upgrade was queued
 *
 * Returns `null` for fields when the vault isn't V4 or the read is still
 * loading — caller should branch on `isLoading` + `hasManifestSupport`.
 */
export function useVaultManifestHash(vaultAddress, opts = {}) {
  const { enabled = true } = opts;

  const reads = useReadContracts({
    contracts: vaultAddress ? [
      { address: vaultAddress, abi: AegisVault_v4ABI, functionName: 'acceptedManifestHash' },
      { address: vaultAddress, abi: AegisVault_v4ABI, functionName: 'pendingManifestHash' },
      { address: vaultAddress, abi: AegisVault_v4ABI, functionName: 'manifestUpgradeRequestedAt' },
    ] : [],
    query: { enabled: !!vaultAddress && enabled, retry: false },
  });

  const data = reads.data || [];
  // wagmi returns each read as { result, status } — propagate undefined when
  // the call reverted (V3 vault without the V4 surface).
  const acceptedManifestHash = data[0]?.result ?? null;
  const pendingManifestHash = data[1]?.result ?? null;
  const requestedAtRaw = data[2]?.result;
  const manifestUpgradeRequestedAt = requestedAtRaw != null
    ? Number(requestedAtRaw)
    : 0;

  // True only if all three reads succeeded — i.e. this really is a V4 vault.
  const hasManifestSupport =
    !!acceptedManifestHash && data[0]?.status === 'success';

  // 24-hour timelock from the contract constant (MANIFEST_UPGRADE_TIMELOCK).
  const TIMELOCK_SECONDS = 24 * 3600;
  const hasPendingUpgrade =
    !!pendingManifestHash &&
    pendingManifestHash.toLowerCase() !== ZERO_HASH_FRONT;
  const readyAt = hasPendingUpgrade
    ? manifestUpgradeRequestedAt + TIMELOCK_SECONDS
    : 0;

  return {
    acceptedManifestHash,
    pendingManifestHash,
    manifestUpgradeRequestedAt,
    hasManifestSupport,
    hasPendingUpgrade,
    readyAt,
    isLoading: reads.isLoading,
    refetch: reads.refetch,
  };
}

/**
 * Compare a vault's accepted hash against the operator's currently published
 * hash. Returns a small status object that the UI can render directly:
 *
 *   { match: true }                                — hashes equal (incl. case)
 *   { match: false, reason: 'unbound' }            — vault accepts zero hash
 *   { match: false, reason: 'no-operator-manifest'} — operator hasn't published
 *   { match: false, reason: 'drift' }              — both set but differ
 */
export function diffVaultOperatorManifest(vaultAcceptedHash, operatorPublishedHash) {
  const accepted = vaultAcceptedHash ? vaultAcceptedHash.toLowerCase() : null;
  const published = operatorPublishedHash ? operatorPublishedHash.toLowerCase() : null;

  const acceptedZero = !accepted || accepted === ZERO_HASH_FRONT;
  const publishedZero = !published || published === ZERO_HASH_FRONT;

  if (!acceptedZero && !publishedZero && accepted === published) return { match: true };
  if (acceptedZero && publishedZero) return { match: true, reason: 'both-unbound' };
  if (acceptedZero) return { match: false, reason: 'unbound' };
  if (publishedZero) return { match: false, reason: 'no-operator-manifest' };
  return { match: false, reason: 'drift' };
}

/**
 * Vault owner: queue a manifest upgrade. Subject to the contract's
 * `MANIFEST_UPGRADE_TIMELOCK` (24h) before `applyManifestUpgrade` can promote
 * the queued hash.
 */
export function useRequestManifestUpgrade() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const requestManifestUpgrade = (vaultAddress, newHash) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVault_v4ABI,
      functionName: 'requestManifestUpgrade',
      args: [newHash],
    });
  };

  return { requestManifestUpgrade, hash, isPending, isConfirming, isSuccess, error };
}

/**
 * Vault owner: promote `pendingManifestHash` to `acceptedManifestHash`.
 * Reverts with `ManifestTimelockActive` if called before the 24h window
 * elapses, or `NoPendingManifestUpgrade` if no upgrade is queued.
 */
export function useApplyManifestUpgrade() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const applyManifestUpgrade = (vaultAddress) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVault_v4ABI,
      functionName: 'applyManifestUpgrade',
      args: [],
    });
  };

  return { applyManifestUpgrade, hash, isPending, isConfirming, isSuccess, error };
}

/**
 * Vault owner: discard a queued manifest upgrade before it's applied.
 * Useful when the owner queued the wrong hash or the operator rolled back.
 */
export function useCancelManifestUpgrade() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const cancelManifestUpgrade = (vaultAddress) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVault_v4ABI,
      functionName: 'cancelManifestUpgrade',
      args: [],
    });
  };

  return { cancelManifestUpgrade, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: Pause / Unpause ── (full-vault only)

export function usePause() {
  const stub = unsupportedWriteHook();
  return { pause: stub._call, ...stub };
}

export function useUnpause() {
  const stub = unsupportedWriteHook();
  return { unpause: stub._call, ...stub };
}

// ── Write: Create Vault via Factory ──

export function useCreateVault() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  const chainId = useChainId();
  const deployments = getDeployments(chainId);

  // Cutover priority: V4 factory > V3 factory > V2 factory > V1 factory.
  //   V4 binds an `acceptedManifestHash` at create + adds strategyHash /
  //     strategySchemaVer to the EIP-712 ExecutionIntent typehash. The UI
  //     should pass `acceptedManifestHash` derived from the selected
  //     operator's currently-published manifest (zero hash = "no strategy
  //     binding required" backwards-compat mode).
  //   V3 unlocks Khalani cross-chain fills (acceptCrossChainFill) and seals
  //     maxCrossChainFeeBps at vault creation.
  //   V2 added rescueToken / withdrawAllNonBase.
  //   V1 is the original on-chain swap-only stack.
  const useV4 = !!deployments.aegisVaultFactoryV4;
  const useV3 = !useV4 && !!deployments.aegisVaultFactoryV3;
  const activeFactory =
    deployments.aegisVaultFactoryV4
    || deployments.aegisVaultFactoryV3
    || deployments.aegisVaultFactoryV2
    || deployments.aegisVaultFactory;
  const activeFactoryAbi = useV4
    ? AegisVaultFactoryV4ABI
    : useV3 ? AegisVaultFactoryV3ABI : AegisVaultFactoryABI;

  // V4 factory signature (7 args):
  //   createVault(operator, baseAsset, venue, policy, allowedAssets, maxCrossChainFeeBps, acceptedManifestHash)
  // V3 factory signature (6 args):
  //   createVault(operator, baseAsset, venue, policy, allowedAssets, maxCrossChainFeeBps)
  // V1/V2 factory signature (5 args):
  //   createVault(baseAsset, executor, venue, policy, allowedAssets)
  //
  // Wrapper signature is forward-compatible: callers pass
  // `maxCrossChainFeeBps` (0-200) and `acceptedManifestHash` (bytes32 hex).
  // Both are ignored on legacy factories. acceptedManifestHash defaults to
  // ZeroHash = "no strategy binding" mode.
  const createVault = (
    baseAsset,
    executor,
    venue,
    policy,
    allowedAssets,
    maxCrossChainFeeBps,
    acceptedManifestHash,
  ) => {
    const cap = Number.isFinite(maxCrossChainFeeBps) ? Number(maxCrossChainFeeBps) : 50;
    const manifestHash = (typeof acceptedManifestHash === 'string'
      && acceptedManifestHash.startsWith('0x')
      && acceptedManifestHash.length === 66)
      ? acceptedManifestHash
      : '0x0000000000000000000000000000000000000000000000000000000000000000';

    if (useV4) {
      writeContract({
        address: activeFactory,
        abi: activeFactoryAbi,
        functionName: 'createVault',
        // V4: operator, baseAsset, venue, policy, allowedAssets, maxCrossChainFeeBps, acceptedManifestHash
        args: [executor, baseAsset, venue, policy, allowedAssets, cap, manifestHash],
      });
      return;
    }
    if (useV3) {
      writeContract({
        address: activeFactory,
        abi: activeFactoryAbi,
        functionName: 'createVault',
        // V3: operator first, baseAsset second
        args: [executor, baseAsset, venue, policy, allowedAssets, cap],
      });
      return;
    }
    writeContract({
      address: activeFactory,
      abi: activeFactoryAbi,
      functionName: 'createVault',
      args: [baseAsset, executor, venue, policy, allowedAssets],
    });
  };

  // Decode deployed vault address(es) from VaultDeployed events in receipt logs.
  // We only consider logs emitted by our known factory address — defense against
  // a malicious contract injecting a same-named event into the same tx.
  // For batched deploys we keep all addresses but expose the LAST one as the
  // primary `deployedVaultAddress` (most recent = the one the user just made).
  const factoryAddr = activeFactory?.toLowerCase();
  const deployedVaultAddresses = [];
  if (receipt?.logs) {
    for (const log of receipt.logs) {
      if (factoryAddr && log.address?.toLowerCase() !== factoryAddr) continue;
      try {
        const decoded = decodeEventLog({ abi: activeFactoryAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === 'VaultDeployed' && decoded.args?.vault) {
          deployedVaultAddresses.push(decoded.args.vault);
        }
      } catch { /* not a factory event */ }
    }
  }
  const deployedVaultAddress = deployedVaultAddresses[deployedVaultAddresses.length - 1] || null;

  return {
    createVault,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
    deployedVaultAddress,
    deployedVaultAddresses,
  };
}

// ── Write: Update Policy / Set Executor / Set Reputation Recorder ── (full-vault only)

export function useUpdatePolicy() {
  const stub = unsupportedWriteHook();
  return { updatePolicy: stub._call, ...stub };
}

export function useSetExecutor() {
  const stub = unsupportedWriteHook();
  return { setExecutor: stub._call, ...stub };
}

export function useSetReputationRecorder() {
  const stub = unsupportedWriteHook();
  return { setRecorder: stub._call, ...stub };
}

// ── Read: Vault's reputation recorder address ──

export function useReputationRecorder(vaultAddress) {
  return useReadContract({
    address: vaultAddress,
    abi: AegisVaultABI,
    functionName: 'reputationRecorder',
    query: { enabled: !!vaultAddress, refetchInterval: 30000 },
  });
}
