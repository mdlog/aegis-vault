# Aegis Vault — Strategy Template Library

Five reference strategy manifests that operators can fork to bootstrap their own
on-chain trading strategy. Each template validates against
[`schema-v1.json`](../src/strategy/schema-v1.json) and is canonical-JSON +
keccak256 hashed (see [`hash.js`](../src/strategy/hash.js)) so the hash printed
below is the value you would commit on-chain via
`OperatorRegistry.publishManifest(uri, hash, bonded)`.

License: these templates are released under **CC0 / MIT** — fork freely, no
attribution required, no liability assumed. Trading strategy parameters do not
constitute financial advice.

## Catalog

### 1. `trend-following-v1.json`

Ride established trends with strict regime filter. Enters when price sits above
the 20/50/200 EMA stack, MACD histogram is positive, and RSI is in the
mid-bullish zone (40-65). Exits on RSI > 75, EMA-20/50 cross-down, or a 3 %
drawdown stop. AI runs as `scoring_input` with low weight (0.10) — the
indicator stack carries the signal, the model just reweighs the edge. Best for
directional markets with persistent momentum; gates restrict buys to
`TREND_UP_*` regimes so range chop is avoided.

### 2. `mean-reversion-v1.json`

Buy oversold extremes, sell at the mean. Enters when RSI < 30 and price closes
below the lower Bollinger band, and only inside `RANGE_*` regimes. Exits on
RSI > 50, return to the BB middle, or a 4 % drawdown stop. AI runs as
`hard_gate` so a counter-trend entry is rejected unless the model agrees —
critical because mean-reversion in a trending environment is the classic
falling-knife loss. RSI hard-veto at 18 to refuse blowoff oversold.

### 3. `momentum-breakout-v1.json`

Catch volume-confirmed breakouts. 15-minute timeframe; enters on RSI in the
expansion zone (55-72), positive MACD histogram, volume z-score > 1.0, and
price above EMA-20. Exits when momentum fades (MACD flips negative or
RSI > 78). AI weight is intentionally minimal (0.05) — momentum trades are
mechanical and the data signal dominates. Tolerates higher ATR (5 %) than
trend-following to allow normal breakout volatility.

### 4. `arbitrage-stable-v1.json`

Conservative spread-capture between stablecoins (USDC / USDT / DAI). 5-minute
timeframe; enters when a stable trades > 15 bps below VWAP fair value with
ATR < 0.5 %; exits at +5 bps or a 30 bp stop. Sizing is deliberately large
(up to vault max) because per-trade risk is tiny. Liquidity dominates the
scoring weights (0.40) since stable arb requires deep books. AI is
`context_only` — the math is mechanical, model just flags abnormal regimes.
Gates exclude `PANIC_VOLATILE` and `LOW_LIQUIDITY` regimes; spread veto is
tight at 5 bps.

### 5. `market-neutral-v1.json`

Paired long/short basis trade. Schema v1 expresses only the long leg
on-chain — the short leg will land in V2 once perp / synthetic adapters
are integrated; the description field documents this lineage. Enters long
on RSI < 40 inside `RANGE_*` regimes with calm ATR; exits at RSI > 60, a
2 % stop, or a 24-hour holding cap. AI weight is the highest of the
template set (0.15) because regime + correlation read is the hardest
part of basis trading. Modest sizing (clamped 100-1500 bps) reflects
the paired-trade intent.

## Template hashes (canonical JSON keccak256)

| Template | Hash |
|---|---|
| `trend-following-v1.json` | `0x18131f3fba7dbf12ad280f1fc52e6ff3ec1a896c98c1f697169418c8c523f3f3` |
| `mean-reversion-v1.json` | `0x446fdb78acf5a1377891941128cdda82e6170cb31a909a7d68b25254b2d1d1b1` |
| `momentum-breakout-v1.json` | `0x4a6a45f0aaae96852e0c0aae0cb8541ea3337d10340c907ec90edc3b78b29691` |
| `arbitrage-stable-v1.json` | `0x529e865bb885ea8b91f3b0e3d0d9d9c9e5647397abd9c5b951347695e058fc1e` |
| `market-neutral-v1.json` | `0x85c261f37fea48cd24a583727a92dcb850b358b4f4d7c6d984c254a49ecc9b4f` |

