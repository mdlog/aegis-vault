#!/usr/bin/env node
/**
 * Reset orchestrator cycle state to a clean slate.
 *
 *   - Backs up journal.json, kv-state.json, and tmp/ with a timestamp suffix
 *   - Overwrites journal.json with an empty array
 *   - Overwrites kv-state.json with defaults (cycleCount 0, no pending approvals, etc.)
 *   - Clears data/tmp/ (per-cycle execution artifacts)
 *
 * Preserves:
 *   - vault-index.json (tracked vault list — tied to on-chain state, not cycles)
 *
 * Usage:
 *   node scripts/reset-cycles.js                # interactive-ish (logs what it backs up)
 *   node scripts/reset-cycles.js --yes          # non-interactive
 *   node scripts/reset-cycles.js --keep-tmp     # skip wiping data/tmp/
 *
 * IMPORTANT: stop the orchestrator process BEFORE running this script.
 * Running it while the orchestrator is live risks file-write races and will
 * leave partial state (orchestrator re-writes kv-state on every cycle tick).
 */

import {
  readdirSync, renameSync, writeFileSync, existsSync, rmSync, statSync,
} from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../data');
const JOURNAL = join(DATA_DIR, 'journal.json');
const KV = join(DATA_DIR, 'kv-state.json');
const TMP = join(DATA_DIR, 'tmp');

const argv = new Set(process.argv.slice(2));
const assumeYes = argv.has('--yes') || argv.has('-y');
const keepTmp = argv.has('--keep-tmp');

const ts = new Date().toISOString().replace(/[:.]/g, '').replace(/-/g, '');

function backup(p) {
  if (!existsSync(p)) {
    console.log(`  (skip) ${p} — not present`);
    return null;
  }
  const dst = `${p}.bak.${ts}`;
  renameSync(p, dst);
  const size = statSync(dst).size;
  console.log(`  backed up ${p} → ${dst} (${size} bytes)`);
  return dst;
}

function defaultKVState() {
  return {
    vaultAddress: null,
    lastNAV: 0,
    lastRiskScore: 0,
    lastSignal: null,
    lastExecutionSummary: null,
    pendingApprovals: {},
    currentAllocation: [],
    totalCycles: 0,
    totalExecutions: 0,
    totalBlocked: 0,
    totalSkipped: 0,
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  console.log('─'.repeat(60));
  console.log('Orchestrator cycle reset');
  console.log(`  data dir: ${DATA_DIR}`);
  console.log('');

  if (!assumeYes) {
    console.log('This will wipe journal + kv-state + tmp artifacts.');
    console.log('Backups are kept with .bak.<timestamp> suffix — nothing is destroyed.');
    console.log('Make sure the orchestrator process is STOPPED before continuing.');
    console.log('');
    console.log('Re-run with --yes to skip this notice.');
    // 3-second grace period
    for (let i = 3; i > 0; i--) {
      process.stdout.write(`\r  proceeding in ${i}s… (Ctrl+C to abort) `);
      await new Promise((r) => setTimeout(r, 1000));
    }
    process.stdout.write('\n\n');
  }

  console.log('1/3 Backing up existing files');
  backup(JOURNAL);
  backup(KV);

  console.log('\n2/3 Writing fresh journal + kv-state');
  writeFileSync(JOURNAL, '[]\n');
  console.log(`  wrote ${JOURNAL} = []`);
  writeFileSync(KV, `${JSON.stringify(defaultKVState(), null, 2)}\n`);
  console.log(`  wrote ${KV} = default state`);

  console.log('\n3/3 Clearing per-cycle tmp artifacts');
  if (keepTmp) {
    console.log('  (--keep-tmp) skipping');
  } else if (!existsSync(TMP)) {
    console.log('  (skip) tmp dir not present');
  } else {
    const files = readdirSync(TMP);
    console.log(`  found ${files.length} file(s)`);
    for (const f of files) {
      rmSync(join(TMP, f), { force: true });
    }
    console.log(`  cleared ${files.length} file(s) in ${TMP}`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('Orchestrator state reset ✓');
  console.log('═'.repeat(60));
  console.log('Start the orchestrator again: npm run start (or node src/index.js)');
  console.log('Frontend /app/actions should now show empty journal + zero counters.');
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
