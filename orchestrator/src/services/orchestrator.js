import { buildMarketSummary } from './marketData.js';
import { requestInference } from './inference.js';
import { preCheckPolicy } from './policyCheck.js';
import { buildExecutionIntent, submitIntent, setAssetAddresses } from './executor.js';
import { readVaultState } from './vaultReader.js';
import { readOperatorState, checkOperatorEligibility } from './operatorReader.js';
import {
  readKVState, updateKVState, writeKVState,
  logCycle, logDecision, logPolicyCheck, logExecution, logAlert,
  syncKVToOGStorage, appendToOGStorage,
  syncDecisionToOG, syncExecutionToOG,
} from './storage.js';
import { initOGStorage, isOGStorageAvailable, readVaultStateFromOG } from './ogStorage.js';
import { initOGCompute, getOGComputeStatus } from './ogCompute.js';
import { evaluateApprovalTier } from './approvalTier.js';
import { startIndexer, getVaultsByExecutor, getExecutorVaultCounts } from './vaultIndexer.js';
import { getPoolAddresses, getPoolStats, getPoolSize } from './walletPool.js';
import pLimit from 'p-limit';
import { buildAssetAddressMap } from './assets.js';
import { getFactoryContract, getSigner } from '../config/contracts.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let cycleCount = 0;

// Track 2: idempotency — skip duplicate intent hashes within session
const submittedIntents = new Set();
let running = false;

// ── Per-vault position tracking (persists across cycles) ──
const vaultPositions = {}; // vaultAddress → positionState

function buildDefaultPositionState() {
  return {
    current_position_side: 'flat',
    current_position_asset: null,
    current_position_notional_usd: 0,
    current_position_pnl_pct: 0,
    position_cost_basis_usd: 0,
    last_action: 'HOLD_FLAT',
    daily_pnl_pct: 0,
    rolling_drawdown_pct: 0,
    consecutive_losses: 0,
    actions_last_60m: 0,
    last_actions_timestamps: [],
  };
}

function normalizePositionState(state = {}) {
  return {
    ...buildDefaultPositionState(),
    ...state,
    last_actions_timestamps: Array.isArray(state.last_actions_timestamps)
      ? state.last_actions_timestamps.map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : [],
  };
}

function getPositionState(vaultAddr) {
  if (!vaultPositions[vaultAddr]) {
    vaultPositions[vaultAddr] = buildDefaultPositionState();
  }
  vaultPositions[vaultAddr] = normalizePositionState(vaultPositions[vaultAddr]);
  return vaultPositions[vaultAddr];
}

function restorePositionState(serialized = {}) {
  for (const [vaultAddress, state] of Object.entries(serialized || {})) {
    vaultPositions[vaultAddress] = normalizePositionState(state);
  }
}

function syncPositionStateFromHoldings(positionState, vaultState) {
  const nonBaseAssets = (vaultState.breakdown || [])
    .filter((asset) => asset.tradeSymbol !== 'USDC' && asset.valueUsd > 0.01)
    .sort((a, b) => b.valueUsd - a.valueUsd);

  if (nonBaseAssets.length === 0) {
    positionState.current_position_side = 'flat';
    positionState.current_position_asset = null;
    positionState.current_position_notional_usd = 0;
    positionState.current_position_pnl_pct = 0;
    positionState.position_cost_basis_usd = 0;
    return positionState;
  }

  const totalPositionValue = nonBaseAssets.reduce((sum, asset) => sum + asset.valueUsd, 0);
  const primaryAsset = nonBaseAssets[0].tradeSymbol;
  const costBasis = positionState.position_cost_basis_usd > 0
    ? positionState.position_cost_basis_usd
    : totalPositionValue;

  positionState.current_position_side = 'long';
  positionState.current_position_asset = primaryAsset;
  positionState.current_position_notional_usd = totalPositionValue;
  positionState.current_position_pnl_pct = costBasis > 0
    ? ((totalPositionValue - costBasis) / costBasis) * 100
    : 0;
  positionState.position_cost_basis_usd = costBasis;

  return positionState;
}

