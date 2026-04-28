# TEE Attestation Verification — End-to-End Proof

**First V3 sealed-mode execution on 0G Aristotle Mainnet**
Block 31665957 · Tx `0x0d7334b8…536005e` · 2026-04-27 22:31 UTC

This document walks through the cryptographic chain that binds an off-chain AI inference (0G Compute) to an on-chain swap. Every step can be reproduced from public data: the journal entry on the orchestrator host plus a single tx receipt from `https://evmrpc.0g.ai`.

---

## TL;DR

The on-chain event `SealedIntentExecuted` emitted by vault `0x847465dF…425e` carries the same `attestationReportHash` (`0x9b08c5c6…fba6`) that we recompute off-chain from the raw 0G Compute response stored in the orchestrator journal. The two values match byte-for-byte. The vault contract self-verifies the commit-reveal pair plus the EIP-712 signature from the TEE signer, so the AI inference is **cryptographically bound** to the swap that consumed user capital.

| Layer | What it proves | Status |
|---|---|---|
| `keccak256(provider, chatId, model, keccak256(content))` | Reproducibility of the attestation hash from the raw response | ✅ |
| EIP-712 signature recoverable to `policy.attestedSigner` | Non-repudiation — only the TEE signer authorized the intent | ✅ |
| Commit-reveal: `commitHash == keccak256(intentHash ‖ attestationReportHash)` | Attestation cannot be back-fitted after the fact | ✅ |
| `attestationReportHash != ZeroHash` | Sealed mode rejects local-fallback intents | ✅ |
| TEE-hardware quote (SGX/TDX) | "Plaintext was never visible during compute" — depends on provider hardware | ⚠️ provider-attestation only |

---

## Actors and addresses

| Role | Address | Source |
|---|---|---|
| Vault (V3, sealed mode) | `0x847465dFf5403cf044c6BdDA5180CF29d2B8425e` | created via `AegisVaultFactoryV3.createVault` |
| Vault owner | `0xcDC43DbFFEd89F52BC6b699FAeC52742e6dCD8C1` | EOA that called createVault |
| Executor + TEE signer | `0x98cC8351C1310FD54B9090dF3fcA80CB61d7b5E7` | orchestrator wallet (matches `policy.attestedSigner`) |
| 0G Compute provider | `0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C` | registered service for `zai-org/GLM-5-FP8` |
| Jaine USDC.e/W0G pool | `0x961da9b2fd03e04b088a90843a93e66f13112d0a` | UniswapV3 fork pool used for the swap |
| JaineVenueAdapter V2 | `0x261244010A6D87e043b3489D93fA573cdc2274B6` | router-side adapter (multi-hop) |
| Base asset (USDC.e) | `0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E` | 6 decimals |
| W0G | `0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c` | 18 decimals |

---

## 1. The 0G Compute response (journal entry, cycle #28)

The orchestrator persists every AI response under `decision._computeResponse` in `orchestrator/data/journal.json`. For cycle #28 the entry contains:

```json
{
  "provider": "0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C",
  "chatId":   "98bf581a-6cef-4d69-b3aa-48b3c5d11cb4",
  "model":    "zai-org/GLM-5-FP8",
  "content":  "```json\n{\n  \"action\": \"hold\",\n  \"asset\": \"USDC\",\n  \"size_bps\": 0,\n  \"confidence\": 0.45,\n  \"risk_score\": 0.55,\n  \"reason\": \"RANGE_NOISY regime with mixed MTF alignment and negative MACD momentum creates unfavorable conditions despite extremely oversold RSI reading.\",\n  \"ai_context_score\": 35,\n  \"timing_score\": 25\n}\n```"
}
```

Notice the AI itself returned `"action": "hold"`. The eventual `BUY` came from the on-chain decision engine (DE v1) overriding the AI hint because the technical signals (RSI 13.7 = extreme oversold, edge=54 ≥ minEdge=52, quality=35 ≥ minQ=35) were strong enough to trigger entry. This split is **intentional and transparent**: the AI is one input, technical scoring is another. Both are auditable.

---

## 2. Recompute the attestation hash off-chain

The hashing function lives in [`orchestrator/src/services/executor.js:97-107`](../orchestrator/src/services/executor.js#L97-L107):

```javascript
export function computeAttestationReportHash(computeResponse) {
  if (!computeResponse) return ethers.ZeroHash;
  const { provider, chatId, content, model } = computeResponse;
  const contentDigest = ethers.keccak256(ethers.toUtf8Bytes(content || ''));
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'string', 'string', 'bytes32'],
      [provider || ethers.ZeroAddress, chatId || '', model || '', contentDigest]
    )
  );
}
```

Plug the journal data in:

```bash
node -e "
const j = JSON.parse(require('fs').readFileSync('orchestrator/data/journal.json','utf8'));
const e = j.filter(x => x.type==='cycle' && x.cycle===28).slice(-1)[0];
const cr = e.vaultResults[0].decision._computeResponse;
const { ethers } = require('ethers');
const contentDigest = ethers.keccak256(ethers.toUtf8Bytes(cr.content || ''));
const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
  ['address','string','string','bytes32'],
  [cr.provider, cr.chatId, cr.model, contentDigest]
));
console.log(hash);
"
```

Output:

```
0x9b08c5c6abeb5072bdfe997cfbc369b389c1cb131a3e7b853774c390652ffba6
```

---

## 3. Read the on-chain `SealedIntentExecuted` event

```bash
curl -s -X POST https://evmrpc.0g.ai \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["0x0d7334b8dae96ebe193d74b10a1cc8acba069ddc09792824f9ad18e36536005e"],"id":1}' \
  | jq '.result.logs[0]'
