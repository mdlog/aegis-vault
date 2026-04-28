# Operator Registration Kit — Live test on V3 fresh stack

> Source material untuk mengisi form `/operator/register` di Aegis Vault V3 (0G Aristotle Mainnet, chain 16661). Operator marketplace di-redeploy fresh pada **2026-04-27** — saat dokumen ini ditulis registry baru **kosong (0 operator)**, jadi kit ini sekaligus berfungsi sebagai prosedur test untuk mengisi operator pertama di V3.

**Live state (verify before mulai):**
```bash
cast call 0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9 "totalOperators()(uint256)" --rpc-url https://evmrpc.0g.ai
# Expected sekarang: 0 (atau jumlah yang sudah register sejak Anda baca dokumen ini)
```

---

## Quick test recipe (5 menit — minimal happy path)

Untuk yang sekedar mau verifikasi flow register → marketplace muncul → buat vault V3 → deposit:

| Step | Action | Tx target |
|---|---|---|
| 1 | Register operator dengan default Balanced (Step 1 di bawah) | `OperatorRegistry` `0x252Ef1B2…594c9` |
| 2 | (Skip) declare AI + manifest + stake — opsional | — |
| 3 | `cast call registry.totalOperators()` → harus jadi `1` | — |
| 4 | Buat vault baru di UI, pilih operator yang baru register | `AegisVaultFactoryV3` `0x75668Ca9…EFE0e3` |
| 5 | Deposit ~$10 USDC.e ke vault | vault clone |
| 6 | Tunggu 1 cycle orchestrator (max 5 menit) → cek `/journal` ada decision baru | — |

Kalau Anda mau hardening lengkap (manifest bonded, stake tier, AI declared) → ikuti Step 3-5 setelah quick recipe selesai.

---

## Pre-requisites sebelum buka form

| Wallet role | Yang dilakukan | Catatan |
|---|---|---|
| **Operator wallet** | Sign tx `register()`, `declareAI()`, `publishManifest()`, `stake()` | Public-facing identity. Idealnya HARDWARE wallet (cold). |
| **Executor wallet** | Hot wallet di orchestrator `PRIVATE_KEY` env. Submit `executeIntent` dari vault | **HARUS BEDA** dari operator wallet (defense-in-depth). Saat ini di config: `0x98cC8351C1310FD54B9090dF3fcA80CB61d7b5E7` |
| **TEE signer wallet** | Sign attestation hash di `policy.attestedSigner`. Khusus sealed mode | Beda lagi dari executor & operator. Optional kalau test pakai open mode |

Saldo minimum:
- [ ] Operator wallet: ≥ **0.05 0G** untuk gas (register + declareAI + publishManifest = 3 tx)
- [ ] Executor wallet: ≥ **1 0G** untuk gas eksekusi vault cycles
- [ ] (Opsional) Operator wallet: ≥ **1,000 USDC.e** kalau mau stake Bronze tier

Cek saldo cepat:
```bash
export OP=0x<your_operator_wallet>
cast balance $OP --ether --rpc-url https://evmrpc.0g.ai
cast balance 0x98cC8351C1310FD54B9090dF3fcA80CB61d7b5E7 --ether --rpc-url https://evmrpc.0g.ai
```

Lainnya:
- [ ] Wallet operator connected ke **0G Aristotle Mainnet (chain 16661)** di MetaMask (RPC `https://evmrpc.0g.ai`, symbol `0G`)
- [ ] Frontend ter-build dengan manifest V3 (`frontend/src/lib/deployments.generated.json` punya `aegisVaultFactory: 0x75668Ca9…`)
- [ ] Orchestrator running di `http://localhost:4002` (cek `curl http://localhost:4002/api/health` → `{status:"ok"}`)
- [ ] Public endpoint orchestrator (kalau go-live; lihat Step 1 → Endpoint)

---

## Step 1 — Form field values (siap copy)

### Name (max 64 chars)

```
Aegis Alpha
```

**Tip**: pendek, distinct, bisa dicari. Kalau mau test sebagai pengguna kedua yang register, pakai suffix:
```
Aegis Test V3
```

---

### Description (max ~200 chars)

