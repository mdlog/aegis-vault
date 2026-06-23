# Aegis Vault × 0G Chain — Slide Deck Content (meeting-ready)

> **Cara pakai (ID):** tiap "Slide" = satu halaman. Teks di bawah judul = **isi slide** (jaga ringkas, maks ~5 baris). 🗣️ = catatan pembicara — **jangan** ditaruh di slide. Bangun di Google Slides / PowerPoint (tema gelap seperti deck Anda).
>
> **Aturan wajib:** tulis chain sebagai **0G** (angka nol), BUKAN "OG". Tanpa angka karangan. Tanpa nama produk lain. Drawdown/stop-loss = off-chain (jangan klaim on-chain).

---

## Slide 1 — Title
**Aegis Vault × 0G Chain**
Strategic Partnership & Meeting Briefing
*A non-custodial, AI-managed, policy-bounded DeFi vault — built 0G-native*

---

## Slide 2 — Agenda
1. **Team & Current Status**
2. **Go-To-Market Plan**
3. **Resources Needed**
4. **0G Deep Incubation**

---

## Slide 3 — Divider
**01 · Team & Current Status**

---

## Slide 4 — The Team (0G-Native)
- **Juamrdi** — Founder
- **Achmad Shabir** — Co-Founder
- **Built for & submitted to the 0G hackathon** — 0G-native from day one
- Combined expertise: **Machine Learning · Quant · Smart-Contract Engineering**

🗣️ Juamrdi buka di sini, lalu serahkan ke Achmad (lihat talk track).

---

## Slide 5 — Live on 0G Mainnet
- **V4 vault stack live** on 0G Aristotle Mainnet
- AI **proposes** → smart contract **decides & bounds** → executes (depositor keeps custody)
- Operator marketplace: **slashable-stake + reputation + governance**
- **Proven on-chain:** first AI→policy→DEX execution + first sealed, attested execution
- Engineering rigor: 289 contract + 199 orchestrator tests; 11 High-severity findings fixed pre-mainnet

🗣️ Siapkan 2 tx hash + factory address untuk ditunjukkan kalau diminta (lihat slide Appendix).

---

## Slide 6 — Honest Status & The Core Constraint
- **Pre-traction — by choice:** 0 external users, demo-scale vault, $0 revenue (fundamentals first)
- **The bottleneck is 0G DEX liquidity depth** — pools several times thinner than assumed; no direct USDC↔BTC/ETH (routes via the W0G hub)
- This caps a functional vault at the **low four figures (~$1.8K NAV) today**
- → **This is exactly why liquidity is our #1 ask**

🗣️ Bingkai jujur sebagai kekuatan: "kami tahu persis bottleneck-nya, dan itu yang kami minta bantuan."

---

## Slide 7 — Divider
**02 · Go-To-Market Plan**

---

## Slide 8 — Aegis Is the Third Path
- Today's binary choice: **trustless-but-dumb** DeFi vaults vs **smart-but-custodial** AI bots
- Aegis = the **third path** — AI drives, but the **contract holds custody & bounds every trade**
- We sell **verifiable, bounded risk-management** — *not* "autonomous AI alpha"
- Win on **capital preservation + transparency first**, yield once proven

🗣️ (Opsi visual: pakai diagram 2-layer 0G↔eksekusi dari `ARCHITECTURE_2LAYER.md`, bukan clipart.)

---

## Slide 9 — Operator-First Cold-Start
- Two-sided marketplace → **seed the harder side (operators) first**
- **1 · House Anchor** — team-operated vault as Operator #1 (capped, reported separately)
- **2 · Recruit Operators** — bring in managers with an existing public PnL track record
- **3 · Curation** — integrate established risk curators / allocators (via ERC-4626)
- **4 · Pilot Capital** — anchor depositor / treasury (last)
- Discipline: payouts gated on **retention + drawdown survival**, not peak AUM

🗣️ Catatan: jangan sebut nama produk lain di slide ini.

---

## Slide 10 — Divider
**03 · Resources Needed**

---

## Slide 11 — Critical Support Requested from 0G
- **1 · Deeper 0G DEX liquidity** — LP incentives / market-maker intros / co-incentive program *(top ask — lifts the ~$1.8K NAV wall)*
- **2 · Ecosystem intros** — credible AI/quant operators + one risk curator/allocator
- **3 · First independent security audit** (V4 + planned ERC-4626 variant)
- **4 · 0G Compute & Storage** — model SLA, compute credits, and a path to on-chain TEE attestation
- **Expansion — 0G stays the core:** execution can extend to deeper-liquidity EVM chains (Arbitrum, Base, …) while **compute, identity & reputation stay on 0G**

---

## Slide 12 — Divider
**04 · 0G Deep Incubation**

---

## Slide 13 — Yes — A Natural Fit
- **We're open and very interested** — already 0G-native, so it's alignment, not a pivot
- **Our 90-day commitments:** governor → multisig · keys → HSM · turn on the fee loop · onboard first external operators · run one guarded vault · **publish its real on-chain net-PnL**
- A **two-way partnership** — our principle: **prove the numbers first, together**

---

## Slide 14 — Closing / The Ask
- **Our single biggest ask:** help us **deepen 0G liquidity** and make the **ecosystem introductions**
- **We bring the proof on-chain.**
- *Thank you — let's build the flagship AI-DeFi vault on 0G.*

---

## Slide 15 — Appendix: On-Chain Proof (optional / for the technical deep-dive)
- **V4 Factory (0G, chain 16661):** `0x9e36520650…3582A5F`
- **First AI→policy→DEX execution:** tx `0x7efe51ac…a8a73f` (24 Apr 2026)
- **First sealed-mode + attestation:** tx `0x0d7334b8…36005e` (27 Apr 2026)
- **0G-native footprint:** 0G Compute (GLM-5-FP8 inference) · 0G Storage (decision journal) · identity/staking/reputation/governance on 0G
- *(Full addresses & figures in the supporting briefs)*

---

### Catatan build (ID)
- **Ganti semua "OG" → "0G"** dari deck lama.
- **Hapus klaim "drawdown bounded on-chain"** (drawdown/stop-loss = off-chain).
- **Ganti gambar stok** (mdpi/easy-peasy) dengan diagram 2-layer `ARCHITECTURE_2LAYER.md` di Slide 8.
- Slide tetap sparse — bullet pendek; detail panjang ada di catatan pembicara / brief, bukan di slide.
- Jumlah ideal: 13–15 slide (divider boleh digabung kalau mau lebih ringkas).
