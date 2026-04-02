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
import { getFactoryContract, getSigner } from '../config/contracts.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let cycleCount = 0;
let running = false;

// ── Per-vault position tracking (persists across cycles) ──
const vaultPositions = {}; // vaultAddress → positionState

function getPositionState(vaultAddr) {
  if (!vaultPositions[vaultAddr]) {
    vaultPositions[vaultAddr] = {
      current_position_side: 'flat',
      current_position_notional_usd: 0,
      current_position_pnl_pct: 0,
      last_action: 'HOLD_FLAT',
      daily_pnl_pct: 0,
      rolling_drawdown_pct: 0,
      consecutive_losses: 0,
      actions_last_60m: 0,
      last_actions_timestamps: [],
    };
  }
  return vaultPositions[vaultAddr];
}

/**
 * Initialize the orchestrator
 */
export async function initialize() {
  setAssetAddresses({
    USDC: config.contracts.usdc,
    BTC: config.contracts.wbtc,
    WBTC: config.contracts.wbtc,
    ETH: config.contracts.weth,
    WETH: config.contracts.weth,
  });

  // Initialize 0G Compute (non-blocking)
  await initOGCompute().catch((e) => {
    logger.warn(`0G Compute init failed (will use local fallback): ${e.message}`);
  });

  // Initialize 0G Storage (non-blocking)
  await initOGStorage().catch(() => {});

  const state = readKVState();
  cycleCount = state.totalCycles || 0;
  logger.info(`Orchestrator initialized. Previous cycles: ${cycleCount}`);
}

/**
 * Discover all vaults where this orchestrator wallet is the executor.
 * Reads from factory's allVaults, checks each vault's executor.
 */
async function discoverManagedVaults() {
  const vaults = [];
  const executorAddr = getSigner().address.toLowerCase();

  try {
    const factory = getFactoryContract();
    const total = await factory.totalVaults();
    const count = Number(total);

    logger.info(`Factory has ${count} total vault(s). Scanning for executor=${executorAddr.slice(0, 10)}...`);

    for (let i = 0; i < count; i++) {
      try {
        const vaultAddr = await factory.getVaultAt(i);
        const state = await readVaultState(vaultAddr);

        if (state.executor.toLowerCase() === executorAddr) {
          vaults.push(vaultAddr);
          logger.info(`  ✓ Vault ${vaultAddr.slice(0, 10)}... — NAV: $${state.nav.toLocaleString()} | ${state.paused ? 'PAUSED' : 'ACTIVE'}`);
        }
      } catch (e) {
        logger.debug(`  Skipping vault at index ${i}: ${e.message?.substring(0, 60)}`);
      }
    }

    // Also include the .env vault if set and not already found
    if (config.contracts.vault) {
      const envVault = config.contracts.vault.toLowerCase();
      if (!vaults.some(v => v.toLowerCase() === envVault)) {
        try {
          const state = await readVaultState(config.contracts.vault);
          if (state.executor.toLowerCase() === executorAddr) {
            vaults.push(config.contracts.vault);
            logger.info(`  ✓ Vault ${config.contracts.vault.slice(0, 10)}... (from .env) — NAV: $${state.nav.toLocaleString()}`);
          }
        } catch {}
      }
    }
  } catch (e) {
    logger.warn(`Factory scan failed: ${e.message}. Falling back to .env vault.`);
    if (config.contracts.vault) {
      vaults.push(config.contracts.vault);
    }
  }

  logger.info(`Managing ${vaults.length} vault(s)`);
  return vaults;
}

/**
 * Run one cycle for a single vault
 */
