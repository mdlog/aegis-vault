import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

/**
 * StorageService
 * Handles persistent storage for the orchestrator.
 *
 * In production, this writes to 0G Storage (KV for state, append-only for journal).
 * For MVP / local development, we use a local file-based store that mirrors
 * the 0G Storage structure, making it trivial to swap in the real SDK later.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = resolve(__dirname, '../../data');
const KV_FILE = resolve(STORAGE_DIR, 'kv-state.json');
const JOURNAL_FILE = resolve(STORAGE_DIR, 'journal.json');

// Ensure storage directory exists
if (!existsSync(STORAGE_DIR)) {
  mkdirSync(STORAGE_DIR, { recursive: true });
}

// ── KV State (mutable, latest snapshot) ──

/**
 * Read the current KV state
 */
export function readKVState() {
  try {
    if (existsSync(KV_FILE)) {
      return JSON.parse(readFileSync(KV_FILE, 'utf8'));
    }
  } catch (err) {
    logger.warn(`Failed to read KV state: ${err.message}`);
  }
  return getDefaultKVState();
}

/**
 * Write updated KV state
 */
export function writeKVState(state) {
  try {
    writeFileSync(KV_FILE, JSON.stringify(state, null, 2));
    logger.debug('KV state updated');
  } catch (err) {
    logger.error(`Failed to write KV state: ${err.message}`);
  }
}

/**
 * Update specific fields in KV state
 */
export function updateKVState(updates) {
  const state = readKVState();
  const updated = { ...state, ...updates, updatedAt: new Date().toISOString() };
  writeKVState(updated);
  return updated;
}

function getDefaultKVState() {
  return {
    vaultAddress: null,
    lastNAV: 0,
    lastRiskScore: 0,
    lastSignal: null,
    lastExecutionSummary: null,
    currentAllocation: [],
    totalCycles: 0,
    totalExecutions: 0,
    totalBlocked: 0,
    totalSkipped: 0,
    updatedAt: new Date().toISOString(),
  };
}

// ── Journal (append-only log) ──

/**
 * Read all journal entries
 */
export function readJournal() {
  try {
    if (existsSync(JOURNAL_FILE)) {
      return JSON.parse(readFileSync(JOURNAL_FILE, 'utf8'));
    }
  } catch (err) {
    logger.warn(`Failed to read journal: ${err.message}`);
  }
  return [];
}

/**
 * Append a new entry to the journal
 */
