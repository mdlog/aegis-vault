# Aegis → Arbitrum: Go Plan

> Companion to `UNIT_ECONOMICS.md`. Grounded in on-chain Arbitrum data (June 2026) and an audit of
> what's already shipped. **TL;DR: the economics close on Arbitrum, but only at low turnover — and
> you are already ~80% deployed. This is a "first real vault" push, not a port.**

---

## 1. Gating verdict — does it close?

**YES, but narrow.** Real Arbitrum liquidity is 300–1000× deeper than 0G/Jaine:

| Pool | 0G/Jaine (real) | Arbitrum (real, on-chain) |
|---|---|---|
| WETH/USDC | ~$9.7k (2-hop via W0G) | **$34.7M direct** |
| WBTC/USDC | ~$10.3k (2-hop) | **$7.8M direct** |
| Max trade before revert | ~$150–$900 | **~$250k–$500k** |

| Trade size | Arbitrum slippage | Reverts? |
|---|---|---|
| $10k | 0.1–0.4% | no |
| $50k | 0.3–0.6% | no |
| $250k | 0.4–1.0% | no |
| $1M | 1–13% | yes (needs TWAP/splitting) |

**But the constraint flips from liquidity → turnover + alpha.** At ~0.6–0.9% round-trip drag:

| Turnover | Annual drag | Net vs passive 8–18% |
|---|---|---|
| **Monthly** (~12/yr) | ~11% | **+8% — beats low end** ✅ |
| Weekly (~52/yr) | 31–47% | **negative** ❌ |
| Policy default **20/day** | 219–328% | **catastrophic wipeout** ❌ |

> **Max sustainable ≈ 8–17 round-trips/YEAR at 20% gross alpha.** And 20% gross alpha is an
> *assumption* — at <10% gross, nothing beats passive even here. **On Arbitrum the binding
> constraint is no longer the venue; it is whether the AI has real alpha at low turnover.**

So going to Arbitrum is justified **only if paired with a low-turnover policy** and an honest intent
to *measure* whether the AI actually adds value. The thin 0G venue was hiding that question.

---

## 2. The surprise: you're already mostly there

The `feat/arbitrum-v4-port` branch is **misnamed** — the Arbitrum port is **already merged to `main`**
and the **infra is deployed LIVE on Arbitrum One** (bytecode verified on-chain):

- Factory `0x49354460…`, UniswapV3VenueAdapter `0xB3f6611D…`, Vault impl `0x9047E26e…`
- `deploy-arbitrum-execution.js`, `deployments-arbitrum.json`, dual-chain frontend, `chains.js` registry — all present.
- "Two chains, one bytecode, replay-safe via EIP-712 `block.chainid`" is **real at the contract level.**

**What's missing is usage, not code:** the factory has **0 vaults, 0 deposits, 0 trades.** This is an
operational gap, plus a few wiring fixes — not a rebuild.

---

## 3. Concrete plan (sequenced)

### Phase 0 — First real trade (days)
1. **Fix the quote mismatch** (M). `quoteRouter.getVenueQuote` calls `getAmountOut()` (Jaine signature);
   `UniswapV3VenueAdapter` doesn't expose it → pre-trade quote breaks on Arbitrum. Add a `getAmountOut`
   view to the adapter **or** a UniV3 `QuoterV2` path for chain 42161.
2. **Track `deployments-arbitrum.json` in git** (S). It is UNTRACKED — live addresses exist on one
   machine only; any clone/CI/container loses them.
3. **Populate `sdk/src/config.js` ADDRESSES[42161]** (S). `getAddresses(42161)` throws today.
4. **Point one orchestrator at Arbitrum** (M). Single-chain per process; `chains.js` registry is dead
   code (imported nowhere). Run a second instance with `CHAIN_ID=42161`, `RPC_URL=arb1`, Arbitrum addrs.
5. **Re-enable the oracle guard** (S, ~hours — highest value/effort). `setPyth(0xff1a0f47…)` +
   `registerAsset(USDC/WETH/WBTC)` (feed IDs already in `deployments-arbitrum.json`), and add a Pyth
   price-push to the execution path so the 300s freshness window never lapses. Real, AI-independent
   downside protection — **the headline honest claim you couldn't make on 0G** (Pyth too stale there).
