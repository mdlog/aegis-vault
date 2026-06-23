# Analisis Product-Market Fit (PMF) — Aegis Vault

> **Catatan metodologi (baca dulu).** Laporan ini ditulis untuk builder, bukan untuk ruang pitch. Dua batasan kejujuran yang harus eksplisit di depan, bukan disembunyikan di catatan kaki:
> 1. **Semua angka pasar di laporan ini adalah angka sekunder yang belum diverifikasi dari sumber primer.** Saya menandai setiap angka dengan `[UNVERIFIED]` dan tidak memperlakukan satu pun sebagai fakta. Diligence yang benar harus menarik angka ini dari DefiLlama, Token Terminal, filing, atau dashboard on-chain sebelum dipakai untuk keputusan. Saya tidak melakukan verifikasi itu di sini, jadi semua sizing di bawah adalah **order-of-magnitude untuk orientasi, bukan basis keputusan.**
> 2. Pernyataan "saya tidak menjual" bukan jaminan objektivitas. Pembaca sebaiknya mengasumsikan analis tetap bisa terlalu lunak, dan menilai vonis dari bukti yang dilampirkan, bukan dari nada. Di mana bukti menunjuk "nol", saya tulis "nol", bukan "potensial".

---

## 1. Produk dalam satu paragraf

Aegis Vault adalah protokol **vault trading non-custodial** di 0G Aristotle Mainnet (chain 16661) di mana sebuah AI **mengusulkan** trade dan smart contract **menegakkan sebagian aturan kebijakan** sebelum dana bergerak. Secara teknis: factory EIP-1167 meng-clone satu vault per depositor; depositor adalah `owner` (custody penuh: pause, withdraw, rotasi signer, upgrade manifest), sedangkan wallet orchestrator operator hanya `executor` (memanggil `executeIntent` dalam batas policy yang **ditegakkan on-chain untuk bentuk trade**, tidak pernah bisa memindahkan dana bebas). Setiap trade mengalir sebagai **EIP-712 ExecutionIntent** bertanda tangan, di mana hash output inferensi AI (`attestationReportHash`) dan hash strategi yang disetujui depositor (`acceptedManifestHash`) adalah field di dalam typehash. **Penting dan sering disalahpahami:** binding ini memverifikasi bahwa intent cocok dengan *suatu* respons AI yang ditandatangani oleh *satu* kunci ECDSA — ia **tidak** memverifikasi reasoning AI benar, tidak mem-parse SGX/TDX quote (tidak ada cek MRENCLAVE on-chain), dan dua kontrol yang paling dipedulikan depositor saat crash — `maxDailyLossBps` dan `stopLossBps` — **ditegakkan off-chain saja, bukan on-chain.** Di sekitarnya ada **operator marketplace** (registry + tiered USDC staking + reputasi + insurance pool yang belum dikapitalisasi/diaudit) dan governor yang saat ini **1-of-1**. Model bisnisnya adalah potongan 20% dari fee operator ke ProtocolTreasury — **yang belum bisa ditagih** (`accrueFees`/`claimFees` belum di-ship). Status sebenarnya: **software hackathon-stage yang dideploy di mainnet 0G, dengan marketplace yang di-reset ke nol pada 2026-05-14, fee belum operasional, dan nol eksekusi pihak ketiga di V4.**

---

## 2. Masalah & siapa yang mengalaminya (ICP)

### Masalah inti (klaim produk, WHITEPAPER §1.1) — "AI vault trust problem"
Dua jalur yang sama-sama cacat:
- **DeFi trustless (Yearn, Enzyme)** → non-custodial, tapi strategi deterministik/manusia (tidak ada alpha AI).
- **Bot AI custodial (3Commas, Polycule)** → mungkin ada alpha, tapi custody/API key diserahkan ke operator opaque.

Insiden custodial-bot (3Commas API leak; Polycule Jan 2026 menghentikan withdrawal setelah breach ~$230K `[UNVERIFIED]` lalu menghilang) **membuktikan bahwa custody itu berisiko.** Yang TIDAK dibuktikan oleh insiden ini:
- bahwa korban akan **pindah** ke vault AI non-custodial;
- bahwa mereka akan pindah ke **0G** secara spesifik;
- bahwa mereka akan menerima **return ter-bound yang lebih rendah** demi verifiability yang — menurut riset yang sama — **tidak mereka bayar premium-nya.**

Jadi yang valid adalah "**custody berisiko**" (problem-pain), bukan "**ada demand untuk solusi INI**" (demand). Keduanya tidak boleh dicampur.

### ICP — dua sisi marketplace

**Sisi depositor (demand):** Allocator crypto-native sophisticated yang (a) mau alpha AI aktif, (b) menolak menyerahkan custody, (c) cukup paham untuk menghargai EIP-712/policy enforcement. **Masalah sizing yang jujur:** laporan ini sendiri mengakui segmen ini adalah **minoritas**, dan bahwa verifiability "baru terasa penting setelah pernah terbakar". **Saya tidak punya angka yang dapat dipertahankan untuk ukuran irisan ini** (mau-alpha-AI ∩ menolak-custody ∩ paham-kripto ∩ nyaman-di-0G). Tanpa angka itu, **belum terbukti bahwa segmen ini cukup besar untuk menopang bahkan SOM $1–50M** — ini adalah asumsi terbuka, bukan basis yang sudah divalidasi.

