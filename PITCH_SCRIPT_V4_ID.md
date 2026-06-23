# Aegis Vault — Pitch Video Script (V4 Mainnet, Bahasa Indonesia)

**Target durasi:** 4:30 – 5:00
**Status aplikasi (per 2026-05-16):** V4 live di 0G Aristotle Mainnet + Arbitrum One. 285 tests passing. Slither `fail-on: high` di CI. Marketplace fresh (Registry/Staking/Reputation/Insurance) governance-bound ke `AegisGovernor` multisig.
**Sasaran penonton:** juri hackathon teknis — pembedaan via *cryptographic binding*, bukan marketing.
**Bahasa:** Bahasa Indonesia. Istilah kripto (EIP-712, ECDSA, keccak256, ecrecover, commit-reveal, sealed mode, TEE) tetap English — itu istilah standar komunitas.

---

## [0:00 – 0:25] HOOK — Masalah dalam satu kalimat

**[Visual: layar hitam, teks putih muncul satu baris per beat]**

> "Semua protokol AI-trading bilang hal yang sama:
> *'AI cuma propose, contract yang execute.'*
>
> Pertanyaan saya satu:
> **tunjukkan di mana output AI itu terikat secara kriptografis ke transaksi on-chain-nya.**
>
> Kami sudah lakukan. Field-nya ada di EIP-712 struct kami.
> Dari satu kebutuhan itu, lahir delapan keputusan teknis."

**[Visual: dissolve ke logo Aegis Vault + tagline]**

> Aegis Vault — *Verifiable-AI risk manager with on-chain execution guardrails.*
> Live di 0G Aristotle Mainnet. Mirror identik di Arbitrum One.

---

## [0:25 – 0:55] APA INI — Vault non-custodial dalam tiga lapis

**[Visual: diagram tiga lapis: Depositor → Vault Policy → AI Operator]**

> "Aegis Vault itu vault non-custodial. Tiga lapis:
>
> **Satu** — depositor stake USDC, pilih AI operator dari marketplace, dapat shares.
>
> **Dua** — vault menyimpan *policy*: position size, slippage, asset whitelist, cooldown, fee cap, intent expiry, dan — ini yang baru di V4 — `acceptedManifestHash` dari strategy operator. Policy ini di-commit waktu vault dibuat dan **immutable**.
>
> **Tiga** — AI operator menjalankan inferensi di 0G Compute (model GLM-5-FP8), menghasilkan trade intent, tandatangani via TEE-attested signer, kirim ke vault.
>
> AI **tidak punya otoritas**. AI cuma propose. Vault yang putuskan boleh eksekusi atau revert."

---

## [0:55 – 1:45] BINDING — Hash output AI dipanggang ke dalam EIP-712 intent

**[Visual: `contracts/contracts/libraries/ExecLib.sol` — `EXECUTION_INTENT_TYPEHASH` di-highlight]**

```solidity
bytes32 internal constant EXECUTION_INTENT_TYPEHASH = keccak256(
  "ExecutionIntent(address vault,address assetIn,address assetOut,"
  "uint256 amountIn,uint256 minAmountOut,uint256 createdAt,uint256 expiresAt,"
  "uint256 confidenceBps,uint256 riskScoreBps,bytes32 attestationReportHash)"
);
```

> "Perhatikan field terakhir — `attestationReportHash`. `bytes32` yang kami hitung off-chain sebagai `keccak256(provider, chatId, model, contentDigest)` — sidik jari kriptografis dari respons inferensi 0G Compute.
>
> Field ini bagian dari **typehash EIP-712 itu sendiri**. Kalau AI response berbeda satu byte, attestation hash berbeda, intent hash berbeda, `ecrecover` menghasilkan signer yang berbeda — dan `policy.attestedSigner` menolak. Revert.
>
> Protokol lain perlakukan 'AI' sebagai langkah off-chain yang opaque. Mereka tidak bisa buktikan model mana yang produksi keputusan mana. **Struct kami yang menuntut bukti itu**, dan `ecrecover` yang menegakkan."

---

## [1:45 – 2:30] V4 — Strategy manifest binding (fitur unggulan rilis ini)

**[Visual: split — kiri: factory create call, kanan: `executeIntent` cek `intent.strategyHash`]**

