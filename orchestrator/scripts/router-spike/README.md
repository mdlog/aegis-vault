# 0G Compute Router — migration spike

Three-script experiment to evaluate whether we should migrate from the broker
SDK (Direct mode, currently in `src/services/ogCompute.js`) to the new Router
gateway (`https://router-api.0g.ai/v1`). The goal is **not** to rewrite the
production path — it's to surface answers to three questions:

1. Does Router expose every chat model that pc.0g.ai shows as TEE-verified
   (incl. the new `zai-org/GLM-5.1-FP8`)?
2. Latency / quality / cost vs the Direct broker path on the **same prompt**?
3. **Does Router preserve the per-call attestation surface** we depend on for
   V3 sealed-mode (`ZG-Res-Key` + `processResponse()` → on-chain commit)?
   Question 3 is the hard gate. If the answer is no, migration is blocked.

## Setup (one-time)

1. Visit `pc.0g.ai`, connect the executor wallet.
2. Deposit a small amount of 0G to the Payment Layer
   (`0xA3b15Bd2aD18BFB6b5f92D8AA9F444Dd59d1cE32` on mainnet).
3. Dashboard → API Keys → create a key labelled `router-spike`.
4. Add to `orchestrator/.env`:

   ```
   OG_ROUTER_API_KEY=sk-...
   # optional — defaults to mainnet
   OG_ROUTER_NETWORK=mainnet
   # optional — pin Router to one provider for fair comparison vs Direct
   ROUTER_PROVIDER_PIN=
   ```

   Do **not** commit this file. Per project policy, secrets never go in git.

## Run

From `orchestrator/`:

```bash
# 1. catalog: what does Router actually expose?
node scripts/router-spike/01-list-models.mjs

# 2. head-to-head: same prompt through both paths
node scripts/router-spike/02-router-vs-direct.mjs

# 3. balance + usage sanity check
node scripts/router-spike/03-balance.mjs
```

## What to look for

**01-list-models.mjs**
* Is `zai-org/GLM-5.1-FP8` in the catalog?
* Are deprecated entries (`openai/gpt-oss-120b`, `openai/gpt-5.4-mini`)
  actually gone or just hidden in pc.0g.ai?
* Pricing in neuron/token — multiply by typical cycle usage to estimate
  monthly cost vs the per-provider sub-account model.
* `provider_count` per model — affects routing/failover headroom.

**02-router-vs-direct.mjs**
* Latency delta. Router adds a hop (gateway → provider) but should win on
  cold-start because no per-call ledger handshake.
* Output agreement on the same prompt: if action/asset diverge wildly between
  Router and Direct on identical input, something in the gateway is mutating
  the request (system prompt, temperature, stop tokens).
* **Response headers.** The script prints every header. We're hunting for:
  * `ZG-Res-Key` — same key Direct uses; Router may forward it
  * `x-tee-*`, `x-attestation-*`, `x-provider-*` — anything that lets us
    bind the response to a specific TEE provider on-chain
  * If none of the above are present, write that down — it's the migration
    blocker.

**03-balance.mjs**
* Confirms the API key works and the deposit landed.
* `usage/stats` shape tells us how to wire spend telemetry if we migrate.

## Decision tree (post-spike)

```
Router has TEE/attestation per call?
├─ YES → next step: PoC sealed-mode commit using Router headers,
│         keep Direct as fallback behind OG_COMPUTE_MODE flag
└─ NO  → keep Direct. Use Router only for non-sealed paths
         (e.g. demo / public dashboard). File issue with 0G.
```

## Files

* `01-list-models.mjs` — `GET /v1/models` + `GET /v1/providers?model_id=...`
* `02-router-vs-direct.mjs` — same prompt, both paths, header inspection
* `03-balance.mjs` — `/account/balance` + `/account/usage/stats`

All three are self-contained ESM scripts. They share `orchestrator/.env` via
`dotenv/config` (script 02 only — the others don't need secrets beyond the
Router API key).
