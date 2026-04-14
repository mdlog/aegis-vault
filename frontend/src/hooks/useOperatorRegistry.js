import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { OperatorRegistryABI } from '../lib/contracts.js';

// Mandate enum mapping
export const Mandate = {
  Conservative: 0,
  Balanced: 1,
  Tactical: 2,
};

export const MandateLabel = {
  0: 'Conservative',
  1: 'Balanced',
  2: 'Tactical',
};

// ── Read: total operators count ──
export function useTotalOperators(registryAddress) {
  return useReadContract({
    address: registryAddress,
    abi: OperatorRegistryABI,
    functionName: 'totalOperators',
    query: { enabled: !!registryAddress, refetchInterval: 30000 },
  });
}

// ── Read: list of all operator wallet addresses ──
export function useAllOperators(registryAddress) {
  return useReadContract({
    address: registryAddress,
    abi: OperatorRegistryABI,
    functionName: 'getAllOperators',
    query: { enabled: !!registryAddress, refetchInterval: 30000 },
  });
}

// ── Read: a single operator's metadata ──
export function useOperator(registryAddress, walletAddress) {
  return useReadContract({
    address: registryAddress,
    abi: OperatorRegistryABI,
    functionName: 'getOperator',
    args: [walletAddress],
    query: { enabled: !!registryAddress && !!walletAddress, refetchInterval: 30000 },
  });
}

// ── Read: is wallet registered? ──
export function useIsRegistered(registryAddress, walletAddress) {
  return useReadContract({
    address: registryAddress,
    abi: OperatorRegistryABI,
    functionName: 'isRegistered',
    args: [walletAddress],
    query: { enabled: !!registryAddress && !!walletAddress, refetchInterval: 15000 },
  });
}

// ── Read: full operator list with metadata (paginated) ──
export function useOperatorList(registryAddress) {
  // Step 1: get all wallet addresses
  const { data: addresses } = useAllOperators(registryAddress);
  const list = addresses || [];

  // Step 2: batch-read metadata for each operator
  const contracts = list.map((addr) => ({
    address: registryAddress,
    abi: OperatorRegistryABI,
    functionName: 'getOperator',
    args: [addr],
  }));

  const { data: results, isLoading } = useReadContracts({
    contracts,
    query: { enabled: list.length > 0 && !!registryAddress, refetchInterval: 30000 },
  });

  const operators = list.map((addr, i) => {
    const result = results?.[i]?.result;
    if (!result) return { wallet: addr, loaded: false };
    return {
      wallet: result.wallet,
      name: result.name,
      description: result.description,
      endpoint: result.endpoint,
      mandate: Number(result.mandate),
      mandateLabel: MandateLabel[Number(result.mandate)],
      registeredAt: Number(result.registeredAt),
      updatedAt: Number(result.updatedAt),
      active: result.active,
      // Phase 1: declared fees
      performanceFeeBps: Number(result.performanceFeeBps || 0),
      managementFeeBps: Number(result.managementFeeBps || 0),
      entryFeeBps: Number(result.entryFeeBps || 0),
      exitFeeBps: Number(result.exitFeeBps || 0),
      // Phase 1: recommended policy
      recommendedMaxPositionBps: Number(result.recommendedMaxPositionBps || 0),
      recommendedConfidenceMinBps: Number(result.recommendedConfidenceMinBps || 0),
      recommendedStopLossBps: Number(result.recommendedStopLossBps || 0),
      recommendedCooldownSeconds: Number(result.recommendedCooldownSeconds || 0),
      recommendedMaxActionsPerDay: Number(result.recommendedMaxActionsPerDay || 0),
      loaded: true,
    };
  });

  return {
    operators,
    count: list.length,
    isLoading,
  };
}

