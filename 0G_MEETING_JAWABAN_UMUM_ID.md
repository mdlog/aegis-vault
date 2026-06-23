# Aegis Vault × 0G — Jawaban Umum Agenda Meeting

> Versi naratif & high‑level (sengaja tidak terlalu spesifik). Angka, alamat kontrak, dan bukti transaksi detail tersedia di dokumen pendukung dan dapat ditunjukkan langsung saat diskusi.

## 1 · Team & Current Status

Kami adalah tim **0G‑native** dalam arti yang sebenarnya: proyek ini dibangun khusus untuk dan disubmit ke hackathon 0G, dan sejak baris kode pertama kami membangun di atas 0G — bukan memindahkan produk dari tempat lain. Tim kami memadukan tiga keahlian yang justru dibutuhkan untuk produk seperti ini: **machine learning** (otak pengambilan keputusan), **kuantitatif/quant** (logika strategi dan manajemen risiko), dan **smart‑contract engineering** (lapisan keamanan dan eksekusi on‑chain).

Soal status, kami memilih untuk jujur dan apa adanya. **Produk kami sudah hidup di 0G mainnet** — bukan sekadar konsep atau testnet. Alur intinya sudah berjalan end‑to‑end secara on‑chain: AI mengusulkan sebuah keputusan, smart contract yang **memutuskan dan membatasi** apakah keputusan itu boleh dijalankan, lalu dieksekusi di dalam pagar pembatas (policy) yang sudah ditetapkan. Artinya, bagian tersulit secara rekayasa — membuat AI dan kontrak bekerja sama dengan aman tanpa menyerahkan kendali dana — sudah kami buktikan bisa berjalan.

Pada saat yang sama, kami **masih di tahap awal (pre‑traction)**: belum ada modal eksternal dalam skala besar. Kami sengaja tidak terburu‑buru menarik dana publik sebelum fondasi keamanan, keandalan, dan ekonomi produknya benar‑benar matang. Posisi ini kami sampaikan secara transparan karena kami percaya kredibilitas dibangun dari kejujuran — kami tahu persis apa yang sudah kuat (rekayasa dan keamanan) dan apa yang masih perlu dibuktikan (daya tarik pasar nyata).

## 2 · Go‑To‑Market Plan

Aegis adalah sebuah **marketplace dua sisi**: di satu sisi ada **operator AI** yang menjalankan strategi, di sisi lain ada **depositor** yang menaruh dana. Tantangan klasik model seperti ini adalah masalah "ayam dan telur" — depositor datang kalau ada operator yang kredibel, dan operator tertarik kalau ada dana. Strategi kami menjawab ini dengan pendekatan **operator‑first**: kami menumbuhkan sisi yang lebih sulit dan lebih bernilai lebih dahulu, karena satu operator kredibel akan membawa audiens dan kepercayaannya sendiri, sehingga depositor mengikuti secara alami.

Filosofi dasar kami adalah **membangun kepercayaan terlebih dahulu, baru bicara imbal hasil**. Kami memposisikan Aegis sebagai *manajemen risiko yang terbatas dan dapat diverifikasi* — bukan janji "AI menghasilkan cuan tanpa batas" yang sering kali kosong. Nilai jual pertama kami adalah **perlindungan modal dan transparansi**: pengguna bisa melihat aturan main yang ditegakkan oleh kontrak, bukan sekadar janji.

Eksekusinya bertahap dan berurutan: dimulai dari **vault internal** sebagai bukti bahwa seluruh loop berjalan bersih, lalu **merekrut operator** yang sudah memiliki rekam jejak nyata, kemudian membuka **kerja sama dengan curator/allocator** yang membawa modal berkualitas, dan terakhir menarik **depositor besar**. Yang sama pentingnya, kami memegang **disiplin metrik yang jujur**: kami menghindari angka yang dibesar‑besarkan, dan mengukur keberhasilan dari **retensi depositor serta ketahanan saat pasar turun**, bukan dari angka sesaat yang terlihat mengesankan tetapi rapuh. Ini adalah upaya sadar untuk tidak terjebak pola "AI fund" yang menjual angka palsu.

## 3 · Resources Needed

Kebutuhan kami saat ini sangat konkret, dan sebagian besar adalah hal yang justru bisa difasilitasi oleh ekosistem 0G:

- **Likuiditas DEX di 0G yang lebih dalam** — ini **prioritas utama** kami. Likuiditas adalah kunci: tanpa kedalaman pasar yang memadai, sebuah vault tidak bisa beroperasi pada skala yang berarti tanpa terkena slippage besar. Memperdalam likuiditas di 0G adalah pembuka terbesar bagi pertumbuhan kami.
- **Perkenalan ke ekosistem** — koneksi ke operator/quant yang kredibel untuk mengisi sisi supply, dan ke allocator/curator untuk membawa alokasi modal pertama yang berkualitas.
- **Dukungan audit keamanan independen** — untuk memvalidasi keamanan kontrak kami di mata calon penyetor dana yang serius.
- **Dukungan teknis 0G** — terutama pada sisi compute dan storage, agar kemampuan AI dan jejak audit kami semakin andal dan dapat diverifikasi.

Sebagai pelengkap strategi jangka panjang, Aegis dirancang dengan prinsip **0G tetap menjadi inti**: otak AI, identitas operator, dan reputasinya tetap berada di 0G. Sementara itu, **lapisan eksekusi dapat diperluas ke chain lain yang likuiditasnya lebih besar** — misalnya Arbitrum, Base, atau chain lainnya — apabila diperlukan. Dengan kata lain, ekspansi ini **memperluas jangkauan 0G, bukan meninggalkannya**; dan justru dengan memperdalam likuiditas di 0G, semakin banyak aktivitas yang akan tetap berlangsung di 0G. Pendekatan ini menjadikan 0G sebagai pusat kendali untuk eksekusi agentic lintas‑chain, bukan sekadar satu venue.

## 4 · 0G Deep Incubation / Acceleration

**Ya, kami terbuka dan sangat tertarik.** Karena kami memang sudah 0G‑native, bergabung dengan program inkubasi atau akselerasi 0G adalah sebuah **langkah yang selaras secara alami — bukan perubahan arah atau pivot**. Kami tidak perlu "membelokkan" produk agar cocok; arah kami sudah searah dengan ekosistem 0G sejak awal.

Yang membuat kecocokan ini kuat adalah bahwa hampir semua kebutuhan kami di poin 3 — likuiditas, perkenalan ekosistem, audit, dan dukungan teknis — persis merupakan hal yang disediakan oleh program semacam ini. Kami melihat hubungan ini sebagai **kemitraan dua arah**: 0G membantu kami menyeberang ke modal nyata, dan kami pada gilirannya menjadi contoh nyata produk DeFi berbasis AI yang aman dan jujur di atas 0G.

Kami siap berkomitmen pada **milestone yang konkret dan terukur** bersama tim 0G, dengan satu prinsip yang kami pegang teguh: **membuktikan hasil nyata terlebih dahulu**, bukan memasarkan sesuatu yang belum terbukti. Kami ingin menunjukkan angka yang sungguh‑sungguh, bersama‑sama.

---

*Catatan: dokumen ini sengaja dibuat umum dan naratif. Detail teknis, angka, alamat kontrak, dan bukti on‑chain tersedia dalam dokumen pendukung dan dapat ditunjukkan langsung saat meeting.*
