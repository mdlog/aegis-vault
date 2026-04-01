# Aegis Vault — Arsitektur Produk Lengkap di 0G Chain

## 1. Ringkasan

**Aegis Vault** adalah **AI-managed risk-controlled trading vault** yang dibangun di atas stack 0G.

Fungsi utamanya bukan menjadi DEX baru, tetapi menjadi **lapisan kendali risiko, kebijakan eksekusi, dan memori/audit** untuk trading otomatis.

Dalam versi MVP yang paling realistis untuk hackathon:

- **0G Chain** dipakai untuk smart contract vault, policy, custody, dan audit event.
- **0G Compute** dipakai untuk inference agent AI yang memberi keputusan trading.
- **0G Storage** dipakai untuk menyimpan state, jurnal keputusan, reasoning summary, dan memori strategi.
- **DEX venue** untuk eksekusi spot/swap adalah **Jaine / 0G Hub route** sebagai target paling realistis untuk MVP.

Posisi produk:

> **Aegis Vault = verifiable AI risk manager with autonomous execution guardrails**

---

## 2. Masalah yang Diselesaikan

Di DeFi dan on-chain trading, user menghadapi beberapa masalah utama:

1. **Bot trading biasa sulit dipercaya** karena logic-nya off-chain dan tidak ada guardrail yang benar-benar mengikat.
2. **Strategi mudah bocor** bila semua sinyal dan parameter tersimpan di backend biasa.
3. **Manual trading tidak disiplin** dan sering melanggar risk management.
4. **Autonomous agent tanpa constraint terlalu berbahaya** untuk user retail maupun treasury kecil.
5. **Riwayat keputusan AI sulit diaudit** jika hanya disimpan di server privat.

Aegis Vault menyelesaikan itu dengan cara:

- keputusan AI dihasilkan secara terstruktur,
- policy dan batas risiko dikunci di contract,
- eksekusi hanya boleh lewat executor yang diotorisasi,
- hasil aksi dan reasoning dicatat ke 0G Storage,
- user bisa mem-pause sistem kapan saja.

---

## 3. Kenapa Produk Ini Cocok untuk Track 2

Track 2 berfokus pada:

- intelligent yield optimizers,
- risk management bots,
- AI-driven strategy agents,
- privacy-preserving execution,
- mitigation terhadap front-running.

Aegis Vault cocok karena:

- ia adalah **risk-management agent**,
- ia memakai **AI inference** untuk keputusan,
- ia punya **verifiable on-chain policy layer**,
- ia bisa menambahkan **sealed / private strategy mode** di iterasi lanjut,
- ia mudah didemokan secara live.

---

## 4. Bentuk Produk yang Direkomendasikan

### MVP final yang paling realistis

**Aegis Vault v1 = spot autonomous risk-managed vault di 0G, eksekusi swap ke Jaine / 0G Hub stack**

Kenapa bukan perps dulu?

- lebih mudah selesai,
- lebih jelas venue-nya,
- lebih mudah didemokan end-to-end,
- lebih natural untuk integrasi 0G,
- lebih kecil risiko integration failure.

### Roadmap v2

- multi-asset vault,
- multi-strategy vault,
- cross-chain venue adapter,
- perps adapter,
- sealed inference mode,
- social vault / copy-vault.

---

## 5. Prinsip Desain Sistem

Aegis Vault harus dibangun dengan prinsip berikut:

### a. AI tidak pernah memegang kuasa absolut
AI hanya mengusulkan aksi. Contract tetap menjadi penjaga terakhir.

### b. Semua aksi harus melewati policy engine
Tidak boleh ada eksekusi di luar rule user.

### c. Eksekusi dipisah dari reasoning
Compute menghasilkan keputusan, executor mengurus trade, contract memverifikasi policy.

### d. State penting harus dapat dipulihkan
Riwayat policy, snapshot risk, dan journal harus tersimpan.

### e. MVP harus demoable
Alur minimal harus benar-benar hidup: deposit -> inference -> policy check -> swap -> update state.

---

## 6. Arsitektur Tingkat Tinggi

```text
User
  ↓
Frontend Dashboard
  ↓
Vault Contract (0G Chain)
  ├─ Deposit / Withdraw
  ├─ Policy Storage
  ├─ Risk Guardrails
  ├─ Executor Authorization
  └─ Event Emission
        ↓
Strategy Orchestrator Backend
  ├─ Market Data Collector
  ├─ Prompt Builder
  ├─ Inference Caller
  ├─ Policy Pre-check
  └─ Execution Dispatcher
        ↓
0G Compute
  ├─ Market interpretation
  ├─ Decision generation
  └─ Optional private/sealed mode
        ↓
Executor / Venue Adapter
        ↓
Jaine / 0G Hub swap route
        ↓
Execution result
        ↓
0G Storage
  ├─ KV state
  └─ Logs / journal / reports
```

