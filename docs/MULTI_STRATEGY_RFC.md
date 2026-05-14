# RFC: Multi-Strategy Operator Architecture

**Status**: Draft (implementing)
**Authors**: Aegis Vault team
**Created**: 2026-04-28
**Target release**: V4 vault stack

## Abstract

Enable per-operator strategy diversity in Aegis Vault without requiring operators to fork the orchestrator codebase. Operators publish a declarative strategy manifest (JSON), which the shared orchestrator framework loads at runtime, hash-verifies against an on-chain commitment, and uses to drive decision logic for each vault assigned to that operator.

This RFC specifies the schema, the loader contract, the runtime integration points, and the V4 contract changes required to bind the strategy hash on-chain so deviation is cryptographically detectable.

## Motivation

Today the orchestrator hard-codes one Decision Engine (DE v1) used by all operators. The operator marketplace claim — "operators compete on strategy" — is therefore aspirational; in practice every operator running this orchestrator gets identical decisions modulo their AI model choice. This is a credibility gap.

Two alternatives were considered:

1. **Operator-deployed orchestrators** — each operator runs their own modified codebase. Maximum flexibility, but devops burden is high and no central audit point.
2. **Declarative strategy config** — strategy is data, orchestrator is framework. Lower onboarding friction, central auditability, schema-driven slashing potential.

This RFC adopts (2). Option (1) remains supported (operators can always fork) but becomes the exception, not the requirement.

## Design

### Layer separation (unchanged)

```
Tier 4 — Marketplace + accountability   (this RFC adds: executable manifest)
Tier 3 — Protocol enforcement (contract)  (this RFC adds: strategyHash binding in V4)
Tier 2 — Vault policy (per-user, on-chain)
Tier 1 — Strategy execution (per-operator, off-chain)
```

Tier 1 was previously code-only. This RFC makes Tier 1 **config-driven** so different operators get different strategies from the same orchestrator binary.

### Strategy manifest schema (v1)

See `orchestrator/src/strategy/schema-v1.json`. Required top-level fields:

| Field | Purpose |
|---|---|
| `schemaVersion` | Integer, currently `1`. Permits forward-compat parsers. |
| `strategy` | Identity: id, name, type, timeframe, optional template lineage. |
| `indicators` | Parameters per indicator (RSI period, MACD windows, EMA periods, etc.). |
| `scoring` | Weights for the 6 subscores in the edge formula. Must sum to 1.0 ±0.01. |
| `rules` | Mini-DSL expressions for entry/exit conditions and position sizing. |
| `gates` | Hard thresholds for BUY/SELL gates (minEdge, minQuality, minConfidence, allowed regimes). |
| `veto` | Soft + hard veto thresholds (max ATR, RSI overbought, max spread). |
| `ai` | AI integration mode + model + provider commitment. |

#### Mini-DSL (extension 1)

Boolean/numeric expression language with limited surface:

- Operators: `&& || ! == != < <= > >= + - * /`
- Membership: `in [...]`
- Functions: `min(...)`, `max(...)`, `clamp(x, lo, hi)`
- Identifiers (read from runtime context):
  - Indicators: `rsi_14`, `macd_histogram`, `ema_20`, `ema_50`, `ema_200`, `atr_14_pct`, `vwap_distance_pct`, `volume_zscore`
  - Regime: `regime` (string), used with `in [...]`
  - AI view: `ai.confidence`, `ai.risk_score`, `ai.ai_context_score`, `ai.timing_score`
  - Position: `position.pnl_pct`, `position.holding_seconds`
  - Vault: `vault.maxPositionBps`, `vault.consecutive_losses`, `vault.balance`

The DSL is sandboxed (no I/O, no globals, no Turing-completeness) and deterministic. Implementation in `orchestrator/src/strategy/dsl.js` (Phase 1 Workstream B).

#### AI integration modes (extension 2)

| Mode | Behavior |
|---|---|
| `scoring_input` | AI confidence/risk/context contribute to subscore weights (current Aegis pattern). Default. |
| `hard_gate` | If AI's `action` field disagrees with the engine's decision, override to `hold`. |
| `context_only` | AI provides reasoning text only; decision math ignores AI numbers. |