async function runVaultCycle(vaultAddress, marketSummary) {
  const shortAddr = `${vaultAddress.slice(0, 8)}...${vaultAddress.slice(-4)}`;
  const positionState = getPositionState(vaultAddress);

  logger.info(`  ── Vault ${shortAddr} ──`);

  const vaultResult = {
    vault: vaultAddress,
    decision: null,
    policyResult: null,
    executionResult: null,
    status: 'pending',
  };

  try {
    // Read vault state
    const vaultState = await readVaultState(vaultAddress);

    // Merge position tracking
    const now = Math.floor(Date.now() / 1000);
    positionState.actions_last_60m = positionState.last_actions_timestamps.filter(t => now - t < 3600).length;
    Object.assign(vaultState, positionState);

    logger.info(`    NAV: $${vaultState.nav.toLocaleString()} | Paused: ${vaultState.paused} | Actions: ${vaultState.dailyActionsUsed} | Position: ${positionState.current_position_side}`);

    if (vaultState.paused) {
      logger.info(`    Paused — skipping`);
      vaultResult.status = 'skipped_paused';
      return vaultResult;
    }

    if (!vaultState.autoExecution) {
      logger.info(`    Auto-execution disabled — skipping`);
      vaultResult.status = 'skipped_manual';
      return vaultResult;
    }

    if (vaultState.nav <= 0) {
      logger.info(`    Empty vault (NAV=0) — skipping`);
      vaultResult.status = 'skipped_empty';
      return vaultResult;
    }

    // AI inference (uses shared market data, vault-specific state & policy)
    const decision = await requestInference(marketSummary, vaultState);

    if (!decision) {
      vaultResult.status = 'error_inference';
      return vaultResult;
    }

    vaultResult.decision = decision;
    logDecision(decision, marketSummary.prices);
    syncDecisionToOG(decision, marketSummary, vaultState).catch(() => {});

    logger.info(`    Decision: ${decision.action.toUpperCase()} ${decision.asset} | Regime: ${decision.regime || '-'} | Edge: ${decision.final_edge_score || '-'} | Source: ${decision.source}`);

    // Hold — no execution
    if (decision.action === 'hold') {
      vaultResult.status = 'hold';
      updateKVState({
        lastSignal: decision,
        totalCycles: cycleCount,
        totalSkipped: (readKVState().totalSkipped || 0) + 1,
        [`vault_${shortAddr}_lastSignal`]: decision,
      });
      return vaultResult;
    }

    // Policy pre-check
    const policyResult = preCheckPolicy(decision, vaultState, vaultState.policy);
    vaultResult.policyResult = policyResult;
    logPolicyCheck(decision, policyResult);

    if (!policyResult.valid) {
      logger.warn(`    Policy blocked: ${policyResult.reason}`);
      vaultResult.status = 'blocked';
      updateKVState({
        lastSignal: decision,
        totalCycles: cycleCount,
        totalBlocked: (readKVState().totalBlocked || 0) + 1,
      });
      return vaultResult;
    }

    logger.info('    Policy checks passed ✓');

    // Build + submit intent
    const oraclePrices = marketSummary.prices;
    const intent = buildExecutionIntent(decision, vaultState, oraclePrices);

    if (!intent) {
      vaultResult.status = 'error_intent';
      return vaultResult;
    }

    logger.info(`    Intent: ${intent.intentHash.substring(0, 18)}...`);

    const execResult = await submitIntent(intent);
    vaultResult.executionResult = execResult;
    logExecution(intent, execResult);
    syncExecutionToOG(intent, execResult, decision).catch(() => {});

    if (execResult.success) {
      logger.info(`    ✓ Executed on-chain. TX: ${execResult.txHash}`);
      vaultResult.status = 'executed';

      // Update position tracking
      if (decision.action === 'buy') {
        positionState.current_position_side = 'long';
        positionState.current_position_notional_usd = (decision.size_bps / 10000) * vaultState.nav;
        positionState.current_position_pnl_pct = 0;
        positionState.consecutive_losses = 0;
      } else if (decision.action === 'sell') {
        positionState.current_position_side = 'flat';
        positionState.current_position_notional_usd = 0;
        positionState.current_position_pnl_pct = 0;
      }
      positionState.last_action = decision.v1_action || decision.action.toUpperCase();
      positionState.last_actions_timestamps.push(now);
      const cutoff = now - 3600;
      positionState.last_actions_timestamps = positionState.last_actions_timestamps.filter(t => t > cutoff);

      updateKVState({
        lastSignal: decision,
        lastExecutionSummary: {
          vault: vaultAddress,
          intentHash: intent.intentHash,
          txHash: execResult.txHash,
          action: decision.action,
          asset: decision.asset,
          regime: decision.regime,
          final_edge_score: decision.final_edge_score,
          timestamp: new Date().toISOString(),
        },
        totalCycles: cycleCount,
        totalExecutions: (readKVState().totalExecutions || 0) + 1,
        positionState: vaultPositions,
      });
    } else {
      logger.error(`    ✗ Failed: ${execResult.error}`);
      vaultResult.status = 'failed';
      positionState.consecutive_losses += 1;
      updateKVState({ lastSignal: decision, totalCycles: cycleCount });
    }

    return vaultResult;

  } catch (err) {
    logger.error(`    Error: ${err.message}`);
    vaultResult.status = 'error';
    vaultResult.error = err.message;
    return vaultResult;
  }
}

/**
 * Run one complete orchestrator cycle — processes ALL managed vaults
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
  logger.info(`CYCLE #${cycleCount} STARTING (multi-vault)`);
  logger.info(`${'═'.repeat(50)}`);

  const cycleResult = {
    cycleNumber: cycleCount,
    timestamp: new Date().toISOString(),
    marketSummary: null,
    vaultResults: [],
    duration: 0,
    status: 'pending',
  };

  try {
    // ── Step 1: Discover managed vaults ──
    const managedVaults = await discoverManagedVaults();

    if (managedVaults.length === 0) {
      logger.warn('No managed vaults found. Skipping cycle.');
      cycleResult.status = 'no_vaults';
      return cycleResult;
    }

    // ── Step 2: Fetch market data (shared across all vaults) ──
    logger.info('Fetching market data...');
    const marketSummary = await buildMarketSummary();
    cycleResult.marketSummary = marketSummary.summary;
    logger.info(`  ${marketSummary.summary}`);

    // ── Step 3: Run cycle for each vault ──
    for (const vaultAddr of managedVaults) {
      try {
        const result = await runVaultCycle(vaultAddr, marketSummary);
        cycleResult.vaultResults.push(result);
      } catch (err) {
        logger.error(`  Vault ${vaultAddr.slice(0, 10)} error: ${err.message}`);
        cycleResult.vaultResults.push({ vault: vaultAddr, status: 'error', error: err.message });
      }
    }

    // Summarize
    const executed = cycleResult.vaultResults.filter(r => r.status === 'executed').length;
    const held = cycleResult.vaultResults.filter(r => r.status === 'hold').length;
    const blocked = cycleResult.vaultResults.filter(r => r.status === 'blocked').length;
    const skipped = cycleResult.vaultResults.filter(r => r.status?.startsWith('skipped')).length;

    cycleResult.status = executed > 0 ? 'executed' : held > 0 ? 'hold' : blocked > 0 ? 'blocked' : 'skipped';

    logger.info(`  Summary: ${managedVaults.length} vaults — ${executed} executed, ${held} hold, ${blocked} blocked, ${skipped} skipped`);

    return cycleResult;

  } catch (err) {
    logger.error(`Cycle error: ${err.message}`);
    cycleResult.status = 'error';
    cycleResult.error = err.message;
    return cycleResult;

  } finally {
    const duration = Date.now() - startTime;
    cycleResult.duration = duration;

    logCycle(cycleResult);
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
    managedVaults: Object.keys(vaultPositions),
  };
}
