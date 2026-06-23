# Dashboard — Mock vs Real Inventory

> 5 parallel classifiers + synthesis over the frontend + orchestrator API. ~58 deduplicated
> user-visible metrics: **14 REAL · 27 HYBRID · 17 MOCK**.
>
> Master gate `VITE_ENABLE_DEMO_FALLBACKS=0` today (frontend/.env), so **most** demo numbers do
> NOT render — they appear only under `?demo=1` or with the flag on. BUT a few fabricated values
> **bypass the gate and render on the LIVE page right now** (0 vaults → no real data → synthetic).

---

## ✅ Fix status (2026-06-21)
The four honesty-critical items that rendered FAKE on the LIVE page are **FIXED** (frontend builds clean):
- **Rolling accuracy 88%** → shows `—` + "Awaiting first cycle — no live decisions yet"; no fabricated curve/delta (`DashboardPage.jsx`).
- **Aggregate Risk 24/Low** → renders `—` / "No signal" when no live signal; relabeled **"Risk · latest signal"** (no longer claims "aggregate"); demo value only under demo mode.
- **Hero TVL sparkline** → fabricated uptrend removed; shows "TVL history — awaiting indexer" until a real series exists.
- **"stop-loss enforced on-chain"** → corrected to "enforced **off-chain** by the orchestrator" + notes that min-confidence/position-size ARE on-chain (`VaultDetailPage.jsx`).
- Also: hardcoded **"Slip 0.08"** → `—`.

Remaining (improvements, not live-page lies): tag demo values with the existing DEMO pills on the hero/VaultDetail · wire Leaderboard reputation to real `OperatorReputation` · fix `useVaultList` hardcoded decimals=6 · surface server fallback-price flag · delete dead mockData components · disclose slim-vault fee gap.

---

## 🔴 Renders FAKE on the LIVE page TODAY (no demo flag needed) — ~~fix these first~~ FIXED above

| Metric | What shows | Why it's fake | Where |
|---|---|---|---|
| **Rolling accuracy 30d** | **"88% / +26 pts"** + rising bars | Hardcoded curve `[62…88]`; `isSynthetic` path is **NOT gated** on the demo flag. 0 vaults → no real decisions → always synthetic | `DashboardPage.jsx:524-530` |
| **Aggregate Risk gauge** | **"24 / Low"** | `computeRisk(null)` returns hardcoded `{24,'Low'}` whenever there's no live signal — **independent of the gate**. Also mislabeled "aggregate/portfolio" — it's a single‑signal confidence+veto heuristic | `DashboardPage.jsx:1073,1163` |
| **Hero TVL sparkline** | rising trend curve | Hardcoded monotonic array `[0.72…1.0]`, never gated; renders a fake uptrend even though real TVL = 0 | `DashboardPage.jsx:1180-1185` |
| **"stop-loss enforced on-chain at X%"** + daily-loss | policy-gate copy | **VERIFIED**: deployed slim vault only *stores* these bps (`VaultEvents.sol:21`) — no `require/revert`. Claim is false. (maxPosition + min-confidence ARE on-chain — `ExecLib.sol:91`.) | `VaultDetailPage.jsx:1451-1455` |
| **Risk "Slip 0.08"** | sub-stat | Pure hardcoded literal, never wired | `DashboardPage.jsx:922` |
| **"100ms feed" / "10s poll"** | latency captions | Fabricated; real poll is 10000ms; Pause button doesn't actually pause | `ActionsPage.jsx:606,436` |

---

## Full inventory (by classification)

### ✅ REAL (wired to on-chain / live API, no silent demo fallback)
| Metric | Real source |
|---|---|
| Network label | `getNetworkLabel(chainId)` |
| LiveReadinessBanner (Factory/Registry/Gov Live/Missing) | `isConfiguredAddress(deployments.*)` |
| Multi-asset NAV · Platform TVL · vault list · policy · asset balances | `/api/nav` (on-chain balanceOf × Pyth), wagmi reads, `getPolicy()` |
| Operator staking/reputation/registry/insurance · 0G status · 0G compute models | wagmi + `/api/og/status`, `/api/og-compute/models` |
| VaultDetail wallet/vault balances · session tx list | on-chain wagmi (no fallback) |
| VaultDetail Fees/HWM/getNav tiles | on-chain — **but functions don't exist on the slim 0G vault → read 0** |
| Honesty pills (LIVE/DEMO, "demo" chips, AppShell Demo badge) | computed from real status presence |
| TEE-attested badge (signer/report hash/commit tx) | live journal entry only (absent at 0 vaults) |

