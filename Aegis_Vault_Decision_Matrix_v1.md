# Aegis Vault — Decision Matrix Buy / Sell / Hold v1

## 1. Document Objective

This document lays out a highly concrete **Buy / Sell / Hold v1 decision matrix** for **Aegis Vault**, so it can be directly consumed by the **orchestrator** to:

- read market conditions,
- determine when to **Buy**,
- determine when to **Sell / Reduce**,
- determine when to **Hold / No Trade**,
- determine **position sizing**,
- apply **risk veto**,
- and produce **JSON output** that can be validated immediately before being shaped into an execution intent.

This document is designed to be consistent with the Aegis Vault principle as:

> **AI-guided, rules-constrained, regime-aware trading vault**

The primary focus is making the system more **reliable**, **not prone to overtrading**, **not prone to flipping buy/sell due to noise**, while remaining **easy to demo**.

---

## 2. Core Principles v1

Decision engine v1 follows 6 core principles:

1. **AI is never the sole authority**.
2. **Every decision must pass through a hard risk veto layer**.
3. **Buy / Sell / Hold is determined by a combination of rules + score + regime**.
4. **Hold is an active action**, not a passive state.
5. **Entry and exit use hysteresis** to prevent continuous flipping.
6. **Position sizing must be dynamic**, not fixed size.

---

## 3. Output the Engine Must Produce

Every evaluation cycle, the decision engine must produce one of the following actions:

- `BUY`
- `SELL`
- `REDUCE`
- `HOLD_POSITION`
- `HOLD_FLAT`
- `NO_TRADE`

To keep the v1 UI simple, the frontend can display 3 broad categories:

- **Buy** → `BUY`
- **Sell** → `SELL`, `REDUCE`
- **Hold** → `HOLD_POSITION`, `HOLD_FLAT`, `NO_TRADE`

---

## 4. Minimum Data Input for Orchestrator

Before calling the agent / model, the orchestrator must first build the following structured input.

### 4.1 Market Inputs

```json
{
  "symbol": "BTC/USDC",
  "price": 68420.15,
  "ema_20": 68110.22,
  "ema_50": 67502.41,
  "ema_200": 64880.91,
  "rsi_14": 61.2,
  "macd_histogram": 45.82,
  "atr_14_pct": 1.92,
  "realized_vol_1h_pct": 2.31,
  "volume_zscore": 1.28,
  "spread_bps": 8,
  "slippage_estimate_bps": 18,
  "distance_to_local_resistance_pct": 1.9,
  "distance_to_local_support_pct": 3.8,
  "price_vs_vwap_pct": 0.74,
  "mtf_alignment": "bullish"
}
```

### 4.2 Vault State Inputs

```json
{
  "vault_equity_usd": 10000,
  "base_asset": "USDC",
  "current_position_side": "flat",
  "current_position_notional_usd": 0,
  "current_position_pnl_pct": 0,
  "last_action": "HOLD_FLAT",
  "last_execution_at": 1712345678,
  "daily_pnl_pct": -1.2,
  "rolling_drawdown_pct": 2.8,
  "consecutive_losses": 1,
  "actions_last_60m": 1,
  "time_since_last_trade_sec": 2200,
  "open_intents": 0
}
```

### 4.3 Policy Inputs

```json
{
  "allowed_assets": ["BTC", "ETH"],
  "max_position_bps": 1800,
  "max_daily_loss_bps": 300,
  "stop_loss_bps": 220,
  "take_profit_bps": 450,
  "trail_stop_bps": 180,
  "cooldown_seconds": 900,
  "max_actions_per_60m": 2,
  "min_confidence_buy": 0.75,
  "min_confidence_reduce_or_sell": 0.55,
  "max_risk_score_buy": 0.28,
  "max_slippage_bps": 30,
  "max_spread_bps": 20,
  "pause": false
}
```

---

## 5. Decision Engine v1 Structure

