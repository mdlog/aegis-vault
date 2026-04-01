import { ethers } from 'ethers';
import config from '../config/index.js';
import { getVaultContract, getRegistryContract, computeIntentHash } from '../config/contracts.js';
import logger from '../utils/logger.js';

/**
 * ExecutorService
 * Builds execution intents from AI decisions and submits them to the vault contract.
 * Also handles recording execution results after off-chain swap.
 */

// Asset symbol → contract address mapping (populated at runtime)
let assetAddresses = {};

export function setAssetAddresses(mapping) {
  assetAddresses = mapping;
}

/**
 * Resolve an asset symbol to its contract address
 */
function resolveAssetAddress(symbol) {
  const addr = assetAddresses[symbol];
  if (!addr) {
    throw new Error(`No address mapping for asset: ${symbol}`);
  }
  return addr;
}

/**
 * Build an ExecutionIntent struct from an AI decision
 * @param {object} decision - AI decision { action, asset, size_bps, confidence, risk_score, reason }
 * @param {object} vaultState - Current vault state
 * @returns {object} ExecutionIntent struct ready for contract call
 */
export function buildExecutionIntent(decision, vaultState) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = 300; // 5 minute TTL

  // Determine assetIn / assetOut based on action
  let assetIn, assetOut, amountIn;

  if (decision.action === 'buy') {
    // Buying: spend base asset (USDC) to get target asset
    assetIn = resolveAssetAddress('USDC');
    assetOut = resolveAssetAddress(decision.asset);
    amountIn = calculateAmountFromBps(decision.size_bps, vaultState.nav, 6); // USDC decimals
  } else if (decision.action === 'sell') {
    // Selling: spend target asset to get base asset (USDC)
    assetIn = resolveAssetAddress(decision.asset);
    assetOut = resolveAssetAddress('USDC');
    // L-3 fix: Use the correct decimals for the asset being sold
    const assetDecimals = config.assets[decision.asset]?.decimals || 18;
    amountIn = calculateAmountFromBps(decision.size_bps, vaultState.nav, assetDecimals);
  } else {
    return null; // hold — no intent needed
  }

  const intent = {
    intentHash: ethers.ZeroHash, // computed below
    vault: vaultState.address,
    assetIn,
    assetOut,
    amountIn,
    minAmountOut: 0n, // Simplified for MVP — in production, use oracle price * slippage
    createdAt: now,
    expiresAt: now + ttl,
    confidenceBps: Math.round(decision.confidence * 10000),
    riskScoreBps: Math.round(decision.risk_score * 10000),
    reasonSummary: decision.reason.substring(0, 200),
  };

  // Compute intent hash
  intent.intentHash = computeIntentHash(intent);

  return intent;
}

/**
 * Calculate token amount from basis points of vault NAV
 */
function calculateAmountFromBps(sizeBps, navUsd, decimals) {
  const amountUsd = (navUsd * sizeBps) / 10000;
  return ethers.parseUnits(amountUsd.toFixed(decimals > 6 ? 6 : decimals), decimals);
}

/**
 * Submit intent to the vault contract
 * @param {object} intent - Built ExecutionIntent
 * @returns {{ success: boolean, txHash?: string, error?: string }}
 */
export async function submitIntent(intent) {
  try {
    const vault = getVaultContract(intent.vault);

    logger.info(`Submitting intent ${intent.intentHash.substring(0, 10)}...`);
    logger.info(`  Action: ${intent.assetIn} → ${intent.assetOut}`);
    logger.info(`  Amount: ${intent.amountIn.toString()}`);
    logger.info(`  Confidence: ${intent.confidenceBps} bps`);

    const tx = await vault.executeIntent(intent);
    const receipt = await tx.wait();

    logger.info(`Intent submitted. TX: ${receipt.hash}`);

    return {
      success: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    };

  } catch (err) {
    // Parse revert reason (L-2 fix: decode all custom errors)
    let reason = err.message;
    if (err.data) {
      try {
        const iface = new ethers.Interface([
          'error PolicyCheckFailed(string)',
          'error IntentHashMismatch()',
          'error IntentVaultMismatch()',
          'error AutoExecutionDisabled()',
          'error SwapOutputMismatch()',
          'error OnlyExecutor()',
          'error VaultPaused()',
        ]);
        const decoded = iface.parseError(err.data);
        reason = decoded.args.length > 0
          ? `${decoded.name}: ${decoded.args[0]}`
          : decoded.name;
      } catch (_) {}
    }

    logger.error(`Intent submission failed: ${reason}`);
    return {
      success: false,
      error: reason,
    };
  }
}

/**
 * Record execution result on-chain after off-chain swap
 * @param {object} result - ExecutionResult struct
 */
export async function recordExecutionResult(intentHash, vaultAddress, amountIn, amountOut, success) {
  try {
    const vault = getVaultContract(vaultAddress);

    const result = {
      intentHash,
      venueTxRef: ethers.keccak256(ethers.toUtf8Bytes(`venue-${Date.now()}`)),
      amountIn,
      amountOut,
      executedAt: Math.floor(Date.now() / 1000),
      success,
    };

    const tx = await vault.recordExecution(result);
    const receipt = await tx.wait();

    logger.info(`Execution recorded. TX: ${receipt.hash}`);
    return { success: true, txHash: receipt.hash };

  } catch (err) {
    logger.error(`Failed to record execution: ${err.message}`);
    return { success: false, error: err.message };
  }
}
