# Aegis Vault AI Agent — Decision Flow

Dokumen ini menjelaskan secara detail bagaimana AI agent di Aegis Vault memutuskan untuk melakukan **BUY**, **SELL**, atau **HOLD** pada setiap cycle.

---

## Overview

Aegis Vault menggunakan AI inference dari **0G Compute Network** (model `GLM-5-FP8` di mainnet) untuk menganalisis kondisi pasar dan menghasilkan keputusan trading terstruktur. Keputusan AI kemudian divalidasi oleh **12 policy rules on-chain** sebelum swap dieksekusi.

```
Setiap 2 menit:

  [Market Data]  →  [AI Inference]  →  [Policy Check]  →  [Execute/Block]
   CoinGecko        0G Compute         Off-chain +         On-chain TX
   Pyth Hermes      GLM-5-FP8          On-chain rules      via MockDEX
```

**Prinsip utama:** AI hanya **mengusulkan** — smart contract yang **memutuskan** apakah proposal valid.

---

## Step 1: Pengumpulan Data Market

Setiap cycle, orchestrator mengumpulkan data dari dua sumber:

### CoinGecko API
- Harga real-time BTC, ETH, USDC dalam USD
- Perubahan harga 24 jam (%)
- Volume 24 jam
- Market cap

### Pyth Hermes Oracle
- Harga real-time dengan confidence interval
- Update setiap 15 detik

### Volatility Calculation
- Mengambil harga 7 hari terakhir dari CoinGecko
- Menghitung **annualized volatility** menggunakan standar deviasi return harian
- Digunakan sebagai indikator risiko pasar

**Contoh data yang dikumpulkan:**
```
BTC:
  Price: $68,376
  24h Change: +2.00%
  24h Volume: $28.5B
  7d Volatility: 42.15% (annualized)

ETH:
  Price: $2,125
  24h Change: +3.00%
  24h Volume: $12.1B
  7d Volatility: 55.30% (annualized)
```

---

## Step 2: Pembacaan Vault State (On-chain)

Orchestrator membaca state vault langsung dari smart contract:

| Data | Sumber | Contoh |
|------|--------|--------|
| NAV (Net Asset Value) | `vault.getVaultSummary()` | $30,000 |
| Policy | `vault.getPolicy()` | Max position 50%, confidence threshold 60% |
| Allowed Assets | `vault.getAllowedAssets()` | USDC, WBTC, WETH |
| Daily Actions Used | `vault.getVaultSummary()` | 2 / 20 |
| Last Execution Time | `vault.getVaultSummary()` | 2 jam lalu |
| Paused | `vault.getVaultSummary()` | false |
| Auto-execution | `vault.getPolicy()` | true |
| Mandate | Derived dari maxPositionBps | Balanced |

---

## Step 3: Prompt Construction

Orchestrator membangun prompt yang dikirim ke AI model.

### System Prompt (identitas + aturan)

```
You are Aegis Vault AI — a disciplined, risk-aware autonomous trading agent.

RULES:
- Capital preservation is the top priority.
- Never recommend a trade if conditions are ambiguous or volatile.
- If in doubt, recommend "hold" with low confidence.
- Output MUST be valid JSON only.

CONSTRAINTS:
- size_bps must not exceed 2000 (20%)
- If risk_score > 0.7, you SHOULD recommend "hold"
- If confidence < 0.5, you SHOULD recommend "hold"
- Never trade more than one asset at a time
```

### User Prompt (data real-time)

```
=== CURRENT MARKET DATA ===
BTC:
  Price: $68,376
  24h Change: +2.00%
  24h Volume: $28.50B
ETH:
  Price: $2,125.91
  24h Change: +3.00%
  24h Volume: $12.10B

=== VOLATILITY (7d annualized) ===
BTC: 42.15%
ETH: 55.30%

=== VAULT STATE ===
NAV: $30,000
Mandate: Balanced
Max Position: 50%
Max Drawdown: 5%
Confidence Threshold: 60%
Daily Actions Used: 2/20
Last Execution: 2 hours ago

Based on the above data, what is your recommended action?
```

---

## Step 4: AI Reasoning & Decision

### Menggunakan 0G Compute (GLM-5-FP8)

Model melakukan **reasoning chain** internal sebelum memberikan jawaban:

```
[REASONING — internal, not exposed to user]
Market Analysis:
- BTC: $69,000, up 2.8% in 24h — showing strong bullish momentum
- ETH: $2,140, up 1.5% in 24h — moderate bullish momentum

Vault Status:
- $30,000 USDC (all in stablecoins)
- No current positions in BTC or ETH

Policy Constraints:
- Max position: 50% of vault = $15,000 max per asset
- Confidence threshold: 60% minimum to execute trade

Analysis:
1. BTC is showing stronger momentum (+2.8%) compared to ETH (+1.5%)
2. Vault is 100% in USDC — has full capacity to take a position
3. Position at 40% = $12,000, stays within 50% max limit
4. Confidence: market is clearly bullish but not extreme → 72%
5. Risk: low since entry is with-trend and position is moderate → 4%
```