Decision engine v1 is divided into 6 layers:

1. **Precompute Indicators**
2. **Regime Classification**
3. **Signal Scoring**
4. **Risk Veto Layer**
5. **Action Decision Layer**
6. **Position Sizing + Intent Builder**

---

## 6. Regime Classification v1

Before determining Buy / Sell / Hold, the system must first classify the market regime.

### 6.1 Regimes Used

- `TREND_UP_STRONG`
- `TREND_UP_WEAK`
- `RANGE_STABLE`
- `RANGE_NOISY`
- `TREND_DOWN_WEAK`
- `TREND_DOWN_STRONG`
- `PANIC_VOLATILE`
- `LOW_LIQUIDITY`

### 6.2 Regime Thresholds

#### A. TREND_UP_STRONG
Select if all conditions are met:

- `price > ema_20 > ema_50 > ema_200`
- `rsi_14` between `58` and `74`
- `macd_histogram > 0`
- `atr_14_pct <= 2.8`
- `mtf_alignment == bullish`

#### B. TREND_UP_WEAK
Select if:

- `price > ema_20 > ema_50`
- `ema_50 >= ema_200`
- `rsi_14` between `52` and `65`
- `macd_histogram >= 0`
- `atr_14_pct <= 3.2`

#### C. RANGE_STABLE
Select if:

- `abs(price - ema_50) / ema_50 <= 0.015`
- `rsi_14` between `42` and `58`
- `atr_14_pct <= 2.0`
- does not satisfy strong trend up/down criteria

#### D. RANGE_NOISY
Select if:

- `rsi_14` between `40` and `60`
- `atr_14_pct` between `2.0` and `3.8`
- EMA structure is disorganized / tightly clustered
- `mtf_alignment == mixed`

#### E. TREND_DOWN_WEAK
Select if:

- `price < ema_20 < ema_50`
- `ema_50 <= ema_200`
- `rsi_14` between `35` and `48`
- `macd_histogram <= 0`

#### F. TREND_DOWN_STRONG
Select if all conditions are met:

- `price < ema_20 < ema_50 < ema_200`
- `rsi_14` between `20` and `42`
- `macd_histogram < 0`
- `atr_14_pct <= 3.0`
- `mtf_alignment == bearish`

#### G. PANIC_VOLATILE
Select if any one of the following is met:

- `atr_14_pct > 3.8`
- `realized_vol_1h_pct > 4.2`
- extreme candle expansion ratio
- sharp increase in spread/slippage

#### H. LOW_LIQUIDITY
Select if any one of the following is met:

- `spread_bps > 20`
- `slippage_estimate_bps > 30`
- insufficient depth
- extreme drop in volume

### 6.3 Regime Priority Order

If multiple regimes match, use the following priority:

1. `LOW_LIQUIDITY`
2. `PANIC_VOLATILE`
3. `TREND_UP_STRONG`
4. `TREND_DOWN_STRONG`
5. `TREND_UP_WEAK`
6. `TREND_DOWN_WEAK`
7. `RANGE_NOISY`
8. `RANGE_STABLE`

---

## 7. Signal Scoring v1

After the regime is determined, the system computes a numeric score.

### 7.1 Subscores

All subscores use the `0–100` range.

#### A. Trend Score

Scoring:

- `+30` if `price > ema_20`
- `+20` if `ema_20 > ema_50`
- `+20` if `ema_50 > ema_200`
- `+15` if ema_20 slope is positive
- `+15` if ema_50 slope is positive

Clamp the result to `0–100`.

#### B. Momentum Score

Scoring:

- `+25` if `rsi_14 >= 55 && rsi_14 <= 70`
- `+15` if `rsi_14 > 70` but not yet extreme
- `+20` if `macd_histogram > 0`
- `+20` if histogram is increasing versus the previous window
- `+20` if `price_vs_vwap_pct > 0`

#### C. Volatility Suitability Score

