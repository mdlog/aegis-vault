# Operator Guide — Run Your Own Aegis Vault Orchestrator

This guide is for **operators**: anyone who wants to offer AI-managed trading services to vault owners on Aegis Vault. You run your own orchestrator instance, users subscribe by setting you as their `vault.executor`, and you earn operator fees on every successful execution.

This is the decentralization story for Aegis Vault: there is no single orchestrator. Every operator runs their own, each orchestrator only manages the vaults that selected it as executor, and the marketplace makes operators competitive on reputation, fees, and strategy.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│   0G Chain (mainnet, chain 16661)                               │
│                                                                 │
│   AegisVaultFactory ──creates──▶  Vault A (executor = Alice)    │
│                                   Vault B (executor = Bob)      │
│                                   Vault C (executor = Alice)    │
│                                   Vault D (executor = Carol)    │
└─────────────────────────────────────────────────────────────────┘
        │                             │                  │
        │ VaultDeployed event          │                  │
        ▼                             ▼                  ▼
┌─────────────────┐          ┌─────────────────┐  ┌─────────────────┐
│ Alice's         │          │ Bob's           │  │ Carol's         │
│ orchestrator    │          │ orchestrator    │  │ orchestrator    │
│                 │          │                 │  │                 │
│ Manages A + C   │          │ Manages B       │  │ Manages D       │
│ (only her own)  │          │                 │  │                 │
└─────────────────┘          └─────────────────┘  └─────────────────┘
```

Every orchestrator runs the **same code**. What makes them different:

- Their **executor wallet address(es)** (set via `EXECUTOR_PRIVATE_KEYS`)
- Their **TEE signer key** (for sealed-mode vaults)
- Their **operator profile** on-chain (`OperatorRegistry`) — name, declared fees, recommended policy

The vault owner decides which operator to use by selecting them at vault creation (or later via `updatePolicy`). The operator earns 80% of every fee their vaults generate; the protocol treasury gets 20%.

---

## Prerequisites

- Node.js 20+
- Linux/macOS dev machine or small VPS (4GB RAM, 20GB disk is plenty)
- 0G mainnet wallet with ~2 0G for gas + at least 1 0G for 0G Compute ledger top-ups
- 0G Compute ledger account (created automatically on first orchestrator start)

---

## Step 1 — Register as an Operator (on-chain)

Your executor wallet needs an on-chain identity in `OperatorRegistry`:

```bash
# From the frontend at /operator/register, or call directly:
cast send 0x<OperatorRegistryAddress> \
  "register(string,uint256,uint256,uint256,uint256,address)" \
  "Alice's Yield Desk" \        # display name
  1500 \                         # performanceFeeBps (15%)
  200 \                          # managementFeeBps (2%/year)
  0 \                            # entryFeeBps
  50 \                           # exitFeeBps (0.5%)
  <your-fee-recipient-wallet> \
  --rpc-url https://evmrpc.0g.ai \
  --private-key $PRIVATE_KEY
```

Recommended: also stake in `OperatorStaking` to unlock higher tier caps:

| Tier | Stake | Max Vault NAV |
|------|-------|---------------|
| None | 0 | $5k |
| Bronze | $1k | $50k |
| Silver | $10k | $500k |
| Gold | $100k | $5M |
| Platinum | $1M | Unlimited |

Slashing is governed by `AegisGovernor` (M-of-N multi-sig). Only slashed if you execute against policy or go rogue.

---

## Step 2 — Clone and Configure

```bash
git clone https://github.com/mdlog/aegis-vault.git
cd aegis-vault/orchestrator
npm install --legacy-peer-deps

cp .env.example .env
```

Edit `.env`:

```bash
# Network
RPC_URL=https://evmrpc.0g.ai
CHAIN_ID=16661

# Primary signer (single-wallet mode)
PRIVATE_KEY=<your-executor-private-key>

# OR: multi-wallet pool (production mode — recommended for >10 vaults)
# Comma-separated list of executor private keys. Vaults are sharded
# deterministically across these wallets to avoid nonce collisions.
# EXECUTOR_PRIVATE_KEYS=0xkey1,0xkey2,0xkey3

# Sealed-mode TEE signer (separate key from executor for defence-in-depth)
TEE_SIGNER_PRIVATE_KEY=<separate-tee-signer-key>

# Deployments (same on every operator's orchestrator)
DEPLOYMENTS_FILE=../contracts/deployments-mainnet.json

# 0G Compute
OG_COMPUTE_RPC=https://evmrpc.0g.ai
OG_COMPUTE_PRIVATE_KEY=<compute-wallet-key>   # can reuse PRIVATE_KEY
OG_COMPUTE_MODEL=zai-org/GLM-5-FP8

