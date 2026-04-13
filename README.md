<p align="center">
  <img src="aegis-vault-logo.png" alt="Aegis Vault" width="480" />
</p>

<p align="center">
  <strong>Verifiable AI Risk Manager with Autonomous Execution Guardrails on 0G</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Track-2%20Agentic%20Trading%20Arena-blueviolet?style=for-the-badge" alt="Track 2" />
  <img src="https://img.shields.io/badge/0G_Mainnet-Aristotle_16661-orange?style=for-the-badge" alt="0G Mainnet" />
  <img src="https://img.shields.io/badge/Tests-28%20passing%20(slim%20build)-brightgreen?style=for-the-badge" alt="Tests" />
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

> AI-managed, risk-controlled trading vault on 0G — with **sealed strategy mode, TEE attestation, EIP-712 typed data, operator economics, skin-in-the-game staking, on-chain reputation, and multi-sig governance**. Users deposit, pick an operator from the marketplace, and let on-chain rules enforce every action. The AI proposes. The contract enforces. Every fee, slash, and rating is auditable. In sealed mode, strategy parameters never leave the TEE.

---

## Hackathon Track

**Track 2: Agentic Trading Arena (Verifiable Finance)**

Aegis Vault demonstrates fully verifiable autonomous execution: AI inference runs through 0G Compute, the output hash is bound into an EIP-712 execution intent, a TEE signer attests the decision, and commit-reveal prevents front-running — all enforced on-chain with no trusted intermediary.

---

## What's New — Sealed Strategy Mode + Slim Build

### Track 2: Sealed Strategy Mode (the headline feature)

Strategy parameters stay off-chain inside a TEE. The vault only sees the attestation — not the reasoning. The full trust chain:

```
0G Compute (GLM-5-FP8)
  └── inference output → computeAttestationReportHash(provider, chatId, model, content)
        └── attestationReportHash bound into ExecutionIntent (EIP-712 struct)
              └── TEE signer: wallet.signTypedData(intent)
                    └── commitIntent(keccak(intentHash, reportHash))   ← on-chain, block N
                          └── wait ≥ 1 block (anti-MEV commit-reveal)
                                └── executeIntent(intent, sig)          ← block N+1
                                      └── SealedLib.verifyAttestation() ← ecrecover on-chain
```

| Property | Mechanism |
|---|---|
| Strategy privacy | Intent params sealed in TEE — never broadcast pre-execution |
| Anti-MEV | Commit-reveal: commit hash at block N, execute at block N+1 minimum |
| Provider binding | `attestationReportHash = keccak256(provider, chatId, model, contentDigest)` |
| Signer binding | `policy.attestedSigner` set at vault creation; only its ECDSA sig accepted |
| Replay protection | EIP-712 domain includes `chainId` + `verifyingContract` (vault address) |

**VaultPolicy fields added for sealed mode:**
- `sealedMode` (bool) — enables TEE attestation + commit-reveal path
- `attestedSigner` (address) — the only address whose ECDSA signature the vault accepts

**ExecutionIntent field added:**
- `attestationReportHash` (bytes32) — binds the 0G Compute response to the on-chain execution

### EIP-712 Typed Data Hash

All execution intents use EIP-712 structured hashing for cross-chain and cross-vault replay protection:

```
intentHash = keccak256("\x19\x01" || domainSeparator || structHash)

Domain: {
  name:              "AegisVault"
  version:           "1"
  chainId:           (runtime)
  verifyingContract: vault address
}

ExecutionIntent struct includes: vault, assetIn, assetOut, amountIn,
  minAmountOut, createdAt, expiresAt, confidenceBps, riskScoreBps,
  attestationReportHash
```

- Orchestrator: `ethers.TypedDataEncoder.hash()` to compute the digest
- TEE signer: `wallet.signTypedData(domain, types, intent)`
- On-chain verification in `SealedLib`: `ecrecover(intentHash, v, r, s)` — no double-hashing since the EIP-712 digest already incorporates `\x19\x01`

### Slim Build Architecture (fits 0G Mainnet per-block gas limit)

`AegisVault` was aggressively slimmed from 16 KB to 3.4 KB to fit 0G Aristotle mainnet's per-block gas constraint. Heavy logic was extracted to three external libraries that `AegisVault` calls via `DELEGATECALL`:

