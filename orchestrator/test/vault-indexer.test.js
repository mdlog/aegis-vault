import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutorUpdates } from '../src/services/vaultIndexer.js';

// Regression — operator-switch orphaning.
//
// When a vault owner calls setExecutor(newExecutor) the vault emits
// ExecutorUpdated(vault, old, newExecutor). The indexer must re-route the vault
// so the NEW executor's orchestrator discovers it next cycle (getVaultsByExecutor)
// and the OLD one drops it. buildExecutorUpdates is the pure core: it turns
// decoded ExecutorUpdated logs into the set of {address, executor} reassignments
// to apply — filtered to vaults the indexer already knows, latest-wins per vault.

const VAULT_A = '0x' + 'a'.repeat(40);
const VAULT_B = '0x' + 'b'.repeat(40);
const VAULT_X = '0x' + 'c'.repeat(40); // not in the index
const E1 = '0x' + '1'.repeat(40);
const E2 = '0x' + '2'.repeat(40);
const known = new Set([VAULT_A, VAULT_B]);

test('reassigns a known vault to its new executor', () => {
  const out = buildExecutorUpdates([{ vault: VAULT_A, newExecutor: E2, blockNumber: 10, logIndex: 0 }], known);
  assert.deepEqual(out, [{ address: VAULT_A, executor: E2 }]);
});

test('ignores ExecutorUpdated from vaults not in the index (or same-signature events from other contracts)', () => {
  const out = buildExecutorUpdates([{ vault: VAULT_X, newExecutor: E2, blockNumber: 10, logIndex: 0 }], known);
  assert.deepEqual(out, []);
});

test('keeps the latest executor when a vault is rotated twice (by block)', () => {
  const out = buildExecutorUpdates([
    { vault: VAULT_A, newExecutor: E1, blockNumber: 10, logIndex: 1 },
    { vault: VAULT_A, newExecutor: E2, blockNumber: 12, logIndex: 0 },
  ], known);
  assert.deepEqual(out, [{ address: VAULT_A, executor: E2 }]);
});

test('orders by logIndex within the same block', () => {
  const out = buildExecutorUpdates([
    { vault: VAULT_A, newExecutor: E2, blockNumber: 12, logIndex: 5 },
    { vault: VAULT_A, newExecutor: E1, blockNumber: 12, logIndex: 2 },
  ], known);
  assert.deepEqual(out, [{ address: VAULT_A, executor: E2 }]);
});

test('matches the vault address case-insensitively, emits a lowercased key', () => {
  const out = buildExecutorUpdates([{ vault: VAULT_A.toUpperCase().replace('0X', '0x'), newExecutor: E2, blockNumber: 1, logIndex: 0 }], known);
  assert.deepEqual(out, [{ address: VAULT_A, executor: E2 }]);
});

test('handles multiple distinct vaults in one batch', () => {
  const out = buildExecutorUpdates([
    { vault: VAULT_A, newExecutor: E1, blockNumber: 5, logIndex: 0 },
    { vault: VAULT_B, newExecutor: E2, blockNumber: 6, logIndex: 0 },
  ], known);
  assert.equal(out.length, 2);
  assert.deepEqual(out.find((u) => u.address === VAULT_A), { address: VAULT_A, executor: E1 });
  assert.deepEqual(out.find((u) => u.address === VAULT_B), { address: VAULT_B, executor: E2 });
});

test('returns empty for no events', () => {
  assert.deepEqual(buildExecutorUpdates([], known), []);
});