---

## 7. Komponen Utama

## 7.1 Frontend Dashboard

Fungsi frontend:

- buat vault,
- deposit / withdraw,
- atur policy,
- lihat risk meter,
- lihat posisi dan NAV,
- lihat history action,
- emergency pause,
- lihat status executor,
- lihat ringkasan alasan AI.

### Halaman yang disarankan

1. **Landing / product overview**
2. **Create Vault**
3. **Vault Dashboard**
4. **Risk Policy Settings**
5. **Execution History**
6. **Storage-backed Journal**
7. **Admin / Executor Monitor**

---

## 7.2 Vault Contract (0G Chain)

Ini komponen inti on-chain.

### Tanggung jawab utama

- menerima deposit user,
- memproses withdraw,
- menyimpan risk policy,
- menyimpan daftar aset/venue yang boleh dipakai,
- mengotorisasi executor,
- mencatat trade request / trade result,
- mengaktifkan pause mode,
- menolak aksi yang melanggar batas.

### Data yang disimpan

- owner vault,
- base asset,
- executor address,
- allowed assets,
- max position size,
- daily loss limit,
- leverage cap,
- global stop-loss,
- cooldown,
- active / paused status,
- cumulative pnl snapshot,
- last execution timestamp.

---

## 7.3 Strategy Orchestrator Backend

Ini lapisan off-chain yang menghubungkan semua komponen.

### Tanggung jawab

- mengambil market data,
- membangun input inference,
- memanggil 0G Compute,
- memvalidasi hasil awal,
- menyusun execution intent,
- mengirim aksi ke executor,
- menulis hasil ke 0G Storage,
- mengupdate UI/API.

### Kenapa backend ini diperlukan

Karena contract tidak bisa langsung menarik market data atau menjalankan prompt AI.

---

## 7.4 0G Compute Layer

Fungsi utamanya:

- menerima market summary,
- menghasilkan keputusan trading terstruktur,
- mengembalikan confidence score,
- memberi reason summary,
- optional: berjalan di mode privat / TEE.

### Bentuk output yang direkomendasikan

```json
{
  "action": "buy",
  "asset": "BTC",
  "size_bps": 1200,
  "confidence": 0.82,
  "risk_score": 0.28,
  "reason": "momentum continuation with acceptable volatility",
  "ttl_sec": 180
}
```

### Kenapa output harus JSON

- mudah divalidasi,
- mudah dipetakan ke policy,
- mudah ditampilkan di UI,
- mudah disimpan ke 0G Storage.

---

## 7.5 Executor / Venue Adapter

Ini lapisan yang benar-benar mengeksekusi trade.

### Jawaban paling praktis: trade dieksekusi lewat mana?

Untuk **MVP Aegis Vault**, trade dieksekusi melalui:

- **Jaine / 0G Hub swap stack** untuk spot/swap execution di ekosistem 0G.

Jadi Aegis Vault **tidak membuat pasar sendiri**. Ia hanya mengarahkan dana vault untuk melakukan swap secara disiplin.

### Tugas executor

- menerima intent yang sudah lolos policy,
- memanggil venue adapter,
- mengeksekusi swap,
- mengambil hasil output,
- mengirim bukti hasil ke backend / contract,
- mencatat tx hash dan result metadata.

### Model executor yang direkomendasikan

**Whitelisted executor** yang hanya boleh:

- execute jika vault aktif,
- execute jika intent belum expired,
- execute jika policy match,
- execute satu kali per intent,
- tidak mengubah parameter dari intent.

---

## 7.6 0G Storage Layer

0G Storage dipakai untuk dua kategori data:

### Mutable state (KV)

- current equity snapshot,
- last known allocation,
- active policy cache,
- current risk state,
- last signal,
- last execution summary.

### Immutable / append-only logs

- trade journal,
- decision log,
- strategy reports,
- inference output archive,
- executor reports,
- demo screenshots / generated reports.

### Kenapa penting

Tanpa storage yang rapi, juri hanya melihat bot AI biasa. Dengan storage yang tepat, Aegis Vault terlihat sebagai **autonomous system dengan memory dan audit trail**.

---

## 8. Cara Kerja Aegis Vault Secara Real