### Output JSON

```json
{
  "action": "buy",
  "asset": "BTC",
  "size_bps": 4000,
  "confidence": 0.72,
  "risk_score": 0.04,
  "reason": "BTC showing strong bullish momentum (+2.8% 24h), vault fully in USDC with no exposure. Position sizing at 40% stays within 50% max policy limit."
}
```

### Field Definitions

| Field | Type | Range | Meaning |
|-------|------|-------|---------|
| `action` | string | `buy`, `sell`, `hold` | Apa yang harus dilakukan |
| `asset` | string | `BTC`, `ETH`, `USDC` | Asset yang di-trade |
| `size_bps` | number | 0 - 5000 | Ukuran posisi dalam basis points (100 = 1% dari vault NAV) |
| `confidence` | number | 0.0 - 1.0 | Seberapa yakin AI (0 = tidak yakin, 1 = sangat yakin) |
| `risk_score` | number | 0.0 - 1.0 | Tingkat risiko pasar (0 = sangat aman, 1 = sangat berisiko) |
| `reason` | string | - | Penjelasan satu kalimat dari keputusan |

---

## Step 5: Kapan AI Memutuskan Buy / Sell / Hold

### BUY — Kondisi yang memicu:

| Trigger | Contoh | Confidence |
|---------|--------|-----------|
| BTC momentum kuat ke atas (+2.5%+ 24h) | BTC $69k (+2.8%) | ~72% |
| ETH momentum kuat ke atas (+3%+ 24h) | ETH $2.2k (+3.3%) | ~66% |
| Vault belum punya exposure (100% USDC) | NAV $30k all stablecoin | Lebih tinggi |
| Volatility rendah-sedang (<60%) | BTC vol 42% | Lebih tinggi |

### SELL — Kondisi yang memicu:

| Trigger | Contoh | Confidence |
|---------|--------|-----------|
| BTC turun tajam (-3%+ 24h) | BTC $66k (-3.2%) | ~68% |
| ETH turun tajam (-3.5%+ 24h) | ETH $2k (-4%) | ~65% |
| Vault punya exposure besar ke asset yang turun | 40% di BTC, BTC -3% | Lebih tinggi |
| Drawdown mendekati limit | Loss 4% dari 5% max | Lebih tinggi |

### HOLD — Kondisi yang memicu:

| Trigger | Contoh | Confidence |
|---------|--------|-----------|
| Market sideways / no clear signal | BTC +0.5%, ETH -0.3% | ~45% |
| Volatility terlalu tinggi (>80%) | BTC vol 92% | ~55% |
| Confidence < 50% | Sinyal ambigu | ~35% |
| Risk score > 70% | Market crash banyak indikator negatif | ~40% |
| Daily action limit tercapai | 20/20 actions hari ini | ~25% |
| Vault paused | Owner pause vault | N/A |

---

## Step 6: Policy Check (Double Layer)

Keputusan AI harus melewati **dua layer** validasi:

### Layer 1: Off-chain Pre-check (10 rules — hemat gas)

```
✅ Auto-execution enabled?
✅ Vault not paused?
✅ Confidence >= threshold? (misal 72% >= 60%)
✅ Position size <= max? (misal 40% <= 50%)
✅ Daily actions < limit? (misal 2 < 20)
✅ Cooldown elapsed? (misal 2 jam > 60 detik)
✅ Asset whitelisted? (BTC dalam allowed assets)
✅ Daily loss within limit?
✅ Risk score acceptable?
✅ Auto-execution flag on?
```

Jika SATU SAJA gagal → intent **tidak dikirim** ke blockchain (hemat gas).

### Layer 2: On-chain Enforcement (12 rules — immutable)

```
✅ autoExecution == true
✅ intent.vault == address(this) (anti cross-vault attack)
✅ intentHash recomputed dan cocok (anti tampering)
✅ Global stop-loss not triggered
✅ PolicyLibrary.validateAll():
   - Position size
   - Daily loss
   - Cooldown
   - Asset whitelist
   - Confidence threshold
   - Intent expiry
   - Pause state
   - Action count
✅ Intent registered di ExecutionRegistry (anti replay)
```

---

## Contoh Lengkap: Cycle #573 (Data Real)

### Input

```
Timestamp: 2026-04-01T14:07:01Z

Market:
  BTC: $68,215 (+1.65% 24h)
  ETH: $2,120.57 (+2.54% 24h)
  USDC: $1.00

Vault (0xFFac...DAB2):
  NAV: $6,688
  Paused: false
  Auto-execution: true
  Daily Actions: 20/20
```

### AI Decision (0G Compute — GLM-5-FP8)

```json
{
  "action": "hold",
  "asset": "USDC",
  "size_bps": 0,
  "confidence": 0.25,
  "risk_score": 0.55,
  "reason": "Daily action limit reached (20/20), volatility data unavailable, and market shows no strong directional signals.",
  "source": "0g-compute"
}
```

