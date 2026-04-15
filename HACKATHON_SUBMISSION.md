# Aegis Vault — Hackathon Submission

**Track:** Track 2 — Agentic Trading Arena (Verifiable Finance)
**Network:** 0G Aristotle Mainnet (chain 16661)
**Status:** ✅ 18 contracts live, organic AI execution verified on-chain

---

## Description

**Aegis Vault** is a verifiable AI-managed trading vault built natively on the 0G stack. Users today are forced to choose between trust-minimization (DeFi primitives with no alpha) and alpha-seeking (centralized bots where you hand over custody). Aegis Vault removes that tradeoff: AI proposes trades, smart contracts enforce policy, users never give up custody.

The core insight is separating **proposal** from **enforcement**. Real 0G Compute inference (GLM-5-FP8, DeepSeek, Qwen) generates trading decisions, submitted as EIP-712 signed intents. Every swap must pass on-chain policy checks — cooldown, daily cap, slippage, token allowlist — before execution. A **sealed mode** with TEE attestation and commit-reveal prevents MEV front-running, while an **operator marketplace** lets anyone run their own orchestrator with on-chain committed strategy manifests, slashable via governance.

This is live on 0G Aristotle mainnet (chain 16661): **18 contracts deployed**, with organic AI-driven executions already on-chain. The full flow — AI decision → 0G Storage journal → sealed commit → on-chain reveal — runs end-to-end on 0G infrastructure, with Pyth oracles for multi-asset NAV.

---

## Architecture

```
User ─ deposits ─▶ AegisVault (0G mainnet)
                    │
                    └─▶ Owner picks operator from marketplace
                                │
                                ▼
                    Operator runs their own orchestrator
                                │
                                ├─▶ 0G Compute inference (GLM-5-FP8)
                                ├─▶ EIP-712 intent + TEE signature
                                ├─▶ Commit-reveal (sealed mode)
                                └─▶ On-chain executeIntent()

Enforced by Solidity: policy, cooldown, cap, slippage, ECDSA verify.
AI proposes, contract decides.
```

---

## 0G Stack Integration

- **0G Chain** — 18 contracts on mainnet 16661 (vault, factory, registry, staking, governance, treasury, insurance)
- **0G Compute** — Real AI inference (GLM-5-FP8 verified via `processResponse()`), 6+ providers selectable per operator
- **0G Storage** — Decision journals, execution logs, strategy manifests
- **Pyth on 0G** — Multi-asset NAV oracle, slippage protection

---

## Key Deliverables

- **Sealed Strategy Mode** — EIP-712 typed intents, commit-reveal anti-MEV, `attestationReportHash` binds AI inference to on-chain intent
- **Operator Marketplace v2** — On-chain strategy manifest commitment (URI + keccak256 hash), AI model declaration, slashable bonded manifests
- **Production Orchestrator** — O(1) vault indexer, multi-wallet pool (deterministic sharding + per-wallet `NonceManager`), parallel cycles via p-limit, exponential backoff
- **Contract slimming** — Refactored 16KB vault into 3 libraries + EIP-1167 clone factory to fit 0G mainnet block gas (final AegisVault: 3.4KB)
- **Frontend** — React 19 + wagmi/viem, full flows: Dashboard, 6-step Create Vault, Operator Register with AI model + manifest publish, Governance, Token Faucet
- **Testing** — 28/28 tests passing, Slither CI on every push, EIP-712 hash parity between Solidity and orchestrator

---

## Verifiable Execution on 0G Mainnet

**First sealed-mode AI execution (organic):**
- Commit TX: `0x081c80537a10fce866a57e3e6ff74fc9c63127bf31de25d6011cacc80d5c5442`
- Reveal TX: `0x039242e7a5595fb8b715946804e8ca6a53eeb29731a7661e6437a94b34e44365`