## Step 1 — User membuat vault
User connect wallet, lalu menekan **Create Vault**.

Input minimum:

- base asset: misalnya USDC,
- allowed assets: BTC, ETH,
- risk profile: Conservative / Balanced / Aggressive,
- max position size,
- max daily drawdown,
- cooldown,
- auto-execution ON/OFF.

Contract lalu membuat vault baru.

---

## Step 2 — User deposit dana
User mendepositkan aset ke vault contract.

Dalam MVP, paling aman jika:

- hanya satu base asset,
- deposit sederhana,
- withdraw hanya boleh jika tidak ada pending execution.

---

## Step 3 — Orchestrator membaca market data
Backend mengambil market data yang dibutuhkan, misalnya:

- harga spot,
- volatilitas jangka pendek,
- moving average,
- volume,
- spread,
- momentum sederhana.

Untuk hackathon, jangan terlalu rumit. Lebih baik indikator sedikit tapi stabil.

---

## Step 4 — Data dikirim ke 0G Compute
Backend menyusun prompt / input terstruktur, lalu mengirim request inference.

Tujuan inference:

- menentukan aksi,
- menentukan ukuran posisi,
- menentukan confidence,
- menentukan ringkasan alasan.

Output harus selalu terstruktur.

---

## Step 5 — Policy engine melakukan validasi
Sebelum eksekusi, hasil AI diperiksa.

### Validasi minimum

- asset masih dalam whitelist,
- size tidak melewati max limit,
- cooldown sudah lewat,
- vault tidak dalam pause mode,
- intent belum expired,
- drawdown belum melewati threshold.

Jika salah satu gagal, intent ditolak.

---

## Step 6 — Executor melakukan swap
Setelah valid, executor mengirim transaksi ke venue.

Untuk MVP:

- swap dilakukan ke route yang ditentukan,
- executor menyimpan tx hash,
- hasil nominal output dibaca,
- status execution dikembalikan ke sistem.

---

## Step 7 — Result disimpan
Setelah swap berhasil:

- contract emit event,
- backend update snapshot state,
- reasoning + result ditulis ke 0G Storage,
- UI menampilkan history baru.

---

## Step 8 — User memonitor dan bisa pause
User selalu bisa:

- melihat posisi,
- melihat reason summary,
- pause vault,
- ganti policy,
- withdraw dana.

---

## 9. Struktur Kontrak yang Disarankan

Agar modular, kontrak sebaiknya dipisah.

## 9.1 AegisVaultFactory.sol

Fungsi:

- create vault,
- simpan mapping owner -> vault list,
- emit event vault created.

## 9.2 AegisVault.sol

Fungsi:

- deposit,
- requestWithdraw,
- executeIntent,
- updatePolicy,
- pause,
- unpause,
- setExecutor,
- recordExecution,
- emergencyWithdraw.

## 9.3 PolicyLibrary.sol

Berisi:

- validasi max position,
- validasi cooldown,
- validasi asset whitelist,
- validasi loss limit,
- helper risk checks.

## 9.4 ExecutionRegistry.sol

Fungsi:

- menyimpan intent hash yang sudah dieksekusi,
- mencegah replay,
- menyimpan execution status.

## 9.5 VaultEvents.sol

Opsional, jika ingin rapi untuk event struct dan reuse.

---

## 10. Data Model yang Direkomendasikan

### VaultPolicy

```solidity
struct VaultPolicy {
    uint256 maxPositionBps;
    uint256 maxDailyLossBps;
    uint256 stopLossBps;
    uint256 cooldownSeconds;
    bool autoExecution;
    bool paused;
}
```

### ExecutionIntent

```solidity
struct ExecutionIntent {
    bytes32 intentHash;
    address vault;
    address assetIn;
    address assetOut;
    uint256 amountIn;
    uint256 minAmountOut;
    uint256 createdAt;
    uint256 expiresAt;
    uint256 confidenceBps;
    uint256 riskScoreBps;
}
```

### ExecutionResult

```solidity
struct ExecutionResult {
    bytes32 intentHash;
    bytes32 venueTxRef;
    uint256 amountIn;
    uint256 amountOut;
    uint256 executedAt;
    bool success;
}
```

---

## 11. User Flow

## 11.1 Create Vault Flow

1. User connect wallet.
2. User pilih base asset.
3. User set risk profile.
4. User approve deposit.
5. User create vault.
6. Frontend redirect ke dashboard.

## 11.2 Auto Execution Flow

