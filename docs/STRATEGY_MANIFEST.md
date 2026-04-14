# Strategy Manifest Specification (v1.0)

A Strategy Manifest is a public commitment by an operator describing **what their AI agent does, how it makes decisions, and what guarantees they offer to vault owners**.

The manifest is hosted off-chain (IPFS, Arweave, 0G Storage, or HTTPS) and committed on-chain via `OperatorRegistry.publishManifest(uri, hash, bonded)`. The on-chain commitment includes:

- **`uri`** — where the manifest JSON lives
- **`manifestHash`** — keccak256 of the manifest JSON content (verifiability)
- **`manifestVersion`** — monotonic counter, increments on every update
- **`manifestBonded`** — boolean: operator stakes their reputation on this manifest. If governance proves execution deviates from the manifest, slashing applies.

This gives users:
- A clear, parseable description of operator strategy
- Cryptographic verification that the manifest content matches what the operator committed
- Audit trail (every update is an on-chain event)
- Slashable accountability for bonded manifests

---

## Schema

```json
{
  "$schema": "https://aegisvault.io/schemas/strategy-manifest-v1.json",
  "version": "1.0.0",

  "operator": {
    "address": "0xc067ACbd7942Ec4d0ac849be9990141Ba6AeF5F9",
    "name": "Alice's Yield Desk",
    "contact": "alice@example.com",
    "auditUrl": "https://certik.com/aegis-alice-2026"
  },

  "strategy": {
    "name": "Momentum Breakout v2",
    "type": "trend_following",
    "timeframe": "5min",
    "supportedAssets": ["BTC", "ETH"],
    "leverage": 1,
    "minVaultSize": 1000,
    "maxVaultSize": 1000000
  },

  "ai": {
    "provider": "0g-compute",
    "model": "zai-org/GLM-5-FP8",
    "providerAddress": "0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C",
    "promptHash": "0xabc123..."
  },

  "indicators": [
    { "name": "RSI", "period": 14, "thresholds": { "oversold": 30, "overbought": 70 } },
    { "name": "MACD", "fast": 12, "slow": 26, "signal": 9 },
    { "name": "EMA", "periods": [50, 200] }
  ],

  "rules": {
    "entry": "RSI < 30 AND MACD bullish cross AND price > EMA-200",
    "exit": "Trailing stop 5% OR RSI > 70 OR time > 24h",
    "veto": ["high_volatility", "low_volume", "weekend_thin_book"]
  },

  "guarantees": {
    "maxDrawdown": "15%",
    "expectedSharpe": 1.5,
    "backtestPeriod": "2022-01 to 2025-12",
    "backtestUrl": "ipfs://Qm.../backtest-results.json"
  },

  "performance": {
    "trackRecordStartedAt": "2026-04-01T00:00:00Z",
    "totalVaultsManaged": 0,
    "lastExecutionAt": null
  },

  "commitments": {
    "minNoticeForChange": "30 days",
    "willNotChangeWithoutVote": true,
    "reservedRights": ["pause", "emergencyExit"]
  },

  "publishedAt": "2026-04-15T10:00:00Z"
}
```

## Field Reference

### `operator` (required)
- `address` (required) — operator wallet, MUST match `msg.sender` of `publishManifest()`
- `name` (required) — display name, max 64 chars
- `contact` (optional) — email, telegram, github, etc.
- `auditUrl` (optional) — link to third-party audit report

### `strategy` (required)
- `name` (required) — strategy name (versioned recommended, e.g., "Momentum v2")
- `type` (required) — one of: `trend_following`, `mean_reversion`, `breakout`, `dca_twap`, `pairs_trading`, `volatility`, `carry_yield`
- `timeframe` (required) — analysis interval (e.g., `5min`, `1h`, `1d`)
- `supportedAssets` (required) — array of asset symbols
- `leverage` (default `1`) — leverage multiplier, must be `1` for spot-only
- `minVaultSize` / `maxVaultSize` (optional) — operator's preferred vault NAV range in USD