function updatePendingApproval(vaultAddress, approvalRequest = null) {
  const currentState = readKVState();
  const pendingApprovals = { ...(currentState.pendingApprovals || {}) };

  if (approvalRequest) {
    pendingApprovals[vaultAddress] = {
      ...approvalRequest,
      updatedAt: new Date().toISOString(),
    };
  } else {
    delete pendingApprovals[vaultAddress];
  }

  updateKVState({
    pendingApprovals,
    positionState: vaultPositions,
  });

  return pendingApprovals;
}

/**
 * Initialize the orchestrator
 */
export async function initialize() {
  setAssetAddresses(buildAssetAddressMap());

  // Initialize 0G Compute (non-blocking)
  await initOGCompute().catch((e) => {
    logger.warn(`0G Compute init failed (will use local fallback): ${e.message}`);
  });

  // Initialize 0G Storage (non-blocking)
  await initOGStorage().catch(() => {});

  if (config.strictMode && !isOGStorageAvailable()) {
    throw new Error('STRICT_MODE requires 0G Storage to initialize successfully');
  }

  if (isOGStorageAvailable()) {
    try {
      const remoteState = await readVaultStateFromOG();
      if (remoteState?.updatedAt) {
        const localState = readKVState();
        const remoteUpdatedAt = Date.parse(remoteState.updatedAt) || 0;
        const localUpdatedAt = Date.parse(localState.updatedAt) || 0;

        if (remoteUpdatedAt > localUpdatedAt) {
          writeKVState(remoteState);
          logger.info('Restored KV state from 0G Storage snapshot');
        }
      }
    } catch (err) {
      logger.warn(`Failed to hydrate state from 0G Storage: ${err.message}`);
      if (config.strictMode) {
        throw err;
      }
    }
  }

  const state = readKVState();
  cycleCount = state.totalCycles || 0;
  restorePositionState(state.positionState);

  // Start the vault indexer (backfill + event polling). Vault discovery becomes
  // O(1) per cycle regardless of how many vaults exist on the factory.
  await startIndexer().catch((err) => {
    logger.warn(`Indexer init failed (will retry on poll): ${err.message}`);
  });

  logger.info(`Orchestrator initialized. Previous cycles: ${cycleCount} | Executor pool size: ${getPoolSize()}`);
}

/**
 * Discover all vaults where this orchestrator (or any wallet in the pool) is the executor.
 *
 * Production-grade flow:
 *   1. Indexer keeps a SQLite cache of all vaults (populated from VaultDeployed events).
 *   2. We query the cache filtered by executor address — O(log N) instead of O(N) RPC calls.
 *   3. If wallet pool is configured, we union vaults across all pool addresses.
 *
 * This scales to 100k+ vaults without per-cycle factory scans.
 */
