# Aegis Vault — Hackathon Submission

**Track:** Track 2 — Agentic Trading Arena (Verifiable Finance)
**Network:** 0G Aristotle Mainnet (chain 16661)
**Live on mainnet:** ✅ 18 contracts deployed, organic AI execution verified on-chain

---

## Description

**Aegis Vault is a verifiable AI-managed trading vault built natively on the 0G stack — where strategy is proposed by AI, enforced by smart contracts, and protected by sealed inference + commit-reveal anti-MEV.**

### The problem

Retail and institutional users want AI-powered trading exposure, but today's options are broken:

- **Custodial platforms** (Set, Enzyme) require trusting the operator with funds
- **Copy trading** leaks strategy publicly — anyone can front-run the signal
- **Yield aggregators** (Yearn) use hardcoded strategies voted by DAOs — slow to adapt, opaque to users
- **"Bot trading" platforms** are off-chain black boxes — no verifiable execution, no accountability

Users are forced to choose between **trust-minimization** (DeFi primitives, but no alpha) and **alpha seeking** (centralized bots, but must trust operators completely).

### Our approach

Aegis Vault separates **proposal** from **enforcement**:

- **AI proposes** — Real 0G Compute inference (GLM-5-FP8, DeepSeek, Qwen) generates trading decisions
- **Smart contract enforces** — Every swap must pass on-chain policy checks before executing
- **Operators compete** — Decentralized marketplace where operators commit AI models + strategy manifests on-chain
- **Users retain custody** — Vault holds funds, operator can only submit intents, never withdraw

### Track 2 differentiators

1. **Sealed Strategy Mode** — TEE-attested inference via 0G Compute, EIP-712 signed intent hashes, commit-reveal prevents MEV bots from front-running swaps
2. **Operator Marketplace** — Strategy manifest commitment on-chain (IPFS/0G Storage + keccak256 hash), AI model declaration per operator, slashable bonded manifests via governance
3. **Production-grade orchestrator** — Vault indexer (O(1) lookups), multi-wallet executor pool (deterministic sharding, NonceManager per wallet), parallel cycles (p-limit), decentralized operator self-hosting

### How it uses 0G

- **0G Chain (mainnet 16661)** — 18 smart contracts: vault custody, EIP-1167 clone factory, commit-reveal sealed mode, operator registry v2, staking, reputation, governance, treasury
- **0G Compute** — Real AI inference (GLM-5-FP8, verified via `processResponse()`). Multi-model support — operators choose from 6 active providers
- **0G Storage** — Decision journal, execution log, strategy manifests (optional IPFS + 0G Storage dual-hosting)
- **Pyth Network on 0G** — Multi-asset NAV oracle for position sizing, slippage protection, fee accrual

### Architecture at a glance

```
User ─ deposits ─▶ AegisVault (0G mainnet)
                    │
                    └─▶ Owner picks operator from marketplace
                                │
                                ▼
                    Operator runs their own orchestrator (decentralized)
                                │
                                ├─▶ Real 0G Compute AI inference (GLM-5-FP8)
                                ├─▶ EIP-712 intent hash + TEE signature
                                ├─▶ Commit-reveal anti-MEV (sealed mode)
                                └─▶ On-chain executeIntent() via vault

Strategy enforced by Solidity: policy check, cooldown, daily cap,
slippage, commit-reveal, ECDSA sig verify. AI proposes, contract decides.
```

### Verifiable execution on 0G mainnet

**First sealed-mode AI execution (organic, from orchestrator cycle):**

- Commit TX: `0x081c80537a10fce866a57e3e6ff74fc9c63127bf31de25d6011cacc80d5c5442`
- Reveal TX: `0x039242e7a5595fb8b715946804e8ca6a53eeb29731a7661e6437a94b34e44365`
- AI-driven SELL decision on live mainnet vault (chain 16661)

