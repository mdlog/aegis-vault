import { ethers, NonceManager } from 'ethers';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import config from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load ABIs
function loadABI(name) {
  const path = resolve(__dirname, `../abi/${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
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

const ABIs = {
  AegisVault: mergeVaultAbi(),
  AegisVaultFactory: loadABI('AegisVaultFactory'),
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

// Contract instances
export function getVaultContract(address) {
  return new ethers.Contract(address || config.contracts.vault, ABIs.AegisVault, getSigner());
}

/**
 * Get a vault contract bound to the wallet pool shard for this vault.
 *
 * Production behavior: vaults are sharded across multiple executor wallets
 * (walletPool) for parallel tx submission without nonce collisions. Executor
 * logic should call this instead of getVaultContract() when submitting txs.
 */
export async function getShardedVaultContract(address) {
  // Lazy-import to avoid circular dependency (walletPool → contracts → walletPool)
  const { walletForVault } = await import('../services/walletPool.js');
  const wallet = walletForVault(address);
  return new ethers.Contract(address, ABIs.AegisVault, wallet);
}

export function getFactoryContract() {
  return new ethers.Contract(config.contracts.vaultFactory, ABIs.AegisVaultFactory, getSigner());
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

// EIP-712 typed data definition matching ExecLib.sol constants
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

export { EXECUTION_INTENT_TYPES };

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

export { CROSS_CHAIN_INTENT_TYPES };

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

// Track 2: commit hash binds intent + attestation. Used for sealed-mode commit-reveal.
export function computeCommitHash(intentHash, attestationReportHash) {
  return ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'bytes32'], [intentHash, attestationReportHash])
  );
}

export { ABIs };