**Sisi operator (supply):** Operator AI/quant yang ingin memonetisasi strategi tanpa custody dan membangun track-record on-chain Sybil-resistant. **Peringatan analogi:** klaim "builder mau stake untuk berkompetisi" bersandar pada Numerai — tapi Numerai **membayar prize pool dari hedge fund ~$1B** `[UNVERIFIED]` dan memberi data bersih ter-obfuscate. Itu insentif yang **berbeda fundamental** dari meminta quant tak dikenal mem-bond USDC nyata dan me-route trade lewat DEX ber-TVL ~$1,28M `[UNVERIFIED]` di L1 yang turun -96% dari ATH `[UNVERIFIED]`, demi fee yang dipotong 20% dan **belum bisa ditagih**. Analogi Numerai **tidak terbukti**, dan seluruh rencana GTM "seed supply dulu" bergantung padanya (lihat §11).

**Kesimpulan ICP:** Pain custody nyata di kedua sisi, tapi **demand untuk solusi spesifik ini, di chain ini, dengan ekonomi ini, belum dapat diukur dan belum terbukti** — paling akut justru untuk segmen yang paling sulit dijangkau saat cold-start.

---

## 3. Value proposition & wedge

**Diferensiator paling tajam (bukan "alasan untuk membeli", karena belum ada yang membeli):** *"AI mengusulkan, contract memutuskan bentuk trade — dan operator bersaing dengan stake yang bisa di-slash."*

Kombinasi tiga pilar yang membuat desain ini tidak biasa:
1. Policy on-chain yang mem-**veto bentuk** usulan AI.
2. Binding kriptografis dari output inferensi spesifik ke eksekusi (`attestationReportHash` di typehash).
3. Marketplace operator dengan slashable stake + reputasi on-chain.

**Koreksi klaim novelty (overclaim di analisis asli).** Analisis asli menyatakan "tidak ada kompetitor yang menggabungkan ketiganya / belum ada yang menyalin". **Klaim ini tidak dapat saya buktikan dan saya tarik kembali.** Saya hanya mensurvei ~10 kompetitor pilihan; "tidak ada satu pun di dunia yang menggabungkan X" adalah klaim yang **unfalsifiable** dan merupakan overclaim founder klasik. Yang dapat saya katakan secara jujur: **di antara pemain yang saya periksa, saya tidak menemukan yang mengiklankan ketiga pilar sekaligus.** Itu observasi terbatas, bukan bukti keunikan.

**Caveat pricing (kritikal).** Riset eksplisit: **pasar belum membayar premium untuk verifiability** (Phala memberi harga inference confidential = harga route biasa `[UNVERIFIED]`; tidak ada paying customer untuk verifiable inference). Maka verifiability adalah **klaim diferensiasi kepercayaan, BUKAN pricing lever** — dan inilah inti masalah "tech disangka PMF": fitur yang **tidak akan dibayar lebih** sedang diperlakukan sebagai value prop pendefinisi produk. Aegis harus menang di **yield + safety** dulu; binding kriptografis adalah asuransi kepercayaan, bukan magnet dompet.

---

## 4. Ukuran pasar (TAM/SAM/SOM) — semua `[UNVERIFIED]`

**Disclaimer keras:** Setiap angka di bagian ini berasal dari riset sekunder yang **tidak saya verifikasi ke sumber primer**. Beberapa di antaranya — khususnya TVL Almanak — **diketahui bertentangan** dengan tracker publik (lihat di bawah). Perlakukan seluruh bagian ini sebagai **orientasi orde-besaran, bukan model**.

### TAM (plafon teoretis — sebagian besar TradFi, tidak addressable on-chain jangka pendek)
- Robo-advisor AUM ≈ **$2,5T** (2026) `[UNVERIFIED]` — analog paling jujur untuk "manajemen aset algoritmik low-touch fee-on-AUM".
- Hedge fund ≈ **$5,7T** `[UNVERIFIED]`.
- Global AUM top-500 ≈ **$140T** `[UNVERIFIED]` — **headline naratif, bukan bankable. Jangan dipakai.**

→ TAM orientatif "modal dikelola AI/algoritma" = orde **$2–5T** dalam 5–10 tahun, hampir semuanya off-chain. `[UNVERIFIED]`

### SAM — **tidak saya hitung dengan multiplier yang dikarang.**
Analisis asli menurunkan SAM dari "DeFi TVL (~$86–156B) × subset yang nyaman dengan manajemen otonom → $1–3B". **Saya tolak metode ini:** multiplier "subset" tidak pernah dikuantifikasi atau dijustifikasi — ia di-reverse-engineer agar mendarat dekat agregat vault yang dikutip. Itu **angka yang didandani sebagai kalkulasi**, bukan kalkulasi.

Sebagai gantinya, saya hanya menyajikan **agregat deposit nyata yang teramati** (tetap `[UNVERIFIED]`, sekadar batas atas observasional):
- Hyperliquid HLP ~$300–400M; GMX GLV ~$300–400M; Enzyme ~$230M; Almanak ~$132M peak **(lihat peringatan kredibilitas di bawah)**; dHEDGE ~$33–50M. `[UNVERIFIED]`
- "On-chain asset management ≈ $35B AUM" `[UNVERIFIED]` — angka kategori yang sering dikutip, **tidak saya verifikasi.**

→ **SAM yang jujur = "tidak diketahui secara presisi; berada di kisaran low-hundreds-of-$M sampai beberapa-$B untuk vault otonom non-custodial, tergantung definisi."** Saya menolak memberi titik tunggal yang terlihat presisi.

### SOM (12–24 bulan — *batas atas, dikoreksi turun keras*)
Aegis: (a) baru, (b) marketplace di-reset ke nol, (c) venue tipis (Jaine ~$1,28M total pool TVL `[UNVERIFIED]`, tanpa pool langsung USDC↔BTC/ETH — harus route via W0G hub), (d) fee belum operasional.

