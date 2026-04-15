<p align="center">
  <img src="src/assets/aegis-vault-logo.png" alt="Aegis Vault" width="480" />
</p>

<h1 align="center">Aegis Vault — Frontend</h1>

<p align="center">
  <strong>Autonomous capital protection for the AI-native era.</strong><br/>
  AI-managed, policy-constrained trading vault built on 0G Chain.
</p>

---

## Overview

**Aegis Vault** is an AI-managed risk-controlled trading vault built on the 0G stack.

- **0G Chain** — Smart contract vault, policy, custody, and audit events
- **0G Compute** — AI agent inference for trading decisions (TEE-attested in sealed mode)
- **0G Storage** — State, decision journal, reasoning summary, and strategy memory

### Track 2: Sealed Strategy Mode

The frontend supports **Sealed Strategy Mode** — a Track 2 (Agentic Trading Arena) feature:

- Toggle sealed mode during vault creation to enable TEE attestation + commit-reveal anti-MEV
- Trust model disclosure shown in the UI when sealed mode is enabled
- Honest explanation of TEE-grade privacy: depends on 0G Compute provider hardware
- EIP-712 typed data hashing for cross-chain replay protection

## Getting Started

```bash
# Install dependencies
cd frontend
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

The frontend is live-first by default. Demo fallbacks stay off unless you explicitly enable them:

```bash
# Force showcase/demo fallbacks
VITE_ENABLE_DEMO_FALLBACKS=1 npm run dev
```

Or append `?demo=1` to any app URL to opt into demo mode in that browser until you clear it with `?demo=0`.

### Network Configuration

| Network | Chain ID | RPC |
|---|---|---|
| 0G Aristotle Mainnet | 16661 | `https://evmrpc.0g.ai` |
| 0G Galileo Testnet | 16602 | `https://evmrpc-testnet.0g.ai` |

MetaMask: Add the network above, currency symbol `0G`.

## Tech Stack

- **Frontend:** React 19 + Vite 8 + Tailwind CSS 4
- **Charts:** Recharts
- **Routing:** React Router v7
- **Blockchain:** wagmi + viem (0G Chain mainnet + testnet)

## Key Pages

| Page | Description |
|---|---|
| Landing | Product overview + differentiators |
| Dashboard | My vaults + all platform vaults + AI signal |
| Create Vault | 6-step wizard with sealed mode toggle |
| Vault Detail | Balance, execution history, policy |
| Operator Marketplace | Browse operators by reputation, tier, fees |
| Governance | M-of-N proposal lifecycle |

## Architecture

See [ARCHITECTURE.md](../ARCHITECTURE.md) for the full product architecture including Track 2 sealed mode.

## License

MIT
