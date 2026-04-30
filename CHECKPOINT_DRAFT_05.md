# Hackathon Checkpoint Draft #5 — TEE attestation visible end-to-end + operator runbook (2026-05-01)

> Untuk diisi di form **Checkpoints** pada platform hackathon.

---

## Type

```
Development
```

---

## Title (49 / 50)

```
TEE attestation visible in UI + operator runbook
```

> Alternatif:
> - `Sealed·TEE badges live in dashboard + runbook` (46)
> - `TEE proof-of-attestation surfaced in dashboard` (46)
> - `Verifiable AI: TEE badges + operator onboarding` (48)

---

## Description (199 / 200)

```
TEE attestation surfaced end-to-end: orchestrator captures commit tx + signer, journal persists metadata, frontend renders Sealed·TEE chip + clickable TEE badge. New 393-line operator runbook.
```

---

## Link

```
https://github.com/mdlog/aegis-vault/commit/4bc054a
```

> Alternatif:
> - **TEE attestation cluster (orchestrator + frontend)**: `https://github.com/mdlog/aegis-vault/commit/4bc054a` ← strongest proof
> - **Operator runbook (docs/RUN_OPERATOR_ORCHESTRATOR.md)**: `https://github.com/mdlog/aegis-vault/commit/ca8dbac`
> - **Vite hook-call fix (wagmi/viem pre-bundle)**: `https://github.com/mdlog/aegis-vault/commit/e19cb5e`
> - **README hackathon positioning + sealed-mode expansion**: `https://github.com/mdlog/aegis-vault/commit/792a905`

---

## Image (saran)

**Gunakan screenshot salah satu dari** (urut prioritas):

- **Frontend `/app/vault/<sealed-v3>` hero** — `Sealed · TEE` chip emerald di samping `Active` chip, hover tooltip showing attested signer address. Bukti visual paling kuat: depositor bisa lihat sealed-mode status tanpa baca code.
- **Frontend `/app` AI Intelligence Feed** — `TEE` badge di execution entry yang sealed-mode, click-through ke `chainscan.0g.ai/tx/<commitTxHash>`. Closes the loop dari claim README "Verifiable AI is visible in the UI, not buried in logs".
- **Side-by-side**: ActionFeed entry → klik TEE badge → tab baru ke commit tx di explorer → tab kedua ke reveal tx (`0x0d7334b8…`). Ini PoC end-to-end auditability.
- **Operator runbook screenshot** — Step 6 "First start (manual)" log output yang expected, sebagai bukti dokumentasi cukup tegas untuk operator pihak ketiga onboard sendiri.

---

## Konteks (reference internal)

### Scope checkpoint ini — TEE attestation observability + operator-side enablement (2026-05-01)

Tiga thread paralel yang konvergen ke satu narrative: **"verifiable AI" tidak cukup di on-chain saja, harus visible di UX dan reproducible oleh operator pihak ketiga**:

1. **TEE attestation surfacing (orchestrator → journal → frontend)** — Sebelumnya, bukti bahwa execution sealed-mode hanya hidup di JSON log orchestrator. Sekarang `commitTxHash`, `attestedSigner`, `attestationReportHash` flow dari executor → storage journal → React component → badge UI yang clickable ke explorer.
2. **Operator onboarding runbook (`docs/RUN_OPERATOR_ORCHESTRATOR.md`)** — 393-line step-by-step dari "tidak punya apa-apa" → "first cycle executed", termasuk troubleshooting table 12-row, pre-flight wallet/balance checklist, PM2/systemd service files. Decentralization story dari hipotesis jadi reproducible.
3. **README hackathon-positioning + frontend dep-cache hygiene fix** — Bonus housekeeping: README "Why we should win" section yang merangkum claim ke juror, plus vite pre-bundle fix untuk wagmi/viem yang mencegah "Invalid hook call" akibat mid-session dep re-optimization.

V4 stack (commit `8abfa40`) tetap pre-deploy. Cluster ini complementary: V3 sealed-mode sekarang punya UI surface yang membuktikan claim TEE-attestation, sambil V4 strategy-binding menunggu mainnet deploy approval.

### Cluster #1: TEE attestation flow end-to-end

**Sebelum:** Sealed-mode execution menulis `attestationReportHash` ke `ExecutionIntent` on-chain, `SealedLib.ecrecover()` verify signature, semua kerja. Tapi UI tidak tahu — execution entry di ActionFeed sama saja antara public dan sealed mode.

**Sekarang:** Tiap layer carry attestation metadata:

| Layer | File | Yang di-add |
|---|---|---|
| Executor | [orchestrator/src/services/executor.js](orchestrator/src/services/executor.js) | Capture `commitTxHash`, `commitBlockNumber`, `teeSigner` dari `signIntentHashWithTeeKey()` + `commitReceipt`. Return ke caller as part of execution result. |
| Cycle runner | [orchestrator/src/services/orchestrator.js](orchestrator/src/services/orchestrator.js) | `logExecution(intent, execResult, decision, { vault, sealedMode, attestedSigner })` — pass vault policy live ke storage. |
| Journal storage | [orchestrator/src/services/storage.js](orchestrator/src/services/storage.js) | Persist `sealedMode`, `teeAttested` (computed: sealed && non-zero attestationReportHash), `attestedSigner`, `attestationReportHash`, `commitTxHash`, `commitBlockNumber` ke journal entry. Zero-hash treated sebagai "no attestation" supaya UI tidak render badge palsu. |
| Frontend feed | [frontend/src/components/dashboard/ActionFeed.jsx](frontend/src/components/dashboard/ActionFeed.jsx) | New `<TeeAttestedBadge>` component — render `TEE` chip emerald, tooltip multi-line (signer + report hash + commit tx prefix), click-through ke commit tx di explorer kalau ada. |
| Frontend vault detail | [frontend/src/pages/VaultDetailPage.jsx](frontend/src/pages/VaultDetailPage.jsx) | New `Sealed · TEE` chip di `<VaultHero>` — render kalau `policy.sealedMode === true`, tooltip show `attestedSigner` address full + verification mechanism explanation. |

```
                Sealed-mode execution flow (with new observability layer)
                
   Orchestrator cycle ─────────────────────────────────────────────
   ExecutionIntent { intentHash, attestationReportHash, ... }       
                                           │
   signIntentHashWithTeeKey() ─────────────▼────────────────────────
   { signer, signature }                                              
   ────► capture teeSigner                                            
                                           │
   vault.commitIntent(commitHash) ─────────▼────────────────────────
   commitReceipt { hash, blockNumber }                                
   ────► capture commitTxHash, commitBlockNumber                      
                                           │
   wait ≥ 1 block, then revealAndExecute() ▼────────────────────────
   reveal receipt with status=1                                       
                                           │
   logExecution(..., { sealedMode, attestedSigner }) ──▼────────────
   journal entry { teeAttested, commitTxHash, attestedSigner, ... }   
                                           │
   Frontend useJournal() ──────────────────▼────────────────────────
   ActionFeed entry → <TeeAttestedBadge> → click → explorer commit tx
```

**Why it matters untuk hackathon judging:**
- Track 2 (Verifiable Finance) graded on **observable verifiability**. On-chain proof yang tidak ada UI surface = juror harus baca log/code. Sekarang badge → klik → explorer = 2-click verification.
- Closes README claim "Verifiable AI is visible in the UI, not buried in logs". Sebelumnya itu aspirasi; sekarang implementation match.
- Tidak ada feature flag — semua sealed-mode vault otomatis dapat badge selama policy `sealedMode = true` dan attestation hash non-zero.

### Cluster #2: Operator runbook (`docs/RUN_OPERATOR_ORCHESTRATOR.md`)

**Sebelum:** Decentralization story di pitch deck = "anyone can run an operator". Tapi practically butuh `OPERATOR_REGISTRATION_KIT.md` (form data) + `OPERATOR_GUIDE.md` (architecture) + tracing source code untuk wiring `.env` + reverse proxy. High friction untuk pihak ketiga.

**Sekarang:** Single 393-line runbook, 10 step structured:

| Step | Content |
|---|---|
| 0 | Pre-flight checklist — 6 resource (3 wallet roles dipisah, 0G Compute ledger, server spec, public endpoint) |
| 1 | Clone & install (with `--legacy-peer-deps` rationale) |
| 2 | Register operator on-chain — UI path **dan** `cast` CLI path |
| 3 | (Optional) Publish strategy manifest — termasuk canonical hash compute |
| 4 | (Optional) Stake USDC.e — full tier table dengan max NAV |
| 5 | `.env` configuration — wajib field flagged, security note operator-vs-executor-vs-TEE wallet separation |
| 6 | First start manual — expected log output sebagai checklist |
| 7 | Production deployment — PM2 (recommended) + systemd service file |
| 8 | Verify pickup oleh vault baru — log timing, API endpoint cek |
| 9 | Manual cycle trigger — API key + loopback security explanation |
| 10 | Health monitoring — 6-row metric/alert table |

Plus:
- **Troubleshooting table** 12-row covering common revert reasons (`OnlyExecutor`, `WrongStrategyHash`, `IntentVaultMismatch`, etc.) → cara fix
- **Cross-references** ke 6 dokumen related supaya operator tidak terjebak di satu doc
- **Quick reference contract address book** chain 16661 mainnet (12 contract addresses)
- Catatan V4 implication untuk operator yang nanti update manifest (24h timelock)

### Cluster #3: README marketing + vite hygiene

- **[README.md](README.md)** — "Why we should win" section (~6 bullet) merangkum claim hackathon ke juror, plus expanded sealed-mode section dengan 3 properties (MEV-resistant, TEE-bound, strategy-confidential). Murni positioning, tidak ada code change.
- **[frontend/vite.config.js](frontend/vite.config.js)** — Pre-bundle `wagmi`, `wagmi/connectors`, `viem`, `@rainbow-me/rainbowkit`, `@tanstack/react-query` di `optimizeDeps.include`. Root cause comment di file: mid-session re-optimization mengubah browserHash → modul yang sudah loaded reference hash lama → dua wagmi instance → dua React Context → `useContext` returns null → semua wagmi hook crash dengan "Invalid hook call". Pre-bundle at startup mencegah re-opt.

