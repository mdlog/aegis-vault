# Run an Operator — Step-by-Step Orchestrator Runbook

Panduan praktis untuk jalankan operator + orchestrator Aegis Vault dari nol di **0G Aristotle Mainnet (chain 16661)**. Operator adalah pihak yang menjalankan AI inference + submit intent ke vault. Setiap operator menjalankan instance orchestrator-nya sendiri, dan vault depositor memilih operator mana yang dia percaya jadi `executor` di vault-nya.

> **Tujuan:** dari tidak punya apa-apa → orchestrator running → operator terdaftar on-chain → vault depositor bisa pilih Anda → cycle pertama eksekusi pertama.
>
> Dokumen ini fokus ke **operasional**. Untuk form data registrasi (nama, fee, mandate copy), lihat [`OPERATOR_REGISTRATION_KIT.md`](../OPERATOR_REGISTRATION_KIT.md). Untuk arsitektur dan ekonomi, lihat [`docs/OPERATOR_GUIDE.md`](OPERATOR_GUIDE.md).

---

## Step 0 — Pre-flight checklist

Pastikan semua ini ada sebelum mulai:

| Resource | Yang dibutuhkan | Cara cek |
|---|---|---|
| **Operator wallet** (cold) | Buat wallet baru, ≥ **0.05 0G** untuk gas registrasi | `cast balance $OP --ether --rpc-url https://evmrpc.0g.ai` |
| **Executor wallet** (hot) | Wallet **berbeda** dari operator wallet (defense-in-depth), ≥ **1 0G** untuk siklus eksekusi | sda |
| **TEE signer wallet** (sealed mode only) | Berbeda lagi dari dua di atas | optional kalau Anda jalan di open mode |
| **0G Compute ledger** | Otomatis dibuat di first-run orchestrator (deposit 3 0G dari executor wallet) | `0G Compute: Ledger account found` di log |
| **Server** | Linux/macOS, Node.js **v20**, RAM 4 GB+, disk 20 GB+ | `node --version` → harus v20.x |
| **Endpoint publik** (kalau go-live) | URL HTTPS yang merespons `GET /api/health` → `200 OK` | reverse-proxy ke `localhost:4002` (nginx/caddy/cloudflared) |

**Catatan tegas tentang Node version:** orchestrator + SDK `npm test` harness saat ini di-pin Node 20 di CI. Node 22 secara teknis bisa, tapi belum sepenuhnya teruji untuk semua test. Pakai **Node 20 LTS** untuk konsistensi.

---

## Step 1 — Clone & install

```bash
git clone https://github.com/mdlog/aegis-vault.git
cd aegis-vault/orchestrator
npm install --legacy-peer-deps
```

`--legacy-peer-deps` diperlukan karena `@0glabs/0g-serving-broker` masih punya peer-dep range yang konflik dengan ethers v6 di npm v8+.

---

## Step 2 — Register operator on-chain

Anda butuh entry di `OperatorRegistry` (`0x8A12238E20e9CE5D8Ea350E58B7d03D0551CA22b`) sebelum vault depositor bisa lihat Anda di marketplace.

**Cara A — UI (paling mudah):**

1. Connect operator wallet ke `https://aegisvaults.xyz/operator/register`
2. Isi form per panduan [`OPERATOR_REGISTRATION_KIT.md`](../OPERATOR_REGISTRATION_KIT.md) Step 1
3. Submit → tx ke registry → operator muncul di `/marketplace`

**Cara B — `cast` CLI:**

```bash
export OP_KEY=0x...                                           # operator wallet private key
export REG=0x8A12238E20e9CE5D8Ea350E58B7d03D0551CA22b
export RPC=https://evmrpc.0g.ai

# Sesuaikan field: name, perfFee bps, mgmtFee bps, entryFee bps, exitFee bps, feeRecipient
cast send $REG \
  "register(string,uint256,uint256,uint256,uint256,address)" \
  "Aegis Alpha" \
  1500 200 50 50 \
  $(cast wallet address $OP_KEY) \
  --rpc-url $RPC \
  --private-key $OP_KEY
```

**Verifikasi:**

```bash
export OP=$(cast wallet address $OP_KEY)
cast call $REG "isRegistered(address)(bool)" $OP --rpc-url $RPC   # → true
cast call $REG "isActive(address)(bool)"     $OP --rpc-url $RPC   # → true
cast call $REG "totalOperators()(uint256)"   --rpc-url $RPC       # → +1
```

---

## Step 3 — (Opsional) Publish strategy manifest

Strategy manifest = JSON yang mendeklarasikan **regime gates**, **scoring weights**, **DSL rules** custom. Ada 5 template di [`orchestrator/strategies/`](../orchestrator/strategies/). Tanpa manifest, vault yang pilih Anda akan jalan dengan **Decision Engine v1 default**.

