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

## 2. 0G mainnet contract addresses (for form submission)

| Contract | Address | 0G Explorer link |
|---|---|---|
| **AegisVaultFactory** (entrypoint) | `0x9450ac911D06c81a54007a768d4278929d87A17e` | [View on chainscan.0g.ai](https://chainscan.0g.ai/address/0x9450ac911D06c81a54007a768d4278929d87A17e) |
| AegisVault (implementation) | `0xf7AAFFBddaf66B90f13fc3447634372eBF0Ea181` | [View](https://chainscan.0g.ai/address/0xf7AAFFBddaf66B90f13fc3447634372eBF0Ea181) |
| ExecutionRegistry | `0x3a8a59865546e99c8377aFd2d02736e25Ac5d04E` | [View](https://chainscan.0g.ai/address/0x3a8a59865546e99c8377aFd2d02736e25Ac5d04E) |
| OperatorRegistry | `0xF775D9634bFCe4D0F1F56874873FE6cb35A28CA5` | [View](https://chainscan.0g.ai/address/0xF775D9634bFCe4D0F1F56874873FE6cb35A28CA5) |
| OperatorStaking (USDC.e stake) | `0xAABC708aA3d5e9a37A90ff675EdBD681C204a376` | [View](https://chainscan.0g.ai/address/0xAABC708aA3d5e9a37A90ff675EdBD681C204a376) |
| InsurancePool | `0x0CaCfc2a5a47C315343f20A8841EE29133AD1598` | [View](https://chainscan.0g.ai/address/0x0CaCfc2a5a47C315343f20A8841EE29133AD1598) |
| OperatorReputation | `0xc270c579400a45975B2EBff05A2fF80f620080CA` | [View](https://chainscan.0g.ai/address/0xc270c579400a45975B2EBff05A2fF80f620080CA) |
| AegisGovernor | `0x023EC4a54435f94E9395460e4835e75E429D5A2e` | [View](https://chainscan.0g.ai/address/0x023EC4a54435f94E9395460e4835e75E429D5A2e) |
| ProtocolTreasury | `0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4` | [View](https://chainscan.0g.ai/address/0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4) |
| VaultNAVCalculator (Pyth-backed) | `0xBd21bfd62a11e1F8d04e7bE42D2cbDB6C51C4Ae1` | [View](https://chainscan.0g.ai/address/0xBd21bfd62a11e1F8d04e7bE42D2cbDB6C51C4Ae1) |
| **JaineVenueAdapter** (swap venue) | `0x0F8B269368925Fd55C62560B6f818173A8cB25eD` | [View](https://chainscan.0g.ai/address/0x0F8B269368925Fd55C62560B6f818173A8cB25eD) |

**Shared DELEGATECALL libraries** (live, linked by every vault clone):

| Library | Address | Explorer |
|---|---|---|
| ExecLib | `0x1F2110aE2E7280455Da63517942cBee7ecdB3045` | [View](https://chainscan.0g.ai/address/0x1F2110aE2E7280455Da63517942cBee7ecdB3045) |
| SealedLib | `0x9dD28eE7d9B7D3e913D23dD1Fc3f4FB36b0F9063` | [View](https://chainscan.0g.ai/address/0x9dD28eE7d9B7D3e913D23dD1Fc3f4FB36b0F9063) |
| IOLib | `0x0e60443Ee2c939f8cE19Fa5909c063B35a3baF7a` | [View](https://chainscan.0g.ai/address/0x0e60443Ee2c939f8cE19Fa5909c063B35a3baF7a) |

**Primary explorer link for the form**: [https://chainscan.0g.ai/address/0x9450ac911D06c81a54007a768d4278929d87A17e](https://chainscan.0g.ai/address/0x9450ac911D06c81a54007a768d4278929d87A17e) (AegisVaultFactory — the entrypoint judges can trace every vault clone from).

---

## 3. How the on-chain integration works

### Step 1 — Vault creation on 0G Chain
A user calls `AegisVaultFactory.createVault(baseAsset, executor, venue, policy, allowedAssets)`. The factory deploys an EIP-1167 minimal-proxy clone pointing to the immutable `AegisVault` implementation at `0xf7AAFFBd…0Ea181`. All subsequent vault state — deposits, positions, fee accrual — lives on 0G under the clone's address.

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
0x9450ac911D06c81a54007a768d4278929d87A17e
```
(AegisVaultFactory — the entrypoint. Complete address list in § 2.)

**0G Explorer link:**
```
https://chainscan.0g.ai/address/0x9450ac911D06c81a54007a768d4278929d87A17e
```

**Which 0G components and how on-chain integration works:**
```
Aegis Vault is fully deployed on 0G Aristotle Mainnet (chain 16661). It integrates with four 0G components:

1. 0G Chain — all protocol contracts run on-chain: AegisVaultFactory (0x9450ac91...) deploys EIP-1167 proxy clones of the AegisVault implementation, with OperatorRegistry (0xF775D963...), OperatorStaking (0xAABC708a...), InsurancePool (0x0CaCfc2a...), ExecutionRegistry (0x3a8a5986...), OperatorReputation (0xc270c579...), AegisGovernor (0x023EC4a5...), ProtocolTreasury (0xCDc5D994...), and VaultNAVCalculator (0xBd21bfd6...) as the supporting stack.

2. 0G Compute — every trade cycle queries the zai-org/GLM-5-FP8 model on 0G Compute for AI inference. The response is TEE-attested and its hash is bound into the EIP-712 ExecutionIntent struct the vault verifies on-chain (via ecrecover against policy.attestedSigner). Wrong AI output → wrong hash → different signer → revert. This cryptographically binds every AI decision to its on-chain execution.

3. Jaine V3 (native 0G DEX) — real execution venue. Vault swaps route through JaineVenueAdapter (0x0F8B2693...) → Jaine SwapRouter (0x8b598a7c...) → Jaine Factory (0x9bdcA579...) and hit the real USDC.e / WETH / WBTC / W0G pools.

4. Pyth oracle on 0G — price feeds (0x2880ab15...) for NAV calculation in VaultNAVCalculator and oracle-guard slippage enforcement in the Jaine adapter.

Live verification: call AegisVaultFactory.totalVaults() on 0G to see the number of vault clones ever created, or filter event logs on any of the above contracts at chainscan.0g.ai to see on-chain activity (VaultDeployed, IntentExecuted, SealedIntentExecuted, OperatorRegistered, Staked, etc.).
```

---

*Authoritative source: [`contracts/deployments-mainnet.json`](contracts/deployments-mainnet.json).*
