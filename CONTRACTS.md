# Aegis Vault — 0G On-Chain Integration Proof

Verifiable proof of on-chain integration with 0G. Every address is live on 0G Aristotle Mainnet (chain ID **16661**) and independently verifiable at **[chainscan.0g.ai](https://chainscan.0g.ai)**.

---

## 1. 0G components used

Aegis Vault integrates with the 0G stack at four levels:

- **0G Chain (Aristotle Mainnet, chain 16661)** — all protocol contracts deployed here. Vault creation, deposits, withdrawals, AI-bound trade execution, operator registration, staking, insurance pool, and M-of-N governance are on-chain on 0G.
- **0G Compute** — AI trading decisions run via on-chain-billable inference to the `zai-org/GLM-5-FP8` model on 0G Compute. TEE-attested response hashes are cryptographically bound into the EIP-712 intent struct consumed by the vault.
- **Jaine V3 (native 0G DEX)** — real execution venue for vault swaps. USDC.e / WETH / WBTC / W0G pools serve as the liquidity surface for AI-directed trades.
- **Pyth oracle (on 0G)** — price feeds for NAV calculation and oracle-guard slippage enforcement inside the Jaine venue adapter.

---

## 2. 0G mainnet contract addresses (V3 stack, current)

V3 vault stack with the Khalani cross-chain adapter shipped **2026-04-27** after audit-pass hardening (235 contract tests). The operator marketplace contracts (registry / staking / reputation / insurance) were redeployed the same day for a clean post-audit baseline — operator data starts fresh.

| Contract | Address | 0G Explorer link |
|---|---|---|
| **AegisVaultFactoryV3** (entrypoint) | `0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3` | [View](https://chainscan.0g.ai/address/0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3) |
| AegisVault impl (V3) | `0x0c78257550802bF2fFD201106Fe8096A5211397e` | [View](https://chainscan.0g.ai/address/0x0c78257550802bF2fFD201106Fe8096A5211397e) |
| ExecutionRegistry (V3) | `0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9` | [View](https://chainscan.0g.ai/address/0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9) |
| **KhalaniVenueAdapter** (cross-chain) | `0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4` | [View](https://chainscan.0g.ai/address/0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4) |
| JaineVenueAdapterV2 (multi-hop) | `0x261244010A6D87e043b3489D93fA573cdc2274B6` | [View](https://chainscan.0g.ai/address/0x261244010A6D87e043b3489D93fA573cdc2274B6) |
| OperatorRegistry | `0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9` | [View](https://chainscan.0g.ai/address/0x252Ef1B2C3CBe775cdCe8B07192BB8355c7594c9) |
| OperatorStaking (USDC.e stake) | `0xe153A071FBFFa20Bd1a016C545745EFcAC3F2bc3` | [View](https://chainscan.0g.ai/address/0xe153A071FBFFa20Bd1a016C545745EFcAC3F2bc3) |
| InsurancePool | `0xd5eb21420e9D22b763b94fDb396756d820eCa694` | [View](https://chainscan.0g.ai/address/0xd5eb21420e9D22b763b94fDb396756d820eCa694) |
| OperatorReputation | `0x855380187f223391b55fc381f33429A14d238879` | [View](https://chainscan.0g.ai/address/0x855380187f223391b55fc381f33429A14d238879) |
| AegisGovernor | `0x023EC4a54435f94E9395460e4835e75E429D5A2e` | [View](https://chainscan.0g.ai/address/0x023EC4a54435f94E9395460e4835e75E429D5A2e) |
| ProtocolTreasury | `0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4` | [View](https://chainscan.0g.ai/address/0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4) |
| VaultNAVCalculator (Pyth-backed) | `0xBd21bfd62a11e1F8d04e7bE42D2cbDB6C51C4Ae1` | [View](https://chainscan.0g.ai/address/0xBd21bfd62a11e1F8d04e7bE42D2cbDB6C51C4Ae1) |

**Shared DELEGATECALL libraries** (V3-linked):

| Library | Address | Explorer |
|---|---|---|
| ExecLib (V3) | `0x48594040AbEbFe3a24BbDFfA21Cb597FA6F60dE7` | [View](https://chainscan.0g.ai/address/0x48594040AbEbFe3a24BbDFfA21Cb597FA6F60dE7) |
| IOLib (V3) | `0x49b201603ae393054eF9377f456eDDc827748f37` | [View](https://chainscan.0g.ai/address/0x49b201603ae393054eF9377f456eDDc827748f37) |
| CrossChainLib | `0x505C1C76520C6a47a1C0Bf8819359c786E3c8aB3` | [View](https://chainscan.0g.ai/address/0x505C1C76520C6a47a1C0Bf8819359c786E3c8aB3) |
| SealedLib | `0x9dD28eE7d9B7D3e913D23dD1Fc3f4FB36b0F9063` | [View](https://chainscan.0g.ai/address/0x9dD28eE7d9B7D3e913D23dD1Fc3f4FB36b0F9063) |

**Primary explorer link for the form**: [https://chainscan.0g.ai/address/0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3](https://chainscan.0g.ai/address/0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3) (AegisVaultFactoryV3 — the canonical entrypoint judges can trace every vault clone from).

---

## 3. How the on-chain integration works

### Step 1 — Vault creation on 0G Chain
A user calls `AegisVaultFactoryV3.createVault(operator, baseAsset, venue, policy, allowedAssets, maxCrossChainFeeBps)`. The factory deploys an EIP-1167 minimal-proxy clone pointing to the immutable `AegisVault_v3` implementation at `0x0c782575…397e`. All subsequent vault state — deposits, positions, fee accrual — lives on 0G under the clone's address.

### Step 2 — AI decision via 0G Compute
Every cycle, the orchestrator calls 0G Compute with prompt + market context → receives an inference from `zai-org/GLM-5-FP8` (TEE-attested model). The compute response is hashed (`keccak256(provider, chatId, model, contentDigest)`) → this produces `attestationReportHash`, a 32-byte field inside the on-chain EIP-712 `ExecutionIntent` struct. 0G Compute is paid per-call on-chain; billing is a first-class 0G feature.

### Step 3 — Cryptographic AI ↔ execution binding
The orchestrator signs the intent hash using a separate TEE signer key. When `AegisVault.executeIntent(intent, sig)` is called on 0G, the vault:
1. Recomputes the EIP-712 digest using `block.chainid = 16661` (0G mainnet) and its own domain separator.
2. Runs `ecrecover(digest, sig)` and compares against `policy.attestedSigner`.
3. Any mismatch — wrong AI output → wrong `attestationReportHash` → wrong intent hash → different recovered signer → **revert**.

This is the core "AI output binds to execution" guarantee, implemented entirely in Solidity on 0G.

### Step 4 — Execution via Jaine V3 on 0G
Once the signature verifies, `ExecLib` delegatecalls into `JaineVenueAdapter`, which:
- Queries Pyth price feeds (on 0G) for slippage guard.
- Calls Jaine's native `SwapRouter` at `0x8b598a7c136215a95ba0282b4d832b9f9801f2e2`.
- Swap hits the real USDC.e / WETH / WBTC / W0G pools on Jaine.

Every swap event is emitted on-chain and visible at `chainscan.0g.ai` filtered by `IntentExecuted` / `SealedIntentExecuted` topics.

### Step 5 — Operator economy on 0G
- `OperatorRegistry` stores operator metadata, bonded strategy manifests (keccak256 committed on-chain), and AI model declarations.
- `OperatorStaking` locks USDC.e stake per operator tier (Bronze → Platinum), gating which vault sizes they can manage.
- `OperatorReputation` records per-cycle outcomes keyed by operator wallet.
- `InsurancePool` receives slashed stake if an arbitrator proves operator misbehavior.
- `AegisGovernor` is an M-of-N multisig that holds arbitrator role over staking + pool.

All five contracts above are deployed on 0G mainnet (addresses in § 2).

### How to verify

- `AegisVaultFactory.totalVaults()` on 0G returns the live count of vault clones ever deployed by the factory — each clone is a verifiable on-chain entity.
- `chainscan.0g.ai` → filter event logs on any contract above by standard Solidity event signatures (`VaultDeployed`, `IntentExecuted`, `SealedIntentExecuted`, `OperatorRegistered`, `Staked`, etc.) to see live execution history.
- `OperatorRegistry.getOperator(walletAddress)` returns metadata + manifest hash for any registered operator.
- `0g-chain` deployments file: [`contracts/deployments-mainnet.json`](contracts/deployments-mainnet.json) (authoritative source for every address above).

---

## 4. Tokens used (canonical on 0G)

| Symbol | Address | Decimals | Use |
|---|---|---|---|
| USDC.e | `0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E` | 6 | Base asset + operator stake |
| WETH | `0x564770837Ef8bbF077cFe54E5f6106538c815B22` | 18 | Allowed vault asset |
| WBTC | `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` | 8 | Allowed vault asset |
| W0G | `0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c` | 18 | Wrapped native 0G |

---

## 5. External 0G infrastructure used

| Service | Address | Explorer |
|---|---|---|
| Jaine SwapRouter (on 0G) | `0x8b598a7c136215a95ba0282b4d832b9f9801f2e2` | [View](https://chainscan.0g.ai/address/0x8b598a7c136215a95ba0282b4d832b9f9801f2e2) |
| Jaine Factory (on 0G) | `0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4` | [View](https://chainscan.0g.ai/address/0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4) |
| Pyth oracle (on 0G) | `0x2880ab155794e7179c9ee2e38200202908c17b43` | [View](https://chainscan.0g.ai/address/0x2880ab155794e7179c9ee2e38200202908c17b43) |

---

## 6. Companion execution layer (Arbitrum One, not part of 0G proof)

Aegis also runs a dual-chain execution layer on Arbitrum One via Uniswap V3, using the same `AegisVault` bytecode. Separation by `block.chainid` in the EIP-712 domain separator prevents cross-chain replay. Arbitrum deployment is orthogonal to the 0G integration — listed here only for completeness.

| Contract | Address |
|---|---|
| AegisVaultFactory (Arbitrum) | `0x49354460eAdE1C2E786E36B3B3e7A18Fb4283C45` |
| AegisVault implementation (Arbitrum) | `0x9047E26eE93F68732eF614D0636b15bD493A3d0b` |
| UniswapV3VenueAdapter | `0xB3f6611Dd1d76d20d3BF47C7173310F9e606FAb1` |

Explorer: **[arbiscan.io](https://arbiscan.io)**.

---

## 📎 Related documents

- [README.md](README.md) — project overview + quick start
- [HACKATHON_SUBMISSION.md](HACKATHON_SUBMISSION.md) — track 2 submission narrative
- [WHITEPAPER.md](WHITEPAPER.md) — full technical specification (includes § 2.4 on EIP-712 cross-chain safety)
- [ARCHITECTURE.md](ARCHITECTURE.md) — contract topology + economic model
- [PITCH_SCRIPT.md](PITCH_SCRIPT.md) — pitch video script with on-chain event walkthrough

---

## 📋 Form submission — copy-paste ready

**0G mainnet contract address:**
```
0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3
```
(AegisVaultFactoryV3 — the entrypoint. Complete address list in § 2.)

**0G Explorer link:**
```
https://chainscan.0g.ai/address/0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3
```

**Which 0G components and how on-chain integration works:**
```
Aegis Vault is fully deployed on 0G Aristotle Mainnet (chain 16661). It integrates with four 0G components:

1. 0G Chain — all protocol contracts run on-chain: AegisVaultFactoryV3 (0x75668Ca9...) deploys EIP-1167 proxy clones of the AegisVault_v3 implementation (0x0c782575...), with OperatorRegistry (0x252Ef1B2...), OperatorStaking (0xe153A071...), InsurancePool (0xd5eb2142...), ExecutionRegistry V3 (0x8DD63Cfc...), OperatorReputation (0x85538018...), AegisGovernor (0x023EC4a5...), ProtocolTreasury (0xCDc5D994...), and VaultNAVCalculator (0xBd21bfd6...) as the supporting stack.

2. 0G Compute — every trade cycle queries the zai-org/GLM-5-FP8 model on 0G Compute for AI inference. The response is TEE-attested and its hash is bound into the EIP-712 ExecutionIntent struct the vault verifies on-chain (via ecrecover against policy.attestedSigner). Wrong AI output → wrong hash → different signer → revert. This cryptographically binds every AI decision to its on-chain execution.

3. Jaine V3 (native 0G DEX) — real execution venue. Vault swaps route through JaineVenueAdapterV2 (0x26124401...) → Jaine SwapRouter (0x8b598a7c...) → Jaine Factory (0x9bdcA579...) and hit the real USDC.e / WETH / WBTC / W0G pools. Cross-chain swaps go through the KhalaniVenueAdapter (0xB65fdbb6...) via solver-driven settlement.

4. Pyth oracle on 0G — price feeds (0x2880ab15...) for NAV calculation in VaultNAVCalculator and oracle-guard slippage enforcement in the Jaine adapter.

Live verification: call AegisVaultFactoryV3.allVaults(i) on 0G to enumerate vault clones, or filter event logs on any of the above contracts at chainscan.0g.ai to see on-chain activity (VaultDeployed, IntentExecuted, SealedIntentExecuted, OperatorRegistered, Staked, etc.).
```

---

*Authoritative source: [`contracts/deployments-mainnet.json`](contracts/deployments-mainnet.json).*