→ **SOM realistis = $1M–$50M TVL eksternal**, dengan constraint dominan **cold-start + kedalaman venue + ekonomi operator (lihat §4b)**, bukan ukuran pasar.

### 4b. Unit economics — **dua lubang besar yang harus ditutup sebelum sizing berarti apa pun**

**Proyeksi revenue protokol DITARIK.** Analisis asli menghitung "~$80–100K revenue protokol/tahun" dari take-rate ~4–5% yang diturunkan dari "Almanak $6M revenue di $132M TVL". **Tapi analisis yang sama menandai bahwa $132M TVL Almanak bertentangan dengan DefiLlama ~$500K — diskrepansi ~260×.** Menghitung proyeksi di atas denominator yang Anda sendiri sebut "cautionary tale kredibilitas" adalah **tidak valid**. Karena itu: **proyeksi $80–100K saya tarik sepenuhnya. Tidak ada proyeksi revenue protokol yang dapat dipertanggungjawabkan sampai (i) `accrueFees`/`claimFees` di-ship dan (ii) ada take-rate nyata yang teramati on-chain dari fee operator nyata.**

**Ekonomi OPERATOR — belum pernah dimodelkan, dan ini fondasi seluruh thesis dua-sisi:**
Sebelum "seed 3–5 operator" punya basis ekonomi, harus dijawab apakah operator eksternal bisa **break-even**, dengan semua biaya:
- **Gas** per `executeIntent` di 0G;
- **Slippage** karena route paksa lewat W0G hub (tidak ada pool langsung USDC↔BTC/ETH) di pool ber-TVL ~$1,28M — slippage besar pada size kecil;
- **Pyth oracle guard disabled** → slippage adalah **satu-satunya** proteksi harga (memperbesar biaya eksekusi efektif);
- **Opportunity cost** USDC yang di-stake + risiko **slashing**;
- **Potongan protokol 20%** di atas fee operator.

Pada SOM $1–50M TVL, di venue setipis ini, **belum ada bukti bahwa menjalankan vault break-even bagi operator**, apalagi menarik. **Ini analisis yang hilang dan menjadi prasyarat GTM** — tanpa model ekonomi operator yang positif, rencana "rekrut operator" tidak punya dasar.

**Ekonomi DEPOSITOR — net return belum dimodelkan:** Depositor harus mengalahkan yield pasif tanpa-operator-risk (mis. GMX GLV 9–18% `[UNVERIFIED]`, alUSD 8–12% `[UNVERIFIED]`) **setelah** fee operator + potongan 20% + slippage pool $1,28M + tanpa oracle guard. **Belum ada yang menunjukkan aritmetika ini bisa positif di venue 0G.** Selama itu belum dimodelkan, klaim "depositor akan untung" adalah harapan, bukan temuan.

**Garis bawah §4:** Ukur diri terhadap Giza/Almanak (puluhan–ratusan juta $ `[UNVERIFIED]`), bukan headline $140T. Tapi lebih penting: **tutup dua lubang unit-economics di atas dulu** — tanpa itu, semua TAM/SAM/SOM hanya teater.

---

## 5. Lanskap kompetitor

> **Koreksi kolom (overclaim).** Kolom di analisis asli berjudul "Keunggulan Aegis" — itu salah. Menyatakan "keunggulan" atas produk dengan TVL/user/revenue nyata sementara Aegis punya **nol pengguna** membalik arti "keunggulan" bagi depositor. Kolom di bawah saya ganti menjadi **"Diferensiator teoretis Aegis (belum tervalidasi pasar)"** — yaitu klaim desain, bukan keunggulan kompetitif yang terbukti. Semua angka kompetitor `[UNVERIFIED]`.

