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
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript" />
</p>

> AI-managed, risk-controlled trading vault on 0G. Users deposit assets, define on-chain risk mandates, and let an AI agent execute within verifiable limits. The AI proposes. The contract enforces. Every action is auditable.

---

## 0G Stack Integration

| Layer | What It Does |
|---|---|
| **0G Chain** | 8 Solidity contracts on Galileo Testnet — vault custody, 12 on-chain policy rules, executor authorization, swap execution |
| **0G Compute** | Real AI inference via `GLM-5-FP8` on Mainnet — decentralized, verifiable reasoning + structured JSON output |
| **0G Storage** | KV state snapshots + blob upload — decision journal, execution reports, strategy memory |

---

## Architecture

```
User → Frontend (React + wagmi) → AegisVault Contract (0G Chain)
                                         ↑
                              Strategy Orchestrator (Node.js)
                              ├── Market Data (CoinGecko + Pyth)
                              ├── AI Inference (0G Compute GLM-5-FP8)
                              ├── Policy Pre-check (10 rules)
                              ├── Intent Builder + Executor
                              └── 0G Storage (journal + state)
                                         ↓
                                    DEX Venue
                              ├── MockDEX (testnet)
                              └── JaineVenueAdapter (mainnet)
```

**How it works:** Create vault → Deposit → Orchestrator fetches market data → AI generates decision via 0G Compute → Policy pre-check → `executeIntent()` on-chain (12 rules enforced) → Swap via venue adapter → Result stored on 0G Storage → User monitors on dashboard.

---

## Smart Contracts (0G Galileo Testnet — Chain 16602)

| Contract | Address |
|---|---|
| AegisVaultFactory | `0x2A0CAA1d639060446fA1bA799b6B64810B5B4aff` |
| ExecutionRegistry | `0xDF277f39d4869B1a4bb7Fa2D25e58ab32E2af998` |
| MockUSDC | `0xcb7F4c52f72DA18d27Bc18C4c3f706b6ba361BC1` |
| MockWBTC | `0x0d8C28Ad2741cBec172003eee01e7BD97450b5A9` |
| MockWETH | `0x339d0484699C0E1232aE0947310a5694B7e0E03A` |
| MockDEX | `0x8eeF4E72ec2ff6f9E00a6D2029bEcB8FcB2f03E6` |
| Demo Vault | `0xFFac2840f762b6003Ce291bd5B19c2890Ea5DAB2` |

**Security:** AI never holds authority (propose-only) — executor cannot withdraw/pause — single-use intent hashes — on-chain swap verification — owner emergency pause + withdraw.

---

## Quick Start

```bash
# 1. Deploy contracts
cd contracts && npm install
DEPLOYER_PRIVATE_KEY=<key> npx hardhat run scripts/deploy.js --network og_testnet
node scripts/gen-env.js && node scripts/sync-frontend.js

# 2. Start orchestrator (port 4002)
cd orchestrator && npm install --legacy-peer-deps && npm start

# 3. Start frontend (port 5173)
cd frontend && npm install && npm run dev
```

**MetaMask:** RPC `https://evmrpc-testnet.0g.ai` — Chain ID `16602` — Symbol `0G`

---

## Project Structure

```
0g-chain/
├── contracts/       Solidity — 8 contracts (Hardhat 2.28 + OpenZeppelin)
├── orchestrator/    Node.js — AI inference, market data, policy, executor (16 API endpoints)
└── frontend/        React 19 + Vite 8 + Tailwind 4 + wagmi 2 (7 pages, 40+ components)
```

---

## Test Results

```
Smart Contracts:     34 passing, 0 failing
Security Audit:      4 critical + 6 high findings fixed, re-audited clean
On-chain Execution:  Real TX on Galileo testnet
0G Compute:          Live inference from GLM-5-FP8 on mainnet
```
