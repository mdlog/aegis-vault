# Money-Path Audit — Pre-Real-Money (Arbitrum showcase vault)

> Adversarial audit of every real-money code path (deposit / buy / sell / withdraw / NAV / fees /
> slippage / oracle / replay) before depositing real funds on Arbitrum. Method: 20 multi-lens
> auditors (Feynman line-questioning + state-inconsistency + web3 bug classes) → every finding
> independently **refuted** by a skeptic → synthesis. 42 agents, 21 candidates, **4 confirmed**.
>
> ## VERDICT: 🔴 NO-GO — do not deposit real money until the BLOCKER is DEPLOYED + fork-tested.

## Fix status (2026-06-20)

- 🟢 **BLOCKER (cap decimals) — FIXED IN SOURCE.** Guard `&& intent.assetIn == baseAssetAddr` added in all 3 locations (`ExecLibV4.sol:133`, `AegisVault_v4.sol:543`, `ExecLib.sol:101`). RED→GREEN regression test in `contracts/test/AegisVault_v4.test.js`. Full contract suite **287 passing**. *Not yet deployed* — lands on a fresh fixed Arbitrum V4 deploy.
- 🟢 **Bug #2 (drawdown rebase) — FIXED IN SOURCE (orchestrator).** `updatePnlMetrics` now shifts baselines by the flow delta instead of rebasing to NAV. RED→GREEN test `orchestrator/test/pnl-metrics.test.js`. Orchestrator suite **189 passing**. Follow-up: contract-side cross-chain `totalDeposited += actualAmountOut` (`AegisVault_v4.sol:561-562`) deferred — inactive Khalani path only, not the live `executeIntent` path.
- ⏳ **Remaining gates before real money:** deploy fixed V4 to Arbitrum · fork-test BUY→SELL round-trip · re-enable Pyth oracle guard · the REQUIRED checklist items below.

---

## 🔴 BLOCKER (HIGH) — the AI can BUY WETH but can NEVER SELL/stop-loss it on-chain

**Decimals mismatch in the `maxPositionBps` trade-size cap.**

- The cap is `cap = totalDeposited × maxPositionBps / 10000`. `totalDeposited` is in **base-asset units = USDC 6-dec**.
- But on a SELL, `intent.amountIn` is the **sold WETH amount in 18-dec native units** (`executor.js:185-191` → `calculateSellAmountFromHoldings` returns raw balance × fraction).
- The check compares them directly with **no normalization** → for any realistic WETH amount, `amountIn ≫ cap` → **revert `PositionTooLarge`**.

**Arithmetic (size-independent):** $50k vault → `cap = 50000e6 × 0.5 = 2.5e10`. Max WETH that passes = `2.5e10 / 1e18 = 2.5e-8 WETH` (**dust**). Selling even 0.001 WETH reverts.

**Money impact:** A WETH position can be *entered* (BUY: `amountIn` is 6-dec USDC, passes) but **never *exited* by the AI**. Every stop-loss / take-profit / defensive_exit / full-exit SELL reverts. In a falling market the per-cycle stop-loss fires and reverts every cycle — the position runs the **entire drawdown the stop-loss existed to cut**. On a 50k USDC vault rotated into WETH, a 30% drop = **~15k USDC of avoidable loss**.

**Why HIGH not CRITICAL:** funds aren't permanently stuck — the owner can manually `withdrawAllNonBase()` / `withdrawToken()` (`AegisVault_v4.sol:282-301`) to pull raw WETH out and sell off-protocol. That's an emergency rescue, **not** the advertised automated risk management.

**Scope:** WETH (18-dec) is **bricked**. WBTC (8-dec) is *not* bricked (8≈6 → cap passes) but the same bug makes its over-sizing guard **~100× too loose**.

**Locations (3 — fix all):**
- `contracts/contracts/v4/ExecLibV4.sol:133-137` (primary)
- `contracts/contracts/v4/AegisVault_v4.sol:543-546` (`acceptCrossChainFill` — Khalani cross-chain twin)
- `contracts/contracts/libraries/ExecLib.sol:101-104` (legacy V3)

**Why nothing caught it off-chain:** `policyCheck.js:83-91` only validates `sellFractionPct ∈ (0,100]` for SELLs; `riskVeto.js` never vetoes SELLs. And **every existing cap test uses a 6-dec USDC→USDC `amountIn`** (`AegisVault_v3.test.js:588/601`) — so the 18-dec SELL path is completely untested.

**Fix:**
- **Simplest correct:** apply the `maxPositionBps` cap **only when `intent.assetIn == baseAsset`** (the BUY leg, where `amountIn` is genuinely 6-dec USDC). The cap is a *principal-deployment* limit ("how much USDC to deploy per BUY"), not an exit throttle — the SELL leg is already bounded by the asset-in balance check (`ExecLibV4.sol:131`) + `minAmountOut` slippage.
- **Stronger (also fixes the ~100× WBTC looseness):** convert `amountIn` to base-asset/USD-6 units via the `VaultNAVCalculator`/Pyth pricing the vault already integrates, then compare to `cap` — units-consistent for both legs.
- **Regression test:** BUY then *fully* SELL an 18-dec WETH position under `maxPositionBps=5000`; must fail on current code, pass after fix. Keep a BUY-oversize test so the BUY-leg cap still bites.