```bash
cd ../orchestrator/strategies/
cp trend-following-v1.json /tmp/my-strategy.json
# Edit /tmp/my-strategy.json — ganti operator address, contact info

# Hitung canonical hash (harus SAMA dengan keccak256 file yang Anda host)
node -e "
const { computeStrategyHash } = require('../src/strategy/hash.js');
const m = require('/tmp/my-strategy.json');
console.log(computeStrategyHash(m));
"
```

Upload ke GitHub raw / IPFS / 0G Storage, lalu publish on-chain:

```bash
cast send $REG \
  "publishManifest(string,bytes32,bool)" \
  "https://raw.githubusercontent.com/<you>/aegis-strategies/main/my-strategy.json" \
  $MANIFEST_HASH \
  true \
  --rpc-url $RPC --private-key $OP_KEY
```

**Verifikasi:**

```bash
cast call $REG "getOperatorExtended(address)" $OP --rpc-url $RPC
# Cek field manifestURI + manifestHash + manifestBonded
```

> **V4 implication:** kalau Anda nanti update manifest, V4 vault yang sudah accept hash lama **tidak otomatis pakai versi baru**. Owner harus `requestManifestUpgrade(newHash)` → tunggu 24 jam → `applyManifestUpgrade()`. Beri pengumuman ke depositor sebelum publish manifest baru.

---

## Step 4 — (Opsional) Stake USDC.e untuk tier

Tier menentukan max NAV vault yang boleh Anda kelola:

| Tier | Stake USDC.e | Max vault NAV |
|---|---|---|
| None | 0 | $5 K |
| Bronze | 1,000 | $50 K |
| Silver | 10,000 | $500 K |
| Gold | 100,000 | $5 M |
| Platinum | 1,000,000 | Unlimited |

```bash
export STAKING=0xF46b6b76c5021a21dc0029FDEAEba6713472CBE6
export USDC_E=0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E

# 1. Approve
cast send $USDC_E "approve(address,uint256)" $STAKING 1000000000 \
  --rpc-url $RPC --private-key $OP_KEY

# 2. Stake (1,000 USDC.e = 1000 × 10^6 raw units)
cast send $STAKING "stake(uint256)" 1000000000 \
  --rpc-url $RPC --private-key $OP_KEY

# 3. Verify
cast call $STAKING "stakeOf(address)(uint256)" $OP --rpc-url $RPC
```

---

## Step 5 — Configure orchestrator/.env

```bash
cd ../orchestrator
cp .env.example .env
```

Edit `.env` — minimum yang **wajib** terisi:

```bash
# Network
RPC_URL=https://evmrpc.0g.ai
CHAIN_ID=16661

# Executor wallet (HOT — submit transaksi setiap cycle)
PRIVATE_KEY=0x<your_executor_private_key>

# TEE signer (sealed mode only — wallet ketiga, BEDA dari executor + operator)
TEE_SIGNER_PRIVATE_KEY=0x<your_tee_signer_private_key>

# Deployments file (path relative ke working dir orchestrator)
DEPLOYMENTS_FILE=../contracts/deployments-mainnet.json

# 0G Compute (boleh re-use PRIVATE_KEY — billing dari wallet yang sama)
OG_COMPUTE_RPC=https://evmrpc.0g.ai
OG_COMPUTE_PRIVATE_KEY=0x<same_or_separate>
OG_COMPUTE_MODEL=zai-org/GLM-5-FP8

# Strict mode (production)
STRICT_MODE=1

# CORS (production: restrict ke domain dashboard Anda)
CORS_ALLOWED_ORIGINS=https://your-operator-dashboard.com

# API mutation key (kunci untuk POST /api/cycle, /api/og/flush — jangan share)
ORCHESTRATOR_API_KEY=<random_64_chars>

# Performance
VAULT_CONCURRENCY=5
CYCLE_INTERVAL_MINUTES=5
PORT=4002
```

**Catatan penting:**
- `PRIVATE_KEY` (executor) ≠ operator wallet. Executor adalah hot wallet yang submit tx — kalau executor key bocor, attacker bisa lakukan trade dalam batas policy vault, **tapi tidak bisa withdraw**. Operator wallet (cold) tidak perlu di-server.
- `TEE_SIGNER_PRIVATE_KEY` ≠ executor. Untuk sealed mode, vault verify signature lawan `policy.attestedSigner`. Wallet terpisah supaya kalau TEE infra di-compromise, executor masih bisa di-rotate tanpa migrate vault.

---

## Step 6 — First start (manual)

```bash
npm start
```

Yang Anda harapkan di log dalam ~30 detik pertama:

```
[time] INFO  Network:  https://evmrpc.0g.ai
[time] INFO  Chain ID: 16661
[time] INFO  Factory:  0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F
[time] INFO  0G Compute: Wallet 0x..., balance: X 0G
[time] INFO  0G Compute: Ledger account found       ← atau "Creating ledger (deposit 3 0G)..."
[time] INFO  0G Compute: Selected → zai-org/GLM-5-FP8
[time] INFO  Vault indexer ready — N cached vault(s)
[time] INFO  Wallet pool initialized — 1 executor wallet(s):
[time] INFO    [0] 0x<your_executor_address>
[time] INFO  Orchestrator scheduled: running every 5 minutes
[time] INFO  API server running on http://localhost:4002
```

**Verifikasi cepat dari shell lain:**

```bash
curl http://localhost:4002/api/health
# → {"status":"ok","timestamp":"..."}

curl http://localhost:4002/api/status | jq .
# → executorAddress, ogCompute, managedVaults: []  (kosong sampai vault depositor pilih Anda)
```

> **Belum ada vault?** Itu normal. Vault baru auto-discover dalam 15 detik setelah ada `VaultDeployed` event di factory yang menunjuk executor wallet Anda.

---

## Step 7 — Run di production (PM2 / systemd)

`npm start` mati kalau terminal close. Untuk persistent:

**PM2 (recommended):**

```bash
npm install -g pm2
cd /path/to/aegis-vault/orchestrator
pm2 start npm --name aegis-orchestrator -- start
pm2 save
pm2 startup            # follow instruksi yang muncul untuk auto-start saat reboot
```

Manage:

```bash
pm2 logs aegis-orchestrator              # tail logs
pm2 restart aegis-orchestrator           # restart setelah .env edit
pm2 stop aegis-orchestrator              # stop graceful
pm2 status                               # health check
```

**systemd (alternatif):**

```ini
# /etc/systemd/system/aegis-orchestrator.service
[Unit]
Description=Aegis Vault Orchestrator
After=network.target

[Service]
Type=simple
User=aegis
WorkingDirectory=/opt/aegis-vault/orchestrator
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aegis-orchestrator
sudo journalctl -u aegis-orchestrator -f
```

---

## Step 8 — Verify operator pickup oleh vault baru

Saat vault depositor create vault dan pilih executor wallet Anda:

1. Frontend submit `factory.createVault(...)` → emit `VaultDeployed` event
2. Orchestrator `vaultEventListener` (poll 30s) detect event → tambah vault ke `vault-index.json` cache
3. Cycle berikutnya (max 5 min) → log:

```
[time] INFO  Indexer: 1 vault(s) assigned to 1 executor wallet(s)
[time] INFO  Fetching market data...
[time] INFO    ── Vault 0xABCDEF...123456 ──
[time] INFO    Operator: <your_name> · None · stake $1 · rep 0x (0% success)
[time] INFO    NAV: $X | Base: $X | Paused: false | Actions: 0 | Position: flat
[time] INFO    Strategy: <strategy.id> hash=0x... v1     ← kalau Anda publish manifest
[time] INFO    Context asset: 0G | Regime: ... | RSI: ...
[time] INFO    Requesting AI assessment from 0G Compute...
[time] INFO    Decision: HOLD/BUY/SELL <asset> | Edge: X | Source: 0g-compute + engine-v1
```

Kalau policy gate lolos → tx submit → `IntentExecuted` event di vault.

**Cek dari API:**

```bash
curl "http://localhost:4002/api/journal/decisions?vault=0xABCDEF...&limit=5" | jq .
curl "http://localhost:4002/api/journal/executions?vault=0xABCDEF...&limit=5" | jq .
```

---

## Step 9 — Trigger manual cycle (untuk demo / debugging)

Default: cycle setiap 5 menit. Untuk paksa cycle sekarang:

```bash
curl -X POST http://localhost:4002/api/cycle \
  -H "x-api-key: $ORCHESTRATOR_API_KEY"
```

Tanpa API key, mutation route hanya menerima request dari `localhost:127.0.0.1` (loopback only). Production setting: pasang API key + restrict CORS.

---

## Step 10 — Health monitoring

| Metric | Cek | Alert kalau |
|---|---|---|
| Executor wallet balance | `cast balance <executor> --ether --rpc-url $RPC` | < 0.5 0G (10x rata-rata cycle gas) |
| 0G Compute ledger | `/api/og-compute/ledger` (kalau exposed) | < 1 0G — refill via `addToLedger` |
| Orchestrator API | `curl /api/health` | exit non-200 atau timeout > 5s |
| Cycle freshness | `/api/status` → `cycleCount` | tidak naik 2× dari interval (= 10 min) |
| Reputation success rate | on-chain via `OperatorReputation` | drop di bawah 80% |
| RPC `0G mainnet` | response time | > 3s konsisten — switch primary RPC |