**Second organic AI execution (orchestrator cycle #848):**
- TX: `0x96b3e45435156849ee38c8a94c72ab3582a1abba1fa7cbf5d06374777e102a26`
- Source: 0G Compute GLM-5-FP8, confidence 62%, regime RANGE_NOISY

---

## Key Deployed Contracts (chain 16661)

| Contract | Address |
|---|---|
| AegisVaultFactory | `0xE03336e792F061f9fDEbd2B62ce9324f4868a683` |
| AegisVault impl | `0x4720686cCC199fD645B824F8d0A037c44Bc8336A` |
| SealedLib | `0xe8AaB350495bBFf3868f89681eBC36814cB64D61` |
| ExecLib | `0x2e29a14dDbDa85760a765A775B41B69Aca60bAA7` |
| IOLib | `0xa49b7898bfd5eEaC9C0fA748c2309e23a8e876Dd` |
| OperatorRegistry v2 | `0x3D47c351a3503D26338863e79b307091Ff2B37fe` |
| OperatorStaking | `0xC357c0BD2eB75355F070d706E7410C65c309f960` |
| AegisGovernor | `0x33335e59Ad5780d0f07ebcd3549016d28A28F06E` |
| InsurancePool | `0x23F8786Fed248D363641C6c8c0faA40Cc01e55B1` |
| ProtocolTreasury | `0xCc7324188A240450B28FCb54706cEb0B7c7bb9b5` |

---

## Links

- **GitHub:** https://github.com/mdlog/aegis-vault
- **Explorer:** https://chainscan.0g.ai
- **Docs:** [ARCHITECTURE.md](ARCHITECTURE.md) · [DEMO.md](DEMO.md) · [docs/OPERATOR_GUIDE.md](docs/OPERATOR_GUIDE.md) · [docs/STRATEGY_MANIFEST.md](docs/STRATEGY_MANIFEST.md)

---

## Honest Disclosures

- **0G Storage KV** unstable during hackathon window — orchestrator journal falls back to local JSON cache; full 0G Storage paths are implemented and ready when endpoint stabilizes.
- **TEE attestation** depends on 0G Compute provider hardware. Sealed mode delivers ECDSA-verifiable inference commitment + commit-reveal anti-MEV today; hardware-grade TEE (SGX/TDX) awaits attested provider availability.
- **Slim build tradeoffs** — to fit mainnet block gas, streaming management fee accrual and some view functions were removed. Full version remains in history for gas-plentiful chains.

---

## Progress During Hackathon

Built Aegis Vault from zero to live on 0G Aristotle Mainnet during the hackathon window — 18 contracts deployed, organic AI-driven executions verified on-chain.

### Smart contracts (Track 2 sealed mode)
- Designed & implemented sealed strategy mode from scratch: `VaultPolicy` extended with `sealedMode` + `attestedSigner`, `ExecutionIntent` with `attestationReportHash`, `commitIntent()` + `executeIntent(intent, sig)` with commit-reveal + ECDSA verify
- Full EIP-712 typed data hashing with domain separator binding chain ID + vault address (cross-chain replay protection)
- Aggressive slimming: 16KB vault → 3.4KB via 3 external DELEGATECALL libraries (SealedLib, ExecLib, IOLib) + EIP-1167 factory (19KB → 2.7KB)
- 18 contracts total on mainnet (factory, vault impl, 3 libraries, registry v2, staking, reputation, governance, treasury, insurance, NAV calc, venue adapter, mocks)

### Operator marketplace v2
- Extended `OperatorRegistry` with `publishManifest(uri, hash, bonded)` + `declareAIModel(model, provider, endpoint)` — operators commit strategy + AI model on-chain
- Bonded manifests are slashable by governance if execution deviates from published rules
- Frontend: AI model dropdown (fetched live from 0G Compute `listService()`) + manifest JSON upload form (auto-computes keccak256 hash)
- Marketplace displays AI badge + bonded/manifest indicators per operator

### Production-grade orchestrator
- Vault indexer (O(1) lookups, event-driven, persists across restarts) — replaces O(N) RPC scans
- Multi-wallet executor pool with `NonceManager` + deterministic sharding (`hash(vault) % poolSize`) — no nonce collisions across parallel cycles
- Parallel vault processing via `p-limit` (configurable `VAULT_CONCURRENCY`)
- Exponential backoff retry (3x for tx, 2x for 0G Compute), session idempotency, 60s block-polling timeout
- Decentralized operator model — each operator self-hosts their orchestrator, manages only vaults that selected them

### Frontend (React 19 + wagmi + viem)
- 6-step Create Vault wizard with sealed mode toggle, 3-persona landing page CTAs
- Operator register flow with AI model selection + strategy manifest publish
- Operator marketplace with AI + manifest badges, Governance M-of-N UI, Token Faucet, AI Actions journal feed
- Full 0G mainnet integration

### CI/CD + Testing + Docs
- `.github/workflows/security.yml` — Slither static analysis on every push
- 28/28 tests passing for slim build (sealed mode, commit-reveal, EIP-712)
- Complete docs: README, ARCHITECTURE, DEMO, OPERATOR_GUIDE, STRATEGY_MANIFEST + example JSON, AI_AGENT_DECISION_FLOW

### Metrics
- **100+ commits** during hackathon
- **~12,000 lines** of Solidity + TypeScript + documentation
- **18 contracts** deployed to 0G Aristotle mainnet
- **Multiple verified on-chain executions** including organic AI-driven sealed mode flow

---

## Fundraising Status

**Current status:** 🟡 Not actively fundraising. Bootstrapped through hackathon.

**Team & funding context:**
- **Solo builder** (self-funded, hackathon-bootstrapped)
- **Built from scratch during hackathon** — no prior codebase, no grants, no pre-committed capital
- **Gas costs self-covered** (~7 0G for full mainnet deploy + testing)
- **No token planned** — protocol revenue flows to `ProtocolTreasury` contract, governed by M-of-N multi-sig; intended for audit costs, bug bounties, insurance pool top-ups

**What seed funding would enable (if/when raised):**

| Priority | Item | Estimated cost |
|---|---|---|
| 1 | Smart contract audit (Certik / OpenZeppelin / Trail of Bits) | $30–80k |
| 2 | Insurance underwriting (Nexus Mutual or native pool capitalization) | $50–200k |
| 3 | Dedicated orchestrator infrastructure (multi-region, monitoring, SLA) | $30k/yr |
| 4 | Frontend redesign + compliance review for regulated capital access | $40k |
| 5 | Operator bootstrap grants (pay first 5 operators to run orchestrators) | $50k |
| 6 | Community + developer relations | $30k/yr |

**Total target seed raise:** $500k–$1M — to ship Aegis to audited, insured, institutional-grade production.

**Asks from 0G Foundation / hackathon organizers:**
- Dedicated 0G RPC endpoint for orchestrator (current public RPC has reliability issues)
- Access to TEE-attested 0G Compute providers (for genuine hardware-grade sealed mode)
- Feedback on vault factory gas patterns (block gas limit fluctuations caused deployment challenges)
- Connection to ecosystem insurance partners if/when we mature

**Open to:**
- Ecosystem grants (builds-on-0G grants, Track 2 winner prize)
- Strategic angel investors (DeFi operators, TradFi hedge funds exploring AI vaults)
- Technical partnerships (Gelato for keeper network, The Graph for subgraph indexing, Pyth for extended oracle coverage)

**Not open to:**
- Extractive token launches
- Retail-only accelerators without regulatory support
- Anything that would compromise the "contract enforces" trust model

**Timeline:**
- **Short-term** (4 weeks post-hackathon): polish, public beta with 3 whitelisted operators, first external deposits
- **Medium-term** (3 months): smart contract audit, launch ERC-4626 vault shares, strategy template registry
- **Long-term** (6–12 months): seed fundraise conditional on traction (TVL > $1M, >10 active operators, audit-clean report)
