# Aegis Vault — 3-Minute Demo Script

**Audience:** Hackathon judges · Track 2 submission
**Total duration:** 3:00
**Tone:** Confident, concrete, proof-first

---

## Opening Hook (0:00 – 0:18)

**VISUAL:** Landing page hero → slow zoom onto the "The AI…" headline.

**ON-SCREEN CAPTION:** `LIVE · 0G Aristotle Mainnet · chain 16661`

**VOICE-OVER:**
> "AI trading bots that look intelligent usually share one fatal flaw — they hold your money, and you're supposed to trust them. **Aegis Vault flips that assumption.** AI operators can trade for you, but they can never touch your funds. And it's not a promise — it's enforced by the contract."

---

## Problem Framing (0:18 – 0:40)

**VISUAL:** Split screen — left: recent AI bot / rug pull headlines. Right: Aegis "policy revert" diagram.

**ON-SCREEN CAPTION:** `$3.7B lost to AI bots & rug pulls in 2025`

**VOICE-OVER:**
> "Every week a new AI bot exit-scams. The problem isn't the AI — it's the **trust architecture**. If an operator *can* withdraw, eventually one of them will. Aegis Vault removes that path entirely. The vault holds the funds. The operator can only submit an **intent**. On-chain policy decides whether it executes."

---

## Demo 1 — Create Vault with Hard Gates (0:40 – 1:20)

**VISUAL:** Navigate to `/create`. Scroll quickly through Steps 1 & 2, land on Step 3 "Policy."

**ON-SCREEN CAPTION (when "Policy · hard gates" is highlighted):** `Enforced by contract, not off-chain`

**VOICE-OVER (while scrolling):**
> "I'm spinning up a new vault. Deposit USDC, pick an operator from the marketplace, and then — the critical part — **Policy hard gates**."

**VISUAL:** Zoom into the Policy sliders. Highlight the gold "SUGGESTED" badge on Max Position.

**VOICE-OVER:**
> "The operator can suggest defaults — that's what this 'Suggested' badge means. But **I decide the final values**. Max position 50%. Minimum AI confidence 60%. Stop-loss 15%. Once this vault is deployed, any trade that would breach any of these **reverts on-chain**. There is no admin key that can override it. There is no Aegis team key that can bail anyone out. Just the contract."

**ON-SCREEN CAPTION:** `setPolicy() · owner-only · enforced per trade`

---

## Demo 2 — Sealed Mode + TEE Attestation (1:20 – 1:55)

**VISUAL:** Toggle "Sealed Mode" ON in Step 5. Move to the Vault Detail page — TEE Attestation Panel visible.

**ON-SCREEN CAPTION:** `0G Compute · TEE-attested inference · verifiable on-chain`

**VOICE-OVER:**
> "Next: sealed mode. This is where Aegis leans into what's uniquely possible on 0G. The AI inference runs on **0G Compute** — TEE-attested. Every decision produces an attestation hash that gets committed on-chain before the trade settles."

**VISUAL:** Click through to ExecutionRegistry on the explorer — show a real transaction with `attestationReportHash` in calldata.

**VOICE-OVER:**
> "That means I can cryptographically prove this decision came from an un-tampered model, running on a specific 0G Compute provider — **not from a human pretending to be an AI**. That's a level of transparency traditional trading bots simply cannot offer."

---

## Demo 3 — Operator Economics: Skin in the Game (1:55 – 2:25)

**VISUAL:** Navigate to `/marketplace`. Hover a Gold-tier operator.

**ON-SCREEN CAPTION:** `Stake · Reputation · Slashable`

**VOICE-OVER:**
> "Why would any operator actually behave? Because they have **real skin in the game**. Every operator in this marketplace has to stake A0G — five thousand minimum for Bronze, fifty thousand for Gold. If they misbehave — strategy deviation, signature replay, manifest violation — **ten to fifty percent of their stake gets slashed**."

**VISUAL:** Click into an operator profile → show reputation panel (total executions, success rate, rating).

**VOICE-OVER:**
> "And their track record — total executions, cumulative PnL, user ratings — lives **on-chain**, append-only. An operator can't spin up a new identity to escape a bad history. Their reputation is welded to their stake."

---

## Demo 4 — Live AI Decision Feed (2:25 – 2:45)

**VISUAL:** Dashboard `/app` → real-time Actions feed. Click the most recent decision.