```
Balanced-mandate AI operator. GLM-5-FP8 inference on 0G Compute, TEE-attested signatures bound to EIP-712 intents, commit-reveal sealed mode, real Jaine V3 multi-hop execution on 0G mainnet. Trades USDC.e / WETH / WBTC / W0G pools.
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

Demo lokal (hanya untuk testing dari mesin Anda — tidak bisa diakses orang lain):
```
http://localhost:4002
```

**Catatan**: endpoint harus merespons `GET /api/health` → `200 OK` agar orchestrator terdeteksi online. Public-facing endpoint terlihat siapapun.

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

> V3 split fee 80/20: 80% ke `policy.feeRecipient` (operator), 20% ke `ProtocolTreasury` `0xCDc5D994…0dF4`. Otomatis di-apply oleh `IOLib`.

---

### Recommended policy parameters

Field ini jadi *default* untuk vault yang pakai operator ini (vault owner masih bisa override saat create).

Balanced (matched dengan deskripsi di atas):
- **recommendedMaxPositionBps**: `5000` (50% single-asset cap)
- **recommendedConfidenceMinBps**: `6000` (60% AI confidence floor)
- **recommendedStopLossBps**: `1500` (15% drawdown → stop)
- **recommendedCooldownSeconds**: `900` (15 menit antar-trade)
- **recommendedMaxActionsPerDay**: `6`

Conservative:
- maxPosition `3000` · confidenceMin `7000` · stopLoss `1000` · cooldown `3600` · maxActions `3`

Tactical:
- maxPosition `5000` · confidenceMin `5500` · stopLoss `1000` · cooldown `300` · maxActions `12`

> **Demo-friendly preset** — kalau Anda mau cepat lihat trade pertama tanpa nunggu sinyal kuat:
> - confidenceMin `3000` (30%) — gate engine cepat lolos
> - cooldown `60` — bisa execute setiap cycle
> - maxActions `20` — tidak rate-limited di hari demo

---

## Step 2 — Submit register() tx

Setelah semua field terisi, klik submit. Tx goes to `OperatorRegistry` at:
```
0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9
```

Explorer: [`https://chainscan.0g.ai/address/0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9`](https://chainscan.0g.ai/address/0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9)

Verifikasi sukses:
```bash
export OP=0x<your_operator_wallet>
export REG=0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9

cast call $REG "totalOperators()(uint256)" --rpc-url https://evmrpc.0g.ai
# Expected: 1 (atau increment 1 dari sebelumnya)

cast call $REG "isRegistered(address)(bool)" $OP --rpc-url https://evmrpc.0g.ai
# Expected: true

cast call $REG "isActive(address)(bool)" $OP --rpc-url https://evmrpc.0g.ai
# Expected: true
```

UI verify: buka `/marketplace` — operator harus muncul di list.

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

Verify on-chain:
```bash
cast call $REG "operators(address)" $OP --rpc-url https://evmrpc.0g.ai
# Output struct termasuk aiModel field — harus berisi "zai-org/GLM-5-FP8"
```

---

## Step 4 (optional tapi recommended) — Publish bonded manifest

Manifest adalah strategi JSON yang **bonded + slashable**. Governance (multisig `0x023EC4a5…`) bisa slash stake operator kalau execution history deviate dari manifest.

### 4.1 — File manifest JSON

Sudah ada template lengkap di [`manifests/aegis-alpha-v1.json`](manifests/aegis-alpha-v1.json). Manifest sudah di-update untuk V3 (Jaine V2 multi-hop adapter + Khalani cross-chain venue).

Update field berikut sebelum commit ulang:
- `operator`: alamat wallet operator kamu (saat ini placeholder `0x98cC8351…`)
- `publishedAt`: ISO 8601 timestamp publish (mis. `2026-04-27T12:00:00Z`)
- `contact`: handle / email / repo kamu
- (opsional) `strategy.summary` + `strategy.thesis` jika mandate kamu bukan Balanced

### 4.2 — Upload manifest ke IPFS / GitHub / Arweave

Pilih salah satu host (yang penting URL-nya stable + public):

**Opsi A — GitHub raw (paling mudah, sudah ada di repo)**:
- URI: `https://raw.githubusercontent.com/mdlog/aegis-vault/main/manifests/aegis-alpha-v1.json`

**Opsi B — IPFS** (via web3.storage / pinata):
1. Upload file ke IPFS pinning service
2. URI: `ipfs://<cid>`

**Opsi C — 0G Storage** (native):
- Belum dipakai untuk hackathon window — prefer A atau B sampai 0G Storage KV stabil.

### 4.3 — Hitung hash manifest

