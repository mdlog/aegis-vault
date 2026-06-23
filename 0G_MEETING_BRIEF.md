# Aegis Vault × 0G Chain — Meeting Brief

**Project:** Aegis Vault — a non-custodial, AI-managed, policy-bounded DeFi vault, built 0G-native.
**One line:** *The AI proposes; the smart contract decides the shape of every trade; operators compete with slashable stake.* The depositor always keeps custody.
**Status in one line:** Engineering is live on 0G mainnet (core pipeline demonstrated on-chain at demo scale); we are pre-revenue / pre-external-traction and clear-eyed about exactly what it takes to cross to real capital — which is where 0G can help most.

---

## TL;DR — the ask up front
1. **Liquidity / venue depth on 0G** — our #1 unlock. (Diagnosed below: today's 0G DEX depth caps a functioning vault at ~$1.8k NAV.)
2. **Intros** — 1–2 credible external AI/quant operators + 1 risk-curator/allocator.
3. **Audit + milestone grant** — first independent audit, and grant tied to "deploy V4 + run one guarded vault + publish real on-chain net-PnL."
4. **0G Compute / Storage support** — model SLA + compute credits for alpha measurement; help moving "verifiable inference" from a single signing key to real on-chain enclave-quote verification.

**On 0G's incubation/acceleration: yes — actively interested.** It maps directly to the gaps below.

---

## 1 · Team & Current Status

### Team
> *[Fill in before the meeting — kept truthful, no placeholders shipped:]*
> - **[Name] — [Role]** · [1-line background: prior DeFi/security/ML/quant experience, relevant ship history]
> - **[Name] — [Role]** · […]
> - **Team shape:** [size] · [full-time/part-time] · [location/timezone]
> - **Origin:** built for / submitted to **[0G hackathon name]**; 0G-native from day one.

### What's genuinely built and LIVE (on 0G Aristotle mainnet, chain 16661)
- **V4 vault stack** — `AegisVaultFactoryV4` `0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F`. Non-custodial single-owner clone: deposit stablecoins → pick an AI operator → autonomous execution inside a **narrow on-chain policy**. The AI only *proposes* an EIP-712 intent; the vault **enforces** position size, slippage floor, asset whitelist, fee caps, cooldown, intent expiry, and (V4) the operator's **strategy-manifest hash**.
- **Operator marketplace contract stack (complete — but 0 external operators yet)** — Registry, **slashable-USDC Staking** (up to 50% / 7-day window), on-chain Reputation, Insurance Pool (deployed, not yet capitalized), AegisGovernor (**currently 1-of-1; multisig is a near-term commitment**), Treasury.
- **Sealed mode + commit-reveal** — AI inference on **0G Compute (GLM-5-FP8)**; the response hash is bound into the signed intent and ECDSA-verified on-chain.
- **Quality posture** — 289 contract tests passing, Slither fail-on-high in CI; an **internal** security review surfaced 127 findings pre-V4 with 11 Highs fixed before mainnet cutover (**independent third-party audit not done yet** — see §3).

### Proof it actually runs (on-chain, verifiable)
| What | Evidence |
|---|---|
| First AI → policy → DEX execution on 0G | tx `0x7efe51ac…a8a73f` · 2026-04-24 · chainscan.0g.ai |
| First sealed-mode + TEE-attestation reveal | tx `0x0d7334b8…36005e` · 2026-04-27 |
| Live V4 vault (demo-scale) | `0xC01523Ef…2bd2` — ~$3 USDC.e, fees 0 (demo) |

