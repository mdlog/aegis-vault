<p align="center">
  <img src="aegis-vault-logo.png" alt="Aegis Vault" width="420" />
</p>

<p align="center">
  <strong>Verifiable-AI risk manager with on-chain execution guardrails. Live on 0G Aristotle Mainnet.</strong>
</p>

<p align="center">
  <a href="https://chainscan.0g.ai/address/0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F"><img src="https://img.shields.io/badge/0G_Mainnet-V4_live-brightgreen?style=for-the-badge" alt="0G mainnet" /></a>
  <img src="https://img.shields.io/badge/Tests-285_passing-brightgreen?style=for-the-badge" alt="Tests" />
  <img src="https://img.shields.io/badge/Slither-fail--on--high-blue?style=for-the-badge" alt="Slither" />
</p>

---

## What it is

Deposit stablecoins, pick an AI operator, let autonomous execution happen inside a narrow on-chain policy. The AI only *proposes* trades; the vault enforces hard rules on-chain (position size cap, slippage, allowed-asset whitelist, fee caps, cooldown, intent expiry). Inference runs on **0G Compute (GLM-5-FP8)**, the output is bound into an **EIP-712 intent** signed by an **attested signer key** (see *what attestation means* below), and **commit–reveal** prevents front-running. V4 adds operator strategy-manifest binding — every clone commits an `acceptedManifestHash` at create time and only executes intents that match.

## Live deployments (0G Aristotle, chain `16661`)

V4 stack — fresh deploy 2026-05-14, post-audit (11 Highs landed). Marketplace started clean: 0 vaults, 0 operators.

| Contract | Address |
|---|---|
| **AegisVaultFactoryV4** | [`0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F`](https://chainscan.0g.ai/address/0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F) |
| AegisVault_v4 impl | [`0x28F8E1a9Af4eBF4Df323861F499B8d87295b72Ed`](https://chainscan.0g.ai/address/0x28F8E1a9Af4eBF4Df323861F499B8d87295b72Ed) |
| ExecLibV4 | [`0x3080424E4d8E9CEde828151d85D526374e176108`](https://chainscan.0g.ai/address/0x3080424E4d8E9CEde828151d85D526374e176108) |
| CrossChainLibV4 | [`0x049DF2321DD1D409799139b5A5b475d2E8a8B536`](https://chainscan.0g.ai/address/0x049DF2321DD1D409799139b5A5b475d2E8a8B536) |
| ExecutionRegistry | [`0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9`](https://chainscan.0g.ai/address/0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9) |
| OperatorRegistry (fresh) | [`0x8A12238E20e9CE5D8Ea350E58B7d03D0551CA22b`](https://chainscan.0g.ai/address/0x8A12238E20e9CE5D8Ea350E58B7d03D0551CA22b) |
| OperatorStaking_v2 (fresh) | [`0xF46b6b76c5021a21dc0029FDEAEba6713472CBE6`](https://chainscan.0g.ai/address/0xF46b6b76c5021a21dc0029FDEAEba6713472CBE6) |
| OperatorReputation (fresh) | [`0x4389d082dE464defF665612A73f36b99059F2Da4`](https://chainscan.0g.ai/address/0x4389d082dE464defF665612A73f36b99059F2Da4) |
| InsurancePool_v2 (fresh) | [`0xe69eAff976b6AEf35556cb3D09972E401a85DD77`](https://chainscan.0g.ai/address/0xe69eAff976b6AEf35556cb3D09972E401a85DD77) |
| AegisGovernor (multisig) | [`0x023EC4a54435f94E9395460e4835e75E429D5A2e`](https://chainscan.0g.ai/address/0x023EC4a54435f94E9395460e4835e75E429D5A2e) |
| VaultNAVCalculator (Pyth) | [`0xFA632b02dFe6770E0B147659fD336980E138bA3a`](https://chainscan.0g.ai/address/0xFA632b02dFe6770E0B147659fD336980E138bA3a) |
| JaineVenueAdapterV2 | [`0xA4E2aeB9e1a5297DE38d7Ad8e11b1714ca481F2f`](https://chainscan.0g.ai/address/0xA4E2aeB9e1a5297DE38d7Ad8e11b1714ca481F2f) |
| KhalaniVenueAdapter | [`0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4`](https://chainscan.0g.ai/address/0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4) |
| ProtocolTreasury | [`0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4`](https://chainscan.0g.ai/address/0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4) |

All four marketplace contracts (Registry / Staking / Reputation / Insurance) are governance-bound — arbitrator/admin is the AegisGovernor multisig, closing audit H-6/H-7/H-9.

V3 factory (`0x75668Ca9…`) is retired for new vault creation; the 1 existing V3 test vault is preserved at chain head but the UI surfaces V4 only (frontend flag `VITE_SHOW_ONLY_V4_VAULTS=1`).

Full address book + retired addresses: [`contracts/deployments-mainnet.json`](contracts/deployments-mainnet.json) · Arbitrum mirror: [`contracts/deployments-arbitrum.json`](contracts/deployments-arbitrum.json)

**Proven on-chain:** first AI→policy→DEX execution [`0x7efe51ac…`](https://chainscan.0g.ai/tx/0x7efe51ac) (2026-04-24) · first sealed-mode reveal [`0x0d7334b8…`](https://chainscan.0g.ai/tx/0x0d7334b8) (2026-04-27) — both on the prior V3 stack. V4 first execution pending operator onboarding on the fresh marketplace.

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
contracts/       Hardhat — 15 core contracts, 285-test suite, Slither CI
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
- [docs/V4_DEPLOY_AUDIT_RUNBOOK.md](docs/V4_DEPLOY_AUDIT_RUNBOOK.md) — V4 deploy + post-audit runbook

## License

MIT