The purpose of this score is not "the more volatile the better", but to assess whether volatility is **still tradable**.

- `100` if `atr_14_pct <= 2.0`
- `80` if `2.0 < atr_14_pct <= 2.6`
- `60` if `2.6 < atr_14_pct <= 3.2`
- `35` if `3.2 < atr_14_pct <= 3.8`
- `10` if `atr_14_pct > 3.8`

#### D. Liquidity / Execution Score

Start from `100`, then subtract:

- `-2 * spread_bps`
- `-1.5 * slippage_estimate_bps`
- `-10` if depth is thin
- `-10` if route is unstable

Clamp the result to `0–100`.

#### E. Risk State Score

Start from `100`, then subtract:

- `-10 * consecutive_losses`
- `-2 * abs(daily_pnl_pct)` if negative
- `-3 * rolling_drawdown_pct`
- `-15` if `actions_last_60m >= 2`
- `-15` if `time_since_last_trade_sec < cooldown_seconds`

Clamp the result to `0–100`.

#### F. AI Context Score

Obtained from the model / agent, also on a `0–100` scale, based on:

- clarity of setup,
- regime suitability,
- confidence consistency,
- entry timing quality,
- absence of contradictory signals.

### 7.2 Final Weighting

Use the formula:

```text
final_edge_score =
  0.25 * trend_score +
  0.20 * momentum_score +
  0.15 * volatility_score +
  0.15 * liquidity_score +
  0.15 * risk_state_score +
  0.10 * ai_context_score
```

The result is rounded to the `0–100` scale.

---

## 8. Hysteresis Thresholds v1

To prevent the system from flipping constantly, use different entry / hold / exit thresholds.

### 8.1 Main Thresholds

- **Enter Buy Threshold**: `72`
- **Stay-in-Position Threshold**: `58`
- **Reduce Threshold**: `52`
- **Exit Threshold**: `48`

### 8.2 Threshold Meanings

- `>= 72` → setup is strong enough to enter a new position
- `58–71` → existing position may be held, but do not add
- `52–57` → position starts being weakened / reduced
- `< 48` → full exit or no-trade

---

## 9. Hard Risk Veto Layer v1

This layer is executed **before** the final action is decided.

If any veto is active, then the system **must not buy** even if the final score is high.

### 9.1 Hard Veto Conditions

Set `hard_veto = true` if any of the following is met:

1. `pause == true`
2. asset is not in the whitelist
3. `open_intents > 0`
4. `time_since_last_trade_sec < cooldown_seconds`
5. `actions_last_60m >= max_actions_per_60m`
6. `daily_pnl_pct <= -(max_daily_loss_bps / 100)`
7. `rolling_drawdown_pct >= 6.0`
8. `consecutive_losses >= 3`
9. `spread_bps > max_spread_bps`
10. `slippage_estimate_bps > max_slippage_bps`
11. `atr_14_pct > 3.8`
12. market data stale
13. route / venue degraded
14. `confidence < 0.55`
15. `risk_score > 0.45`

### 9.2 Effect of Hard Veto

If `hard_veto = true`, the action can only be one of:

- `HOLD_FLAT`
- `HOLD_POSITION`
- `REDUCE`
- `SELL`
- `NO_TRADE`

`BUY` is prohibited.

---

## 10. Soft Filters v1

Soft filters do not directly block a trade, but they degrade the setup quality.

### 10.1 Soft Filter Conditions

- `distance_to_local_resistance_pct < 1.2` for long entry
- `rsi_14 > 72`
- `price_vs_vwap_pct > 1.5`
- volume does not support the breakout
- multi-timeframe alignment is mixed
- market just spiked on a single candle without retest

If 2 or more soft filters are active, subtract:

- `trade_quality_score - 10`
- `size_multiplier - 0.15`

---

## 11. Decision Matrix Buy / Sell / Hold v1

