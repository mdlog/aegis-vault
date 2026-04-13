import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { AegisVaultABI, AegisVaultFactoryABI, MockERC20ABI, getDeployments } from '../lib/contracts.js';

// ── Read Vault Summary ──

export function useVaultSummary(vaultAddress) {
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
      balance: formatUnits(balance, 6),
      balanceRaw: balance,
      totalDeposited: formatUnits(totalDeposited, 6),
      lastExecution: Number(lastExecution),
      dailyActions: Number(dailyActions),
      paused,
      autoExecution,
    },
    isLoading,
    error,
    refetch,
  };
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
  // Step 1: get vault addresses from factory
  const { data: vaultAddrsResult, isLoading: addrsLoading } = useReadContract({
    address: factoryAddress,
    abi: AegisVaultFactoryABI,
    functionName: 'getOwnerVaults',
    args: [ownerAddress],
    query: { enabled: !!factoryAddress && !!ownerAddress, refetchInterval: 30000 },
  });

  const vaultAddrs = vaultAddrsResult || [];

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
    if (!raw) {
      return { address: addr, loaded: false };
    }
    const [owner, executor, baseAsset, balance, totalDeposited, lastExecution, dailyActions, paused, autoExecution] = raw;
    return {
      address: addr,
      loaded: true,
      owner,
      executor,
      baseAsset,
      balance: formatUnits(balance, 6),
      totalDeposited: formatUnits(totalDeposited, 6),
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

export function useAllPlatformVaults(factoryAddress) {
  // Step 1: get total vault count
  const { data: totalRaw, isLoading: countLoading } = useReadContract({
    address: factoryAddress,
    abi: AegisVaultFactoryABI,
    functionName: 'totalVaults',
    query: { enabled: !!factoryAddress, refetchInterval: 30000 },
  });

  const total = totalRaw ? Number(totalRaw) : 0;

  // Step 2: batch-read getVaultAt(i) for each index
  const indexContracts = Array.from({ length: total }, (_, i) => ({
    address: factoryAddress,
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
      balance: formatUnits(balance, 6),
      totalDeposited: formatUnits(totalDeposited, 6),
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

// ── Write: Pause / Unpause ──

export function usePause() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const pause = (vaultAddress) => {
    writeContract({ address: vaultAddress, abi: AegisVaultABI, functionName: 'pause' });
  };

  return { pause, hash, isPending, isConfirming, isSuccess, error };
}

export function useUnpause() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const unpause = (vaultAddress) => {
    writeContract({ address: vaultAddress, abi: AegisVaultABI, functionName: 'unpause' });
  };

  return { unpause, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: Create Vault via Factory ──

export function useCreateVault() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const chainId = useChainId();
  const deployments = getDeployments(chainId);

  const createVault = (baseAsset, executor, venue, policy, allowedAssets) => {
    writeContract({
      address: deployments.aegisVaultFactory,
      abi: AegisVaultFactoryABI,
      functionName: 'createVault',
      args: [baseAsset, executor, venue, policy, allowedAssets],
    });
  };

  return { createVault, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: Update Policy ──

export function useUpdatePolicy() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const updatePolicy = (vaultAddress, policy) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVaultABI,
      functionName: 'updatePolicy',
      args: [policy],
    });
  };

  return { updatePolicy, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: Set Executor ──

export function useSetExecutor() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const setExecutor = (vaultAddress, executorAddress) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVaultABI,
      functionName: 'setExecutor',
      args: [executorAddress],
    });
  };

  return { setExecutor, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: Set Reputation Recorder (Phase 5) ──

export function useSetReputationRecorder() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const setRecorder = (vaultAddress, recorderAddress) => {
    writeContract({
      address: vaultAddress,
      abi: AegisVaultABI,
      functionName: 'setReputationRecorder',
      args: [recorderAddress],
    });
  };

  return { setRecorder, hash, isPending, isConfirming, isSuccess, error };
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