| Kompetitor | Apa yang mereka lakukan | Keunggulan mereka (nyata, ber-traction) | **Diferensiator teoretis Aegis (belum tervalidasi pasar)** | Celah Aegis |
|---|---|---|---|---|
| **Giza (ARMA)** | Agent otonom non-custodial rebalance stablecoin; smart account + EigenLayer AVS + verifiable inference | Traction nyata: ~$4,6B+ volume, ~25K+ instance, deal Re7 (~$500K), token live `[UNVERIFIED]` | Policy on-chain yang mem-veto bentuk trade + binding inference-ke-eksekusi + marketplace operator | Giza punya deposit, trust, distribusi nyata; **bisa menambah policy-veto lebih cepat dari kecepatan Aegis membangun distribusi** |
| **Almanak (alUSD)** | "AI swarm" 18-agent, vault stablecoin 8–12% | Skala leader: klaim ~$132M peak TVL, ~100K user, ~$6M revenue, token listed `[UNVERIFIED]` | Policy on-chain lebih ketat + multi-operator slashable | **PERINGATAN KREDIBILITAS: klaim $132M vs DefiLlama ~$500K = ~260× — angka ini tidak dapat dipercaya tanpa verifikasi independen** |
| **Hyperliquid (HLP + copy-vault)** | Perps DEX; vault leader, profit share 10%, skin-in-game ≥5%, gate 10K USDC | Cold-start **sudah terpecahkan**: ~73% share perps, likuiditas dalam, funnel trader→leader `[UNVERIFIED]` | Binding output AI on-chain + slashing (leader HL manusia, tanpa binding AI) | Likuiditas & dua-sisi HL **sudah jadi**; Aegis mengejar operator & dolar yang sama dari belakang dengan nol traction |
| **Numerai** | Hedge fund crowdsourced; stake NMR pada prediksi | Analog slashable-stake + reputation; AUM ~$550M→~$1B, ~30K peserta `[UNVERIFIED]` | Model staked-operator yang sama tapi ke DeFi on-chain | Numerai **membayar dari hedge fund $1B + data bersih** — insentif tidak sebanding dengan bond-USDC-di-DEX-$1,28M; trading equities off-chain via meta-model terpusat |
| **Olas / Autonolas** | Jaringan agent otonom; Pearl app-store + BabyDegen | ~$13,8M raise, ~3,8M tx, token live, sejak 2021 `[UNVERIFIED]` | Policy veto per-trade + binding EIP-712 | Ekosistem & distribusi jauh lebih besar/matang |
| **Axal (Autopilot)** | AI trading non-custodial; ZK co-processor | Verifikasi ZK + fiat on-ramp + backing a16z CSS/CMT `[UNVERIFIED]` | Marketplace operator slashable (Axal per-akun, bukan adjudikasi operator bersaing) | Punya on-ramp + UX mainstream yang Aegis tidak punya |
| **Enzyme / dHEDGE / Yearn** | Vault non-custodial human/deterministik (baseline) | TVL & trust matang (Yearn ~$2,25B, Enzyme ~$230M, audit) `[UNVERIFIED]` | Layer operator AI policy-gated + attested | Bisa "bolt on" operator AI memakai likuiditas + audit yang sudah ada |
| **Brahma / Set Protocol** | Non-custodial account + policy (analog terdekat) | — | — | **SINYAL NEGATIF (lihat §asumsi): Brahma diakuisisi Polymarket lalu di-wind-down (Mar–Apr 2026); Set Protocol mati. Analog terdekat gagal berdiri sendiri — ini bisa berarti kategori sulit, bukan "window terbuka".** |
| **EigenCloud / Spectral / ERC-8004** | Infra verifiable-AI (TEE+slashing, zkML, registry reputasi) | Primitive industri (ERC-8004 live mainnet 2026-01-29) `[UNVERIFIED]` | — *(bukan kompetitor langsung)* | **Risiko komoditisasi: rival merakit jaminan ala-Aegis dari komponen siap pakai.** Interop/map ke ERC-8004, jangan reinvent |

---

## 6. Diferensiasi & defensibility — MOAT nyata atau fitur yang mudah ditiru?

### Apa yang BUKAN moat (koreksi terhadap analisis asli)
- **Revert-on-mismatch BUKAN moat.** Analisis asli membingkai mekanik EIP-712 revert ("binding by construction, bukan janji") sebagai aset defensibility. **Itu salah kategori.** Revert saat intent tidak cocok dengan signed payload adalah **properti kebenaran (correctness)** yang dimiliki **setiap** sistem signed-intent. Mendandani invariant kriptografis standar sebagai keunggulan kompetitif adalah overclaim. Saya hapus dari kolom moat.
- **Replay protection (chainid + typehash) BUKAN sinyal pasar.** Itu **table-stakes security correctness**, bukan diferensiasi yang dirasakan pengguna. Saya keluarkan dari argumen defensibility.
- **Trust-split factory (owner=depositor, executor=operator) adalah desain yang genuinely bagus** — tapi **belum ada satu depositor pun yang memilih Aegis KARENA split ini.** Eleganсi arsitektural di-skor sebagai fit di analisis asli; saya koreksi: ini **product-readiness yang baik, bukan bukti demand.**

### "Expensive to copy" — overclaim yang dikontradiksi sendiri
Analisis asli menyebut kombinasi tiga pilar "mahal untuk ditiru" sambil **di paragraf yang sama** mengakui bahwa primitive-nya sedang **terkomoditisasi** (EigenCompute, zkML, ERC-8004) dan bahwa **Giza bisa menambah policy-veto lebih cepat dari kecepatan Aegis membangun distribusi.** Dua hal ini tidak bisa benar bersamaan. **Saya tarik framing "mahal untuk ditiru".** Realitanya: komponen teknis **murah dirakit ulang**; yang mahal adalah **distribusi + TVL yang bertahan + reputasi operator yang terakumulasi** — dan justru itulah yang Aegis **tidak** punya (dan reset ke nol).

### TEE adalah ECDSA — fakta paling merusak, sekarang dipusatkan (lihat juga §9)
Binding hanya membuktikan intent cocok dengan *suatu* respons yang ditandatangani **satu kunci ECDSA**. Chain **tidak** mem-parse SGX/TDX quote (tidak ada MRENCLAVE check). Maka klaim "attested AI inference" **secara on-chain tereduksi menjadi**: "siapa pun yang memegang satu kunci ECDSA bisa mencetak sealed intent yang valid." Verifiability sejati hanya **post-hoc, off-chain** — dan bergantung pada orchestrator menghitung hash dengan jujur. **"Cryptographic AI binding" jauh lebih lemah dari yang terdengar di pitch.**

### Vonis defensibility (dikoreksi dari "rendah-ke-medium, potensial" → lebih keras)
Analisis asli mendarat di "rendah-ke-medium dan masih potensial". **Bukti tidak mendukung kelunakan itu.** Faktanya: (a) primitive terkomoditisasi, (b) incumbent bisa bolt-on fitur lebih cepat dari Aegis membangun distribusi, (c) moat sesungguhnya (network effect dua-sisi + reputasi operator terakumulasi) **sengaja di-reset ke nol** pada 2026-05-14. Tiga hal itu bersama berarti **defensibility hari ini = efektif belum terbukti / mendekati nol secara terwujud**, bukan "medium-potensial". Yang ada adalah **hipotesis moat** yang baru terbukti **jika** marketplace berhasil dibangun dari nol dan bertahan — sesuatu yang belum dimulai. **Defensibility = unproven hari ini.**