export function appendJournal(entry) {
  try {
    const journal = readJournal();
    const journalEntry = {
      id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    journal.push(journalEntry);

    // Keep last 1000 entries
    const trimmed = journal.slice(-1000);
    writeFileSync(JOURNAL_FILE, JSON.stringify(trimmed, null, 2));

    logger.debug(`Journal entry added: ${journalEntry.id}`);
    return journalEntry;
  } catch (err) {
    logger.error(`Failed to append journal: ${err.message}`);
    return null;
  }
}

// ── Structured Journal Entry Builders ──

/**
 * Log a full orchestrator cycle
 */
export function logCycle(cycleData) {
  return appendJournal({
    type: 'cycle',
    cycle: cycleData.cycleNumber,
    marketSummary: cycleData.marketSummary,
    decision: cycleData.decision,
    policyResult: cycleData.policyResult,
    executionResult: cycleData.executionResult,
    duration_ms: cycleData.duration,
  });
}

/**
 * Log an AI decision
 */
export function logDecision(decision, marketPrices) {
  return appendJournal({
    type: 'decision',
    action: decision.action,
    asset: decision.asset,
    size_bps: decision.size_bps,
    confidence: decision.confidence,
    risk_score: decision.risk_score,
    reason: decision.reason,
    source: decision.source || 'unknown',
    // v1 extended fields
    regime: decision.regime,
    v1_action: decision.v1_action,
    final_edge_score: decision.final_edge_score,
    trade_quality_score: decision.trade_quality_score,
    hard_veto: decision.hard_veto,
    hard_veto_reasons: decision.hard_veto_reasons,
    entry_trigger: decision.entry_trigger,
    market_snapshot: Object.entries(marketPrices).map(([sym, d]) => ({
      symbol: sym,
      price: d.price,
      change24h: d.change24h,
    })),
  });
}

/**
 * Log a policy check result
 */
export function logPolicyCheck(decision, result) {
  return appendJournal({
    type: 'policy_check',
    action: decision.action,
    asset: decision.asset,
    valid: result.valid,
    reason: result.reason || 'All checks passed',
  });
}

/**
 * Log an execution result
 */
export function logExecution(intent, result) {
  return appendJournal({
    type: 'execution',
    intentHash: intent?.intentHash,
    success: result.success,
    txHash: result.txHash || null,
    error: result.error || null,
  });
}

/**
 * Log a system event (pause, unpause, policy change, etc.)
 */
export function logSystemEvent(eventType, details) {
  return appendJournal({
    type: 'system',
    event: eventType,
    details,
  });
}

// ── 0G Storage Integration ──

import {
  isOGStorageAvailable,
  syncVaultState,
  uploadJournalBatch,
  uploadDecisionSnapshot,
  uploadExecutionReport,
} from './ogStorage.js';

// Journal buffer — batches entries before uploading to 0G
let journalBuffer = [];
const JOURNAL_BATCH_SIZE = 5;

/**
 * Sync KV state to 0G Storage
 * Writes to local file AND 0G KV store (if available)
 */
export async function syncKVToOGStorage(state) {
  if (!isOGStorageAvailable()) {
    logger.debug('0G Storage not available — local only');
    return;
  }

  try {
    await syncVaultState(state);
    logger.info('KV state synced to 0G Storage');
  } catch (err) {
    logger.warn(`0G KV sync failed: ${err.message} — local state preserved`);
  }
}

/**
 * Append entry to 0G Storage
 * Buffers entries and uploads in batches for efficiency
 */
export async function appendToOGStorage(entry) {
  journalBuffer.push(entry);

  if (!isOGStorageAvailable()) {
    logger.debug('0G Storage not available — buffered locally');
    return;
  }

  // Upload batch when buffer is full
  if (journalBuffer.length >= JOURNAL_BATCH_SIZE) {
    try {
      const batch = [...journalBuffer];
      journalBuffer = [];
      const result = await uploadJournalBatch(batch);
      if (result) {
        logger.info(`Journal batch uploaded to 0G Storage — rootHash: ${result.rootHash.substring(0, 18)}...`);
      }
    } catch (err) {
      logger.warn(`0G journal batch upload failed: ${err.message}`);
    }
  }
}

/**
 * Upload a decision snapshot to 0G Storage (called from orchestrator)
 */
export async function syncDecisionToOG(decision, marketData, vaultState) {
  if (!isOGStorageAvailable()) return null;
  try {
    return await uploadDecisionSnapshot(decision, marketData, vaultState);
  } catch (err) {
    logger.warn(`Decision snapshot upload failed: ${err.message}`);
    return null;
  }
}

/**
 * Upload an execution report to 0G Storage (called from orchestrator)
 */
export async function syncExecutionToOG(intent, result, decision) {
  if (!isOGStorageAvailable()) return null;
  try {
    return await uploadExecutionReport(intent, result, decision);
  } catch (err) {
    logger.warn(`Execution report upload failed: ${err.message}`);
    return null;
  }
}

/**
 * Flush remaining journal buffer to 0G Storage
 */
export async function flushJournalBuffer() {
  if (journalBuffer.length === 0) return;
  if (!isOGStorageAvailable()) return;

  try {
    const batch = [...journalBuffer];
    journalBuffer = [];
    await uploadJournalBatch(batch);
    logger.info(`Flushed ${batch.length} journal entries to 0G Storage`);
  } catch (err) {
    logger.warn(`Journal flush failed: ${err.message}`);
  }
}
