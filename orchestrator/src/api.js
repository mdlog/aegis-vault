import express from 'express';
import cors from 'cors';
import { Sentry } from './utils/sentry.js';
import config from './config/index.js';
import { runCycle, getStatus } from './services/orchestrator.js';
import { readVaultState } from './services/vaultReader.js';
import { readOperatorState } from './services/operatorReader.js';
import { fetchMarketData, buildMarketSummary } from './services/marketData.js';
import { readKVState, readJournal, flushJournalBuffer } from './services/storage.js';
import { isOGStorageAvailable, kvGet, readVaultStateFromOG } from './services/ogStorage.js';
import { listAvailableModels } from './services/ogCompute.js';
import { fetchPythPrices, calculateMultiAssetNAV } from './services/pythPrice.js';
import logger from './utils/logger.js';

function filterJournalEntries(entries, { type, vault, level }) {
  let filtered = entries;

  if (type) {
    filtered = filtered.filter((entry) => entry.type === type);
  }

  if (vault) {
    const targetVault = vault.toLowerCase();
    filtered = filtered.filter((entry) => {
      if ((entry.vault || '').toLowerCase() === targetVault) return true;
      if (Array.isArray(entry.vaultResults)) {
        return entry.vaultResults.some((r) => (r.vault || '').toLowerCase() === targetVault);
      }
      return false;
    });
  }

  if (level) {
    filtered = filtered.filter((entry) => entry.level === level);
  }

  return filtered;
}

// In-process fixed-window rate limiter for `/api/cycle`. Keyed by the
// presented API key (or by client IP if no key is required). The cycle path
// triggers an end-to-end inference + on-chain execution: a compromised API
// key spamming this endpoint translates directly to wasted gas on the
// executor wallet, so a hard ceiling here is cheaper than relying on the
// caller. Limits are conservative — a real run is ~30s, so 6/min leaves
// headroom for retries while killing a flood.
const CYCLE_RATE_WINDOW_MS = 60_000;
const CYCLE_RATE_MAX_PER_WINDOW = 6;
const cycleRateBuckets = new Map();

