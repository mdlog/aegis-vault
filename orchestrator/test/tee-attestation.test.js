import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyProviderEnclave, isTeeAttestationRequired, _resetCache,
} from '../src/services/teeAttestation.js';

const SIGNER = '0x1111111111111111111111111111111111111111';

function fakeVerifier(overrides = {}) {
  return {
    getService: async () => ({
      url: 'https://prov.example', model: 'glm', teeSignerAddress: SIGNER,
      additionalInfo: JSON.stringify({ TEEVerifier: 'dstack', ImageDigest: 'sha256:abc' }),
    }),
    getQuote: async () => ({ rawReport: JSON.stringify({ quote: '0xdeadbeef' }) }),
    extractTeeSignerAddress: () => SIGNER,
    processDStackVerification: async () => ({ composeVerificationPassed: true, images: [] }),
    ...overrides,
  };
}
const passAutomata = { verifyAndAttestOnChain: async () => [true, '0x'] };
const failAutomata = { verifyAndAttestOnChain: async () => [false, '0x'] };
const deps = (automata, now = () => 1000) => ({ automata, now });

test('isTeeAttestationRequired reads manifest flag', () => {
  assert.equal(isTeeAttestationRequired({ _strategy: { execution: { requireTeeAttestation: true } } }), true);
  assert.equal(isTeeAttestationRequired({ _strategy: { execution: {} } }), false);
  assert.equal(isTeeAttestationRequired({}), false);
});

test('verifyProviderEnclave passes when quote+signer+compose all OK', async () => {
  _resetCache();
  const r = await verifyProviderEnclave(fakeVerifier(), '0xprov', deps(passAutomata));
  assert.equal(r.ok, true);
  assert.equal(r.attestedSigner, SIGNER);
  assert.equal(r.quoteVerified, true);
});

test('verifyProviderEnclave fails closed on invalid quote', async () => {
  _resetCache();
  const r = await verifyProviderEnclave(fakeVerifier(), '0xprov', deps(failAutomata));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'quote_invalid');
});

test('verifyProviderEnclave fails on signer mismatch', async () => {
  _resetCache();
  const v = fakeVerifier({ extractTeeSignerAddress: () => '0x2222222222222222222222222222222222222222' });
  const r = await verifyProviderEnclave(v, '0xprov', deps(passAutomata));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'signer_mismatch');
});

test('verifyProviderEnclave fails on compose mismatch', async () => {
  _resetCache();
  const v = fakeVerifier({ processDStackVerification: async () => ({ composeVerificationPassed: false }) });
  const r = await verifyProviderEnclave(v, '0xprov', deps(passAutomata));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'compose_mismatch');
});

test('verifyProviderEnclave reports verifier_unreachable on RPC throw', async () => {
  _resetCache();
  const throwAutomata = { verifyAndAttestOnChain: async () => { throw new Error('ECONNREFUSED'); } };
  const r = await verifyProviderEnclave(fakeVerifier(), '0xprov', deps(throwAutomata));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'verifier_unreachable');
});

test('separated-mode provider still verifies via broker quote', async () => {
  _resetCache();
  const v = fakeVerifier({ getService: async () => ({
    teeSignerAddress: SIGNER,
    additionalInfo: JSON.stringify({ TEEVerifier: 'dstack', TargetSeparated: true, ImageDigest: 'sha256:abc' }),
  }) });
  const r = await verifyProviderEnclave(v, '0xprov', deps(passAutomata));
  assert.equal(r.ok, true);
  assert.equal(r.attestedSigner, SIGNER);
});

test('provider without TEEVerifier is not attestable', async () => {
  _resetCache();
  const v = fakeVerifier({ getService: async () => ({
    teeSignerAddress: SIGNER, additionalInfo: JSON.stringify({}),
  }) });
  const r = await verifyProviderEnclave(v, '0xprov', deps(passAutomata));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'provider_not_attestable');
});