**ON-SCREEN CAPTION:** `Live on 0G mainnet · 47 AI cycles today`

**VOICE-OVER:**
> "This is a live feed from a vault running right now. Each cycle: real market data from Pyth — BTC, ETH, USDC. AI inference from 0G Compute produces a signal with confidence, risk, and reasoning. The Decision Engine checks it against policy. Right here — **a BTC BUY got vetoed** because the AI's confidence was only 42%, below my 60% threshold. The trade didn't happen. **Policy wins.**"

---

## Closing + CTA (2:45 – 3:00)

**VISUAL:** Aegis logo → four key stats fade in:
- `10 smart contracts deployed · 0G mainnet`
- `6 AI models · 0G Compute`
- `Non-custodial · policy-enforced`
- `Real settlement · Jaine DEX`

**VOICE-OVER:**
> "Aegis Vault is live on 0G Aristotle Mainnet today. Open-source code. Verified contracts. Everything you just saw — not a mockup, not a promise. This is how AI trading should be built: **transparent, trustless, and structurally incapable of stealing from you**."

**FINAL ON-SCREEN CAPTION:** `aegisvaults.xyz · github.com/mdlog/aegis-vault`

---

## Production Notes

### Pacing & delivery

- Target **140–150 words per minute**. This script runs about 420 words — paced correctly, it lands between 2:55 and 3:05 with natural breathing.
- Slow down deliberately around **Sealed Mode (1:20–1:55)**. That segment is the strongest differentiator against every other AI-trading product in the ecosystem.
- Don't rush the Closing. The final sentence — *"structurally incapable of stealing from you"* — should land with a beat of silence before the CTA card.

### Visual pacing

- Never hold a UI transition longer than 1.2 seconds — judges' attention drops fast.
- Use 2–3 hard zoom-ins on critical elements:
  1. The `SUGGESTED` badge on the Max Position slider.
  2. The `attestationReportHash` field on the explorer page.
  3. The "vetoed" entry in the Actions feed.

### What MUST appear on screen

1. The live domain `aegisvaults.xyz` (proves it's deployed).
2. A real transaction hash on `chainscan.0g.ai/tx/…` (proves it's on-chain).
3. At least one real operator address in the marketplace.
4. The `Policy · hard gates` subtitle and the `SUGGESTED` badge (proves the guardrail UX exists).

### Recommended recording order

Don't record in one take. Record each segment independently, then stitch. Best order for efficiency:

1. **Landing + Closing** — the easiest shots, get them out of the way.
2. **Create Vault flow** — the longest click-path; record until you have a clean take.
3. **Marketplace + Operator profile** — straightforward, two views.
4. **Dashboard live feed** — requires the orchestrator to be running for a while so the feed is full.
5. **Sealed mode + Explorer** — requires at least one real on-chain sealed trade. Do this last.

### Angle toward judges

- Mention "**Track 2 submission**" explicitly in either the Opening or the Closing. Judges scan for track alignment.
- Highlight sealed mode + attestation as **novelty** — no other 0G ecosystem project ships this end-to-end.
- Emphasize **production-readiness**: "ten contracts deployed, all verified, on mainnet." Not localhost, not a testnet fork.

### Backup B-roll (have 15–20s ready)

- Orchestrator terminal log scrolling (the "CYCLE #47" output is dramatic).
- GitHub repo README, scrolling slowly.
- Pyth price feed ticking in real time.
- An explorer transaction confirming with the green check.

### Trim plan if you run long

If the edited cut comes in over 3:00, cut from the **Problem Framing** segment (0:18–0:40). It can be compressed to 12 seconds by dropping the split-screen visual and keeping only the single sentence: *"If an operator can withdraw, eventually one of them will. Aegis Vault removes that path."*

### Do NOT do

- Don't show any localhost URLs.
- Don't show any `.env` files or private keys, even redacted — judges notice.
- Don't use the word "potentially" or "could" — this product ships today. Speak in the present tense.
- Don't apologize for anything on-screen. If something looks rough, re-record.

---

## Key one-liners to memorize

If you forget the script, these four lines carry the pitch on their own:

1. *"Operators can trade for you, but they can never touch your funds."*
2. *"If a trade would breach policy, it reverts on-chain. No key can override it."*
3. *"Every AI decision gets a TEE attestation hash, committed before execution."*
4. *"Reputation is welded to stake. Operators can't escape a bad track record."*