| Library | Size | Responsibility |
|---|---|---|
| `ExecLib` | 3.5 KB | EIP-712 hash computation, policy checks, venue swap pipeline, ExecutionRegistry interactions |
| `SealedLib` | 0.5 KB | TEE attestation ECDSA signature verification (`ecrecover`) |
| `IOLib` | 1.1 KB | Deposit and withdraw with entry/exit fee handling |

`AegisVaultFactory` switched from a full contract-per-vault model to **EIP-1167 minimal proxy clones**, reducing per-vault deployment from 19 KB to 2.7 KB.

**Slim build trade-offs (explicit):**
- No streaming fee accrual (management fee not continuously updated)
- No `queueFeeChange` / 7-day fee cooldown enforced at runtime
- No `emergencyWithdrawToken` helper
- No view helpers — frontend reads via public auto-getters

---

## Production Stack (Phase 1-5)

| Phase | Scope | Tests |
|---|---|---|
| **1. Foundation** | Fee system (HWM, perf / mgmt / entry / exit), ProtocolTreasury, 80/20 operator-treasury split, multi-asset NAV via Pyth | included |
| **2. Stake & Slashing** | Operator staking with 4 tiers (Bronze → Platinum), tier-gated vault caps, 14-day unstake cooldown, freeze / slash arbitration, insurance pool | included |
| **3. Reputation & Discovery** | On-chain execution stats (volume, PnL, success), 1-5 star ratings, verified operator badge, marketplace sort | included |
| **4. Governance** | M-of-N multi-sig governor, proposal lifecycle, slashing arbitration + treasury spending, owner rotation | included |
| **5. Production Hardening** | Reputation auto-recording from vault executions, unified deploy script, e2e integration test | included |

**Economic model**

