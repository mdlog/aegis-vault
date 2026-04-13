import { ethers } from 'ethers';
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

const ABIs = {
  AegisVault: loadABI('AegisVault'),
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
    _signer = new ethers.Wallet(config.privateKey, getProvider());
  }
  return _signer;
}

// Contract instances
export function getVaultContract(address) {
  return new ethers.Contract(address || config.contracts.vault, ABIs.AegisVault, getSigner());
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

// Track 2: commit hash binds intent + attestation. Used for sealed-mode commit-reveal.
export function computeCommitHash(intentHash, attestationReportHash) {
  return ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'bytes32'], [intentHash, attestationReportHash])
  );
}

export { ABIs };