To recompute any hash:

```bash
node -e "import('./src/strategy/hash.js').then(async h => { \
  const fs = await import('fs'); \
  const m = JSON.parse(fs.readFileSync('./strategies/trend-following-v1.json','utf8')); \
  console.log(h.computeStrategyHash(m)); \
})"
```

## How to fork a template (operator workflow)

1. **Copy** one of the templates as your starting point:

   ```bash
   cp orchestrator/strategies/trend-following-v1.json my-strategy.json
   ```

2. **Edit** the manifest:
   - Set `strategy.id` to a unique id (lowercase, digits, hyphens, 3-64 chars).
   - Set `strategy.name` to your operator-facing label.
   - Set `strategy.basedOn` to the template id and `strategy.basedOnHash` to
     the template hash above. This records lineage so auditors see what you
     forked from.
   - Tune indicator parameters, scoring weights, gate thresholds, veto
     thresholds, and DSL rule expressions to fit your trading philosophy.
   - Pick your AI mode (`scoring_input` / `hard_gate` / `context_only`),
     model id, and `providerAddress` for the 0G inference broker.
   - Confirm `scoring.weights` sum to **1.0 ± 0.01** — the validator and the
     loader both enforce this.

3. **Validate** locally before publishing:

   ```bash
   node -e "import('./src/strategy/validator.js').then(async v => { \
     const fs = await import('fs'); \
     const m = JSON.parse(fs.readFileSync('./my-strategy.json','utf8')); \
     const r = v.validateManifest(m); \
     console.log(r.ok ? 'OK' : 'FAIL', r.errors); \
   })"
   ```

4. **Backtest** to sanity-check parameters (Phase 1 Agent C deliverable):

   ```bash
   npm run backtest -- --manifest ./my-strategy.json --asset ETH --period 90d --start-capital 10000
   ```

5. **Compute the hash**:

   ```bash
   node -e "import('./src/strategy/hash.js').then(async h => { \
     const fs = await import('fs'); \
     const m = JSON.parse(fs.readFileSync('./my-strategy.json','utf8')); \
     console.log('hash:', h.computeStrategyHash(m)); \
   })"
   ```

6. **Upload** the manifest JSON to a content-addressed store (IPFS, 0G Storage,
   Arweave) and capture the URI. The store MUST return the same byte-exact
   JSON on subsequent fetches — operators commonly use `ipfs add --pin` or 0G
   Storage's deterministic CID.

7. **Publish on-chain** by calling
   `OperatorRegistry.publishManifest(uri, hash, bonded)` from your registered
   operator address. The orchestrator will hash-verify the fetched manifest
   against your on-chain commitment on every cycle; any mismatch
   (`StrategyHashMismatch`) skips the cycle and emits an alert.

8. **V4 vault binding** — when V4 vaults launch, your `manifestHash` will
   automatically populate each vault's `acceptedManifestHash` at create time
   and be embedded into every `ExecutionIntent.strategyHash` field. Strategy
   upgrades require user opt-in via a 24-hour timelock. See
   [`docs/MULTI_STRATEGY_RFC.md`](../../docs/MULTI_STRATEGY_RFC.md) for the
   full binding spec.

## Schema reference

- **Schema:** [`orchestrator/src/strategy/schema-v1.json`](../src/strategy/schema-v1.json)
- **Validator:** [`orchestrator/src/strategy/validator.js`](../src/strategy/validator.js)
- **Hash util:** [`orchestrator/src/strategy/hash.js`](../src/strategy/hash.js)
- **Loader:** [`orchestrator/src/strategy/loader.js`](../src/strategy/loader.js)
- **Mini-DSL:** [`orchestrator/src/strategy/dsl.js`](../src/strategy/dsl.js)
- **AI modes:** [`orchestrator/src/strategy/aiModes.js`](../src/strategy/aiModes.js)
- **RFC:** [`docs/MULTI_STRATEGY_RFC.md`](../../docs/MULTI_STRATEGY_RFC.md)

## License

CC0 1.0 / MIT (dual-licensed at operator's option). No warranty. Trading these
strategies on-chain involves risk; backtest historical performance does not
guarantee future returns. Operators are responsible for the parameters they
ship.