### Honest current status (pre-PMF)
- **0 external users, 0 external TVL.** The one live V4 vault holds ~$3 and is demo-only. The make-or-break question — *does the AI add value at low turnover, net of costs?* — has not yet been measured against a real depositor.
- **The economics don't close on the current 0G DEX (Jaine).** Real pool depths are several times thinner than we'd assumed (≈5–7× by current on-chain reads, and they drift); there's no usable direct USDC↔BTC/ETH pool (every BTC/ETH trade is a two-hop via the W0G hub, so slippage compounds). Net: max executable trade ~$800–$900 (BTC/ETH) to ~$1,400 (W0G) before the on-chain 3% slippage floor reverts → a functioning vault is capped at **~$800–$1,800 NAV (low four figures)**. **This is the core reason liquidity is our #1 ask.**
- **Recent hardening (this build cycle).** We ran a full money-path + orchestrator audit and fixed, with regression tests: a HIGH decimals bug that bricked every stop-loss SELL; a drawdown-halt bypass; the daily-loss gate wrongly blocking defensive exits; a fail-open journal state; an inert loss-streak breaker; plus dashboard honesty fixes (no fabricated accuracy/risk numbers). Suites green (289 contract / 199 orchestrator).
- **Straight about the trust model:** today "verifiable inference" is a single ECDSA signing key, **not** an on-chain SGX/TDX quote. We say so, and want 0G's help closing that to real on-chain attestation.

---

## 2 · Go-To-Market

**Positioning (honest):** *verifiable, bounded risk-management* — non-custodial AI trading where the contract bounds **every trade's shape** (size, slippage, whitelist) and operators stake real money — **not** "autonomous AI alpha." (Trade-shape limits are on-chain; drawdown/stop-loss are off-chain today, with on-chain enforcement on the roadmap.) We earn trust on **capital preservation + provenance**, then on net yield once proven.

**The core problem we solve:** today you choose between *trustless-but-dumb* DeFi vaults and *smart-but-custodial* AI bots. Aegis is the third path — AI drives, but the contract holds custody and bounds every trade.

**Cold-start = operator-first (seed the hard side).** A credible operator brings their own audience; demand follows. Sequence:

| Phase | Move | Notes |
|---|---|---|
| **1 (wk 0–3)** | House anchor vault as Operator #1 on 0G | Prove the AI→policy→on-chain→honest-PnL loop runs cleanly for weeks. **Labeled "team-operated," capped ≤50% of TVL, reported separately — never counted as external traction.** |
| **2 (wk 3–8)** | Recruit operators with an existing public PnL track record | Skip the 90-day track-record wait; bring already-proven strategies to a non-custodial, slashable-stake home. |
| **3 (wk 8–14+)** | Established risk curators / allocators | One credible allocation > vanity TVL; source of $100–500k checks. Needs an ERC-4626 pooled variant (on our roadmap). |
| **4 (wk 14+)** | Anchor depositor / treasury pilot | Hardest, highest-quality TVL; comes last. |

**Discipline we hold ourselves to (anti-vanity):** operator payouts gated on **depositor retention + post-drawdown survival**, not peak AUM or follower count; traction reported only as **% external TVL**; house vaults capped and excluded from reputation. We're deliberately avoiding the inflated-track-record trap that has burned other "AI fund" narratives.

**Why 0G is the right home:** our only published operator manifest and our first on-chain execution proof both live on 0G — a real provenance head-start. The plan is to **prove the core loop end-to-end on 0G first** (where the grant and narrative live), carry that proof as a day-0 artifact, and treat any deeper-liquidity expansion as a separate, data-driven decision — not a reflexive port. Honest counterweight we're not hiding: 0G DeFi is thin today (~$3M TVL), which is precisely why venue/liquidity support is our top ask.

---

## 3 · Resources Needed (most specific — what we need from 0G)