> "Yang baru di V4: setiap vault clone *commit* `acceptedManifestHash` waktu dibuat. Ini hash dari strategy JSON operator — daftar asset, max position, cooldown, risk parameter.
>
> Operator publish manifest itu ke IPFS / GitHub, hash-nya tersimpan on-chain di `OperatorRegistry`. Waktu eksekusi, `executeIntent` cek `intent.strategyHash` harus cocok dengan `acceptedManifestHash` vault. Tidak cocok — revert.
>
> Konsekuensinya: operator **tidak bisa diam-diam pindah strategi** setelah depositor masuk. EIP-712 typehash sekarang termasuk `strategyHash` + `strategySchemaVer`, jadi cross-version replay **mathematically impossible**.
>
> Plus: kalau pola eksekusi operator menyimpang dari manifest yang di-commit, `AegisGovernor` (multisig) bisa slash stake mereka via `OperatorStaking`."

---

## [2:30 – 3:10] SEALED MODE — Commit-reveal anti front-running

**[Visual: `AegisVault.sol` — `commitIntent` + `executeIntent` flow]**

```solidity
function commitIntent(bytes32 commitHash) external {
  require(msg.sender == executor && policy.sealedMode, "c");
  intentCommits[commitHash] = block.number;
}
function executeIntent(ExecutionIntent calldata intent, bytes calldata sig) external {
  if (policy.sealedMode) {
    uint256 cb = intentCommits[commitHash];
    require(cb != 0 && block.number >= cb + 1, "cr");   // reveal ≥ N+1
    delete intentCommits[commitHash];
  }
}
```

> "MEV bot pantau mempool. Kalau kita broadcast intent terbuka, searcher front-run, harga digeser, kita fill di rate jelek.
>
> Sealed mode menutup itu dengan two-step. Block N: `commitIntent(hash)` — hash opaque, tidak ada yang tahu trade-nya apa. Block N+1 atau setelahnya: `executeIntent` — intent reveal, signature `ecrecover`'d melawan `policy.attestedSigner`, atomic swap.
>
> First sealed-mode reveal kami terbukti on-chain — tx `0x0d7334b8…` di 0G Aristotle, 27 April 2026."

---

## [3:10 – 3:45] BUKTI — Yang sudah on-chain dan yang sudah lewat audit

**[Visual: terminal split — `npm run test:all` summary 285/285 · Slither badge · explorer link]**

> "Sebelum V4 cutover kami surface **127 temuan audit**. **11 di antaranya severity High** — semua landed sebelum bytecode V4 dideploy ke mainnet.
>
> CI menjalankan Slither dengan `fail-on: high` di setiap perubahan `contracts/`. Tidak ada PR yang masuk kalau ada satu pun High yang aktif.
>
> **285 contract tests passing** — termasuk suite V4 strategy-binding, ExecutionRegistry audit suite, dan KillCritic fixes suite.
>
> Bukti on-chain:
> - First AI→policy→DEX execution: tx `0x7efe51ac…` (2026-04-24).
> - First sealed-mode reveal: tx `0x0d7334b8…` (2026-04-27).
> - V4 entry point: factory `0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F`.
>
> Semua bisa diaudit langsung di `chainscan.0g.ai`."

---

## [3:45 – 4:15] MARKETPLACE — Fresh, governance-bound dari t=0

**[Visual: diagram marketplace — Registry · Staking · Reputation · Insurance · semua arrow → AegisGovernor multisig]**

> "Marketplace V4 ditembak ulang fresh — 0 vault, 0 operator, 0 claim di launch. Bersih dari state V3.
>
> Empat kontrak: `OperatorRegistry`, `OperatorStaking`, `OperatorReputation`, `InsurancePool`. Admin dan arbitrator di semua kontrak ini di-set ke **AegisGovernor**, multisig M-of-N. Bukan ke EOA deployer.
>
> Implikasinya: slash, treasury spend, listing operator — semua butuh persetujuan multisig. Tidak ada single key yang bisa drain insurance pool atau confiscate stake. Itu commitment governance yang readable on-chain, bukan janji di docs."

---

## [4:15 – 4:40] DUA CHAIN, SATU BYTECODE — Tanpa bridge

**[Visual: split chain — 0G Aristotle (Jaine V3 venue) vs Arbitrum One (Uniswap V3 venue), satu vault implementation di tengah]**

> "Vault yang sama jalan di 0G Aristotle dan Arbitrum One. Bytecode identik. **Tanpa bridge.**
>
> Cross-chain safety-nya gratis dari standard: EIP-712 domain separator masukkan `block.chainid`. Intent yang ditandatangani untuk chain 16661 **tidak akan pernah** valid di chain 42161 — domain hash beda, intent hash beda, `ecrecover` keluar signer beda, vault revert.
>
> Audit sekali, deploy ke chain mana pun — empat menit gas dan satu transaksi factory."

---

## [4:40 – 5:00] CLOSE

**[Visual: full-frame — logo + URL + entry-point address]**

