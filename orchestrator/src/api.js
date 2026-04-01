import express from 'express';
import cors from 'cors';
import config from './config/index.js';
import { runCycle, getStatus } from './services/orchestrator.js';
import { readVaultState } from './services/vaultReader.js';
import { fetchMarketData, buildMarketSummary } from './services/marketData.js';
import { readKVState, readJournal, flushJournalBuffer } from './services/storage.js';
import { isOGStorageAvailable, kvGet, readVaultStateFromOG } from './services/ogStorage.js';
import { fetchPythPrices, calculateMultiAssetNAV } from './services/pythPrice.js';
import logger from './utils/logger.js';

const app = express();
app.use(cors());
app.use(express.json());

// ── Health ──

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Orchestrator Status ──

app.get('/api/status', (req, res) => {
  const status = getStatus();
  res.json(status);
});

// ── Trigger Manual Cycle ──

app.post('/api/cycle', async (req, res) => {
  try {
    logger.info('Manual cycle triggered via API');
    const result = await runCycle();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Vault State ──

app.get('/api/vault', async (req, res) => {
  try {
    const vaultAddress = config.contracts.vault;
    if (!vaultAddress) {
      return res.status(400).json({ error: 'VAULT_ADDRESS not configured' });
    }
    const state = await readVaultState(vaultAddress);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Market Data ──

app.get('/api/market', async (req, res) => {
  try {
    const data = await fetchMarketData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/market/summary', async (req, res) => {
  try {
    const summary = await buildMarketSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pyth Oracle / NAV ──

app.get('/api/pyth/prices', async (req, res) => {
  try {
    const prices = await fetchPythPrices();
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
    const nav = await calculateMultiAssetNAV(
      vaultAddress,
      { usdc: config.contracts.usdc, wbtc: config.contracts.wbtc, weth: config.contracts.weth }
    );
    res.json(nav);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Storage / Journal ──

app.get('/api/state', (req, res) => {
  const state = readKVState();
  res.json(state);
});

app.get('/api/journal', (req, res) => {
  const journal = readJournal();
  const limit = parseInt(req.query.limit) || 50;
  const type = req.query.type; // filter by type

  let entries = journal;
  if (type) {
    entries = entries.filter(e => e.type === type);
  }

  res.json(entries.slice(-limit).reverse());
});

app.get('/api/journal/decisions', (req, res) => {
  const journal = readJournal();
  const limit = parseInt(req.query.limit) || 20;
  const decisions = journal.filter(e => e.type === 'decision');
  res.json(decisions.slice(-limit).reverse());
});

app.get('/api/journal/executions', (req, res) => {
  const journal = readJournal();
  const limit = parseInt(req.query.limit) || 20;
  const executions = journal.filter(e => e.type === 'execution');
  res.json(executions.slice(-limit).reverse());
});

// ── 0G Storage ──

app.get('/api/og/status', (req, res) => {
  res.json({
    available: isOGStorageAvailable(),
    indexer: process.env.OG_INDEXER_RPC || 'https://indexer-storage-testnet-turbo.0g.ai',
    kvNode: process.env.OG_KV_RPC || 'http://3.101.147.150:6789',
  });
});

app.get('/api/og/state', async (req, res) => {
  try {
    const state = await readVaultStateFromOG();
    res.json(state || { error: 'No state found in 0G Storage' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/og/kv/:key', async (req, res) => {
  try {
    const value = await kvGet(req.params.key);
    res.json(value || { error: 'Key not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/og/flush', async (req, res) => {
  try {
    await flushJournalBuffer();
    res.json({ success: true, message: 'Journal buffer flushed to 0G Storage' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start Server ──

export function startAPI() {
  app.listen(config.port, () => {
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
    logger.info('  GET  /api/og/status          — 0G Storage status');
    logger.info('  GET  /api/og/state           — 0G KV state');
    logger.info('  GET  /api/og/kv/:key         — Read 0G KV key');
    logger.info('  POST /api/og/flush           — Flush journal to 0G');
  });

  return app;
}
