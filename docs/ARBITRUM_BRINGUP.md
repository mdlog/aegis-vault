# Arbitrum One bring-up checklist

Use this when validating the Aegis Vault stack on Arbitrum One (chain 42161),
typically after the multi-hop adapter on 0G has shipped and we want a sibling
test where the AI can already pick BTC/ETH freely (canonical Uniswap V3 pools
have direct USDC↔WETH and USDC↔WBTC liquidity, so no hub-routing is needed).

This checklist intentionally lives outside `scripts/` because much of it is
manual + funded — it's not a one-shot script.

## What's already deployed (verified in `contracts/deployments-arbitrum.json`)

| Contract | Address | Notes |
|---|---|---|
| AegisVaultFactory | `0x49354460eAdE1C2E786E36B3B3e7A18Fb4283C45` | V1, not V2 |
| AegisVault impl | `0x9047E26eE93F68732eF614D0636b15bD493A3d0b` | V1, pre-slim |
| ExecutionRegistry | `0x43CAEB5209C0Bd7c3c748219361f884B660B08D6` | |
| UniswapV3VenueAdapter | `0xB3f6611Dd1d76d20d3BF47C7173310F9e606FAb1` | already supports direct pools |
| VaultNAVCalculator | `0x0F8B269368925Fd55C62560B6f818173A8cB25eD` | Pyth-backed |
| Pyth | `0xff1a0f4744e8582DF1aE09D5611b887B6a12925C` | canonical |
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | canonical |
| WETH | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | canonical |
| WBTC | `0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f` | canonical |

## What's NOT deployed on Arbitrum

The full V2 stack — staking / reputation / governor / insurance pool — was not
ported. That means:

- No operator marketplace on Arbitrum (the marketplace page will be empty)
- No tier caps (any size vault permitted)
- No on-chain reputation
- No multisig governance — no slashing path

Decision: V2 stack on Arbitrum is **out of scope** for the multi-hop validation
session. We only need a working vault + executor + AI cycle. If long-term
production on Arbitrum is desired, deploy V2 separately.

## Pre-flight checklist

### 1. Funding (one-time per session)

- [ ] Wallet `0x98cC8351…` (executor / orchestrator wallet) holds ≥ 0.01 ETH
      on Arbitrum. Check: `https://arbiscan.io/address/0x98cC8351…`
- [ ] Wallet you'll deposit from holds ≥ 5 USDC on Arbitrum (canonical USDC,
      not USDC.e)
- [ ] If bridging from L1: use [Arbitrum Bridge](https://bridge.arbitrum.io)
      or a CEX with direct Arbitrum withdrawal

### 2. Orchestrator config (`orchestrator/.env`)

```bash
# Switch primary chain
CHAIN_ID=42161
RPC_URL=https://arb1.arbitrum.io/rpc
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc

# Address overrides — picked up automatically from deployments-arbitrum.json,
# but set explicitly here if you want to override:
# VAULT_FACTORY_ADDRESS=0x49354460eAdE1C2E786E36B3B3e7A18Fb4283C45
# EXECUTION_REGISTRY_ADDRESS=0x43CAEB5209C0Bd7c3c748219361f884B660B08D6

# Same TEE signer + executor wallet as 0G — safe to reuse, EIP-712 domain
# includes chainId so signatures don't replay across chains.
EXECUTOR_PRIVATE_KEY=<unchanged>
TEE_SIGNER_PRIVATE_KEY=<unchanged>
```

Restart orchestrator: `cd orchestrator && npm start`

Sanity: `curl localhost:4002/api/status` should report `chainId: 42161`.

### 3. Frontend (`frontend/.env`)

```bash
VITE_DEFAULT_CHAIN_ID=42161   # optional — UI auto-detects from MetaMask
```

Frontend already has Arbitrum profile in `chainConfig.js` (lines 26–43). No
code change needed.

### 4. Vault creation flow on Arbitrum

Because there's no V2 OperatorRegistry on Arbitrum, the marketplace step gets
skipped:

1. MetaMask: switch to Arbitrum One (42161)
2. Frontend → Create Vault page
3. Executor mode: **Custom** (not Marketplace, since no operators registered)
4. Custom executor: paste `0x98cC8351…` (the orchestrator wallet)
5. Allowed assets: ☑ USDC, ☑ WETH, ☑ WBTC (canonical Uniswap V3 has direct
   pools for all three pairs — no hub routing needed)
6. Policy: anything reasonable (e.g. 50% max position, 60% confidence,
   15-min cooldown, 6 actions/day, 15% stop-loss)
7. Initial deposit: 5 USDC (small enough to validate without much risk)
8. Deploy vault → wait for confirm
9. Verify on Arbiscan that `executor()` reads `0x98cC8351…`

### 5. Verify AI proposes BTC/ETH

Once orchestrator is running on chain 42161 and sees the new vault:

- [ ] `curl localhost:4002/api/journal/decisions?vault=<vault>&limit=5` should
      show decisions where `assetSymbol` is one of `BTC`, `ETH`, `0G`, etc.
      (not just `0G` — the whole point of this exercise)
- [ ] After ~one decision cycle (5–15 min), an `IntentExecuted` event fires on
      the vault — check `https://arbiscan.io/address/<vault>#events`
- [ ] The `assetIn` / `assetOut` of the executed intent should be the
      canonical USDC + WETH/WBTC pair

### 6. Rollback / cleanup

- Withdraw any test funds: connect MetaMask, vault page → Withdraw All
- Revert orchestrator `.env` to `CHAIN_ID=16661` if you want to keep running
  0G as primary

## Known caveats

- **No tier caps means an attacker who somehow gets executor rights could
  drain the vault.** Test funds only — don't put production capital here
  until V2 stack is deployed on Arbitrum.
- **Pyth on Arbitrum is canonical and updates frequently**, unlike 0G where
  the on-chain Pyth was stale during the hackathon — so the oracle guard in
  `JaineVenueAdapter` would actually fire on Arbitrum if enabled. Decision:
  ship Arbitrum with `setMaxSlippageBps(300)` (3%) and Pyth feeds registered;
  the existing `UniswapV3VenueAdapter` already supports this.
- **Cross-chain replay**: EIP-712 domain in vault `initialize()` includes
  `block.chainid`, so an intent signed for chain 42161 can't replay on 16661.
  Verified in `ExecLib._hashIntent`.

## Open questions to resolve before deploying production capital

1. Should we deploy V2 stack on Arbitrum (staking, reputation, governor)? If
   yes, fold deploy script into `deploy-arbitrum-execution.js` rather than
   one-off.
2. Do we want a single multi-chain orchestrator (one process scanning both
   16661 + 42161), or separate processes per chain? Current code supports
   the former via `CHAIN_ID` switching, but multi-chain in one process is
   not implemented.
3. Frontend operator marketplace currently shows the V2 0G registry across
   chains — needs a chain-aware filter so Arbitrum users don't see operators
   they can't actually pick.
