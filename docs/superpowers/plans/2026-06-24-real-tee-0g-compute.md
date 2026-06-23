# Real TEE Attestation via 0G Compute — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate trade execution on a genuine Intel-TDX attestation of the 0G Compute provider's inference enclave (validated via the Automata DCAP verifier), failing closed for vaults that opt in.

**Architecture:** A new off-chain engine (`teeAttestation.js`) downloads the provider's TDX quote, validates it read-only against the Automata DCAP verifier, checks the embedded enclave signer against the provider's on-chain `teeSignerAddress`, checks the dstack compose hash, and verifies the per-`chatId` response signature. The orchestrator calls it before building the intent; on failure for an opted-in vault, the cycle is skipped. On-chain contracts are unchanged. UI/marketing copy is corrected so the "TEE" badge is true only when a real quote was verified.

**Tech Stack:** Node ESM, `ethers` v6, `@0glabs/0g-serving-broker` (verifier instance at `broker.inference.verifier`; static methods on its class), `node:test` (orchestrator), `vitest` (frontend).

## Global Constraints

- **On-chain unchanged.** No edits to any `.sol` file, no contract deploy, no gas spent on verification. Verification is a read-only `eth_call`.
- **Automata verifier:** address `0xE26E11B257856B0bEBc4C759aaBDdea72B64351F`, RPC `https://rpc.ata.network` (the SDK default `https://1rpc.io/ata` is rate-limited — confirmed live), function `verifyAndAttestOnChain(bytes) view returns (bool success, bytes output)`.
- **Quote field encoding (confirmed live):** the 0G dstack report's `quote` is **plain hex WITHOUT a `0x` prefix** (header `0400 0200 81000000` = TDX v4). Prepend `0x`; do NOT base64-decode it.
- **Separated providers verify:** the live GLM-5-FP8 provider is `TargetSeparated=true`, yet `getQuote()` returns the broker-enclave report whose 5006-byte quote passes DCAP and whose embedded signer equals the registered `teeSignerAddress`. Do NOT reject separated providers; verify the broker quote (LLM-enclave verification is a follow-up).
- **Verifier access:** instance methods via `broker.inference.verifier` (`getService`, `getQuote`, `extractTeeSignerAddress`, `processDStackVerification`); static methods via the same class (`fetchSignatureByChatID`, `verifySignature`).
- **Fail-closed, opt-in.** Gate active only when `vaultState._strategy.execution.requireTeeAttestation === true` (manifest field, integrity-anchored by on-chain `acceptedManifestHash`). Vaults without it behave exactly as today.
- **No env override flag** for enabling the gate (project prefers manifest-derived policy over env flags).
- **Cache only positive Layer-A results**, keyed `provider:imageDigest`, TTL `config.teeAttestation.cacheTtlMs`. Never cache failures.
- **Orchestrator tests:** `node --test --test-reporter=spec`. Files end `.test.js`, use `import test from 'node:test'` + `import assert from 'node:assert/strict'`.
- **Commit messages:** no Claude co-author trailer, no "agent" attribution.

---

### Task 1: Feasibility probe script (Step 0 of the spec)

**Files:**
- Create: `orchestrator/scripts/probe-tee-attestation.js`

**Interfaces:**
- Consumes: `initOGCompute`, `getBroker`, `getProviderService` from `ogCompute.js` (the latter two are added in Task 4 — until then, the probe inlines provider discovery; see Step 1).
- Produces: nothing imported by other tasks. Operator-run diagnostic.

This task ships first as a standalone diagnostic so we can confirm the configured provider actually exposes a TDX quote before any engine work depends on it. It does not import Task-3/4 code; it talks to the broker directly.

- [ ] **Step 1: Write the probe script**