```

Returns:

```json
{
  "address": "0x847465dff5403cf044c6bdda5180cf29d2b8425e",
  "topics": [
    "0x1a6434e9b6653fb533348ebac4eb90b194369ca56f59817e8bf3dc9a7fa6026b",
    "0x000000000000000000000000847465dff5403cf044c6bdda5180cf29d2b8425e",
    "0x2afe611aee87260b59496b9d2cdd65932dfa7b1268e9c364bbff7d352c63167c",
    "0x00000000000000000000000098cc8351c1310fd54b9090df3fca80cb61d7b5e7"
  ],
  "data": "0x9b08c5c6abeb5072bdfe997cfbc369b389c1cb131a3e7b853774c390652ffba6"
}
```

Decoded against `SealedIntentExecuted(address vault, bytes32 intentHash, address signer, bytes32 attestationReportHash)`:

| Field | Value | Cross-check |
|---|---|---|
| `vault` | `0x847465dF…425e` | ✅ matches log line `── Vault 0x847465...425e ──` |
| `intentHash` | `0x2afe611aee87260b59496b9d2cdd65932dfa7b1268e9c364bbff7d352c63167c` | ✅ matches log `Intent: 0x2afe611a...` |
| `signer` | `0x98cC8351…b5E7` | ✅ matches `policy.attestedSigner` |
| `attestationReportHash` | `0x9b08c5c6…fba6` | ✅ **MATCHES** the off-chain recomputation |

---

## 4. The full chain of evidence

```
Real AI inference                                 (zai-org/GLM-5-FP8 @ 0xd9966e13…)
            │
            │ {provider, chatId="98bf581a-…", model, content}
            ▼
keccak256(abi.encode(provider, chatId, model, keccak256(content)))
            │
            │ attestationReportHash = 0x9b08c5c6…fba6
            ▼
ExecutionIntent struct (10 fields incl. attestation)
            │
            │ EIP-712 signed by TEE signer 0x98cC8351…
            ▼
commitIntent(commitHash)                          ← block 31665953
            │
            │ commitHash = keccak256(intentHash ‖ attestationReportHash)
            ▼
executeIntent(intent, sig)                        ← block 31665957
            │
            │ Vault validates:
            │  1. signer == policy.attestedSigner                        ✓
            │  2. keccak256(intentHash ‖ attestation) == committedHash   ✓
            │  3. attestationReportHash != ZeroHash (sealed-mode req)    ✓
            ▼
emit SealedIntentExecuted(vault, intentHash, signer, attestationReportHash)
            │
            ▼
