# Aegis "Expand Reach" Playbook

*Prioritized, konkret, jujur. Disusun lewat riset pembanding + di-stress-test kritikus adversarial: venue di-redecide pakai data nyata, ERC-4626 diturunkan jadi proyek engineering bertrack sendiri, setiap statistik tak bersumber dibuang, dan setiap pembayaran operator di-gate pada retensi.*

> Catatan: dokumen strategi — sengaja TIDAK di-commit ke repo publik. Semua angka pasar harus diverifikasi ke sumber primer sebelum dipakai di pitch.

## 0. Lima koreksi yang mengubah rencana secara material

1. **Venue: 0G dulu, bukan Arbitrum.** Satu-satunya manifest operator yang sudah ter-publish & ter-register adalah `manifests/demo-quant.json` di **0G Aristotle (16661)**, dan execution proof pertama on-chain juga di 0G. Arbitrum (`deployments-arbitrum.json`) adalah **infra kosong — 0 operator, 0 history**. Membuang track record nascent yang sudah ada untuk mulai dari nol di venue tanpa provenance = membuang head start gratis. Akumulasi track record AWAL di 0G; perlakukan ekspansi Arbitrum sebagai keputusan terpisah yang di-decide dari **data likuiditas/slippage nyata**, bukan asumsi.
2. **ERC-4626 = proyek engineering bertrack sendiri, BUKAN checkbox 15 hari.** Vault V4 pakai `deposit/withdraw` dengan akunting `totalDeposited` sendiri, di-key `acceptedManifestHash`, sealed-mode, NAV multi-asset eksternal, operator slashable. Menambah share accounting standar = **refactor dalam berimplikasi keamanan**. Keluar dari critical path; masuk trek paralel dengan fallback adapter wrapper read-only.
3. **Setiap statistik tak bersumber dibuang.** Kalau dikutip di pitch — kutip sumber primer, atau hapus.
4. **Comparable yang tidak transfer dikoreksi.** Numerai *menghapus* sisi demand (fund = satu-satunya allocator) → bukan bukti cold-start dua sisi terpecahkan. Hyperliquid HLP = house market-maker perps menangkap flow exchange yang Aegis tak punya. eToro punya broker berlisensi + KYC + custody. Dipakai hanya untuk pola mekanis yang benar-benar transfer.
5. **Channel high-intent yang hilang ditambahkan.** Bukan cuma quant-Twitter KOL: poaching manager dHEDGE/Enzyme/Hyperliquid dengan PnL publik, curator/allocator (Gauntlet/Steakhouse/Re7/MEV Capital), audit pihak-ketiga + bug bounty sebagai channel, narasi founder-led. Semua payout operator di-gate pada **retensi depositor + survival post-drawdown**.

## 1. Diagnosis

Aegis belum dipakai bukan karena teknologinya lemah — engineering inti (policy-bound vault, sealed mode, slashing, signed-intent provenance) sudah jalan dan eksekusi nyata sudah terbukti on-chain di 0G. Masalahnya **distribusi + cold-start dua sisi**: butuh operator kredibel DAN depositor bersamaan; sekarang 1 manifest demo first-party, 0 external TVL. Tapi premisnya **lebih baik dari nol** — ada execution proof live + 1 operator manifest = artefak kredibilitas hari-0. Jangan dibuang. Reach tumbuh dari memecahkan sisi supply dulu **di venue tempat eksekusi sudah terbukti**, lalu memutuskan ekspansi dari data.

## 2. Insight inti: operator = saluran distribusi — dengan satu peringatan keras

Pola yang transfer: **seed sisi yang lebih sulit & bernilai dulu (operator kredibel), demand datang lebih murah.** Operator yang membawa audiensnya sendiri = saluran distribusi yang menyeret depositor.

**Peringatan:** di vault permissionless dengan operator pseudonim, "bayar operator per-AUM untuk menyeret follower" = setup persis **pump-and-dump-the-followers**. eToro bekerja karena ada broker berlisensi/KYC/custody — scaffolding yang Aegis tak punya. Pola ini **hanya boleh dipakai dengan pembayaran di-gate pada retensi depositor & survival post-drawdown**, bukan follower count atau peak AUM. Tanpa gate itu, ini mesin merugikan depositor, bukan distribusi.

## 3. Reach channels — ter-ranking (nilai, bukan urutan waktu)

