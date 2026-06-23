# Aegis Vault — Demo Video Script (V4 Mainnet, English)

**Target duration:** 5:00 – 5:30
**Application status (as of 2026-05-16):** V4 live on 0G Aristotle Mainnet (chain `16661`). Marketplace freshly redeployed and governance-bound to `AegisGovernor` multisig. Frontend at [aegisvaults.xyz](https://aegisvaults.xyz).
**Audience:** Hackathon judges + technical reviewers — wants to see the full lifecycle, not just marketing.
**Two flows are mandatory** (per request): **Create Operator** (`/operator/register`) and **Create Vault** (`/create`). Both produce real on-chain transactions during the recording.

> Companion files:
> - Pitch (5-min, judge-facing): [PITCH_SCRIPT_V4_EN.md](PITCH_SCRIPT_V4_EN.md)
> - Indonesian pitch: [PITCH_SCRIPT_V4_ID.md](PITCH_SCRIPT_V4_ID.md)

---

## Recording prerequisites

Before the camera rolls, complete this setup so every click in the script produces a real transaction:

- [ ] **MetaMask** — RPC `https://evmrpc.0g.ai`, chain `16661`, symbol `0G`
- [ ] **Two wallets loaded in MetaMask:**
  - *Operator wallet* — funded with at least `100 0G` + the stake amount you plan to bond (e.g., `500 USDC.e` for Bronze tier)
  - *Depositor wallet* — funded with at least `50 0G` + `200 USDC.e` for the vault deposit
- [ ] **Orchestrator running** — `cd orchestrator && npm start` — banner showing `GLM-5-FP8` + `0G Compute` + `STRICT_MODE=1`
- [ ] **Frontend running** — `cd frontend && npm run dev` (port 5173) or pointed at production [aegisvaults.xyz](https://aegisvaults.xyz)
- [ ] **Operator manifest JSON ready** at `manifests/<your-operator>.json` — published to a public URL (GitHub raw works) so the keccak256 is reproducible
- [ ] **Tabs pre-opened in correct order** (see "Production notes" at the bottom)
- [ ] OBS at 1080p, audio levels confirmed, notifications silenced, second screen for terminal/explorer

---

## [0:00 – 0:25] HOOK — What we're about to show

**VISUAL:** Landing page hero at [aegisvaults.xyz](https://aegisvaults.xyz). Slow zoom onto the headline.

**ON-SCREEN CAPTION:** `LIVE · 0G Aristotle Mainnet · chain 16661 · V4`

**VOICE-OVER:**
> "Most AI-trading bots ask you to trust the operator with your funds. Aegis Vault doesn't. The operator runs an AI, signs a trade intent, and submits it to your vault — but the vault is the one that decides whether to execute.
>
> Today I'll walk through the full lifecycle on 0G Mainnet: registering as an operator, creating a depositor vault that binds to that operator's strategy, and watching the on-chain policy approve one trade and reject another. Everything you'll see is a real transaction."

---

## [0:25 – 1:35] FLOW 1 — Create Operator (`/operator/register`)

**VISUAL:** Switch MetaMask to the **operator wallet**. Navigate to `/operator/register`.

**ON-SCREEN CAPTION:** `Step 1 — Operator publishes a manifest commitment`

**VOICE-OVER:**
> "I'm logging in as an operator first. To register, I have to publish a *strategy manifest* — a JSON document declaring exactly what assets I'll trade, my position-size cap, cooldown, and risk parameters. The hash of that manifest gets committed on-chain."

**VISUAL:** Fill the form:
- Operator name: `Demo Quant Alpha`
- Manifest URI: paste the raw URL of `manifests/demo-quant.json`
- Allowed assets: `USDC.e`, `WETH`, `WBTC`, `W0G`
- Max position: `40%`
- Cooldown: `120 seconds`
- Risk tier: `Bronze` (stake floor 500 USDC.e)

**[Highlight the auto-computed `keccak256(manifest)` displayed in the form.]**

**VOICE-OVER:**
> "Notice the form auto-computes `keccak256` of the manifest JSON. That hash is what gets stored in `OperatorRegistry`. If I publish one manifest and trade outside it later, the on-chain commitment is the evidence — `AegisGovernor` can slash my stake."

**VISUAL:** Click **Publish Manifest** → MetaMask popup → confirm.

**ON-SCREEN CAPTION:** `OperatorRegistry.publishManifest() — tx pending`

**VOICE-OVER:**
> "MetaMask is asking me to sign the `publishManifest` call. The tx pays a few hundred thousand gas, and once it lands, my operator address is permanently bound to that hash."

**VISUAL:** Tx confirms — click the explorer link → show the tx on `chainscan.0g.ai` → highlight the `manifestHash` field in the input data.

**VOICE-OVER:**
> "On-chain. The `manifestHash` is now part of my operator profile."

**VISUAL:** Back to the form → **Step 2: Bond stake**. Show the tier selector with five tiers (None / Bronze / Silver / Gold / Platinum). Pick **Bronze — 500 USDC.e**.

**VOICE-OVER:**
> "Now the stake. The marketplace has five tiers — None up to Platinum. The lowest tier that the orchestrator will actually route trades to is Bronze, because our orchestrator runs in `STRICT_MODE` and refuses zero-stake operators by design.
>
> I'm bonding 500 USDC.e. That's denominated in the same asset depositors use, so there's no token-price shell game — it's real dollars at risk."

**VISUAL:** Approve USDC.e → confirm → `OperatorStaking.bond(...)` → tx confirms.

**ON-SCREEN CAPTION:** `OperatorStaking.bond — tier: Bronze — slashable`

**VOICE-OVER:**
> "Stake bonded. My operator card will show up in the marketplace in a few seconds — fresh, eligible, slashable."

**VISUAL:** Navigate to `/marketplace`. Scroll until the new `Demo Quant Alpha` card appears. Hover to show: tier badge, manifest hash, total executions = 0.

---

## [1:35 – 2:55] FLOW 2 — Create Vault (`/create`)

**VISUAL:** Switch MetaMask to the **depositor wallet**. Navigate to `/create`.

**ON-SCREEN CAPTION:** `Step 2 — Depositor binds the vault to that operator's manifest`

**VOICE-OVER:**
> "Now I switch hats — I'm a depositor. I want an AI vault, but I want one whose strategy is committed *before* I deposit, not retro-rationalized after."

**VISUAL:** Step 1 of the wizard — **Pick Operator**. Search for `Demo Quant Alpha`, select it.

**[Highlight the manifest hash badge under the operator's name.]**

**VOICE-OVER:**
> "I'm picking the operator I just registered. See that hash next to their name? That's the `acceptedManifestHash` my vault will commit to. From the moment I deploy, this operator cannot silently switch strategies on me — every intent they submit must match this hash, or `executeIntent` reverts."

**VISUAL:** Step 2 — **Deposit & Base Asset**. Deposit `200 USDC.e`.

**VISUAL:** Step 3 — **Policy hard gates**. Pause on this step. Show the policy form clearly:
- Max position: `50%` (with an orange `SUGGESTED 40%` badge next to it — operator's suggestion)
- Min AI confidence: `60%`
- Max slippage: `100 bps` (1%)
- Stop-loss: `15%`
- Asset whitelist: `USDC.e`, `WETH`, `W0G`

**ON-SCREEN CAPTION:** `Policy — enforced by contract, not by docs`

**VOICE-OVER:**
> "This is the part depositors should care about most. The operator can *suggest* default policy values — that's the gold 'Suggested' badge. But I decide the final values.
>
> Max position 50%. Minimum AI confidence 60%. Max slippage 1%. Asset whitelist: stablecoin, wrapped ETH, wrapped 0G — nothing else.
>
> Once this vault is deployed, these values are part of `policy` in storage. Any trade intent that fails any one of them — `executeIntent` reverts. There is no admin key that overrides this. No Aegis team key. Just the contract."

**VISUAL:** Step 4 — **Sealed mode**. Toggle it ON.

**VOICE-OVER:**
> "Sealed mode on. This forces the operator into a two-block commit-reveal — they `commitIntent(hash)` at block N, and can only `executeIntent` at block N+1 or later. MEV searchers can't see the trade before it lands."

**VISUAL:** Step 5 — **Deploy**. Click **Create Vault** → MetaMask popup → confirm.

**ON-SCREEN CAPTION:** `AegisVaultFactoryV4.create — acceptedManifestHash committed`

**VOICE-OVER:**
> "MetaMask is showing the factory call. This is V4 — `AegisVaultFactoryV4`. It deploys a minimal-proxy clone — about 400,000 gas — and writes the operator's manifest hash into the new vault's storage as `acceptedManifestHash`. Immutable from this block forward."

**VISUAL:** Tx confirms → factory event log → click into the new vault's address → vault detail page loads at `/app/vault/0x…`.

**[Highlight the panel showing `Bound to manifest 0x…` matching the operator's hash from earlier.]**

**VOICE-OVER:**
> "There it is. My vault, my policy, bound to that specific operator manifest. The marketplace has gained one vault and one depositor."

---

## [2:55 – 3:45] FLOW 3 — Live execution (AI proposes, vault decides)

**VISUAL:** Cut to the orchestrator terminal. Show the banner — `GLM-5-FP8`, `0G Compute`, `STRICT_MODE=1`, and the `Polling vaults...` loop.

**ON-SCREEN CAPTION:** `Orchestrator — 0G Compute inference + TEE-attested signer`

**VOICE-OVER:**
> "The orchestrator polls every vault on a schedule, runs inference on 0G Compute against the model bound by `policy.attestedSigner`, and produces a signed intent. Watch what happens when it sees a vault eligible for a trade."

**VISUAL:** Wait for the next decision cycle. Highlight the log lines:
1. `cycle #N — fetching market data...`
2. `0G Compute → BUY W0G — confidence 0.72 — risk 0.35`
3. `attestationReportHash = 0x…`
4. `commitIntent → tx 0x…`
5. `[wait 1 block]`
6. `executeIntent → tx 0x…`

**VOICE-OVER:**
> "Cycle fires. AI returns BUY W0G with 72% confidence — above my 60% threshold. Attestation hash computed. Orchestrator commits at block N — that's the first transaction. One block later, it reveals — that's the second transaction."

**VISUAL:** Click through to the `executeIntent` tx on `chainscan.0g.ai`. Decode input data, highlight `attestationReportHash` inside the `ExecutionIntent` struct.

**VOICE-OVER:**
> "Here's the executed trade on the explorer. Look inside the calldata — `attestationReportHash` is a `bytes32` field of the EIP-712 typehash. The vault `ecrecover`'d the signature, the signer matched `policy.attestedSigner`, the manifest hash matched the operator's commitment — every gate cleared, swap atomic, position open."

---

## [3:45 – 4:15] FLOW 4 — Policy revert (the boring trade is the point)

**VISUAL:** Back to `/app/vault/<addr>` → **Actions** tab. Scroll the feed.

**ON-SCREEN CAPTION:** `Veto = invariant held`

**VOICE-OVER:**
> "Most cycles don't trade. Most cycles look like this."

**[Highlight a row marked "VETOED — confidence 0.42 < threshold 0.60" or similar.]**

**VOICE-OVER:**
> "AI confidence came in at 42%, my policy threshold is 60%. The decision engine never even tried to submit the intent — the gate failed off-chain. Cheaper for everyone, same outcome.
>
> And even if the orchestrator had submitted it, the on-chain `confidenceBps` check in `ExecLib` would have reverted. Belt and suspenders."

**VISUAL:** Click into the vetoed row → drawer opens with full decision detail: market snapshot, AI reasoning text, confidence, risk, the exact gate that failed.

---

## [4:15 – 4:45] FLOW 5 — Reputation, marketplace, governance

**VISUAL:** Navigate to `/operator/<operator-address>` (the operator we registered earlier).

**ON-SCREEN CAPTION:** `Reputation — append-only, on-chain`

**VOICE-OVER:**
> "Operator profile. Total executions, cumulative PnL, user ratings — all append-only in `OperatorReputation`. An operator can't spin up a new identity to escape a bad track record. Reputation is welded to the operator address, which is welded to the staked USDC.e."

**VISUAL:** Quick pan to `/governance`. Show the `AegisGovernor` multisig page — pending proposals, signer addresses, threshold.

**ON-SCREEN CAPTION:** `Admin = AegisGovernor multisig (M-of-N)`

**VOICE-OVER:**
> "Admin and arbitrator on every marketplace contract — Registry, Staking, Reputation, Insurance — point at this multisig. Slash, treasury spend, operator delisting all require multisig approval. No single key has unilateral power. Governance commitment readable on-chain, not promised in docs."

---

## [4:45 – 5:15] CLOSE

**VISUAL:** Logo full-frame, fade in stats:
- `V4 factory · 0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F`
- `285 contract tests passing · Slither fail-on-high in CI`
- `11 audit Highs landed pre-V4`
- `Two chains, one bytecode — 0G Aristotle + Arbitrum One`

**VOICE-OVER:**
> "What you just watched is the full lifecycle on V4 mainnet. Operator registers with a slashable strategy hash. Depositor creates a vault whose policy is committed before the first deposit. AI proposes, vault decides, MEV doesn't get a look in.
>
> Aegis Vault. Live at aegisvaults.xyz. V4 factory on 0G at `0x9e36…2A5F`. Source at github.com/mdlog.
>
> **Every AI output is bound to its execution. Every operator commits a slashable strategy hash. Every chain runs the same bytecode.**
>
> Thanks for watching."

**FINAL CAPTION:** `aegisvaults.xyz · github.com/mdlog`

---

## Production notes

### Tab order (open all before recording)

1. [aegisvaults.xyz](https://aegisvaults.xyz) — landing page
2. `/operator/register` — operator wallet pre-connected
3. The new operator's tx in the explorer (placeholder until recorded)
4. `/marketplace` — to find the just-registered operator
5. `/create` — depositor wallet pre-connected
6. `/app/vault/<new-vault-address>` — vault detail page
7. The executed `executeIntent` tx on `chainscan.0g.ai` (placeholder until recorded)
8. `/app/vault/<addr>` → Actions tab
9. `/operator/<operator-address>` — reputation page
10. `/governance` — multisig page

### Pacing

- Target **140–150 words per minute**. Script is ~750 words → lands around 5:05.
- Two slow zooms recommended:
  - The auto-computed `keccak256(manifest)` field on the operator form (proves the binding is real).
  - The `attestationReportHash` row on the executed `executeIntent` tx.
- Don't hold any UI transition longer than 1.2 seconds.

### Recommended recording order (don't shoot in script order)

1. **Landing + Closing** first — easy shots.
2. **Create Operator** — happens once cleanly with a fresh wallet; rehearse the form fill twice before recording.
3. **Create Vault** — the longest click path. Have the operator from step 2 already in the marketplace.
4. **Live execution** — needs the orchestrator running and a vault eligible to trade. Record this last because it depends on a live cycle.
5. **Veto / Actions feed** — pull from accumulated history in the orchestrator log.
6. **Marketplace / Governance** — straightforward, two static views.

### What MUST appear on camera

1. `aegisvaults.xyz` URL bar — proves live deployment.
2. Two real tx hashes on `chainscan.0g.ai`: one for `publishManifest` + `bond`, one for `executeIntent`.
3. The newly created vault's address on screen.
4. The manifest hash matching between the operator profile and the vault's `acceptedManifestHash` panel.
5. The MetaMask popup at least twice — once during operator bond, once during vault create — so judges see the user signs every state change.

### Do NOT do

- Don't show `.env` files, private keys, seed phrases — not even blurred.
- Don't show localhost URLs.
- Don't use "potentially" or "should" or "we plan to" — V4 is live, speak present tense.
- Don't rush past the `Policy · hard gates` step — that's the differentiator.
- Don't reuse an old operator that already has executions. The point is showing the registration flow live; if a stale operator is used, the "zero executions, freshly registered" framing breaks.

### Trim plan if you run long

If the edited cut comes in over 5:30:
- **First cut**: Flow 5 (reputation + governance, 4:15–4:45) — replace with a 10-second caption overlay.
- **Second cut**: tighten Flow 4 (veto) — drop the drawer detail, keep only the vetoed row highlight.
- **Never cut**: Create Operator, Create Vault, Live execution. Those are the lifecycle proof.

### Key one-liners (memorize as fallback)

If you lose the script, these four sentences carry the demo:

1. *"The operator publishes a strategy manifest — its hash is committed on-chain and the operator is slashable against it."*
2. *"The depositor's vault binds to that manifest at create time. The operator cannot switch strategy without depositors deploying a new vault."*
3. *"Sealed mode forces a two-block commit-reveal — the AI's response hash is part of the EIP-712 intent, so even the orchestrator can't swap the revealed trade for a different one."*
4. *"Every veto, every executed trade, every state change — readable on chainscan.0g.ai, no permission required."*