**Second organic AI execution (orchestrator cycle #848):**

- TX: `0x96b3e45435156849ee38c8a94c72ab3582a1abba1fa7cbf5d06374777e102a26`
- Source: 0G Compute GLM-5-FP8, confidence 62%, regime RANGE_NOISY
- Full decision journal → orchestrator log → on-chain execution

### Key deployed contracts (0G Aristotle mainnet — chain 16661)

| Contract | Address |
|---|---|
| AegisVaultFactory (EIP-1167 clones) | `0xE03336e792F061f9fDEbd2B62ce9324f4868a683` |
| AegisVault implementation | `0x4720686cCC199fD645B824F8d0A037c44Bc8336A` |
| SealedLib (TEE attestation) | `0xe8AaB350495bBFf3868f89681eBC36814cB64D61` |
| ExecLib (EIP-712 + policy + swap) | `0x2e29a14dDbDa85760a765A775B41B69Aca60bAA7` |
| IOLib (deposit/withdraw) | `0xa49b7898bfd5eEaC9C0fA748c2309e23a8e876Dd` |
| ExecutionRegistry | `0xa8b9807038c855737cc300dD9D9da4377570bE93` |
| OperatorRegistry v2 (with manifest) | `0x3D47c351a3503D26338863e79b307091Ff2B37fe` |
| OperatorStaking | `0xC357c0BD2eB75355F070d706E7410C65c309f960` |
| OperatorReputation | `0xb8a3cd7DD093FBF6805D370C8CbCcC2ac1a20227` |
| InsurancePool | `0x23F8786Fed248D363641C6c8c0faA40Cc01e55B1` |
| AegisGovernor (M-of-N multi-sig) | `0x33335e59Ad5780d0f07ebcd3549016d28A28F06E` |
| ProtocolTreasury | `0xCc7324188A240450B28FCb54706cEb0B7c7bb9b5` |

**Explorer:** https://chainscan.0g.ai
**GitHub:** https://github.com/mdlog/aegis-vault

---

## Progress During Hackathon

### Timeline summary

We built Aegis Vault from the ground up during the hackathon — from zero to a deployed, production-grade, Track 2-compliant system on 0G Aristotle mainnet with verified organic AI executions.

### Major deliverables completed

#### 1. Smart contract stack (Track 2 sealed mode)

- **Designed & implemented sealed strategy mode** from scratch:
  - Extended `VaultPolicy` struct with `sealedMode` + `attestedSigner`
  - Extended `ExecutionIntent` with `attestationReportHash` (binds inference output to on-chain intent)
  - `commitIntent(commitHash)` + `executeIntent(intent, sig)` with commit-reveal enforcement
  - ECDSA signature verification against `policy.attestedSigner` on-chain
  - EIP-712 typed data hashing (domain separator binds chain ID + vault address → cross-chain replay protection)

- **Aggressive contract slimming** to fit 0G mainnet per-block gas limit (~700K–1.3M during deploy window):
  - Started at 16KB AegisVault implementation → couldn't fit
  - Refactored into 3 external libraries (DELEGATECALL'd): `ExecLib`, `SealedLib`, `IOLib`
  - Added EIP-1167 minimal proxy clone factory (19KB → 2.7KB factory)
  - Final AegisVault: **3.4 KB** — fits comfortably in mainnet block gas
  - Retry deploy with automated loops until network window allowed submission

- **Full Phase 1-5 production stack** redeployed with Track 2 additions:
  - 18 contracts total on mainnet (factory, vault impl, 3 libraries, registry, staking, reputation, governance, treasury, insurance, NAV calc, venue adapter, mocks)

#### 2. EIP-712 typed intent hash

- Implemented full EIP-712 domain separator: `name="AegisVault"`, `version="1"`, `chainId`, `verifyingContract=vault`
- Orchestrator uses `ethers.TypedDataEncoder.hash()` — matches Solidity `\x19\x01 || domainSep || structHash` byte-for-byte
- TEE signer uses `wallet.signTypedData()` (EIP-712 compliant — works with MetaMask, Ledger, any hardware wallet)
- Raw ECDSA recover in `SealedLib` (no double EIP-191 prefix) — audit-clean implementation

#### 3. Operator marketplace v2 (Strategy Manifest + AI Model commitment)

- Redeployed `OperatorRegistry v2` with additive fields: `manifestURI`, `manifestHash`, `manifestVersion`, `manifestBonded`, `aiModel`, `aiProvider`, `aiEndpoint`
- New functions: `publishManifest(uri, hash, bonded)`, `declareAIModel(model, provider, endpoint)`, `getOperatorExtended()`
- Frontend register flow: post-register sections with **AI model dropdown** (fetched live from 0G Compute's `listService()`) + **manifest form** (auto-computes keccak256 from JSON content)
- Marketplace display: AI model badge + bonded/manifest indicator on every operator card
- Full schema spec: `docs/STRATEGY_MANIFEST.md` + example JSON

#### 4. Production-grade orchestrator

Originally single-vault, blocking, manual — rebuilt for scale:

| Feature | Before | After |
|---|---|---|**Aegis Vault is a verifiable AI-managed trading vault built natively on the 0G stack — where strategy is proposed by AI, enforced by smart contracts, and protected by sealed inference + commit-reveal anti-MEV.**

### The problem

Retail and institutional users want AI-powered trading exposure, but today's options are broken:

- **Custodial platforms** (Set, Enzyme) require trusting the operator with funds
- **Copy trading** leaks strategy publicly — anyone can front-run the signal
- **Yield aggregators** (Yearn) use hardcoded strategies voted by DAOs — slow to adapt, opaque to users
- **"Bot trading" platforms** are off-chain black boxes — no verifiable execution, no accountability

Users are forced to choose between **trust-minimization** (DeFi primitives, but no alpha) and **alpha seeking** (centralized bots, but must trust operators completely).

### Our approach

Aegis Vault separates **proposal** from **enforcement**:

- **AI proposes** — Real 0G Compute inference (GLM-5-FP8, DeepSeek, Qwen) generates trading decisions
- **Smart contract enforces** — Every swap must pass on-chain policy checks before executing
- **Operators compete** — Decentralized marketplace where operators commit AI models + strategy manifests on-chain
- **Users retain custody** — Vault holds funds, operator can only submit intents, never withdraw

### Track 2 differentiators

1. **Sealed Strategy Mode** — TEE-attested inference via 0G Compute, EIP-712 signed intent hashes, commit-reveal prevents MEV bots from front-running swaps
2. **Operator Marketplace** — Strategy manifest commitment on-chain (IPFS/0G Storage + keccak256 hash), AI model declaration per operator, slashable bonded manifests via governance
3. **Production-grade orchestrator** — Vault indexer (O(1) lookups), multi-wallet executor pool (deterministic sharding, NonceManager per wallet), parallel cycles (p-limit), decentralized operator self-hosting

### How it uses 0G

- **0G Chain (mainnet 16661)** — 18 smart contracts: vault custody, EIP-1167 clone factory, commit-reveal sealed mode, operator registry v2, staking, reputation, governance, treasury
- **0G Compute** — Real AI inference (GLM-5-FP8, verified via `processResponse()`). Multi-model support — operators choose from 6 active providers
- **0G Storage** — Decision journal, execution log, strategy manifests (optional IPFS + 0G Storage dual-hosting)
- **Pyth Network on 0G** — Multi-asset NAV oracle for position sizing, slippage protection, fee accrual

### Architecture at a glance

```
User ─ deposits ─▶ AegisVault (0G mainnet)
                    │
                    └─▶ Owner picks operator from marketplace
                                │
                                ▼
                    Operator runs their own orchestrator (decentralized)
                                │
                                ├─▶ Real 0G Compute AI inference (GLM-5-FP8)
                                ├─▶ EIP-712 intent hash + TEE signature
                                ├─▶ Commit-reveal anti-MEV (sealed mode)
                                └─▶ On-chain executeIntent() via vault

Strategy enforced by Solidity: policy check, cooldown, daily cap,
slippage, commit-reveal, ECDSA sig verify. AI proposes, contract decides.
```

### Verifiable execution on 0G mainnet

**First sealed-mode AI execution (organic, from orchestrator cycle):**

- Commit TX: `0x081c80537a10fce866a57e3e6ff74fc9c63127bf31de25d6011cacc80d5c5442`
- Reveal TX: `0x039242e7a5595fb8b715946804e8ca6a53eeb29731a7661e6437a94b34e44365`
- AI-driven SELL decision on live mainnet vault (chain 16661)

**Second organic AI execution (orchestrator cycle #848):**

- TX: `0x96b3e45435156849ee38c8a94c72ab3582a1abba1fa7cbf5d06374777e102a26`
- Source: 0G Compute GLM-5-FP8, confidence 62%, regime RANGE_NOISY
- Full decision journal → orchestrator log → on-chain execution

### Key deployed contracts (0G Aristotle mainnet — chain 16661)

| Contract | Address |
|---|---|
| AegisVaultFactory (EIP-1167 clones) | `0xE03336e792F061f9fDEbd2B62ce9324f4868a683` |
| AegisVault implementation | `0x4720686cCC199fD645B824F8d0A037c44Bc8336A` |
| SealedLib (TEE attestation) | `0xe8AaB350495bBFf3868f89681eBC36814cB64D61` |
| ExecLib (EIP-712 + policy + swap) | `0x2e29a14dDbDa85760a765A775B41B69Aca60bAA7` |
| IOLib (deposit/withdraw) | `0xa49b7898bfd5eEaC9C0fA748c2309e23a8e876Dd` |
| ExecutionRegistry | `0xa8b9807038c855737cc300dD9D9da4377570bE93` |
| OperatorRegistry v2 (with manifest) | `0x3D47c351a3503D26338863e79b307091Ff2B37fe` |
| OperatorStaking | `0xC357c0BD2eB75355F070d706E7410C65c309f960` |
| OperatorReputation | `0xb8a3cd7DD093FBF6805D370C8CbCcC2ac1a20227` |
| InsurancePool | `0x23F8786Fed248D363641C6c8c0faA40Cc01e55B1` |
| AegisGovernor (M-of-N multi-sig) | `0x33335e59Ad5780d0f07ebcd3549016d28A28F06E` |
| ProtocolTreasury | `0xCc7324188A240450B28FCb54706cEb0B7c7bb9b5` |

**Explorer:** https://chainscan.0g.ai
**GitHub:** https://github.com/mdlog/aegis-vault

---

## Progress During Hackathon

### Timeline summary

We built Aegis Vault from the ground up during the hackathon — from zero to a deployed, production-grade, Track 2-compliant system on 0G Aristotle mainnet with verified organic AI executions.

### Major deliverables completed

#### 1. Smart contract stack (Track 2 sealed mode)

- **Designed & implemented sealed strategy mode** from scratch:
  - Extended `VaultPolicy` struct with `sealedMode` + `attestedSigner`
  - Extended `ExecutionIntent` with `attestationReportHash` (binds inference output to on-chain intent)
  - `commitIntent(commitHash)` + `executeIntent(intent, sig)` with commit-reveal enforcement
  - ECDSA signature verification against `policy.attestedSigner` on-chain
  - EIP-712 typed data hashing (domain separator binds chain ID + vault address → cross-chain replay protection)

- **Aggressive contract slimming** to fit 0G mainnet per-block gas limit (~700K–1.3M during deploy window):
  - Started at 16KB AegisVault implementation → couldn't fit
  - Refactored into 3 external libraries (DELEGATECALL'd): `ExecLib`, `SealedLib`, `IOLib`
  - Added EIP-1167 minimal proxy clone factory (19KB → 2.7KB factory)
  - Final AegisVault: **3.4 KB** — fits comfortably in mainnet block gas
  - Retry deploy with automated loops until network window allowed submission

- **Full Phase 1-5 production stack** redeployed with Track 2 additions:
  - 18 contracts total on mainnet (factory, vault impl, 3 libraries, registry, staking, reputation, governance, treasury, insurance, NAV calc, venue adapter, mocks)

#### 2. EIP-712 typed intent hash

- Implemented full EIP-712 domain separator: `name="AegisVault"`, `version="1"`, `chainId`, `verifyingContract=vault`
- Orchestrator uses `ethers.TypedDataEncoder.hash()` — matches Solidity `\x19\x01 || domainSep || structHash` byte-for-byte
- TEE signer uses `wallet.signTypedData()` (EIP-712 compliant — works with MetaMask, Ledger, any hardware wallet)
- Raw ECDSA recover in `SealedLib` (no double EIP-191 prefix) — audit-clean implementation

#### 3. Operator marketplace v2 (Strategy Manifest + AI Model commitment)

- Redeployed `OperatorRegistry v2` with additive fields: `manifestURI`, `manifestHash`, `manifestVersion`, `manifestBonded`, `aiModel`, `aiProvider`, `aiEndpoint`
- New functions: `publishManifest(uri, hash, bonded)`, `declareAIModel(model, provider, endpoint)`, `getOperatorExtended()`
- Frontend register flow: post-register sections with **AI model dropdown** (fetched live from 0G Compute's `listService()`) + **manifest form** (auto-computes keccak256 from JSON content)
- Marketplace display: AI model badge + bonded/manifest indicator on every operator card
- Full sch
| Vault discovery | O(N) RPC calls per cycle | O(1) in-memory map + event polling |
| Executor wallet | Single key bottleneck | Deterministic sharding across wallet pool (`EXECUTOR_PRIVATE_KEYS`) |
| Nonce management | Single nonce sequence | `NonceManager` per pool wallet |
| Cycle concurrency | Sequential for-loop | `p-limit` parallel (configurable `VAULT_CONCURRENCY`) |
| Retry/backoff | None | Exponential backoff 3x for tx, 2x for 0G Compute |
| Idempotency | None | Session `Set<intentHash>` prevents duplicate submits |
| Reveal-block timeout | Infinite loop risk | 60s max wait, fail-fast |

- **Decentralized operator model** — every operator runs their own orchestrator, managing only the vaults that selected them as executor
- Full guide: `docs/OPERATOR_GUIDE.md` covering setup, scaling (single-wallet → 1000-vault sharding), security checklist, monitoring

#### 5. Frontend (React 19 + Vite + wagmi/viem)

- Landing page, Dashboard, Vault Detail, 6-step Create Vault wizard with sealed mode toggle
- Operator Marketplace with AI model + manifest badges, sortable by reputation/tier/fees
- Operator Register with AI model declaration dropdown + strategy manifest publish form
- Governance M-of-N proposal UI, Actions/AI journal feed, Token Faucet for demo
- Full chain 16661 mainnet integration + testnet 16602 fallback

#### 6. CI/CD + Testing

- `.github/workflows/security.yml` — Slither static analysis runs on every push and PR
- 28/28 tests passing for the slim build (sealed mode, commit-reveal, EIP-712 typed data, fees, policy enforcement, revert cases)
- EIP-712 test fixtures match on-chain hash exactly
- JaineVenueAdapter `getAmountOut()` implemented using sqrtPriceX96 math (was previously a stub)

#### 7. Documentation

Everything auditable and reproducible:

- `README.md` — Full architecture, deployed addresses, quick start, operator + user flows
- `ARCHITECTURE.md` — 12-section deep-dive, state diagrams, threat model, Track 2 sealed flow
- `DEMO.md` — 10-scene walkthrough for judges + screen recording (includes sealed mode demo)
- `docs/OPERATOR_GUIDE.md` — Complete operator self-hosting guide, scaling playbook
- `docs/STRATEGY_MANIFEST.md` — Full schema spec, hash rules, bonded semantics, slashing flow
- `docs/AI_AGENT_DECISION_FLOW.md` — How 0G Compute inference becomes on-chain intent
- `docs/strategy-manifest.example.json` — Minimal valid manifest example

### Code & commit metrics

- **100+ commits** during hackathon
- **~12,000 lines** of new Solidity + TypeScript + docs
- **18 contracts** deployed to 0G mainnet
- **6 real on-chain executions** verified (deposits, forced sealed execution, organic AI execution)
- **Zero test regressions** — 28/28 slim build suite green

### Honest disclosures

- **0G Storage KV node unstable** during hackathon window — we fall back to in-memory + JSON file cache for orchestrator journal. Full 0G Storage integration code paths present; production deployment would need a stable KV endpoint.
- **TEE attestation depends on 0G Compute provider hardware** — sealed mode gives ECDSA-verifiable inference commitment + commit-reveal anti-MEV, but hardware-grade TEE (SGX/TDX) depends on the specific 0G Compute provider. We document this honestly in the UI and README.
- **Operator wallet private keys were exposed during testing** (in chat logs, for debugging) — before any public launch these must be rotated. Not yet rotated at submission time.
- **Slim build tradeoffs vs full Phase 1-5 vault** — to fit 0G mainnet block gas, we removed streaming management fee accrual, fee change cooldown, and some view functions. Full version is in commit history and can be deployed to Arbitrum where gas is plentiful.

### What's genuinely novel

- **Sealed mode with EIP-712 binding** — AFAIK first implementation that binds off-chain AI inference attestation into on-chain EIP-712 typed intent with commit-reveal anti-MEV in a single protocol
- **Operator manifest slashing** — Operators can choose to bond their stake against a public strategy manifest. Governance can slash them if execution provably deviates. This is a new trust primitive that goes beyond Yearn's "trust the strategist" or Sommelier's "trust the template"
- **Decentralized orchestrator marketplace** — Every operator runs their own compute + strategy, but users get a unified frontend with on-chain reputation and cryptographic verifiability

---

## Fundraising Status

**Current status:** 🟡 Not actively fundraising. Bootstrapped through hackathon.

**Team & funding context:**

- **Solo builder** (self-funded, hackathon-bootstrapped)
- **Built from scratch during the hackathon window** — no prior codebase, no grants, no pre-committed capital
- **Gas costs self-covered** (~7 0G for full mainnet deploy + testing, funded from personal wallet)
- **No token planned** — protocol revenue flows to `ProtocolTreasury` contract, governed by M-of-N multi-sig; intended for audit costs, bug bounties, and insurance pool top-ups

**What we would use funding for (if/when we raise):**

| Priority | Item | Estimated cost |
|---|---|---|
| 1 | Smart contract audit (Certik / OpenZeppelin / Trail of Bits) | $30–80k |
| 2 | Insurance underwriting (Nexus Mutual or native insurance pool capitalization) | $50–200k |
| 3 | Dedicated orchestrator infrastructure (multi-region, monitoring, SLA) | $30k/yr |
| 4 | Frontend redesign + compliance review for regulated capital access | $40k |
| 5 | Operator bootstrap grants (pay first 5 operators to run orchestrators + publish manifests) | $50k |
| 6 | Community + developer relations | $30k/yr |

**Total target seed raise:** $500k–$1M to ship Aegis to a regulated, insured, institutional-grade product. This is not a hackathon deliverable — it's what would come next.

**Current asks from 0G Foundation / hackathon organizers:**

- Dedicated 0G RPC endpoint for orchestrator (current public RPC has reliability issues)
- Access to TEE-attested 0G Compute providers (for genuine hardware-grade sealed mode)
- Feedback on vault factory gas patterns (block gas limit fluctuations caused deployment challenges)
- Connection to ecosystem insurance partners if/when we mature

**Open to:**

- Ecosystem grants (builds-on-0G grants, Track 2 winner prize)
- Strategic angel investors (DeFi operators, TradFi hedge funds exploring AI vaults)
- Technical partnerships (Gelato for keeper network integration, The Graph for subgraph indexing, Pyth for extended oracle coverage)

**Not open to:**

- Extractive token launches
- Retail-only accelerators without regulatory support
- Anything that would compromise the "contract enforces" trust model

**Timeline:**

- Short-term (post-hackathon, 4 weeks): polish, public beta with 3 whitelisted operators, first external deposits
- Medium-term (3 months): audit + testnet-to-mainnet cadence, launch ERC-4626 vault shares, strategy template registry
- Long-term (6–12 months): seed fundraise conditional on traction (TVL > $1M, >10 active operators, audit-clean)