6. **Create 1 vault → deposit small real USDC → run one cycle → first Uniswap V3 swap** (S each).
   → **Outcome: first real Arbitrum execution, oracle-guarded, end-to-end.**

### Phase 1 — Make the economics actually hold
7. **Set a LOW-TURNOVER policy** (S). The 20 trades/day default is a wipeout on any venue. Long cooldown,
   low `maxActionsPerDay`, high conviction threshold. Scale turnover from strategy conviction, not venue.
8. **Deploy the V4 stack to Arbitrum** (M). Only the V1-era layer is live there; for the "two chains, one
   bytecode" **V4** claim to be true, `AegisVaultFactoryV4` must exist on 42161 (`deploy-v4.js` already
   knows `CONFIRM_ARBITRUM`).
9. **Decide operator/reputation linkage** (M). Arbitrum trades cannot currently update 0G reputation (no
   cross-chain relay). Accept as a documented gap, or build a relay.

### Phase 2 — Earn external capital (only if Phase 0–1 net positive)
10. **Prove operator break-even on Arbitrum** (M). No thin-venue excuse now — model gas (~$0.03), real
    slippage, staked-USDC opportunity cost, slashing, 20% cut. If an operator can't break even, "seed
    operators" fails mathematically.
11. **Ship a separately-audited ERC-4626 pooled-shares variant** (L) — *only if* you want allocator/curator
    capital (Gauntlet/Re7) + vaults.fyi/DefiLlama visibility. The current single-owner clone can't accept
    pooled capital or be indexed. New contract + factory + audit, not a wrapper.
12. **Close the two fatal credibility gaps** (gate any serious capital): governor 1-of-1 → 2-of-3 multisig;
    TEE signer key out of plaintext `.env` → HSM/remote signer (prior real wallet-drain incident — not hypothetical).
13. **Apply to Arbitrum Trailblazer 2.0 "Agentic DeFi" grant** — complementary to the 0G grant.

---

## 4. Stop / don't claim

- **Don't** market "verifiable inference bound to execution" on Arbitrum. The chain parses no TEE quote
  (single ECDSA key), and Arbitrum execution reads **no 0G proof at trade time**. Reframe honestly:
  *"0G = where the agent thinks and where its stake is slashable; Arbitrum = where it trades real liquidity."*
  It's a **positioning + grant** choice, not a security upgrade.
- **Don't** claim "indexable by Gauntlet/Re7/vaults.fyi" until the ERC-4626 variant ships — today it's false.
- **Don't** over-credit commit-reveal as MEV defense on Arbitrum (the sequencer's private FCFS mempool
  already hides pending txs). Credit the **oracle guard + tight slippage** instead.
- **Don't** keep the 20 trades/day policy anywhere — it wipes capital on every venue.

---

## 5. Competitive reality (the harder game you're entering)

Arbitrum is contested: **Enzyme** (~$230M TVL, can bolt on an AI manager faster than you build
distribution, and is already 4626-indexed), **dHEDGE/Toros** (already two-sided AI-ish vaults),
**GMX GLV** (the 9–18% passive baseline you must beat net-of-fees), **Sommelier** (closest
architectural twin: "strategist proposes, chain enforces"), **Giza** (category leader, real Re7 deal).
Your only un-copied edge is on-chain policy-veto-of-trade-shape + slashable stake — **neither validated
by a single external user yet.**

---

## 6. The one thing that matters first

Arbitrum removes the liquidity excuse — which is **good** (you can finally prove value) and **dangerous**
(the alpha thesis becomes testable and might fail). So the first move on Arbitrum is **not marketing** —
it's running **one low-turnover, oracle-guarded vault and measuring realized net PnL.** That number is
the whole ballgame, and it's the honest "financial benefit" figure you were looking to display.

*Re-run §1 at execution time — June 2026 is a down market; prices/depths drift.*
