import { ZeroHash } from 'ethers';
import { buildMarketSummary } from './marketData.js';

const ZERO_HASH_LOWER = ZeroHash.toLowerCase();

/**
 * Pure helper: should the orchestrator route this intent through Khalani
 * (cross-chain) instead of the on-chain Jaine path?
 *
 * Returns true only when (a) the route quoter picked Khalani and (b) the
 * vault implementation has the `acceptCrossChainFill` function. V1/V2 do
 * not; V3 and V4 both do. V4's strategy-binding gate doesn't apply to the
 * Khalani path, so V4 vaults are eligible for Khalani routing without any
 * extra check.
 *
 * Exported for unit testing — the audit identified this gate as a regression
 * risk after each vault-version cutover.
 */
export function shouldUseKhalaniRoute(intent, vaultState) {
  return (
    intent?.routeChoice?.route === 'khalani' &&
    Boolean(vaultState?.isV3 || vaultState?.isV4)
  );
}

/**
 * Pure helper: does the strategy loaded for this vault's operator differ
 * from the manifest hash the vault has accepted on-chain?
 *
 * The check fires only for V4 vaults; V3 vaults have no `acceptedManifestHash`
 * slot. A mismatch means the depositor has not approved the operator's new
 * manifest yet (or the operator deviated from what they originally bonded);
 * the orchestrator skips the cycle so we don't burn gas on a guaranteed
 * `WrongStrategyHash` revert.
 *
 * The legacy "zero hash" backwards-compat valve still passes — a vault
 * created with `acceptedManifestHash == 0` only accepts intents whose
 * strategyHash is also zero, which is the orchestrator's behaviour when no
 * manifest is loaded.
 *
 * Audit found a hole in the prior implementation: when the vault expects a
 * NONZERO accepted hash but the operator never published a manifest (so
 * `loadedStrategyHash` is undefined), the orchestrator would still submit a
 * zero-hash intent and burn gas on a guaranteed `WrongStrategyHash` revert.
 * Treat that case as a mismatch so the cycle skips off-chain instead.
 */
export function isStrategyHashMismatch(vaultState, loadedStrategyHash) {
  if (!vaultState?.isV4) return false;
  const accepted = vaultState.acceptedManifestHash;
  if (!accepted) return false;
  const acceptedLower = accepted.toLowerCase();
  // Unbound vault (zero accepted hash) — anything goes, including a
  // zero-hash intent from an operator who hasn't published a manifest.
  if (acceptedLower === ZERO_HASH_LOWER) return false;
  // Vault has a nonzero strategy commitment. If we have no loaded strategy
  // (operator didn't publish, or the manifest fetch failed earlier), the
  // orchestrator would submit a zero-hash intent which the vault would
  // revert with WrongStrategyHash. Flag that as a mismatch so the caller
  // skips the cycle off-chain.
  if (!loadedStrategyHash) return true;
  return acceptedLower !== loadedStrategyHash.toLowerCase();
}
import { fetchPythPrices } from './pythPrice.js';
import { requestInference } from './inference.js';
import { preCheckPolicy } from './policyCheck.js';
import { buildExecutionIntent, submitIntent, submitCrossChainIntent, setAssetAddresses, recordExecutionToReputation } from './executor.js';
import { readVaultState } from './vaultReader.js';
import { readOperatorState, checkOperatorEligibility } from './operatorReader.js';
import {
  readKVState, updateKVState, writeKVState,
  logCycle, logDecision, logPolicyCheck, logExecution, logAlert,
  syncKVToOGStorage, appendToOGStorage,
  syncDecisionToOG, syncExecutionToOG,
  recordSubmittedIntent, tryClaimIntent, unclaimIntent, incrementCounters,
} from './storage.js';
import { initOGStorage, isOGStorageAvailable, readVaultStateFromOG } from './ogStorage.js';
import { initOGCompute, getOGComputeStatus } from './ogCompute.js';
import { evaluateApprovalTier } from './approvalTier.js';
import { startIndexer, getVaultsByExecutor, getExecutorVaultCounts } from './vaultIndexer.js';
import { startVaultEventListener } from './vaultEventListener.js';
import { getPoolAddresses, getPoolStats, getPoolSize } from './walletPool.js';
import pLimit from 'p-limit';
import { buildAssetAddressMap } from './assets.js';
import { getFactoryContract, getSigner } from '../config/contracts.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let cycleCount = 0;

