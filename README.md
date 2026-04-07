<p align="center">
  <img src="aegis-vault-logo.png" alt="Aegis Vault" width="480" />
</p>

<p align="center">
  <strong>Verifiable AI Risk Manager with Autonomous Execution Guardrails on 0G</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Solidity-363636?style=for-the-badge&logo=solidity&logoColor=white" alt="Solidity" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Ethers.js-2535A0?style=for-the-badge&logo=ethereum&logoColor=white" alt="Ethers.js" />
  <img src="https://img.shields.io/badge/Hardhat-FFF100?style=for-the-badge&logo=hardhat&logoColor=black" alt="Hardhat" />
  <img src="https://img.shields.io/badge/OpenZeppelin-4E5EE4?style=for-the-badge&logo=openzeppelin&logoColor=white" alt="OpenZeppelin" />
</p>

> AI-managed, risk-controlled trading vault on 0G — now with **operator economics, skin-in-the-game staking, on-chain reputation, and multi-sig governance**. Users deposit, pick an operator from the marketplace, and let on-chain rules enforce every action. The AI proposes. The contract enforces. Every fee, slash, and rating is auditable.

---

## What's New — Production Stack (Phase 1-5)

Aegis Vault graduated from an MVP demo to a full production-grade protocol. Five phases, 135 contract tests, all green.

| Phase | Scope | Contracts | Tests |
|---|---|---|---|
| **1. Foundation** | Fee system (HWM, perf / mgmt / entry / exit), ProtocolTreasury, 80/20 operator-treasury split, 7-day fee change cooldown, multi-asset NAV via Pyth | `AegisVault`, `AegisVaultFactory`, `ProtocolTreasury`, `OperatorRegistry`, `VaultNAVCalculator` | 40 |
| **2. Stake & Slashing** | Operator staking with 4 tiers (Bronze → Platinum), tier-gated vault caps, 14-day unstake cooldown, freeze / slash arbitration, insurance pool | `OperatorStaking`, `InsurancePool` | 22 |
| **3. Reputation & Discovery** | On-chain execution stats (volume, PnL, success), 1-5 star ratings, verified operator badge, marketplace sort by reputation | `OperatorReputation` | 15 |
| **4. Governance** | M-of-N multi-sig governor, proposal lifecycle, slashing arbitration + treasury spending via on-chain proposals, owner rotation via self-call | `AegisGovernor` | 18 |
| **5. Production Hardening** | Reputation auto-recording from vault executions (`setReputationRecorder`), unified `deploy-all.js`, end-to-end integration test | — | 40 |

**Economic model**

- Performance fee: 15% default (max 30%) — charged only on net-new profit above high-water mark
- Management fee: 2%/year default (max 5%) — streamed continuously on NAV
- Entry / exit fees: 0% / 0.5% default (max 2% each)
- Every fee dollar: **80% to operator, 20% to protocol treasury**
- Protocol treasury funds: audits, grants, insurance pool top-ups

**Skin-in-the-game tiers (USDC stake → max vault size)**

| Tier | Stake | Max Vault NAV |
|---|---|---|
| None | $0 | $5k |
| Bronze | $1k | $50k |
| Silver | $10k | $500k |
| Gold | $100k | $5M |
| Platinum | $1M | Unlimited |

Slashing: up to 50% of stake per governance action. Slashed funds flow to the insurance pool, which pays claims to damaged vault owners after arbitration.

---

## 0G Stack Integration

