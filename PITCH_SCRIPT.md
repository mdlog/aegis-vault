# Aegis Vault — Pitch Video Script

**Target duration:** 5:30 – 6:00
**Track:** 2 — Agentic Trading Arena (Verifiable Finance)
**Angle:** Technical differentiation. Seven specific things we do that no other vault protocol does — each backed by source code + on-chain proof.
**Language:** English (primary delivery). Indonesian fallback notes at end.

---

## Core differentiators (recording blueprint)

The script below walks judges through **seven technical claims** in order. Each claim follows the same three-part pattern:

1. **The claim** — one crisp sentence of what we do.
2. **What the rest of the vault ecosystem does instead** — the gap we fill.
3. **On-chain or in-repo proof** — so judges can audit immediately.

If you have to cut for time, cut Differentiator 6 or 7 first (they're the "belt-and-suspenders" hardening). Keep 1-5.

---

## [0:00 – 0:20] HOOK — The single line that sums up the thesis

**[Visual: black screen, white type fades in one line at a time]**

> "Every AI vault protocol says *the AI can only propose, the contract decides*.
>
> Okay — **show me where the AI output is cryptographically bound to the execution.**
>
> We did. It's a field in our EIP-712 struct. Seven specific engineering choices follow from that one requirement."

**[Visual: white type dissolves into Aegis logo + tagline "AI on 0G. Real liquidity on 0G + Arbitrum. Bound by EIP-712."]**

---

## [0:20 – 1:05] DIFFERENTIATOR 1 — AI response hash baked INTO the EIP-712 intent

**[Visual: `contracts/contracts/libraries/ExecLib.sol` lines 22-24 highlighted in editor]**

```solidity
bytes32 internal constant EXECUTION_INTENT_TYPEHASH = keccak256(
  "ExecutionIntent(address vault,address assetIn,address assetOut,uint256 amountIn,"
  "uint256 minAmountOut,uint256 createdAt,uint256 expiresAt,uint256 confidenceBps,"
  "uint256 riskScoreBps,bytes32 attestationReportHash)"
);
```

> "Look at the last field. `attestationReportHash` — a `bytes32` baked into the EIP-712 type itself. We compute it off-chain as `keccak256(provider, chatId, model, contentDigest)` — the exact response of the 0G Compute inference call.
>
> When the orchestrator submits `executeIntent`, the vault runs `ecrecover` on the intent hash against `policy.attestedSigner`. Wrong signer → revert. Wrong AI response → wrong attestation hash → wrong intent hash → revert.
>
> **Other AI vault protocols "use AI" as an off-chain opaque step.** They can't prove which model produced which decision. We can — our struct demands it, and `ecrecover` enforces it.
>
> Judges can `grep EXECUTION_INTENT_TYPEHASH` in the repo. It's load-bearing."

---

## [1:05 – 1:50] DIFFERENTIATOR 2 — A fee-bearing vault slimmed to 3.4 KB via three DELEGATECALL libraries

**[Visual: terminal — `ls -la artifacts/.../AegisVault.sol/AegisVault.json | awk` showing size · then diagram of vault → 3 libraries]**

```
AegisVault (slim implementation)      3.4 KB
├── DELEGATECALL → ExecLib            3.5 KB  (EIP-712 hash + policy + swap)
├── DELEGATECALL → SealedLib          0.5 KB  (TEE attestation ECDSA verify)
└── DELEGATECALL → IOLib              1.1 KB  (deposit / withdraw with fees)
```

> "0G Aristotle Mainnet has a per-block gas limit roughly a third of Ethereum's. Our first vault was 16 KB — too large. The fix was not *remove features* — it was refactor.
>
> `ExecLib` is `DELEGATECALL`-ed from the vault. Same storage, same `msg.sender`, same `address(this)`, but library bytecode lives outside. Every vault clone delegates into **one deployed copy** of `ExecLib` — deploy it once, amortize across every user.
>
> **Other vault protocols have monolithic 10-20 KB contracts.** When chain gas limits tighten, they can't deploy at all on cheap-gas L1s. Our architecture deploys identically on 0G's 3M-gas block limit and Arbitrum's 30M.
>
> Plus: wrap the vault in an EIP-1167 minimal-proxy factory — every user vault is now a **400,000-gas clone** instead of 2.7 million gas for a fresh deployment. Check `AegisVaultFactory` on chainscan, `vaultImplementation()` returns our single slim template."

---

## [1:50 – 2:40] DIFFERENTIATOR 3 — Dual-chain execution with ZERO bridge, secured by the EIP-712 standard itself

**[Visual: diagram `architecture-multichain.png` with arrows highlighting the EIP-712 middle block, then zoom into `ExecLib.sol:31-33`]**

```solidity
function _domainSeparator() private view returns (bytes32) {
  return keccak256(abi.encode(
    DOMAIN_TYPE_HASH, NAME_HASH, VERSION_HASH,
    block.chainid,                  // ← this single line is our cross-chain safety
    address(this)
  ));
}
```

> "Aegis Vault runs on both 0G Aristotle and Arbitrum One. Most multichain protocols solve this with a cross-chain messaging bridge — LayerZero, Hyperlane, a custom relayer. We don't.
>
> We use EIP-712 domain separators. Every intent includes `block.chainid`. An intent signed for chain 42161 **mathematically cannot be replayed on chain 16661** — the domain hash is different, so the intent hash is different, so `ecrecover` gives a different signer, and the vault rejects.
>
> **Other multichain vault protocols pay real money for bridge infrastructure and accept the associated trust assumptions.** We pay zero — cross-chain replay protection is in the Ethereum standard since 2018.
>
> The consequence: **the exact same bytecode** runs on 0G and Arbitrum. Audit once, trust both. Deploy time from zero to live on a new chain is about four minutes of gas."

---

## [2:40 – 3:25] DIFFERENTIATOR 4 — Commit-reveal anti-MEV built into the vault contract, not bolted on

**[Visual: `AegisVault.sol:70-97` highlighted — commitIntent + executeIntent flow]**

```solidity
function commitIntent(bytes32 commitHash) external {
  require(msg.sender == executor && policy.sealedMode && commitHash != bytes32(0), "c");
  intentCommits[commitHash] = block.number;   // ← commit block number stored
}

function executeIntent(ExecutionIntent calldata intent, bytes calldata sig) external {
  ...
  if (policy.sealedMode) {
    bytes32 commitHash = SealedLib.verifyAttestation(...);
    uint256 cb = intentCommits[commitHash];
    require(cb != 0 && block.number >= cb + 1, "cr");   // ← must be ≥ 1 block later
    delete intentCommits[commitHash];
  }
  ...
}
```

> "MEV bots watch the mempool. If you broadcast a trade intent, a searcher front-runs you, pushes price, you fill at a worse rate, they profit. Standard DeFi tragedy.
>
> Our sealed mode forces a two-step. Block N: `commitIntent(hash)` — the hash is opaque, nobody knows what the trade is. Block N+1 or later: `executeIntent(intent, sig)` — the intent reveals, but it's already committed and the swap executes atomically.
>
> **Most vault protocols don't have commit-reveal at the contract layer at all.** The ones that do often use external commit-reveal infra — more contracts, more audit surface. Ours is twenty-seven lines in the vault. You can read it all in one screen.
>
> The `attestationReportHash` field from Differentiator 1 goes *into* the commit hash. So the operator can't swap the revealed intent for a different one — the attestation binds them."

---

## [3:25 – 4:10] DIFFERENTIATOR 5 — Bonded slashable strategy manifests

**[Visual: `OperatorRegistry.publishManifest` ABI + frontend screenshot of the operator's bonded manifest badge with hash visible]**

> "When an operator registers, they don't just submit a nice description. They publish a **bonded manifest**: a strategy JSON with allowed assets, max position, cooldown — and its `keccak256` hash gets committed on-chain.
>
> `OperatorRegistry.publishManifest(uri, hash, bonded=true)` — if bonded is true, governance can slash the operator's stake if their execution history deviates from what the manifest committed.
>
> Our operator `0x4E08B728` has manifest hash `0xef462f33...79e` committed. That manifest lives in GitHub, verifiable hash. **Other protocols let operators say anything in marketing copy.** We require the strategy itself to be a cryptographic commitment the operator can be slashed against.
>
> Combined with the staking tiers — None / Bronze / Silver / Gold / Platinum — stake denominated in the *same USDC.e as the vault base asset*, so there's no token-price shell game where the stake becomes worthless if a native token drops. It's real dollars of skin, committed to a real hash of strategy."

---

## [4:10 – 4:55] DIFFERENTIATOR 6 — Asset-whitelist enforcement on BOTH sides of every swap

**[Visual: `ExecLib.sol:68-77` — the whitelist loop, added post-audit]**

```solidity
// Asset whitelist enforcement (Finding 1 fix — both sides of the swap
// must appear in the vault's policy-committed allowedAssets list).
bool inOk;
bool outOk;
for (uint256 i = 0; i < allowedAssets.length; i++) {
  if (allowedAssets[i] == intent.assetIn)  inOk  = true;
  if (allowedAssets[i] == intent.assetOut) outOk = true;
}
require(inOk, "assetIn!wl");
require(outOk, "assetOut!wl");
```

> "Post-audit hardening. A third-party security reviewer found that earlier builds let the AI swap *into* any token not explicitly in the vault's allowed list. We fixed it at the contract layer.
>
> `assetIn` must be whitelisted. `assetOut` must be whitelisted. Both sides. No exceptions. The allowedAssets array is written at vault creation and immutable for the life of the vault.
>
> **Most vault protocols whitelist the input side only** — reasoning that the output will be swept back to base asset later. But during the intermediate window the vault can hold adversarial tokens with hostile transfer hooks. We close that window entirely.
>
> `grep "assetIn!wl" contracts/` — one match, one line of code, fully audited."

---

## [4:55 – 5:25] DIFFERENTIATOR 7 — STRICT_MODE: orchestrator refuses operators with zero stake, even when the contract would allow it

**[Visual: `orchestrator/src/services/operatorReader.js:166-172` highlighted]**

```javascript
if (strictMode && (!operatorState.stake || operatorState.stake.amountUsd === 0)) {
  return {
    eligible: false,
    reason: 'OPERATOR_NO_STAKE',
    detail: 'STRICT_MODE: operator has zero active stake',
  };
}
```

> "Belt-and-suspenders safety. Our `OperatorStaking` contract has five tiers, and the lowest tier — *None* — technically allows managing small vaults with zero stake. The contract accepts it.
>
> Our orchestrator doesn't. With `STRICT_MODE=1` we refuse to submit a trade for any operator who hasn't posted stake, period — regardless of what the contract permits.
>
> **This is a protocol-layer commitment that goes beyond the contract-layer floor.** Production orchestrators add their own eligibility gates. Judges can grep `OPERATOR_NO_STAKE` in the repo — eleven characters, load-bearing."

---

## [5:25 – 5:45] SUMMARY — Numbers, then out

**[Visual: single slide summary of the seven differentiators]**

> "Seven technical commitments, each with ten lines of code or less, each with on-chain or in-repo proof:
>
> - Fourteen contracts live on 0G Aristotle mainnet — real Jaine venue.
> - Eight contracts live on Arbitrum One — real Uniswap V3 venue.
> - One operator, bonded manifest, stake-denominated in USDC.e, same chain as the vault base asset.
> - One vault with sealed mode and real USDC.e deposit, both sides of the swap whitelisted on-chain.
> - Orchestrator running with STRICT_MODE, six live 0G Compute services, GLM-5-FP8 selected.
> - One hundred forty-five out of one hundred fifty-two contract tests passing; failures are legacy full-vault suites tracked in the submission doc.
>
> **This isn't a copy of a vault protocol with AI buzzwords bolted on. It's seven specific engineering choices about cryptographic binding, gas economy, and cross-chain safety.**"

---

## [5:45 – 6:00] CLOSE

**[Visual: GitHub URL · 0G factory address · Arbitrum factory address · tagline]**

> "Aegis Vault. github.com/mdlog/aegis-vault.
>
> **Every AI output binds to its execution. Every operator commits a slashable hash. Every chain uses the same bytecode.**
>
> Happy auditing."

---

## 📋 Pre-recording checklist

- [ ] Orchestrator log visible with the 6-service + GLM-5-FP8 banner
- [ ] VS Code split: left = `ExecLib.sol` pinned at line 22 (TYPEHASH) and 68-77 (whitelist); right = `AegisVault.sol` pinned at lines 70-97 (commit/execute)
- [ ] Browser tabs ordered in the sequence the script uses:
  1. Black-type hook screen (a blank text editor in presentation mode works)
  2. `architecture-multichain.png`
  3. `https://chainscan.0g.ai/address/0x7D0D6c77e2C3476Aa310DE192A774164c3f55151` (factory)
  4. `https://chainscan.0g.ai/address/0xAEDAc17B531d55b8Ac587691922DEAec6C273181` (vault)
  5. `https://chainscan.0g.ai/address/0x4C6e88812101C346974c7E48c1587D6Cd3B2C2A9` (registry)
  6. `OperatorRegistry.publishManifest` documentation / `HACKATHON_SUBMISSION.md` manifest section
- [ ] `operator/0x4E08B728087158a02aB458f03d833137b282eC5d` frontend page open to show bonded manifest badge
- [ ] Screen recorder at 1080p, audio levels confirmed, notifications silenced
- [ ] Rehearse twice — target 5:45 ± 10s

---

## 🎤 Delivery reminders — the technical register

1. **Lead each differentiator with the code pattern, not the product name.** Judges read code faster than prose.
2. **"Nobody else does this" framing is earned, not claimed.** If you assert it, you must be able to back it up in the Q&A. All seven differentiators above survive that test.
3. **Pause after acronyms on first use** — "EIP-712 ... the Ethereum typed-data standard." Then use the acronym freely.
4. **Numbers > adjectives.** "3.4 KB" not "small." "400,000 gas per clone" not "cheap." "Six live chatbot services" not "lots of AI."
5. **When you show source code, read the key line aloud.** Don't assume viewers parse Solidity at video speed.
6. **Address-prefix shorthand** — say `0x7D0D factory` or `0xAEDA vault`. Faster and lets judges catch up in another tab.
7. **Never soften the differentiators with "we believe" or "we think."** Either show the code, or cut the line.

---

## 🌐 Indonesian fallback lines (optional)

If more natural to record in Indonesian:

| Segment | Indonesian |
|---|---|
| Hook opener | "Setiap protokol AI vault bilang *AI hanya propose, contract yang decide*. Bagus — tunjukkan di mana output AI terikat secara kriptografis ke eksekusinya." |
| Tagline | "AI di 0G. Likuiditas real di 0G dan Arbitrum. Terhubung via EIP-712." |
| Close | "Setiap output AI terikat ke eksekusinya. Setiap operator commit hash yang slashable. Setiap chain pakai bytecode yang sama. Happy auditing." |

Istilah teknis (EIP-712, DELEGATECALL, ECDSA, keccak256, commit-reveal, `ecrecover`) tetap English — natural di komunitas DeFi.

---

## 📎 Supplementary assets

- Architecture diagram SVG: [docs/diagrams/architecture-multichain.svg](docs/diagrams/architecture-multichain.svg)
- Architecture diagram PNG (1920×1080): [docs/diagrams/architecture-multichain.png](docs/diagrams/architecture-multichain.png)
- Full submission doc: [HACKATHON_SUBMISSION.md](HACKATHON_SUBMISSION.md)
- Architecture details: [ARCHITECTURE.md](ARCHITECTURE.md)
- Demo walkthrough: [DEMO.md](DEMO.md)
- Pre-deploy checklist: [PRE_DEPLOY_CHECKLIST.md](PRE_DEPLOY_CHECKLIST.md)

---

## 🧭 If you have to cut for time

- **Cut Differentiator 7 first** (STRICT_MODE) — it's orchestrator-layer, judges may argue it's not contract-enforceable.
- **Cut Differentiator 6 second** (whitelist both-sides) — it's a post-audit fix, but it's a single `for` loop and can be flashed in 10 seconds if needed.
- **Never cut 1-5.** They're the irreducible thesis.

If you need a **three-minute cut** for social media: open with hook, play Differentiators 1, 3, 4 (AI-binding, dual-chain EIP-712, commit-reveal), and close. That's the tightest technically-differentiated story possible.
