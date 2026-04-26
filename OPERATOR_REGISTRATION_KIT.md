# Operator Registration Kit — Copy-paste source

> Source material untuk mengisi form `/operator/register` di Aegis Vault (0G Aristotle Mainnet V2). Section di bawah disusun sesuai urutan field di form. Copy-paste value yang sesuai, adjust bagian yang spesifik untukmu (nama, endpoint, alamat).

---

## Pre-requisites sebelum buka form

- [ ] Wallet operator connected ke **0G Aristotle Mainnet (chain 16661)** di MetaMask
- [ ] Wallet punya ≥ **0.05 0G** untuk gas register + optional declareAI + publishManifest (3 tx)
- [ ] Orchestrator sudah running dengan `PRIVATE_KEY` = executor wallet yang akan dipakai (bukan operator wallet)
- [ ] Orchestrator endpoint accessible publicly (kalau production) atau `http://localhost:4002` (kalau demo lokal)

---

## Step 1 — Form field values (siap copy)

### Name (max 64 chars)

```
Aegis Alpha
```

**Tip**: pendek, distinct, bisa dicari. Hindari spasi berlebih.

---

### Description (max ~200 chars)

```
Balanced-mandate AI operator. GLM-5-FP8 inference on 0G Compute, TEE-attested signatures bound to EIP-712 intents, commit-reveal sealed mode, real Jaine V3 execution on 0G mainnet. Trades USDC.e / WETH / WBTC / W0G pools.
```

**Alternate — Conservative mandate:**
```
Conservative-mandate AI operator. Low-turnover, high-conviction trades only (≥70% AI confidence). GLM-5-FP8 on 0G Compute with TEE attestation. Real Jaine V3 execution. Single-asset exposure capped at 30%.
```

**Alternate — Tactical mandate:**
```
Tactical-mandate AI operator for shorter-horizon regime plays. GLM-5-FP8 inference, sealed commit-reveal anti-MEV. Real Jaine V3 on 0G. Higher turnover, tighter stop-loss. Single-asset cap 50%.
```

---

### Endpoint (orchestrator public URL)

Production (kalau orchestrator di-host di server publik):
```
https://ops.aegisvaults.xyz
```

Demo lokal (hanya untuk testing, tidak bisa diakses orang lain):
```
http://localhost:4002
```

**Catatan**: endpoint harus merespons `GET /api/health` → `200 OK` agar orchestrator terdeteksi online. Ini public-facing — siapapun bisa query.

---

### Mandate (enum — pilih salah satu)

| Mandate | Enum value | Profile |
|---|---|---|
| **Conservative** | `0` | Low turnover, ≥70% confidence threshold, tight stop-loss, ≤30% single-asset cap |
| **Balanced** (recommended default) | `1` | Medium turnover, ≥60% confidence, 50% single-asset cap, 15% stop-loss |
| **Tactical** | `2` | Higher turnover, ≥55% confidence, 50% cap, 10% stop-loss, shorter cooldown |

---

### Fees (dalam %; frontend otomatis convert ke bps)

Balanced recommended:
- **Performance fee**: `15` (= 1500 bps, kena cap 30%)
- **Management fee**: `2` (= 200 bps, kena cap 5%)
- **Entry fee**: `0.5` (= 50 bps, kena cap 2%)
- **Exit fee**: `0.5` (= 50 bps, kena cap 2%)

Conservative (cheaper):
- Performance `10` / Management `1.5` / Entry `0.25` / Exit `0.25`

Tactical (higher perf fee):
- Performance `20` / Management `2` / Entry `0.5` / Exit `0.5`

---

### Recommended policy parameters

Field ini jadi *default* untuk vault yang pakai operator ini (vault owner masih bisa override saat create).

Balanced:
- **recommendedMaxPositionBps**: `5000` (50% single-asset cap)
- **recommendedConfidenceMinBps**: `6000` (60% AI confidence floor)
- **recommendedStopLossBps**: `1500` (15% drawdown → stop)
- **recommendedCooldownSeconds**: `900` (15 menit antar-trade)
- **recommendedMaxActionsPerDay**: `6`

