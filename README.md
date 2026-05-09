<p align="center">
  <img src="aegis-vault-logo.png" alt="Aegis Vault" width="420" />
</p>

<p align="center">
  <strong>Verifiable-AI risk manager with on-chain execution guardrails. Live on 0G Aristotle Mainnet.</strong>
</p>

<p align="center">
  <a href="https://chainscan.0g.ai/address/0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3"><img src="https://img.shields.io/badge/0G_Mainnet-live-brightgreen?style=for-the-badge" alt="0G mainnet" /></a>
  <img src="https://img.shields.io/badge/Tests-235_passing-brightgreen?style=for-the-badge" alt="Tests" />
  <img src="https://img.shields.io/badge/Slither-fail--on--high-blue?style=for-the-badge" alt="Slither" />
</p>

---

## What it is

Deposit stablecoins, pick an AI operator, let autonomous execution happen inside a narrow on-chain policy. The AI only *proposes* trades; the vault enforces hard rules on-chain (position size cap, slippage, allowed-asset whitelist, fee caps, cooldown, intent expiry). Inference runs on **0G Compute (GLM-5-FP8)**, the output is bound into an **EIP-712 intent** signed by an **attested signer key** (see *what attestation means* below), and **commit–reveal** prevents front-running.

## Live deployments (0G Aristotle, chain `16661`)

| Contract | Address |
|---|---|
| AegisVaultFactoryV3 | [`0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3`](https://chainscan.0g.ai/address/0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3) |
| ExecutionRegistry | [`0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9`](https://chainscan.0g.ai/address/0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9) |
| OperatorRegistry | [`0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9`](https://chainscan.0g.ai/address/0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9) |
| AegisGovernor (multisig) | [`0x023EC4a54435f94E9395460e4835e75E429D5A2e`](https://chainscan.0g.ai/address/0x023EC4a54435f94E9395460e4835e75E429D5A2e) |
| JaineVenueAdapterV2 | [`0x261244010A6D87e043b3489D93fA573cdc2274B6`](https://chainscan.0g.ai/address/0x261244010A6D87e043b3489D93fA573cdc2274B6) |
| KhalaniVenueAdapter | [`0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4`](https://chainscan.0g.ai/address/0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4) |

Full address book: [`contracts/deployments-mainnet.json`](contracts/deployments-mainnet.json) · Arbitrum mirror: [`contracts/deployments-arbitrum.json`](contracts/deployments-arbitrum.json)

**Proven on-chain:** first AI→policy→DEX execution [`0x7efe51ac…`](https://chainscan.0g.ai/tx/0x7efe51ac) (2026-04-24) · first sealed-mode reveal [`0x0d7334b8…`](https://chainscan.0g.ai/tx/0x0d7334b8) (2026-04-27).

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

**MetaMask** — Mainnet RPC `https://evmrpc.0g.ai` · Chain `16661` · Symbol `0G`

## Security model

What is enforced **on-chain** by `ExecLib`:

- AI has **zero authority** — only proposes intents.
- **Single-use intents** — EIP-712 hashes tracked in `ExecutionRegistry`, replay-proof.
- **Fee caps in code** — perf ≤ 30%, mgmt ≤ 5%, entry/exit ≤ 2%; immutable after init.
- **Position size cap, asset whitelist, cooldown, intent expiry, AI-confidence floor, daily action count.**
- **Sealed mode** — `commit(keccak(intentHash, attestationReportHash))` at block N, reveal ≥ N+1; `SealedLib.ecrecover()` verifies the attested-signer ECDSA signature against `policy.attestedSigner`.
- **Governance-gated** — slashing and treasury spend require `AegisGovernor` M-of-N approval.
- **CI** — Slither `fail-on: high` on every contracts/ change.

What is enforced **off-chain** by the orchestrator (with on-chain `pause()` as the emergency cut-off):

- **`maxDailyLossBps`** (24h drawdown halt) and **`stopLossBps`** (NAV-relative stop-loss) — these fields live in the policy struct but their on-chain enforcement requires per-vault PnL state the V3 storage layout does not yet carry, so the orchestrator's risk-veto is the gate. A compromised or stalled orchestrator therefore cannot itself drain the vault (every trade still passes the on-chain rules above), but it can fail to halt on a drawdown — owners should pair this with the V3 owner-only `pause()` and `setExecutor()` controls. PnL-aware on-chain enforcement is on the V3.1 roadmap.

What "attested signer" actually means:

- `policy.attestedSigner` is an ECDSA address. The vault's sealed-mode and cross-chain paths verify a signature over the intent's EIP-712 digest with `ecrecover` and reject anything that does not match. **This is a key-bound signer, not a remote-attestation enclave verifier** — the chain does not parse SGX/TDX quotes and does not check `MRENCLAVE` / `MRSIGNER`. The off-chain pipeline is *intended* to run inside a 0G Compute TEE so that the signing key never leaves the enclave, but trust ultimately reduces to "whoever holds the private key bound to `attestedSigner` can produce valid sealed intents". To bound the blast radius:
  - The depositor (vault owner) can rotate the signer at any time via `setAttestedSigner`, or set it to `address(0)` to disable sealed-mode attestation entirely.
  - Sealed mode is opt-in per vault. Public-mode vaults do not require any attestation key.
  - On-chain enclave-quote verification is on the roadmap and will move this from "key-bound" to "enclave-bound" when shipped.

## Repo layout

```
contracts/       Hardhat — 15 core contracts, 235-test suite, Slither CI
orchestrator/    Node.js — 0G Compute client, EIP-712 signer, REST API
frontend/        React + Vite + wagmi — vault UI, marketplace, governance
sdk/             @aegis-vault/sdk — ethers v6 + orchestrator HTTP wrapper
```

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design + threat model
- [CONTRACTS.md](CONTRACTS.md) — per-contract reference
- [WHITEPAPER.md](WHITEPAPER.md) — full protocol design
- [HACKATHON_SUBMISSION.md](HACKATHON_SUBMISSION.md) — Track 2 submission writeup
- [OPERATOR_REGISTRATION_KIT.md](OPERATOR_REGISTRATION_KIT.md) — third-party operator onboarding

## License

MIT
