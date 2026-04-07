import express from 'express';
import cors from 'cors';
import config from './config/index.js';
import { runCycle, getStatus } from './services/orchestrator.js';
import { readVaultState } from './services/vaultReader.js';
import { readOperatorState } from './services/operatorReader.js';
import { fetchMarketData, buildMarketSummary } from './services/marketData.js';
import { readKVState, readJournal, flushJournalBuffer } from './services/storage.js';
import { isOGStorageAvailable, kvGet, readVaultStateFromOG } from './services/ogStorage.js';
import { fetchPythPrices, calculateMultiAssetNAV } from './services/pythPrice.js';
import logger from './utils/logger.js';

function filterJournalEntries(entries, { type, vault, level }) {
  let filtered = entries;

  if (type) {
    filtered = filtered.filter((entry) => entry.type === type);
  }

  if (vault) {
    const targetVault = vault.toLowerCase();
    filtered = filtered.filter((entry) => (entry.vault || '').toLowerCase() === targetVault);
  }

  if (level) {
    filtered = filtered.filter((entry) => entry.level === level);
  }

  return filtered;
}

function isLoopbackAddress(value) {
  return value === '127.0.0.1' ||
    value === '::1' ||
    value === '::ffff:127.0.0.1' ||
    value === 'localhost';
}

function isLoopbackRequest(req) {
  const candidates = [
    req.ip,
    req.socket?.remoteAddress,
    req.hostname,
  ].filter(Boolean);

  return candidates.some(isLoopbackAddress);
}

function authorizeMutationRequest(req, apiKey) {
  if (apiKey) {
    const provided = req.get('x-api-key');
    if (provided === apiKey) {
      return { ok: true };
    }

    return {
      ok: false,
      status: 401,
      error: 'Missing or invalid API key',
    };
  }

  if (isLoopbackRequest(req)) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 403,
    error: 'Manual mutation routes are limited to localhost when no API key is configured',
  };
}