## 11.1 BUY Matrix

### BUY may only occur if all core requirements are met:

1. `hard_veto == false`
2. `regime` is one of:
   - `TREND_UP_STRONG`
   - `TREND_UP_WEAK`
   - `RANGE_STABLE` **only if** a valid support reversal is present
3. `final_edge_score >= 72`
4. `confidence >= 0.75`
5. `risk_score <= 0.28`
6. `trade_quality_score >= 78`
7. `current_position_side == flat`
8. `slippage_estimate_bps <= 30`
9. `spread_bps <= 20`
10. `consecutive_losses <= 1`

### BUY timing conditions

At least one of the following must be met:

- valid breakout + retest
- two candles closing above a minor resistance
- price above VWAP + supportive volume
- dip to ema20 followed by a bounce in an uptrend

### BUY size bands

- confidence `0.75–0.80` → `size_bps = 500–800`
- confidence `0.81–0.87` → `size_bps = 900–1200`
- confidence `> 0.87` → `size_bps = 1200–1500`

Must still not exceed the `max_position_bps` policy.

---

## 11.2 SELL Matrix

SELL is divided into 3 types.

### A. Defensive SELL

Trigger a full SELL if any of the following is met:

- `current_position_pnl_pct <= -(stop_loss_bps / 100)`
- `rolling_drawdown_pct >= 6.0`
- `atr_14_pct > 4.2`
- `confidence < 0.40`
- `risk_score > 0.55`
- regime changes to `TREND_DOWN_STRONG` or `PANIC_VOLATILE`
- abnormal venue / broken market data

### B. Tactical SELL

Trigger a full SELL if all of the following are met:

- `final_edge_score < 48`
- `confidence < 0.55`
- momentum is broken
- price drops below ema20 and fails to reclaim

### C. Profit Realization SELL

If the position is profitable:

- `current_position_pnl_pct >= 2.5` and score falls below `58` → trim / reduce
- `current_position_pnl_pct >= 4.5` and momentum weakens → SELL or large reduce
- trailing stop is hit → SELL

---

## 11.3 REDUCE Matrix

Use `REDUCE` when an existing position does not yet need full closure, but the edge is weakening.

### REDUCE if all of the following are met:

1. `current_position_side != flat`
2. `final_edge_score >= 48 && final_edge_score < 58`
3. `confidence >= 0.50 && confidence < 0.65`
4. regime is not `TREND_UP_STRONG`
5. no defensive sell trigger is active

### Reduce amount

- reduce `25%` of the position if score is `54–57`
- reduce `50%` of the position if score is `50–53`
- reduce `75%` of the position if score is `48–49`

---

## 11.4 HOLD Matrix

### HOLD_POSITION

Select `HOLD_POSITION` if all of the following are met:

1. `current_position_side != flat`
2. `final_edge_score >= 58`
3. `confidence >= 0.60`
4. `risk_score <= 0.40`
5. no hard veto is forcing an exit

### HOLD_FLAT

Select `HOLD_FLAT` if all of the following are met:

1. `current_position_side == flat`
2. `final_edge_score >= 52 && final_edge_score < 72`
3. or `confidence >= 0.55 && confidence < 0.75`
4. or regime = `RANGE_NOISY`
5. no valid timing setup

### NO_TRADE

Select `NO_TRADE` if:

- `hard_veto == true`
- or regime = `LOW_LIQUIDITY`
- or regime = `PANIC_VOLATILE`
- or data is stale

---

## 12. Summary Decision Table

| Condition | Action |
|---|---|
| hard veto active + flat | NO_TRADE |
| hard veto active + position open | HOLD_POSITION / REDUCE / SELL depending on severity |
| bullish regime + score >= 72 + confidence >= 0.75 + risk_score <= 0.28 + valid timing | BUY |
| position open + score >= 58 | HOLD_POSITION |
| position open + score 48–57 | REDUCE |
| position open + score < 48 | SELL |
| flat + score 52–71 but timing not yet valid | HOLD_FLAT |
| noisy / panic / low liquidity regime | HOLD_FLAT / NO_TRADE |