# Performance tuning
VAULT_CONCURRENCY=5               # parallel vault cycles (default 5)
CYCLE_INTERVAL_MINUTES=5
STRICT_MODE=0                      # 1 = abort on 0G Storage failures (prod)
CORS_ALLOWED_ORIGINS=https://your-operator-dashboard.com
PORT=4002
```

---

## Step 3 — Run

```bash
npm start
```

What happens:

1. **Backfill**: indexer scans `factory.allVaults()` into a local SQLite cache (one-time, O(N))
2. **Event subscription**: indexer polls `VaultDeployed` events every 15s (O(1) per cycle afterwards)
3. **Cycle loop**: every `CYCLE_INTERVAL_MINUTES`, orchestrator queries SQLite for vaults where `executor IN (pool addresses)`, then processes them in parallel (bounded by `VAULT_CONCURRENCY`)
4. **Per-vault**: read state → 0G Compute inference → policy check → submit intent → on sealed-mode, run commit-reveal with TEE signature

Log lines to watch for:
- `Indexer: N vault(s) assigned to M executor wallet(s)` — discovery succeeded
- `Executor pool size: N` — wallet pool initialized
- `Submitting SEALED intent 0x...` — sealed-mode flow firing
- `Intent submitted. TX: 0x...` — on-chain execution confirmed

---

## Scaling Up

| Vault count | Recommended config |
|-------------|-------------------|
| 1–10 | Single wallet, `VAULT_CONCURRENCY=3` |
| 10–100 | Pool of 3 wallets, `VAULT_CONCURRENCY=5` |
| 100–1000 | Pool of 5–10 wallets, `VAULT_CONCURRENCY=10`, separate 0G Storage instance |
| 1000+ | Run multiple orchestrator instances, each responsible for a wallet-pool subset |

The wallet pool uses **deterministic sharding**: `hash(vaultAddress) % poolSize`. This means:

- A vault always maps to the same wallet → stable nonce sequences
- Load distributes evenly across the pool
- Adding a wallet requires re-sharding (migration work — document it when scaling)

---

## Multi-Instance Horizontal Scaling

For 1000+ vaults you can run several orchestrator processes, each managing a different wallet-pool subset:

```
Orchestrator A:  EXECUTOR_PRIVATE_KEYS=wallet1,wallet2      (vaults sharded 0,1)
Orchestrator B:  EXECUTOR_PRIVATE_KEYS=wallet3,wallet4      (vaults sharded 2,3)
Orchestrator C:  EXECUTOR_PRIVATE_KEYS=wallet5              (vaults sharded 4)
```

Each instance indexes independently (SQLite is per-instance). If two instances claim the same wallet, `NonceManager` makes tx submission serial but still correct — avoid this in production to reduce lock contention.

---

## Operator Economics

For every successful execution on a vault that selected you as executor:

- **80% of fees → your `feeRecipient` wallet**
- **20% → ProtocolTreasury**

Fees are streaming (continuous accrual for management fee) + event-based (performance on profit above HWM, entry/exit on deposits/withdrawals). Claim anytime via `vault.claimFees()`.

---

## Security Checklist

- [ ] Private keys stored in a secrets manager (not plaintext `.env` on shared VPS)
- [ ] `TEE_SIGNER_PRIVATE_KEY` **different** from `PRIVATE_KEY` (defense in depth)
- [ ] `CORS_ALLOWED_ORIGINS` restricts API to your dashboard only
- [ ] `STRICT_MODE=1` in production (0G Storage must be available, no silent fallbacks)
- [ ] Regular key rotation — plan for rotating executor + TEE signer every 90 days
- [ ] Rate limit your dashboard on `/api/cycle` endpoint (DoS vector)
- [ ] Monitor operator wallet balance alerts (low gas = missed cycles = reputation hit)

---

## Reputation

Every successful execution on your vaults updates your stats in `OperatorReputation`:

- `totalExecutions` — volume you've managed
- `successfulExecutions` — good swaps (non-zero `amountOut`)
- `successRateBps` — success / total
- `averageRatingScaled` — user 1-5 star ratings
- `verified` — badge granted by governance after audit

Users browse `/marketplace` sorted by these metrics. Higher reputation = more vault assignments = more fees. Lose your reputation via bad executions and you'll see vaults migrate to competitors.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "Indexer backfill: 0 vaults" | Factory has no vaults yet | Wait for first user to create vault |
| "Executor pool size: 1" but expected >1 | `EXECUTOR_PRIVATE_KEYS` not set | Add comma-separated keys to `.env` |
| "nonce too low" after adding wallet | Shard rebalance moved a vault to new wallet | Restart orchestrator (NonceManager syncs from chain) |
| "TEE signer mismatch" | `TEE_SIGNER_PRIVATE_KEY` doesn't produce `vault.policy.attestedSigner` | Rotate signer key OR update vault policy attestedSigner |
| Cycles skip vaults intermittently | RPC timeouts | Use a dedicated 0G RPC node or switch to `https://evmrpc-turbo.0g.ai` |
| 0G Compute "Cannot read properties of undefined" | Legacy `promptBuilder` bug | Update to latest orchestrator code |

---

## Support

- GitHub issues: https://github.com/mdlog/aegis-vault/issues
- Governance proposals: `/governance` on the dApp
- Operator Discord: <coming soon>
