<p align="center">
  <img src="aegis-vault-logo.png" alt="Aegis Vault" width="420" />
</p>

<p align="center">
  <strong>Verifiable-AI risk manager with on-chain execution guardrails, live on 0G Aristotle Mainnet.</strong>
</p>

<p align="center">
  <a href="https://chainscan.0g.ai/address/0x9450ac911D06c81a54007a768d4278929d87A17e"><img src="https://img.shields.io/badge/0G_Mainnet-live-brightgreen?style=for-the-badge" alt="0G mainnet" /></a>
  <img src="https://img.shields.io/badge/Contracts-174_tests_passing-brightgreen?style=for-the-badge" alt="Tests" />
  <img src="https://img.shields.io/badge/Slither-fail_on_high-blue?style=for-the-badge" alt="Slither" />
  <img src="https://img.shields.io/badge/SDK-%40aegis--vault%2Fsdk_v0.3.0-cyan?style=for-the-badge" alt="SDK" />
</p>

---

## What it is

Aegis Vault lets a user deposit stablecoins into a vault, pick an AI operator from an on-chain marketplace, and let autonomous execution happen inside a narrow, enforced policy. The AI can only *propose* trades; the vault contract enforces every rule (max position, stop-loss, cooldowns, slippage, allowed assets, fee caps, cross-chain replay protection). Every decision is logged, every fee is split 80/20 with the protocol treasury, every slash is governance-gated, and every operator carries on-chain reputation that users can sort on.

Built for **Track 2 — Agentic Trading Arena (Verifiable Finance)**: inference runs on 0G Compute (GLM-5-FP8), the output hash is bound into an EIP-712 intent, a TEE signer attests the decision, and commit–reveal prevents front-running — enforced on-chain with no trusted middleman.

## Live on 0G Aristotle Mainnet (chain 16661)

| Contract | Address |
|---|---|
| AegisVaultFactory (V2) | [`0x9450ac911D06c81a54007a768d4278929d87A17e`](https://chainscan.0g.ai/address/0x9450ac911D06c81a54007a768d4278929d87A17e) |
| AegisVault impl (V2) | [`0xf7AAFFBddaf66B90f13fc3447634372eBF0Ea181`](https://chainscan.0g.ai/address/0xf7AAFFBddaf66B90f13fc3447634372eBF0Ea181) |
| ExecutionRegistry (V2) | [`0x3a8a59865546e99c8377aFd2d02736e25Ac5d04E`](https://chainscan.0g.ai/address/0x3a8a59865546e99c8377aFd2d02736e25Ac5d04E) |
| OperatorRegistry (V2) | [`0xF775D9634bFCe4D0F1F56874873FE6cb35A28CA5`](https://chainscan.0g.ai/address/0xF775D9634bFCe4D0F1F56874873FE6cb35A28CA5) |
| OperatorStaking (V2) | [`0xAABC708aA3d5e9a37A90ff675EdBD681C204a376`](https://chainscan.0g.ai/address/0xAABC708aA3d5e9a37A90ff675EdBD681C204a376) |
| OperatorReputation | [`0xc270c579400a45975B2EBff05A2fF80f620080CA`](https://chainscan.0g.ai/address/0xc270c579400a45975B2EBff05A2fF80f620080CA) |
| InsurancePool (V2) | [`0x0CaCfc2a5a47C315343f20A8841EE29133AD1598`](https://chainscan.0g.ai/address/0x0CaCfc2a5a47C315343f20A8841EE29133AD1598) |
| ProtocolTreasury | [`0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4`](https://chainscan.0g.ai/address/0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4) |
| AegisGovernor (multisig) | [`0x023EC4a54435f94E9395460e4835e75E429D5A2e`](https://chainscan.0g.ai/address/0x023EC4a54435f94E9395460e4835e75E429D5A2e) |
| VaultNAVCalculator (Pyth) | [`0xBd21bfd62a11e1F8d04e7bE42D2cbDB6C51C4Ae1`](https://chainscan.0g.ai/address/0xBd21bfd62a11e1F8d04e7bE42D2cbDB6C51C4Ae1) |
| JaineVenueAdapter | [`0x0F8B269368925Fd55C62560B6f818173A8cB25eD`](https://chainscan.0g.ai/address/0x0F8B269368925Fd55C62560B6f818173A8cB25eD) |

Full address book including legacy V1 and Arbitrum mirror: [`contracts/deployments-mainnet.json`](contracts/deployments-mainnet.json).

**First on-chain execution** (AI → policy → DEX, end-to-end): [`0x7efe51ac…`](https://chainscan.0g.ai/tx/0x7efe51ac) — orchestrator cycle BUY 0G on Jaine, signed by the TEE signer, verified through `AegisVault.executeIntent()`.

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

**Sealed mode** (optional per vault): strategy params never leave the TEE. The orchestrator commits `keccak(intentHash, reportHash)` at block N, executes at block ≥ N+1, and `SealedLib` verifies the ECDSA signature against `policy.attestedSigner`. `attestationReportHash` binds the execution to the specific 0G Compute provider + chat session.

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
npm run test:all                 # 174 passing, 0 pending

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

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — economic model, state diagrams, threat analysis
- [CONTRACTS.md](CONTRACTS.md) — per-contract reference
- [WHITEPAPER.md](WHITEPAPER.md) — full protocol design
- [sdk/README.md](sdk/README.md) — SDK API surface with examples

## License

MIT