- Performance fee: 15% default (max 30%) — charged only on net-new profit above high-water mark
- Management fee: 2%/year default (max 5%) — streamed on NAV
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
| **0G Chain — Galileo testnet (16602)** | Full sealed-mode demo: 3 external libraries + slim vault + EIP-1167 factory + Phase 1-5 stack |
| **0G Chain — Aristotle mainnet (16661)** | Pre-sealed stack deployed at factory `0xDDb8988B6e2d43ABA0b6b10D181a09F995db54CB`; sealed-mode contracts pending (block gas limit constraint being solved by slim build) |
| **0G Compute** | Real AI inference via `GLM-5-FP8` — decentralized verifiable reasoning + structured JSON output; response hashed as `attestationReportHash` |
| **0G Storage** | KV state snapshots + blob upload — decision journal, execution reports, strategy memory; hydrated on orchestrator restart |
| **Pyth Network** | Multi-asset NAV oracle for BTC/ETH/USDC; live on 0G mainnet (`0x2880ab155794e7179c9ee2e38200202908c17b43`) |
| **Jaine DEX** | Uniswap V3 fork on 0G mainnet; `JaineVenueAdapter` deployed; MockDEX used for demo while Jaine pools fill |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         User / Frontend (React)                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐     │
│  │ Marketplace│  │ Create     │  │ Vault      │  │ Governance │     │
│  │ + ratings  │  │ Vault      │  │ Detail     │  │ Dashboard  │     │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ wagmi + viem
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  0G Chain (testnet 16602 / mainnet 16661)            │
│                                                                      │
│  ┌──────────────────┐   DELEGATECALL    ┌─────────────────────────┐ │
│  │ AegisVault       │──────────────────▶│ ExecLib (EIP-712, swap) │ │
│  │ (3.4 KB slim)    │──────────────────▶│ SealedLib (TEE ecrecover│ │
│  │                  │──────────────────▶│ IOLib (deposit/withdraw)│ │
│  │ commitIntent()   │                   └─────────────────────────┘ │
│  │ executeIntent()  │                                                │
│  └────┬─────────────┘                                                │
│       │ records                                                      │
│       ▼                                                              │
│  ┌──────────────────┐       ┌──────────────────────────────────┐    │
│  │ ExecutionRegistry│       │ AegisVaultFactory (EIP-1167)     │    │
│  │ - replay guard   │       │ - clones vault impl cheaply      │    │
│  └──────────────────┘       │ - wires registry + treasury      │    │
│                              └──────────────────────────────────┘    │
│  ┌──────────────────┐       ┌──────────────────┐                    │
│  │OperatorReputation│       │ ProtocolTreasury │                    │
│  │ - execution log  │       │ - 20% fee cut    │                    │
│  │ - ratings        │       │ - grants / audit │                    │
│  └──────────────────┘       └──────────────────┘                    │
│  ┌──────────────────┐       ┌──────────────────┐                    │
│  │ OperatorStaking  │──────▶│ InsurancePool    │                    │
│  │ - tier caps      │ slash │ - user claims    │                    │
│  │ - 14d cooldown   │       │ - payout via gov │                    │
│  └────────┬─────────┘       └──────────────────┘                    │
│           │ admin                                                    │
│           ▼                                                          │
│  ┌──────────────────────────────────────┐                           │
│  │ AegisGovernor (M-of-N multi-sig)     │                           │
│  │ - slashing arbitration               │                           │
│  │ - treasury spend / badge grants      │                           │
│  └──────────────────────────────────────┘                           │
└──────────────────────────────────────────────────────────────────────┘
                         ▲                    ▲
             executeIntent()             commitIntent()
                         │                    │
┌────────────────────────┴────────────────────┴────────────────────────┐
│                    Strategy Orchestrator (Node.js)                   │
│                                                                      │
│   ├── Vault discovery (factory scan → executor match)               │
│   ├── 0G Compute (GLM-5-FP8 inference)                              │
│   │     └── computeAttestationReportHash(provider,chatId,model,body)│
│   ├── Market data (CoinGecko + Pyth)                                │
│   ├── Decision Engine (8 regimes, veto rules, approval tiers)       │
│   ├── Policy pre-check → EIP-712 intent build                       │
│   ├── TEE signer: wallet.signTypedData(domain, types, intent)       │
│   ├── Sealed path: commitIntent() → wait 1 block → executeIntent()  │
│   ├── Idempotency: in-memory Set prevents duplicate submissions      │
│   ├── Retry: 3x backoff on tx, 2x on 0G Compute                    │
│   └── 0G Storage (journal, decisions, executions, KV hydration)     │
└──────────────────────────────────────────────────────────────────────┘
```

**Sealed mode end-to-end flow:**
1. Operator registers, sets `sealedMode: true` and `attestedSigner: <TEE wallet>` in vault policy
2. Orchestrator fetches market data and vault state
3. 0G Compute returns inference — orchestrator hashes `(provider, chatId, model, contentDigest)` → `attestationReportHash`
4. EIP-712 intent assembled including `attestationReportHash`; `intentHash` computed via `ethers.TypedDataEncoder.hash()`
5. TEE signer signs: `sig = wallet.signTypedData(domain, types, intent)`
6. Orchestrator calls `vault.commitIntent(keccak256(intentHash, reportHash))` — recorded at block N
7. Orchestrator waits for block N+1
8. Orchestrator calls `vault.executeIntent(intent, sig)`:
   - `SealedLib.verifyAttestation()` recovers signer from sig, checks against `policy.attestedSigner`
   - Confirms commit exists and `block.number >= commitBlock + 1`
   - Deletes commit (single-use)
   - `ExecLib.runExecution()` validates EIP-712 hash, checks policy, executes swap
9. Execution finalized in `ExecutionRegistry`, stats recorded in `OperatorReputation`

**Standard (non-sealed) flow:**
Steps 1-4 same, steps 6-7 skipped, `executeIntent()` skips attestation branch.

---

## Smart Contracts

| Contract | Size | Role |
|---|---|---|
| `AegisVault` | 3.4 KB | Slim vault: custody, sealed-mode commit-reveal, delegates execution to libraries |
| `AegisVaultFactory` | 2.7 KB | EIP-1167 minimal proxy clone factory; wires registry + treasury |
| `ExecLib` | 3.5 KB | EIP-712 hash, policy checks, venue swap pipeline, registry finalization |
| `SealedLib` | 0.5 KB | TEE attestation ECDSA verification via `ecrecover` |
| `IOLib` | 1.1 KB | Deposit/withdraw with entry/exit fee routing |
| `ExecutionRegistry` | — | Intent replay guard + execution history |
| `ProtocolTreasury` | — | Collects 20% protocol cut, admin-gated spending |
| `OperatorRegistry` | — | Operator directory with declared fees + recommendations |
| `OperatorStaking` | — | Tiered stake escrow + slashing + 14-day cooldown |
| `InsurancePool` | — | Slashed-fund custody + arbitrator-gated payouts |
| `OperatorReputation` | — | On-chain execution stats + ratings + verified badge |
| `AegisGovernor` | — | M-of-N multi-sig governance |
| `VaultNAVCalculator` | — | Pyth-backed multi-asset NAV pricing |
| `JaineVenueAdapter` | — | Uniswap V3 fork router (Jaine mainnet DEX) |

**Deployed on 0G mainnet (chain 16661, pre-sealed Phase 1-5 stack):**
- Factory: `0xDDb8988B6e2d43ABA0b6b10D181a09F995db54CB`
- Real tokens: oUSDT (`0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189`), W0G (`0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c`)
- Pyth oracle: `0x2880ab155794e7179c9ee2e38200202908c17b43`

**Security invariants:**
- AI has **zero authority** — can only propose intents; vault enforces every rule
- Executor can never withdraw or pause vault funds
- Single-use EIP-712 intent hashes (replay-proof across chains and vaults)
- Fee caps hard-coded in `AegisVault`: perf ≤ 30%, mgmt ≤ 5%, entry/exit ≤ 2%
- Sealed mode: ECDSA sig required from `policy.attestedSigner` — no other address accepted
- Commit-reveal: sealed intent must be committed at block N, cannot execute until block N+1
- `attestationReportHash` binds execution to specific 0G Compute provider + chat session
- All slashing + treasury spending requires M-of-N governance approval

See [ARCHITECTURE.md](ARCHITECTURE.md) for full economic model, state diagrams, and failure mode analysis.

---

## Quick Start

```bash
# 1. Compile + test contracts (slim build with sealed mode)
cd contracts && npm install
npx hardhat test                 # 28 tests passing (slim build)

# 2a. Deploy to 0G testnet (full sealed mode — recommended for demo)
DEPLOYER_PRIVATE_KEY=<key> \
  npx hardhat run scripts/deploy-mainnet.js --network og_testnet

# 2b. Deploy to 0G Aristotle mainnet (production)
GOVERNOR_OWNERS="0xaaa,0xbbb,0xccc" \
GOVERNOR_THRESHOLD=2 \
ARBITRATOR_ADDRESS=0xddd \
TRANSFER_ADMINS=1 \
CONFIRM_MAINNET=1 \
  npx hardhat run scripts/deploy-mainnet.js --network og_mainnet

# The deploy script deploys: SealedLib + ExecLib + IOLib → linked AegisVault impl
# → EIP-1167 AegisVaultFactory → full Phase 1-5 stack + Pyth NAV

# 3. Sync addresses to frontend
node scripts/sync-frontend.js deployments.json

# 4. Start orchestrator (port 4002)
cd ../orchestrator && npm install --legacy-peer-deps
cp .env.example .env
# Required in .env:
#   EXECUTOR_PRIVATE_KEY=<orchestrator executor wallet>
#   TEE_SIGNER_PRIVATE_KEY=<sealed mode TEE signer — separate key>
#   OG_COMPUTE_URL + OG_STORAGE_URL
#   AEGIS_VAULT_FACTORY=<factory address>
npm start

# 5. Start frontend (port 5173)
cd ../frontend && npm install && npm run dev
```

**MetaMask — Testnet:** RPC `https://evmrpc-testnet.0g.ai` · Chain ID `16602` · Symbol `A0GI`

**MetaMask — Mainnet:** RPC `https://evmrpc.0g.ai` · Chain ID `16661` · Symbol `0G`

**STRICT_MODE** (requires 0G Storage to initialize or crashes — use for production):
```bash
STRICT_MODE=true npm start
```

---

## Orchestrator — Key Behaviors

| Feature | Implementation |
|---|---|
| **Sealed commit-reveal** | `commitIntent(commitHash)` → wait 1 block → `executeIntent(intent, sig)` |
| **TEE signer** | Separate `TEE_SIGNER_PRIVATE_KEY` from executor wallet; signs via `wallet.signTypedData()` |
| **Attestation hash** | `computeAttestationReportHash(provider, chatId, model, contentDigest)` from 0G Compute response |
| **Idempotency** | In-memory `Set<intentHash>` prevents duplicate submissions within a session |
| **Retry** | 3x exponential backoff for tx submission; 2x for 0G Compute requests |
| **State hydration** | On start, compares 0G Storage snapshot timestamp vs local KV; takes newer |
| **Multi-vault** | Scans factory's `allVaults`, filters by `executor == orchestratorWallet` |
| **Operator eligibility** | Checks `TIER_CAP_EXCEEDED` and `OPERATOR_FROZEN` before inference |
| **Decision Engine** | 8 market regimes, veto rules, approval tiers (auto / owner confirmation) |

---

## CI/CD

- `.github/workflows/security.yml` — Slither static analysis runs on every push and PR that touches `contracts/`
- `contracts/slither.config.json` — filters out node_modules, mocks, and test files
- Uses `crytic/slither-action@v0.4.0`; configured with `fail-on: none` (informational for now)

---

## Project Structure

```
0g-chain/
├── contracts/
│   ├── contracts/
│   │   ├── AegisVault.sol              Slim vault (3.4 KB): sealed commit-reveal + DELEGATECALL
│   │   ├── AegisVaultFactory.sol       EIP-1167 clone factory (2.7 KB)
│   │   ├── ExecutionRegistry.sol       Intent replay guard
│   │   ├── VaultEvents.sol             Shared event definitions
│   │   ├── libraries/
│   │   │   ├── ExecLib.sol             EIP-712 hash, policy, swap (3.5 KB)
│   │   │   ├── SealedLib.sol           TEE attestation ecrecover (0.5 KB)
│   │   │   ├── IOLib.sol               Deposit/withdraw fees (1.1 KB)
│   │   │   └── PolicyLibrary.sol       Shared policy structs / types
│   │   ├── OperatorRegistry.sol
│   │   ├── OperatorStaking.sol
│   │   ├── OperatorReputation.sol
│   │   ├── InsurancePool.sol
│   │   ├── ProtocolTreasury.sol
│   │   ├── AegisGovernor.sol
│   │   ├── VaultNAVCalculator.sol
│   │   ├── JaineVenueAdapter.sol
│   │   └── mocks/                      MockERC20, MockDEX, MockPyth
│   ├── test/                           28 tests — sealed mode, commit-reveal, EIP-712
│   └── scripts/
│       ├── deploy-mainnet.js           Deploys libraries + linked vault impl + factory
│       └── sync-frontend.js            Address propagation to frontend + orchestrator .env
├── orchestrator/
│   └── src/
│       ├── config/
│       │   ├── contracts.js            EIP-712 TypedDataEncoder, computeCommitHash, ABI loading
│       │   └── index.js                STRICT_MODE, TEE_SIGNER_PRIVATE_KEY config
│       └── services/
│           ├── executor.js             Intent builder, computeAttestationReportHash, sealed submit
│           ├── inference.js            0G Compute GLM-5-FP8 client (retry, raw response capture)
│           ├── orchestrator.js         Main cycle: discover → infer → commit → execute
│           ├── vaultReader.js          Reads vault state (NAV, policy, sealedMode, attestedSigner)
│           ├── operatorReader.js       Reads stake tier + reputation (Phase 2-5)
│           ├── storage.js              0G Storage KV + blob journal
│           └── decisionEngine.js      Regime classifier + veto rules + approval tiers
└── frontend/
    └── src/
        ├── pages/
        │   ├── LandingPage, DashboardPage, VaultDetailPage
        │   ├── CreateVaultPage           Includes sealedMode toggle + attestedSigner field
        │   ├── ActionsPage               Intent submit + sealed mode flow UI
        │   ├── OperatorMarketplacePage
        │   ├── OperatorProfilePage, OperatorRegisterPage
        │   └── GovernancePage
        └── hooks/
            ├── useVault.js
            ├── useVaultFees.js
            ├── useOperatorStaking.js
            ├── useOperatorReputation.js
            └── useGovernor.js
```

---

## Test Results

```
Slim build (sealed mode, commit-reveal, EIP-712)    28 / 28 passing
Frontend build                                      clean Vite build
E2E sealed flow    deposit → commitIntent → wait 1 block → executeIntent
E2E standard flow  deposit → executeIntent (non-sealed)
E2E invariants     fee caps, replay protection, attestation mismatch revert

Note: Legacy 135-test suite (Phase 1-5 full stack) targets the pre-slim API
and requires migration to slim build interface. Core functionality covered
by the 28 slim-build tests; old suite retained for reference.
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