---

## 13. Trade Quality Score v1

Trade quality is used as a final filter before the intent is constructed.

### 13.1 Formula

```text
trade_quality_score =
  0.30 * final_edge_score +
  0.20 * execution_score +
  0.20 * timing_score +
  0.15 * regime_suitability_score +
  0.15 * confidence_score_scaled
```

### 13.2 Thresholds

- `>= 78` → execute normal
- `70–77` → execute small only
- `60–69` → hold
- `< 60` → reject / no trade

---

## 14. Position Sizing v1

Use the following dynamic sizing.

### 14.1 Base Formula

```text
position_size_bps =
  base_size_bps * confidence_multiplier * volatility_multiplier * drawdown_multiplier
```

### 14.2 Recommended Values

#### base_size_bps
- conservative: `700`
- balanced: `1000`
- aggressive: `1300`

#### confidence_multiplier
- `0.75–0.80` → `0.8`
- `0.81–0.87` → `1.0`
- `> 0.87` → `1.15`

#### volatility_multiplier
- `atr <= 2.0` → `1.0`
- `2.0 < atr <= 2.8` → `0.9`
- `2.8 < atr <= 3.2` → `0.75`
- `> 3.2` → `0.5`

#### drawdown_multiplier
- `rolling_drawdown_pct < 2` → `1.0`
- `2–4` → `0.8`
- `4–6` → `0.6`
- `> 6` → `0.0`

### 14.3 Final Clamp

- minimum size: `300 bps`
- recommended normal max: `1500 bps`
- hard cap: `max_position_bps` from policy

---

## 15. Flow Chart v1

## 15.1 High-Level Decision Flow

```mermaid
flowchart TD
    A[Start Cycle] --> B[Fetch Market Data]
    B --> C[Build Vault State Snapshot]
    C --> D[Compute Indicators]
    D --> E[Classify Regime]
    E --> F[Call Agent / Model]
    F --> G[Compute Scores]
    G --> H{Hard Veto?}
    H -- Yes --> I{Open Position?}
    I -- No --> J[NO_TRADE or HOLD_FLAT]
    I -- Yes --> K[REDUCE / SELL / HOLD_POSITION]
    H -- No --> L{Open Position?}
    L -- No --> M{Buy Conditions Met?}
    M -- Yes --> N[Compute Position Size]
    N --> O[Build BUY Intent]
    M -- No --> P[HOLD_FLAT]
    L -- Yes --> Q{Score >= 58?}
    Q -- Yes --> R[HOLD_POSITION]
    Q -- No --> S{Score >= 48?}
    S -- Yes --> T[REDUCE]
    S -- No --> U[SELL]
```

## 15.2 Buy Gate Flow

```mermaid
flowchart TD
    A[Candidate Buy] --> B{Regime Allowed?}
    B -- No --> X[Reject to HOLD_FLAT]
    B -- Yes --> C{final_edge_score >= 72?}
    C -- No --> X
    C -- Yes --> D{confidence >= 0.75?}
    D -- No --> X
    D -- Yes --> E{risk_score <= 0.28?}
    E -- No --> X
    E -- Yes --> F{trade_quality >= 78?}
    F -- No --> X
    F -- Yes --> G{spread/slippage OK?}
    G -- No --> X
    G -- Yes --> H{timing valid?}
    H -- No --> X
    H -- Yes --> I[BUY]
```

## 15.3 Position Management Flow

```mermaid
flowchart TD
    A[Open Position] --> B{Defensive Sell Trigger?}
    B -- Yes --> C[SELL]
    B -- No --> D{final_edge_score >= 58?}
    D -- Yes --> E[HOLD_POSITION]
    D -- No --> F{final_edge_score >= 48?}
    F -- Yes --> G[REDUCE]
    F -- No --> H[SELL]
```