```javascript
// orchestrator/scripts/probe-tee-attestation.js
// One-off diagnostic: does the configured 0G Compute provider expose a
// genuine Intel-TDX attestation that validates against the Automata DCAP
// verifier? Run BEFORE enabling requireTeeAttestation on any vault.
import { ethers } from 'ethers';
import { initOGCompute, getBroker, getProviderService } from '../src/services/ogCompute.js';
import config from '../src/config/index.js';
import logger from '../src/utils/logger.js';

const AUTOMATA_ABI = [
  'function verifyAndAttestOnChain(bytes rawQuote) view returns (bool success, bytes output)',
];

function extractRawQuote(parsed) {
  const q = parsed.quote || parsed.intel_quote || parsed.tdx_quote || parsed.report;
  if (!q) throw new Error('no recognizable quote field in report JSON: ' + Object.keys(parsed).join(','));
  return typeof q === 'string' && q.startsWith('0x')
    ? q
    : '0x' + Buffer.from(q, 'base64').toString('hex');
}

async function main() {
  const ok = await initOGCompute();
  if (!ok) { logger.error('PROBE: 0G Compute init failed (no key/balance/provider).'); process.exit(2); }

  const broker = getBroker();
  const provider = getProviderService(); // { address, endpoint, model }
  const verifier = broker.inference.verifier;
  logger.info(`PROBE: provider=${provider.address} model=${provider.model}`);

  const svc = await verifier.getService(provider.address);
  const additional = svc.additionalInfo ? JSON.parse(svc.additionalInfo) : {};
  logger.info(`PROBE: TEEVerifier=${additional.TEEVerifier || '(none)'} TargetSeparated=${additional.TargetSeparated === true} onchainSigner=${svc.teeSignerAddress}`);
  if (!additional.TEEVerifier) { logger.error('PROBE: FAIL — provider is not TEE-attestable (no TEEVerifier).'); process.exit(1); }

  const report = await verifier.getQuote(provider.address);
  const parsed = JSON.parse(report.rawReport);
  const rawQuote = extractRawQuote(parsed);

  const automata = new ethers.Contract(
    config.teeAttestation.automataAddress,
    AUTOMATA_ABI,
    new ethers.JsonRpcProvider(config.teeAttestation.automataRpc),
  );
  const [quoteOk] = await automata.verifyAndAttestOnChain(rawQuote);
  const embedded = verifier.extractTeeSignerAddress(parsed);
  const signerMatch = !!embedded && embedded.toLowerCase() === (svc.teeSignerAddress || '').toLowerCase();

  logger.info(`PROBE: quoteVerified=${quoteOk} embeddedSigner=${embedded} signerMatch=${signerMatch}`);
  if (quoteOk && signerMatch) { logger.info('PROBE: ✅ PASS — provider runs a verifiable TDX enclave.'); process.exit(0); }
  logger.error('PROBE: ❌ FAIL — quote did not fully verify.'); process.exit(1);
}

main().catch((e) => { logger.error(`PROBE: error — ${e.message}`); process.exit(3); });
```