### Cross-references ke checkpoint sebelumnya

| Checkpoint | Tanggal | Bukti |
|---|---|---|
| #1 — First on-chain AI execution (V2) | 2026-04-24 | tx `0x7efe51ac…` (BUY 0G via V2 vault) |
| #2 — V3 + Khalani full deploy | 2026-04-27 | factory `0x75668Ca9…`, Khalani adapter `0xB65fdbb6…` |
| #3 — Audit-pass round-1 + round-2 | 2026-04-27 | commits `e3abd92` + `9a2a49a` (8 fixes + 4 hardening, +43 tests) |
| #4 — V4 pre-deploy + V3 sealed exec proof | 2026-04-28 | tx `0x0d7334b8…` + commit `8abfa40` |
| **#5 — Ini (TEE observability + operator runbook)** | **2026-05-01** | **commits `4bc054a` + `ca8dbac` + `e19cb5e` + `792a905`** |

### Verification one-liners

```bash
# 1. Journal entry now carries TEE-attestation metadata
curl -s "http://localhost:4002/api/journal/executions?limit=1" | jq '.[0] | {sealedMode, teeAttested, commitTxHash, attestedSigner}'
# → all four fields populated for sealed-mode entries; null for public-mode

# 2. Frontend builds clean with new components
cd frontend && npm run build
# → vite output: 0 warnings about TeeAttestedBadge or VaultHero changes

# 3. Frontend tests still green
cd frontend && npm test
# → 52/52 passing (no regression from new sealed-mode UI)

# 4. Operator runbook is self-contained — no broken cross-references
grep -E '\]\(\.\./|\]\(\./' docs/RUN_OPERATOR_ORCHESTRATOR.md | while read l; do
  path=$(echo "$l" | grep -oE '\([^)]+\)' | tr -d '()')
  test -e "docs/$path" || test -e "$path" && echo "OK: $path" || echo "MISSING: $path"
done

# 5. No regression on orchestrator unit tests
cd orchestrator && npm test
# → 186/186 passing (storage/executor changes are additive)
```

### What is NOT yet shipped (honest scope)

- **Manual UI smoke test belum dilakukan.** Code path sudah wire-up logically dan committed (`4bc054a`), tapi belum verifikasi visual: deposit → trigger sealed cycle → confirm badge muncul + click-through works. **Wajib lakukan sebelum claim checkpoint complete** — frontend tidak punya integration test yang exercise sealed-mode rendering end-to-end.
- **TeeAttestedBadge belum punya unit test.** Frontend test count tetap 52 — tidak nambah test untuk component baru.
- **V4 deploy masih pending** (carry-over dari checkpoint #4) — `CONFIRM_MAINNET=1` belum dijalankan.

**Checkpoint berikutnya (kandidat #6):**
- V4 deploy on 0G mainnet (carry-over) + first V4 strategy-bound execution
- Atau: operator pihak ketiga pertama yang onboard pakai runbook ini sebagai validation eksternal

---

## Pre-submit actions (must-do sebelum checkpoint ini di-finalize)

- [x] Commit cluster TEE-attestation: `executor.js + orchestrator.js + storage.js + ActionFeed.jsx + VaultDetailPage.jsx` (`4bc054a`)
- [x] Commit terpisah untuk `docs/RUN_OPERATOR_ORCHESTRATOR.md` (`ca8dbac`)
- [x] Commit terpisah untuk `frontend/vite.config.js` (`e19cb5e`)
- [x] Commit terpisah untuk `README.md` (`792a905`)
- [ ] **Manual UI smoke test**: deposit USDC.e ke sealed vault yang ada → trigger `/api/cycle` → verify `Sealed · TEE` chip render di vault detail + `TEE` badge render di ActionFeed entry + click navigates ke commit tx di chainscan
- [ ] Screenshot bukti UI untuk submission Image field
- [ ] Update `MEMORY.md`: tambah project memory baru "TEE attestation observable in UI" kalau ini jadi jadi milestone confirmed

---

## Push history (delta sejak checkpoint #4)

```
4bc054a  ui: surface TEE attestation end-to-end (orchestrator → journal → badges)             ← cluster #1
ca8dbac  docs: operator orchestrator runbook (zero-to-first-cycle)                              ← cluster #2
e19cb5e  frontend: pre-bundle wagmi/viem/rainbowkit to prevent mid-session hook crash          ← hygiene
792a905  readme: hackathon positioning + expanded sealed-mode 3-properties section             ← positioning
8abfa40  v4: full pre-deploy hardening across contracts, orchestrator, frontend                ← checkpoint #4
332989b  chore: address reviewer findings (F1+F4+F5)
c9c227f  ci: pin Node 20 + add ethers as SDK devDep
24b5dff  deploy: fresh operator stack + V3-only frontend
b580af9  landing: surface live V3 stats + Khalani capability card
```
