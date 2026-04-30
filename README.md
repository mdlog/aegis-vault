<p align="center">
  <img src="aegis-vault-logo.png" alt="Aegis Vault" width="420" />
</p>

<p align="center">
  <strong>Verifiable-AI risk manager with on-chain execution guardrails, live on 0G Aristotle Mainnet.</strong>
</p>

<p align="center">
  <a href="https://chainscan.0g.ai/address/0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3"><img src="https://img.shields.io/badge/0G_Mainnet-live-brightgreen?style=for-the-badge" alt="0G mainnet" /></a>
  <img src="https://img.shields.io/badge/Contracts-235_tests_passing-brightgreen?style=for-the-badge" alt="Tests" />
  <img src="https://img.shields.io/badge/Slither-fail_on_high-blue?style=for-the-badge" alt="Slither" />
  <img src="https://img.shields.io/badge/SDK-%40aegis--vault%2Fsdk_v0.3.0-cyan?style=for-the-badge" alt="SDK" />
</p>

---

## Hackathon submission — Why we should win

Track 2 (Verifiable Finance) on 0G — graded on **production rigor + integration depth + verifiable AI**, not a demo behind a slide deck.

- **Sealed-strategy commit-reveal is live, not mocked.** First sealed-mode execution on 0G mainnet: BUY 0G tx [`0x0d7334b8…`](https://chainscan.0g.ai/tx/0x0d7334b8) on **2026-04-27** — orchestrator pre-commits `keccak(intentHash, attestationReportHash)` at block N, reveals at ≥ N+1, and `SealedLib.ecrecover()` verifies the TEE signature on-chain against `policy.attestedSigner`. Strategy params never leave the TEE; MEV searchers cannot front-run the intent.
- **AI inference runs on 0G Compute and the output is cryptographically bound to the trade.** GLM-5-FP8 via the 0G serving broker, output hash committed into the EIP-712 `ExecutionIntent`, attested by the TEE signer key — the same key the on-chain vault verifies. Local heuristic fallback is gated off in `STRICT_MODE=1`.
- **End-to-end real money path proven on 0G mainnet.** First public execution [`0x7efe51ac…`](https://chainscan.0g.ai/tx/0x7efe51ac) on **2026-04-24**: AI decision → policy guardrails (`ExecLib`) → real swap on Jaine DEX → settlement → reputation update on `OperatorReputation`. No middleman, no upgradeable backdoor.
- **Audit-grade contract suite.** 235 Hardhat tests passing, Slither **fail-on-high**, EIP-1167 minimal proxies (~2.7 KB) so 0G's per-block gas limit is respected. The full marketplace — `OperatorRegistry` + `Staking` + `Reputation` + `InsurancePool` + multisig `AegisGovernor` — is deployed and addressable in the table below.
- **Verifiable AI is visible in the UI, not buried in logs.** The dashboard surfaces a **`Sealed · TEE`** chip on every sealed vault and a **`TEE`** badge on every attested action in the AI Intelligence Feed — each linking to the real commit transaction on the explorer. A juror can verify the chain-of-trust without reading code.
- **Cross-chain via Khalani, not bridged trust.** V3 ships the Khalani venue adapter so a 0G-native intent can settle on Arbitrum without giving the orchestrator custody on the destination chain.

Read the architecture deep-dive in [ARCHITECTURE.md](ARCHITECTURE.md) and the full submission writeup in [HACKATHON_SUBMISSION.md](HACKATHON_SUBMISSION.md).

---

## What it is

Aegis Vault lets a user deposit stablecoins into a vault, pick an AI operator from an on-chain marketplace, and let autonomous execution happen inside a narrow, enforced policy. The AI can only *propose* trades; the vault contract enforces every rule (max position, stop-loss, cooldowns, slippage, allowed assets, fee caps, cross-chain replay protection). Every decision is logged, every fee is split 80/20 with the protocol treasury, every slash is governance-gated, and every operator carries on-chain reputation that users can sort on.

Built for **Track 2 — Agentic Trading Arena (Verifiable Finance)**: inference runs on 0G Compute (GLM-5-FP8), the output hash is bound into an EIP-712 intent, a TEE signer attests the decision, and commit–reveal prevents front-running — enforced on-chain with no trusted middleman.

## Live on 0G Aristotle Mainnet (chain 16661)

V3 vault stack with the Khalani cross-chain adapter shipped **2026-04-27** after audit-pass hardening (235 contract tests). The operator marketplace contracts (registry / staking / reputation / insurance) were redeployed the same day for a clean post-audit baseline.

| Contract | Address |
|---|---|
| AegisVaultFactoryV3 | [`0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3`](https://chainscan.0g.ai/address/0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3) |
| AegisVault impl (V3) | [`0x0c78257550802bF2fFD201106Fe8096A5211397e`](https://chainscan.0g.ai/address/0x0c78257550802bF2fFD201106Fe8096A5211397e) |
| ExecutionRegistry (V3) | [`0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9`](https://chainscan.0g.ai/address/0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9) |
| OperatorRegistry | [`0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9`](https://chainscan.0g.ai/address/0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9) |
| OperatorStaking | [`0xe153A071FBFFa20Bd1a016C545745EFcAC3F2bc3`](https://chainscan.0g.ai/address/0xe153A071FBFFa20Bd1a016C545745EFcAC3F2bc3) |
| OperatorReputation | [`0x855380187f223391b55fc381f33429A14d238879`](https://chainscan.0g.ai/address/0x855380187f223391b55fc381f33429A14d238879) |
| InsurancePool | [`0xd5eb21420e9D22b763b94fDb396756d820eCa694`](https://chainscan.0g.ai/address/0xd5eb21420e9D22b763b94fDb396756d820eCa694) |
| ProtocolTreasury | [`0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4`](https://chainscan.0g.ai/address/0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4) |
| AegisGovernor (multisig) | [`0x023EC4a54435f94E9395460e4835e75E429D5A2e`](https://chainscan.0g.ai/address/0x023EC4a54435f94E9395460e4835e75E429D5A2e) |
| VaultNAVCalculator (Pyth) | [`0xBd21bfd62a11e1F8d04e7bE42D2cbDB6C51C4Ae1`](https://chainscan.0g.ai/address/0xBd21bfd62a11e1F8d04e7bE42D2cbDB6C51C4Ae1) |
| JaineVenueAdapterV2 (multi-hop) | [`0x261244010A6D87e043b3489D93fA573cdc2274B6`](https://chainscan.0g.ai/address/0x261244010A6D87e043b3489D93fA573cdc2274B6) |
| KhalaniVenueAdapter (cross-chain) | [`0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4`](https://chainscan.0g.ai/address/0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4) |
| CrossChainLib | [`0x505C1C76520C6a47a1C0Bf8819359c786E3c8aB3`](https://chainscan.0g.ai/address/0x505C1C76520C6a47a1C0Bf8819359c786E3c8aB3) |

Live tokens include `USDC.e`, `W0G`, `USDT`, `WETH`, `cbBTC` — see [`contracts/deployments-mainnet.json`](contracts/deployments-mainnet.json) for the full address book and active Jaine pool list.

**Arbitrum One mirror** (chain `42161`, deployed 2026-04-21): V1 stack only — `AegisVaultFactory` at [`0x49354460eAdE1C2E786E36B3B3e7A18Fb4283C45`](https://arbiscan.io/address/0x49354460eAdE1C2E786E36B3B3e7A18Fb4283C45) with Uniswap V3 venue and Pyth NAV. The full marketplace stack (`OperatorRegistry`, `Staking`, `Reputation`, `Governor`, `InsurancePool`) currently lives only on 0G. Full Arbitrum address book: [`contracts/deployments-arbitrum.json`](contracts/deployments-arbitrum.json). See [`docs/ARBITRUM_BRINGUP.md`](docs/ARBITRUM_BRINGUP.md) for the V3 parity plan.

**First on-chain execution** (AI → policy → DEX, end-to-end): [`0x7efe51ac…`](https://chainscan.0g.ai/tx/0x7efe51ac) on **2026-04-24** — orchestrator cycle BUY 0G on Jaine, signed by the TEE signer, verified through `AegisVault.executeIntent()`. (Recorded against the V2 vault stack that preceded the V3 cutover; the V3 reputation registry starts fresh.)

> **Pyth oracle guard note (Jaine adapter):** `OracleGuardLib.checkDeviation()` is wired into every venue adapter, but the on-chain Pyth feeds on 0G are not currently pushed frequently enough to satisfy the 5-minute staleness check. The guard is therefore set to `address(0)` on the live `JaineVenueAdapter`, and the adapter's `maxSlippageBps` cap is the active price-protection mechanism. The guard will be re-enabled once Pyth Hermes push cadence on 0G meets the threshold (or migrated to a pull-at-swap model). Pyth is still used in production by `VaultNAVCalculator` for share-price NAV computation.

## Architecture

```
User → Frontend (React)
         │
         ▼
Vault ─ DELEGATECALL ─▶ ExecLib (EIP-712, policy, swap pipeline)
  │                    ▶ SealedLib (ecrecover for TEE attestation)
  │                    ▶ IOLib     (deposit / withdraw + entry/exit fees)
  │
  ├── ExecutionRegistry (replay guard, intent history)
  ├── OperatorRegistry + Staking + Reputation (tiered marketplace)
  ├── ProtocolTreasury / InsurancePool
  └── AegisGovernor (M-of-N multisig for slashing + treasury spend)

        ▲                         ▲
 executeIntent              commitIntent (sealed)
        │                         │
Orchestrator (Node.js) ── 0G Compute (GLM-5-FP8) ── Pyth (multi-asset NAV)
```

**Slim build**: `AegisVault` is 3.4 KB (was 16 KB) so it fits 0G's per-block gas limit. Heavy logic is in 3 external libraries; the factory deploys vaults as EIP-1167 minimal proxies (~2.7 KB each).

**Sealed-strategy mode** — opt-in per vault, **live on 0G mainnet** ([first sealed reveal `0x0d7334b8…` on 2026-04-27](https://chainscan.0g.ai/tx/0x0d7334b8)). Three properties, all enforced on-chain:

1. **MEV-resistant.** Orchestrator commits `keccak(intentHash, attestationReportHash)` at block N; `SealedLib` only accepts the matching reveal at block ≥ N+1. A searcher reading the mempool sees nothing they can act on — the asset, side, and size are inside the hashed intent until the reveal block.
2. **TEE-bound.** `attestationReportHash` pins the execution to the exact 0G Compute provider + session that produced the inference. The intent ECDSA signature is verified by `SealedLib.ecrecover()` against `policy.attestedSigner`; an unattested orchestrator wallet cannot forge intents even if it holds executor privileges.
3. **Strategy-confidential.** The model prompt, weights, and decision context never leave the TEE. The chain only sees a hash. The vault's `policy.attestedSigner` is the only thing the verifier needs to trust — and it's a single ECDSA address, not a model.

Frontend renders a `Sealed · TEE` chip on every sealed vault and a `TEE` badge on every attested action so a juror — or any user — can verify the chain-of-trust by clicking through to the commit tx on the explorer.

## Security guarantees

- **AI has zero authority.** It can only propose intents. Every trade runs through the vault's policy check (`ExecLib`).
- **Single-use intents.** EIP-712 hashes are tracked by `ExecutionRegistry` — replay-proof across chains and across vaults.
- **Fee caps are code, not policy.** `perf ≤ 30% · mgmt ≤ 5% · entry/exit ≤ 2%` enforced in `AegisVault.initialize()` and cannot be raised later.
- **Sealed mode**: only `policy.attestedSigner` can authorize execution — enforced by `SealedLib.verifyAttestation()`.
- **Commit–reveal**: sealed intent committed at block N cannot execute before block N+1. Anti-MEV.
- **Slash + treasury spend**: every motion passes through `AegisGovernor` M-of-N approval.
- **CI gate**: Slither runs with `fail-on: high` on every contracts/ change — [security.yml](.github/workflows/security.yml).

## Quick start

```bash
# 1. Contracts
cd contracts && npm install
npm run test:all                 # 235 passing

# 2. Orchestrator
cd ../orchestrator && npm install --legacy-peer-deps
cp .env.example .env             # fill EXECUTOR_PRIVATE_KEY + TEE_SIGNER_PRIVATE_KEY + 0G keys
npm start                        # API on :4002

# 3. Frontend
cd ../frontend && npm install
npm run dev                      # :5173

# 4. SDK (optional, for programmatic access)
cd ../sdk && npm install
npm test                         # 73 passing
```

**One-shot with Docker:**
```bash
cp .env.example .env
docker compose up --build        # orchestrator :4002 + frontend :8080
```

**MetaMask networks**
- Testnet — RPC `https://evmrpc-testnet.0g.ai` · Chain `16602` · Symbol `A0GI`
- Mainnet — RPC `https://evmrpc.0g.ai` · Chain `16661` · Symbol `0G`

**Deploy fresh stack** (production):
```bash
cd contracts
GOVERNOR_OWNERS="0xaaa,0xbbb,0xccc" GOVERNOR_THRESHOLD=2 \
ARBITRATOR_ADDRESS=0xddd TRANSFER_ADMINS=1 CONFIRM_MAINNET=1 \
  npx hardhat run scripts/deploy-mainnet.js --network og_mainnet
node scripts/sync-frontend.js deployments.json
```

## Economic model (default)

- Perf fee **15%** (max 30%) — only on net-new profit above high-water mark
- Mgmt fee **2%/yr** (max 5%) — streamed on NAV
- Entry / exit **0% / 0.5%** (max 2% each)
- Every fee: **80% operator · 20% protocol treasury**
- Operator stake → vault size cap: None $5k · Bronze ($1k) $50k · Silver ($10k) $500k · Gold ($100k) $5M · Platinum ($1M) unlimited
- Slash up to 50% per governance action → funds flow to `InsurancePool` for user claims

## Repo layout

```
contracts/       Hardhat — 15 core contracts + 174-test suite, Slither CI
orchestrator/    Node.js — 0G Compute client, EIP-712 signer, cycle runner, REST API
frontend/        React + Vite + wagmi — vault UI, operator marketplace, governance
sdk/             @aegis-vault/sdk v0.3.0 — ethers v6 clients + orchestrator HTTP wrapper
docker-compose.yml  one-command local bring-up (orchestrator + frontend)
```

## V3 audit-pass surface

Factory role separation (depositor/owner ≠ executor), owner emergency controls (`pause`/`unpause`/`setExecutor`/`setVenue`), on-chain `maxPositionBps` trade-size cap, `consumedKhalaniIds` double-credit guard, multi-factory `ExecutionRegistry` (`authorizedFactories` + Ownable2Step admin), Pyth confidence-band check in `OracleGuardLib`, 80/20 protocol fee split. Deploy procedure: [`docs/V3_KHALANI_ROLLOUT.md`](docs/V3_KHALANI_ROLLOUT.md).

## What's next (roadmap)

- **Arbitrum V3 parity** — port `OperatorRegistry`, `Staking`, `Reputation`, `Governor`, `InsurancePool`, then V3 vault + Khalani onto Arbitrum One.
- **External operator onboarding** — open `OperatorRegistry` to the first wave of third-party operators using [`OPERATOR_REGISTRATION_KIT.md`](OPERATOR_REGISTRATION_KIT.md).
- **Phase 3 Khalani auto-execution end-to-end** — orchestrator submission flow ready (`submitCrossChainIntent`), gated by per-vault `maxCrossChainFeeBps` ≥ Khalani solver fee.
- **Pyth deviation guard re-enable** on Jaine adapter once 0G push cadence is acceptable.

See [`docs/PRODUCT_VALUE_AND_MARKET_POTENTIAL.md`](docs/PRODUCT_VALUE_AND_MARKET_POTENTIAL.md) for the full phased roadmap (Phase 0 → Phase 5).

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — economic model, state diagrams, threat analysis
- [CONTRACTS.md](CONTRACTS.md) — per-contract reference
- [WHITEPAPER.md](WHITEPAPER.md) — full protocol design
- [docs/PRODUCT_VALUE_AND_MARKET_POTENTIAL.md](docs/PRODUCT_VALUE_AND_MARKET_POTENTIAL.md) — market fit, problem-solving, roadmap
- [docs/ARBITRUM_BRINGUP.md](docs/ARBITRUM_BRINGUP.md) — Arbitrum deployment status & V2 parity plan
- [OPERATOR_REGISTRATION_KIT.md](OPERATOR_REGISTRATION_KIT.md) — onboarding kit for third-party AI operators
- [sdk/README.md](sdk/README.md) — SDK API surface with examples

## License

MIT