Untuk dashboard, [`docs/OPERATOR_GUIDE.md`](OPERATOR_GUIDE.md) menyebut Grafana setup.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `0G Compute: Insufficient balance` saat boot | Executor wallet kurang dari 3 0G untuk init ledger | Top-up wallet ke ≥ 5 0G |
| `Vault indexer ready — 0 cached vault(s)` terus | Belum ada vault yang pilih executor Anda | Normal — tunggu vault depositor |
| `Indexer poll failed: request timeout` di log | RPC 0G lambat saat polling event | Tidak fatal — main loop tetap jalan; pertimbangkan secondary RPC |
| `Strategy load failed (StrategyHashMismatch)` | URI manifest serve content yang beda dari hash on-chain | Re-upload file ke URI yang konsisten, atau `publishManifest` ulang dengan hash yang benar |
| `Strategy load failed (StrategyFetchError)` | URI tidak reachable | Cek IPFS gateway atau GitHub raw URL responsif |
| `WrongStrategyHash` revert saat `executeIntent` | V4 vault accept hash X, manifest publish hash Y | Owner approve via `requestManifestUpgrade(Y)` → tunggu 24h → `applyManifestUpgrade()` |
| `OnlyExecutor` revert | `policy.executor` di vault ≠ alamat dari `PRIVATE_KEY` orchestrator | Verifikasi vault `executor()` view; rotate via `setExecutor` kalau perlu |
| `AutoExecutionDisabled` revert | Vault owner set `policy.autoExecution = false` | Owner harus enable lewat `updatePolicy` |
| `IntentVaultMismatch` revert | Intent `vault` field ≠ alamat vault yang dipanggil | Bug — open issue dengan tx hash + journal entry |
| Decision selalu `HOLD` | Confidence threshold terlalu tinggi atau market regime fit | Vault owner lower `confidenceThresholdBps` ke 3000 (demo) |
| Cycle butuh > 30s untuk 1 vault | RPC latency atau 0G Compute slow response | Cek 0G Compute provider endpoint; pertimbangkan switch model |

---

## Cross-references

- **Form data registrasi** (nama, fee, mandate copy, recommended policy values): [`OPERATOR_REGISTRATION_KIT.md`](../OPERATOR_REGISTRATION_KIT.md)
- **Decentralization story + scaling guide** (multi-wallet pool, multi-instance): [`docs/OPERATOR_GUIDE.md`](OPERATOR_GUIDE.md)
- **Strategy manifest schema spec**: [`docs/STRATEGY_MANIFEST.md`](STRATEGY_MANIFEST.md)
- **AI decision flow**: [`docs/AI_AGENT_DECISION_FLOW.md`](AI_AGENT_DECISION_FLOW.md)
- **V4 manifest binding & timelock**: [`docs/V4_MIGRATION_GUIDE.md`](V4_MIGRATION_GUIDE.md)
- **Live address book**: [`contracts/deployments-mainnet.json`](../contracts/deployments-mainnet.json)

---

## Quick reference — kontrak 0G Aristotle (chain 16661)

| Role | Address |
|---|---|
| OperatorRegistry | `0x8A12238E20e9CE5D8Ea350E58B7d03D0551CA22b` |
| OperatorStaking | `0xF46b6b76c5021a21dc0029FDEAEba6713472CBE6` |
| OperatorReputation | `0x4389d082dE464defF665612A73f36b99059F2Da4` |
| InsurancePool | `0xe69eAff976b6AEf35556cb3D09972E401a85DD77` |
| **AegisVaultFactoryV4** (current default) | `0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F` |
| ExecutionRegistry V3 | `0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9` |
| AegisVault_v4 impl | `0x28F8E1a9Af4eBF4Df323861F499B8d87295b72Ed` |
| KhalaniVenueAdapter (cross-chain) | `0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4` |
| JaineVenueAdapterV2 (multi-hop) | `0xA4E2aeB9e1a5297DE38d7Ad8e11b1714ca481F2f` |
| ProtocolTreasury | `0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4` |
| AegisGovernor (multisig) | `0x023EC4a54435f94E9395460e4835e75E429D5A2e` |
| USDC.e | `0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E` |
| W0G | `0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c` |

Explorer: [chainscan.0g.ai](https://chainscan.0g.ai) · RPC: `https://evmrpc.0g.ai` · Chain ID: 16661

> **V4 (strategy-binding):** belum di-deploy on-chain. Setelah `contracts/scripts/deploy-v4.js` jalan, address `aegisVaultFactoryV4` akan terisi di `deployments-mainnet.json` dan otomatis disurface ke frontend lewat `sync-frontend.js`. Orchestrator auto-detect — tidak perlu env var tambahan.