| # | Channel | Leverage | Effort | Langkah konkret |
|---|---------|----------|--------|------------------|
| 1 | **House anchor vault sbg Operator #1 di 0G** | Sangat tinggi — kolaps deadlock dua sisi | Low-Med | 1-2 operator first-party pakai `demo-quant.json`, modal nyata di Jaine V3 (0G). Label seed, stake slashable sama, drawdown publik. **Hard cap ≤ 50% total TVL.** |
| 2 | **Poach manager dHEDGE/Enzyme/Sommelier/Hyperliquid** | Sangat tinggi — operator high-intent dgn **PnL publik existing**, skip tunggu 90 hari | Med | Set finite, contactable hari ini. Pitch: "bawa strategi terbuktimu ke vault non-custodial + provenance non-spoofable + stake slashable." |
| 3 | **Curator / risk-allocator** (Gauntlet, Steakhouse, Re7, MEV Capital, Block Analitica) | Sangat tinggi — 1 curator > vaults.fyi indexing; sumber cek $100-500K | Med-High | Pitch ke desk risk: policy on-chain + reporting verifiable + outperformance. |
| 4 | **Audit pihak-ketiga + bug bounty** (Immunefi/Cantina/Code4rena) | Tinggi — kredibilitas DAN channel ke komunitas security & whale | Med-High | **Jujur: belum ada audit pihak-ketiga.** Pesan audit + buka bounty → laporan jadi kredibilitas. Jangan klaim "diaudit" sebelum ada. |
| 5 | **Narasi founder-led** (writeup teknis, thread building-in-open PnL, podcast, CT, konferensi) | Tinggi — channel TERMURAH utk produk teknis pre-traction | Low | Trust-stack = cerita teknis; founder paling murah & kredibel membawanya. |
| 6 | **Trust-stack messaging dgn artefak bukti per-klaim** | Tinggi — kunci konversi whale/retail | Low-Med | Lihat §5. Bukan slogan "kamu pegang custody"; tiap klaim → artefak bukti. |
| 7 | **0G ecosystem grant + flagship positioning** | Tinggi (modal & co-marketing) | Low-Med | Didukung first-execution proof nyata di 0G. **Verifikasi term program saat ini sebelum aplikasi.** |
| 8 | **Public operator leaderboard sbg homepage** | Tinggi — GATED pada track record (house + ≥3 eksternal) | Med | Ranking live PnL, max drawdown, Sharpe, AUM + provenance signed-intent & stake. Jangan launch kosong/house-only. |
| 9 | **DeFiLlama adapter PR** | Sedang — credibility/SEO floor | Low | PR open-source. Setelah ada TVL nyata. |
| 10 | **vaults.fyi + allocator surfaces** (Exponential.fi, treasury tools) | Sangat tinggi (borrowed distribution) — indexing trailing berbulan | Med | Butuh prasyarat ERC-4626 (§4). Surface B2B allocator = tempat cek $100-500K di-source. |
| 11 | **Operator Championship (tournament)** | Sedang — rekrut supply + content | Med | JANGAN dgn 3-5 kontestan (event hampa = sinyal kecil). Butuh ≥10-15 operator. Gate prize pada **risk-adjusted return (Sharpe/Calmar)**, exclude pelanggar drawdown. |
| 12 | **Anchor depositor / treasury pilot** ($100-500K) | Tinggi — TVL kualitas tertinggi | High | Penjualan TERSULIT. Butuh track record + operator eksternal dulu. Sumber via #3 & #4. Realistis bulan, bukan hari 75-90. |

## 4. Product unlocks — effort jujur & critical path benar

- **ERC-4626 conformance — proyek engineering bertrack sendiri (High effort, review keamanan sendiri).** Fallback: adapter/wrapper read-only ERC-4626 untuk indexability tanpa merombak akunting inti. Putuskan full-refactor vs wrapper SETELAH house vault terbukti trading bersih.
- **Copy-trade / social-proof layer (Med).** Leaderboard + follow-operator + profit-share **gated retensi**. Edge: provenance signed-intent → atribusi non-spoofable. **Built di atas data on-chain existing, BUKAN menunggu ERC-4626.**
- **Intent/solver deposit routing (Enso/CoW) (Low-Med).** "Deposit dari token apa pun." Bergantung ERC-4626/adapter.
- **SDK / vault-as-a-service / embed (B2B2C) (High).** Model "productize SDK → partner suplai demand" **belum terbukti tanpa anchor partner**. Lakukan HANYA setelah ≥1 anchor partner minta embed.
- **Fiat onramp direct-to-vault (Low-Med).** Late-funnel. Jangan prioritaskan pre-traction.
- **Agent-framework / MCP (Vibekit/Olas/Virtuals).** Risiko impor traffic low-intent airdrop-farming. JANGAN hitung "ACP queue users" sebagai reach; ukur konversi-ke-deposit.

## 5. Trust-stack: mapping klaim → bukti → audiens

| Klaim | Artefak bukti (harus nyata) | Audiens |
|-------|------------------------------|---------|
| "Track record tak bisa dipalsukan" | Registry on-chain + signed-intent provenance — distribusi PnL penuh termasuk strategi rugi, di explorer 0G | Whale, curator |
| "Kamu pegang custody" | Kontrak non-custodial + path `withdraw()` verifiable | Retail hati-hati |
| "Operator punya stake slashable" | Stake USDC slashable, sama utk first-party & eksternal | Operator & depositor |
| "Eksekusi tahan-MEV" | Sealed-mode commit-reveal V4 (live di 0G) | Operator quant |
| "Diaudit" | **BELUM ADA — gated sampai audit pihak-ketiga selesai** | — |

Buang jargon TEE/EIP-712 dari pitch depositor-facing; simpan untuk writeup teknis audiens operator.

## 6. Ekosistem leverage — venue di-decide dari data