| Layer | What It Does |
|---|---|
| **0G Chain (Galileo testnet 16602)** | 11 Solidity contracts — vault custody, fee system, operator staking, reputation, multi-sig governance |
| **0G Compute** | Real AI inference via `GLM-5-FP8` on mainnet — decentralized, verifiable reasoning + structured JSON output |
| **0G Storage** | KV state snapshots + blob upload — decision journal, execution reports, strategy memory |
| **Pyth Network** | Multi-asset NAV oracle for fee accrual on vaults holding BTC/ETH/USDC |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         User / Frontend (React)                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │ Marketplace│  │ Create     │  │ Vault      │  │ Governance │    │
│  │ + ratings  │  │ Vault      │  │ Detail     │  │ Dashboard  │    │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ wagmi + viem
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        0G Chain (Galileo 16602)                     │
│                                                                      │
│  ┌─────────────────┐         ┌──────────────────────────────────┐  │
│  │ AegisVault      │◄────────│ OperatorRegistry                 │  │
│  │ - policy enforcer        │ - declared fees                  │  │
│  │ - fee accrual (HWM)      │ - recommended policy             │  │
│  │ - execution gateway      └──────────────────────────────────┘  │
│  └────┬────────────┘                                                │
│       │                                                              │
│       │  records stats                                               │
│       ▼                                                              │
│  ┌──────────────────┐       ┌──────────────────┐                   │
│  │OperatorReputation│       │ ProtocolTreasury │                   │
│  │ - execution log  │       │ - 20% fee cut    │                   │
│  │ - ratings        │       │ - grants / audit │                   │
│  │ - verified badge │       └──────────────────┘                   │
│  └──────────────────┘                                                │
│                                                                      │
│  ┌──────────────────┐       ┌──────────────────┐                   │
│  │ OperatorStaking  │──slash│ InsurancePool    │                   │
│  │ - tier caps      │──────▶│ - user claims    │                   │
│  │ - 14d cooldown   │       │ - payout via gov │                   │
│  │ - freeze/unfreeze│       └──────────────────┘                   │
│  └────────┬─────────┘                                                │
│           │ admin                                                    │
│           ▼                                                          │
│  ┌──────────────────────────────────────┐                           │
│  │ AegisGovernor (M-of-N multi-sig)     │                           │
│  │ - slashing arbitration               │                           │
│  │ - treasury spend                     │                           │
│  │ - verified badge grants              │                           │
│  │ - owner rotation (self-call)         │                           │
│  └──────────────────────────────────────┘                           │
└──────────────────────────────────────────────────────────────────────┘
                               ▲
                               │ executeIntent() / read state
                               │
┌──────────────────────────────┴───────────────────────────────────────┐
│                    Strategy Orchestrator (Node.js)                   │
│   ├── 0G Compute (GLM-5-FP8 inference)                              │
│   ├── Market data (CoinGecko + Pyth)                                │
│   ├── Decision Engine v1 (8 regimes, 15 veto rules)                 │
│   ├── Operator tier cap + frozen guard                              │
│   ├── Policy pre-check → intent build → submit                      │
│   └── 0G Storage (journal, decisions, executions)                   │
└──────────────────────────────────────────────────────────────────────┘
```

**End-to-end flow:**
1. Operator registers in `OperatorRegistry` with declared fees + recommended policy
2. Operator stakes USDC in `OperatorStaking` to unlock a vault-size tier
3. User browses `/marketplace`, picks an operator (sorted by reputation / tier / fees)
4. User creates vault in `/create` — fee preview auto-filled from operator profile
5. User deposits → entry fee charged (80/20 split) → vault base balance funded
6. Orchestrator cycle runs:
   - Reads vault + operator state
   - Checks `TIER_CAP_EXCEEDED` / `OPERATOR_FROZEN` eligibility
   - Queries 0G Compute for AI decision
   - Runs Decision Engine v1 (regime classifier + vetos)
   - Policy pre-check → builds intent → submits via `executeIntent()`
7. `AegisVault.executeIntent()`:
   - Validates intent hash + policy
   - Executes swap via `JaineVenueAdapter` (or `MockDEX` on testnet)
   - Calls `reputationRecorder.recordExecution()` to log stats
   - Finalizes with `ExecutionRegistry`
8. Fees accrue continuously (mgmt) and on profit above HWM (perf)
9. Operator claims fees → 80% to operator wallet, 20% to protocol treasury
10. Bad actor? Governance proposal: `freeze` → `slash` → `payoutClaim` from insurance pool

---

## Smart Contracts

Current testnet deployment (0G Galileo, chain 16602):

| Contract | Role |
|---|---|
| `AegisVaultFactory` | Deploys new vault clones, wires treasury |
| `AegisVault` | Per-user vault (custody + policy + fees + execution) |
| `ExecutionRegistry` | Intent replay guard + execution history |
| `ProtocolTreasury` | Collects 20% protocol cut, admin-gated spending |
| `OperatorRegistry` | Operator directory with declared fees + recommendations |
| `OperatorStaking` | Tiered stake escrow + slashing + cooldown |
| `InsurancePool` | Slashed-fund custody + arbitrator-gated payouts |
| `OperatorReputation` | On-chain execution stats + ratings + verified badge |
| `AegisGovernor` | M-of-N multi-sig governance |
| `VaultNAVCalculator` | Pyth-backed multi-asset NAV pricing |
| `JaineVenueAdapter` | Uniswap V3 fork router (mainnet Jaine) |

After running `deploy-all.js`, addresses auto-sync into `frontend/src/lib/contracts.js` and `orchestrator/.env`.

**Security invariants:**
- AI has **zero authority** — can only propose intents, vault enforces
- Executor can never withdraw or pause
- Single-use intent hashes (replay-proof)
- Fee caps hard-coded in `AegisVault` (users protected even if owner misconfigures)
- 7-day fee change cooldown (operator can't surprise-raise fees)
- All slashing + treasury spending requires M-of-N governance approval

See [ARCHITECTURE.md](ARCHITECTURE.md) for full economic model, state diagrams, and failure mode analysis.

---

## Quick Start

```bash
# 1. Compile + test contracts
cd contracts && npm install
npx hardhat test                 # 135 tests passing

