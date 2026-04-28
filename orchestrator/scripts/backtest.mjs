#!/usr/bin/env node
/**
 * Aegis Vault — Strategy Backtest CLI
 * ====================================
 *
 * Usage:
 *   node scripts/backtest.mjs --manifest <path> --asset ETH --period 90d \
 *     [--start-capital 10000] [--ohlcv <file>] [--verbose] [--json]
 *
 * Loads a strategy manifest, validates it against schema-v1, then replays
 * it against historical OHLCV (CoinGecko by default, or a local file with
 * --ohlcv) and prints trade metrics. Used by operators to sanity-check a
 * manifest *before* publishing it on-chain.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { validateManifest } from '../src/strategy/validator.js';
import {
  runBacktest,
  generateSyntheticOHLCV,
  fetchCoinGeckoOHLCV,
} from '../src/services/backtester.js';

// ── CLI parser ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--verbose') { out.verbose = true; continue; }
    if (a === '--json') { out.json = true; continue; }
    if (a === '--synthetic') { out.synthetic = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next == null || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    }
  }
  return out;
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`Aegis Vault — Strategy Backtest CLI

Usage:
  node scripts/backtest.mjs --manifest <path> --asset <symbol> [options]

Required:
  --manifest <path>          Path to strategy JSON manifest
  --asset <symbol>           Asset symbol (e.g. BTC, ETH)

Options:
  --period <duration>        Backtest period: 7d|30d|90d|180d|1y (default: 90d)
  --start-capital <usd>      Initial capital in USD (default: 10000)
  --ohlcv <path>             Local OHLCV file (JSON or CSV) — overrides CoinGecko fetch
  --synthetic                Generate synthetic OHLCV (offline, deterministic)
  --verbose                  Print every decision step
  --json                     Emit machine-readable JSON instead of pretty table
  --help, -h                 Show this help

Examples:
  node scripts/backtest.mjs --manifest ./strategies/trend-following-v1.json --asset ETH --period 90d
  node scripts/backtest.mjs --manifest ./my.json --asset BTC --ohlcv ./test/fixtures/btc-90d.json
  node scripts/backtest.mjs --manifest ./my.json --asset ETH --synthetic --period 30d
`);
}

function parseDuration(d) {
  if (!d) return 90;
  const m = String(d).match(/^(\d+)\s*(d|w|y)$/i);
  if (!m) {
    const n = Number(d);
    if (Number.isFinite(n) && n > 0) return n;
    throw new Error(`Invalid period: ${d} (expected formats: 7d, 30d, 90d, 1y)`);
  }
  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'd') return value;
  if (unit === 'w') return value * 7;
  if (unit === 'y') return value * 365;
  return 90;
}

function loadOhlcvFile(path) {
  const abs = resolvePath(path);
  if (!existsSync(abs)) throw new Error(`OHLCV file not found: ${abs}`);
  const raw = readFileSync(abs, 'utf8');
  if (abs.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('JSON OHLCV must be an array');
    return parsed.map(normaliseRow);
  }
  // Assume CSV: header expected. Columns: timestamp,open,high,low,close,volume
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(',').map((c) => c.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    out.push(normaliseRow({
      timestamp: Number(cols[idx('timestamp')]),
      open: Number(cols[idx('open')]),
      high: Number(cols[idx('high')]),
      low: Number(cols[idx('low')]),
      close: Number(cols[idx('close')]),
      volume: Number(cols[idx('volume')] ?? 1_000_000),
    }));
  }
  return out;
}

function normaliseRow(row) {
  return {
    timestamp: Number(row.timestamp ?? row.ts ?? row.time ?? 0),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume ?? 1_000_000),
  };
}

function fmtUsd(n) {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
function fmtPct(n, sign = true) {
  const v = n * 100;
  const prefix = sign && v >= 0 ? '+' : '';
  return `${prefix}${v.toFixed(1)}%`;
}

function pad(s, n) {
  s = String(s);
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

function printTable(result, manifestValid) {
  const m = result.metrics;
  const lines = [];
  const W = 46;
  const top    = '+' + '-'.repeat(W) + '+';
  const sep    = '+' + '-'.repeat(W) + '+';
  const row = (label, value) => `| ${pad(label, 18)} ${pad(value, W - 21)}|`;
  lines.push(top);
  lines.push(`| ${pad(`Backtest: ${result.strategy_id}`, W - 2)}|`);
  lines.push(sep);
  const days = Math.round((result.period.end - result.period.start) / 86_400_000);
  lines.push(row('Period:', `${days} days (${result.period.candles} candles)`));
  lines.push(row('Asset:', `${result.symbol} (${result.asset})`));
  lines.push(row('Start capital:', fmtUsd(result.start_capital)));
  lines.push(row('End capital:', fmtUsd(result.end_capital)));
  lines.push(row('Total return:', fmtPct(m.totalReturn)));
  lines.push(row('Trades:', `${m.totalTrades} (${m.winningTrades} win / ${m.losingTrades} loss)`));
  lines.push(row('Win rate:', m.totalTrades > 0 ? `${(m.winRate * 100).toFixed(1)}%` : 'n/a'));
  lines.push(row('Max drawdown:', fmtPct(m.maxDrawdown, false)));
  lines.push(row('Sharpe ratio:', m.sharpeRatio.toFixed(2)));
  lines.push(row('Avg holding:', `${m.avgHoldingDays.toFixed(2)} days`));
  lines.push(row('Manifest valid:', manifestValid ? 'OK' : 'FAILED'));
  lines.push(top);
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

  if (!args.manifest) {
    // eslint-disable-next-line no-console
    console.error('Error: --manifest is required\n');
    printHelp();
    process.exit(2);
  }
  if (!args.asset) {
    // eslint-disable-next-line no-console
    console.error('Error: --asset is required\n');
    printHelp();
    process.exit(2);
  }

  const manifestPath = resolvePath(args.manifest);
  if (!existsSync(manifestPath)) {
    // eslint-disable-next-line no-console
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(2);
  }
  const manifestRaw = readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Manifest JSON parse error: ${err.message}`);
    process.exit(2);
  }

  const validation = validateManifest(manifest);
  if (!validation.ok) {
    // eslint-disable-next-line no-console
    console.error(`Manifest validation FAILED:`);
    for (const e of validation.errors) {
      // eslint-disable-next-line no-console
      console.error(`  - ${e.path}: ${e.message}`);
    }
    if (!args.json && !args.force) process.exit(2);
  }

  const periodDays = parseDuration(args.period || '90d');
  const startCapital = Number(args['start-capital'] ?? args.startCapital ?? 10_000);
  if (!Number.isFinite(startCapital) || startCapital <= 0) {
    // eslint-disable-next-line no-console
    console.error('Error: --start-capital must be a positive number');
    process.exit(2);
  }
  const symbol = String(args.asset).toUpperCase();

  // Load OHLCV
  let ohlcv;
  if (args.ohlcv) {
    ohlcv = loadOhlcvFile(args.ohlcv);
  } else if (args.synthetic) {
    ohlcv = generateSyntheticOHLCV({ candles: periodDays, startTs: Date.UTC(2026, 0, 1) });
  } else {
    try {
      ohlcv = await fetchCoinGeckoOHLCV({ symbol, days: periodDays });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`CoinGecko fetch failed (${err.message}). Falling back to --synthetic.`);
      ohlcv = generateSyntheticOHLCV({ candles: periodDays, startTs: Date.UTC(2026, 0, 1) });
    }
  }
  if (!ohlcv || ohlcv.length === 0) {
    // eslint-disable-next-line no-console
    console.error('No OHLCV data loaded.');
    process.exit(2);
  }

  // Choose warmup: cap at one-third of series so short tests still produce trades.
  const warmupCandles = Math.min(200, Math.max(20, Math.floor(ohlcv.length / 3)));

  const result = await runBacktest({
    strategy: manifest,
    ohlcv,
    startCapital,
    symbol,
    asset: 'USDC',
    warmupCandles,
    verbose: Boolean(args.verbose),
  });

  result.manifest_valid = validation.ok;

  if (args.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    printTable(result, validation.ok);
    if (args.verbose && result.decision_log) {
      // eslint-disable-next-line no-console
      console.log('\nDecision log (verbose):');
      for (const d of result.decision_log) {
        // eslint-disable-next-line no-console
        console.log(`  [${d.i}] ts=${d.ts} px=${d.price.toFixed(2)} regime=${d.regime} edge=${d.edge} q=${d.quality} → ${d.action} (${d.reason})`);
      }
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`Backtest failed: ${err.stack || err.message}`);
  process.exit(1);
});