- **0G = venue seed AWAL + modal + flagship + co-marketing.** Mulai akumulasi track record di sini (eksekusi sudah terbukti). 0G user base = surface cross-promo hangat untuk kohort pertama; uji sebagai sumber depositor awal sambil ukur slippage nyata.
- **Ekspansi Arbitrum = keputusan terpisah dari data.** Uji slippage nyata di 0G pada ukuran trade target dulu. Jika benar membatasi, ekspansi ke Arbitrum **membawa provenance 0G sebagai artefak hari-0**. Grant Arbitrum (jika term terverifikasi & eligible) = bonus, bukan alasan re-architect.
- **Belanja grant disiplin:** house vault + (jika kritis-massa) tournament + 1 anchor pilot. BUKAN depositor points farm. Market sebagai kerja engineering tim & operator sbg builder dengan policy guardrails — bukan "agent" otonom.

## 7. Incentive / points — peringatan & gate keras

**Default: JANGAN pimpin dengan points/airdrop.** Pre-traction, points menarik mercenary capital tanpa apa pun untuk dialokasikan = TVL vanity.

**Gate anti-vanity:**
- **Hard cap house-vault ≤ 50% total TVL.** Deklarasikan traksi hanya pada **% external TVL**.
- **Cap jumlah house vault** supaya metrik tak bisa di-game.
- **Semua payout operator di-gate retensi:** profit-share dibayar pada **TVL-days yang bertahan drawdown + retensi depositor**, BUKAN peak AUM / follower count.

**Pre-deposit "jujur" tetap magnet mercenary.** Token-incentive + soft-lock = points-dengan-langkah-tambahan. Kalau dipakai: terms eksplisit, seed operator dulu, ukur berapa yang **BERTAHAN 90 hari post-unlock**. Jangan pasarkan "$X committed" sebagai traksi.

## 8. Rencana — fase, bukan tanggal-mati

**Fase 1 — Buktikan core loop (Minggu 0-3)**
- Jalankan 1-2 **house vault di 0G** pakai manifest existing, modal nyata, eksekusi nyata di Jaine V3.
- Konfirmasi loop AI→policy→on-chain→PnL jujur jalan bersih 2-3 minggu sebelum apa pun yang lain.
- Mulai trek engineering ERC-4626 terpisah (scope: full-refactor vs adapter). Paralel, bukan critical path.
- Mulai narasi founder-led (termurah, hari-0).

**Fase 2 — Seed supply tinggi-intent (Minggu 3-8)**
- Outbound ke manager dHEDGE/Enzyme/Sommelier/Hyperliquid dgn PnL publik (sumber utama, bukan cuma KOL).
- Pesan audit pihak-ketiga + buka bug bounty (lead time panjang — mulai sekarang).
- Verifikasi term 0G grant lalu aplikasi (core loop terbukti di belakang pitch).
- Finalisasi trust-stack mapping — hanya klaim dgn artefak nyata.

**Fase 3 — Manufaktur social proof (Minggu 8-14)**
- Onboard ≥3-5 operator eksternal (concierge) — sekarang ada track record house untuk ditunjukkan.
- Launch leaderboard sbg homepage — gated house + ≥3 eksternal.
- Bangun copy-trade/social-proof layer di atas data on-chain existing.
- Mulai BD curator/allocator (lead time panjang).

**Fase 4 — Buka demand & borrowed distribution (Minggu 14+)**
- DeFiLlama adapter PR setelah TVL nyata.
- Tournament HANYA jika ≥10-15 operator; gate prize pada risk-adjusted return.
- vaults.fyi/allocator surfaces setelah ERC-4626/adapter & TVL nyata (indexing trailing berbulan).
- Anchor treasury pilot — via curator & komunitas security; realistis bulan.
- Ekspansi Arbitrum hanya jika data slippage 0G membuktikan butuh — bawa provenance 0G.

## 9. Metrik reach — vanity dibuang

**Supply-side (leading, paling penting):** jumlah operator dengan ≥30 hari track record live; jumlah manager existing yang berhasil di-poach; **% operator eksternal vs first-party** (house ≤50%).

**Demand & retensi:** **% external TVL** (bukan total); **TVL-days** & **% TVL bertahan melewati drawdown pertama**; median holding period; depositor via operator-referral **dengan denominator konversi** (bukan follower reach mentah).

**Borrowed distribution:** jumlah surface eksternal menampilkan vault Aegis; jumlah curator/allocator yang allocate (cek $100-500K); anchor treasury pilot closed (1 reference customer bernama).

**Vanity yang DIABAIKAN:** peak TVL, total TVL (vs external), total points, raw follower count, "ACP queue users", mindshare InfoFi.

---

**Satu kalimat:** Reach tidak datang dari marketing — ia datang dari satu house vault yang trading modal nyata di 0G hari ini (di mana eksekusi sudah terbukti, jangan buang itu), lalu memoach operator yang sudah punya PnL publik dan mengikat satu curator yang menulis cek nyata; leaderboard, indexing, dan ERC-4626 adalah amplifikasi yang gated pada track record live itu — dan setiap rupiah yang dibayar ke operator harus di-gate pada apakah depositor-nya bertahan, bukan berapa follower yang mereka bawa.