export function createApp(overrides = {}) {
  const {
    runCycle: runCycleFn = runCycle,
    getStatus: getStatusFn = getStatus,
    readVaultState: readVaultStateFn = readVaultState,
    fetchMarketData: fetchMarketDataFn = fetchMarketData,
    buildMarketSummary: buildMarketSummaryFn = buildMarketSummary,
    readKVState: readKVStateFn = readKVState,
    readJournal: readJournalFn = readJournal,
    flushJournalBuffer: flushJournalBufferFn = flushJournalBuffer,
    isOGStorageAvailable: isOGStorageAvailableFn = isOGStorageAvailable,
    kvGet: kvGetFn = kvGet,
    readVaultStateFromOG: readVaultStateFromOGFn = readVaultStateFromOG,
    fetchPythPrices: fetchPythPricesFn = fetchPythPrices,
    calculateMultiAssetNAV: calculateMultiAssetNAVFn = calculateMultiAssetNAV,
    apiKey = config.apiKey,
  } = overrides;

  const app = express();

  // CORS — production deployments must set CORS_ALLOWED_ORIGINS to a comma-separated
  // list of frontend origins (e.g. https://app.aegisvault.io). Empty list = allow all
  // (dev mode only).
  const allowedOrigins = config.corsAllowedOrigins;
  if (allowedOrigins.length > 0) {
    app.use(cors({
      origin(origin, cb) {
        // Allow same-origin / curl (no Origin header)
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
    }));
    logger.info(`CORS allowlist active: ${allowedOrigins.join(', ')}`);
  } else {
    if (config.strictMode) {
      logger.error('STRICT_MODE: CORS_ALLOWED_ORIGINS is empty. Refusing to enable wildcard CORS.');
      throw new Error('cors_allowlist_required_in_strict_mode');
    }
    app.use(cors());
    logger.warn('CORS in wildcard mode (dev only). Set CORS_ALLOWED_ORIGINS for production.');
  }

  app.use(express.json());

  function requireMutationAuth(req, res, next) {
    const auth = authorizeMutationRequest(req, apiKey);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }
    next();
  }

  // ── Health ──

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── Orchestrator Status ──

  app.get('/api/status', (req, res) => {
    const status = getStatusFn();
    res.json(status);
  });

  // ── Trigger Manual Cycle ──

  app.post('/api/cycle', requireMutationAuth, async (req, res) => {
    try {
      logger.info('Manual cycle triggered via API');
      const result = await runCycleFn();
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Vault State ──

  app.get('/api/vault', async (req, res) => {
    try {
      const vaultAddress = req.query.vault || config.contracts.vault;
      if (!vaultAddress) {
        return res.status(400).json({ error: 'VAULT_ADDRESS not configured' });
      }
      const state = await readVaultStateFn(vaultAddress);
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Operator State (Phase 2-5: stake, reputation, fees) ──

  app.get('/api/operator', async (req, res) => {
    try {
      const operatorAddress = req.query.address;
      if (!operatorAddress) {
        return res.status(400).json({ error: 'address query parameter required' });
      }
      const state = await readOperatorState(operatorAddress);
      res.json(state || { registered: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Market Data ──

  app.get('/api/market', async (req, res) => {
    try {
      const data = await fetchMarketDataFn();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/market/summary', async (req, res) => {
    try {
      const summary = await buildMarketSummaryFn();
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Pyth Oracle / NAV ──

  app.get('/api/pyth/prices', async (req, res) => {
    try {
      const prices = await fetchPythPricesFn();
      res.json(prices);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/nav', async (req, res) => {
    try {
      const vaultAddress = req.query.vault || config.contracts.vault;
      if (!vaultAddress) {
        return res.status(400).json({ error: 'No vault address provided' });
      }
      const nav = await calculateMultiAssetNAVFn(vaultAddress);
      res.json(nav);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Storage / Journal ──

  app.get('/api/state', (req, res) => {
    const state = readKVStateFn();
    res.json(state);
  });

  app.get('/api/journal', (req, res) => {
    const journal = readJournalFn();
    const limit = parseInt(req.query.limit) || 50;
    const entries = filterJournalEntries(journal, {
      type: req.query.type,
      vault: req.query.vault,
      level: req.query.level,
    });

    res.json(entries.slice(-limit).reverse());
  });

  app.get('/api/journal/decisions', (req, res) => {
    const journal = readJournalFn();
    const limit = parseInt(req.query.limit) || 20;
    const decisions = filterJournalEntries(journal, {
      type: 'decision',
      vault: req.query.vault,
    });
    res.json(decisions.slice(-limit).reverse());
  });

  app.get('/api/journal/executions', (req, res) => {
    const journal = readJournalFn();
    const limit = parseInt(req.query.limit) || 20;
    const executions = filterJournalEntries(journal, {
      type: 'execution',
      vault: req.query.vault,
    });
    res.json(executions.slice(-limit).reverse());
  });

  app.get('/api/alerts', (req, res) => {
    const journal = readJournalFn();
    const limit = parseInt(req.query.limit) || 10;
    const alerts = filterJournalEntries(journal, {
      type: 'alert',
      vault: req.query.vault,
      level: req.query.level,
    });
    res.json(alerts.slice(-limit).reverse());
  });

  // ── 0G Storage ──

  app.get('/api/og/status', (req, res) => {
    res.json({
      available: isOGStorageAvailableFn(),
      indexer: process.env.OG_INDEXER_RPC || 'https://indexer-storage-testnet-turbo.0g.ai',
      kvNode: process.env.OG_KV_RPC || 'http://3.101.147.150:6789',
    });
  });

  app.get('/api/og/state', async (req, res) => {
    try {
      const state = await readVaultStateFromOGFn();
      res.json(state || { error: 'No state found in 0G Storage' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/og/kv/:key', async (req, res) => {
    try {
      const value = await kvGetFn(req.params.key);
      res.json(value || { error: 'Key not found' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/og/flush', requireMutationAuth, async (req, res) => {
    try {
      await flushJournalBufferFn();
      res.json({ success: true, message: 'Journal buffer flushed to 0G Storage' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

const app = createApp();

// ── Start Server ──

export function startAPI() {
  const server = app.listen(config.port, () => {
    logger.info(`API server running on http://localhost:${config.port}`);
    logger.info('Endpoints:');
    logger.info('  GET  /api/health             — Health check');
    logger.info('  GET  /api/status             — Orchestrator status');
    logger.info('  POST /api/cycle              — Trigger manual cycle');
    logger.info('  GET  /api/vault              — Read vault state');
    logger.info('  GET  /api/market             — Market prices');
    logger.info('  GET  /api/market/summary     — Full market summary');
    logger.info('  GET  /api/state              — KV state (local)');
    logger.info('  GET  /api/journal            — Journal entries');
    logger.info('  GET  /api/journal/decisions   — AI decisions');
    logger.info('  GET  /api/journal/executions  — Execution log');
    logger.info('  GET  /api/alerts             — Alerts / approvals');
    logger.info('  GET  /api/og/status          — 0G Storage status');
    logger.info('  GET  /api/og/state           — 0G KV state');
    logger.info('  GET  /api/og/kv/:key         — Read 0G KV key');
    logger.info('  POST /api/og/flush           — Flush journal to 0G');
  });

  return server;
}

export { authorizeMutationRequest };
