# Run an Operator — Step-by-Step Orchestrator Runbook

Practical guide for running an Aegis Vault operator + orchestrator from zero on **0G Aristotle Mainnet (chain 16661)**. An operator is the party that runs AI inference and submits intents to the vault. Each operator runs their own orchestrator instance, and vault depositors choose which operator they trust as the `executor` of their vault.

> **Goal:** from nothing → orchestrator running → operator registered on-chain → vault depositors can pick you → first cycle, first execution.
>
> This document focuses on **operations**. For registration form data (name, fees, mandate copy), see [`OPERATOR_REGISTRATION_KIT.md`](../OPERATOR_REGISTRATION_KIT.md). For architecture and economics, see [`docs/OPERATOR_GUIDE.md`](OPERATOR_GUIDE.md).

---

## Step 0 — Pre-flight checklist

Make sure all of these are in place before you start:

| Resource | What you need | How to check |
|---|---|---|
| **Operator wallet** (cold) | Fresh wallet, ≥ **0.05 0G** for registration gas | `cast balance $OP --ether --rpc-url https://evmrpc.0g.ai` |
| **Executor wallet** (hot) | A wallet **different** from the operator wallet (defense-in-depth), ≥ **1 0G** for execution cycles | same as above |
| **TEE signer wallet** (sealed mode only) | Yet another wallet, distinct from the two above | optional if you run in open mode |
| **0G Compute ledger** | Auto-created on orchestrator first-run (deposit 3 0G from executor wallet) | `0G Compute: Ledger account found` in logs |
| **Server** | Linux/macOS, Node.js **v20**, 4 GB+ RAM, 20 GB+ disk | `node --version` → must be v20.x |
| **Public endpoint** (if going live) | HTTPS URL that responds to `GET /api/health` → `200 OK` | reverse-proxy to `localhost:4002` (nginx/caddy/cloudflared) |

**Strict note on Node version:** the orchestrator + SDK `npm test` harness is currently pinned to Node 20 in CI. Node 22 technically works, but is not fully exercised across all tests. Use **Node 20 LTS** for consistency.

---

## Step 1 — Clone & install

```bash
git clone https://github.com/mdlog/aegis-vault.git
cd aegis-vault/orchestrator
npm install --legacy-peer-deps
```

`--legacy-peer-deps` is required because `@0glabs/0g-serving-broker` still has a peer-dep range that conflicts with ethers v6 under npm v8+.

---

## Step 2 — Register operator on-chain

You need an entry in `OperatorRegistry` (`0x8A12238E20e9CE5D8Ea350E58B7d03D0551CA22b`) before vault depositors can see you in the marketplace.

**Path A — UI (easiest):**

1. Connect the operator wallet to `https://aegisvaults.xyz/operator/register`
2. Fill the form per [`OPERATOR_REGISTRATION_KIT.md`](../OPERATOR_REGISTRATION_KIT.md) Step 1
3. Submit → tx hits the registry → your operator entry appears in `/marketplace`

**Path B — `cast` CLI:**

```bash
export OP_KEY=0x...                                           # operator wallet private key
export REG=0x8A12238E20e9CE5D8Ea350E58B7d03D0551CA22b
export RPC=https://evmrpc.0g.ai

# Adjust fields: name, perfFee bps, mgmtFee bps, entryFee bps, exitFee bps, feeRecipient
cast send $REG \
  "register(string,uint256,uint256,uint256,uint256,address)" \
  "Aegis Alpha" \
  1500 200 50 50 \
  $(cast wallet address $OP_KEY) \
  --rpc-url $RPC \
  --private-key $OP_KEY
```

**Verify:**

```bash
export OP=$(cast wallet address $OP_KEY)
cast call $REG "isRegistered(address)(bool)" $OP --rpc-url $RPC   # → true
cast call $REG "isActive(address)(bool)"     $OP --rpc-url $RPC   # → true
cast call $REG "totalOperators()(uint256)"   --rpc-url $RPC       # → +1
```

---

## Step 3 — (Optional) Publish strategy manifest

A strategy manifest is a JSON document that declares **regime gates**, **scoring weights**, and custom **DSL rules**. There are 5 templates in [`orchestrator/strategies/`](../orchestrator/strategies/). Without a manifest, vaults that pick you will run on the **default Decision Engine v1**.

```bash
cd ../orchestrator/strategies/
cp trend-following-v1.json /tmp/my-strategy.json
# Edit /tmp/my-strategy.json — set your operator address + contact info

# Compute the canonical hash (must MATCH the keccak256 of the file you host)
node -e "
const { computeStrategyHash } = require('../src/strategy/hash.js');
const m = require('/tmp/my-strategy.json');
console.log(computeStrategyHash(m));
"
```

Upload to GitHub raw / IPFS / 0G Storage, then publish on-chain:

```bash
cast send $REG \
  "publishManifest(string,bytes32,bool)" \
  "https://raw.githubusercontent.com/<you>/aegis-strategies/main/my-strategy.json" \
  $MANIFEST_HASH \
  true \
  --rpc-url $RPC --private-key $OP_KEY
```

