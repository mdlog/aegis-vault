# Aegis Vault × 0G — Direct Answers to the Meeting Agenda

## 1 · Team & Current Status
- **Team:** 0G-native — built for and submitted to the 0G hackathon. ML + quant + smart-contract engineers, full-time. *[add names/roles before the meeting]*
- **Live on 0G mainnet:** V4 vault stack (factory `0x9e36520650…3582A5F`) + slashable-stake operator marketplace + governance + treasury.
- **Proven on-chain:** first AI→policy→DEX execution `0x7efe51ac…` (24 Apr 2026); first sealed-mode + attestation `0x0d7334b8…` (27 Apr).
- **Honest status:** pre-PMF — **0 external users, demo vault ~$3, fees $0, revenue $0**. 289 contract + 199 orchestrator tests pass; internal review (127 findings, 11 Highs fixed) — **no third-party audit yet**.
- **One line:** strong, security-hardened engineering already live on 0G; now crossing to real capital.

## 2 · GTM Plan
- **Two-sided marketplace → operator-first cold-start**, 4 phases:
  1. **House anchor vault** (team-operated Operator #1, capped ≤50% TVL, reported separately).
  2. **Recruit operators** who already have a public, verifiable PnL track record.
  3. **Risk curators / allocators** (needs an ERC-4626 pooled variant).
  4. **Anchor depositor / treasury** — last.
- **Discipline:** operator payouts gated on **depositor retention + drawdown survival** (not peak AUM); traction reported only as **% external TVL**.
- **Positioning:** *verifiable, bounded risk-management* — **not** "autonomous AI alpha". Win on capital preservation + provenance first, yield once proven.

## 3 · Resources Needed (most → least)
1. **Deeper 0G DEX liquidity** — direct USDC↔BTC/ETH pools (or incentives). *#1: lifts the ~$1,800 NAV capacity wall so execution stays 0G-native (our preferred path).*
   - **Expansion option — 0G stays the core:** Aegis is built as a **0G-anchored, multi-chain execution layer**. The agent's compute, identity, slashable stake, reputation, and governance stay on 0G; only *execution* routes to wherever the deepest liquidity is. If 0G depth can't reach the needed size in time, we extend execution to deeper-liquidity EVM chains — **Arbitrum (infra already deployed), Base, and others** — via the same vault bytecode, replay-safe by chain-id. This **extends 0G's reach, it does not leave 0G**; deepening 0G liquidity simply keeps more of that execution on 0G itself.
2. **Intros:** 1–2 credible external operators + 1 established risk curator/allocator.
3. **First independent audit** (V4 + the planned ERC-4626 variant).
4. **Milestone grant:** deploy V4 → run one guarded vault → publish real on-chain net-PnL; also funds governor→multisig + key→HSM.
5. **0G Compute** SLA + credits + help moving "verifiable inference" from a single key to on-chain TEE-quote verification; **0G Storage** productionizing the decision-journal proof.

## 4 · 0G Incubation / Acceleration
- **Yes — actively interested.** Every blocker above is exactly what the program removes; we're already 0G-native, so it's alignment, not a pivot.
- **Our 90-day commit:** governor→multisig + key→HSM · ship fee collection (currently $0) · seed 3–5 external operators · first external V4 execution + first fee collected · publish first **real on-chain net-PnL**.
- **What we're *not* asking:** to market unproven yield. Prove the number first, together.