| # | Resource | Why / what it unblocks |
|---|---|---|
| **1** | **Deeper 0G DEX liquidity** — direct USDC↔BTC/ETH pools + materially deeper W0G-hub pools (or liquidity incentives) | Lifts the ~$1.8k NAV capacity wall so the alpha math can close **on 0G itself**, keeping us 0G-native instead of forcing a move for liquidity alone. **Highest leverage.** |
| **2** | **Operator + allocator intros** | 0 operators today. 1–2 credible external AI/quant operators to seed the marketplace; 1 established risk-curator/allocator for the first allocation. |
| **3** | **Audit support** (partner slot / funding) | First independent audit of the V4 vault, sealed-mode/attestation path, and the planned ERC-4626 pooled variant — directly unblocks serious capital. |
| **4** | **Milestone-tied grant** | Funds: deploy V4 + run one guarded low-turnover vault + publish real on-chain net-PnL; governor → multisig; signer key → HSM/remote signer. |
| **5** | **0G Compute** | Model availability/SLA for GLM-5-FP8 + compute credits for sustained backtesting/alpha measurement; **guidance/tooling for on-chain enclave-quote (TEE) verification** so "verifiable inference" becomes a real on-chain attestation, not just a key. |
| **6** | **0G Storage** | Help productionizing the decision-journal recompute-proof path (off by default today) — also hardens the durability of the audit trail. |
| **7** | **Co-marketing — gated on a real net-PnL number** | Joint case study on the honest "capital-preserved + slashable-stake" differentiator, once we have a verifiable realized-PnL figure (not a promised APY). |

> **Expansion option — 0G stays the core:** Aegis is a **0G-anchored, multi-chain execution layer**. Compute, identity, slashable stake, reputation, and governance stay on 0G; only *execution* routes to the deepest liquidity. If 0G depth can't reach the needed size in time, we extend execution to deeper-liquidity EVM chains — **Arbitrum (infra already deployed), Base, and others** — via the same chain-id-replay-safe bytecode. This **extends 0G's reach, it does not leave 0G**; deepening 0G liquidity keeps more execution on 0G itself.

---

## 4 · 0G Deep Incubation / Acceleration — Yes, interested

**Why it fits:** every blocker above is exactly what an incubation/acceleration program is built to remove — liquidity access, ecosystem BD (operators + allocators), audit, security/compute/storage engineering support, and milestone capital. We're 0G-native already, so deeper alignment is natural rather than a pivot.

**What we'd commit to (proposed 90-day, 0G-first plan):**
1. Close the two credibility gaps: governor → multisig, signer key → HSM/remote signer.
2. Ship fee collection so the protocol revenue loop is live (currently $0).
3. Seed 3–5 **external** operators (team TVL reported separately).
4. First external V4 execution + first real fee collected.
5. Publish a transparent operator/depositor unit-economics model and the first **real on-chain net-PnL** from a guarded vault.

**What we'd want from the program:** the resources in §3, a 0G technical sponsor for the Compute/Storage/TEE items, and warm intros for §2.

**What we're NOT asking 0G to underwrite:** marketing of unproven yield. We want to prove the number first, together.

---

### Appendix — 0G-native footprint & key addresses
- **0G Compute** — every BUY/SELL/HOLD decision (GLM-5-FP8), prepaid metered ledger; response hash bound into the signed intent. *(The "brain" — stays on 0G even if execution scales to deeper-liquidity venues.)*
- **0G Chain** — operator identity, slashable staking, reputation, insurance, governance, treasury (all wired to the on-chain governor; **currently 1-of-1, multisig pending**).
- **0G Storage** — decision-journal recompute proof (wiring present; enabling in production is a §3 item).
- **Addresses (chain 16661):** Factory `0x9e36520650…3582A5F` · Governor/Registry/Staking/Reputation/Insurance/Treasury in `deployments-mainnet.json` · Jaine venue adapter `0xA4E2aeB9…481F2f` · NAV calc `0xFA632b02…138bA3a`.
- **Arbitrum One (42161):** execution infra deployed & bytecode-verified (V1-era) — `factory 0x49354460…`, `UniV3 adapter 0xB3f6611D…` — **0 vaults today**; V4 + the source fixes land on the next deploy.

*Prepared for the 0G Chain team meeting. All on-chain claims are verifiable; figures are current as of this build cycle.*