// ── Write: register as operator ──
// Phase 1: takes a full OperatorInput struct with fees + recommended policy
export function useRegisterOperator() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const register = (registryAddress, input) => {
    writeContract({
      address: registryAddress,
      abi: OperatorRegistryABI,
      functionName: 'register',
      args: [
        {
          name: input.name,
          description: input.description,
          endpoint: input.endpoint || '',
          mandate: input.mandate,
          performanceFeeBps: BigInt(input.performanceFeeBps || 0),
          managementFeeBps: BigInt(input.managementFeeBps || 0),
          entryFeeBps: BigInt(input.entryFeeBps || 0),
          exitFeeBps: BigInt(input.exitFeeBps || 0),
          recommendedMaxPositionBps: BigInt(input.recommendedMaxPositionBps || 0),
          recommendedConfidenceMinBps: BigInt(input.recommendedConfidenceMinBps || 0),
          recommendedStopLossBps: BigInt(input.recommendedStopLossBps || 0),
          recommendedCooldownSeconds: BigInt(input.recommendedCooldownSeconds || 0),
          recommendedMaxActionsPerDay: BigInt(input.recommendedMaxActionsPerDay || 0),
        },
      ],
    });
  };

  return { register, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: update operator metadata ──
export function useUpdateOperator() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const update = (registryAddress, input) => {
    writeContract({
      address: registryAddress,
      abi: OperatorRegistryABI,
      functionName: 'updateMetadata',
      args: [
        {
          name: input.name,
          description: input.description,
          endpoint: input.endpoint || '',
          mandate: input.mandate,
          performanceFeeBps: BigInt(input.performanceFeeBps || 0),
          managementFeeBps: BigInt(input.managementFeeBps || 0),
          entryFeeBps: BigInt(input.entryFeeBps || 0),
          exitFeeBps: BigInt(input.exitFeeBps || 0),
          recommendedMaxPositionBps: BigInt(input.recommendedMaxPositionBps || 0),
          recommendedConfidenceMinBps: BigInt(input.recommendedConfidenceMinBps || 0),
          recommendedStopLossBps: BigInt(input.recommendedStopLossBps || 0),
          recommendedCooldownSeconds: BigInt(input.recommendedCooldownSeconds || 0),
          recommendedMaxActionsPerDay: BigInt(input.recommendedMaxActionsPerDay || 0),
        },
      ],
    });
  };

  return { update, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: deactivate ──
export function useDeactivateOperator() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const deactivate = (registryAddress) => {
    writeContract({
      address: registryAddress,
      abi: OperatorRegistryABI,
      functionName: 'deactivate',
    });
  };

  return { deactivate, hash, isPending, isConfirming, isSuccess, error };
}

// ── Write: reactivate ──
export function useActivateOperator() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const activate = (registryAddress) => {
    writeContract({
      address: registryAddress,
      abi: OperatorRegistryABI,
      functionName: 'activate',
    });
  };

  return { activate, hash, isPending, isConfirming, isSuccess, error };
}


// ── Track 2 / v2: Strategy Manifest + AI Model commitment ──

// Read: extended metadata (manifest + AI commitment)
export function useOperatorExtended(registryAddress, walletAddress) {
  return useReadContract({
    address: registryAddress,
    abi: OperatorRegistryABI,
    functionName: "getOperatorExtended",
    args: [walletAddress],
    query: { enabled: !!registryAddress && !!walletAddress, refetchInterval: 60000 },
  });
}

// Write: publish strategy manifest
export function usePublishManifest() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const publish = (registryAddress, { uri, hash: manifestHash, bonded }) => {
    writeContract({
      address: registryAddress,
      abi: OperatorRegistryABI,
      functionName: "publishManifest",
      args: [uri, manifestHash, bonded],
    });
  };

  return { publish, hash, isPending, isConfirming, isSuccess, error };
}

// Write: declare AI model commitment
export function useDeclareAIModel() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const declare = (registryAddress, { aiModel, aiProvider, aiEndpoint }) => {
    writeContract({
      address: registryAddress,
      abi: OperatorRegistryABI,
      functionName: "declareAIModel",
      args: [aiModel, aiProvider, aiEndpoint || ""],
    });
  };

  return { declare, hash, isPending, isConfirming, isSuccess, error };
}



// Read: extended metadata for many operators (batch via useReadContracts)
export function useOperatorExtendedBatch(registryAddress, walletAddresses = []) {
  const contracts = walletAddresses.map((wallet) => ({
    address: registryAddress,
    abi: OperatorRegistryABI,
    functionName: "getOperatorExtended",
    args: [wallet],
  }));
  const { data, isLoading } = useReadContracts({
    contracts,
    query: { enabled: !!registryAddress && walletAddresses.length > 0, refetchInterval: 60000 },
  });
  const byAddress = {};
  if (data) {
    walletAddresses.forEach((w, i) => {
      const r = data[i];
      if (r?.status === "success" && r.result) {
        byAddress[w.toLowerCase()] = r.result;
      }
    });
  }
  return { byAddress, isLoading };
}