test('positive result is cached within TTL; failures are not cached', async () => {
  _resetCache();
  let quoteCalls = 0;
  const countingAutomata = { verifyAndAttestOnChain: async () => { quoteCalls++; return [true, '0x']; } };
  await verifyProviderEnclave(fakeVerifier(), '0xprov', deps(countingAutomata, () => 1000));
  const second = await verifyProviderEnclave(fakeVerifier(), '0xprov', deps(countingAutomata, () => 1500));
  assert.equal(second.fromCache, true);
  assert.equal(quoteCalls, 1); // second hit cache, did not re-verify
  // after TTL it re-verifies
  await verifyProviderEnclave(fakeVerifier(), '0xprov', deps(countingAutomata, () => 1000 + 3_600_001));
  assert.equal(quoteCalls, 2);
});

// ── Task 4: Layer B (response signature) + attestInference + gate evaluator ──
import { verifyResponseSignature, attestInference, evaluateTeeGate } from '../src/services/teeAttestation.js';

const SIGNER2 = '0x1111111111111111111111111111111111111111';
function fakeVerifierClass(returnValid = true) {
  return {
    fetchSignatureByChatID: async () => ({ text: 'msg', signature: '0xsig' }),
    verifySignature: (_t, _s, addr) => returnValid && addr.toLowerCase() === SIGNER2.toLowerCase(),
  };
}
function brokerWith(verifier, VerifierClass) {
  return { inference: { verifier: Object.assign(verifier, { constructor: VerifierClass }) } };
}
function fakeEnclaveVerifier() {
  return {
    getService: async () => ({ teeSignerAddress: SIGNER2, additionalInfo: JSON.stringify({ TEEVerifier: 'dstack' }) }),
    getQuote: async () => ({ rawReport: JSON.stringify({ quote: '0xaa' }) }),
    extractTeeSignerAddress: () => SIGNER2,
    processDStackVerification: async () => ({ composeVerificationPassed: true }),
  };
}

test('verifyResponseSignature returns true when recovered signer matches', async () => {
  const ok = await verifyResponseSignature(fakeVerifierClass(true), 'https://p', 'cid', 'glm', SIGNER2);
  assert.equal(ok, true);
});

test('attestInference passes end-to-end with all checks green', async () => {
  _resetCache();
  const broker = brokerWith(fakeEnclaveVerifier(), fakeVerifierClass(true));
  const r = await attestInference(broker, { address: '0xprov', endpoint: 'https://p', model: 'glm' }, 'cid', {
    automata: { verifyAndAttestOnChain: async () => [true, '0x'] }, now: () => 1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.responseSigned, true);
  assert.equal(r.verifierContract, '0xE26E11B257856B0bEBc4C759aaBDdea72B64351F');
});

test('attestInference fails closed when response signature is invalid', async () => {
  _resetCache();
  const broker = brokerWith(fakeEnclaveVerifier(), fakeVerifierClass(false));
  const r = await attestInference(broker, { address: '0xprov', endpoint: 'https://p', model: 'glm' }, 'cid', {
    automata: { verifyAndAttestOnChain: async () => [true, '0x'] }, now: () => 1,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'response_unsigned');
});

test('evaluateTeeGate: not required → proceed ungated', () => {
  assert.deepEqual(evaluateTeeGate({}, null), { proceed: true, gated: false });
});
test('evaluateTeeGate: required + ok → proceed gated', () => {
  const att = { ok: true, attestedSigner: SIGNER2 };
  const g = evaluateTeeGate({ _strategy: { execution: { requireTeeAttestation: true } } }, att);
  assert.equal(g.proceed, true); assert.equal(g.gated, true);
});
test('evaluateTeeGate: required + fail → skip with status+reason', () => {
  const g = evaluateTeeGate({ _strategy: { execution: { requireTeeAttestation: true } } }, { ok: false, reason: 'quote_invalid' });
  assert.equal(g.proceed, false);
  assert.equal(g.status, 'skipped_tee_unattested');
  assert.equal(g.reason, 'quote_invalid');
});