# 2. Deploy full stack (Phase 1-5)
DEPLOYER_PRIVATE_KEY=<key> npx hardhat run scripts/deploy-all.js --network og_testnet
node scripts/sync-frontend.js    # auto-updates frontend addresses

# 3. Start orchestrator (port 4002)
cd ../orchestrator && npm install --legacy-peer-deps
cp .env.example .env && edit .env
npm start

# 4. Start frontend (port 5173)
cd ../frontend && npm install && npm run dev
```

**MetaMask:** RPC `https://evmrpc-testnet.0g.ai` · Chain ID `16602` · Symbol `0G`

**Deploy options** (production mode with multi-sig):
```bash
GOVERNOR_OWNERS="0xaaa,0xbbb,0xccc" \
GOVERNOR_THRESHOLD=2 \
TRANSFER_ADMINS=1 \
  npx hardhat run scripts/deploy-all.js --network og_testnet
```

---

## Project Structure

```
0g-chain/
├── contracts/                  11 Solidity contracts (Hardhat 2.28 + OpenZeppelin)
│   ├── contracts/              *.sol
│   ├── test/                   135 tests (6 suites)
│   └── scripts/
│       ├── deploy-all.js       Unified Phase 1-5 deployment
│       ├── deploy-phase1..5.js Per-phase deployment
│       └── sync-frontend.js    Address propagation to frontend
├── orchestrator/               Node.js — AI inference + policy pre-check + execution
│   └── src/services/
│       ├── vaultReader.js      Reads vault state (NAV, policy, fees)
│       ├── operatorReader.js   Reads stake tier + reputation (Phase 2-5)
│       ├── decisionEngine.js   Regime classifier + 15 veto rules
│       ├── inference.js        0G Compute GLM-5-FP8 client
│       └── orchestrator.js     Main cycle loop
└── frontend/                   React 19 + Vite + Tailwind + wagmi
    └── src/
        ├── pages/
        │   ├── LandingPage, DashboardPage, VaultDetailPage
        │   ├── CreateVaultPage, OperatorMarketplacePage
        │   ├── OperatorProfilePage, OperatorRegisterPage
        │   └── GovernancePage       M-of-N proposal UI
        └── hooks/
            ├── useVault.js           core vault + deposit + withdraw
            ├── useVaultFees.js       fee accrual + claim (Phase 1)
            ├── useOperatorStaking.js stake + tier + freeze (Phase 2)
            ├── useOperatorReputation.js stats + ratings + verified (Phase 3)
            └── useGovernor.js        proposals + ProposalBuilders (Phase 4)
```

---

## Test Results

```
Smart contracts    135 / 135 passing  (Phase 1-5 full stack)
Frontend build     3219 modules, 1.19 MB gzipped, clean
E2E lifecycle      ✓ create → deposit → execute → accrue → claim
                   ✓ stake → slash via gov → insurance payout
Security audit     4 critical + 6 high fixed (Phase 0 audit)
```

---

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — economic model, state diagrams, threat model
- [DEMO.md](DEMO.md) — step-by-step walkthrough for judges / demos
- [Aegis_Vault_0G_Architecture.md](Aegis_Vault_0G_Architecture.md) — original 0G integration design
- [Aegis_Vault_Decision_Matrix_v1.md](Aegis_Vault_Decision_Matrix_v1.md) — Decision Engine v1 spec

---

## License

MIT