**Mengapa HOLD:**
1. Daily action limit 20/20 sudah tercapai — AI tahu tidak bisa trading lagi hari ini
2. Volatility data unavailable (CoinGecko rate limited)
3. Market movement tidak cukup kuat untuk sinyal jelas
4. Confidence hanya 25% — jauh di bawah threshold 60%

### Hasil: Skipped (tidak ada transaksi on-chain)

---

## Contoh Lengkap: Cycle BUY ETH (Data Real)

### Input

```
Timestamp: 2026-04-01T13:40:06Z

Market:
  BTC: $68,376 (+2.00% 24h)
  ETH: $2,125.91 (+3.00% 24h)
  USDC: $1.00

Vault (0xFFac...DAB2):
  NAV: ~$30,000
  Daily Actions: <20
```

### AI Decision (local-fallback)

```json
{
  "action": "buy",
  "asset": "ETH",
  "size_bps": 600,
  "confidence": 0.66,
  "risk_score": 0.38,
  "reason": "ETH momentum continuation (+3.0% 24h). Risk-adjusted entry within mandate.",
  "source": "local-fallback"
}
```

**Mengapa BUY ETH:**
1. ETH naik +3.0% dalam 24 jam — memenuhi threshold momentum (+3%+)
2. BTC juga naik (+2.0%) tapi belum memenuhi threshold buy BTC (+2.5%+)
3. Risk score 38% — moderate, di bawah 70% threshold
4. Confidence 66% — di atas policy threshold 60%
5. Size 600 bps (6%) — conservative, jauh di bawah max 50%

### Policy Check

```
Off-chain:
  ✅ Confidence 66% >= 60% threshold
  ✅ Position 6% <= 50% max
  ✅ Daily actions < 20
  ✅ Cooldown elapsed
  ✅ ETH whitelisted
  → PASSED — submit intent to chain
```

### On-chain Execution

```
vault.executeIntent(intent):
  ✅ autoExecution = true
  ✅ intent.vault matches
  ✅ intentHash verified
  ✅ Stop-loss not triggered
  ✅ PolicyLibrary.validateAll() passed
  → registerIntent in Registry
  → forceApprove(venue, amountIn)
  → MockDEX.swap(USDC, WETH, amount)
  → forceApprove(venue, 0)
  → verify balanceOf delta
  → finalizeIntent in Registry
  → emit IntentExecuted
```

**Hasil:** TX `0x6611cca6...` confirmed on Galileo testnet. USDC diswap ke WETH.

---

## Contoh Lengkap: BLOCKED oleh Policy

### AI Decision

```json
{
  "action": "buy",
  "asset": "ETH",
  "size_bps": 600,
  "confidence": 0.66,
  "risk_score": 0.38,
  "reason": "ETH momentum continuation (+3.3% 24h)."
}
```

### Policy Check — BLOCKED

```
Off-chain:
  ✅ Confidence 66% >= 60%
  ✅ Position 6% <= 50%
  ❌ Daily action limit reached (20/20)
  → BLOCKED — intent NOT submitted to chain
```

**Log:**
```json
{
  "type": "policy_check",
  "action": "buy",
  "asset": "ETH",
  "valid": false,
  "reason": "Daily action limit reached (20/20)"
}
```

**Hasil:** Tidak ada transaksi on-chain. Gas disimpan. AI diinformasikan bahwa action diblokir.

---

## Statistik Real (dari Orchestrator)

Data dari orchestrator yang sedang berjalan:

```
Total Cycles:        574
Total Decisions:     574

Buy Decisions:       127 (BTC + ETH)
Sell Decisions:      0 (market belum turun tajam)
Hold Decisions:      447

Executed on-chain:   18
Blocked by policy:   109 (mostly "daily limit 20/20")
Skipped (hold):      447

Source 0G Compute:   1 (baru aktif)
Source local-fallback: 573

Block Reasons:
  109x: "Daily action limit reached (20/20)"
```

---

## Ringkasan

| Aspek | Detail |
|-------|--------|
| **Siapa yang memutuskan?** | AI (GLM-5-FP8 via 0G Compute) mengusulkan, Smart Contract memutuskan |
| **Data input** | Harga real-time (CoinGecko + Pyth), volatility 7d, vault state on-chain |
| **Output** | JSON: action, asset, size, confidence, risk_score, reason |
| **Kapan BUY?** | Momentum kuat (+2.5%+ BTC, +3%+ ETH), volatility rendah, confidence tinggi |
| **Kapan SELL?** | Penurunan tajam (-3%+ BTC, -3.5%+ ETH), exposure perlu dikurangi |
| **Kapan HOLD?** | Pasar netral, volatility tinggi, confidence rendah, limit tercapai |
| **Safety** | 12 on-chain policy rules, replay prevention, executor authorization |
| **Transparency** | Setiap keputusan dicatat di journal + 0G Storage (immutable) |