// Track 2: idempotency — backed by storage.js so the dedup survives
// orchestrator restarts. An in-process Set used to be enough, but a crash
// between broadcast and confirm would let the next cycle re-issue a fresh
// intent (different `createdAt` → different hash) for the same logical
// decision. With the persisted store, both the original intentHash and
// the on-chain receipt are recorded; replays are caught by either path.
let running = false;

// ── Per-vault position tracking (persists across cycles) ──
const vaultPositions = {}; // vaultAddress → positionState

// B3: per-vault mutex. `vaultPositions[vaultAddr]` is shared mutable state
// referenced by `runVaultCycle` from start to finish; if two cycles ever
// race on the same vault (manual trigger overlap, indexer event coinciding
// with the periodic timer, etc.) the interleaved mutations corrupt the
// in-memory position. Serializing per vault address keeps each cycle's
// read-mutate-persist pass atomic without paying the global cost of a
// single-flight cycle. Keyed by lowercased address so casing variations
// from the indexer/env don't pick a different mutex.
const perVaultLimiters = new Map();
function getPerVaultLimit(vaultAddr) {
  const key = (vaultAddr || '').toLowerCase();
  let limiter = perVaultLimiters.get(key);
  if (!limiter) {
    limiter = pLimit(1);
    perVaultLimiters.set(key, limiter);
  }
  return limiter;
}

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

export function resolveExecutorAddresses() {
  try {
    const poolAddresses = getPoolAddresses().filter(Boolean);
    if (poolAddresses.length > 0) {
      return poolAddresses;
    }
  } catch {
    // Fall through to the legacy single-wallet signer path.
  }

  try {
    const signerAddress = getSigner().address;
    return signerAddress ? [signerAddress] : [];
  } catch {
    return [];
  }
}