Conservative:
- maxPosition `3000` · confidenceMin `7000` · stopLoss `1000` · cooldown `3600` · maxActions `3`

Tactical:
- maxPosition `5000` · confidenceMin `5500` · stopLoss `1000` · cooldown `300` · maxActions `12`

---

## Step 2 — Submit register() tx

Setelah semua field terisi, klik submit. Tx goes to `OperatorRegistry V2` at:
```
0xF775D9634bFCe4D0F1F56874873FE6cb35A28CA5
```

Explorer: [`https://chainscan.0g.ai/address/0xF775D9634bFCe4D0F1F56874873FE6cb35A28CA5`](https://chainscan.0g.ai/address/0xF775D9634bFCe4D0F1F56874873FE6cb35A28CA5)

Verifikasi sukses: buka `/marketplace`, operator baru muncul di list.

---

## Step 3 (optional) — Declare AI model

Setelah register, di `/operator/profile?address=<yourOperatorWallet>` panggil `declareAIModel()`:

### AI model field (copy)

```
zai-org/GLM-5-FP8
```

### AI provider

```
0G Compute
```

### AI inference endpoint

```
https://evmrpc.0g.ai
```

(Ini RPC 0G mainnet — 0G Compute billing tx lewat sini.)

---

## Step 4 (optional tapi recommended) — Publish bonded manifest

Manifest adalah strategi JSON yang **bonded + slashable**. Governance bisa slash stake operator kalau execution history deviate dari manifest.

### 4.1 — File manifest JSON

Simpan file ini di `manifest.json`:

```json
{
  "name": "Aegis Alpha — Balanced Mandate",
  "version": "1.0.0",
  "operator": "0x<YOUR_OPERATOR_WALLET>",
  "publishedAt": "2026-04-23T00:00:00Z",
  "mandate": "Balanced",

  "strategy": {
    "summary": "AI-driven momentum + regime rotation across USDC.e / WETH / WBTC / W0G, with sealed-mode commit-reveal anti-MEV and TEE-attested inference binding.",
    "thesis": "Regime-aware position sizing. Up-trend → scale into majors (WBTC/WETH) and native 0G (W0G) up to max position cap. Range/panic → rotate to USDC.e base. Every decision EIP-712 intent-bound to GLM-5-FP8 inference response hash.",
    "venues": ["Jaine V3 on 0G Aristotle (chain 16661)"],
    "executionMode": ["open", "sealed"]
  },

  "allowedAssets": [
    { "symbol": "USDC.e", "address": "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E", "decimals": 6, "role": "base" },
    { "symbol": "WETH",   "address": "0x564770837Ef8bbF077cFe54E5f6106538c815B22", "decimals": 18, "role": "asset" },
    { "symbol": "WBTC",   "address": "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", "decimals": 8, "role": "asset" },
    { "symbol": "W0G",    "address": "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c", "decimals": 18, "role": "asset" }
  ],

  "policy": {
    "maxPositionBps": 5000,
    "confidenceThresholdBps": 6000,
    "stopLossBps": 1500,
    "cooldownSeconds": 900,
    "maxActionsPerDay": 6,
    "maxDailyLossBps": 500,
    "sealedMode": true
  },

  "ai": {
    "model": "zai-org/GLM-5-FP8",
    "provider": "0G Compute",
    "inputs": [
      "15m / 1h / 4h OHLCV for USDC.e/WETH, USDC.e/WBTC, USDC.e/W0G on Jaine",
      "Current vault NAV + allocation breakdown (Pyth-priced)",
      "7-day drawdown trajectory",
      "Pending approvals + cooldown state"
    ],
    "outputs": [
      "regime: { UP_STRONG | UP | RANGE_QUIET | RANGE_NOISY | DOWN | PANIC }",
      "action: { BUY, SELL, HOLD } per asset pair",
      "confidenceBps: 0-10000",
      "riskScoreBps: 0-10000",
      "reasonSummary: natural language"
    ],
    "attestation": "TEE-signed ECDSA; response hash committed into EIP-712 intent struct; vault verifies via ecrecover against policy.attestedSigner"
  },

  "guardrails": {
    "contractEnforced": [
      "confidenceThresholdBps floor",
      "maxPositionBps ceiling",
      "stopLossBps trigger",
      "cooldownSeconds between-trade",
      "maxActionsPerDay rate limit",
      "both-sides asset whitelist (assetIn AND assetOut)",
      "commit-reveal block gap in sealed mode",
      "attestedSigner signature match"
    ],
    "operatorSide": [
      "STRICT_MODE refuses trade on stale market data or 0G Compute failure",
      "CoinGecko fallback disabled in strict mode",
      "Orchestrator re-fetches Pyth prices every cycle"
    ]
  },

  "slashConditions": [
    "Execution deviating from declared strategy (e.g. trading disallowed asset)",
    "Signing inference not actually produced by declared AI model",
    "Bypassing stop-loss or cooldown in contract policy",
    "Collusion with external MEV infrastructure outside committed commit-reveal"
  ],

  "disclosures": [
    "Operator hot wallet key is separate from TEE signer key (enforced)",
    "No off-chain inputs beyond those listed in ai.inputs",
    "Orchestrator source: https://github.com/mdlog/aegis-vault (MIT)"
  ],

  "contact": {
    "handle": "@YourHandle",
    "email": "ops@your-domain.example",
    "repo": "https://github.com/mdlog/aegis-vault"
  }
}
```

Update field berikut sebelum commit:
- `operator`: alamat wallet operator kamu
- `publishedAt`: tanggal saat kamu commit
- `contact`: handle / email / repo kamu
- (opsional) `strategy.summary` + `strategy.thesis` jika mandate kamu bukan Balanced

### 4.2 — Upload manifest ke IPFS / GitHub / Arweave

Pilih salah satu host (yang penting URL-nya stable + public):

**Opsi A — GitHub raw (paling mudah)**:
1. Commit `manifest.json` ke repo kamu, misal di path `manifests/aegis-alpha-v1.json`
2. URI: `https://raw.githubusercontent.com/mdlog/aegis-vault/main/manifests/aegis-alpha-v1.json`

**Opsi B — IPFS** (via web3.storage / pinata):
1. Upload file ke IPFS pinning service
2. URI: `ipfs://<cid>`

**Opsi C — 0G Storage** (native):
- Future ready. Saat ini 0G Storage KV belum reliable untuk hackathon window — prefer A atau B.

### 4.3 — Hitung hash manifest

```bash
# Dari filesystem lokal
cast keccak "$(cat manifest.json)"

# Atau langsung dari URL (kalau sudah upload)
curl -s https://raw.githubusercontent.com/mdlog/.../manifest.json | cast keccak
```

Output format: `0x<64 hex chars>`.

Contoh output:
```
0xef462f339acbb414d2a89f3b05b8f7c5e6a7b8c9d0e1f23456789abcdeba21c79e
```

### 4.4 — Submit publishManifest()

Di `/operator/profile?address=<wallet>`, field:
- **URI**: URL dari 4.2
- **Hash**: output dari 4.3
- **Bonded**: `true` (boleh slash kalau execution deviate)

Tx goes to OperatorRegistry V2. Explorer link:
```
https://chainscan.0g.ai/tx/<txhash>
```

---

## Step 5 (optional) — Stake USDC.e untuk tier

Tier determines max vault size operator boleh kelola:

| Tier | USDC.e stake | Max vault NAV |
|---|---|---|
| None (default) | 0 | $5,000 |
| Bronze | 1,000 | $50,000 |
| Silver | 10,000 | $500,000 |
| Gold | 100,000 | $5,000,000 |
| Platinum | 1,000,000 | Unlimited |

Kalau hanya test demo, tier None cukup (tidak perlu stake). Kalau production, minimum Bronze direkomendasikan.

Flow stake di `/operator/profile?address=<wallet>`:
1. Approve USDC.e ke `OperatorStaking V2` (`0xAABC708aA3d5e9a37A90ff675EdBD681C204a376`)
2. Call `stake(amount)` — amount dalam USDC.e native units (6 decimals), misal `1000000000` untuk 1,000 USDC.e

---

## Step 6 — Verifikasi end-to-end

Checklist setelah register (± manifest):

- [ ] `/marketplace` tampilkan operator kamu
- [ ] `/operator/<walletAddress>` tampilkan detail: name, description, endpoint, mandate chip, fee breakdown
- [ ] Kalau publish manifest → badge "Bonded manifest" + hash terlihat
- [ ] Kalau declare AI → section "AI model" dengan `GLM-5-FP8` visible
- [ ] Orchestrator log (kalau running) → deteksi operator baru dalam waktu 1-2 cycle

On-chain verify:
```bash
# Ganti $OP dengan alamat wallet operator kamu
export OP=0x<yourOperatorWallet>
export REG=0xF775D9634bFCe4D0F1F56874873FE6cb35A28CA5

cast call $REG "isRegistered(address)(bool)" $OP --rpc-url https://evmrpc.0g.ai
# Expected: true

cast call $REG "isActive(address)(bool)" $OP --rpc-url https://evmrpc.0g.ai
# Expected: true
```

---

## Lanjutan — Create vault yang pakai operator ini

Setelah operator ready:

1. Connect wallet **user** (beda dari operator wallet) ke `/create`
2. Dropdown "Operator" → pilih operator yang barusan register
3. Executor field: alamat dari `PRIVATE_KEY` orchestrator (hot wallet, harus beda dari operator wallet)
4. Base asset: USDC.e (default)
5. Allowed assets: USDC.e + WETH + WBTC + W0G (centang keempat)
6. Policy guardrails: biasanya bisa pakai "Use operator recommended defaults" → auto-isi dari `recommendedXxxBps` yang kamu set di Step 1
7. Sealed mode: optional, kalau enable, attestedSigner = TEE_SIGNER address
8. Submit → tx ke `AegisVaultFactoryV3` (`0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3`) — frontend default sejak deploy 2026-04-27. V3 menambah slider "Cross-Chain Fee Cap" (Khalani solver fee, default 50 bps); biarkan default kalau belum mau cross-chain.
9. Frontend auto-redirect ke `/app/vault/<newVaultAddress>`

Vault siap deposit USDC.e + orchestrator akan detect + mulai cycle.

> **Note:** V2 factory (`0x9450ac911D06c81a54007a768d4278929d87A17e`) tetap operasional untuk vault yang sudah di-create sebelum 2026-04-27, tapi vault baru sebaiknya tidak pakai V2 — V2 tidak punya `acceptCrossChainFill` (Khalani path), tidak punya audit-fix surface (`maxCrossChainFeeBps`, `consumedKhalaniIds`, owner emergency controls).

---

## Quick reference — alamat kontrak 0G Aristotle (chain 16661, V3 canonical)

| Role | Address |
|---|---|
| OperatorRegistry V2 (register here) | `0xF775D9634bFCe4D0F1F56874873FE6cb35A28CA5` |
| OperatorStaking V2 (stake here) | `0xAABC708aA3d5e9a37A90ff675EdBD681C204a376` |
| **AegisVaultFactoryV3** (create vault here) | `0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3` |
| ExecutionRegistry V3 | `0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9` |
| KhalaniVenueAdapter (cross-chain) | `0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4` |
| JaineVenueAdapterV2 (multi-hop swap venue) | `0x261244010A6D87e043b3489D93fA573cdc2274B6` |
| USDC.e (base + stake token) | `0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E` |

Explorer: [chainscan.0g.ai](https://chainscan.0g.ai)