[ON-CHAIN EVENT MATCHES OFF-CHAIN RECOMPUTATION] ✅
```

---

## 5. Full event log of the swap

The execute tx emitted 12 events (decoded against the orchestrator-bundled ABIs):

| # | Source | Event | Meaning |
|---|---|---|---|
| 0 | vault | **`SealedIntentExecuted`** | Sealed-mode commit-reveal validated, attestation hash bound |
| 1 | vault | `IntentSubmitted` | Intent registered in `ExecutionRegistry` |
| 2 | USDC.e | `Approval` | Vault approved spend to router |
| 3 | USDC.e | `Transfer` | USDC.e moved into router |
| 4 | USDC.e | `Approval` | Router-side approval reset |
| 5 | W0G | `Transfer` | **Vault received W0G** |
| 6 | USDC.e | `Transfer` | Pool routing leg |
| 7 | Jaine pool `0x961da9b2…` | **`UniV3.Swap`** | Real DEX swap on the USDC.e/W0G pool |
| 8 | USDC.e | `Approval` | Cleanup approval |
| 9 | jaineAdapterV2 | (custom event) | Adapter `SwapRouted`-style hook |
| 10 | USDC.e | `Approval` | Cleanup approval |
| 11 | vault | **`IntentExecuted`** | Final lifecycle confirmation, `success=true` |

Three events together prove the full path: AI signal → on-chain attestation → real DEX liquidity → W0G delivered to the vault.

---

## 6. What this proves vs. what it doesn't

### ✅ Cryptographically guaranteed

1. **Reproducibility** — anyone who has the journal entry can recompute the hash and compare against the on-chain event. Done above.
2. **Non-repudiation** — the EIP-712 signature in the intent recovers to `policy.attestedSigner` (the TEE signer). No other key can forge an intent.
3. **Commit binding** — the orchestrator commits `keccak256(intentHash ‖ attestationReportHash)` *before* revealing the intent. It cannot back-fit an attestation to a decision after the fact.
4. **Integrity of the inference content** — `keccak256(content)` is part of the hash. Changing one character in the AI response breaks the match and the vault will reject the intent.
5. **Sealed-mode hard gate** — the contract reverts with `MissingAttestationReport()` (selector `0x277fabd5`) if `attestationReportHash == 0x00…00`. Local-heuristic fallback (no AI) cannot impersonate a real inference.

### ⚠️ Honest disclosure — what is *not* (yet) cryptographically guaranteed

1. **TEE-hardware confidentiality.** This is **provider attestation**, not Intel SGX/TDX quote verification. We prove "this provider emitted this content for this chatId." We do *not* prove "no one outside the TEE saw the prompt or model weights." Full TEE-grade requires fetching the SGX/TDX quote from the provider and verifying it against Intel's attestation service — out of scope for the on-chain check today.
2. **Provider honesty about caching / replay.** A malicious provider could in principle return a cached response without re-running inference. Mitigation: every prompt includes a fresh nonce derived from the cycle timestamp + vault state, so two cycles never produce identical hashes.
3. **AI ↔ decision link.** The decision engine v1 may override the AI's `action` field (cycle #28 is exactly this case — AI said `hold`, engine chose `BUY` because RSI 13.7 + edge 54). The override logic is fully transparent in source, but the *override decision itself* is not bound on-chain. The attestation guarantees "AI X said Y" — not "this swap was decided exclusively by AI X."

These limits are documented in [`orchestrator/src/services/executor.js:92-95`](../orchestrator/src/services/executor.js#L92-L95).

---

## 7. Reproducible audit script

Drop the snippet below into a file and run it to re-verify every successful execution in the journal:

```javascript
// audit.js
const fs = require('fs');
const { ethers } = require('ethers');

const journal = JSON.parse(fs.readFileSync('orchestrator/data/journal.json', 'utf8'));

journal
  .filter(x => x.type === 'cycle')
  .forEach(c => {
    c.vaultResults?.forEach(r => {
      if (!r.success || !r.decision?._computeResponse) return;
      const cr = r.decision._computeResponse;
      const contentDigest = ethers.keccak256(ethers.toUtf8Bytes(cr.content || ''));
      const recomputed = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'string', 'string', 'bytes32'],
          [cr.provider || ethers.ZeroAddress, cr.chatId || '', cr.model || '', contentDigest]
        )
      );
      console.log(`cycle #${c.cycle}  tx ${r.txHash?.slice(0, 16)}…  attestation ${recomputed}`);
    });
  });
```

```bash
node audit.js
```

For each line, fetch the corresponding tx receipt and confirm the `data` field of the first log (`SealedIntentExecuted`) equals the printed hash. Any mismatch indicates either tampering with the journal or a contract bug — both are fail-loud.

---

## 8. Architectural fix that made this possible

Before this milestone the orchestrator would silently fall back to a local heuristic when 0G Compute was unreachable, producing a zero attestation hash and burning a commit-reveal gas pair on a guaranteed `MissingAttestationReport` revert.

The fix lives in [`orchestrator/src/services/orchestrator.js`](../orchestrator/src/services/orchestrator.js):

```javascript
// Sealed-mode vaults bind the AI inference output into the on-chain intent
// via a non-zero `attestationReportHash`. Local heuristic fallback produces
// no attestation (decision._computeResponse === null), so submitting would
// revert with `MissingAttestationReport` (selector 0x277fabd5). Skip the
// cycle and wait for the next 0G Compute attempt — better than burning a
// commit-reveal pair on a guaranteed revert.
if (vaultState.policy?.sealedMode === true && !decision._computeResponse) {
  logger.warn('Sealed-mode vault: AI inference unavailable — skipping submission.');
  vaultResult.status = 'skipped_no_attestation';
  return vaultResult;
}
```

The behavior is *derived from on-chain vault policy* (`sealedMode`), not from an environment flag — consistent with the project's preference for architectural fixes over env overrides.

---

## 9. References

- ABI definitions: [`orchestrator/src/abi/AegisVault_v3.json`](../orchestrator/src/abi/AegisVault_v3.json), [`orchestrator/src/abi/VaultEvents.json`](../orchestrator/src/abi/VaultEvents.json)
- Hash function: [`orchestrator/src/services/executor.js:97-107`](../orchestrator/src/services/executor.js#L97-L107)
- EIP-712 typed data: [`orchestrator/src/config/contracts.js:127-140`](../orchestrator/src/config/contracts.js#L127-L140)
- Sealed-mode skip guard: [`orchestrator/src/services/orchestrator.js`](../orchestrator/src/services/orchestrator.js) (search for `skipped_no_attestation`)
- Whitepaper sealed-mode section: [`WHITEPAPER.md`](../WHITEPAPER.md)
- Prior milestone (V1/V2 stack, no attestation binding): tx `0x7efe51ac…` on 2026-04-24