---

## 16. JSON Output Schema for Agent

The agent output must always be structured and easy to validate.

## 16.1 Concise Schema

```json
{
  "version": "1.0",
  "timestamp": 1712345678,
  "symbol": "BTC/USDC",
  "regime": "TREND_UP_STRONG",
  "action": "BUY",
  "bias": "BULLISH",
  "confidence": 0.82,
  "risk_score": 0.24,
  "trend_score": 84,
  "momentum_score": 79,
  "volatility_score": 80,
  "liquidity_score": 88,
  "risk_state_score": 91,
  "ai_context_score": 76,
  "final_edge_score": 83,
  "timing_score": 81,
  "trade_quality_score": 82,
  "size_bps": 1100,
  "execution_mode": "MARKETABLE_SWAP",
  "entry_trigger": "breakout_retest_confirmed",
  "exit_plan": {
    "stop_loss_bps": 220,
    "take_profit_bps": 450,
    "trail_stop_bps": 180,
    "reduce_at_score_below": 58,
    "full_exit_at_score_below": 48
  },
  "hard_veto": false,
  "hard_veto_reasons": [],
  "soft_flags": ["near_minor_resistance"],
  "reason_summary": "Bullish trend remains intact, breakout has been retested, execution conditions remain acceptable, and risk state is healthy.",
  "ttl_sec": 180,
  "recommended_asset_in": "USDC",
  "recommended_asset_out": "BTC"
}
```

## 16.2 Allowed Enum Values

### action
- `BUY`
- `SELL`
- `REDUCE`
- `HOLD_POSITION`
- `HOLD_FLAT`
- `NO_TRADE`

### regime
- `TREND_UP_STRONG`
- `TREND_UP_WEAK`
- `RANGE_STABLE`
- `RANGE_NOISY`
- `TREND_DOWN_WEAK`
- `TREND_DOWN_STRONG`
- `PANIC_VOLATILE`
- `LOW_LIQUIDITY`

### bias
- `BULLISH`
- `BEARISH`
- `NEUTRAL`

### execution_mode
- `MARKETABLE_SWAP`
- `WAIT_RETEST`
- `WAIT_BREAKOUT_CONFIRMATION`
- `DO_NOT_EXECUTE`

---

## 17. JSON Examples per Action

## 17.1 BUY Example

```json
{
  "version": "1.0",
  "timestamp": 1712345678,
  "symbol": "BTC/USDC",
  "regime": "TREND_UP_STRONG",
  "action": "BUY",
  "bias": "BULLISH",
  "confidence": 0.84,
  "risk_score": 0.22,
  "final_edge_score": 81,
  "trade_quality_score": 84,
  "size_bps": 1200,
  "execution_mode": "MARKETABLE_SWAP",
  "entry_trigger": "dip_to_ema20_bounce",
  "hard_veto": false,
  "hard_veto_reasons": [],
  "reason_summary": "Trend and momentum remain aligned across timeframes, volatility is acceptable, and entry timing is validated.",
  "ttl_sec": 180,
  "recommended_asset_in": "USDC",
  "recommended_asset_out": "BTC"
}
```

## 17.2 HOLD_FLAT Example

```json
{
  "version": "1.0",
  "timestamp": 1712345678,
  "symbol": "BTC/USDC",
  "regime": "RANGE_NOISY",
  "action": "HOLD_FLAT",
  "bias": "NEUTRAL",
  "confidence": 0.63,
  "risk_score": 0.31,
  "final_edge_score": 61,
  "trade_quality_score": 64,
  "size_bps": 0,
  "execution_mode": "DO_NOT_EXECUTE",
  "entry_trigger": "none",
  "hard_veto": false,
  "hard_veto_reasons": [],
  "reason_summary": "Signals are mixed and regime is noisy, so preserving capital is preferable to forcing an entry.",
  "ttl_sec": 180,
  "recommended_asset_in": "USDC",
  "recommended_asset_out": "BTC"
}
```