async function discoverManagedVaults() {
  // Pool addresses (single-wallet orchestrator returns 1 entry, sharded returns N)
  const executorAddrs = getPoolAddresses();
  const seen = new Set();
  const vaults = [];

  for (const addr of executorAddrs) {
    const rows = getVaultsByExecutor(addr);
    for (const row of rows) {
      if (seen.has(row.address)) continue;
      seen.add(row.address);
      vaults.push(row.address);
    }
  }

  // Always include .env vault as a backstop (helpful while indexer backfills)
  if (config.contracts.vault) {
    const envVault = config.contracts.vault;
    if (!seen.has(envVault)) {
      vaults.push(envVault);
      seen.add(envVault);
    }
  }

  logger.info(`Indexer: ${vaults.length} vault(s) assigned to ${executorAddrs.length} executor wallet(s)`);
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
    syncPositionStateFromHoldings(positionState, vaultState);
    positionState.actions_last_60m = positionState.last_actions_timestamps.filter(t => now - t < 3600).length;
    Object.assign(vaultState, positionState);

    logger.info(`    NAV: $${vaultState.nav.toLocaleString()} | Base: $${vaultState.baseBalance.toLocaleString()} | Paused: ${vaultState.paused} | Actions: ${vaultState.dailyActionsUsed} | Position: ${positionState.current_position_side}${positionState.current_position_asset ? ` ${positionState.current_position_asset}` : ''}`);

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

    // Phase 2-5: check operator eligibility (tier cap, frozen state, active flag)
    // Graceful degradation: if staking/registry not deployed, operatorState is null
    // and eligibility check passes through.
    const operatorState = await readOperatorState(vaultState.executor);
    const eligibility = checkOperatorEligibility(vaultState, operatorState);
    if (!eligibility.eligible) {
      logger.warn(`    Operator ineligible: ${eligibility.reason} — ${eligibility.detail}`);
      vaultResult.status = 'skipped_operator_ineligible';
      vaultResult.reason = eligibility.reason;
      vaultResult.detail = eligibility.detail;
      return vaultResult;
    }
    if (operatorState) {
      const tierInfo = operatorState.stake
        ? `${operatorState.stake.tierLabel} · stake $${operatorState.stake.amountUsd.toFixed(0)}`
        : 'stake:?';
      const repInfo = operatorState.reputation
        ? `rep ${operatorState.reputation.totalExecutions}x (${operatorState.reputation.successRatePct.toFixed(0)}% success)${operatorState.reputation.verified ? ' ✓' : ''}`
        : 'rep:?';
      logger.info(`    Operator: ${operatorState.name || 'unnamed'} · ${tierInfo} · ${repInfo}`);
      vaultState.operator = operatorState;
    }

    // AI inference (uses shared market data, vault-specific state & policy)
    const decision = await requestInference(marketSummary, vaultState);

    if (!decision) {
      vaultResult.status = 'error_inference';
      return vaultResult;
    }

    const approval = evaluateApprovalTier(decision, vaultState);
    decision.approval_tier = approval.tier;
    decision.approval_reasons = approval.reasons;
    decision.position_asset = vaultState.current_position_asset || vaultState.primaryPositionAsset || null;
    decision.position_value_usd = vaultState.current_position_notional_usd || vaultState.nonBasePositionValueUsd || 0;

    vaultResult.decision = decision;
    logDecision(decision, marketSummary.prices, { vault: vaultAddress });
    syncDecisionToOG(decision, marketSummary, vaultState).catch(() => {});

    logger.info(`    Decision: ${decision.action.toUpperCase()} ${decision.asset} | Regime: ${decision.regime || '-'} | Edge: ${decision.final_edge_score || '-'} | Approval: ${approval.tier} | Source: ${decision.source}`);

    // Hold — no execution
    if (decision.action === 'hold') {
      updatePendingApproval(vaultAddress, null);
      vaultResult.status = 'hold';
      updateKVState({
        lastSignal: decision,
        totalCycles: cycleCount,
        totalSkipped: (readKVState().totalSkipped || 0) + 1,
        [`vault_${shortAddr}_lastSignal`]: decision,
        positionState: vaultPositions,
      });
      return vaultResult;
    }

    // Policy pre-check
    const policyResult = preCheckPolicy(decision, vaultState, vaultState.policy);
    vaultResult.policyResult = policyResult;
    logPolicyCheck(decision, policyResult, { vault: vaultAddress });

    if (!policyResult.valid) {
      logger.warn(`    Policy blocked: ${policyResult.reason}`);
      logAlert('warning', 'policy_blocked', `Policy blocked ${decision.action.toUpperCase()} ${decision.asset}`, {
        vault: vaultAddress,
        action: decision.action,
        asset: decision.asset,
        reason: policyResult.reason,
      });
      updatePendingApproval(vaultAddress, null);
      vaultResult.status = 'blocked';
      updateKVState({
        lastSignal: decision,
        totalCycles: cycleCount,
        totalBlocked: (readKVState().totalBlocked || 0) + 1,
        positionState: vaultPositions,
      });
      return vaultResult;
    }

    logger.info('    Policy checks passed ✓');

    if (!approval.execute) {
      logger.warn(`    ${approval.label}`);
      updatePendingApproval(vaultAddress, {
        vault: vaultAddress,
        action: decision.action,
        asset: decision.asset,
        approval_tier: approval.tier,
        approval_reasons: approval.reasons,
        reason: decision.reason,
      });
      logAlert(
        approval.tier === 'owner_confirmation' ? 'warning' : 'info',
        'approval_required',
        `${approval.label} for ${decision.action.toUpperCase()} ${decision.asset}`,
        {
          vault: vaultAddress,
          action: decision.action,
          asset: decision.asset,
          approval_tier: approval.tier,
          approval_reasons: approval.reasons,
        }
      );
      vaultResult.status = 'approval_required';
      vaultResult.approval = approval;
      updateKVState({
        lastSignal: decision,
        totalCycles: cycleCount,
        positionState: vaultPositions,
      });
      return vaultResult;
    }

    updatePendingApproval(vaultAddress, null);

    // Build + submit intent
    const oraclePrices = marketSummary.prices;
    // Track 2: pass the raw 0G Compute response so the executor can derive the
    // TEE attestation report hash and bind it into the intent.
    const intent = buildExecutionIntent(decision, vaultState, oraclePrices, decision._computeResponse);

    if (!intent) {
      vaultResult.status = 'error_intent';
      return vaultResult;
    }

    logger.info(`    Intent: ${intent.intentHash.substring(0, 18)}...`);

    // Idempotency check: skip if this intent was already submitted this session
    if (submittedIntents.has(intent.intentHash)) {
      logger.warn(`    Intent ${intent.intentHash.substring(0, 18)} already submitted — skipping duplicate`);
      vaultResult.status = 'skipped_duplicate';
      return vaultResult;
    }

    // Track 2: forward sealed-mode policy state from on-chain vault to executor.
    // When sealedMode=true, executor will run commit-reveal + TEE signature flow.
    const execResult = await submitIntent(intent, {
      sealedMode: vaultState.policy?.sealedMode === true,
      attestedSigner: vaultState.policy?.attestedSigner,
    });
    vaultResult.executionResult = execResult;
    logExecution(intent, execResult, decision, { vault: vaultAddress });
    syncExecutionToOG(intent, execResult, decision).catch(() => {});

    if (execResult.success) {
      submittedIntents.add(intent.intentHash);
      logger.info(`    ✓ Executed on-chain. TX: ${execResult.txHash}`);
      vaultResult.status = 'executed';

      // Update position tracking
      if (decision.action === 'buy') {
        positionState.current_position_side = 'long';
        positionState.current_position_asset = decision.asset;
        positionState.current_position_notional_usd = (decision.size_bps / 10000) * vaultState.nav;
        positionState.position_cost_basis_usd = positionState.current_position_notional_usd;
        positionState.current_position_pnl_pct = 0;
        positionState.consecutive_losses = 0;
      } else if (decision.action === 'sell') {
        const sellFraction = decision.sell_fraction_bps || decision.size_bps || 10000;
        if (sellFraction >= 10000) {
          positionState.current_position_side = 'flat';
          positionState.current_position_asset = null;
          positionState.current_position_notional_usd = 0;
          positionState.current_position_pnl_pct = 0;
          positionState.position_cost_basis_usd = 0;
        } else {
          const fractionRemaining = 1 - (sellFraction / 10000);
          positionState.current_position_side = 'long';
          positionState.current_position_notional_usd = Math.max(0, positionState.current_position_notional_usd * fractionRemaining);
          positionState.position_cost_basis_usd = Math.max(0, positionState.position_cost_basis_usd * fractionRemaining);
          positionState.current_position_pnl_pct = positionState.position_cost_basis_usd > 0
            ? ((positionState.current_position_notional_usd - positionState.position_cost_basis_usd) / positionState.position_cost_basis_usd) * 100
            : 0;
        }
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
          approval_tier: decision.approval_tier,
          timestamp: new Date().toISOString(),
        },
        totalCycles: cycleCount,
        totalExecutions: (readKVState().totalExecutions || 0) + 1,
        positionState: vaultPositions,
      });
    } else {
      logger.error(`    ✗ Failed: ${execResult.error}`);
      logAlert('critical', 'execution_failed', `Execution failed for ${decision.action.toUpperCase()} ${decision.asset}`, {
        vault: vaultAddress,
        action: decision.action,
        asset: decision.asset,
        error: execResult.error,
      });
      vaultResult.status = 'failed';
      positionState.consecutive_losses += 1;
      updateKVState({ lastSignal: decision, totalCycles: cycleCount, positionState: vaultPositions });
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

    // ── Step 3: Run cycle for each vault (parallel, bounded concurrency) ──
    // Concurrency cap: default 5 vaults in-flight at once. Tune via
    // VAULT_CONCURRENCY env for larger deployments. Each vault is sharded onto
    // its assigned wallet (walletPool), so nonces don't conflict across workers.
    const concurrency = Math.max(1, parseInt(process.env.VAULT_CONCURRENCY || '5', 10));
    const limit = pLimit(concurrency);

    const results = await Promise.all(
      managedVaults.map((vaultAddr) => limit(async () => {
        try {
          return await runVaultCycle(vaultAddr, marketSummary);
        } catch (err) {
          logger.error(`  Vault ${vaultAddr.slice(0, 10)} error: ${err.message}`);
          return { vault: vaultAddr, status: 'error', error: err.message };
        }
      }))
    );
    cycleResult.vaultResults.push(...results);

    // Summarize
    const executed = cycleResult.vaultResults.filter(r => r.status === 'executed').length;
    const held = cycleResult.vaultResults.filter(r => r.status === 'hold').length;
    const blocked = cycleResult.vaultResults.filter(r => r.status === 'blocked').length;
    const approvalRequired = cycleResult.vaultResults.filter(r => r.status === 'approval_required').length;
    const skipped = cycleResult.vaultResults.filter(r => r.status?.startsWith('skipped')).length;

    cycleResult.status = executed > 0
      ? 'executed'
      : approvalRequired > 0
        ? 'approval_required'
        : held > 0
          ? 'hold'
          : blocked > 0
            ? 'blocked'
            : 'skipped';

    logger.info(`  Summary: ${managedVaults.length} vaults — ${executed} executed, ${approvalRequired} approval, ${held} hold, ${blocked} blocked, ${skipped} skipped`);

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
  let executorAddress = null;

  try {
    executorAddress = getSigner().address;
  } catch {
    executorAddress = null;
  }

  return {
    running,
    cycleCount,
    executorAddress,
    signerConfigured: Boolean(executorAddress),
    mutationAuthMode: config.apiKey ? 'api-key' : 'localhost-only',
    strictMode: config.strictMode,
    configuredVault: config.contracts.vault || null,
    deploymentsFile: config.deploymentsFile,
    lastSignal: kvState.lastSignal,
    lastExecution: kvState.lastExecutionSummary,
    totalExecutions: kvState.totalExecutions || 0,
    totalBlocked: kvState.totalBlocked || 0,
    totalSkipped: kvState.totalSkipped || 0,
    pendingApprovals: kvState.pendingApprovals || {},
    pendingApprovalCount: Object.keys(kvState.pendingApprovals || {}).length,
    ogCompute: getOGComputeStatus(),
    managedVaults: Object.keys(vaultPositions),
    managedVaultCount: Object.keys(vaultPositions).length,
    // Production-grade metadata
    poolSize: getPoolSize(),
    poolStats: getPoolStats(
      Object.fromEntries(
        getExecutorVaultCounts().map((r) => [r.executor.toLowerCase(), r.count])
      )
    ),
    vaultConcurrency: parseInt(process.env.VAULT_CONCURRENCY || '5', 10),
  };
}