**Verify:**

```bash
cast call $REG "getOperatorExtended(address)" $OP --rpc-url $RPC
# Check the manifestURI + manifestHash + manifestBonded fields
```

> **V4 implication:** if you later update the manifest, V4 vaults that already accepted the old hash **will not automatically switch to the new version**. The vault owner must call `requestManifestUpgrade(newHash)` → wait 24 hours → `applyManifestUpgrade()`. Notify depositors before you publish a new manifest.

---

## Step 4 — (Optional) Stake USDC.e for a tier

Tier determines the max vault NAV you are allowed to manage:

| Tier | USDC.e Stake | Max Vault NAV |
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

Edit `.env` — minimum **required** fields:

```bash
# Network
RPC_URL=https://evmrpc.0g.ai
CHAIN_ID=16661

# Executor wallet (HOT — submits a transaction every cycle)
PRIVATE_KEY=0x<your_executor_private_key>

# TEE signer (sealed mode only — a third wallet, DISTINCT from executor + operator)
TEE_SIGNER_PRIVATE_KEY=0x<your_tee_signer_private_key>

# Deployments file (path relative to the orchestrator working dir)
DEPLOYMENTS_FILE=../contracts/deployments-mainnet.json

# 0G Compute (may reuse PRIVATE_KEY — billing from the same wallet)
OG_COMPUTE_RPC=https://evmrpc.0g.ai
OG_COMPUTE_PRIVATE_KEY=0x<same_or_separate>
OG_COMPUTE_MODEL=zai-org/GLM-5-FP8

# Strict mode (production)
STRICT_MODE=1

# CORS (production: restrict to your operator dashboard domain)
CORS_ALLOWED_ORIGINS=https://your-operator-dashboard.com

# API mutation key (key for POST /api/cycle, /api/og/flush — do not share)
ORCHESTRATOR_API_KEY=<random_64_chars>

# Performance
VAULT_CONCURRENCY=5
CYCLE_INTERVAL_MINUTES=5
PORT=4002
```

**Important notes:**
- `PRIVATE_KEY` (executor) ≠ operator wallet. The executor is a hot wallet that submits txs — if the executor key leaks, an attacker can only trade within the vault's policy bounds, **they cannot withdraw**. The operator wallet (cold) never needs to touch the server.
- `TEE_SIGNER_PRIVATE_KEY` ≠ executor. For sealed mode, the vault verifies the signature against `policy.attestedSigner`. A separate wallet means that if your TEE infra is compromised, the executor can still be rotated without migrating the vault.

---

## Step 6 — First start (manual)

```bash
npm start
```

What to expect in the logs in the first ~30 seconds:

```
[time] INFO  Network:  https://evmrpc.0g.ai
[time] INFO  Chain ID: 16661
[time] INFO  Factory:  0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F
[time] INFO  0G Compute: Wallet 0x..., balance: X 0G
[time] INFO  0G Compute: Ledger account found       ← or "Creating ledger (deposit 3 0G)..."
[time] INFO  0G Compute: Selected → zai-org/GLM-5-FP8
[time] INFO  Vault indexer ready — N cached vault(s)
[time] INFO  Wallet pool initialized — 1 executor wallet(s):
[time] INFO    [0] 0x<your_executor_address>
[time] INFO  Orchestrator scheduled: running every 5 minutes
[time] INFO  API server running on http://localhost:4002
```

**Quick check from another shell:**

```bash
curl http://localhost:4002/api/health
# → {"status":"ok","timestamp":"..."}

curl http://localhost:4002/api/status | jq .
# → executorAddress, ogCompute, managedVaults: []  (empty until a depositor picks you)
```

> **No vaults yet?** That's normal. New vaults are auto-discovered within 15 seconds of a `VaultDeployed` event on the factory that names your executor wallet.

---

## Step 7 — Run in production (PM2 / systemd)

`npm start` dies when the terminal closes. For persistence:

**PM2 (recommended):**

```bash
npm install -g pm2
cd /path/to/aegis-vault/orchestrator
pm2 start npm --name aegis-orchestrator -- start
pm2 save
pm2 startup            # follow the printed instructions to auto-start on reboot
```

Manage:

```bash
pm2 logs aegis-orchestrator              # tail logs
pm2 restart aegis-orchestrator           # restart after .env edits
pm2 stop aegis-orchestrator              # graceful stop
pm2 status                               # health check
```

**systemd (alternative):**

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

## Step 8 — Verify operator pickup by a new vault

When a vault depositor creates a vault and picks your executor wallet:

1. Frontend submits `factory.createVault(...)` → emits a `VaultDeployed` event
2. The orchestrator's `vaultEventListener` (30s poll) detects the event → adds the vault to the `vault-index.json` cache
3. The next cycle (max 5 min) → log:

```
[time] INFO  Indexer: 1 vault(s) assigned to 1 executor wallet(s)
[time] INFO  Fetching market data...
[time] INFO    ── Vault 0xABCDEF...123456 ──
[time] INFO    Operator: <your_name> · None · stake $1 · rep 0x (0% success)
[time] INFO    NAV: $X | Base: $X | Paused: false | Actions: 0 | Position: flat
[time] INFO    Strategy: <strategy.id> hash=0x... v1     ← if you published a manifest
[time] INFO    Context asset: 0G | Regime: ... | RSI: ...
[time] INFO    Requesting AI assessment from 0G Compute...
[time] INFO    Decision: HOLD/BUY/SELL <asset> | Edge: X | Source: 0g-compute + engine-v1
```

If the policy gate passes → tx is submitted → `IntentExecuted` event is emitted on the vault.

**Inspect via the API:**

```bash
curl "http://localhost:4002/api/journal/decisions?vault=0xABCDEF...&limit=5" | jq .
curl "http://localhost:4002/api/journal/executions?vault=0xABCDEF...&limit=5" | jq .
```

---

## Step 9 — Trigger a manual cycle (for demos / debugging)

Default: a cycle every 5 minutes. To force a cycle now:

```bash
curl -X POST http://localhost:4002/api/cycle \
  -H "x-api-key: $ORCHESTRATOR_API_KEY"
```

Without the API key, mutation routes only accept requests from `localhost:127.0.0.1` (loopback only). Production setup: configure the API key + restrict CORS.

---

## Step 10 — Health monitoring

| Metric | How to check | Alert when |
|---|---|---|
| Executor wallet balance | `cast balance <executor> --ether --rpc-url $RPC` | < 0.5 0G (≈10× average cycle gas) |
| 0G Compute ledger | `/api/og-compute/ledger` (if exposed) | < 1 0G — refill via `addToLedger` |
| Orchestrator API | `curl /api/health` | non-200 exit or timeout > 5s |
| Cycle freshness | `/api/status` → `cycleCount` | hasn't increased in 2× the cycle interval (= 10 min) |
| Reputation success rate | on-chain via `OperatorReputation` | drops below 80% |
| RPC `0G mainnet` | response time | consistently > 3s — switch primary RPC |

For dashboards, [`docs/OPERATOR_GUIDE.md`](OPERATOR_GUIDE.md) describes a Grafana setup.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `0G Compute: Insufficient balance` at boot | Executor wallet has < 3 0G to init the ledger | Top up the wallet to ≥ 5 0G |
| `Vault indexer ready — 0 cached vault(s)` persists | No vault has picked your executor yet | Normal — wait for a depositor |
| `Indexer poll failed: request timeout` in logs | 0G RPC slow during event polling | Not fatal — the main loop continues; consider a secondary RPC |
| `Strategy load failed (StrategyHashMismatch)` | The manifest URI serves content that differs from the on-chain hash | Re-upload the file consistent with the URI, or `publishManifest` again with the correct hash |
| `Strategy load failed (StrategyFetchError)` | URI is unreachable | Check that the IPFS gateway or GitHub raw URL responds |
| `WrongStrategyHash` revert on `executeIntent` | V4 vault accepted hash X, manifest now publishes hash Y | Owner must `requestManifestUpgrade(Y)` → wait 24h → `applyManifestUpgrade()` |
| `OnlyExecutor` revert | The vault's `policy.executor` ≠ the address derived from the orchestrator's `PRIVATE_KEY` | Verify the vault's `executor()` view; rotate via `setExecutor` if needed |
| `AutoExecutionDisabled` revert | Vault owner has set `policy.autoExecution = false` | Owner must enable it via `updatePolicy` |
| `IntentVaultMismatch` revert | Intent's `vault` field ≠ the vault address it was called on | Bug — open an issue with the tx hash + journal entry |
| Decision is always `HOLD` | Confidence threshold too high, or no market regime fit | Vault owner can lower `confidenceThresholdBps` to 3000 (for a demo) |
| A cycle takes > 30s for a single vault | RPC latency or slow 0G Compute responses | Inspect the 0G Compute provider endpoint; consider switching models |

---

## Cross-references

- **Registration form data** (name, fees, mandate copy, recommended policy values): [`OPERATOR_REGISTRATION_KIT.md`](../OPERATOR_REGISTRATION_KIT.md)
- **Decentralization story + scaling guide** (multi-wallet pool, multi-instance): [`docs/OPERATOR_GUIDE.md`](OPERATOR_GUIDE.md)
- **Strategy manifest schema spec**: [`docs/STRATEGY_MANIFEST.md`](STRATEGY_MANIFEST.md)
- **AI decision flow**: [`docs/AI_AGENT_DECISION_FLOW.md`](AI_AGENT_DECISION_FLOW.md)
- **V4 manifest binding & timelock**: [`docs/V4_MIGRATION_GUIDE.md`](V4_MIGRATION_GUIDE.md)
- **Live address book**: [`contracts/deployments-mainnet.json`](../contracts/deployments-mainnet.json)

---

## Quick reference — 0G Aristotle contracts (chain 16661)

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

> **V4 (strategy-binding):** `aegisVaultFactoryV4` is the live default once `contracts/scripts/deploy-v4.js` has run; the address is written to `deployments-mainnet.json` and auto-surfaced to the frontend via `sync-frontend.js`. The orchestrator auto-detects it — no extra env var needed.
