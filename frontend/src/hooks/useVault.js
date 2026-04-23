import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { parseUnits, formatUnits, decodeEventLog } from 'viem';
import { toast } from 'sonner';
import { AegisVaultABI, AegisVaultFactoryABI, MockERC20ABI, getDeployments } from '../lib/contracts.js';

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

export function useVaultList(factoryAddress, ownerAddress) {
  // v2-only policy: on chains where factoryV2 is deployed, ONLY query v2.
  // Vault v1 instances exist on-chain but are hidden from the dashboard —
  // their funds are accessible only by navigating directly to
  // /app/vault/<v1-address>. On chains that don't have v2 yet (Arbitrum,
  // hardhat, older testnets), fall back to v1 so the app still works.
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const factoryV2 = deployments.aegisVaultFactoryV2;
  const activeFactory = factoryV2 || factoryAddress;
  const activeVersion = factoryV2 ? 'v2' : 'v1';

  const { data: addrsResult, isLoading: addrsLoading } = useReadContract({
    address: activeFactory,
    abi: AegisVaultFactoryABI,
    functionName: 'getOwnerVaults',
    args: [ownerAddress],
    query: { enabled: !!activeFactory && !!ownerAddress, refetchInterval: 30000 },
  });

  const vaultAddrs = addrsResult || [];
  const vaultVersions = vaultAddrs.map(() => activeVersion);

  // Step 2: batch-read getVaultSummary for each vault
  const summaryContracts = vaultAddrs.map((addr) => ({
    address: addr,
    abi: AegisVaultABI,
    functionName: 'getVaultSummary',
  }));

  const { data: summaries, isLoading: summariesLoading } = useReadContracts({
    contracts: summaryContracts,
    query: { enabled: vaultAddrs.length > 0, refetchInterval: 15000 },
  });

  // Step 3: merge into a usable list
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
// v2-only policy: mirror the same rule as useVaultList — when a v2 factory
// exists on the current chain, we read from it and ignore the v1 factory
// the caller passed. Keeps platform-wide lists consistent with per-owner
// lists (no v1 vaults surfacing in marketplace / dashboard / stats).

export function useAllPlatformVaults(factoryAddress) {
  const chainIdLocal = useChainId();
  const deploymentsLocal = getDeployments(chainIdLocal);
  const activeFactory = deploymentsLocal.aegisVaultFactoryV2 || factoryAddress;

  // Step 1: get total vault count
  const { data: totalRaw, isLoading: countLoading } = useReadContract({
    address: activeFactory,
    abi: AegisVaultFactoryABI,
    functionName: 'totalVaults',
    query: { enabled: !!activeFactory, refetchInterval: 30000 },
  });

  const total = totalRaw ? Number(totalRaw) : 0;

  // Step 2: batch-read getVaultAt(i) for each index
  const indexContracts = Array.from({ length: total }, (_, i) => ({
    address: activeFactory,
    abi: AegisVaultFactoryABI,
    functionName: 'getVaultAt',
    args: [BigInt(i)],
  }));

  const { data: addrResults, isLoading: addrsLoading } = useReadContracts({
    contracts: indexContracts,
    query: { enabled: total > 0, refetchInterval: 30000 },
  });

  const allAddrs = addrResults
    ? addrResults.map(r => r.result).filter(Boolean)
    : [];

  // Step 3: batch-read getVaultSummary for each vault
  const summaryContracts = allAddrs.map((addr) => ({
    address: addr,
    abi: AegisVaultABI,
    functionName: 'getVaultSummary',
  }));

  const { data: summaries, isLoading: summariesLoading } = useReadContracts({
    contracts: summaryContracts,
    query: { enabled: allAddrs.length > 0, refetchInterval: 15000 },
  });

  const vaults = allAddrs.map((addr, i) => {
    const raw = summaries?.[i]?.result;
    if (!raw) return { address: addr, loaded: false };
    const [owner, executor, baseAsset, balance, totalDeposited, lastExecution, dailyActions, paused, autoExecution] = raw;
    return {
      address: addr,
      loaded: true,
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
    isLoading: countLoading || addrsLoading || summariesLoading,
    total,
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
 * Probe vault.version() on-chain. Returns 'v2' for v2 vaults, 'v1' (default)
 * otherwise. Non-blocking: while the read is in flight we assume v1 so the
 * UI stays conservative.
 */
export function useVaultVersion(vaultAddress) {
  const { data, isLoading } = useReadContract({
    address: vaultAddress,
    abi: AEGIS_VAULT_V2_ABI,
    functionName: 'version',
    query: { enabled: !!vaultAddress, retry: false },
  });
  // v1 vaults don't have version() — call reverts, data stays undefined.
  return { version: data === 'v2' ? 'v2' : 'v1', isLoading };
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

  // Cutover: new vaults always go to factoryV2 when it's deployed on this
  // chain (gets rescueToken / withdrawAllNonBase support). Falls back to v1
  // factory on chains where v2 hasn't shipped (Arbitrum execution layer,
  // local hardhat, etc).
  const activeFactory = deployments.aegisVaultFactoryV2 || deployments.aegisVaultFactory;

  const createVault = (baseAsset, executor, venue, policy, allowedAssets) => {
    writeContract({
      address: activeFactory,
      abi: AegisVaultFactoryABI,
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
        const decoded = decodeEventLog({ abi: AegisVaultFactoryABI, data: log.data, topics: log.topics });
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