```bash
# Dari filesystem lokal repo
cast keccak "$(cat manifests/aegis-alpha-v1.json)"

# Atau langsung dari URL (kalau sudah upload)
curl -sL https://raw.githubusercontent.com/mdlog/aegis-vault/main/manifests/aegis-alpha-v1.json \
  | cast keccak
```

Output format: `0x<64 hex chars>`.

### 4.4 — Submit publishManifest()

Di `/operator/profile?address=<wallet>`, field:
- **URI**: URL dari 4.2
- **Hash**: output dari 4.3 (harus persis match isi yang di URI — kalau hash mismatch, governance bisa slash)
- **Bonded**: `true` (boleh slash kalau execution deviate)

Verify on-chain:
```bash
cast call $REG "operators(address)" $OP --rpc-url https://evmrpc.0g.ai
# Cek field manifestURI + manifestHash + manifestBonded sudah ter-set
```

UI verify: buka `/operator/<walletAddress>` — badge "Bonded manifest published" harus muncul.

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

1. Approve USDC.e ke `OperatorStaking` (`0xe153A071FBFFa20Bd1a016C545745EFcAC3F2bc3`)
2. Call `stake(amount)` — amount dalam USDC.e native units (6 decimals), misal `1000000000` untuk 1,000 USDC.e

Cast equivalent (kalau mau via CLI, bukan UI):
```bash
export USDC=0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E
export STAKING=0xe153A071FBFFa20Bd1a016C545745EFcAC3F2bc3

# 1. Approve 1,000 USDC.e
cast send $USDC "approve(address,uint256)" $STAKING 1000000000 \
  --rpc-url https://evmrpc.0g.ai --private-key $OP_PRIVATE_KEY

# 2. Stake
cast send $STAKING "stake(uint256)" 1000000000 \
  --rpc-url https://evmrpc.0g.ai --private-key $OP_PRIVATE_KEY

# 3. Verify
cast call $STAKING "stakeOf(address)(uint256)" $OP --rpc-url https://evmrpc.0g.ai
# Expected: 1000000000 (= 1,000 × 10^6)
```

---

## Step 6 — Verifikasi end-to-end

Checklist setelah register (± manifest):

- [ ] `/marketplace` tampilkan operator kamu
- [ ] `/operator/<walletAddress>` tampilkan detail: name, description, endpoint, mandate chip, fee breakdown
- [ ] Kalau publish manifest → badge "Bonded manifest" + hash terlihat
- [ ] Kalau declare AI → section "AI model" dengan `GLM-5-FP8` visible
- [ ] Orchestrator log (kalau running) → `Indexer: 1 vault(s) assigned to 1 executor wallet(s)` dalam 1-2 cycle setelah Anda buat vault yang pakai operator ini

On-chain verify (gabungan):
```bash
export OP=0x<yourOperatorWallet>
export REG=0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9
export RPC=https://evmrpc.0g.ai

cast call $REG "totalOperators()(uint256)"      --rpc-url $RPC   # → 1+
cast call $REG "isRegistered(address)(bool)" $OP --rpc-url $RPC  # → true
cast call $REG "isActive(address)(bool)"     $OP --rpc-url $RPC  # → true
```

---

## Step 7 — Create vault yang pakai operator ini (lanjutan)

Setelah operator ready:

1. Connect wallet **user** (beda dari operator wallet) ke `/create`
2. Dropdown "Operator" → pilih operator yang barusan register
3. **Executor field**: alamat dari `PRIVATE_KEY` orchestrator (hot wallet, harus beda dari operator wallet). Default saat ini: `0x98cC8351C1310FD54B9090dF3fcA80CB61d7b5E7`
4. **Base asset**: USDC.e (`0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E`)
5. **Allowed assets**: USDC.e + WETH + WBTC + W0G (centang keempat). W0G **wajib** karena Jaine multi-hop adapter route via W0G hub
6. **Policy guardrails**: pakai "Use operator recommended defaults" → auto-isi dari `recommendedXxxBps` yang kamu set di Step 1
7. **Cross-chain fee cap**: V3 menambah field "Cross-Chain Fee Cap" (Khalani solver fee, default 50 bps, max 200 bps). Biarkan default kalau belum mau cross-chain
8. **Sealed mode**: optional, kalau enable, attestedSigner = TEE_SIGNER address
9. Submit → tx ke `AegisVaultFactoryV3` (`0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3`)
10. Frontend auto-redirect ke `/app/vault/<newVaultAddress>`

