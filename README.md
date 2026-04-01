<p align="center">
  <img src="aegis-vault-logo.png" alt="Aegis Vault" width="480" />
</p>

<p align="center">
  <strong>Verifiable AI Risk Manager with Autonomous Execution Guardrails on 0G</strong>
</p>

> Aegis Vault is an AI-managed, risk-controlled trading vault built on the 0G stack. Users deposit assets, define strict on-chain risk mandates, and let an AI agent manage execution within those limits. The AI proposes. The contract enforces. Every action is auditable.

---

## Problem

DeFi and on-chain trading suffer from five core issues:

1. **Bot trading is untrustworthy** -- logic runs off-chain with no binding guardrails.
2. **Strategies leak easily** -- signals and parameters sit in plain backends.
3. **Manual trading lacks discipline** -- risk management is violated under pressure.
4. **Unconstrained autonomous agents are dangerous** -- no hard limits means catastrophic loss.
5. **AI decisions are un-auditable** -- reasoning stored on private servers cannot be verified.

## Solution

Aegis Vault solves these by combining:

- **Real AI inference via 0G Compute** -- decentralized inference on GLM-5-FP8 model, verifiable on-chain.
- **On-chain policy enforcement** -- 12 risk rules locked in smart contracts, not config files.
- **Authorized execution only** -- trades pass through a whitelisted executor with single-use intent hashes.
- **Permanent audit trail** -- every decision and outcome recorded to 0G Storage.
- **Real DEX integration ready** -- JaineVenueAdapter for Jaine DEX (0G's native AMM), modular venue swap.
- **User emergency authority** -- vault owner can pause, withdraw, and override at any time.

---

## 0G Stack Integration

Aegis Vault uses **all three core layers** of the 0G stack:

| Layer | Integration | What It Does |
|---|---|---|
| **0G Chain** | 8 Solidity contracts deployed on Galileo Testnet (16602) | Vault custody, policy enforcement, executor authorization, on-chain swap execution, event emission |
| **0G Compute** | `@0glabs/0g-serving-broker` SDK on **Mainnet** (16661) | Real AI inference via `GLM-5-FP8` model. Decentralized, verifiable. Reasoning chain + structured JSON output. |
| **0G Storage** | `@0glabs/0g-ts-sdk` KV store + blob upload | Mutable vault state snapshots, append-only decision journal, execution reports |

### 0G Compute — Live on Mainnet

The orchestrator connects to 0G Compute **Mainnet** for AI inference:

```
Wallet: 0xDB13C2dE3CD57d529CeA16E8EE6ae53a498b878D
Ledger: 6 0G deposited
Model:  zai-org/GLM-5-FP8 (reasoning-capable chatbot)
Status: LIVE — source: "0g-compute"
```

Available mainnet models (auto-discovered from on-chain registry):
- `zai-org/GLM-5-FP8` — Primary, best reasoning
- `deepseek/deepseek-chat-v3-0324` — DeepSeek V3
- `openai/gpt-oss-120b` — GPT-class 120B
- `qwen/qwen3-vl-30b-a3b-instruct` — Vision + text

### Why This Fits Track 2

Track 2 focuses on *"intelligent yield optimizers, risk-management bots, AI-driven perpetual strategy agents"*. Aegis Vault is a risk-management agent that uses real decentralized AI inference for decisions, enforces policy on-chain, and executes swaps through a modular venue adapter (MockDEX/Jaine DEX).

---

## Architecture

```
User (Owner)
  |
  v
Frontend Dashboard (React + Tailwind + wagmi)
  |- Create Vault (6-step wizard → factory.createVault on-chain)
  |- Deposit (multi-token: USDC via deposit(), WBTC/WETH via transfer)
  |- Withdraw, Pause, Edit Policy, Set Executor
  |- Platform Overview: all vaults on-chain, per-vault Pyth NAV
  |- Vault Detail: allocation, AI journal, risk timeline, controls
  |- AI Actions: real-time intelligence feed from orchestrator
  |- Journal: complete audit trail with filters
  |
  v
AegisVault Contract (0G Chain — Galileo Testnet 16602)
  |- Deposit / Withdraw / Emergency Withdraw
  |- Policy Storage (VaultPolicy struct)
  |- On-chain Policy Enforcement (PolicyLibrary — 12 rules)
  |- Intent Hash Verification (recomputed on-chain, abi.encode)
  |- Executor Authorization (whitelisted address only)
  |- On-chain Swap Execution (approve → venue.swap → verify balanceOf delta)
  |- Auto-finalize in ExecutionRegistry (single-use, replay-protected)
  |- Event Emission (IntentSubmitted, IntentExecuted, IntentBlocked, RiskThresholdBreached)
  |
  v
Strategy Orchestrator (Node.js Backend)
  |- Market Data: CoinGecko prices + Pyth Hermes real-time oracle
  |- AI Inference: 0G Compute Mainnet (GLM-5-FP8) + local fallback
  |- Policy Pre-check: 10 off-chain rules (saves gas)
  |- Intent Builder: struct + abi.encode hash
  |- Executor: submits to vault contract, 7 custom error decoders
  |- Pyth NAV Calculator: multi-asset NAV per vault (USDC + WBTC + WETH)
  |- 16 REST API endpoints
  |
  v
DEX Venue
  |- MockDEX (testnet — fixed-rate swaps for demo)
  |- JaineVenueAdapter (mainnet-ready — wraps Jaine DEX Uniswap V3 Router)
  |    Jaine Router:  0x8b598a7c136215a95ba0282b4d832b9f9801f2e2
  |    Jaine Factory: 0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4
  |
  v
0G Storage
  |- KV State: vault-state snapshot (mutable, latest)
  |- Blob Upload: decision snapshots, execution reports, journal batches (immutable)
  |- Local File Fallback: data/kv-state.json + data/journal.json
```

---

## Smart Contracts

8 Solidity files, compiled with Solidity 0.8.24 + OpenZeppelin.

| Contract | Lines | Purpose |
|---|---|---|
| `AegisVault.sol` | ~400 | Core vault — deposit, withdraw, executeIntent (with on-chain swap), recordExecution, pause/unpause, updatePolicy, setExecutor, setVenue |
| `AegisVaultFactory.sol` | ~90 | Factory — deploys vaults, auto-authorizes in ExecutionRegistry |
| `ExecutionRegistry.sol` | ~140 | Intent tracking — replay prevention, access control, result storage |
| `PolicyLibrary.sol` | ~170 | 9 pure validation functions + `validateAll()` |
| `VaultEvents.sol` | ~75 | Shared structs (3) + events (14) |
| `JaineVenueAdapter.sol` | ~250 | Adapter for Jaine DEX (Uniswap V3 SwapRouter) — auto pool discovery, liquidity check, slippage protection |
| `MockDEX.sol` | ~190 | Test DEX — fixed-rate pair swaps |
| `MockERC20.sol` | ~20 | Test token with free mint |

### Deployed Contracts (0G Galileo Testnet — Chain 16602)

| Contract | Address |
|---|---|
| ExecutionRegistry | `0xDF277f39d4869B1a4bb7Fa2D25e58ab32E2af998` |
| AegisVaultFactory | `0x2A0CAA1d639060446fA1bA799b6B64810B5B4aff` |
| MockUSDC | `0xcb7F4c52f72DA18d27Bc18C4c3f706b6ba361BC1` |
| MockWBTC | `0x0d8C28Ad2741cBec172003eee01e7BD97450b5A9` |
| MockWETH | `0x339d0484699C0E1232aE0947310a5694B7e0E03A` |
| MockDEX | `0x8eeF4E72ec2ff6f9E00a6D2029bEcB8FcB2f03E6` |
| Demo Vault | `0xFFac2840f762b6003Ce291bd5B19c2890Ea5DAB2` |
| MockPyth | `0x7314DC59aD5A6Da1Ac65B3605B5509cC8Ab8FbC0` |
| VaultNAVCalculator | `0x60e28cA62111096AD063FB712848d60F625E6f85` |

### On-Chain Policy Rules (12 rules enforced at contract level)

| # | Rule | Enforcement |
|---|---|---|
| 1 | Max position size per trade | `intentAmountIn * 10000 / vaultValue <= maxPositionBps` |
| 2 | Max daily loss limit | `currentDailyLossBps <= maxDailyLossBps` |
| 3 | Cooldown between executions | `block.timestamp >= lastExecutionTime + cooldownSeconds` |
| 4 | Asset whitelist | Both `assetIn` and `assetOut` must be in `allowedAssets[]` |
| 5 | AI confidence threshold | `intentConfidenceBps >= confidenceThresholdBps` |
| 6 | Global stop-loss | `abs(cumulativePnl) / totalDeposited >= stopLossBps` |
| 7 | Daily action count limit | `dailyActionCount < maxActionsPerDay` |
| 8 | Pause state | `policy.paused == false` required |
| 9 | Intent expiry | `block.timestamp <= expiresAt` |
| 10 | Auto-execution flag | `policy.autoExecution == true` required |
| 11 | Intent hash verification | Hash recomputed on-chain via `keccak256(abi.encode(...))` (C-3 fix) |
| 12 | Vault address validation | `intent.vault == address(this)` prevents cross-vault attacks (C-4 fix) |

### Security Model

| Protection | Implementation |
|---|---|
| AI never holds authority | AI proposes structured JSON; contract enforces all limits |
| Executor ≠ Owner | Executor can only `executeIntent()`; cannot withdraw, pause, or change policy |
| Replay prevention | Single-use intent hashes in `ExecutionRegistry` |
| Swap verification | `balanceOf` snapshot before/after swap; `forceApprove` reset to 0 after every call |
| Emergency authority | Owner can pause instantly; `emergencyWithdraw` available when paused |
| JaineVenueAdapter | ReentrancyGuard, pool liquidity check, fee tier cap, token validation, rescue function |

---

## Orchestrator Backend

Node.js service that connects market data, AI inference, and smart contracts.

| Service | File | Function |
|---|---|---|
| Main Loop | `orchestrator.js` | Cron-scheduled cycle: market → inference → policy → execute → record |
| Market Data | `marketData.js` | CoinGecko prices + Pyth Hermes real-time oracle |
| AI Inference | `inference.js` | 0G Compute (mainnet GLM-5-FP8) + local deterministic fallback |
| 0G Compute | `ogCompute.js` | Full `@0glabs/0g-serving-broker` SDK: broker init, service discovery, auth headers, inference call, response verification |
| Pyth Prices | `pythPrice.js` | Pyth Hermes API for real-time BTC/ETH/USDC prices + multi-asset NAV calculation |
| Prompt Builder | `promptBuilder.js` | System prompt + user prompt + JSON parser (handles 0-100 and 0-1 confidence scales) |
| Policy Pre-check | `policyCheck.js` | 10 off-chain rules mirroring on-chain logic |
| Executor | `executor.js` | Intent builder, hash computation, contract submission, 7 custom error decoders |
| Vault Reader | `vaultReader.js` | Reads `getVaultSummary()`, `getPolicy()`, `getAllowedAssets()` from chain |
| Storage | `storage.js` | Dual persistence: local file + 0G Storage |
| 0G Storage | `ogStorage.js` | Full `@0glabs/0g-ts-sdk` wrapper: KV + blob |

### AI Decision Output (from 0G Compute GLM-5-FP8)

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

### API Endpoints (16)

```
GET  /api/health              Health check
GET  /api/status              Orchestrator status + 0G Compute info
POST /api/cycle               Trigger manual AI cycle
GET  /api/vault               Live vault state from chain
GET  /api/market              Market prices (CoinGecko)
GET  /api/market/summary      Prices + volatility + summary
GET  /api/pyth/prices          Real-time Pyth Hermes prices (BTC, ETH, USDC)
GET  /api/nav?vault=<addr>    Multi-asset NAV for specific vault (Pyth + on-chain balances)
GET  /api/state               Local KV state snapshot
GET  /api/journal             All journal entries (filterable by ?type=)
GET  /api/journal/decisions   AI decision log
GET  /api/journal/executions  Execution results log
GET  /api/og/status           0G Storage connection status
GET  /api/og/state            Vault state from 0G KV store
GET  /api/og/kv/:key          Read arbitrary 0G KV key
POST /api/og/flush            Flush journal buffer to 0G Storage
```

---

## Frontend

React 19 + Tailwind CSS 4 + wagmi 2 + viem. 7 pages, 40+ components, 20+ hooks.

| Page | Route | Content |
|---|---|---|
| **Landing** | `/` | Hero, problem, solution, how-it-works, capabilities, architecture, trust, CTA |
| **Platform Overview** | `/app` | Your Vaults (owned) + All Platform Vaults (on-chain factory), per-vault Pyth NAV, market prices, orchestrator status, risk shield, AI signal |
| **Vault Detail** | `/app/vault` | NAV, all-time return, risk score, performance charts, allocation detail (Pyth), AI reasoning journal, risk timeline, policy panel, system controls (deposit/withdraw/pause/edit policy/export) |
| **AI Actions** | `/app/actions` | Real-time AI intelligence feed from orchestrator journal, trigger cycle button |
| **Journal** | `/app/journal` | Complete audit trail with filter tabs (all/decision/execution/policy_check/cycle) |
| **Settings** | `/app/settings` | Contract addresses, vault policy, orchestrator status, 0G Storage status |
| **Create Vault** | `/create` | 6-step wizard: deposit amount, risk profile, policy fine-tune, asset selection, sealed mode, review + deploy |

### Key Features

- **Wallet dropdown**: Native 0G balance + token balances (USDC, WBTC, WETH) with copy address
- **Vault switcher**: On-chain vault list from `factory.getOwnerVaults()` with copy address
- **Multi-token deposit**: USDC (via `vault.deposit()`), WBTC/WETH (via direct `transfer()`)
- **Per-vault NAV**: Each vault fetches its own Pyth NAV from `/api/nav?vault=<addr>`
- **Platform TVL**: Sum of all vault NAVs across the platform
- **Token logos**: Real BTC/ETH/USDC logos throughout the app
- **Real controls**: Deposit, Withdraw, Pause/Resume, Edit Policy, Export Journal — all on-chain TX
- **Executor separation**: Create Vault sets orchestrator wallet as executor (not user wallet)
- **100% real data**: All pages read from on-chain + orchestrator API. Mock data only for performance charts (needs historical data).

### Data Sources per Page

| Page | Data Source |
|---|---|
| `/app` (Overview) | On-chain vaults + Pyth NAV per vault + orchestrator stats |
| `/app/vault` (Detail) | On-chain vault state + Pyth NAV + orchestrator journal. Charts: mock (needs history). |
| `/app/actions` | 100% from orchestrator `/api/journal` |
| `/app/journal` | 100% from orchestrator `/api/journal` |
| `/app/settings` | 100% on-chain + orchestrator API |
| `/create` | 100% on-chain `factory.createVault()` |

---

## How It Works (End-to-End)

### Step 1: User Creates Vault
Connect wallet → choose risk profile → set policy → select assets → Deploy Vault on-chain. Executor automatically set to orchestrator server wallet.

### Step 2: User Deposits
Deposit USDC (via `vault.deposit()`) or WBTC/WETH (via direct transfer) through the UI.

### Step 3: Orchestrator Reads Market
Fetches BTC/ETH/USDC prices from CoinGecko + Pyth Hermes oracle. Calculates volatility.

### Step 4: AI Generates Decision (0G Compute)
Market data + vault state sent to **0G Compute Mainnet** (GLM-5-FP8). AI returns structured JSON with reasoning chain: action, asset, size, confidence, risk score, reason.

### Step 5: Policy Pre-check (Off-chain)
10 rules validated off-chain to save gas. If any fail, intent is not submitted.

### Step 6: Intent Submitted to Contract
`executeIntent()` called by orchestrator (executor). Contract:
1. Verifies `autoExecution` enabled
2. Validates `intent.vault == address(this)`
3. Recomputes and verifies `intentHash` on-chain
4. Checks global stop-loss
5. Runs `PolicyLibrary.validateAll()` (9 checks)
6. Registers intent in `ExecutionRegistry`
7. Executes swap via venue adapter
8. Auto-finalizes result
9. Emits `IntentExecuted` event

### Step 7: Result Stored
Execution result on-chain in `ExecutionRegistry`. Decision + execution report uploaded to 0G Storage. Journal entry persisted locally + batched to 0G.

### Step 8: User Monitors
Dashboard shows live vault NAV (Pyth), allocation, AI action feed, policy status. User can pause/unpause, withdraw, edit policy at any time via on-chain TX.

---

## Quick Start

### Prerequisites
- Node.js 20+
- MetaMask browser extension

### Setup (Galileo Testnet)

```bash
# Terminal 1: Deploy contracts
cd contracts && npm install
DEPLOYER_PRIVATE_KEY=<key> npx hardhat run scripts/deploy.js --network og_testnet
node scripts/gen-env.js
node scripts/sync-frontend.js

# Terminal 2: Start orchestrator (port 4002)
cd orchestrator && npm install --legacy-peer-deps && npm start

# Terminal 3: Start frontend (port 5173)
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173`

### Connect MetaMask

1. Add network: RPC `https://evmrpc-testnet.0g.ai`, Chain ID `16602`, Symbol `0G`
2. Click "Connect Wallet" in the dashboard
3. Create a vault via `/create` or view existing vaults on the platform

### Deploy to 0G Mainnet (Aristotle)

```bash
cd contracts
DEPLOYER_PRIVATE_KEY=<key> npx hardhat run scripts/deploy-mainnet.js --network og_mainnet
```

Mainnet deployment includes JaineVenueAdapter for real DEX swaps via Jaine (0G's native AMM).

---

## Jaine DEX Integration (Mainnet)

Aegis Vault includes a venue adapter for **Jaine DEX**, the native Uniswap V3-style AMM on 0G Mainnet:

| Component | Address (0G Mainnet) |
|---|---|
| Jaine SwapRouter | `0x8b598a7c136215a95ba0282b4d832b9f9801f2e2` |
| Jaine Factory | `0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4` |
| W0G (WETH9) | `0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c` |
| oUSDT (Hyperlane) | `0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189` |

`JaineVenueAdapter.sol` translates `vault.swap()` → `JaineRouter.exactInputSingle()` with:
- Auto pool discovery across 4 fee tiers (0.01%, 0.05%, 0.3%, 1%)
- Best liquidity pool selection
- Slippage protection via `minAmountOut`
- ReentrancyGuard + token validation + rescue function

Switch from MockDEX to Jaine: `vault.setVenue(jaineAdapterAddress)`

---

## Project Structure

```
0g-chain/
|
|- contracts/                    Solidity (Hardhat 2.28)
|  |- contracts/
|  |  |- AegisVault.sol            Core vault (~400 lines)
|  |  |- AegisVaultFactory.sol     Factory with registry authorization
|  |  |- ExecutionRegistry.sol     Access-controlled intent tracking
|  |  |- VaultEvents.sol           Structs (3) + events (14)
|  |  |- JaineVenueAdapter.sol     Jaine DEX adapter (Uniswap V3)
|  |  |- libraries/
|  |  |  |- PolicyLibrary.sol      9 validation rules + validateAll()
|  |  |- mocks/
|  |     |- MockDEX.sol            Test DEX with fixed-rate swaps
|  |     |- MockERC20.sol          Test token
|  |- test/
|  |  |- AegisVault.test.js        34 tests
|  |- scripts/
|     |- deploy.js                 Testnet deployment
|     |- deploy-mainnet.js         Mainnet deployment (with JaineVenueAdapter)
|     |- deploy-pyth.js            Pyth oracle deployment
|     |- gen-env.js                Auto-generate orchestrator .env
|     |- sync-frontend.js          Sync addresses to frontend
|
|- orchestrator/                 Node.js Backend
|  |- src/
|  |  |- config/
|  |  |  |- index.js               Environment config (vault RPC + compute RPC)
|  |  |  |- contracts.js            Provider, signer, contract instances
|  |  |- services/
|  |  |  |- orchestrator.js         Main cycle loop
|  |  |  |- marketData.js           CoinGecko + Pyth Hermes prices
|  |  |  |- inference.js            0G Compute → local fallback
|  |  |  |- ogCompute.js            0G Compute SDK (broker, service discovery, inference, verification)
|  |  |  |- pythPrice.js            Pyth Hermes oracle + multi-asset NAV
|  |  |  |- promptBuilder.js        System/user prompts + JSON parser
|  |  |  |- policyCheck.js          10 off-chain policy rules
|  |  |  |- executor.js             Intent builder + submitter
|  |  |  |- vaultReader.js          On-chain state reader
|  |  |  |- storage.js              Dual persistence (local + 0G)
|  |  |  |- ogStorage.js            0G Storage SDK (KV + blob)
|  |  |- api.js                     Express server (16 endpoints)
|  |  |- index.js                   Entry point + cron scheduler
|
|- frontend/                     React Frontend (Vite + Tailwind)
|  |- src/
|  |  |- pages/
|  |  |  |- LandingPage.jsx         Marketing page (8 sections)
|  |  |  |- DashboardPage.jsx       Platform overview (your vaults + all vaults)
|  |  |  |- VaultDetailPage.jsx     Vault deep dive (NAV, allocation, AI journal, controls)
|  |  |  |- ActionsPage.jsx         AI intelligence feed
|  |  |  |- JournalPage.jsx         Audit trail with filters
|  |  |  |- SettingsPage.jsx        System config & addresses
|  |  |  |- CreateVaultPage.jsx     6-step vault creation wizard
|  |  |- components/
|  |  |  |- dashboard/               AppShell, DashboardShield, ActionFeed, AllocationPanel, ControlsPanel
|  |  |  |- charts/                  NavChart, DrawdownChart, AllocationRing
|  |  |  |- ui/                      GlassPanel, StatusPill, MetricCard, ControlButton, PolicyChip, WalletButton, TokenIcon, Logo
|  |  |- hooks/
|  |  |  |- useVault.js              15+ contract hooks (read + write + multi-vault)
|  |  |  |- useOrchestrator.js       12+ API hooks (status, journal, NAV, prices, TVL)
|  |  |- lib/
|  |  |  |- wagmiConfig.js           Chain definitions (0G Galileo + Hardhat)
|  |  |  |- contracts.js             ABIs, addresses per chain, orchestrator URL
|  |  |- assets/                     Token logos (BTC, ETH, USDC)
|
|- demo.js                       6-scene live demo script
|- setup.sh                      One-command full setup
```

---

## Test Results

```
Smart Contracts:     34 passing, 0 failing
Security Audit:      4 critical + 6 high findings fixed, re-audited clean
JaineVenueAdapter:   10 findings audited (2H, 5M, 2L, 1I — all addressed)
Demo Script:         6/6 scenes passed
On-chain Execution:  Real TX on Galileo: 0x15858af9012d8320988d...
0G Compute:          Live inference from GLM-5-FP8 on mainnet
Frontend Build:      3,029 modules, 0 errors
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Solidity 0.8.24, Hardhat 2.28, OpenZeppelin (SafeERC20, ReentrancyGuard) |
| Backend | Node.js, Express 5, ethers.js 6, node-cron, axios, winston |
| Frontend | React 19, Vite 8, Tailwind CSS 4, wagmi 2, viem, Recharts, Lucide |
| AI Inference | **0G Compute Mainnet** (`@0glabs/0g-serving-broker`) — GLM-5-FP8 + local fallback |
| Price Oracle | **Pyth Network** (Hermes API) — real-time BTC/ETH/USDC prices |
| DEX | MockDEX (testnet) + JaineVenueAdapter (mainnet Jaine DEX, Uniswap V3 interface) |
| Storage | **0G Storage** (`@0glabs/0g-ts-sdk` — KV + blob) + local file persistence |
| Testing | Hardhat test runner, Chai, hardhat-network-helpers |

---

## Roadmap

**Completed (MVP)**
- [x] Smart contracts with security audit (4C + 6H fixed)
- [x] AI orchestrator with 0G Compute (GLM-5-FP8 on mainnet)
- [x] Pyth Hermes real-time oracle prices + multi-asset NAV
- [x] 0G Storage integration (KV + blob + journal)
- [x] On-chain swap via venue adapter + real execution on Galileo
- [x] JaineVenueAdapter for 0G mainnet Jaine DEX
- [x] Full frontend: 7 pages, wallet connect, multi-token deposit, real data
- [x] Platform overview with on-chain vault discovery
- [x] Per-vault Pyth NAV calculation
- [x] Executor/Owner separation (orchestrator as executor)
- [x] 6-scene demo script
- [x] Deploy to 0G Galileo Testnet

**Next**
- [ ] Deploy to 0G Mainnet (Aristotle) with JaineVenueAdapter as venue
- [ ] Sealed strategy mode (TEE-verified inference via 0G Compute)
- [ ] Historical NAV tracking for performance charts
- [ ] Multi-user pooled vault
- [ ] Cross-chain venue adapter
- [ ] Agent ID integration

---

## One-Line Pitch

**Aegis Vault is a verifiable AI risk manager for on-chain execution — deposit, define mandates, and let disciplined intelligence trade within auditable, policy-constrained limits powered by 0G Compute, 0G Chain, and 0G Storage.**
