# Design: Real TEE Attestation via 0G Compute (off-chain gate)

**Date:** 2026-06-24
**Status:** Approved design — pending spec review → implementation plan
**Owner:** Aegis Vault team

## 1. Problem & Goal

Today the project labels its sealed-mode pipeline "TEE attestation," but the 2026-06-24 audit
established there is **no hardware TEE** in the codebase: the "TEE signer" is an ordinary EOA
(`TEE_SIGNER_PRIVATE_KEY`), `SealedLib.verifyAttestation` is a bare `ecrecover`, and
`attestationReportHash` is just `keccak256(provider, chatId, model, keccak256(content))`. The 0G
serving-broker SDK *ships* a genuine hardware-attestation path (`verifier.verifyService` → TDX
quote → `Automata.verifyQuote`) but the application never wires it in — even its one verification
call (`broker.inference.processResponse`) is logged and discarded.

**Goal:** make TEE real by adding an **off-chain attestation gate**: before an inference is used to
trade, cryptographically prove that the inference came from the provider's Intel **TDX** enclave,
validated to Intel's root of trust via the **Automata DCAP** verifier. If a vault opts in
(`requireTeeAttestation`) and attestation cannot be proven, **skip the cycle (no trade)**.

### What this proves (genuinely real)

For every executed inference on an opted-in vault:
1. **Quote validity** — the provider's TDX quote validates to Intel's root of trust via the Automata
   on-chain DCAP verifier (read-only `eth_call`, no gas, no deploy).
2. **Signer binding** — the response-signing key embedded in the attested quote equals the
   `teeSignerAddress` the provider registered on the 0G serving contract.
3. **Response freshness** — *this* cycle's inference response is signed by that enclave signer
   (per-`chatId` signature check), so a cached/forged response is rejected.

### Non-goals (per approved decisions)

- **On-chain unchanged.** No change to `SealedLib`, `ExecLib`, or the vault contracts. The on-chain
  flow stays `ecrecover(intentHash) == attestedSigner` + commit-reveal.
- **No contract deploy, no gas.** Automata is called read-only via public RPC.
- **Orchestrator key not moved into an enclave.** The orchestrator's intent-signing key stays as-is;
  this gate is about the *provider's inference enclave*, not our signer.
- **No on-chain quote verification** (that was the rejected "Option C"). The verified-quote result is
  an off-chain go/no-go plus a truthful local record.

## 2. Key decisions (locked)

| Decision | Choice |
|---|---|
| Depth | Off-chain attestation gate; on-chain unchanged |
| Quote-validation rigor | Automata DCAP read-only `staticCall` + signer-address match + compose-hash |
| Failure behavior | **Fail-closed, per-vault opt-in flag** `requireTeeAttestation` |
| Flag location | **Strategy manifest** (`execution.requireTeeAttestation`), integrity anchored by the on-chain `acceptedManifestHash` already read in `vaultReader.js` — keeps on-chain unchanged while making the flag tamper-evident |
| Scope | Verification engine **+ UI/marketing honesty alignment** |
| Caching | Cache only positive heavy-verification results per `provider:imageDigest`, TTL default 1h; per-response signature check every cycle; never cache failures |

## 3. Architecture

### 3.1 Components

| # | File | Role |
|---|------|------|
| 1 | `orchestrator/src/services/teeAttestation.js` **(new)** | Verification engine. Public: `attestInference(providerInfo, chatId, opts)` → `{ ok, attestedSigner, quoteVerified, signerMatch, composeOk, responseSigned, reason, verifiedAt, verifierContract }`. Holds the positive-result cache. |
| 2 | `orchestrator/src/services/ogCompute.js` | Expose what the engine needs: `broker.verifier`, `getService(provider)` (→ `teeSignerAddress`, `additionalInfo`), the selected `providerInfo`, and the per-response `chatId` (already returned by `chatCompletion`). Add `getProviderService()` helper. |
| 3 | `orchestrator/src/services/orchestrator.js` | New gate adjacent to the existing sealed-mode skip (`~:667-673`), before `buildExecutionIntent` (`~:704`). On fail → `vaultResult.status = 'skipped_tee_unattested'` and return; on pass → attach `decision._teeAttestation`. |
| 4 | `manifests/*.json` + manifest loader | New optional field `execution.requireTeeAttestation: boolean`. Read alongside the existing manifest parse; defaults `false`. |
| 5 | `orchestrator/src/services/storage.js` (journal) | Persist real fields on the cycle/execution record: `teeVerified`, `attestedSigner`, `quoteVerified`, `verifierContract`, `verifiedAt`. |
| 6 | `orchestrator/src/config/index.js` | New `teeAttestation` block: `{ automataRpc, automataAddress, cacheTtlMs, fetchTimeoutMs }`, defaults from SDK constants (`0xE26E11B257856B0bEBc4C759aaBDdea72B64351F`, `https://1rpc.io/ata`, 3_600_000, 60_000). |
| 7 | `frontend/src/components/dashboard/ActionFeed.jsx` | `TeeAttestedBadge` renders green "TEE ✓" only when `entry.teeVerified === true`; otherwise a neutral "unattested" marker. Driven by the journal field, not `attestationReportHash != 0`. |
| 8 | `frontend/src/components/vault/TEEAttestationPanel.jsx` | Show real evidence: quote verified via Automata, enclave signer, verifier contract + chain, `verifiedAt`. |
| 9 | Marketing/demo copy | Fix overclaims: `DEMO.md:202`, `LandingPage.jsx:667` ("Model inputs stay encrypted"), `LandingPage.jsx:482` ("TEE seals" in Solidity), `HeroSection.jsx:125` ("TEE" stat tile). |
| 10 | `orchestrator/scripts/probe-tee-attestation.js` **(new)** | One-off feasibility probe (see §7). |