### `ai` (required for AI-driven operators)
- `provider` (required) — `0g-compute`, `openai`, `anthropic`, `local`, etc.
- `model` (required) — model identifier (e.g., `zai-org/GLM-5-FP8`)
- `providerAddress` (optional) — for 0G Compute, the provider wallet address
- `promptHash` (optional) — keccak256 of system prompt for reproducibility

### `indicators` (recommended)
Array of technical indicators used. Each entry:
- `name` (required) — `RSI`, `MACD`, `EMA`, `ATR`, `BBands`, etc.
- Indicator-specific params (e.g., `period`, `thresholds`)

### `rules` (recommended)
- `entry` (required) — natural-language description of entry conditions
- `exit` (required) — exit conditions
- `veto` (optional) — array of veto rule labels

### `guarantees` (recommended for bonded manifests)
- `maxDrawdown` (recommended) — strategy's worst expected DD (e.g., `"15%"`)
- `expectedSharpe` (optional) — target risk-adjusted return
- `backtestPeriod` / `backtestUrl` (optional) — link to historical performance data

### `commitments` (recommended for bonded manifests)
- `minNoticeForChange` — operator commits to give vault owners notice before strategy changes
- `willNotChangeWithoutVote` — operator commits to allow vault owner vote on changes
- `reservedRights` — what operator can do without notice

---

## Hash computation

The on-chain `manifestHash` is `keccak256(canonical JSON content)`.

**Canonical JSON rules:**
1. UTF-8 encoded, no BOM
2. No trailing whitespace per line
3. LF (`\n`) line endings only
4. 2-space indentation
5. Keys in the order shown in the schema

In JavaScript:
```js
import { keccak256, toBytes } from 'viem';
const json = JSON.stringify(manifest, null, 2);
const hash = keccak256(toBytes(json));
```

In Solidity:
```solidity
bytes32 hash = keccak256(bytes(manifestJSON));
```

Frontend MUST verify `keccak256(fetched manifest content) === on-chain manifestHash` before displaying or trusting the manifest.

---

## Bonded vs Non-Bonded Manifests

### Non-Bonded (default)
- Manifest is informational only
- Operator can change strategy freely
- No slashing risk for deviation
- Used for: experimental operators, low-stakes vaults, transparent disclosure

### Bonded
- Operator stakes reputation on this manifest
- Governance can slash up to 50% stake if execution deviates
- Required: clear `rules.entry`, `rules.exit`, `guarantees.maxDrawdown`
- Used for: high-trust operators, large vaults, regulated capital

To bond, set `bonded: true` when calling `publishManifest()`.

---

## Verification flow

1. User browses `/marketplace`
2. Frontend reads `operatorExtended[wallet]` from on-chain registry
3. Frontend fetches `manifestURI` content
4. Frontend computes `keccak256(content)` and compares to `manifestHash`
5. If match: show "Manifest Verified ✓" + parse content
6. If mismatch: show "Manifest Tampered ⚠️" warning

---

## Slashing (bonded manifests only)

If a vault owner believes an operator deviated from their bonded manifest:

1. **Submit evidence**: link to vault execution events (`IntentExecuted`) that violate manifest rules
2. **Governance proposal**: M-of-N owners review evidence vs manifest
3. **Vote**: M-of-N approve → `OperatorStaking.slash(operator, amount)` executes
4. **Insurance payout**: slashed funds flow to `InsurancePool`, victims claim

---

## Best practices for operators

1. **Start non-bonded** — get track record before bonding
2. **Pin to IPFS** — manifest content survives even if your domain expires
3. **Version semantically** — `1.0.0`, `1.1.0` (additive), `2.0.0` (breaking)
4. **Backtest publicly** — link to reproducible backtest results
5. **Update sparingly** — every `publishManifest()` is on-chain (gas), monotonic version bump
6. **Notify vault owners** — emit social signal (Discord, Twitter) before manifest changes
7. **Honor `commitments.minNoticeForChange`** — bonded operators can be slashed for not honoring notice period

---

## Future versions

**v1.1 (planned):** Add `riskModel` field with VaR / CVaR estimates  
**v2.0 (planned):** Add `templateId` reference to on-chain `StrategyTemplateRegistry`  
**v3.0 (planned):** TEE-attested manifest signature (operator's TEE signs the manifest)