1. Market data refresh.
2. Inference request dibuat.
3. 0G Compute mengembalikan output.
4. Policy check lolos.
5. Intent dibentuk.
6. Executor kirim swap.
7. Result di-record.
8. UI refresh.

## 11.3 Emergency Pause Flow

1. User klik pause.
2. Contract set paused = true.
3. Executor otomatis berhenti.
4. Semua intent baru ditolak.
5. User dapat memilih withdraw atau reconfigure.

---

## 12. Risk Engine Logic

Aegis Vault harus fokus pada **risk-first automation**, bukan all-in alpha hunting.

### Rule sederhana yang cocok untuk MVP

- maksimum 20% dana per aksi,
- maksimum 2 aksi dalam window tertentu,
- cooldown 5–15 menit,
- no trade jika volatility terlalu tinggi,
- no trade jika confidence di bawah threshold,
- no trade jika slippage estimate terlalu besar,
- no trade jika vault baru saja loss berturut-turut.

### Rule berbasis score

Anda juga bisa pakai model sederhana:

`final_trade_allowed = confidence_ok && volatility_ok && drawdown_ok && cooldown_ok && policy_ok`

Ini mudah dijelaskan saat demo.

---

## 13. Kenapa Eksekusi Lewat Jaine / 0G Hub Cocok untuk MVP

Alasan teknis dan produk:

1. **Lebih natural untuk ekosistem 0G**
2. **Lebih mudah diverifikasi secara on-chain**
3. **Lebih sederhana untuk demo end-to-end**
4. **Tidak perlu membangun matching engine sendiri**
5. **Mengurangi risiko gagal integrasi**

Dengan pendekatan ini, Aegis Vault tetap memenuhi karakter agentic trading karena yang dijual adalah:

- agent memilih aksi,
- policy mengunci perilaku,
- executor menjalankan swap,
- user bisa audit semuanya.

---

## 14. Mode Privasi / Sealed Strategy (Roadmap atau Bonus)

Setelah MVP stabil, fitur kuat berikutnya adalah **sealed strategy mode**.

### Tujuannya

- parameter strategi tidak bocor,
- prompt tidak terlihat terbuka,
- reasoning sensitif diproses secara privat,
- user/protocol bisa memakai proprietary logic.

### Bentuk implementasi bertahap

#### Tahap 1
- inference biasa,
- reasoning summary publik terbatas.

#### Tahap 2
- provider TEE-verified,
- sealed inputs,
- signed inference metadata.

#### Tahap 3
- encrypted strategy blobs di 0G Storage,
- policy-aware sealed execution.

---

## 15. Security Considerations

Ini bagian penting untuk submission.

### Risiko utama

#### a. Executor menyalahgunakan hak
Mitigasi:
- whitelist executor,
- single-use intent hash,
- expiry,
- on-chain policy check,
- pause mechanism.

#### b. AI memberikan keputusan buruk
Mitigasi:
- AI hanya mengusulkan,
- contract enforce hard limits,
- size dibatasi,
- cooldown wajib,
- confidence threshold.

#### c. Replay attack pada execution intent
Mitigasi:
- simpan intent hash,
- reject duplicate.

#### d. Withdraw saat state belum sinkron
Mitigasi:
- pending execution lock,
- last execution finality check.

#### e. Slippage terlalu besar
Mitigasi:
- min amount out,
- slippage cap per policy,
- pre-trade estimation.

#### f. Market data rusak / stale
Mitigasi:
- timestamp check,
- dual-source sanity check,
- no-trade on stale data.

---

## 16. Scope MVP yang Paling Aman untuk Solo Builder

Agar benar-benar selesai, scope harus dibatasi.

### Fitur yang WAJIB ada

- create vault,
- deposit,
- update policy,
- pause/unpause,
- inference call ke 0G Compute,
- satu route eksekusi spot,
- event log on-chain,
- journal ke 0G Storage,
- dashboard status vault.

### Fitur yang TIDAK wajib untuk MVP

- multi-user pooled vault,
- multi-venue routing,
- advanced portfolio optimization,
- leverage/perps,
- copy trading,
- DAO governance,
- tokenomics.

---

## 17. Demo Flow yang Kuat untuk Juri

Berikut alur demo yang paling efektif:

### Demo Scene 1 — Create and Fund Vault
- connect wallet,
- buat vault,
- set risk policy,
- deposit dana.

### Demo Scene 2 — AI Decision
- tampilkan market signal,
- panggil 0G Compute,
- tampilkan output terstruktur,
- tunjukkan confidence dan reason summary.

### Demo Scene 3 — Policy Enforcement
- tampilkan bahwa size terlalu besar akan ditolak,
- lalu tunjukkan intent yang valid lolos.