Verify vault baru tercipta:
```bash
cast call 0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3 "allVaults(uint256)(address)" 0 --rpc-url $RPC
# Expected: address vault clone yang baru deploy

cast call <newVaultAddress> "version()(string)" --rpc-url $RPC
# Expected: "v3"

cast call <newVaultAddress> "owner()(address)" --rpc-url $RPC
# Expected: alamat user (depositor)

cast call <newVaultAddress> "executor()(address)" --rpc-url $RPC
# Expected: alamat executor 0x98cC8351...
```

Vault siap deposit USDC.e + orchestrator akan detect (dalam 15 detik via VaultDeployed event poller) + mulai cycle.

---

## Step 8 — Test cycle pertama

Setelah deposit (mis. 10 USDC.e):

1. Tunggu max 5 menit (cycle interval) atau trigger manual:
   ```bash
   curl -X POST http://localhost:4002/api/cycle \
     -H "x-api-key: $ORCHESTRATOR_API_KEY"   # kalau ORCHESTRATOR_API_KEY di-set
   ```
2. Cek log orchestrator → cari baris `CYCLE #N STARTING (multi-vault)`
3. Cek decision: `curl http://localhost:4002/api/journal/decisions?limit=1 | jq`
4. Kalau gate engine lolos → `/api/journal/executions?limit=1` ada tx hash
5. Verify on-chain:
   ```bash
   cast tx <txhash> --rpc-url https://evmrpc.0g.ai
   # Cek logs: harus ada IntentExecuted event dari vault baru
   ```

Kalau decision = `HOLD` terus tapi ingin lihat trade beneran:
- Lower `confidenceThresholdBps` di vault policy ke `3000` (`/app/vault/<addr>` → Settings)
- Atau ubah operator's `recommendedConfidenceMinBps` lalu re-create vault

---

## Quick reference — alamat kontrak 0G Aristotle (chain 16661, V3)

| Role | Address |
|---|---|
| **OperatorRegistry** (register here) | `0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9` |
| **OperatorStaking** (stake here) | `0xe153A071FBFFa20Bd1a016C545745EFcAC3F2bc3` |
| OperatorReputation | `0x855380187f223391b55fc381f33429A14d238879` |
| InsurancePool | `0xd5eb21420e9D22b763b94fDb396756d820eCa694` |
| AegisGovernor (multisig) | `0x023EC4a54435f94E9395460e4835e75E429D5A2e` |
| **AegisVaultFactoryV3** (create vault here) | `0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3` |
| ExecutionRegistry V3 | `0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9` |
| AegisVault impl V3 | `0x0c78257550802bF2fFD201106Fe8096A5211397e` |
| KhalaniVenueAdapter (cross-chain) | `0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4` |
| JaineVenueAdapterV2 (multi-hop swap venue) | `0x261244010A6D87e043b3489D93fA573cdc2274B6` |
| ProtocolTreasury | `0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4` |
| USDC.e (base + stake token) | `0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E` |
| WETH | `0x564770837Ef8bbF077cFe54E5f6106538c815B22` |
| WBTC | `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` |
| W0G (hub for multi-hop) | `0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c` |
| Executor wallet (orchestrator hot) | `0x98cC8351C1310FD54B9090dF3fcA80CB61d7b5E7` |

Explorer: [chainscan.0g.ai](https://chainscan.0g.ai)
RPC: `https://evmrpc.0g.ai`

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `register()` revert dengan `"already registered"` | Wallet operator sudah register | Pakai wallet baru, atau `updateOperator()` instead |
| Frontend tidak tampil operator setelah register | Cache stale | Refresh hard (Ctrl+Shift+R), atau cek `cast call ... isRegistered` di on-chain |
| Operator muncul tapi orchestrator tidak detect | Indexer cache stale | `cd orchestrator && ./scripts/fresh-cycle.sh && npm start` |
| `executeIntent` revert dengan `"executor"` | `policy.executor` ≠ alamat dari `PRIVATE_KEY` orchestrator | Cek vault `executor()` match dengan signer orchestrator |
| `executeIntent` revert dengan `"asset not allowed"` | Token in/out tidak ada di `allowedAssets` vault | Kalau Jaine route lewat W0G hub, allowedAssets harus include W0G |
| Vault deploy sukses tapi NAV = 0 | Belum deposit | Approve USDC.e ke vault → call `deposit(amount)` |
| Decision selalu `HOLD` | Confidence threshold terlalu tinggi atau market regime tidak fit | Lower `confidenceThresholdBps` ke 3000 untuk demo |