### 🟡 HYBRID (real source + silent demo/zero fallback, OR real input but fake aggregation)
| Metric | Real path | Mock fallback / when |
|---|---|---|
| Platform TVL big number | `usePlatformTVL` sum of `/api/nav` | demo $2.84M under gate; **"+12.4% · 7d" delta is fake even on the real path** |
| Vault counts (total/running/my) | on-chain factory enumeration | demo 6/5/2 under gate |
| AI Signal card (action/conf/risk/edge/regime…) | `/api/status` `lastSignal` (real, **not** sanitized) | `demoSignal` under gate |
| Pyth prices + Live dot | `/api/pyth/prices` (Hermes) | demo prices under gate; **server can silently serve fallback constants while labeled "pyth-hermes"** |
| Orchestrator status counters (cycles/exec/blocked/skipped) | `/api/status` KV journal | `demoStatus` (146/18/7/41) under gate |
| Journal/decisions/executions feed rows | `/api/journal*` (sanitized for public) | `demoJournalEntries` under gate |
| Operator Leaderboard "Reputation" | stake/tier real on-chain | **rep bar is a fabricated `0.6+tier*0.12` formula — ignores real `OperatorReputation`** |
| Operator count | on-chain registry | literal `5` under gate |
| VaultDetail NAV / PnL / return% / cost-basis | on-chain + `/api/journal/executions` realized PnL | demo `128420.52` / `1842.3` under `showDemoVault` |
| VaultDetail allocation rows (asset/$/% of NAV) | `/api/nav` breakdown × Pyth | demo allocation under gate |
| VaultDetail risk gauge | concentration + drawdown + signal conf (real inputs) | **single-vault heuristic w/ hardcoded thresholds — not a risk model** |
| VaultDetail policy gates (maxPos/conf/stop/daily/cooldown) | on-chain `getPolicy()` bps | demo policy; **CapitalTicket "Cooldown 24h" is a static literal** |
| VaultDetail mandate label · sealed/TEE badge · fee chips | on-chain | demo under gate; **"· v1" suffix is hardcoded (not from `version()`)** |
| NAV/PnL/drawdown charts | journal-derived series | 16-pt demo curve under gate |
| Capital-ticket "share price" / est. shares | `nav/deposited` ratio | **literal "1.0000" — not a real ERC4626 share price** |
| Executor sync badge · addresses · last-exec · paused · dailyActions | on-chain `getVaultSummary` | demo fields under gate |
| ActionsPage KPIs / exec metadata / per-entry PnL | live journal totals | demo constants; **only visible PnL today is demo $1,842.30** |
| Operator marketplace / CreateVault picker / Governance | on-chain reads | full demo fallback under gate |

### ❌ MOCK (hardcoded / dead)
| Metric | Source |
|---|---|
| Rolling accuracy 88% · hero sparkline · Slip 0.08 · 100ms/10s captions | hardcoded literals (see LIVE table above) |
| Hero footer + ticker constants (Block 100ms, HotStuff-2, Jaine V3, GLM-5-FP8…) | static marketing copy |
| Per-entry risk_score/regime/edge/quality/veto-reason in journal feed | **public API blacklists these (`api.js:125-138`) → only demo entries have them** |
| ActionsPage DecisionTracePrimer gates (50% nav / 15% stop / 60% conf / ~400ms) | hardcoded copy, not read from policy |
| Demo operator/governance stats (97.9% success, 4.8 rating, 142 exec, treasury/insurance $) | `demoContent.js:434-512` |
| Demo tx hashes (`0x7dbf5d0c…`) + frozen Apr-2026 timestamps | `demoContent.js` |
| 7 dead `mockData` dashboard components + `mockData.js` literals (sharpe 1.84, policyCompliance 99.7) | unimported dead code |

---

## Other real-data hazards (not mock, but misleading)
- **Decimals bug:** `useVaultList` formats balances with hardcoded `decimals=6` (`useVault.js:360,463`) → off by 10^N for WETH(18)/WBTC(8) base assets.
- **Silent Pyth fallback:** server keeps `source='pyth-hermes'` even when serving hardcoded fallback prices (`pythPrice.js:107,303-310`) — UI can't tell.
- **Unwired real endpoints:** `useMarketData`, `useMarketSummary`, `useKVState`, `useOrchestratorVault` exist but are rendered nowhere.

---

## Recommendations (priority order)
1. **Kill the ungated lies first** (they render on LIVE): gate the accuracy curve or show "Awaiting first cycle"; make the aggregate-risk card show "—" with no signal and rename to "Latest-signal risk"; drive or remove the hero sparkline.
2. **Fix the on-chain-enforcement copy**: describe stop-loss / daily-loss as "orchestrator-enforced (off-chain)", not "enforced on-chain". Keep on-chain wording only for maxPosition + min-confidence.
3. **Tag every demo value visibly** (TVL, counts, operator/governance stats, NAV, charts, demo tx/timestamps) — extend the existing honest DEMO/LIVE pills to the hero + VaultDetail demo state.
4. **Wire to real where the source exists**: Leaderboard reputation → `useOperatorReputation`; TVL 7d delta from a real series or drop it; correct the latency captions.
5. **Fix silent hazards**: read real token decimals in `useVaultList`; surface a flag when the server served fallback prices.
6. **Delete dead mock code** (7 components + `mockData.js` literals + ActionsPage static gates).
7. **Disclose the slim-vault gap**: hide/label Fees/HWM tiles on 0G where the engine doesn't exist on-chain.

*All citations verified against the current source. Re-run after the dashboard is wired to a real Arbitrum V4 vault.*
