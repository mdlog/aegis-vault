# Aegis Vault — Unit Economics Model (0G / Jaine)

> **Purpose:** before we lead the product with "financial benefit," prove whether a positive
> net return even exists on the current venue. All parameters below are **on-chain verified**
> against the live V4 vault `0xC01523Ef…2bd2` (chain 16661, `https://evmrpc.0g.ai`) unless labeled
> otherwise. Captured ~block 36552872, 0G = **$0.2725**.

---

## 0. Bottom line up front (BLUF)

**On the current 0G/Jaine venue there is NO turnover frequency at which an active AI trading
vault produces a positive net financial benefit vs passive yield. The binding constraint is not
fees or gas — it is venue liquidity.** Two consequences:

1. **Capacity wall:** the vault can only trade ~**$150 (into BTC/ETH)** to ~**$900 (into W0G)**
   per position before slippage exceeds the on-chain 3% floor and the trade **reverts**. That caps
   a viable vault at roughly **$300–$1,800 NAV**. (The live vault holds **$3** — i.e. demo-only.)
2. **Drag wall:** every directional trade costs ~1.5–3% in slippage+fee even at that tiny size.
   At any realistic turnover (the policy allows 20 trades/day), drag annualizes to **hundreds of
   percent** — it destroys capital faster than any plausible AI alpha can replace it.

So the honest answer to *"can we display a yield-based financial benefit today?"* is **no** — not
because the engineering is weak, but because **the venue is too thin to trade size.** The path to a
real financial-benefit story is a **deeper-liquidity venue/chain** (the scaffolded Arbitrum mirror)
or a **repositioning** away from yield-from-trading. See §6.

---

## 1. Real parameters (on-chain verified)

| Parameter | Value | Note / source |
|---|---|---|
| **Fees on live vault** | perf 0 · mgmt 0 · entry 0 · exit 0 bps | `getPolicy()` — **all zero today** |
| Fee **caps** (max ever) | perf ≤30% · mgmt ≤5% · entry ≤2% · exit ≤2% | `AegisVault_v4.sol:210` |
| Protocol cut of fees | 20% (operator keeps 80%) | `IOLib.sol:27`; only on entry/exit, which are 0 |
| Perf/mgmt fee machinery | **not shipped** | `accrueFees/claimFees/highWaterMark` revert |
| Protocol treasury collected to date | **$0** | `lifetimeRevenue=0`, balance=0 |
| **Gas / trade** | non-sealed $0.00064 · sealed $0.00073 | 585k–669k gas × 4 gwei × $0.27 — **negligible** |
| 0G Compute / inference | prepaid ledger (~3–5 0G), per-token metered | ~$1–2 covers many decisions — **negligible** |
| **maxSlippageBps (sole price guard)** | **300 bps (3%)**, hard cap 500 | Pyth oracle guard **disabled** (`pyth=0x0`) |
| maxPositionBps | 5000 (a position ≤50% of NAV) | binds tradeable size to NAV |
| Turnover cap | **20 trades/day** (cooldown 15 min) | `maxActionsPerDay=20` is the binding limit |
| Operator stake tiers | 1k→50k · 10k→500k · 100k→5M · 1M→∞ USDC | NAV caps; **idle-stake opportunity cost** is the real operator cost |
| Slashing | up to 50% of stake / 7-day window | tail risk |
| Passive-yield hurdle | GLV 9–18% · alUSD 8–12% APY | *[UNVERIFIED, doc-claimed]* — what net must beat |

### Real Jaine pool depths (on-chain) vs the docs

| Pool | Real input-side depth (on-chain) | Doc claim | Reality |
|---|---|---|---|
| USDC.e/W0G (1%) | **~$42.9k** | ~$360k | 8× thinner |
| WBTC/W0G (1%) | **~$10.3k** (W0G side) | ~$189k | ~18× thinner |
| WETH/W0G (1%) | **~$9.7k** (W0G side) | ~$278k | ~28× thinner |
| USDC.e/WETH, USDC.e/cbBTC | **~$5–7 (DEAD)** | ~$3k–92k | unusable |

There is **no direct USDC.e↔BTC/ETH pool** → every BTC/ETH trade is a **two-hop** route
through the W0G hub, so slippage **compounds** across two thin pools.

---

## 2. Per-trade cost model

Constant-product price impact per hop (fee `f`, trade `dx`, input reserve `R`, `r = dx/R`):

```
cost_vs_spot = 1 − (1−f) / (1 + r·(1−f))        # fee + impact, one hop
two-hop total = 1 − (1−cost₁)·(1−cost₂)         # USDC.e→W0G→BTC/ETH
```

**Worked cost (real reserves, f = 1%):**

