<p align="center">
  <img src="aegis-vault-logo.png" alt="Aegis Vault" width="420" />
</p>

<p align="center">
  <strong>Verifiable-AI risk manager with on-chain execution guardrails.</strong>
  <br />
  Live on 0G Aristotle Mainnet · <a href="https://aegisvaults.xyz">aegisvaults.xyz</a>
</p>

<p align="center">
  <a href="https://chainscan.0g.ai/address/0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F"><img src="https://img.shields.io/badge/0G_Mainnet-V4_live-brightgreen?style=for-the-badge" alt="0G mainnet" /></a>
  <img src="https://img.shields.io/badge/Tests-285_passing-brightgreen?style=for-the-badge" alt="Tests" />
  <img src="https://img.shields.io/badge/Slither-fail--on--high-blue?style=for-the-badge" alt="Slither" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License" />
</p>

---

## What it is

Aegis Vault is a non-custodial vault: deposit stablecoins, pick an AI operator from the marketplace, and let autonomous execution happen inside a narrow on-chain policy. The AI **only proposes** trades. The vault **enforces** the rules — position size, slippage, asset whitelist, fee caps, cooldown, intent expiry, and (V4) the operator's strategy manifest itself.

## Highlights

- **V4 strategy-manifest binding** — every clone commits an `acceptedManifestHash` at create time; `executeIntent` reverts unless `intent.strategyHash` matches. The EIP-712 typehash includes `strategyHash` + `strategySchemaVer`, making cross-version replay impossible by construction.
- **Sealed mode + commit-reveal** — AI inference runs on **0G Compute (GLM-5-FP8)**; the response hash is bound into the EIP-712 intent, ECDSA-verified against `policy.attestedSigner`, with a one-block commit-reveal to block front-running.
- **285 contract tests passing**, Slither `fail-on: high` in CI, **127 audit findings surfaced pre-V4** with 11 Highs landed before mainnet cutover.
- **Marketplace shipped fresh at V4 cutover** — Registry / Staking / Reputation / Insurance all governance-bound (arbitrator/admin = AegisGovernor multisig) from `t=0`; 0 vaults, 0 operators, 0 claims at launch.
- **Two chains, one vault contract** — same V4 bytecode on 0G Aristotle (Jaine V3 venue) and Arbitrum One (Uniswap V3 venue); EIP-712 `chainid` in the domain separator prevents cross-chain replay.

## Live on 0G Aristotle (chain `16661`)

**Entry point** (V4 factory):
[`0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F`](https://chainscan.0g.ai/address/0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F)

The complete address book — V4 stack, marketplace contracts, libraries, adapters, and retired V3 trail — is in [`CONTRACTS.md`](CONTRACTS.md). Raw JSON in [`contracts/deployments-mainnet.json`](contracts/deployments-mainnet.json). Arbitrum mirror: [`contracts/deployments-arbitrum.json`](contracts/deployments-arbitrum.json).

**Proven on-chain (V3 stack):** first AI→policy→DEX execution [`0x7efe51ac…`](https://chainscan.0g.ai/tx/0x7efe51ac) (2026-04-24) · first sealed-mode reveal [`0x0d7334b8…`](https://chainscan.0g.ai/tx/0x0d7334b8) (2026-04-27). V4 first execution pending operator onboarding on the fresh marketplace.

## Quick start

```bash
# Contracts
cd contracts && npm install && npm run test:all

# Orchestrator
cd ../orchestrator && npm install --legacy-peer-deps
cp .env.example .env    # fill EXECUTOR_PRIVATE_KEY + TEE_SIGNER_PRIVATE_KEY + 0G keys
npm start               # :4002

# Frontend
cd ../frontend && npm install && npm run dev    # :5173
```

One-shot with Docker:

```bash
cp .env.example .env
docker compose up --build    # orchestrator :4002 + frontend :8080
```

**MetaMask** — RPC `https://evmrpc.0g.ai` · Chain `16661` · Symbol `0G`

## Security model

**On-chain (immutable, every trade):**

- AI has zero authority — it only proposes intents.
- Single-use EIP-712 intents tracked in `ExecutionRegistry`; both-sides asset-whitelist check in `ExecLib`.
- Fee caps in code (perf ≤ 30%, mgmt ≤ 5%, entry/exit ≤ 2%); immutable after init.
- Sealed mode: commit-reveal at block N → reveal ≥ N+1, ECDSA verify against `policy.attestedSigner`.
- Slashing and treasury spend gated by `AegisGovernor` M-of-N approval.
- Slither `fail-on: high` in CI on every `contracts/` change.

**Off-chain (orchestrator-side, with on-chain `pause()` as emergency cut-off):**

`maxDailyLossBps` and `stopLossBps` are gated by the orchestrator's risk-veto today — V3 storage layout carries no per-vault PnL accumulator, so on-chain enforcement is on the V3.1 roadmap. A compromised orchestrator cannot itself drain a vault (every trade still passes the on-chain rules above) but it can fail to halt on a drawdown. Owners can `pause()` and `setExecutor()` at any time.

**What `attestedSigner` means today:** an ECDSA address — sealed-mode and cross-chain paths verify the signature via `ecrecover`. The chain does **not** parse SGX/TDX quotes (no `MRENCLAVE` check on-chain). The off-chain pipeline is intended to run inside a TEE so the key never leaves the enclave, but trust today reduces to "whoever holds the signer key can produce valid sealed intents." Depositors can rotate the signer or disable sealed mode at any time. On-chain enclave-quote verification is on the roadmap. Full details: [ARCHITECTURE.md § 6](ARCHITECTURE.md).

## Repo layout

```
contracts/       Hardhat — V4 vault stack, 285-test suite, Slither CI
orchestrator/    Node.js — 0G Compute client, EIP-712 signer, REST API
frontend/        React + Vite + wagmi — vault UI, marketplace, governance
sdk/             @aegis-vault/sdk — ethers v6 + orchestrator HTTP wrapper
docs/            Operator runbook, AI decision flow, V4 migration, TEE attestation
```

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, threat model, sealed-mode internals
- [CONTRACTS.md](CONTRACTS.md) — full V4 address book + retired V3 trail
- [WHITEPAPER.md](WHITEPAPER.md) — protocol design
- [DEMO.md](DEMO.md) — end-to-end demo walkthrough
- [docs/RUN_OPERATOR_ORCHESTRATOR.md](docs/RUN_OPERATOR_ORCHESTRATOR.md) — operator runbook
- [docs/V4_MIGRATION_GUIDE.md](docs/V4_MIGRATION_GUIDE.md) — V3 → V4 depositor migration
- [docs/TEE_ATTESTATION_VERIFICATION.md](docs/TEE_ATTESTATION_VERIFICATION.md) — sealed-mode cryptographic proof walkthrough
- [docs/AI_AGENT_DECISION_FLOW.md](docs/AI_AGENT_DECISION_FLOW.md) — how the AI proposes trades
- [docs/STRATEGY_MANIFEST.md](docs/STRATEGY_MANIFEST.md) — operator strategy manifest spec

## License

MIT.

Built by [MDLOG Labs](https://github.com/mdlog). Live frontend at [aegisvaults.xyz](https://aegisvaults.xyz).
