import { ethers, NonceManager } from 'ethers';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import config from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load ABIs. The Hardhat compile output is sometimes a bare array and
// sometimes a wrapper `{ contractName, abi: [...] }` (the V3 audit redeploy
// emits the latter). Normalize at load so callers always get a bare array —
// otherwise ethers chokes with `abi.filter is not a function`.
function loadABI(name) {
  const path = resolve(__dirname, `../abi/${name}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(raw) ? raw : raw?.abi ?? [];
}

// VaultEvents is an external library — its events are emitted with the vault's
// address but are NOT in the compiled AegisVault ABI. Merge them manually so
// ethers.Interface can parse `IntentExecuted`, `IntentSubmitted`, etc. Without
// this, parseLog() returns undefined and the executor falls back to success=true
// even when the on-chain event reports success=false.
function mergeVaultAbi() {
  const vaultAbi = loadABI('AegisVault');
  const eventsAbi = loadABI('VaultEvents');
  const existing = new Set(
    vaultAbi
      .filter((f) => f.type === 'event')
      .map((f) => `${f.name}(${(f.inputs || []).map((i) => i.type).join(',')})`)
  );
  const merged = [...vaultAbi];
  for (const frag of eventsAbi) {
    if (frag.type !== 'event') continue;
    const sig = `${frag.name}(${(frag.inputs || []).map((i) => i.type).join(',')})`;
    if (!existing.has(sig)) merged.push(frag);
  }
  return merged;
}

// Optional ABI loader — V4 artifacts may not exist in environments that
// haven't compiled the V4 contracts yet (older orchestrator deploys, CI).
// Returns null instead of throwing so the orchestrator stays runnable.
function tryLoadABI(name) {
  try { return loadABI(name); } catch { return null; }
}

const ABIs = {
  AegisVault: mergeVaultAbi(),
  AegisVaultV3: loadABI('AegisVault_v3'),
  // V4 vault adds executeIntent(intent, sig) where intent struct includes
  // strategyHash + strategySchemaVer (different EIP-712 typehash). It also
  // exposes acceptedManifestHash() / requestManifestUpgrade() that V3 lacks.
  // When a vault.version() returns 'v4', readers/writers MUST use this ABI
  // — otherwise the strategy-bound execute path silently calls the V3
  // selector with the wrong calldata layout.
  AegisVaultV4: tryLoadABI('AegisVault_v4'),
  // V3 factory has a wider VaultDeployed event signature
  // (address,address,address,address,address,uint16,uint256) than V1/V2's
  // (address,address,address,address,uint256). Topic hash differs, so the
  // indexer must use the V3 ABI when the configured factory is V3 — otherwise
  // queryFilter('VaultDeployed') returns 0 events for new V3 vaults.
  AegisVaultFactory: loadABI('AegisVaultFactory'),
  AegisVaultFactoryV3: loadABI('AegisVaultFactoryV3'),
  // V4 factory adds 7th createVault arg (acceptedManifestHash) and emits
  // VaultDeployed with 8 args (extra trailing acceptedManifestHash).
  AegisVaultFactoryV4: tryLoadABI('AegisVaultFactoryV4'),
  ExecutionRegistry: loadABI('ExecutionRegistry'),
  MockERC20: loadABI('MockERC20'),
  OperatorRegistry: loadABI('OperatorRegistry'),
  OperatorStaking: loadABI('OperatorStaking'),
  OperatorReputation: loadABI('OperatorReputation'),
};

// Provider & Signer
let _provider = null;
let _signer = null;

export function getProvider() {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(config.rpcUrl);
  }
  return _provider;
}

export function getSigner() {
  if (!_signer) {
    if (!config.privateKey) {
      throw new Error('PRIVATE_KEY not set in environment');
    }
    // Wrap the wallet with NonceManager so concurrent tx submissions
    // (intent submit + 0G Storage Flow.submit + KV Batcher) share a
    // single, locally-incrementing nonce counter. Without this, ethers
    // re-fetches the chain nonce per call — two parallel submissions can
    // both grab nonce N from RPC, the first lands, the second fails with
    // NONCE_EXPIRED. walletPool.js already uses NonceManager for its
    // sharded executors; this aligns getSigner() with the same pattern
    // so single-key setups are race-free too.
    const wallet = new ethers.Wallet(config.privateKey, getProvider());
    _signer = new NonceManager(wallet);
  }
  return _signer;
}

// Resolve the right vault ABI for a given vault generation. Defaults to
// the merged V1/V2/V3 ABI which carries the legacy executeIntent selector
// + shared events (Deposited / Withdrawn / etc are emitted via VaultEvents
// so they parse identically across V1-V4). The V4 ABI is preferred ONLY for
// V4-specific calls (executeIntent, acceptedManifestHash, manifest upgrade
// flow) — pass `version='v4'` to opt in.
function vaultAbiFor(version) {
  if (version === 'v4' && ABIs.AegisVaultV4) return ABIs.AegisVaultV4;
  if (version === 'v3' && ABIs.AegisVaultV3) return ABIs.AegisVaultV3;
  return ABIs.AegisVault;
}

// Contract instances
export function getVaultContract(address, version = null) {
  return new ethers.Contract(
    address || config.contracts.vault,
    vaultAbiFor(version),
    getSigner(),
  );
}

/**
 * Get a vault contract bound to the wallet pool shard for this vault.
 *
 * Production behavior: vaults are sharded across multiple executor wallets
 * (walletPool) for parallel tx submission without nonce collisions. Executor
 * logic should call this instead of getVaultContract() when submitting txs.
 */
export async function getShardedVaultContract(address, version = null) {
  // Lazy-import to avoid circular dependency (walletPool → contracts → walletPool)
  const { walletForVault } = await import('../services/walletPool.js');
  const wallet = walletForVault(address);
  return new ethers.Contract(address, vaultAbiFor(version), wallet);
}

export function getFactoryContract() {
  // V4 factory has the widest VaultDeployed event (8 args incl.
  // acceptedManifestHash) — load V4 ABI when configured factory matches.
  // Falls through V3 → legacy.
  let abi;
  if (config.factoryVersion === 'v4' && ABIs.AegisVaultFactoryV4) {
    abi = ABIs.AegisVaultFactoryV4;
  } else if (config.factoryVersion === 'v3') {
    abi = ABIs.AegisVaultFactoryV3;
  } else {
    abi = ABIs.AegisVaultFactory;
  }
  return new ethers.Contract(config.contracts.vaultFactory, abi, getSigner());
}

export function getRegistryContract() {
  return new ethers.Contract(config.contracts.executionRegistry, ABIs.ExecutionRegistry, getSigner());
}

export function getERC20Contract(address) {
  return new ethers.Contract(address, ABIs.MockERC20, getSigner());
}

export function getOperatorRegistryContract(address) {
  const addr = address || config.contracts.operatorRegistry;
  if (!addr) return null;
  return new ethers.Contract(addr, ABIs.OperatorRegistry, getSigner());
}

export function getOperatorStakingContract(address) {
  const addr = address || config.contracts.operatorStaking;
  if (!addr) return null;
  return new ethers.Contract(addr, ABIs.OperatorStaking, getSigner());
}

export function getOperatorReputationContract(address) {
  const addr = address || config.contracts.operatorReputation;
  if (!addr) return null;
  return new ethers.Contract(addr, ABIs.OperatorReputation, getSigner());
}

// EIP-712 typed data definition matching ExecLib.sol constants (V1/V2/V3 vaults).
const EXECUTION_INTENT_TYPES = {
  ExecutionIntent: [
    { name: 'vault',                 type: 'address' },
    { name: 'assetIn',               type: 'address' },
    { name: 'assetOut',              type: 'address' },
    { name: 'amountIn',              type: 'uint256' },
    { name: 'minAmountOut',          type: 'uint256' },
    { name: 'createdAt',             type: 'uint256' },
    { name: 'expiresAt',             type: 'uint256' },
    { name: 'confidenceBps',         type: 'uint256' },
    { name: 'riskScoreBps',          type: 'uint256' },
    { name: 'attestationReportHash', type: 'bytes32' },
  ],
};

// V4 EIP-712 typed data — adds `strategyHash` + `strategySchemaVer`.
// Mirrors EXECUTION_INTENT_TYPEHASH_V4 in contracts/v4/ExecLibV4.sol.
// Field order MUST stay byte-aligned with the Solidity typehash string.
const EXECUTION_INTENT_TYPES_V4 = {
  ExecutionIntent: [
    { name: 'vault',                 type: 'address' },
    { name: 'assetIn',               type: 'address' },
    { name: 'assetOut',              type: 'address' },
    { name: 'amountIn',              type: 'uint256' },
    { name: 'minAmountOut',          type: 'uint256' },
    { name: 'createdAt',             type: 'uint256' },
    { name: 'expiresAt',             type: 'uint256' },
    { name: 'confidenceBps',         type: 'uint256' },
    { name: 'riskScoreBps',          type: 'uint256' },
    { name: 'attestationReportHash', type: 'bytes32' },
    { name: 'strategyHash',          type: 'bytes32' },
    { name: 'strategySchemaVer',     type: 'uint32'  },
  ],
};

// Utility: compute EIP-712 intent hash (mirrors ExecLib.computeIntentHash on-chain)
export function computeIntentHash(intent) {
  const domain = {
    name: 'AegisVault',
    version: '1',
    chainId: config.chainId,
    verifyingContract: intent.vault,
  };
  const value = {
    vault:                 intent.vault,
    assetIn:               intent.assetIn,
    assetOut:              intent.assetOut,
    amountIn:              intent.amountIn,
    minAmountOut:          intent.minAmountOut,
    createdAt:             intent.createdAt,
    expiresAt:             intent.expiresAt,
    confidenceBps:         intent.confidenceBps,
    riskScoreBps:          intent.riskScoreBps,
    attestationReportHash: intent.attestationReportHash || ethers.ZeroHash,
  };
  return ethers.TypedDataEncoder.hash(domain, EXECUTION_INTENT_TYPES, value);
}

// V4 EIP-712 hash — uses extended typehash with strategyHash + strategySchemaVer.
// Mirrors ExecLibV4.computeIntentHash() byte-for-byte.
export function computeIntentHashV4(intent) {
  const domain = {
    name: 'AegisVault',
    version: '1',
    chainId: config.chainId,
    verifyingContract: intent.vault,
  };
  const value = {
    vault:                 intent.vault,
    assetIn:               intent.assetIn,
    assetOut:              intent.assetOut,
    amountIn:              intent.amountIn,
    minAmountOut:          intent.minAmountOut,
    createdAt:             intent.createdAt,
    expiresAt:             intent.expiresAt,
    confidenceBps:         intent.confidenceBps,
    riskScoreBps:          intent.riskScoreBps,
    attestationReportHash: intent.attestationReportHash || ethers.ZeroHash,
    strategyHash:          intent.strategyHash || ethers.ZeroHash,
    strategySchemaVer:     intent.strategySchemaVer ?? 0,
  };
  return ethers.TypedDataEncoder.hash(domain, EXECUTION_INTENT_TYPES_V4, value);
}

export { EXECUTION_INTENT_TYPES, EXECUTION_INTENT_TYPES_V4 };

// EIP-712 typed data for V3 cross-chain (Khalani) intents — matches
// CrossChainLib.CROSS_CHAIN_INTENT_TYPEHASH in CrossChainLib.sol. Field
// order MUST stay byte-for-byte aligned or signature recovery breaks.
const CROSS_CHAIN_INTENT_TYPES = {
  CrossChainIntent: [
    { name: 'vault',                 type: 'address' },
    { name: 'assetIn',               type: 'address' },
    { name: 'assetOut',              type: 'address' },
    { name: 'amountIn',              type: 'uint256' },
    { name: 'minAmountOut',          type: 'uint256' },
    { name: 'createdAt',             type: 'uint256' },
    { name: 'expiresAt',             type: 'uint256' },
    { name: 'confidenceBps',         type: 'uint16'  },
    { name: 'riskScoreBps',          type: 'uint16'  },
    { name: 'attestationReportHash', type: 'bytes32' },
    { name: 'routeChainId',          type: 'uint64'  },
    { name: 'maxFeeBps',             type: 'uint16'  },
    { name: 'routePolicyHash',       type: 'bytes32' },
    { name: 'khalaniIntentId',       type: 'bytes32' },
    { name: 'prevBalance',           type: 'uint256' },
  ],
};

// V4 cross-chain typed data — mirrors V3 with `strategyHash` +
// `strategySchemaVer` appended. Keep the V3 constant unchanged so the V3
// vaults already on mainnet keep recovering the same TEE signer; V4 vaults
// use the new typehash (different by construction, which intentionally
// prevents a V3 signature from being replayed against a V4 vault).
const CROSS_CHAIN_INTENT_TYPES_V4 = {
  CrossChainIntent: [
    { name: 'vault',                 type: 'address' },
    { name: 'assetIn',               type: 'address' },
    { name: 'assetOut',              type: 'address' },
    { name: 'amountIn',              type: 'uint256' },
    { name: 'minAmountOut',          type: 'uint256' },
    { name: 'createdAt',             type: 'uint256' },
    { name: 'expiresAt',             type: 'uint256' },
    { name: 'confidenceBps',         type: 'uint16'  },
    { name: 'riskScoreBps',          type: 'uint16'  },
    { name: 'attestationReportHash', type: 'bytes32' },
    { name: 'routeChainId',          type: 'uint64'  },
    { name: 'maxFeeBps',             type: 'uint16'  },
    { name: 'routePolicyHash',       type: 'bytes32' },
    { name: 'khalaniIntentId',       type: 'bytes32' },
    { name: 'prevBalance',           type: 'uint256' },
    { name: 'strategyHash',          type: 'bytes32' },
    { name: 'strategySchemaVer',     type: 'uint32'  },
  ],
};

export { CROSS_CHAIN_INTENT_TYPES, CROSS_CHAIN_INTENT_TYPES_V4 };

/// @notice Compute EIP-712 digest for a CrossChainIntent.
///         Domain mirrors ExecutionIntent (`AegisVault` v `1`) so the same
///         attested-signer key is reused across both intent surfaces.
export function computeCrossChainIntentHash(intent, vaultAddr) {
  const domain = {
    name: 'AegisVault',
    version: '1',
    chainId: config.chainId,
    verifyingContract: vaultAddr,
  };
  return ethers.TypedDataEncoder.hash(domain, CROSS_CHAIN_INTENT_TYPES, intent);
}

/// @notice Compute EIP-712 digest for a V4 CrossChainIntent (with strategyHash).
export function computeCrossChainIntentHashV4(intent, vaultAddr) {
  const domain = {
    name: 'AegisVault',
    version: '1',
    chainId: config.chainId,
    verifyingContract: vaultAddr,
  };
  return ethers.TypedDataEncoder.hash(domain, CROSS_CHAIN_INTENT_TYPES_V4, intent);
}

// Track 2: commit hash binds intent + attestation. Used for sealed-mode commit-reveal.
export function computeCommitHash(intentHash, attestationReportHash) {
  return ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'bytes32'], [intentHash, attestationReportHash])
  );
}

export { ABIs };
