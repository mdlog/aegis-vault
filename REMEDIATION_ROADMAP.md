# Aegis Vault — Roadmap Remediasi Pasca-Audit (Post-TEE Findings)

> Dokumen ini berbasis verifikasi ground-truth (setiap klaim PMF dicek ke kode nyata, verdict CONFIRMED/PARTIAL/REFUTED) + analisis strategi multi-chain. Laporan PMF awal **belum terverifikasi** — beberapa klaimnya ternyata salah/dilebih-lebihkan. Bagian A meluruskan mana yang benar.

---

## A. Hasil Verifikasi — apa yang BENAR vs SALAH

| # | Klaim PMF | Verdict | Realita di kode (file:line) | Severity |
|---|-----------|---------|------------------------------|----------|
| 1 | Loss-limit (`maxDailyLossBps`/`stopLossBps`) di-enforce **off-chain saja** | **CONFIRMED** | Field ada (`VaultEvents.sol:20-21`) tapi tak pernah dibaca di jalur eksekusi. `PolicyLibrary.validateDailyLoss` = dead code (0 call-site). Veto off-chain nyata di `riskVeto.js:61-63`. Docblock mengakui: `ExecLib.sol:66-72`. | Medium |
| 2 | `executeIntent` cuma cek ECDSA vs `attestedSigner`; chain **tidak** parse quote SGX/TDX | **CONFIRMED** | `SealedLib.verifyAttestation` (`SealedLib.sol:17-32`): cuma signer≠0, hash≠0 (non-zero check saja), `ecrecover==attestedSigner`. Grep MRENCLAVE/DCAP = 0 match. | **High** |
| 3 | AegisGovernor efektif 1-of-1 | **PARTIAL** | Threshold=1 **CONFIRMED** (`deployments-mainnet.json:61-64`). TAPI sole owner `0x1525FBEf…`, **BUKAN** deployer `0x98cC8351…`. Kontrak M-of-N capable; di-deploy konfigurasi terlemah. | **High** |
| 4 | Protocol fee 20% tidak collectible | **PARTIAL** | Entry/exit fee 20% cut **collectible** inline (`IOLib.sol:103-105,132-134`). Perf/mgmt fee benar TIDAK collectible (`accrueFees`/`claimFees` = 0 match). NatSpec `ProtocolTreasury.sol:15` melebih-lebihkan. | Medium |
| 5 | TEE signer key di `.env` plaintext (tanpa HSM/KMS) | **CONFIRMED** | `process.env.TEE_SIGNER_PRIVATE_KEY` → `new ethers.Wallet(pk)` in-process (`config/index.js:138`, `executor.js:441-445`). Grep kms/hsm = 0. Git bersih. | **High** |
| 6 | 0G Storage disabled; journal SPOF → klaim "auditor recompute" runtuh | **PARTIAL** | SPOF **CONFIRMED** (writes off `ogStorage.js:49`, `instances:1`, JSON lokal, data/ tak di-mount docker). TAPI verifiabilitas inti **on-chain** (`WHITEPAPER.md:347`); "runtuh" terlalu kuat. | Medium |
| 7 | Insurance pool uncapitalized & undefined | **PARTIAL** | "Undefined" **REFUTED**: inflow nyata (`deposit()` + slash route), waterfall terdefinisi. Yang benar: uncapitalized di t=0 + link "fee→insurance" tak di-enforce. | Low |
| 8 | Reset V4 = audit-driven (bukan exploit); Arbitrum deployment nyata | **CONFIRMED** | Commit `77a65cd`/`41748f2` (audit 0 Critical). 8 address Arbitrum punya bytecode. Caveat: file Arbitrum gitignored; key V4 masih uncommitted. | Info |
| 9 | Loss-limit bisa di-enforce **on-chain** di 0G hari ini | **REFUTED** | Tidak feasible: tak ada storage PnL/NAV; **Pyth disabled di 0G**. Off-chain pun stub: `currentDailyLossPct:0` hardcoded (`vaultReader.js:198`). | Medium |