---

## 7. Traction & demand signals — blak-blakan

**Ini PRE-TRACTION. Tegasnya nol.**

- Marketplace V4 di-redeploy fresh 2026-05-14: **0 operator, 0 vault, 0 staker, 0 claim, 0 TVL.**
- **V4 = NOL eksekusi on-chain.**
- Bukti eksekusi yang ada hanya **dua tx demo self-run di stack V3 lama** (BUY 0G `0x7efe51ac`, 2026-04-24; sealed reveal `0x0d7334b8`, 2026-04-27) — **bukan pihak ketiga, bukan V4.**
- **Revenue model belum operasional:** `accrueFees`/`claimFees` tidak ada; frontend menampilkan "not available in this build". **Fee belum bisa ditagih.**
- **Belum ada audit pihak ketiga** ("127 findings / 11 Highs" adalah review internal). Bug bounty & insurance masih roadmap.
- Governor bootstrap **1-of-1** (deployer = satu-satunya signer).

**Tech ≠ traction (eksplisit, karena ini jebakan utama laporan asli):** Analisis asli mengangkat "engineering kredibel + arsitektur dideploy + demo berfungsi" sebagai penyeimbang positif terhadap traction nol. **Itu adalah tech disangka PMF.** Arsitektur yang dideploy dan demo self-run adalah **product-readiness**, bukan demand. **Tidak ada satu pengguna eksternal pun yang menyentuhnya.** Kualitas engineering tidak boleh menggantikan bukti permintaan — dan di laporan ini, tidak akan.

**Demand signal yang valid — untuk KATEGORI, bukan untuk Aegis:** uang institusi memvalidasi operator DeFi otonom (Re7→Giza, Numerai→AUM besar) `[UNVERIFIED]`; appetite investor (Theoriq $78M, Numerai $30M Series C, Almanak $8,45M) `[UNVERIFIED]`; dua-sisi terbukti mau bertransaksi di bawah aturan stake/fee (Hyperliquid). Ini memvalidasi **pasar kategori ada** — **tidak satu pun adalah traction Aegis.**

---

## 8. Vonis PMF

**Posisi: PRE-PMF (pre-traction). Bukan "weak early signal" — itu pun belum tercapai, karena nol pengguna eksternal.**

- PMF = **pull pasar** (datang, bertahan, membayar). Aegis = **nol** ketiganya secara eksternal. Yang ada **product-readiness kuat**, bukan fit.
- Problem **(custody berisiko) tervalidasi**; tapi **demand-untuk-solusi-INI tidak**, dan tidak boleh disamakan (lihat §2). Demand kategori nyata `[UNVERIFIED]`; itu membuat ini **bukan** "produk mencari masalah", tapi validasi masalah ≠ PMF.
- Tiga penahan: (1) marketplace reset ke nol → tidak ada bukti supply-side; (2) fee belum bisa ditagih → loop monetisasi belum tertutup; (3) eksekusi V4 = nol → core loop belum pernah jalan end-to-end dengan dana pihak ketiga.
- **Catatan fit yang lebih dalam — dan masalah repositioning:** riset menyatakan LLM trading buruk secara otonom, dan pemenang adalah **yield-rebalancing risk-bounded, bukan alpha diskresioner** `[UNVERIFIED]`. **Tapi reposisi tidak gratis:** pemenang yang dikutip (GMX GLV, Almanak alUSD) menghasilkan yield dari **mekanik market-making/lending**, BUKAN dari AI yang mengusulkan trade di bawah policy-veto. Mereposisi Aegis sebagai "yield-rebalancer verifiable" **tidak otomatis membuat arsitektur AI-proposal Aegis menjadi mesin yang menghasilkan yield itu.** Asumsi bahwa arsitektur AI-proposal "selamat" dari reposisi ke yield-rebalancing **belum terbukti** dan harus diuji, bukan diasumsikan.

**Satu kalimat:** Aegis adalah **solusi yang dibangun baik untuk masalah nyata, tanpa satu pun pengguna eksternal yang membuktikan mereka menginginkan solusi ini dengan cara INI, dan dengan model ekonomi operator yang belum terbukti break-even** — itu definisi pre-PMF.

---

## 9. Risiko terbesar

> Disusun ulang agar risiko teknis paling merusak **dipusatkan**, bukan diserakkan.