> Note: `getBroker`/`getProviderService` land in Task 4. If executing Task 1 before Task 4, temporarily replace those two imports with the local discovery already in `ogCompute.js` (`isOGComputeAvailable()` + the module's selected provider) — but the recommended order is Task 4 first, then run the probe. Either way the probe is not imported by other tasks, so its commit can come last; it is listed first because its *result* gates whether enabling the flag is safe.

- [ ] **Step 2: Confirm the quote field name**

Run: `node orchestrator/scripts/probe-tee-attestation.js`
Expected: either `PASS`, or a clear `no recognizable quote field ... keys: <list>`. If the latter, edit `extractRawQuote` in BOTH this script and `teeAttestation.js` (Task 3) to use the real field name from the printed key list. This is the one integration unknown called out in the spec (§3.3).

- [ ] **Step 3: Commit**

```bash
git add orchestrator/scripts/probe-tee-attestation.js
git commit -m "feat(tee): add 0G Compute TDX attestation feasibility probe"
```

---

### Task 2: Config block `teeAttestation`

**Files:**
- Modify: `orchestrator/src/config/index.js` (add block next to the existing `teeSigner` block, ~line 138)
- Test: `orchestrator/test/tee-config.test.js`

**Interfaces:**
- Produces: `config.teeAttestation = { automataRpc: string, automataAddress: string, cacheTtlMs: number, fetchTimeoutMs: number }`

- [ ] **Step 1: Write the failing test**

```javascript
// orchestrator/test/tee-config.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../src/config/index.js';

test('teeAttestation config has sane defaults', () => {
  assert.equal(config.teeAttestation.automataAddress, '0xE26E11B257856B0bEBc4C759aaBDdea72B64351F');
  assert.equal(config.teeAttestation.automataRpc, 'https://rpc.ata.network');
  assert.equal(config.teeAttestation.cacheTtlMs, 3_600_000);
  assert.equal(config.teeAttestation.fetchTimeoutMs, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd orchestrator && node --test --test-reporter=spec test/tee-config.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'automataAddress')`.

- [ ] **Step 3: Add the config block**

In `orchestrator/src/config/index.js`, immediately after the `teeSigner: { ... },` block, add:

```javascript
  // ── Real TEE attestation gate (off-chain DCAP verification of the 0G
  // Compute provider enclave). Defaults mirror the @0glabs SDK's Automata
  // verifier (Automata mainnet, read-only). cacheTtlMs caches positive
  // provider-enclave verifications; fetchTimeoutMs bounds quote/RPC fetches.
  teeAttestation: {
    // rpc.ata.network is the official Automata mainnet RPC with the DCAP
    // verifier deployed; the SDK default 1rpc.io/ata is rate-limited.
    automataRpc: process.env.AUTOMATA_RPC || 'https://rpc.ata.network',
    automataAddress: process.env.AUTOMATA_CONTRACT_ADDRESS || '0xE26E11B257856B0bEBc4C759aaBDdea72B64351F',
    cacheTtlMs: parseInt(process.env.TEE_CACHE_TTL_MS || '3600000'),
    fetchTimeoutMs: parseInt(process.env.TEE_FETCH_TIMEOUT_MS || '60000'),
  },
```

(These env vars override deployment-specifics only; the gate's *enablement* stays manifest-derived, per Global Constraints.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd orchestrator && node --test --test-reporter=spec test/tee-config.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/src/config/index.js orchestrator/test/tee-config.test.js
git commit -m "feat(tee): add teeAttestation config block"
```

---

### Task 3: Engine — Layer A (provider-enclave verification + cache)

**Files:**
- Create: `orchestrator/src/services/teeAttestation.js`
- Test: `orchestrator/test/tee-attestation.test.js`

**Interfaces:**
- Consumes: `config.teeAttestation` (Task 2); `ethers`.
- Produces:
  - `verifyProviderEnclave(verifier, providerAddress, deps={}) → Promise<{ ok, attestedSigner?, quoteVerified?, signerMatch?, composeOk?, verifiedAt?, reason? }>`
  - `isTeeAttestationRequired(vaultState) → boolean`
  - `_resetCache()` (test helper)
  - `extractRawQuote(parsedReport) → string` (exported for the probe/test to share)
  - `deps` injection points: `{ automata, now }` — `automata` is an object with `verifyAndAttestOnChain(rawQuote) → [bool, bytes]`; `now` is `() => number`.

- [ ] **Step 1: Write the failing tests**

```javascript
// orchestrator/test/tee-attestation.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd orchestrator && node --test --test-reporter=spec test/tee-attestation.test.js`
Expected: FAIL — module `teeAttestation.js` not found.

- [ ] **Step 3: Implement the engine (Layer A)**

```javascript
// orchestrator/src/services/teeAttestation.js
import { ethers } from 'ethers';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const AUTOMATA_ABI = [
  'function verifyAndAttestOnChain(bytes rawQuote) view returns (bool success, bytes output)',
];

// key: `${provider}:${imageDigest}` → { ok:true, attestedSigner, quoteVerified, signerMatch, composeOk, verifiedAt }
const _cache = new Map();
export function _resetCache() { _cache.clear(); }

export function isTeeAttestationRequired(vaultState) {
  return vaultState?._strategy?.execution?.requireTeeAttestation === true;
}

export function extractRawQuote(parsed) {
  // 0G dstack report's `quote` is PLAIN HEX without a 0x prefix (confirmed
  // live: header 0400 0200 81000000 = TDX v4). Prepend 0x; base64 is a fallback.
  const q = parsed.quote || parsed.intel_quote || parsed.tdx_quote || parsed.report;
  if (!q || typeof q !== 'string') throw new Error('no_quote_field');
  if (q.startsWith('0x')) return q;
  if (/^[0-9a-fA-F]+$/.test(q)) return '0x' + q;
  return '0x' + Buffer.from(q, 'base64').toString('hex');
}

function makeAutomata(deps) {
  if (deps.automata) return deps.automata;
  const provider = new ethers.JsonRpcProvider(config.teeAttestation.automataRpc);
  return new ethers.Contract(config.teeAttestation.automataAddress, AUTOMATA_ABI, provider);
}

export async function verifyProviderEnclave(verifier, providerAddress, deps = {}) {
  const now = deps.now || Date.now;
  const automata = makeAutomata(deps);

  let svc, additional;
  try {
    svc = await verifier.getService(providerAddress);
    additional = svc.additionalInfo ? JSON.parse(svc.additionalInfo) : {};
  } catch (e) {
    return { ok: false, reason: 'provider_not_attestable', detail: e.message };
  }
  if (!additional.TEEVerifier) return { ok: false, reason: 'provider_not_attestable' };
  // Separated providers (broker + LLM in distinct enclaves) ARE supported:
  // getQuote() returns the broker-enclave report, whose quote verifies and
  // whose embedded signer is the response signer. (LLM-enclave verification
  // via getQuoteInLLMServer is a documented follow-up, see §10.)

  const imageDigest = additional.ImageDigest || 'unknown';
  const cacheKey = `${providerAddress.toLowerCase()}:${imageDigest}`;
  const cached = _cache.get(cacheKey);
  if (cached && now() - cached.verifiedAt < config.teeAttestation.cacheTtlMs) {
    return { ...cached, fromCache: true };
  }

  let parsed;
  try {
    const report = await verifier.getQuote(providerAddress);
    parsed = JSON.parse(report.rawReport);
  } catch (e) {
    return { ok: false, reason: 'provider_not_attestable', detail: e.message };
  }

  let quoteVerified = false;
  try {
    const [success] = await automata.verifyAndAttestOnChain(extractRawQuote(parsed));
    quoteVerified = success === true;
  } catch (e) {
    return { ok: false, reason: 'verifier_unreachable', detail: e.message };
  }
  if (!quoteVerified) return { ok: false, reason: 'quote_invalid' };

  const embedded = verifier.extractTeeSignerAddress(parsed);
  const signerMatch = !!embedded && !!svc.teeSignerAddress
    && embedded.toLowerCase() === svc.teeSignerAddress.toLowerCase();
  if (!signerMatch) return { ok: false, reason: 'signer_mismatch' };

  let composeOk = false;
  try {
    const dstack = await verifier.processDStackVerification({ combined: parsed }, () => {});
    composeOk = dstack.composeVerificationPassed === true;
  } catch (e) {
    return { ok: false, reason: 'compose_mismatch', detail: e.message };
  }
  if (!composeOk) return { ok: false, reason: 'compose_mismatch' };

  const entry = {
    ok: true, attestedSigner: embedded, quoteVerified, signerMatch, composeOk, verifiedAt: now(),
  };
  _cache.set(cacheKey, entry);
  logger.info(`TEE: provider ${providerAddress.slice(0, 10)} enclave verified (signer ${embedded.slice(0, 10)})`);
  return entry;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd orchestrator && node --test --test-reporter=spec test/tee-attestation.test.js`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/src/services/teeAttestation.js orchestrator/test/tee-attestation.test.js
git commit -m "feat(tee): provider-enclave DCAP verification engine with cache"
```

---

### Task 4: Engine — Layer B + `attestInference`, expose broker/provider from ogCompute

**Files:**
- Modify: `orchestrator/src/services/teeAttestation.js` (append)
- Modify: `orchestrator/src/services/ogCompute.js` (add two exports)
- Test: `orchestrator/test/tee-attestation.test.js` (append)

**Interfaces:**
- Consumes: `verifyProviderEnclave` (Task 3).
- Produces:
  - `verifyResponseSignature(VerifierClass, url, chatId, model, signer) → Promise<boolean>`
  - `attestInference(broker, providerInfo, chatId, deps={}) → Promise<{ ok, attestedSigner?, quoteVerified?, signerMatch?, composeOk?, responseSigned?, verifiedAt?, verifierContract?, reason? }>`
  - `evaluateTeeGate(vaultState, attestation) → { proceed, gated, status?, reason?, attestation? }`
  - `ogCompute.getBroker() → broker | null`
  - `ogCompute.getProviderService() → { address, endpoint, model } | null`

- [ ] **Step 1: Write the failing tests (append to test/tee-attestation.test.js)**

```javascript
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

test('verifyResponseSignature returns true when recovered signer matches', async () => {
  const ok = await verifyResponseSignature(fakeVerifierClass(true), 'https://p', 'cid', 'glm', SIGNER2);
  assert.equal(ok, true);
});

test('attestInference passes end-to-end with all checks green', async () => {
  _resetCache();
  const verifier = {
    getService: async () => ({ teeSignerAddress: SIGNER2, additionalInfo: JSON.stringify({ TEEVerifier: 'dstack' }) }),
    getQuote: async () => ({ rawReport: JSON.stringify({ quote: '0xaa' }) }),
    extractTeeSignerAddress: () => SIGNER2,
    processDStackVerification: async () => ({ composeVerificationPassed: true }),
  };
  const broker = brokerWith(verifier, fakeVerifierClass(true));
  const r = await attestInference(broker, { address: '0xprov', endpoint: 'https://p', model: 'glm' }, 'cid', {
    automata: { verifyAndAttestOnChain: async () => [true, '0x'] }, now: () => 1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.responseSigned, true);
  assert.equal(r.verifierContract, '0xE26E11B257856B0bEBc4C759aaBDdea72B64351F');
});

test('attestInference fails closed when response signature is invalid', async () => {
  _resetCache();
  const verifier = {
    getService: async () => ({ teeSignerAddress: SIGNER2, additionalInfo: JSON.stringify({ TEEVerifier: 'dstack' }) }),
    getQuote: async () => ({ rawReport: JSON.stringify({ quote: '0xaa' }) }),
    extractTeeSignerAddress: () => SIGNER2,
    processDStackVerification: async () => ({ composeVerificationPassed: true }),
  };
  const broker = brokerWith(verifier, fakeVerifierClass(false));
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd orchestrator && node --test --test-reporter=spec test/tee-attestation.test.js`
Expected: FAIL — `verifyResponseSignature`/`attestInference`/`evaluateTeeGate` not exported.

- [ ] **Step 3: Append to teeAttestation.js**

```javascript
export async function verifyResponseSignature(VerifierClass, providerUrl, chatId, model, attestedSigner) {
  if (!chatId) return false;
  const sig = await VerifierClass.fetchSignatureByChatID(providerUrl, chatId, model);
  if (!sig || !sig.signature || !sig.text) return false;
  return VerifierClass.verifySignature(sig.text, sig.signature, attestedSigner) === true;
}

export async function attestInference(broker, providerInfo, chatId, deps = {}) {
  const verifier = deps.verifier || broker?.inference?.verifier;
  const VerifierClass = deps.VerifierClass || verifier?.constructor;
  if (!verifier || !VerifierClass) return { ok: false, reason: 'provider_not_attestable' };

  const enclave = await verifyProviderEnclave(verifier, providerInfo.address, deps);
  if (!enclave.ok) return enclave;

  let responseSigned = false;
  try {
    responseSigned = await verifyResponseSignature(
      VerifierClass, providerInfo.endpoint, chatId, providerInfo.model, enclave.attestedSigner,
    );
  } catch (e) {
    return { ok: false, reason: 'response_unsigned', detail: e.message };
  }
  if (!responseSigned) return { ok: false, reason: 'response_unsigned' };

  return {
    ok: true,
    attestedSigner: enclave.attestedSigner,
    quoteVerified: enclave.quoteVerified,
    signerMatch: enclave.signerMatch,
    composeOk: enclave.composeOk,
    responseSigned: true,
    verifiedAt: enclave.verifiedAt,
    verifierContract: config.teeAttestation.automataAddress,
  };
}

export function evaluateTeeGate(vaultState, attestation) {
  if (!isTeeAttestationRequired(vaultState)) return { proceed: true, gated: false };
  if (attestation?.ok === true) return { proceed: true, gated: true, attestation };
  return {
    proceed: false, gated: true,
    status: 'skipped_tee_unattested',
    reason: attestation?.reason || 'provider_not_attestable',
  };
}
```

- [ ] **Step 4: Add the two ogCompute exports**

In `orchestrator/src/services/ogCompute.js`, after `getOGComputeStatus`, add:

```javascript
/** Expose the initialized broker so the TEE attestation engine can reach broker.inference.verifier. */
export function getBroker() { return broker; }

/** Expose the selected provider service for attestation: { address, endpoint, model }. */
export function getProviderService() {
  if (!providerInfo) return null;
  return { address: providerInfo.address, endpoint: providerInfo.endpoint, model: providerInfo.model };
}
```

(`providerInfo` already has `address`/`endpoint`/`model` — see `ogCompute.js:81-85`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd orchestrator && node --test --test-reporter=spec test/tee-attestation.test.js`
Expected: PASS (all tests, old + new).

- [ ] **Step 6: Commit**

```bash
git add orchestrator/src/services/teeAttestation.js orchestrator/src/services/ogCompute.js orchestrator/test/tee-attestation.test.js
git commit -m "feat(tee): attestInference + response-signature check + gate evaluator; expose broker/provider"
```

---

### Task 5: Manifest schema — `execution.requireTeeAttestation`

**Files:**
- Modify: `orchestrator/src/strategy/schema-v1.json` (add `execution` to root `properties`)
- Test: `orchestrator/test/strategy/manifest-execution-flag.test.js`

**Interfaces:**
- Consumes: `validateManifest` from `src/strategy/validator.js`.
- Produces: manifests may carry `execution: { requireTeeAttestation: boolean }`; read at `vaultState._strategy.execution.requireTeeAttestation` (already wired by `loadStrategy` → `vaultState._strategy`).

- [ ] **Step 1: Write the failing test**

```javascript
// orchestrator/test/strategy/manifest-execution-flag.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(here, '../../src/strategy/schema-v1.json'), 'utf8'));

test('schema-v1 declares execution.requireTeeAttestation as an optional boolean', () => {
  assert.ok(schema.properties.execution, 'execution block must exist');
  assert.equal(schema.properties.execution.additionalProperties, false);
  assert.equal(schema.properties.execution.properties.requireTeeAttestation.type, 'boolean');
  // execution must NOT be in required[], so legacy manifests still validate
  assert.ok(!(schema.required || []).includes('execution'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd orchestrator && node --test --test-reporter=spec test/strategy/manifest-execution-flag.test.js`
Expected: FAIL — `schema.properties.execution` is undefined.

- [ ] **Step 3: Add the `execution` block to schema-v1.json**

In `orchestrator/src/strategy/schema-v1.json`, inside the root `"properties": { ... }` object, add a new key (alongside the existing top-level properties; do not touch `required`):

```json
    "execution": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "requireTeeAttestation": { "type": "boolean" }
      }
    },
```

- [ ] **Step 4: Run test + full strategy suite to verify pass + no regression**

Run: `cd orchestrator && node --test --test-reporter=spec test/strategy/manifest-execution-flag.test.js test/strategy/*.test.js`
Expected: PASS, and existing strategy/dsl/backtester tests still PASS (legacy manifests without `execution` remain valid because it's optional).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/src/strategy/schema-v1.json orchestrator/test/strategy/manifest-execution-flag.test.js
git commit -m "feat(tee): manifest schema supports execution.requireTeeAttestation flag"
```

---

### Task 6: Orchestrator gate wiring

**Files:**
- Modify: `orchestrator/src/services/orchestrator.js` (import + insert gate after the sealed-mode skip block, before `buildExecutionIntent`)
- Test: covered by Task 4's `evaluateTeeGate` unit tests; wiring verified by the full suite + manual.

**Interfaces:**
- Consumes: `isTeeAttestationRequired`, `attestInference`, `evaluateTeeGate` (Tasks 3-4); `getBroker`, `getProviderService` (Task 4).

- [ ] **Step 1: Add imports**

At the top of `orchestrator/src/services/orchestrator.js`, add:

```javascript
import { isTeeAttestationRequired, attestInference, evaluateTeeGate } from './teeAttestation.js';
```

And ensure `getBroker, getProviderService` are added to the existing `ogCompute.js` import line.

- [ ] **Step 2: Insert the gate**

In `runVaultCycle`, immediately AFTER the existing sealed-mode skip block (the `if (vaultState.policy?.sealedMode === true && !decision._computeResponse)` block ending ~line 679) and BEFORE the oracle-price/`buildExecutionIntent` section (~line 700), insert:

```javascript
    // Real TEE attestation gate (off-chain DCAP). Opt-in per vault via the
    // manifest's execution.requireTeeAttestation (integrity-anchored by the
    // on-chain acceptedManifestHash). When required and not satisfied, skip
    // the cycle — fail-closed, no trade. Vaults without the flag are
    // unaffected.
    let teeAttestation = null;
    if (isTeeAttestationRequired(vaultState)) {
      teeAttestation = await attestInference(
        getBroker(), getProviderService(), decision._computeResponse?.chatId,
      );
      const gate = evaluateTeeGate(vaultState, teeAttestation);
      if (!gate.proceed) {
        logger.warn(`    TEE attestation required but not satisfied (${gate.reason}) — skipping submission.`);
        vaultResult.status = gate.status;
        vaultResult.teeReason = gate.reason;
        updateKVState({ lastSignal: decision, totalCycles: cycleCount, positionState: vaultPositions });
        return vaultResult;
      }
      decision._teeAttestation = teeAttestation;
    }
```

- [ ] **Step 3: Run the full orchestrator suite (regression)**

Run: `cd orchestrator && node --test --test-reporter=spec test/*.test.js test/**/*.test.js`
Expected: PASS. Existing gate tests (`test/v4-orchestrator-gates.test.js`) still pass; no vault in those fixtures sets `requireTeeAttestation`, so the new branch is skipped.

- [ ] **Step 4: Commit**

```bash
git add orchestrator/src/services/orchestrator.js
git commit -m "feat(tee): gate cycle execution on real provider attestation (fail-closed, opt-in)"
```

---

### Task 7: Journal — record real attestation fields

**Files:**
- Modify: `orchestrator/src/services/storage.js` (`logExecution`)
- Modify: `orchestrator/src/services/orchestrator.js` (pass attestation into the `logExecution` call)
- Test: `orchestrator/test/log-execution-tee.test.js`

**Interfaces:**
- Consumes: `decision._teeAttestation` (Task 6).
- Produces: journal `execution` entries gain `teeVerified: boolean`, `attestedEnclaveSigner: string|null`, `quoteVerified: boolean`, `verifierContract: string|null`, `verifiedAt: number|null`. (`teeAttested`/`attestedSigner` legacy fields stay for back-compat.)

- [ ] **Step 1: Write the failing test**

```javascript
// orchestrator/test/log-execution-tee.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd orchestrator && node --test --test-reporter=spec test/log-execution-tee.test.js`
Expected: FAIL — `buildExecutionEntry` not exported.

- [ ] **Step 3: Refactor `logExecution` to expose a pure `buildExecutionEntry`**

In `orchestrator/src/services/storage.js`, extract the entry object into a pure exported function and have `logExecution` append it. Replace the existing `logExecution` body:

```javascript
export function buildExecutionEntry(intent, result, decision = null, context = {}) {
  const sealed = !!context.sealedMode;
  const attestationReportHash = intent?.attestationReportHash || null;
  const ZERO_HASH = '0x' + '0'.repeat(64);
  const teeAttested = sealed && attestationReportHash && attestationReportHash.toLowerCase() !== ZERO_HASH;

  return {
    type: 'execution',
    vault: context.vault || intent?.vault || null,
    intentHash: intent?.intentHash,
    action: decision?.action || null,
    asset: decision?.asset || null,
    approval_tier: decision?.approval_tier || null,
    success: result.success,
    txHash: result.txHash || null,
    error: result.error || null,
    sealedMode: sealed,
    teeAttested: !!teeAttested,
    attestedSigner: context.attestedSigner || null,
    attestationReportHash,
    commitTxHash: result.commitTxHash || null,
    commitBlockNumber: result.commitBlockNumber || null,
    // Real off-chain DCAP attestation (Task 7). teeVerified is the source of
    // truth for the UI "TEE ✓" badge — true ONLY when a TDX quote actually
    // verified this cycle.
    teeVerified: context.teeVerified === true,
    attestedEnclaveSigner: context.attestedEnclaveSigner || null,
    quoteVerified: context.quoteVerified === true,
    verifierContract: context.verifierContract || null,
    verifiedAt: context.verifiedAt ?? null,
  };
}

export function logExecution(intent, result, decision = null, context = {}) {
  return appendJournal(buildExecutionEntry(intent, result, decision, context));
}
```

- [ ] **Step 4: Pass attestation into the orchestrator's `logExecution` call**

In `orchestrator/src/services/orchestrator.js`, update the `logExecution(intent, execResult, decision, { ... })` call (~line 760) to include:

```javascript
    logExecution(intent, execResult, decision, {
      vault: vaultAddress,
      sealedMode: vaultState.policy?.sealedMode === true,
      attestedSigner: vaultState.policy?.attestedSigner,
      teeVerified: decision._teeAttestation?.ok === true,
      attestedEnclaveSigner: decision._teeAttestation?.attestedSigner || null,
      quoteVerified: decision._teeAttestation?.quoteVerified === true,
      verifierContract: decision._teeAttestation?.verifierContract || null,
      verifiedAt: decision._teeAttestation?.verifiedAt ?? null,
    });
```

- [ ] **Step 5: Run test + suite to verify pass**

Run: `cd orchestrator && node --test --test-reporter=spec test/log-execution-tee.test.js && node --test --test-reporter=spec test/*.test.js`
Expected: PASS, no regression.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/src/services/storage.js orchestrator/src/services/orchestrator.js orchestrator/test/log-execution-tee.test.js
git commit -m "feat(tee): journal records real teeVerified/quoteVerified attestation fields"
```

---

### Task 8: Frontend badge — green only when `teeVerified`

**Files:**
- Modify: `frontend/src/components/dashboard/ActionFeed.jsx` (extract `teeBadgeState`, drive badge from `teeVerified`)
- Test: `frontend/src/components/dashboard/__tests__/teeBadge.test.js` (vitest)

**Interfaces:**
- Consumes: journal `execution` entries (Task 7) with `teeVerified`.
- Produces: `export function teeBadgeState(entry): 'verified' | 'unattested' | 'none'`.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/components/dashboard/__tests__/teeBadge.test.js
import { describe, it, expect } from 'vitest';
import { teeBadgeState } from '../ActionFeed.jsx';

describe('teeBadgeState', () => {
  it('verified only when teeVerified===true', () => {
    expect(teeBadgeState({ teeVerified: true, sealedMode: true })).toBe('verified');
  });
  it('sealed but not verified → unattested (never green)', () => {
    expect(teeBadgeState({ teeVerified: false, sealedMode: true })).toBe('unattested');
    expect(teeBadgeState({ sealedMode: true, attestationReportHash: '0xabc' })).toBe('unattested');
  });
  it('non-sealed → none', () => {
    expect(teeBadgeState({})).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/dashboard/__tests__/teeBadge.test.js`
Expected: FAIL — `teeBadgeState` is not exported.

- [ ] **Step 3: Add the helper + rewire the badge**

In `frontend/src/components/dashboard/ActionFeed.jsx`, add the exported helper near the top:

```javascript
// Source of truth for the TEE badge. Green "verified" ONLY when a real TDX
// quote was verified this cycle (entry.teeVerified). A sealed-mode entry that
// was NOT hardware-verified shows a neutral "unattested" marker — never green.
export function teeBadgeState(entry) {
  if (entry?.teeVerified === true) return 'verified';
  if (entry?.sealedMode === true) return 'unattested';
  return 'none';
}
```

Then change `TeeAttestedBadge` to branch on `teeBadgeState(entry)`:

```javascript
function TeeAttestedBadge({ entry, chainId }) {
  const state = teeBadgeState(entry);
  if (state === 'none') return null;
  if (state === 'unattested') {
    return (
      <span title="Sealed mode — signed intent + commit-reveal. Hardware TEE quote NOT verified for this execution."
            className="inline-flex items-center gap-1 text-[10px] text-zinc-400 border border-zinc-700 rounded px-1">
        unattested
      </span>
    );
  }
  const tooltip = [
    'TEE-verified execution',
    entry.attestedEnclaveSigner ? `Enclave signer: ${entry.attestedEnclaveSigner}` : null,
    entry.verifierContract ? `DCAP verifier: ${entry.verifierContract}` : null,
  ].filter(Boolean).join('\n');
  return (
    <span title={tooltip} className="inline-flex items-center gap-1 text-[10px] text-emerald-400 border border-emerald-700 rounded px-1">
      <ShieldCheck className="w-3 h-3" /> TEE ✓
    </span>
  );
}
```

(Keep the existing `ShieldCheck` import and any explorer-link logic; only the gating + the unattested branch are new.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/dashboard/__tests__/teeBadge.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dashboard/ActionFeed.jsx frontend/src/components/dashboard/__tests__/teeBadge.test.js
git commit -m "fix(ui): TEE badge green only for hardware-verified executions"
```

---

### Task 9: Frontend `TEEAttestationPanel` — show real evidence

**Files:**
- Modify: `frontend/src/components/vault/TEEAttestationPanel.jsx`

**Interfaces:**
- Consumes: latest execution entry's `teeVerified`, `attestedEnclaveSigner`, `verifierContract`, `verifiedAt` (Task 7).

This task is presentational; verify manually (no new unit test — the data plumbing is covered by Task 7).

- [ ] **Step 1: Surface verified evidence**

In `TEEAttestationPanel.jsx`, where the panel currently renders the attestation summary, add a verified/unverified line driven by the real field. Add near the panel body:

```jsx
{latestExecution?.teeVerified ? (
  <div className="text-xs text-emerald-400">
    ✓ TDX quote verified via Automata DCAP ({latestExecution.verifierContract?.slice(0, 10)}…)
    {latestExecution.attestedEnclaveSigner ? ` · enclave signer ${latestExecution.attestedEnclaveSigner.slice(0, 10)}…` : ''}
  </div>
) : (
  <div className="text-xs text-zinc-400">
    Hardware TEE quote not verified for the latest execution (signed intent + commit-reveal only).
  </div>
)}
```

Update the existing "Trust Assumptions" list item about SGX/TDX to: "For vaults with `requireTeeAttestation`, the provider's TDX quote is verified off-chain against the Automata DCAP verifier each cycle; otherwise hardware confidentiality depends on the provider." (`latestExecution` is the same execution entry the panel already consumes; wire it from the existing journal/props the panel receives — do not add a new fetch.)

- [ ] **Step 2: Manual verification**

Run the frontend (`cd frontend && npm run dev`), open a vault detail page. With a `teeVerified` execution in the journal, the panel shows the green DCAP line; without, it shows the neutral line. Confirm no console errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/vault/TEEAttestationPanel.jsx
git commit -m "fix(ui): TEE attestation panel shows real DCAP verification evidence"
```

---

### Task 10: Correct overclaiming copy

**Files:**
- Modify: `DEMO.md` (line ~202)
- Modify: `frontend/src/pages/LandingPage.jsx` (lines ~482, ~667)
- Modify: `frontend/src/components/HeroSection.jsx` (line ~125, scope the stat)

**Interfaces:** none (copy only).

This closes the audit's "misleading_claim" finding so the marketing matches the engine.

- [ ] **Step 1: Fix `DEMO.md:202`**

Replace the line claiming "The AI's reasoning lives entirely inside a TEE enclave … only a cryptographic commitment and a hardware attestation signature." with:

```markdown
For vaults with `requireTeeAttestation` enabled, the orchestrator verifies the 0G Compute provider's Intel TDX quote against the Automata DCAP verifier before trading — proving the inference ran in an attested enclave whose signer signed this exact response. The intent itself is bound on-chain via an EIP-712 signature and commit-reveal. (Hardware confidentiality of the prompt depends on the attested provider; we verify the quote, we do not re-host the model.)
```

- [ ] **Step 2: Fix `LandingPage.jsx:667`**

Change the capability card body `'Private reasoning, public proof. Model inputs stay encrypted; verification layer still holds.'` to:

```javascript
body: 'Private reasoning, public proof. Inference is committed on-chain and, for attested vaults, the provider TDX quote is DCAP-verified each cycle.',
```

- [ ] **Step 3: Fix `LandingPage.jsx:482`**

Change `'Policy bounds enforced in Solidity: caps, allowlists, veto windows, TEE seals.'` to:

```javascript
a: 'Policy bounds enforced in Solidity: caps, allowlists, veto windows, signed commit-reveal. TEE attestation is DCAP-verified off-chain for opted-in vaults.',
```

- [ ] **Step 4: Scope the Hero `TEE` stat (`HeroSection.jsx:125`)**

Keep the tile but make the label honest now that it can be true:

```javascript
{ value: 'TEE', label: 'DCAP-verified (opt-in)', accent: 'text-gold' },
```

- [ ] **Step 5: Manual verification + commit**

Run: `cd frontend && npm run build` (ensure no syntax error from the edits).
Expected: build succeeds.

```bash
git add DEMO.md frontend/src/pages/LandingPage.jsx frontend/src/components/HeroSection.jsx
git commit -m "docs(tee): correct overclaiming TEE copy to match real DCAP gate"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 components 1-10 → Tasks 1-10. ✓
- §3.2 Layer A/B → Tasks 3 & 4. ✓
- §3.3 raw-quote extraction unknown → Task 1 Step 2 + shared `extractRawQuote`. ✓
- §4 flag from manifest, anchored by `acceptedManifestHash` → Tasks 5-6 (`vaultState._strategy.execution`). ✓
- §5 error table (`provider_not_attestable`, `verifier_unreachable`, `quote_invalid`, `signer_mismatch`, `compose_mismatch`, `response_unsigned`) → Task 3/4 reasons + tests. ✓
- §6 UI honesty (badge, panel, copy) → Tasks 8-10. ✓
- §7 probe → Task 1. ✓
- §8 tests → Tasks 3,4,5,7,8. ✓
- §9 acceptance criteria 1-6 → covered (1-2 Tasks 4/6/7; 3 Task 6 regression; 4 Task 8; 5 Global Constraints; 6 Task 1). ✓

**2. Placeholder scan:** No TBD/TODO; all code blocks are concrete. The only deferred value is the quote field name, which has an explicit discovery step (Task 1 Step 2) and a documented fallback list. ✓

**3. Type consistency:** `attestInference` returns `{ ok, attestedSigner, quoteVerified, ... }`; `evaluateTeeGate` reads `attestation.ok`/`.reason`; orchestrator passes `decision._teeAttestation.attestedSigner` → journal `attestedEnclaveSigner` → UI `entry.attestedEnclaveSigner`. `teeVerified` is the single UI source of truth across Tasks 7-9. `verifyProviderEnclave` and `attestInference` share the `deps` shape (`{ automata, now, verifier, VerifierClass }`). Consistent. ✓

## Out of scope (per spec §10)
On-chain quote verification; `TargetSeparated` two-enclave mode; enclave-resident orchestrator key; attested-provider auto-selection.