| Trade size | USDC.e→W0G (deepest, 1 hop) | USDC.e→WBTC (2 hop) |
|---|---|---|
| $150 | 0.8% ✅ | **2.8% ✅ (near the limit)** |
| $500 | 2.1% ✅ | ~7% ❌ reverts |
| $900 | **3.0% — at the floor** | ~11% ❌ reverts |
| $1,000 | 3.2% ❌ reverts | ~13% ❌ reverts |
| $10,000 | 19.6% ❌ | ~55% ❌ |
| $50,000 | 54% ❌ | ~83% ❌ |

> CPMM is a **lower bound**; Jaine is a Uniswap-V3 fork with concentrated liquidity, so real
> slippage past the active tick is typically **worse**. The on-chain `minAmountOut` floor (3%)
> turns "expensive" into "**reverts**" — protective, but it means size simply can't trade.

---

## 3. The capacity wall

Largest trade that stays **under the 3% floor** (i.e. actually executes):

| Target asset | Max single trade | Implied max vault NAV (@ 50% position cap) |
|---|---|---|
| W0G (deepest pool) | **~$900** | **~$1,800** |
| BTC / ETH (two-hop) | **~$150** | **~$300** |

**A "$50k default deposit" cannot be traded.** $50k × 50% = $25k into a ~$10–43k pool → far
past the 5% hard cap → reverts. The venue caps a *functioning* vault at **single-digit-thousand
dollars of NAV**, which cannot support meaningful AUM or a fee business.

---

## 4. Depositor hurdle rate (why no turnover works)

```
net_return = gross_AI_alpha − turnover_drag − fees(0 today) − protocol_cut(0 today)
turnover_drag = round_trips/yr × cost_per_round_trip   (round trip = enter + exit ≈ 2× directional)
```

Even in the **best case** (W0G, tiny ~$900 trade ≈ 3% directional, 6% round-trip):

| Turnover | Annual drag | Gross alpha needed to beat GLV ~13% |
|---|---|---|
| 1 round-trip / **week** | ~312% | impossible |
| 1 round-trip / **month** | ~72% | implausible (>85% gross) |
| 1 round-trip / **year** | ~6% | ~19% gross — but that is **not "active AI trading"** |

The policy permits **20 trades/day**. At even 2 round-trips/day the vault is mathematically wiped
in days. **There is no frequency where active trading on this venue nets positive.**

---

## 5. Operator break-even

Operator costs are **not** the problem — gas (~$0.0006/trade) and inference (~$1–2 prepaid) are
trivial. The problems are structural:

- **No revenue:** fees are 0 and perf/mgmt fee collection isn't shipped → operator earns **$0**.
- **Idle-stake opportunity cost** dominates: to manage even a $50k-cap vault an operator locks
  **1,000 USDC** (Bronze); Gold (100k stake) forgoes ~$4–5k/yr of risk-free yield — to manage
  vaults that **cannot hold meaningful capital anyway** (§3).
- **Slashing tail risk:** up to 50% of stake per 7-day window.

So the operator stakes real USDC and earns nothing, to run vaults capped at ~$1.8k NAV.
**The break-even AUM does not exist on this venue.**

---

## 6. What would change the answer

| Lever | Effect |
|---|---|
| **Deeper venue / chain** (scaffolded Arbitrum mirror; deep DEX pools $1M+) | slippage → <0.1%/trade → the alpha math can actually close. **This is the unlock.** |
| **Re-enable an oracle guard** (Pyth currently disabled) | protects against the mispriced thin pools; doesn't fix depth |
| **Reposition to ultra-low-turnover / preservation** | minimizes drag — but 0G depth still caps NAV at ~$1.8k, so capacity stays broken until venue changes |
| **Turn on entry/exit fees + ship perf/mgmt collection** | needed for *operator/protocol* revenue — but pointless until depositor net is positive |

---

## 7. The honest "financial benefit" you can show **today**

You cannot honestly show a **yield** number on this venue. What you *can* show, truthfully:

1. **Capital preserved, in dollars** — frame the policy veto / slippage floor / 50% position cap
   as *"the vault refused a trade that would have cost you X%."* Downside protection is a real,
   verifiable financial benefit post-3Commas/Polycule — and it's the one the contract genuinely
   delivers.
2. **Cost transparency** — show the *real* take-home math (gross → slippage → fee → net) instead
   of a promised APY. Honesty itself converts the sophisticated allocator you're targeting.
3. **A real yield number only after** you move to a venue where §4 can be positive, then run one
   house vault and display its **realized on-chain PnL**. That is the number that earns deposits.

---

*Assumptions: 0G=$0.2725; pool reserves @ block 36552872; CPMM lower-bound on a V3-fork venue;
passive baselines [UNVERIFIED]; live vault fees all 0. Re-run with deeper-venue reserves to model
the Arbitrum case.*
