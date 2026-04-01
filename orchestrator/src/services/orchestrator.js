import { buildMarketSummary } from './marketData.js';
import { requestInference } from './inference.js';
import { preCheckPolicy } from './policyCheck.js';
import { buildExecutionIntent, submitIntent, recordExecutionResult, setAssetAddresses } from './executor.js';
import { readVaultState } from './vaultReader.js';
import {
  readKVState, updateKVState,
  logCycle, logDecision, logPolicyCheck, logExecution,
  syncKVToOGStorage, appendToOGStorage,
  syncDecisionToOG, syncExecutionToOG,
} from './storage.js';
import { initOGStorage } from './ogStorage.js';
import { initOGCompute, getOGComputeStatus } from './ogCompute.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let cycleCount = 0;
let running = false;

/**
 * Initialize the orchestrator
 * Sets up asset address mappings from config
 */
export async function initialize() {
  setAssetAddresses({
    USDC: config.contracts.usdc,
    BTC: config.contracts.wbtc,
    WBTC: config.contracts.wbtc,
    ETH: config.contracts.weth,
    WETH: config.contracts.weth,
  });

  // Initialize 0G Compute (non-blocking — falls back to local engine if unavailable)
  await initOGCompute().catch((e) => {
    logger.warn(`0G Compute init failed (will use local fallback): ${e.message}`);
  });

  // Initialize 0G Storage (non-blocking — falls back to local if unavailable)
  await initOGStorage().catch(() => {});

  const state = readKVState();
  cycleCount = state.totalCycles || 0;
  logger.info(`Orchestrator initialized. Previous cycles: ${cycleCount}`);
}

/**
 * Run one complete orchestrator cycle
 * This is the core loop: market → inference → policy → execute → record
 */