## 17.3 HOLD_POSITION Example

```json
{
  "version": "1.0",
  "timestamp": 1712345678,
  "symbol": "BTC/USDC",
  "regime": "TREND_UP_WEAK",
  "action": "HOLD_POSITION",
  "bias": "BULLISH",
  "confidence": 0.69,
  "risk_score": 0.29,
  "final_edge_score": 62,
  "trade_quality_score": 68,
  "size_bps": 0,
  "execution_mode": "DO_NOT_EXECUTE",
  "entry_trigger": "hold_existing",
  "hard_veto": false,
  "hard_veto_reasons": [],
  "reason_summary": "Position remains valid but setup is not strong enough to add aggressively.",
  "ttl_sec": 180,
  "recommended_asset_in": "USDC",
  "recommended_asset_out": "BTC"
}
```

## 17.4 REDUCE Example

```json
{
  "version": "1.0",
  "timestamp": 1712345678,
  "symbol": "BTC/USDC",
  "regime": "TREND_UP_WEAK",
  "action": "REDUCE",
  "bias": "BULLISH",
  "confidence": 0.58,
  "risk_score": 0.36,
  "final_edge_score": 51,
  "trade_quality_score": 57,
  "size_bps": 500,
  "reduce_fraction_bps": 5000,
  "execution_mode": "MARKETABLE_SWAP",
  "entry_trigger": "score_deterioration",
  "hard_veto": false,
  "hard_veto_reasons": [],
  "reason_summary": "Trend is weakening and quality has fallen below hold threshold, so partial de-risking is recommended.",
  "ttl_sec": 180,
  "recommended_asset_in": "BTC",
  "recommended_asset_out": "USDC"
}
```

## 17.5 SELL Example

```json
{
  "version": "1.0",
  "timestamp": 1712345678,
  "symbol": "BTC/USDC",
  "regime": "PANIC_VOLATILE",
  "action": "SELL",
  "bias": "BEARISH",
  "confidence": 0.41,
  "risk_score": 0.63,
  "final_edge_score": 36,
  "trade_quality_score": 35,
  "size_bps": 10000,
  "execution_mode": "MARKETABLE_SWAP",
  "entry_trigger": "defensive_exit",
  "hard_veto": true,
  "hard_veto_reasons": ["panic_volatility", "risk_score_too_high"],
  "reason_summary": "Risk conditions have deteriorated sharply and capital preservation now takes priority over staying exposed.",
  "ttl_sec": 120,
  "recommended_asset_in": "BTC",
  "recommended_asset_out": "USDC"
}
```

---

## 18. Validation Rules for Orchestrator

Before the agent's JSON output is used, the orchestrator must perform the following validations.

### 18.1 Schema Validation

- all required fields must be present
- enums are valid
- numbers fall within the correct ranges
- `confidence` must be `0.0–1.0`
- `risk_score` must be `0.0–1.0`
- `final_edge_score` must be `0–100`
- `size_bps` must be `0–max_position_bps`

### 18.2 Logical Validation

- if `action == BUY`, then `hard_veto` must be `false`
- if `action == BUY`, `size_bps > 0`
- if `action == HOLD_*`, `execution_mode` should be `DO_NOT_EXECUTE`
- if `action == SELL`, asset_in and asset_out must be reversed relative to the position
- if `ttl_sec <= 0`, reject

### 18.3 Policy Validation

- asset whitelist
- cooldown
- max action frequency
- max daily loss
- pause status
- max position cap
- slippage cap
- spread cap

---

## 19. Pseudocode for Orchestrator

