import { ethers } from 'ethers';
import { getVaultContract, getERC20Contract } from '../config/contracts.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * VaultReaderService
 * Reads the current state of the vault from on-chain data.
 */

/**
 * Read comprehensive vault state from the contract
 * @param {string} vaultAddress - Address of the vault contract
 * @returns {object} Complete vault state
 */
export async function readVaultState(vaultAddress) {
  try {
    const vault = getVaultContract(vaultAddress);

    // Get summary
    const summary = await vault.getVaultSummary();
    const policy = await vault.getPolicy();
    const allowedAssets = await vault.getAllowedAssets();
    const balance = await vault.getBalance();

    // Parse the summary tuple
    const [
      owner,
      executor,
      baseAsset,
      vaultBalance,
      totalDeposited,
      lastExecution,
      dailyActions,
      paused,
      autoExecution,
    ] = summary;

    // Get base asset info
    const baseToken = getERC20Contract(baseAsset);
    const baseDecimals = await baseToken.decimals();
    const balanceFormatted = parseFloat(ethers.formatUnits(vaultBalance, baseDecimals));

    return {
      address: vaultAddress,
      owner,
      executor,
      baseAsset,
      baseDecimals: Number(baseDecimals),
      nav: balanceFormatted,
      totalDeposited: parseFloat(ethers.formatUnits(totalDeposited, baseDecimals)),
      balance: balanceFormatted,
      lastExecutionTimestamp: Number(lastExecution),
      lastExecution: Number(lastExecution) > 0
        ? new Date(Number(lastExecution) * 1000).toISOString()
        : null,
      dailyActionsUsed: Number(dailyActions),
      paused,
      autoExecution,

      // Policy
      policy: {
        maxPositionBps: Number(policy.maxPositionBps),
        maxDailyLossBps: Number(policy.maxDailyLossBps),
        stopLossBps: Number(policy.stopLossBps),
        cooldownSeconds: Number(policy.cooldownSeconds),
        confidenceThresholdBps: Number(policy.confidenceThresholdBps),
        maxActionsPerDay: Number(policy.maxActionsPerDay),
        autoExecution: policy.autoExecution,
        paused: policy.paused,
      },

      // Derived for prompts
      mandate: getMandateLabel(Number(policy.maxPositionBps), Number(policy.maxDailyLossBps)),
      maxPositionPct: Number(policy.maxPositionBps) / 100,
      maxDrawdownPct: Number(policy.maxDailyLossBps) / 100,
      confidenceThreshold: Number(policy.confidenceThresholdBps) / 100,
      maxActionsPerDay: Number(policy.maxActionsPerDay),

      allowedAssets: allowedAssets.map(a => a.toLowerCase()),

      // Placeholder allocation — in production, read from token balances
      allocation: [],
      currentDailyLossPct: 0,
    };

  } catch (err) {
    logger.error(`Failed to read vault state: ${err.message}`);
    throw err;
  }
}

/**
 * Determine mandate label from policy parameters
 */
function getMandateLabel(maxPositionBps, maxDailyLossBps) {
  if (maxPositionBps <= 3000 && maxDailyLossBps <= 300) return 'Defensive';
  if (maxPositionBps <= 5000 && maxDailyLossBps <= 500) return 'Balanced';
  return 'Tactical';
}