export async function runCycle() {
  if (running) {
    logger.warn('Cycle already running, skipping');
    return null;
  }

  running = true;
  cycleCount++;
  const startTime = Date.now();

  logger.info(`\n${'═'.repeat(50)}`);
  logger.info(`CYCLE #${cycleCount} STARTING`);
  logger.info(`${'═'.repeat(50)}`);

  const cycleResult = {
    cycleNumber: cycleCount,
    timestamp: new Date().toISOString(),
    marketSummary: null,
    decision: null,
    policyResult: null,
    executionResult: null,
    duration: 0,
    status: 'pending',
  };

  try {
    // ── Step 1: Read vault state ──
    logger.info('Step 1: Reading vault state...');
    const vaultAddress = config.contracts.vault;
    if (!vaultAddress) {
      throw new Error('VAULT_ADDRESS not configured');
    }
    const vaultState = await readVaultState(vaultAddress);
    logger.info(`  NAV: $${vaultState.nav.toLocaleString()} | Paused: ${vaultState.paused} | Actions today: ${vaultState.dailyActionsUsed}`);

    if (vaultState.paused) {
      logger.info('Vault is paused. Skipping cycle.');
      cycleResult.status = 'skipped_paused';
      return cycleResult;
    }

    if (!vaultState.autoExecution) {
      logger.info('Auto-execution disabled. Skipping cycle.');
      cycleResult.status = 'skipped_manual';
      return cycleResult;
    }

    // ── Step 2: Fetch market data ──
    logger.info('Step 2: Fetching market data...');
    const marketSummary = await buildMarketSummary();
    cycleResult.marketSummary = marketSummary.summary;
    logger.info(`  ${marketSummary.summary}`);

    // ── Step 3: Request AI inference ──
    logger.info('Step 3: Requesting AI inference...');
    const decision = await requestInference(marketSummary, vaultState);

    if (!decision) {
      logger.error('Inference returned null. Skipping cycle.');
      cycleResult.status = 'error_inference';
      return cycleResult;
    }

    cycleResult.decision = decision;
    logDecision(decision, marketSummary.prices);

    // Sync decision snapshot to 0G Storage
    syncDecisionToOG(decision, marketSummary, vaultState).catch(() => {});

    logger.info(`  Decision: ${decision.action.toUpperCase()} ${decision.asset}`);
    logger.info(`  Size: ${decision.size_bps} bps | Confidence: ${(decision.confidence * 100).toFixed(0)}% | Risk: ${(decision.risk_score * 100).toFixed(0)}%`);
    logger.info(`  Reason: ${decision.reason}`);
    logger.info(`  Source: ${decision.source}`);

    // ── Step 4: Handle hold decision ──
    if (decision.action === 'hold') {
      logger.info('AI recommends HOLD. No execution needed.');
      cycleResult.status = 'hold';

      updateKVState({
        lastSignal: decision,
        totalCycles: cycleCount,
        totalSkipped: (readKVState().totalSkipped || 0) + 1,
      });

      return cycleResult;
    }

    // ── Step 5: Policy pre-check ──
    logger.info('Step 4: Running policy pre-check...');
    const policyResult = preCheckPolicy(decision, vaultState, vaultState.policy);
    cycleResult.policyResult = policyResult;
    logPolicyCheck(decision, policyResult);

    if (!policyResult.valid) {
      logger.warn(`  Policy blocked: ${policyResult.reason}`);
      cycleResult.status = 'blocked';

      updateKVState({
        lastSignal: decision,
        totalCycles: cycleCount,
        totalBlocked: (readKVState().totalBlocked || 0) + 1,
      });

      return cycleResult;
    }

    logger.info('  All policy checks passed ✓');

    // ── Step 6: Build and submit intent ──
    logger.info('Step 5: Building and submitting execution intent...');
    const intent = buildExecutionIntent(decision, vaultState);

    if (!intent) {
      logger.warn('Failed to build intent');
      cycleResult.status = 'error_intent';
      return cycleResult;
    }

    logger.info(`  Intent hash: ${intent.intentHash.substring(0, 18)}...`);

    const execResult = await submitIntent(intent);
    cycleResult.executionResult = execResult;
    logExecution(intent, execResult);

    // Sync execution report to 0G Storage
    syncExecutionToOG(intent, execResult, decision).catch(() => {});

    if (execResult.success) {
      logger.info(`  ✓ Intent executed + swap completed on-chain. TX: ${execResult.txHash}`);

      cycleResult.status = 'executed';

      updateKVState({
        lastSignal: decision,
        lastExecutionSummary: {
          intentHash: intent.intentHash,
          txHash: execResult.txHash,
          action: decision.action,
          asset: decision.asset,
          timestamp: new Date().toISOString(),
        },
        totalCycles: cycleCount,
        totalExecutions: (readKVState().totalExecutions || 0) + 1,
      });

    } else {
      logger.error(`  ✗ Intent failed: ${execResult.error}`);
      cycleResult.status = 'failed';

      updateKVState({
        lastSignal: decision,
        totalCycles: cycleCount,
      });
    }

    return cycleResult;

  } catch (err) {
    logger.error(`Cycle error: ${err.message}`);
    cycleResult.status = 'error';
    cycleResult.error = err.message;
    return cycleResult;

  } finally {
    const duration = Date.now() - startTime;
    cycleResult.duration = duration;

    // Log full cycle
    logCycle(cycleResult);

    // Sync to 0G Storage (stub)
    await syncKVToOGStorage(readKVState());
    await appendToOGStorage(cycleResult);

    running = false;
    logger.info(`Cycle #${cycleCount} completed in ${duration}ms — Status: ${cycleResult.status}`);
    logger.info(`${'═'.repeat(50)}\n`);
  }
}

/**
 * Get the current orchestrator status
 */
export function getStatus() {
  const kvState = readKVState();
  return {
    running,
    cycleCount,
    lastSignal: kvState.lastSignal,
    lastExecution: kvState.lastExecutionSummary,
    totalExecutions: kvState.totalExecutions || 0,
    totalBlocked: kvState.totalBlocked || 0,
    totalSkipped: kvState.totalSkipped || 0,
    ogCompute: getOGComputeStatus(),
  };
}