### Loader (`orchestrator/src/strategy/loader.js`)

Runtime contract:

```javascript
const result = await loadStrategy({
  uri: 'ipfs://Qm...',         // from OperatorRegistry.operatorExtended.manifestURI
  expectedHash: '0xabc...',    // from OperatorRegistry.operatorExtended.manifestHash
  operatorAddress: '0x4E08...',
});
// → { strategy, hash, schemaVersion, raw }
```

Failure modes (all typed errors):

- `StrategyFetchError` — URI unreachable
- `StrategyHashMismatch` — content tampered (computed hash ≠ on-chain hash)
- `StrategySchemaError` — JSON invalid against schema
- `StrategyVersionError` — schemaVersion not supported by this orchestrator
- `StrategyWeightsError` — scoring weights don't sum to ~1.0

Cache key: `(operatorAddress, manifestHash)`. Hash change → cache miss → refetch.

### Hash binding (extension 4)

Strategy hash = `keccak256(canonicalJson(strategy))`. Deterministic via the canonicaliser in `hash.js` (sorted keys recursively, no whitespace, no undefined). Same algorithm SDK already uses for operator manifests (see `sdk/src/manifest.js`).

V4 vaults bind the strategy hash on-chain via two mechanisms:

1. **`ExecutionIntent.strategyHash` field** — added to the EIP-712 typehash. Vault contract verifies `intent.strategyHash == acceptedManifestHash` on `executeIntent()`.
2. **`AegisVaultV4.acceptedManifestHash` storage** — set at create time from operator's current `manifestHash`. User-approved upgrades go through a 24-hour timelock.

These are V4 contract changes (Phase 1 Workstream A). Phase 1 deployments use the orchestrator-side hash binding only (carried inside the existing `attestationReportHash` extended field) — sufficient for off-chain audit, lacking trustless on-chain enforcement.

### V3 → V4 migration

V3 vaults remain functional indefinitely. No forced migration. Users may opt to:

- **Stay on V3** — orchestrator continues serving with off-chain strategy enforcement (decision logs + manual governance audit).
- **Migrate to V4** — withdraw from V3 vault, create new vault via V4 factory, optionally re-deposit. New vault uses on-chain `acceptedManifestHash` binding.

Migration tooling (Phase 3 Workstream F): `contracts/scripts/migrate-v3-to-v4.js` automates the withdraw + create + deposit flow with user signatures.

### Backtest CLI (extension 5)

Operator validates strategy before publishing:

```bash
npm run backtest -- --manifest ./my-strategy.json --asset ETH --period 90d --start-capital 10000
```

Output: trades, win rate, total return, max drawdown, Sharpe ratio. See Phase 1 Workstream C output.

### Strategy template library (extension 6)

5 reference strategies shipped under `orchestrator/strategies/`:

1. `trend-following-v1.json` — momentum continuation
2. `mean-reversion-v1.json` — RSI extreme reversal
3. `momentum-breakout-v1.json` — MACD + volume breakout
4. `arbitrage-stable-v1.json` — stablecoin pair drift
5. `market-neutral-v1.json` — paired long/short basis

Operator forks template, tweaks parameters, publishes with `basedOn` + `basedOnHash` lineage attribution.

### Failure modes (extension 7)

Failure handling at three layers (Phase 2 integration):

| Failure | Detection | Response |
|---|---|---|
| Manifest URI 404 | `StrategyFetchError` | Use cached strategy if recent; else skip cycle. |
| Hash mismatch | `StrategyHashMismatch` | Skip cycle, log alert. Operator likely tampered or misconfigured. |
| Schema validation fail | `StrategySchemaError` | Skip cycle, log alert. Manifest broken. |
| Schema version unsupported | `StrategyVersionError` | Skip cycle. Operator using newer schema than orchestrator supports. |
| Scoring weights invalid | `StrategyWeightsError` | Skip cycle. |
| Indicator library bug | Test suite + version pin | Operator pins `aegis_indicators_version`; bug fix → version bump → operator opt-in upgrade. |
| Strategy DSL evaluation error | `EvaluationError` raised by DSL | Skip cycle for that vault. |