### 3.2 Verification flow (two layers)

**Layer A — heavy, cached per `provider:imageDigest` (TTL default 1h):**
```
svc      = broker.verifier.getService(provider)        // teeSignerAddress (on-chain), additionalInfo
report   = broker.verifier.getQuote(provider)          // rawReport: TDX quote + report_data
quoteOk  = automata.verifyAndAttestOnChain.staticCall(rawQuote)   // read-only, no gas → quoteVerified
signerEmbedded = extractTeeSignerAddress(report)
signerMatch    = signerEmbedded == svc.teeSignerAddress
composeOk = processDStackVerification(report).composeVerificationPassed   // image/compose integrity
→ cache { attestedSigner: signerEmbedded, quoteVerified, signerMatch, composeOk, verifiedAt }
```

**Layer B — cheap, every cycle:**
```
sig = broker.verifier.fetchSignatureByChatID(url, chatId, model)   // { text, signature }
responseSigned = verifySignature(sig.text, sig.signature, attestedSigner)
```

`ok = quoteVerified && signerMatch && composeOk && responseSigned`. The compose-hash check matters:
without it, a cryptographically valid TDX quote from a *different or malicious image* would pass
quote+signer alone. Only positive Layer-A results are cached; Layer B runs every cycle so a
stale/forged response is always caught.

### 3.3 Raw-quote extraction (implementation risk to confirm)

`getQuote()` returns `{ rawReport (JSON string), signingAddress }`. `Automata.verifyQuote(rawQuote)`
expects the raw TDX quote bytes. During implementation, confirm the exact field inside `rawReport`
that holds the quote bytes (likely `quote` / `intel_quote`) and whether it needs hex/base64
decoding before being passed to the verifier. This is the single integration unknown in an otherwise
SDK-backed path; cover it with a probe (§7) and a unit test fixture.

## 4. Data flow & gate placement

```
chatCompletion() → { content, chatId, provider, model }   // ogCompute.js (unchanged shape)
        │
        ▼  (decision built, _computeResponse present)
orchestrator.js cycle:
   ... existing checks (paused, policy, sealed-mode skip) ...
   if (manifest.execution?.requireTeeAttestation) {
       att = await attestInference(providerInfo, decision._computeResponse.chatId)
       if (!att.ok) { vaultResult.status = 'skipped_tee_unattested'; vaultResult.teeReason = att.reason; return }
       decision._teeAttestation = att
   }
   intent = await buildExecutionIntent(...)   // unchanged
   ...
   logExecution({ ..., teeVerified: att?.ok === true, attestedSigner: att?.attestedSigner,
                  quoteVerified: att?.quoteVerified, verifierContract: att?.verifierContract,
                  verifiedAt: att?.verifiedAt })
```

The flag is read from the strategy manifest (already loaded per vault). Its integrity is anchored by
the on-chain `acceptedManifestHash` (`vaultReader.js:58-66`): a vault has cryptographically accepted
a specific manifest hash, so an operator cannot silently flip `requireTeeAttestation` without a
manifest upgrade. No new on-chain field is required.

## 5. Error handling (fail-closed for flagged vaults)

| Condition | `reason` | Action when flag ON | Action when flag OFF |
|---|---|---|---|
| Provider exposes no attestation (404 / no `TEEVerifier`) | `provider_not_attestable` | skip cycle | proceed (legacy) |
| Automata RPC unreachable / timeout | `verifier_unreachable` | 1 short retry, then skip | proceed |
| `verifyQuote` returns false (sig/TCB fail) | `quote_invalid` | skip cycle | proceed |
| Embedded signer ≠ on-chain `teeSignerAddress` | `signer_mismatch` | skip cycle | proceed |
| Compose/image hash mismatch (`processDStackVerification`) | `compose_mismatch` | skip cycle | proceed |
| Response signature mismatch | `response_unsigned` | skip cycle | proceed |

