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

// Utility: compute intent hash (mirrors on-chain logic — uses abi.encode per C-3/H-1 fix)
export function computeIntentHash(intent) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
      [
        intent.vault,
        intent.assetIn,
        intent.assetOut,
        intent.amountIn,
        intent.minAmountOut,
        intent.createdAt,
        intent.expiresAt,
        intent.confidenceBps,
        intent.riskScoreBps,
      ]
    )
  );
}

export { ABIs };
