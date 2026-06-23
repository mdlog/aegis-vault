# Orchestrator Review — Arbitrum real-money readiness

> 5 parallel reviewers (decision→intent, risk controls, price/oracle, execution robustness,
> state/persistence) + adversarial verification of every high/critical finding. 14 agents.
> **23 findings: 8 high, 9 medium, 5 low** (the 1 "critical" was verified down to high).
> Known/already-fixed bugs (cap decimals, drawdown rebase, no on-chain Pyth push) excluded.

## Verdict
The orchestrator is feature-rich but carries **several real money-relevant defects**, concentrated
in **risk-control completeness**, **V4 result parsing**, and **state durability**. None is a one-tx
drain, but several **silently disarm a safety control or corrupt the state that drives money
decisions** — exactly the failure class that matters for a showcase vault. Fix the HIGHs before real
funds.

---

## 🔴 HIGH — verified, fix first

### H1 · The daily-loss gate blocks the SELL that exits a losing position
`policyCheck.js:94-116` · `orchestrator.js:588`
`checkDailyLoss` has no sell/exit early-out, so when the vault is underwater the daily-loss limit
**blocks the defensive/stop-loss SELL** — the exact action meant to contain the loss. The position
stays stuck each cycle, deepening the drawdown, until NAV recovers or the UTC day rolls over.
**Fix:** `checkDailyLoss` returns valid for any non-BUY action — the limit must only block *opening*
risk, never *closing* it. (Cooldown/daily-actions are enforced on-chain too, so don't strip those
off-chain — separate contract concern.)

### H2 · V4 success flag is unreadable → defaults to `true` (flagship path)
`executor.js:508,592-595`
The V4 ABI lacks the `IntentExecuted` event (it lives in `VaultEvents`/`ExecLibV4`), so `parseLog`
fails, `executionSuccess` **defaults to `true`**, and `amountOut` is `null` for **every V4
execution**. A swap that didn't settle is booked as a winning trade → corrupts `positionState`
(cost-basis/PnL/drawdown baselines) **and writes a false success/PnL to on-chain OperatorReputation**.
**Fix:** parse logs against a VaultEvents-merged ABI for V4; and when no `IntentExecuted` is found,
treat the result as indeterminate/failed — never default to success.

### H3 · Lost/corrupt journal fails OPEN — disarms the drawdown/daily-loss halt
`storage.js:104-120` · `orchestrator.js:162-166,229-233`
The local KV journal is the sole state store (0G Storage off by default). On corruption/loss/fresh
deploy, `positionState` is absent → baselines re-seed `peak_nav = daily_open_nav = current
(depressed) NAV` → drawdown/daily-loss read ~0 → **the loss halt is silently disarmed while
underwater**, granting a fresh ~6% loss budget. Fails OPEN, not safe.
**Fix:** (a) reconstruct/keep a durable high-water mark (don't seed peak at current NAV on state
loss); (b) independent fail-safe: refuse BUY when on-chain NAV is below `last_total_deposited` by
> max-daily-loss, regardless of in-memory state; (c) force HOLD + alert on a detected state loss.

### H4 · Multi-asset vault collapses all holdings into one position bucket
`orchestrator.js` (positionState / syncPositionStateFromHoldings)
Cost-basis, realized PnL, and exit sizing assume a single position; a vault holding >1 non-base asset
mis-attributes cost-basis and PnL → wrong SELL sizing and wrong drawdown math.
**Fix:** track position state per-asset (or constrain a vault to one risk asset and enforce it).

*(H3/H4 overlap a related state-persistence HIGH about cost-basis re-seeding — same durability root.)*

---

## 🟠 MEDIUM — fix before scale

- **M1 · `consecutive_losses` circuit-breaker is permanently inert** (`riskVeto.js:69`, `orchestrator.js:795`) — counter is never incremented on a losing SELL, so the loss-streak veto + BUY gate do nothing. Fix: increment on realized-loss SELL, reset on win.
- **M2 · Arbitrum UniV3 adapter has no `getAmountOut`** → off-chain venue floor is dead on the real-money chain; `minAmountOut` degrades to oracle-only, and in the edge where the oracle price is also missing, `minAmountOut = 0` → **zero slippage protection / on-chain `minOut` revert**. Fix: add a QuoterV2-backed `getAmountOut` to the adapter; and refuse to build an intent when both floors are 0 (never submit `amountOutMinimum=0`).
- **M3 · SELL has no CBBTC→BTC oracle fallback** → `minAmountOut=0n` → gas-burn revert (latent until cbBTC is sellable).
- **M4 · `executeIntent` re-broadcasts on a transient `tx.wait()` error** → no double-swap (registry blocks it) but the failure branch **unclaims a settled intent and skips the success state update** → off-chain state diverges from chain. Fix: broadcast once, retry only the receipt fetch; treat `IntentAlreadySubmitted` for the same hash as success-pending.
- **M5 · `tx.wait()` has no deadline** → a broadcast-but-unmined tx **hangs the cycle indefinitely** (related to the 98% CPU hang seen earlier). Fix: bounded wait + timeout handling.
- **M6 · Sealed-mode commit is non-idempotent** → a reveal failure after a mined commit leaves an orphan commit.
- **M7 · Wallet-pool shard decoupled from `vault.executor`** → a deposit can sit idle (nobody executes for the funded vault).
- **M8 · Multi-chain registry (`chains.js`) is dead code** → process is hardwired single-chain; running Arbitrum needs a second process or wiring.
- **M9 · Stale-price fallback stamps hardcoded prices with a fresh timestamp** on Hermes/CoinGecko failure (non-strict mode).
- **M10 · V4 strategy manifest can widen (disarm) the volatility/RSI/loss-streak vetoes.**

## 🟡 LOW (5)
Uncapped BUY notional vs spendable; `_strategySchemaVer` misspelling in CC fallback; hardcoded 6% drawdown threshold; hardcoded 0G chainId default in `chooseRoute`; local-JSON store has no cross-process lock.

---

## Fix status (2026-06-20)
- ✅ **H1 FIXED** — `checkDailyLoss` now returns valid for any non-BUY action (only blocks opening risk). RED→GREEN in `test/policy-check.test.js`.
- ✅ **H3 FIXED** — added journal-independent `checkNavFloor` fail-safe: blocks BUY when on-chain NAV < principal by > maxDailyLoss% (fails SAFE on lost/corrupt state). RED→GREEN.
- ✅ **M1 FIXED** — `nextConsecutiveLosses` helper increments the loss-streak on a realized-loss SELL / resets on win; wired into the settlement block. RED→GREEN in `test/risk-counters.test.js`.
- Orchestrator suite **199 passing**. Remaining: H2, H4, M2, M4, M5 (below).

## Recommended fix order (remaining, all TDD-able)
1. **H2** V4 IntentExecuted ABI merge + no success default *(flagship correctness)*
2. **M2** zero-floor intent guard + UniV3 `getAmountOut` *(money-safety)*
3. **M4/M5** broadcast-once + bounded `tx.wait()` *(robustness / anti-hang)*
4. **H4** per-asset position tracking *(larger; or enforce single-asset)*

*Each fix RED→GREEN with a regression test, mirroring the cap/drawdown fixes.*