```ts
function decideAction(input: DecisionInput): AgentDecision {
  const indicators = computeIndicators(input.market);
  const regime = classifyRegime(indicators, input.market);
  const agentView = callModel({
    market: input.market,
    vault: input.vault,
    policy: input.policy,
    regime
  });

  const trendScore = computeTrendScore(indicators);
  const momentumScore = computeMomentumScore(indicators);
  const volatilityScore = computeVolatilityScore(indicators);
  const liquidityScore = computeLiquidityScore(input.market);
  const riskStateScore = computeRiskStateScore(input.vault, input.policy);
  const aiContextScore = clamp(agentView.ai_context_score, 0, 100);

  const finalEdgeScore = round(
    0.25 * trendScore +
    0.20 * momentumScore +
    0.15 * volatilityScore +
    0.15 * liquidityScore +
    0.15 * riskStateScore +
    0.10 * aiContextScore
  );

  const hardVeto = evaluateHardVeto(input, agentView, regime);
  const tradeQualityScore = computeTradeQualityScore({
    finalEdgeScore,
    executionScore: liquidityScore,
    timingScore: agentView.timing_score,
    regimeSuitabilityScore: regimeSuitability(regime),
    confidenceScoreScaled: agentView.confidence * 100
  });

  if (hardVeto) {
    return handleVetoPath(input, regime, finalEdgeScore, agentView);
  }

  if (input.vault.current_position_side === "flat") {
    return decideFlatPath(input, regime, finalEdgeScore, tradeQualityScore, agentView);
  }

  return decideOpenPositionPath(input, regime, finalEdgeScore, tradeQualityScore, agentView);
}
```

---

## 20. Recommended Defaults v1

For a solo-builder MVP, the following defaults are suggested:

### Conservative
- `max_position_bps = 1000`
- `stop_loss_bps = 180`
- `take_profit_bps = 320`
- `trail_stop_bps = 150`
- `cooldown_seconds = 1200`
- `max_actions_per_60m = 1`

### Balanced
- `max_position_bps = 1500`
- `stop_loss_bps = 220`
- `take_profit_bps = 450`
- `trail_stop_bps = 180`
- `cooldown_seconds = 900`
- `max_actions_per_60m = 2`

### Aggressive
- `max_position_bps = 1800`
- `stop_loss_bps = 250`
- `take_profit_bps = 550`
- `trail_stop_bps = 220`
- `cooldown_seconds = 600`
- `max_actions_per_60m = 2`

---

## 21. What Should Be Displayed in the UI

To make the decision engine easy to explain, the dashboard should display:

1. **Current Regime**
2. **Final Edge Score**
3. **Confidence**
4. **Risk Score**
5. **Trade Quality Score**
6. **Hard Veto Status**
7. **Action Recommendation**
8. **Position Size Recommendation**
9. **Reason Summary**
10. **Why not Buy / Why not Sell**

Example of good labels:

- `Regime: Trend Up Strong`
- `Action: BUY`
- `Confidence: 0.84`
- `Risk Score: 0.22`
- `Trade Quality: 84/100`
- `Position Size: 12.0%`
- `Reason: Breakout retest confirmed, volatility acceptable, no veto active`

---

## 22. Implementation Conclusion v1

This v1 decision matrix makes Aegis Vault more reliable because:

- it does not rely on a single signal,
- it does not let the AI execute directly without filters,
- it has a strict definition of **Buy**,
- it has a structured definition of **Sell**,
- it has an active definition of **Hold**,
- it uses **hysteresis** to avoid noise-driven flips,
- and it produces **JSON output** that the orchestrator can consume directly.

This v1 version is very suitable for an MVP because it is still simple enough to build, yet already robust enough for:

- demo day,
- audit log,
- policy enforcement,
- and the transition to a more adaptive v2.

---

## 23. Most Recommended Next Steps

After this v1, the following documents are the most useful:

1. `orchestrator-implementation-spec.md`
2. `agent-prompt-spec.md`
3. `execution-intent-schema.md`
4. `backtest-evaluation-framework.md`