1. **[RISIKO #1 — single-key voids the entire pitch] Kunci ECDSA TEE plaintext di `.env` + tanpa quote-verification on-chain.** Karena chain **tidak** mem-parse SGX/TDX quote, seluruh value prop "attested AI inference" tereduksi menjadi "**siapa pun yang memegang satu kunci ECDSA bisa mencetak sealed intent valid**". Jika kunci `.env` bocor: setiap jaminan "verifiable AI" **batal**, **dan secara on-chain tidak bisa dibedakan dari operasi sah.** Ini **jurang terbesar antara pitch dan realita.** (Catatan kebijakan tim: pernah ada insiden wallet terkuras karena key di repo publik — risiko ini bukan hipotetis bagi tim ini.) **Wajib:** pindahkan key ke HSM/hardware, dan/atau implementasikan parsing quote on-chain sebelum klaim "attested" boleh dipakai dalam pitch.

2. **[Safety promise sebagian palsu] Loss-limit OFF-CHAIN.** `maxDailyLossBps` & `stopLossBps` **hanya off-chain** (orchestrator). Veto on-chain mengatur **bentuk trade**, **bukan batas kerugian.** Maka headline "policy ditegakkan on-chain sebelum dana bergerak" **secara material tidak benar untuk dua kontrol yang paling dipedulikan depositor saat crash.** Orchestrator ter-compromise/buggy tidak bisa drain, tapi **bisa gagal stop-loss saat drawdown tanpa revert.** Ini harus dinyatakan jujur ke depositor, bukan disembunyikan.

3. **[Self-dealing / fake-track-record — dan GTM kita sendiri memproduksinya] Anchor-operator tim.** GTM (§11) menyarankan tim menjalankan "1–2 operator anchor" untuk men-seed reputasi. **Ini menciptakan vektor wash-trading/track-record palsu**: tim mengoperasikan vault, modal tim jadi TVL, skor reputasi self-generated — **persis jebakan kredibilitas Almanak ($132M klaim vs ~$500K tracked) yang kita kritik di tempat lain.** Risiko ini harus ditandai eksplisit dan dimitigasi (mis. label "team-operated" yang tidak dihitung sebagai reputasi eksternal, TVL pihak-ketiga dilaporkan terpisah).

4. **[Durability verifiability runtuh] 0G Storage disabled → journal di SPOF.** Audit journal bergantung pada **satu proses off-chain** (PM2 fork, node-cron in-process = SPOF, **tanpa backing store durable**). Seluruh klaim "auditor bisa recompute journal" — yang dijadikan **milestone PMF di §10** — **runtuh jika proses itu kehilangan journal lokalnya.** Recompute-ability yang menopang thesis verifiability **tidak punya penyimpanan tahan-lama.**

5. **[Akuntabilitas ekonomi terpusat penuh] Governor 1-of-1.** Bukan sekadar "trust gap untuk di-de-risk". Governor 1-of-1 atas sistem ber-slashing & ber-fee berarti **satu kunci bocor (atau satu founder jahat/terpaksa) bisa men-slash operator jujur atau mengalihkan treasury.** Klaim "akuntabilitas ekonomi" marketplace **sepenuhnya tersentralisasi hari ini.**

6. **[Insurance yang dijual tanpa modal] Insurance pool tak terkapitalisasi/tak teraudit.** "Insurance pool" disebut sebagai fitur, tapi **sumber dana, ukuran, dan cakupannya tidak pernah diperiksa.** Menjual "asuransi" tanpa pool yang terkapitalisasi & teraudit adalah **risiko mis-selling/liabilitas laten**, terlebih tanpa audit eksternal.

7. **[Apakah AI benar punya edge net-of-fee?] Risiko eksistensial thesis.** LLM trading buruk otonom; completion workflow agent kompleks ~20–40% `[UNVERIFIED]`. Jika return tidak mengalahkan yield pasif (GLV 9–18%, alUSD 8–12% `[UNVERIFIED]`) **net of fee + 20% + slippage + slashing risk**, case depositor runtuh. **Belum dimodelkan apakah mekanik venue 0G membuat ini aritmetis mungkin** (lihat §4b).

8. **[Regulasi — potensial eksistensial, di-underweight di analisis asli]** Vault pooled + manajer-AI diskresioner + performance fee mendekati **definisi tekstual collective investment scheme / investment adviser tak-teregistrasi** di US/EU — **terlepas dari custody.** Non-custodial mengurangi risiko custody, **bukan** risiko securities/adviser. Analisis asli memberi ~3 baris + softener "meski non-custodial". **Itu meremehkan.** Tanpa analisis yurisdiksi (US: Investment Advisers Act / pooled-vehicle; EU: MiCA/AIFMD), ini risiko terbuka yang bisa mematikan ekspansi ke modal institusi/whale.

9. **[Venue & ekosistem 0G tipis] Likuiditas.** DeFi TVL 0G ~$3M dan menyusut `[UNVERIFIED]`; token -96% dari ATH `[UNVERIFIED]`; Jaine ~$1,28M total pool tanpa pool langsung USDC↔BTC/ETH (route via W0G). Pyth guard disabled → slippage satu-satunya proteksi harga. Ini **membatasi capital, memperbesar slippage, menekan return awal** — merusak flywheel proof-of-performance sebelum mulai.

10. **[Key-person / bus-factor]** Single-process orchestrator + plaintext key + governor 1-of-1 + state yang sengaja di-reset → menunjuk **operasi 1–2 orang.** Untuk sistem yang merutekan (meski non-custodial) modal orang lain, **risiko key-person/bus-factor adalah item diligence inti** dan harus dinyatakan.

11. **[Komoditisasi moat]** EigenCompute, zkML, ERC-8004 → rival merakit jaminan setara. Tanpa operator berkualitas yang menghasilkan return bertahan, marketplace tidak punya alasan eksis.

> **Pertanyaan terbuka yang TIDAK saya jawab dengan asumsi baik:** **Mengapa tim sengaja menghapus satu-satunya aset reputasinya (marketplace) hanya pekan-pekan sebelum pitch?** Analisis asli mengasumsikan "reset bersih yang disengaja". **Kemungkinan lain yang sama validnya dan belum disingkirkan:** bug contract, insiden keamanan, atau redeploy yang merusak komposabilitas. Ini harus **dikonfirmasi**, bukan diasumsikan jinak.

---

## 10. Apa yang akan MEMBUKTIKAN PMF (milestone konkret & terukur)

**Tahap 0 — Prasyarat kejujuran (sebelum milestone lain berarti):**
- **Model ekonomi operator yang positif** dipublikasikan: gas + slippage W0G + opportunity cost stake + slashing + potongan 20% → **break-even/positif pada size realistis.** Tanpa ini, semua tahap di bawah membakar operator.
- **Verifikasi primer** atas angka pasar yang dipakai untuk keputusan (DefiLlama/Token Terminal/on-chain), khususnya menyingkirkan ketergantungan pada angka Almanak yang cacat.

**Tahap A — Supply-side hidup:**
- **≥5 operator eksternal (non-tim)** register, stake USDC nyata, publish bonded manifest lolos keccak256. **TVL/operator tim dilaporkan terpisah dan tidak dihitung sebagai sinyal eksternal** (mitigasi jebakan §9.3).
- **≥1 operator menaiki tier** dengan stake bertahan melewati cooldown 14-hari.

**Tahap B — Core loop dengan dana pihak ketiga:**
- **Eksekusi V4 pertama dari operator eksternal** atas vault dengan **depositor eksternal** (bukan self-run, bukan V3).
- **Fee benar-benar tertagih:** `accrueFees`/`claimFees` di-ship; ProtocolTreasury menerima potongan 20% pertama dari fee operator nyata.

**Tahap C — TVL yang bertahan:**
- **$1M+ TVL eksternal** (bukan tim) yang **bertahan ≥1 drawdown ≥10% tanpa mass-exit.**
- **Retensi:** ≥60% depositor tahap awal masih punya dana setelah 90 hari.

**Tahap D — Bukti edge + safety + durabilitas:**
- **Net-of-fee return operator mengalahkan baseline pasif** (GLV/alUSD) ≥1 kuartal, **terbukti on-chain dari journal yang punya backing store durable** (bukan hanya file lokal SPOF).
- **Zero loss-of-funds** + **audit pihak ketiga bernama** selesai.
- **Loss-limit (`maxDailyLossBps`/`stopLossBps`) dipindah/dicerminkan on-chain**, atau didisclose jujur sebagai off-chain ke setiap depositor.

**Tahap E — Sinyal marketplace + governance:**
- **≥3 operator dengan reputasi terdiferensiasi** dan depositor **memilih di antara mereka.**
- **≥1 slashing event** diproses governance **multisig (bukan 1-of-1)** dengan benar.

> Aturan praktis: PMF mulai kredibel saat **ekonomi operator positif + TVL eksternal bertahan drawdown + fee tertagih + ≥3 operator bersaing + governance bukan 1-of-1.** Sebelum itu, semua adalah demo.

---

## 11. Rekomendasi GTM

Realitas: pasar dua-sisi fresh, di L1 distressed, cold-start diperburuk sendiri, ekonomi operator belum terbukti, dan satu kunci ECDSA yang bisa membatalkan seluruh pitch keamanan. Urutan harus pragmatis dan jujur.

**1. SEBELUM segalanya — tutup tiga lubang fatal (non-negotiable):**
- (a) **Pindahkan TEE signer key dari plaintext `.env` ke HSM/hardware**, dan/atau implementasikan quote-verification on-chain. Sampai ini beres, **jangan memakai kata "attested/verifiable AI" dalam pitch** — itu tidak benar on-chain.
- (b) **Rotasi governor 1-of-1 → multisig nyata sekarang.** Tanpa ini, klaim akuntabilitas marketplace tersentralisasi penuh.
- (c) **Model ekonomi operator** (lihat §4b/§10 Tahap 0). Jika operator tidak bisa break-even, GTM "seed operator" akan gagal secara matematis.

**2. Tutup loop monetisasi (`accrueFees`/`claimFees`) sebelum scaling.** Revenue "documented but not operational" adalah lubang kredibilitas di setiap percakapan. Tanpa fee tertagih, **tidak ada alasan ekonomi bagi operator untuk hadir.**

**3. Bootstrap SUPPLY — tapi dengan jujur soal jebakan self-dealing.** Rekrut 3–5 operator AI/quant hand-to-hand. **Jika** tim menjalankan operator anchor, **wajib**: label "team-operated", TVL & reputasi tim **dipisah dan tidak dihitung** sebagai sinyal eksternal. Jangan reproduksi jebakan Almanak yang kita kritik. **Catatan:** analogi "operator mau stake (Numerai)" belum terbukti untuk konteks 0G — validasi dengan 1–2 operator nyata dulu sebelum mengasumsikan supply mudah di-seed.

**4. Reposisi ke "verifiable risk-management ter-bound", bukan "alpha AI otonom" — tapi uji apakah arsitektur selamat dari reposisi.** Pitch safety-first (operator nol akses dana, policy mem-veto bentuk trade). **Tapi jujur:** policy on-chain **tidak** mem-veto kerugian (loss-limit off-chain), dan yield-rebalancer pemenang menghasilkan yield dari mekanik market-making/lending, **bukan** dari AI-proposal+veto. **Buktikan dulu** bahwa arsitektur AI-proposal Aegis benar-benar menghasilkan yield ter-bound yang kompetitif **net-of-fee di venue 0G** sebelum menjual reposisi ini. Hindari credibility trap Almanak.

**5. Perlakukan 0G sebagai narasi + grant venue dengan akuntansi strategis yang jujur — JANGAN sembunyikan whiplash.** 0G punya ~$3M DeFi TVL & token -96% `[UNVERIFIED]`. **Tapi ini proyek hackathon yang dibangun & disubmit DI 0G** — merekomendasikan "port ke Arbitrum/Base" adalah **strategic whiplash yang harus dihitung terbuka, bukan dikubur sebagai sub-bullet.** Port multi-chain berarti: **biaya audit ulang + redeploy + beban keamanan tambahan + menegasikan positioning 0G-native** yang menjadi dasar submission. **Rekomendasi jujur:** jangan janjikan port sebagai langkah-90-hari. Sebagai gantinya, **buktikan core loop end-to-end di 0G dulu** (karena di situlah grant & narasi berada), dan **perlakukan port sebagai keputusan terpisah ber-biaya-tinggi** yang hanya diambil **setelah** ekonomi operator & loop fee terbukti — dengan estimasi effort audit/redeploy yang eksplisit, bukan sebagai asumsi "bytecode deploy-anywhere".

**6. Tentang "window terbuka" Brahma/Set — baca dua arah.** Brahma (analog non-custodial-account+policy terdekat) diakuisisi lalu di-wind-down; Set mati. **Interpretasi optimis** ("jendela terbuka") **dan interpretasi pesimis** ("kategori sulit berdiri sendiri sebagai bisnis standalone") **sama-sama didukung bukti.** Jangan bertindak seolah hanya yang optimis benar. Gerak cepat boleh — tapi dengan mata terbuka bahwa **kematian analog terdekat adalah sinyal risiko, bukan hanya peluang.**

**7. Interop ke ERC-8004, jangan reinvent.** Memetakan OperatorReputation ke standar yang live (2026-01-29 `[UNVERIFIED]`) mengubah liabilitas (reputasi proprietary non-portable) menjadi kredibilitas dan mengurangi risiko komoditisasi.

**8. Selesaikan audit pihak ketiga bernama + kapitalisasi/audit insurance pool.** "Won't buy trustless promises" — capital whale/institusi butuh audit + track-record. Insurance yang dijual tanpa pool terkapitalisasi adalah liabilitas, bukan fitur.

**9. Onboarding & TAM yang dapat dijangkau — terima niche dulu.** Default deposit $50.000 + asumsi paham drawdown/turnover/confidence-threshold = hanya allocator sophisticated (segmen yang kita sendiri sebut minoritas & belum ter-size). **Pilihan jujur:** terima secara sadar bahwa fase pertama adalah **niche sophisticated**, dan **jangan habiskan energi mengejar mainstream sebelum loop + ekonomi operator terbukti.** Fiat on-ramp/AA (à la Axal) adalah pekerjaan fase-2, bukan fase-1.

**Urutan eksekusi 90 hari yang realistis (di 0G, bukan port):** (i) tutup tiga lubang fatal — key→HSM, governor→multisig, model ekonomi operator; (ii) ship fee accrual; (iii) seed 3–5 operator eksternal dengan TVL tim dipisah; (iv) eksekusi V4 eksternal pertama + fee tertagih pertama; (v) kejar $1M TVL eksternal yang bertahan satu drawdown. **Port lintas-chain bukan item 90-hari** — itu keputusan terpisah setelah loop terbukti, dengan biaya audit/redeploy yang dihitung eksplisit. Ini mengubah "demo bagus" menjadi "sinyal PMF awal pertama yang nyata".

---

### Ringkasan satu paragraf untuk builder
Anda membangun arsitektur yang **secara teknis kredibel** untuk masalah yang **terbukti nyata** (custody berisiko) dalam kategori yang **tampak dimonetisasi** `[UNVERIFIED]`. Tapi hati-hati membedakan **tech dari PMF**: arsitektur yang dideploy + demo self-run adalah **product-readiness, bukan demand** — **nol pengguna eksternal** menyentuhnya. Diferensiator Anda ("policy mem-veto bentuk AI × marketplace slashable") **menarik secara desain**, tapi saya **tidak** bisa mengklaim "tidak ada yang menyalin" (itu unfalsifiable), framing "mahal ditiru" **bertentangan** dengan komoditisasi primitive yang Anda akui sendiri, dan **defensibility hari ini efektif belum terbukti** karena moat sesungguhnya (network effect + reputasi operator) **Anda reset ke nol.** Lubang paling merusak: **satu kunci ECDSA plaintext tanpa quote-verification on-chain membatalkan seluruh klaim "attested AI"**, dan **loss-limit off-chain membuat janji "policy on-chain" sebagian tidak benar** untuk hal yang paling dipedulikan depositor saat crash. Ekonomi operator **belum dimodelkan** dan menjadi prasyarat GTM. Semua angka pasar di sini **`[UNVERIFIED]`** — khususnya, proyeksi revenue protokol **saya tarik** karena diturunkan dari TVL Almanak yang cacat ~260×. Jalan ke PMF: tutup tiga lubang fatal (key→HSM, governor→multisig, model ekonomi operator), tutup loop fee, seed operator dengan TVL tim dipisah (hindari jebakan track-record palsu), buktikan core loop **di 0G**, dan capai **$1M+ TVL eksternal yang bertahan satu drawdown** — sebelum mempertimbangkan port lintas-chain sebagai keputusan ber-biaya tinggi tersendiri. Sampai itu terjadi, ini adalah **produk yang dikerjakan luar biasa yang masih mencari pengguna pertamanya — dan harus berhenti memperlakukan engineering sebagai bukti permintaan.**

---

*Metodologi: laporan ini dihasilkan dari analisis multi-agent (4 pembaca kode: smart contract, AI orchestrator, frontend, positioning/bisnis + 3 periset pasar: kompetitor, market/timing, customer/demand), disintesis, lalu di-stress-test oleh kritikus skeptis (seed investor + DeFi veteran) dan dikeraskan. Semua angka pasar `[UNVERIFIED]` — verifikasi ke sumber primer sebelum dipakai untuk keputusan.*