**Ringkasan:** 3 High terkonfirmasi (#2 attestation framing, #3 governor 1-of-1, #5 key plaintext) = risiko paling nyata. Klaim PMF yang **dikoreksi**: #3 (bukan deployer), #4 (entry/exit fee jalan), #6 (verifiabilitas inti on-chain), #7 (funding terdefinisi), #9 (mustahil on-chain di 0G).

---

## B. Rencana Perbaikan Berurutan

### P0 — Aman, kerjakan SEKARANG (off-chain / non-deploy)

| Item | Sumber | Sev | Apa | File | Effort |
|------|--------|-----|-----|------|--------|
| **P0-1.** Luruskan klaim attestation (off-chain verified) | #2 | High | Berhenti pasarkan "on-chain TEE-attested"; jujur: attestation diverifikasi off-chain, chain enforce "key approved menandatangani" | `WHITEPAPER.md`, NatSpec `SealedLib.sol` | M |
| **P0-2.** Luruskan klaim loss-limit (off-chain risk-veto) | #1,#9 | Med | Nyatakan loss-limit = parameter veto off-chain, bukan invariant on-chain; pause() = backstop | `WHITEPAPER.md`, `DocsPage.jsx` | S |
| **P0-3.** Wire PnL nyata ke veto off-chain | #9 | Med | `currentDailyLossPct` hardcoded 0 → veto loss **vacuous**. Isi NAV nyata supaya bisa fire | `vaultReader.js:198`, `orchestrator.js:128-129` | M |
| **P0-4.** Cleanup dead code fee + hide UI mati + NatSpec | #4 | Med | Hapus/tandai `FeeLib.computeAccrual/splitFee`; hide tombol Accrue/Claim; koreksi `ProtocolTreasury.sol:15` | `useVaultFees.js`, `VaultDetailPage.jsx`, `ProtocolTreasury.sol`, `FeeLib.sol` | M |
| **P0-5.** Cleanup dead code loss-limit | #1 | Med | Hapus `PolicyLibrary.validateAll/validateDailyLoss` (unreachable, menyesatkan) | `PolicyLibrary.sol` | S |
| **P0-6.** Luruskan klaim insurance | #7 | Low | "funds top-ups" → "may discretionarily seed via governance"; tampilkan balance live | `WHITEPAPER.md`, `ProductionStackSection.jsx`, `DocsPage.jsx` | S |
| **P0-7.** Luruskan klaim verifiabilitas journal | #6 | Med | Authoritative audit trail = on-chain; journal lokal = mirror non-authoritative | `WHITEPAPER.md` | S |
| **P0-8.** Persistensi data/ orchestrator | #6 | Med | Bind-mount `./orchestrator/data:/app/data` + VOLUME + backup | `docker-compose.yml`, `Dockerfile`, `storage.js` | M |
| **P0-9.** Commit deployment address book | #8 | Info | Commit `deployments-mainnet.json`; un-ignore/dokumentasikan Arbitrum | `deployments-*.json`, `.gitignore` | S |
| **P0-10.** Guard test key + assert key terpisah | #5 | Med | Gate Hardhat key; startup assert `TEE_SIGNER ≠ executor PRIVATE_KEY` | `test-execution.js`, `config/index.js` | S |

### P1 — Perubahan KONTRAK (redeploy + re-audit) — branch + test, JANGAN auto-deploy

> Vault V3/V4 = **EIP-1167 clone storage tetap** → tambah storage slot = **impl + factory baru + migrasi opt-in**, bukan upgrade in-place.

| Item | Sumber | Sev | Apa | Effort |
|------|--------|-----|-----|--------|
| **P1-1.** On-chain NAV checkpoint (base-asset loss-limit) | #1,#9 | Med | Slot `navCheckpointBase`; revert kalau base-asset drop > `maxDailyLossBps`. Oracle-free | M |
| **P1-2.** Real on-chain DCAP attestation | #2 | High | Integrasi Automata DCAP verifier; quote commit ke `attestedSigner` + MRENCLAVE allowlist | XL |
| **P1-3.** Perf/mgmt fee live (Opsi B) | #4 | Med | Ship `accrueFees`/`claimFees` + state HWM (hanya jika perf/mgmt revenue penting) | M-L |
| **P1-4.** Treasury→insurance top-up enforced (opsional) | #7 | Low | `routeToInsurance()` tarik bps tetap dari protocol fee | S-M |
| **P1-5.** Full NAV-relative loss-limit (DEFER) | #9 | Med | Wire `VaultNAVCalculator` + `validateDailyLoss`. **Diblokir** sampai 0G punya oracle segar | L |

### P2 — Keputusan OPS/MANUSIA (custody key — bukan untuk asisten)

| Item | Sumber | Sev | Aksi | Deploy |
|------|--------|-----|------|--------|
| **P2-1.** Governor → M-of-N | #3 | High | `migrate-governor-multisig.js` → ≥2-of-3 owner independen. 1 key = kompromi penuh governance | Ops tx (no redeploy) |
| **P2-2.** TEE signer → HSM/KMS/enclave | #5 | High | Ganti `ethers.Wallet(pk)` → remote/hardware signer; **rotasi key sekarang** | Ops/key-custody |
| **P2-3.** Kapitalisasi insurance pool | #7 | Low | Seed pool via `deposit()` | Ops tx |

### P3 — Keputusan DESAIN

- **P3-1 loss-limit on-chain?** Tidak hari ini (Pyth disabled). → (a) terima off-chain + docs jujur sekarang, (b) NAV checkpoint base-asset (P1-1), (c) full NAV defer (P1-5).
- **P3-2 quote verification?** Honest-framing dulu (P0-1, zero contract change). Real DCAP (P1-2) hanya jika jadi klaim load-bearing untuk fundraising.
- **P3-3 model fee?** Opsi A (docs+frontend only) cukup. Opsi B (P1-3) hanya jika perf/mgmt revenue penting.
- **P3-4 audit trail?** Scope whitepaper ke on-chain sekarang; re-enable 0G Storage anchoring kalau mau rootHash independen.

---

## C. Strategi Multi-chain

**Rekomendasi: JANGAN 0G-only — tapi pertahankan 0G sebagai home base.** 0G gagal di requirement #1 (likuiditas: ~$3M TVL, hanya W0G-hub, tak ada USDC↔BTC/ETH langsung). Pertahankan 0G = showcase TEE/AI-infra + narasi "verifiable AI" + sumber grant; tambah **Arbitrum One** untuk eksekusi terhadap likuiditas nyata.

Ini **bukan pivot** — core loop AI→policy→DEX sudah terbukti on-chain di 0G; menambah chain = menskalakan loop terbukti ke venue yang likuiditasnya tidak merusaknya.

### Tambah ARBITRUM ONE dulu (menang 4 sumbu, effort terendah)
- **(a) Likuiditas:** native USDC/ETH/WBTC dalam — masalah slippage 0G hilang.
- **(b) DeFAI user base:** Vibekit/Ember MCP, GMX/Aave/Pendle, Virtuals.
- **(c) Gas:** ~$0.03/swap.
- **(d) Grant:** **Trailblazer 2.0 "$1M Grants to Power Agentic DeFi"** — written-for-this. Komplementer dgn 0G (0G=verifiable-AI infra, Arbitrum=liquidity+grant).

**Engineering: M (~2-4 eng-days) — config plumbing, BUKAN smart contract.** "Two chains one bytecode" substantif benar: vault panggil venue generik (`ExecLibV4.sol:181`), EIP-712 domain dinamis dari `block.chainid`. Reuse `UniswapV3VenueAdapter.sol` (sudah ada, lebih hardened dari Jaine). AI/attestation layer chain-agnostic. Pekerjaan nyata: parameterize `deploy-v4.js`, isi `sdk/src/config.js` `ADDRESSES[42161]` (sekarang `getAddresses(42161)` throw), emit blok frontend, supply token/Pyth addr + enable oracle guard (Pyth segar di Arbitrum). Honest gap: deployment Arbitrum on-record = stack V2/V3 lama → perlu redeploy V4.

### Ranking
| Rank | Chain | Fit | Port | Alasan |
|------|-------|-----|------|--------|
| **1** | **Arbitrum One** | 9/10 | M | Menang 4 sumbu; Trailblazer 2.0; adapter+deploy lama ada |
| 2 | Base | 8/10 | M | DeFAI consumer terbesar + Virtuals; risiko konsentrasi Aerodrome |
| 3 | Hyperliquid | 7/10 | M-H | Eksekusi terbaik tapi depth di perps; butuh HyperCore order-book |
| 4 | Optimism | 6/10 | M | UniV3 reuse, tapi tak ada deploy script/profile |
| 5 | BNB | 5/10 | Low | Likuiditas oke, nol agent tailwind, gas tertinggi |
| 5 | Solana | 5/10 | High | DeFAI mindshare bagus tapi non-EVM = rewrite total. Defer |
| 6 | Ethereum L1 | 4/10 | Low | Likuiditas terdalam tapi gas mahal utk rebalance sering |

---

## D. Urutan Eksekusi

**Fase 1 — Kejujuran & quick wins (P0, off-chain, sekarang)** — [ASISTEN]
1. P0-1+P0-2+P0-7: Rewrite WHITEPAPER/Docs (attestation off-chain, loss-limit off-chain, audit trail on-chain).
2. P0-5+P0-4: Hapus dead code; koreksi NatSpec; hide tombol fee mati.
3. P0-3: Wire PnL nyata ke veto (skalakan threshold dari policy, JANGAN env override).
4. P0-6: Turunkan wording insurance; tampilkan balance live.
5. P0-8: Bind-mount data/ + VOLUME + backup.
6. P0-9: Commit address book.
7. P0-10: Guard Hardhat key; startup assert key terpisah.

**Fase 2 — Hardening ops (P2, paralel)** — [MANUSIA/OPS]
8. P2-1: `migrate-governor-multisig.js` → ≥2-of-3. **High tertinggi yang fixable tanpa redeploy.**
9. P2-2: TEE signer → HSM/enclave; rotasi key; update `attestedSigner` per sealed vault.
10. P2-3: Seed insurance (opsional).

**Fase 3 — Multi-chain Arbitrum (config, BRANCH dulu)**
11. [MANUSIA] Verifikasi canonical addr + konfirmasi likuiditas pool live.
12-15. [BRANCH] Generalize `deploy-v4.js`; isi SDK/frontend config; enable oracle guard; point orchestrator `CHAIN_ID=42161`.
16. [MANUSIA+BRANCH] E2E smoke test; apply Trailblazer 2.0.

**Fase 4 — Perubahan kontrak (P1, setelah review, JANGAN auto-deploy)**
17. P1-1 NAV checkpoint + Foundry test.
18. P1-2 DCAP (jika load-bearing).
19. P3-3 putuskan model fee.

**Prinsip:** Fase 1+2 menutup semua High fixable tanpa redeploy (#2 framing, #3 governor, #5 key) — kerjakan **sebelum** apa pun yang menyentuh bytecode. Tidak ada P1 yang aman "just fix". Multi-chain Arbitrum = config plumbing, reward tertinggi/effort terendah.

---

*Metodologi: 9 verifier ground-truth (cek tiap klaim ke kode) + 2 analis multi-chain (kode + web) → sintesis roadmap. Verdict & file:line dari pembacaan kode aktual, bukan dari laporan PMF.*