Rules:
- **Only positive Layer-A results are cached.** A transient failure is never cached, so the next
  cycle retries cleanly.
- A skip is *not* an error: it logs at `warn`, sets `vaultResult.status = 'skipped_tee_unattested'`,
  and the cycle continues to the next vault.
- **`TargetSeparated` (broker + LLM in two enclaves):** MVP handles the `combined` architecture.
  Separated-mode (two reports) is a documented follow-up; until then a separated provider is treated
  as `provider_not_attestable` (fail-closed for flagged vaults).

## 6. UI / honesty alignment

- **`ActionFeed.jsx` `TeeAttestedBadge`:** green "TEE ✓" **iff** `entry.teeVerified === true`. For
  legacy/non-verified entries show a neutral "unattested" (or omit), never green. Source of truth is
  the journal field, not `attestationReportHash != 0`.
- **`TEEAttestationPanel.jsx`:** surface the real proof — "Quote verified via Automata DCAP
  (`0xE26E…351F` on Automata mainnet)", enclave signer, `verifiedAt`. Keep the honest "Trust
  Assumptions" list; update it to state hardware verification is now performed for opted-in vaults.
- **Copy fixes (truthful, not aspirational-as-present):**
  - `DEMO.md:202` — rewrite "reasoning lives entirely inside a TEE enclave … hardware attestation
    signature" to describe the real mechanism (TDX quote verified via Automata for opted-in vaults;
    commit-reveal + EIP-712 signature on-chain).
  - `LandingPage.jsx:667` — "Model inputs stay encrypted" → qualify (content is committed/hashed;
    confidentiality depends on the attested provider enclave).
  - `LandingPage.jsx:482` — "TEE seals" enforced in Solidity → correct (TEE attestation is verified
    off-chain; Solidity enforces caps/allowlists/veto + signature/commit-reveal).
  - `HeroSection.jsx:125` — "TEE" stat tile → keep, but ensure the claim is scoped to attested
    vaults now that it can be true.

## 7. Step 0 — feasibility probe (must run first)

`orchestrator/scripts/probe-tee-attestation.js`: for the configured provider, call `getService`,
`getQuote`, extract the quote bytes, and run `automata.verifyAndAttestOnChain.staticCall`. Print a
clear PASS/FAIL plus the embedded vs on-chain signer. This closes the one runtime unknown — whether
the 0G Compute provider actually exposes a TDX quote — **before** any vault enables the flag and
halts trading. If no TEE-capable provider is available, we learn it here and can (a) select an
attested provider or (b) postpone enabling the flag.

## 8. Testing

- **`orchestrator/test/tee-attestation.test.js`** (mock `broker.verifier` + Automata contract):
  - all checks pass → `ok: true`, correct `attestedSigner`
  - `verifyQuote` false → `ok: false`, `reason: 'quote_invalid'`
  - embedded signer ≠ on-chain → `reason: 'signer_mismatch'`
  - compose/image hash mismatch → `reason: 'compose_mismatch'`
  - response signature mismatch → `reason: 'response_unsigned'`
  - provider not attestable (throw/404) → `reason: 'provider_not_attestable'`
  - cache: second call within TTL skips Layer A; after TTL re-verifies; failures not cached
- **Orchestrator gate test:** `requireTeeAttestation` + failing attestation → `skipped_tee_unattested`,
  no `buildExecutionIntent`; passing attestation → proceeds and journal carries real fields.

## 9. Acceptance criteria

1. With `requireTeeAttestation: true` and a genuinely attested provider, a cycle executes and the
   journal records `teeVerified: true` with a non-null `attestedSigner` and `verifierContract`.
2. With the flag on and any attestation check failing, **no trade is submitted** and the cycle is
   marked `skipped_tee_unattested` with a specific `reason`.
3. With the flag off, behavior is byte-for-byte the legacy path (regression-safe).
4. The dashboard "TEE" badge is green **only** for `teeVerified === true` entries.
5. No on-chain contract change; no gas spent on verification.
6. `probe-tee-attestation.js` produces a definitive PASS/FAIL for the configured provider.

## 10. Out of scope / follow-ups

- On-chain quote verification (Automata `verifyAndAttestOnChain` as a state-changing call binding the
  quote into the intent) — deferred (rejected Option C).
- `TargetSeparated` two-enclave verification.
- Moving the orchestrator intent-signing key into an enclave.
- Provider auto-selection that prefers attested providers (engine picks `preferred`/first today).