> "Aegis Vault. Live di **aegisvaults.xyz**.
> Entry V4 di 0G: `0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F`.
> Source di `github.com/mdlog`.
>
> **Setiap output AI terikat ke eksekusinya. Setiap operator commit hash strategy yang slashable. Setiap chain pakai bytecode yang sama.**
>
> Silakan audit. Terima kasih."

**[Visual: hold logo 2 detik, fade out]**

---

## Pre-recording checklist

- [ ] Orchestrator log terbuka — banner GLM-5-FP8 + 0G Compute terlihat
- [ ] VS Code split:
  - Kiri: `contracts/contracts/libraries/ExecLib.sol` pinned ke `EXECUTION_INTENT_TYPEHASH`
  - Kanan: `contracts/contracts/AegisVault.sol` di sekitar `commitIntent` / `executeIntent`
- [ ] Browser tabs (urutan sesuai script):
  1. Layar hook hitam (text editor presentation mode)
  2. Diagram tiga-lapis Aegis (slide / `docs/diagrams/*`)
  3. [chainscan.0g.ai/address/0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F](https://chainscan.0g.ai/address/0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F) — V4 factory
  4. [chainscan.0g.ai/address/0x28F8E1a9Af4eBF4Df323861F499B8d87295b72Ed](https://chainscan.0g.ai/address/0x28F8E1a9Af4eBF4Df323861F499B8d87295b72Ed) — V4 vault implementation
  5. [chainscan.0g.ai/address/0x023EC4a54435f94E9395460e4835e75E429D5A2e](https://chainscan.0g.ai/address/0x023EC4a54435f94E9395460e4835e75E429D5A2e) — AegisGovernor multisig
  6. [chainscan.0g.ai/tx/0x7efe51ac](https://chainscan.0g.ai/tx/0x7efe51ac) — first AI→DEX execution
  7. [chainscan.0g.ai/tx/0x0d7334b8](https://chainscan.0g.ai/tx/0x0d7334b8) — first sealed-mode reveal
  8. [aegisvaults.xyz](https://aegisvaults.xyz) — live frontend
- [ ] Terminal terpisah dengan `npm run test:all` summary `285 passing` siap ditampilkan
- [ ] OBS / screen recorder 1080p, audio level dicek, notifikasi off
- [ ] Rehearsal dua kali — target 4:45 ± 10 detik

---

## Catatan delivery

1. **Mulai setiap segmen dari pola kode, bukan nama produk.** Juri baca Solidity lebih cepat dari narasi.
2. **Pause setelah istilah teknis di kali pertama:** "EIP-712 — typed-data standard Ethereum." Setelah itu pakai akronim bebas.
3. **Angka, bukan adjektif:** "285 tests" bukan "banyak tests"; "11 High audit findings landed" bukan "audit ketat".
4. **Baca baris kunci di kode dengan suara.** Jangan asumsikan penonton parse Solidity kecepatan video.
5. **Jangan soften klaim dengan "we believe" atau "kami rasa".** Kalau tidak bisa ditunjukkan di kode/explorer — buang baris itu.
6. **Sebut tx hash dengan prefix 8 karakter saja** (`0x7efe51ac`, `0x0d7334b8`) — biar juri sempat buka di tab lain.

---

## Potongan untuk media sosial (90 detik)

Kalau perlu versi pendek untuk Twitter/X atau LinkedIn:

- 0:00–0:15 — Hook (kalimat pertama).
- 0:15–0:45 — Section "BINDING" (typehash + attestationReportHash).
- 0:45–1:15 — Section "V4" (manifest binding) — *the headline*.
- 1:15–1:30 — Close + URL.

Itu cerita teknis paling padat yang mungkin tanpa kehilangan thesis.

---

## Kalau harus dipotong dari versi 5 menit

- **Potong pertama**: Section "DUA CHAIN, SATU BYTECODE" (4:15–4:40). Penting, tapi versi pendek bisa hidup tanpa itu.
- **Potong kedua**: Section "MARKETPLACE" (3:45–4:15). Bisa dijadikan footnote text overlay.
- **Jangan potong**: Hook · BINDING (typehash) · V4 manifest · BUKTI on-chain. Itu thesis irreducible.

---

## File pendukung

- Versi V2 (English, lebih panjang, untuk konteks evolusi): [PITCH_SCRIPT.md](PITCH_SCRIPT.md)
- Architecture detail: [ARCHITECTURE.md](ARCHITECTURE.md)
- Address book lengkap: [CONTRACTS.md](CONTRACTS.md)
- Whitepaper: [WHITEPAPER.md](WHITEPAPER.md)
- Demo walkthrough: [DEMO.md](DEMO.md)
- TEE attestation walkthrough: [docs/TEE_ATTESTATION_VERIFICATION.md](docs/TEE_ATTESTATION_VERIFICATION.md)