export function collectManagedVaultAddresses(executorAddresses = resolveExecutorAddresses()) {
  const seen = new Set();
  const vaults = [];

  for (const executorAddress of executorAddresses) {
    const rows = getVaultsByExecutor(executorAddress);
    for (const row of rows) {
      if (!row?.address) continue;
      const key = row.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      vaults.push(row.address);
    }
  }

  // Keep the explicitly configured vault visible even while the indexer is
  // still backfilling after a restart.
  if (config.contracts.vault) {
    const envVault = config.contracts.vault;
    const envKey = envVault.toLowerCase();
    if (!seen.has(envKey)) {
      seen.add(envKey);
      vaults.push(envVault);
    }
  }

  return vaults;
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

  // STRICT_MODE requires 0G Storage when the operator chose to use it. If the
  // operator has explicitly opted out (empty `OG_INDEXER_RPC` in .env) — which
  // is the current default because 0G Storage KV is known unstable during the
  // hackathon window (see HACKATHON_SUBMISSION.md "Honest Disclosures") — we
  // allow STRICT_MODE to proceed with the local-JSON journal fallback. The
  // other strict guards (market data, AI inference, contract presence, API
  // keys, CORS) still apply.
  const storageOptedOut = process.env.OG_INDEXER_RPC === '';
  if (config.strictMode && !storageOptedOut && !isOGStorageAvailable()) {
    throw new Error('STRICT_MODE requires 0G Storage to initialize successfully (set OG_INDEXER_RPC= in .env to explicitly opt out)');
  }
  if (config.strictMode && storageOptedOut) {
    logger.warn('STRICT_MODE active but 0G Storage intentionally disabled (OG_INDEXER_RPC empty) — using local JSON journal fallback. Expected during hackathon window; revisit when 0G Storage KV stabilizes.');
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

  // Watch managed vaults for Deposited / Withdrawn and record a NAV snapshot
  // to the journal on each event — fills the gap between 5-minute cycles so
  // the dashboard chart reflects deposits/withdrawals immediately.
  await startVaultEventListener().catch((err) => {
    logger.warn(`Vault event listener init failed: ${err.message}`);
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
  const executorAddrs = resolveExecutorAddresses();
  const vaults = collectManagedVaultAddresses(executorAddrs);

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

    vaultResult.vaultState = {
      nav: vaultState.nav,
      baseBalance: vaultState.baseBalance,
      totalDeposited: vaultState.totalDeposited,
      primaryPositionAsset: vaultState.primaryPositionAsset || null,
    };

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

    // ── Strategy manifest load (V4 multi-strategy ext 1+2+6+7) ──
    // When the operator has published a manifest (manifestURI + manifestHash
    // set in OperatorRegistry.operatorExtended), fetch + verify + parse it.
    // Decision engine uses strategy.gates / scoring.weights / rules.
    // Failure modes (ext 7): each typed error skips the cycle cleanly so a
    // bad manifest doesn't burn gas on guaranteed reverts.
    if (operatorState?.manifestURI && operatorState?.manifestHash) {
      try {
        const { loadStrategy } = await import('../strategy/loader.js');
        const result = await loadStrategy({
          uri: operatorState.manifestURI,
          expectedHash: operatorState.manifestHash,
          operatorAddress: vaultState.executor,
        });
        vaultState._strategy = result.strategy;
        vaultState._strategyHash = result.hash;
        vaultState._strategySchemaVersion = result.schemaVersion;
        logger.info(`    Strategy: ${result.strategy.strategy.id} (${result.strategy.strategy.type}) hash=${result.hash.slice(0, 10)}... v${result.schemaVersion}`);
      } catch (err) {
        const errType = err.name || 'StrategyLoadError';
        logger.warn(`    Strategy load failed (${errType}): ${err.message?.slice(0, 200)} — skipping cycle for this vault`);
        vaultResult.status = `skipped_strategy_${errType.toLowerCase()}`;
        vaultResult.reason = err.message;
        return vaultResult;
      }
    }

    // V4-specific gate: vault binds an acceptedManifestHash on-chain. The
    // strategyHash the orchestrator submits MUST match this hash — otherwise
    // executeIntent reverts with WrongStrategyHash. We run this check OUTSIDE
    // the manifest-load block on purpose: audit found that when the operator
    // has not published a manifest URI at all (so the load block is skipped
    // entirely), the orchestrator would still submit a zero-hash intent
    // against a vault that expects nonzero — burning gas every cycle. The
    // updated isStrategyHashMismatch returns true for that "expected nonzero,
    // got zero/undefined" case, so we catch it here regardless of which path
    // got us here.
    if (isStrategyHashMismatch(vaultState, vaultState._strategyHash)) {
      const accepted = vaultState.acceptedManifestHash.toLowerCase();
      const loaded = (vaultState._strategyHash || '').toLowerCase();
      const loadedLabel = loaded ? `${loaded.slice(0, 10)}...` : 'no manifest published';
      logger.warn(`    V4 vault accepts strategy ${accepted.slice(0, 10)}... but operator currently publishes ${loadedLabel} — owner must approve manifest upgrade or operator must publish matching manifest. Skipping cycle.`);
      vaultResult.status = 'skipped_strategy_not_accepted_by_vault';
      vaultResult.reason = 'acceptedManifestHash mismatch';
      return vaultResult;
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
      // B1: counter increment via atomic helper so parallel cycles can't
      // collide on read-modify-write of `totalSkipped`.
      incrementCounters({ totalSkipped: 1 });
      updateKVState({
        lastSignal: decision,
        totalCycles: cycleCount,
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
      // B1: atomic increment to avoid lost updates when multiple vaults
      // are blocked in the same parallel cycle dispatch.
      incrementCounters({ totalBlocked: 1 });
      updateKVState({
        lastSignal: decision,
        totalCycles: cycleCount,
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

    // Sealed-mode vaults bind the AI inference output into the on-chain intent
    // via a non-zero `attestationReportHash`. Local heuristic fallback produces
    // no attestation (decision._computeResponse === null), so submitting would
    // revert with `MissingAttestationReport` (selector 0x277fabd5). Skip the
    // cycle and wait for the next 0G Compute attempt — better than burning a
    // commit-reveal pair on a guaranteed revert.
    if (vaultState.policy?.sealedMode === true && !decision._computeResponse) {
      logger.warn(`    Sealed-mode vault: AI inference unavailable (using local fallback) — skipping submission to avoid MissingAttestationReport revert. Will retry next cycle.`);
      vaultResult.status = 'skipped_no_attestation';
      updateKVState({
        lastSignal: decision,
        totalCycles: cycleCount,
        positionState: vaultPositions,
      });
      return vaultResult;
    }

    // Build + submit intent. CoinGecko (the marketSummary source) doesn't
    // list 0G yet, so its `oraclePrices` map is missing 0G. Pyth carries it
    // — merge Pyth into the price map so SELL 0G / BUY 0G can derive a
    // sensible `oracleMinOut`. Pyth wins on conflicts (it's the on-chain
    // truth source the vault would use anyway).
    const cgPrices = marketSummary.prices || {};
    let pythSnapshot = {};
    try {
      pythSnapshot = await fetchPythPrices();
    } catch (err) {
      logger.debug(`Pyth fetch failed inside cycle (using CoinGecko only): ${err.message}`);
    }
    const oraclePrices = { ...cgPrices };
    for (const [sym, snap] of Object.entries(pythSnapshot)) {
      if (snap?.price > 0) {
        oraclePrices[sym] = oraclePrices[sym]?.price > 0
          ? oraclePrices[sym]              // CoinGecko already had it — keep
          : { symbol: sym, price: snap.price, change24h: 0, volume24h: 0 };
      }
    }
    // Track 2: pass the raw 0G Compute response so the executor can derive the
    // TEE attestation report hash and bind it into the intent.
    const intent = await buildExecutionIntent(decision, vaultState, oraclePrices, decision._computeResponse);

    if (!intent) {
      vaultResult.status = 'error_intent';
      return vaultResult;
    }

    logger.info(`    Intent: ${intent.intentHash.substring(0, 18)}...`);

    // B2: atomic claim closes the race window between read (was
    // `isIntentSubmitted`) and write (`recordSubmittedIntent`) that spanned
    // the entire on-chain submit. Two parallel cycles previously could both
    // see the intent absent and both submit; on-chain ExecutionRegistry
    // catches the duplicate but the loser's gas is already burnt. Claim now,
    // unclaim on failure so retries can re-acquire.
    if (!tryClaimIntent(intent.intentHash)) {
      logger.warn(`    Intent ${intent.intentHash.substring(0, 18)} already submitted — skipping duplicate`);
      vaultResult.status = 'skipped_duplicate';
      return vaultResult;
    }

    // Phase 3 dispatch: Khalani path when (a) chooseRoute selected Khalani
    // AND (b) vault implementation exposes acceptCrossChainFill. Both V3 and
    // V4 vaults support it; V4 explicitly excludes the Khalani path from the
    // strategyHash binding (see AegisVault_v4.acceptCrossChainFill — no
    // WrongStrategyHash check). Anything else falls through to the on-chain
    // Jaine submission via submitIntent.
    const useKhalani = shouldUseKhalaniRoute(intent, vaultState);
    let execResult;
    if (useKhalani) {
      const versionLabel = vaultState.isV4 ? 'V4' : 'V3';
      logger.info(`    Routing via Khalani (${versionLabel} vault) — orderId pending`);
      execResult = await submitCrossChainIntent({
        intent,
        routeChoice: intent.routeChoice,
        vaultAddress,
        vaultState,
      });
      if (!execResult.success) {
        logger.warn(`    Khalani submission failed: ${execResult.error}. Falling back to Jaine.`);
        execResult = await submitIntent(intent, {
          sealedMode: vaultState.policy?.sealedMode === true,
          attestedSigner: vaultState.policy?.attestedSigner,
        });
      }
    } else {
      // Track 2: forward sealed-mode policy state from on-chain vault to executor.
      // When sealedMode=true, executor will run commit-reveal + TEE signature flow.
      execResult = await submitIntent(intent, {
        sealedMode: vaultState.policy?.sealedMode === true,
        attestedSigner: vaultState.policy?.attestedSigner,
      });
    }
    vaultResult.executionResult = execResult;
    logExecution(intent, execResult, decision, {
      vault: vaultAddress,
      sealedMode: vaultState.policy?.sealedMode === true,
      attestedSigner: vaultState.policy?.attestedSigner,
    });
    syncExecutionToOG(intent, execResult, decision).catch(() => {});

    if (execResult.success) {
      recordSubmittedIntent(intent.intentHash, execResult.txHash || null);
      logger.info(`    ✓ Executed on-chain. TX: ${execResult.txHash}`);
      vaultResult.status = 'executed';

      // Record to OperatorReputation so the operator detail page's track record
      // reflects actual activity. Volume is USDC-denominated 6-decimal: on BUY
      // it comes directly from the intent (assetIn=USDC), on SELL we use the
      // pre-sell notional in USD (intent.amountIn is the asset amount in its
      // native decimals, not comparable to USDC units). PnL is only realized
      // on SELL. Fire-and-forget: reputation failure shouldn't roll back a
      // trade that already settled.
      let volumeUsd6 = 0n;
      let pnlUsd6 = 0n;
      if (decision.action === 'buy') {
        volumeUsd6 = BigInt(intent.amountIn);
      } else if (decision.action === 'sell') {
        // Compute the sell notional + realized PnL in 6-decimal BigInts.
        // Going through Number * fraction first lost precision once notionals
        // crossed ~10M USDC and let occasional `sellFractionBps > 10000`
        // (an off-by-one from the decision engine) flip the sign of the
        // remaining-position math via 1 - fraction. Clamp to [0, 10000] up
        // front, then keep everything in scaled BigInts.
        const sellFractionBps = BigInt(Math.max(0, Math.min(
          Number(decision.sell_fraction_bps || decision.size_bps || 10000),
          10000,
        )));
        const notionalUsd6 = BigInt(Math.round((positionState.current_position_notional_usd || 0) * 1_000_000));
        volumeUsd6 = (notionalUsd6 * sellFractionBps) / 10000n;
        const costBasisFullUsd6 = BigInt(Math.round((positionState.position_cost_basis_usd || 0) * 1_000_000));
        if (costBasisFullUsd6 > 0n) {
          const costBasisSoldUsd6 = (costBasisFullUsd6 * sellFractionBps) / 10000n;
          pnlUsd6 = volumeUsd6 - costBasisSoldUsd6;
        }
      }
      recordExecutionToReputation(vaultState.executor, volumeUsd6, pnlUsd6, true).catch((err) => {
        logger.warn(`recordExecutionToReputation failed (will retry next cycle): ${err.message}`);
      });

      // Update position tracking
      if (decision.action === 'buy') {
        positionState.current_position_side = 'long';
        positionState.current_position_asset = decision.asset;
        positionState.current_position_notional_usd = (decision.size_bps / 10000) * vaultState.nav;
        positionState.position_cost_basis_usd = positionState.current_position_notional_usd;
        positionState.current_position_pnl_pct = 0;
        positionState.consecutive_losses = 0;
      } else if (decision.action === 'sell') {
        // Clamp to [0, 10000] up front so a stale decision with sellFraction
        // > 10000 (off-by-one from the engine) cannot turn fractionRemaining
        // negative — the previous Math.max(0, ...) just masked the bug.
        const sellFraction = Math.max(0, Math.min(
          Number(decision.sell_fraction_bps || decision.size_bps || 10000),
          10000,
        ));
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

      // B1: atomic increment to avoid lost updates when multiple vaults
      // execute concurrently within the same cycle dispatch.
      incrementCounters({ totalExecutions: 1 });
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
        positionState: vaultPositions,
      });
    } else {
      // B2: submit failed — release the claim so a manual retry (or the next
      // cycle, if the decision is still actionable) can re-acquire. Without
      // this the intentHash stays blocked for the dedup TTL even though no
      // on-chain receipt exists.
      unclaimIntent(intent.intentHash);
      logger.error(`    ✗ Failed: ${execResult.error}`);
      logAlert('critical', 'execution_failed', `Execution failed for ${decision.action.toUpperCase()} ${decision.asset}`, {
        vault: vaultAddress,
        action: decision.action,
        asset: decision.asset,
        error: execResult.error,
      });
      vaultResult.status = 'failed';
      // A tx revert / gas failure is an *operational* error, not a trading
      // loss. Previously we conflated the two by incrementing
      // `consecutive_losses` here — that made BUY gates in the decision
      // engine refuse subsequent trades because it thought the strategy was
      // in a losing streak. Track operational failures separately so the
      // trading logic stays independent of tx-submission reliability.
      positionState.consecutive_execution_failures =
        (positionState.consecutive_execution_failures || 0) + 1;
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
      managedVaults.map((vaultAddr) => limit(() => getPerVaultLimit(vaultAddr)(async () => {
        // B3: outer `limit` caps total in-flight vaults; inner per-vault
        // limiter (concurrency 1) guarantees mutations of the shared
        // `vaultPositions[vaultAddr]` from this cycle don't interleave
        // with another cycle that touched the same vault.
        try {
          return await runVaultCycle(vaultAddr, marketSummary);
        } catch (err) {
          logger.error(`  Vault ${vaultAddr.slice(0, 10)} error: ${err.message}`);
          return { vault: vaultAddr, status: 'error', error: err.message };
        }
      })))
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
  const executorAddresses = resolveExecutorAddresses();
  const executorAddress = executorAddresses[0] || null;
  const managedVaults = collectManagedVaultAddresses(executorAddresses);
  const trackedVaults = Object.keys(vaultPositions);

  return {
    running,
    cycleCount,
    executorAddress,
    executorAddresses,
    signerConfigured: executorAddresses.length > 0,
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
    managedVaults,
    managedVaultCount: managedVaults.length,
    trackedVaults,
    trackedVaultCount: trackedVaults.length,
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
