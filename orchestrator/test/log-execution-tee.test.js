import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionEntry } from '../src/services/storage.js';

test('buildExecutionEntry surfaces real TEE verification fields', () => {
  const entry = buildExecutionEntry(
    { intentHash: '0xih', vault: '0xv', attestationReportHash: '0xabc' },
    { success: true, txHash: '0xtx' },
    { action: 'BUY', asset: 'USDC' },
    { sealedMode: true, teeVerified: true, attestedEnclaveSigner: '0xsig',
      quoteVerified: true, verifierContract: '0xE26E', verifiedAt: 42 },
  );
  assert.equal(entry.teeVerified, true);
  assert.equal(entry.attestedEnclaveSigner, '0xsig');
  assert.equal(entry.quoteVerified, true);
  assert.equal(entry.verifierContract, '0xE26E');
  assert.equal(entry.verifiedAt, 42);
});

test('buildExecutionEntry: teeVerified false when not provided', () => {
  const entry = buildExecutionEntry({ intentHash: '0xih' }, { success: true }, { action: 'SELL' }, { sealedMode: true });
  assert.equal(entry.teeVerified, false);
});