### Demo Scene 4 — Swap Execution
- executor kirim swap,
- tampilkan tx hash,
- tampilkan state berubah.

### Demo Scene 5 — Audit Trail
- buka event history,
- buka reasoning journal dari 0G Storage,
- tunjukkan bahwa aksi bisa ditelusuri.

### Demo Scene 6 — Emergency Pause
- klik pause,
- tunjukkan bahwa intent baru gagal.

Ini membuat juri melihat 4 hal sekaligus:

- AI-nya nyata,
- contract-nya nyata,
- storage-nya nyata,
- UX-nya jelas.

---

## 18. Tech Stack yang Disarankan

### Smart Contract
- Solidity
- Hardhat atau Foundry
- OpenZeppelin base contracts

### Frontend
- Next.js
- TypeScript
- Tailwind CSS
- wagmi / viem

### Backend / Orchestrator
- Node.js / TypeScript
- cron / queue sederhana
- inference caller service
- execution service
- storage writer service

### Indexing / Data
- subgraph atau event listener
- PostgreSQL lokal opsional untuk cache UI

### 0G Integrations
- 0G Chain RPC
- 0G Compute inference API
- 0G Storage SDK

---

## 19. Struktur Repo yang Direkomendasikan

```text
AegisVault/
├─ apps/
│  ├─ web/
│  └─ orchestrator/
├─ contracts/
│  ├─ src/
│  │  ├─ AegisVault.sol
│  │  ├─ AegisVaultFactory.sol
│  │  ├─ ExecutionRegistry.sol
│  │  └─ libraries/
│  └─ test/
├─ packages/
│  ├─ sdk/
│  ├─ ui/
│  └─ shared-types/
├─ docs/
│  ├─ architecture.md
│  ├─ demo-flow.md
│  └─ deployment.md
└─ README.md
```

---

## 20. Roadmap Build 7 Hari

## Hari 1
- setup repo,
- deploy kontrak basic,
- create vault + deposit.

## Hari 2
- tambah policy storage,
- pause/unpause,
- executor whitelist.

## Hari 3
- integrasi 0G Compute,
- standardize JSON output.

## Hari 4
- bangun orchestrator,
- market input,
- intent builder.

## Hari 5
- eksekusi swap adapter,
- record result,
- event tracking.

## Hari 6
- integrasi 0G Storage,
- journal page,
- risk dashboard.

## Hari 7
- polish UI,
- demo script,
- README,
- contract address dan explorer links.

---

## 21. Kenapa Aegis Vault Kuat di Mata Juri

Aegis Vault mencentang semua area penilaian:

### 0G Technical Integration Depth & Innovation
- memakai 0G Chain,
- memakai 0G Compute,
- memakai 0G Storage,
- bisa ditambah mode privat.

### Technical Implementation & Completeness
- ada kontrak nyata,
- ada deployable MVP,
- ada end-to-end flow,
- ada on-chain verification.

### Product Value & Market Potential
- menyelesaikan masalah risk management,
- bisa berkembang ke treasury automation,
- cocok untuk retail power users dan small funds.

### User Experience & Demo Quality
- alurnya mudah dijelaskan,
- hasilnya visual,
- live demo bisa kuat.

### Team Capability & Documentation
- dokumentasi bisa sangat rapi,
- architecture story jelas,
- open-source friendly.

---

## 22. Kesimpulan

Versi paling realistis dari Aegis Vault adalah:

> **AI-managed spot trading vault di 0G yang mengeksekusi swap secara otomatis melalui venue di ekosistem 0G, dengan risk policy on-chain dan audit/memory di 0G Storage.**

Ini adalah sweet spot terbaik antara:

- kelayakan untuk solo builder,
- kedalaman integrasi 0G,
- kekuatan demo day,
- dan peluang benar-benar selesai.

Jika ingin menang, Aegis Vault jangan dijual sebagai “bot trading biasa”.

Narasi yang lebih tepat adalah:

> **Aegis Vault is a verifiable AI risk manager for on-chain execution.**

---

## 23. Next Documents yang Paling Berguna

Setelah dokumen ini, tiga file lanjutan yang paling berguna adalah:

1. `smart-contract-architecture.md`
2. `README_hackathon_submission.md`
3. `7_day_build_plan.md`

---

## 24. One-Line Pitch

**Aegis Vault enables users to deposit into a policy-constrained AI vault that autonomously executes on-chain swaps while keeping every action auditable, risk-limited, and storage-backed by the 0G stack.**