function rateLimitCycleRequest(req, apiKey) {
  const key = apiKey
    ? (req.get('x-api-key') || `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`)
    : `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
  const now = Date.now();
  let bucket = cycleRateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= CYCLE_RATE_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    cycleRateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > CYCLE_RATE_MAX_PER_WINDOW) {
    const retryAfterMs = CYCLE_RATE_WINDOW_MS - (now - bucket.windowStart);
    return { ok: false, retryAfterMs };
  }
  return { ok: true };
}

function isLoopbackAddress(value) {
  return value === '127.0.0.1' ||
    value === '::1' ||
    value === '::ffff:127.0.0.1';
}

// Only trust socket-level addresses. req.hostname comes from the Host header,
// which is client-controllable — a remote attacker sending `Host: localhost`
// would otherwise be mis-classified as loopback.
function isLoopbackRequest(req) {
  const candidates = [
    req.ip,
    req.socket?.remoteAddress,
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

// Reads are public by default, but "operator-level" reads (raw KV, 0G state
// dumps, status internals) require the same API key as mutations. When no key
// is configured, we still allow loopback-only to keep local dev ergonomic.
function isOperatorAuthorized(req, apiKey) {
  if (!apiKey) return isLoopbackRequest(req);
  return req.get('x-api-key') === apiKey;
}

// Public journal view drops fields that reveal the operator's internal
// strategy heuristics. Action / asset / size / tx hash / timestamps stay
// (those mirror what is observable on-chain anyway) so the dashboard's
// action-feed still renders without an API key. Operator-authenticated
// callers get the full record by passing this through unchanged.
const PUBLIC_JOURNAL_FIELD_BLACKLIST = new Set([
  'reason',
  'reason_hint',
  'regime',
  'final_edge_score',
  'trade_quality_score',
  'hard_veto',
  'hard_veto_reasons',
  'entry_trigger',
  'approval_reasons',
  'risk_score',
  'v1_action',
  '_computeResponse',
]);
function sanitizeJournalEntry(entry, isOperator) {
  if (isOperator || !entry || typeof entry !== 'object') return entry;
  const out = {};
  for (const [k, v] of Object.entries(entry)) {
    if (PUBLIC_JOURNAL_FIELD_BLACKLIST.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function sanitizeStatusForPublic(status) {
  if (!status || typeof status !== 'object') return status;
  // Strip fields that leak operator internals (deployment file paths, auth
  // mode, raw wallet pool stats, pending approval payloads). Keep
  // `executorAddress`/`executorAddresses` — they are public on-chain anyway
  // (readable from `AegisVault.executor()` view function), and the frontend
  // uses them to render "Matched / Different / Offline" sync status.
  const {
    configuredVault: _cv,
    deploymentsFile: _df,
    mutationAuthMode: _mam,
    pendingApprovals: _pa,
    poolStats: _ps,
    ...publicFields
  } = status;
  return {
    ...publicFields,
    // Keep the count; drop the detailed map (which includes vault IDs + payloads).
    pendingApprovalCount: status.pendingApprovalCount
      ?? Object.keys(status.pendingApprovals || {}).length,
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

  if (config.strictMode && !apiKey) {
    throw new Error('orchestrator_api_key_required_in_strict_mode');
  }

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
    // Fail closed when there's any sign we're running in production: STRICT_MODE,
    // NODE_ENV=production, or a Sentry environment that says production. The
    // wildcard CORS path is dev-only and an empty allowlist on a production
    // deploy used to silently expose `/api/journal` and `/api/state` to any
    // origin that knew the URL.
    const looksProduction = (
      config.strictMode ||
      process.env.NODE_ENV === 'production' ||
      process.env.SENTRY_ENVIRONMENT === 'production'
    );
    if (looksProduction) {
      logger.error('CORS_ALLOWED_ORIGINS is empty in a production-like environment. Refusing to enable wildcard CORS.');
      throw new Error('cors_allowlist_required_in_production');
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

  function requireOperatorAuth(req, res, next) {
    if (isOperatorAuthorized(req, apiKey)) return next();
    return res.status(401).json({ error: 'Operator API key required' });
  }

  // ── Health ──

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── Orchestrator Status ──

  app.get('/api/status', (req, res) => {
    const status = getStatusFn();
    if (isOperatorAuthorized(req, apiKey)) {
      return res.json(status);
    }
    res.json(sanitizeStatusForPublic(status));
  });

  // ── Trigger Manual Cycle ──

  function requireCycleRateLimit(req, res, next) {
    const verdict = rateLimitCycleRequest(req, apiKey);
    if (!verdict.ok) {
      const retryAfterSec = Math.max(1, Math.ceil(verdict.retryAfterMs / 1000));
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: 'Too many cycle requests',
        retryAfterMs: verdict.retryAfterMs,
      });
    }
    next();
  }

  app.post('/api/cycle', requireMutationAuth, requireCycleRateLimit, async (req, res) => {
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

  app.get('/api/state', requireOperatorAuth, (req, res) => {
    const state = readKVStateFn();
    res.json(state);
  });

  // Journal endpoints stay public so the connected-wallet dashboard can
  // render the action-feed without an API key (the frontend bundle cannot
  // safely carry one — VITE_* env is inlined into the public JS bundle).
  // To reduce strategy-pattern leakage, public requests get a sanitized
  // view that drops the operator's internal scoring fields (regime, edge
  // score, hard-veto reasons, approval rationale, prompt-derived `reason`).
  // Operator-authenticated requests (x-api-key) get the full record.
  app.get('/api/journal', (req, res) => {
    const journal = readJournalFn();
    const limit = parseInt(req.query.limit) || 50;
    const entries = filterJournalEntries(journal, {
      type: req.query.type,
      vault: req.query.vault,
      level: req.query.level,
    });
    const isOperator = isOperatorAuthorized(req, apiKey);
    res.json(entries.slice(-limit).reverse().map((e) => sanitizeJournalEntry(e, isOperator)));
  });

  app.get('/api/journal/decisions', (req, res) => {
    const journal = readJournalFn();
    const limit = parseInt(req.query.limit) || 20;
    const decisions = filterJournalEntries(journal, {
      type: 'decision',
      vault: req.query.vault,
    });
    const isOperator = isOperatorAuthorized(req, apiKey);
    res.json(decisions.slice(-limit).reverse().map((e) => sanitizeJournalEntry(e, isOperator)));
  });

  app.get('/api/journal/executions', (req, res) => {
    const journal = readJournalFn();
    const limit = parseInt(req.query.limit) || 20;
    const executions = filterJournalEntries(journal, {
      type: 'execution',
      vault: req.query.vault,
    });
    const isOperator = isOperatorAuthorized(req, apiKey);
    res.json(executions.slice(-limit).reverse().map((e) => sanitizeJournalEntry(e, isOperator)));
  });

  app.get('/api/alerts', (req, res) => {
    const journal = readJournalFn();
    const limit = parseInt(req.query.limit) || 10;
    const alerts = filterJournalEntries(journal, {
      type: 'alert',
      vault: req.query.vault,
      level: req.query.level,
    });
    const isOperator = isOperatorAuthorized(req, apiKey);
    res.json(alerts.slice(-limit).reverse().map((e) => sanitizeJournalEntry(e, isOperator)));
  });

  // ── 0G Compute (model discovery for operator registration UI) ──

  app.get('/api/og-compute/models', async (req, res) => {
    try {
      const models = await listAvailableModels();
      res.json({ models, count: models.length });
    } catch (err) {
      res.status(500).json({ error: err.message, models: [] });
    }
  });

  // ── 0G Storage ──

  app.get('/api/og/status', (req, res) => {
    res.json({
      available: isOGStorageAvailableFn(),
      indexer: process.env.OG_INDEXER_RPC || 'https://indexer-storage-testnet-turbo.0g.ai',
      kvNode: process.env.OG_KV_RPC || 'http://3.101.147.150:6789',
    });
  });

  app.get('/api/og/state', requireOperatorAuth, async (req, res) => {
    try {
      const state = await readVaultStateFromOGFn();
      res.json(state || { error: 'No state found in 0G Storage' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // KV keys are user-supplied via the URL path. Restrict the character set
  // and reject path-traversal sequences so the key cannot escape into a
  // namespace the SDK / kvSet does not own. Whitelist the prefixes that the
  // orchestrator itself writes — anything else is out of scope for this
  // endpoint and should not be reachable from the public surface.
  const ALLOWED_KV_PREFIXES = ['vault-', 'decision-', 'execution-', 'cycle-', 'manifest-'];
  app.get('/api/og/kv/:key', requireOperatorAuth, async (req, res) => {
    const key = String(req.params.key || '');
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(key) || !ALLOWED_KV_PREFIXES.some((p) => key.startsWith(p))) {
      return res.status(400).json({ error: 'invalid_kv_key' });
    }
    try {
      const value = await kvGetFn(key);
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

  // Sentry Express error handler — must come AFTER all routes. No-op when DSN unset.
  Sentry.setupExpressErrorHandler(app);

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
    logger.info('  GET  /api/og-compute/models  — Available AI models (0G Compute)');
    logger.info('  GET  /api/og/status          — 0G Storage status');
    logger.info('  GET  /api/og/state           — 0G KV state');
    logger.info('  GET  /api/og/kv/:key         — Read 0G KV key');
    logger.info('  POST /api/og/flush           — Flush journal to 0G');
  });

  return server;
}

export { authorizeMutationRequest, isOperatorAuthorized, sanitizeStatusForPublic };