All failures degrade gracefully: cycle skipped, no on-chain tx attempted, alert logged for governance review. No silent acceptance of bad strategy.

## Implementation phases

### Phase 0 — Foundation (this commit)

- ✅ JSON Schema v1 (`schema-v1.json`)
- ✅ Hash utility (`hash.js`) — canonical JSON + keccak256
- ✅ Validator (`validator.js`) — manual ajv-free validator
- ✅ Loader skeleton (`loader.js`) — interface + caching + failure modes
- ✅ This RFC document

### Phase 1 — Parallel (4 workstreams)

- **Workstream A**: V4 Solidity contracts
  - `contracts/contracts/v4/AegisVault_v4.sol` — adds `acceptedManifestHash` storage + setter with timelock
  - `contracts/contracts/v4/AegisVaultFactoryV4.sol` — accepts `acceptedManifestHash` parameter at create
  - `contracts/contracts/v4/ExecLibV4.sol` — new EIP-712 typehash including `strategyHash` + `strategySchemaVer`
  - Tests under `contracts/test/AegisVault_v4.test.js`

- **Workstream B**: Mini-DSL parser + evaluator
  - `orchestrator/src/strategy/dsl.js` — parser + AST + evaluator with sandboxed identifier resolution
  - AI mode handler implementing `scoring_input` / `hard_gate` / `context_only`
  - Tests under `orchestrator/test/strategy/dsl.test.js`

- **Workstream C**: Backtest CLI + simulator
  - `orchestrator/scripts/backtest.mjs` — CLI entrypoint
  - `orchestrator/src/services/backtester.js` — historical replay engine using existing indicators
  - Output: trades, win rate, drawdown, Sharpe

- **Workstream D**: Strategy template library
  - `orchestrator/strategies/trend-following-v1.json`
  - `orchestrator/strategies/mean-reversion-v1.json`
  - `orchestrator/strategies/momentum-breakout-v1.json`
  - `orchestrator/strategies/arbitrage-stable-v1.json`
  - `orchestrator/strategies/market-neutral-v1.json`
  - All schema-valid, all backtested with documented metrics

### Phase 2 — Integration (main thread)

- Refactor `decisionEngine.js`, `signalScoring.js`, `riskVeto.js` to consume strategy parameter
- Wire `strategyLoader.js` into `orchestrator.runVaultCycle`
- Bind strategyHash into attestation extended field for Phase 1 enforcement
- Implement extension 7 failure mode handlers in cycle loop
- End-to-end local test: 3 different strategies producing 3 different decisions for same market

### Phase 3 — Parallel (2 workstreams)

- **Workstream E**: SDK + frontend
  - `sdk/src/strategy.js` — strategy SDK (load, hash, publish helpers)
  - `frontend/src/hooks/useStrategy.js` — fetch operator strategy
  - `frontend/src/pages/CreateVaultPage.jsx` — strategy preview at vault create
  - Updated CONTRACTS.md

- **Workstream F**: Tests + docs + migration
  - `contracts/test/AegisVault_v4.test.js` — comprehensive V4 contract tests
  - `orchestrator/test/strategy/loader.test.js`, `dsl.test.js` — unit tests
  - `contracts/scripts/migrate-v3-to-v4.js` — migration automation
  - `docs/V4_MIGRATION_GUIDE.md` — user-facing migration guide
  - WHITEPAPER.md updates

### Phase 4 — Verification (main thread)

- `npm run build`, `npm run lint`, `npm test` clean across all packages
- Hardhat fork test for V4 contracts on local 0G mainnet fork
- Generate `docs/V4_DEPLOYMENT_PLAN.md` — exact steps for eventual mainnet deploy
- Final review pass

## File ownership map (no workstream overlap)