---

## 🟠 BUG #2 (MEDIUM) — daily-loss / drawdown halt silently disarmed during a drawdown

The off-chain daily-loss & rolling-drawdown veto is the **only** daily-loss backstop (on-chain `validateDailyLoss`/`validateAll` were removed — `PolicyLibrary.sol:70-75`). `updatePnlMetrics` (`orchestrator.js:218-237`) detects "capital flow" from a raw `totalDeposited` delta and on any flow **rebases `peak_nav`/`daily_open_nav` to the current (depressed) NAV**, collapsing `rolling_drawdown_pct` and `daily_pnl_pct` to ~0.

**Impact (bounded, indirect):** a vault genuinely approaching its 6% drawdown / max-daily-loss halt reads drawdown ~0 after (a) a depositor top-up, or (b) a cross-chain SELL-to-base fill misclassified as a deposit (`AegisVault_v4.sol:561-562` does `totalDeposited += actualAmountOut` with no offsetting NAV change). The halt stops firing → losses run past the configured limit by ≥1 cycle. Bounded by the surviving per-position cost-basis stop-loss (~2.2%), confidence/risk/ATR/regime gates, and slippage limits — not an unbounded drain.

**Fix:** track cumulative net contributions separately; compute drawdown as NAV-minus-net-contributions so the high-water mark survives flows (on deposit *raise* the HWM by the deposit, don't reset). Distinguish a cross-chain trade settlement from a true deposit by event source, not the `totalDeposited` delta. Defense-in-depth: re-add an on-chain daily-loss validator, since Arbitrum runs real money.

---

## ✅ GO/NO-GO checklist (all must pass before real funds)

**Blocking:**
1. **Fork test the WETH round-trip** — Arbitrum fork, flagship vault `[USDC, WETH, WBTC]`, `maxPositionBps=5000`: BUY USDC→WETH succeeds; then full SELL **and** a 0.001 WETH partial SELL must **execute, not revert**. (Today they revert — the blocker.)
2. **Patch + fork-test the Khalani path** — `acceptCrossChainFill` (`AegisVault_v4.sol:543-545`) patched identically; WETH-in cross-chain SELL no longer reverts.
3. **Regression test** — BUY-then-full-SELL of an 18-dec asset under `maxPositionBps=5000`; fails on current code, passes after fix.
4. **BUY still size-capped after the fix** — a BUY with `amountIn > cap` still reverts (fix must not remove the BUY-leg guard).

**Required:**
5. Read the **live on-chain `getPolicy()`** of the real Arbitrum vault — confirm `maxPositionBps` (5000 = bug active; 0 = no size guard at all). Neither is acceptable without the fix.
6. Verify **WBTC over-sizing** is bounded after the value-denominated fix.
7. Fix + runtime-test the **drawdown-veto rebase**: drive a real drawdown, deposit a top-up, confirm the halt still fires; repeat for a Khalani SELL-to-base.
8. Confirm the **emergency escape hatch** (`withdrawAllNonBase`/`withdrawToken`) works from the owner wallet while a WETH position exists.
9. **Re-enable + validate the Pyth oracle guard** on Arbitrum (live non-stale feeds for USDC/WETH/WBTC; swap reverts when `minAmountOut` < oracle floor).
10. Confirm **no signer/executor key** is in any committed file or pushed history (prior wallet-drain incident).

---

## Coverage gaps (this audit was static code + arithmetic; verify at runtime)

- No on-fork end-to-end run was performed — the WETH-SELL revert is proven by code+math but should be reproduced on an Arbitrum fork against the deployed bytecode.
- Swap-time slippage/oracle behavior not exercised at runtime (a dead-venue `getAmountOut` → `venueMinOut=0`, and `oracleMinOut=0` for unpriced assets, were dismissed on reasoning — confirm `minAmountOut` is actually depth-protective on a live swap).
- Full Khalani / `CrossChainLibV4` settlement + replay guard (`consumedKhalaniIds`) and `shouldUseKhalaniRoute` selection — only read around the two findings; warrants its own pass.
- Sealed-mode commit-reveal + `attestedSigner` ECDSA path — not deeply audited for replay/attestation-bypass; review before running the showcase in sealed mode.
- NAV correctness (`VaultNAVCalculator` per-asset Pyth pricing & decimals vs withdrawal settlement) — spot-checked only; withdrawals settle at NAV, so a dedicated rounding/decimals pass is recommended.
- Live on-chain policy values & the real deployed vault address were not read from chain here — confirm before deposit.

---

*42 agents · 21 candidates · 4 confirmed (2 unique bugs + 2 duplicate framings of the blocker). Adversarially verified. Re-run after fixes.*