| Path | Owner | Phase |
|---|---|---|
| `orchestrator/src/strategy/schema-v1.json` | foundation | 0 |
| `orchestrator/src/strategy/hash.js` | foundation | 0 |
| `orchestrator/src/strategy/validator.js` | foundation | 0 |
| `orchestrator/src/strategy/loader.js` | foundation + Phase 2 wiring | 0 → 2 |
| `orchestrator/src/strategy/dsl.js` | Workstream B | 1 |
| `orchestrator/src/strategy/aiModes.js` | Workstream B | 1 |
| `orchestrator/src/services/backtester.js` | Workstream C | 1 |
| `orchestrator/scripts/backtest.mjs` | Workstream C | 1 |
| `orchestrator/strategies/*.json` | Workstream D | 1 |
| `contracts/contracts/v4/*.sol` | Workstream A | 1 |
| `orchestrator/src/services/decisionEngine.js` | Phase 2 (refactor) | 2 |
| `orchestrator/src/services/signalScoring.js` | Phase 2 (refactor) | 2 |
| `orchestrator/src/services/riskVeto.js` | Phase 2 (refactor) | 2 |
| `orchestrator/src/services/orchestrator.js` | Phase 2 (wire loader + failure modes) | 2 |
| `orchestrator/src/services/executor.js` | Phase 2 (strategyHash binding) | 2 |
| `sdk/src/strategy.js` | Workstream E | 3 |
| `frontend/src/hooks/useStrategy.js` | Workstream E | 3 |
| `frontend/src/pages/CreateVaultPage.jsx` | Workstream E | 3 |
| `contracts/test/AegisVault_v4.test.js` | Workstream F | 3 |
| `contracts/scripts/migrate-v3-to-v4.js` | Workstream F | 3 |
| `docs/V4_MIGRATION_GUIDE.md` | Workstream F | 3 |

## Open questions

1. **Indicator library versioning** — should the manifest pin a specific version of the indicator library (e.g., `aegis_indicators_version: "1.2.3"`) for full reproducibility? Recommendation: yes, but defer to v2 of the schema.
2. **Custom indicator escape hatch** — WASM modules vs. limited compose API vs. no custom indicators in v1. Current decision: no custom indicators in v1, defer to v2.
3. **Strategy upgrade UX** — manual user opt-in per vault vs. auto-upgrade with X-day notice vs. fork-on-upgrade. Current decision: manual opt-in via 24-hour timelock.
4. **Slashing trigger** — manual governance vote vs. automated prover vs. ZK proof. Current decision: manual now, automated in V4.x, ZK in V5.

## Non-goals

- Cross-operator strategy composition (operator A using operator B's strategy as a sub-component)
- ML model deployment in the manifest itself (only model name + provider commitment)
- Closed-source strategies (manifest must be public for auditability)
- Real-time strategy mutation (all changes go through publishManifest + vault re-approval)

## Backwards compatibility

V3 vaults: no change. Continue functioning with existing orchestrator.
V4 vaults: require strategy manifest at create time.
Operators: optional — operators not publishing a manifest get DE v1 default behavior (current Aegis pattern). Operators publishing a manifest get config-driven decision logic.

## Security considerations

- **DSL injection**: parser must reject any expression that could escape the sandbox. Whitelist approach: identifiers + operators + functions explicitly allowed; anything else rejected.
- **Schema evolution**: changing schema breaks bonded operators. Use semantic versioning + parser support for multiple versions.
- **Hash collision**: keccak256 collision probability negligible. Canonical JSON ensures determinism (no two different inputs produce same output for valid manifests).
- **Replay across vaults**: strategyHash bound into ExecutionIntent typehash → intent signed for vault A using strategy X cannot be replayed in vault B.

## References

- [WHITEPAPER.md](../WHITEPAPER.md) — Aegis Vault protocol spec
- [STRATEGY_MANIFEST.md](STRATEGY_MANIFEST.md) — Existing manifest documentation
- [TEE_ATTESTATION_VERIFICATION.md](TEE_ATTESTATION_VERIFICATION.md) — Attestation hash binding
- EIP-712 — Typed structured data hashing and signing
