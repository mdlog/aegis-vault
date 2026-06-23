# Aegis Vault — Pitch Video Script (V4 Mainnet, English)

**Target duration:** 4:30 – 5:00
**Application status (as of 2026-05-16):** V4 live on 0G Aristotle Mainnet + Arbitrum One. 285 tests passing. Slither `fail-on: high` in CI. Marketplace fresh (Registry / Staking / Reputation / Insurance) governance-bound to `AegisGovernor` multisig.
**Target audience:** technical hackathon judges — differentiation through *cryptographic binding*, not marketing.
**Language:** English. Cite full Solidity identifiers verbatim — judges read code faster than prose.

---

## [0:00 – 0:25] HOOK — The problem in one line

**[Visual: black screen, white type fades in one line at a time]**

> "Every AI-trading protocol says the same sentence:
> *'The AI only proposes, the contract decides.'*
>
> I have one question:
> **show me where the AI output is cryptographically bound to the on-chain execution.**
>
> We did it. The field is in our EIP-712 struct.
> Eight engineering decisions follow from that one requirement."

**[Visual: dissolve into Aegis Vault logo + tagline]**

> Aegis Vault — *verifiable-AI risk manager with on-chain execution guardrails.*
> Live on 0G Aristotle Mainnet. Identical mirror on Arbitrum One.

---

## [0:25 – 0:55] WHAT IT IS — A non-custodial vault in three layers

**[Visual: three-layer diagram — Depositor → Vault Policy → AI Operator]**

> "Aegis Vault is a non-custodial vault. Three layers:
>
> **One** — depositor stakes USDC, picks an AI operator from the marketplace, receives shares.
>
> **Two** — the vault holds a *policy*: position size, slippage, asset whitelist, cooldown, fee caps, intent expiry, and — new in V4 — the `acceptedManifestHash` of the operator's strategy. Policy is committed at vault creation and **immutable**.
>
> **Three** — the AI operator runs inference on 0G Compute (GLM-5-FP8), produces a trade intent, signs it with a TEE-attested signer, submits it to the vault.
>
> The AI has **zero authority**. It only proposes. The vault decides whether to execute or revert."

---

## [0:55 – 1:45] BINDING — The AI output hash is baked INTO the EIP-712 intent

**[Visual: `contracts/contracts/libraries/ExecLib.sol` — `EXECUTION_INTENT_TYPEHASH` highlighted]**

```solidity
bytes32 internal constant EXECUTION_INTENT_TYPEHASH = keccak256(
  "ExecutionIntent(address vault,address assetIn,address assetOut,"
  "uint256 amountIn,uint256 minAmountOut,uint256 createdAt,uint256 expiresAt,"
  "uint256 confidenceBps,uint256 riskScoreBps,bytes32 attestationReportHash)"
);
```

> "Look at the last field — `attestationReportHash`. A `bytes32` we compute off-chain as `keccak256(provider, chatId, model, contentDigest)` — the cryptographic fingerprint of the 0G Compute inference response.
>
> That field is part of the **EIP-712 typehash itself**. If the AI response changes by one byte, the attestation hash changes, the intent hash changes, `ecrecover` returns a different signer — and `policy.attestedSigner` rejects. Revert.
>
> Other protocols treat 'AI' as an opaque off-chain step. They can't prove which model produced which decision. **Our struct demands the proof**, and `ecrecover` enforces it."

---

## [1:45 – 2:30] V4 — Strategy manifest binding (the headline feature of this release)

**[Visual: split — left: factory `create` call; right: `executeIntent` checking `intent.strategyHash`]**

> "What's new in V4: every vault clone *commits* an `acceptedManifestHash` at create time. That hash is `keccak256` of the operator's strategy JSON — allowed assets, max position, cooldown, risk parameters.
>
> The operator publishes that manifest to IPFS or GitHub; the hash lives on-chain in `OperatorRegistry`. At execution, `executeIntent` requires `intent.strategyHash` to equal the vault's `acceptedManifestHash`. Mismatch — revert.
>
> The consequence: an operator **cannot silently switch strategy** after depositors are in. The EIP-712 typehash now includes `strategyHash` + `strategySchemaVer`, so cross-version replay is **mathematically impossible**.
>
> And: if an operator's execution history diverges from the committed manifest, `AegisGovernor` — a multisig — can slash their stake through `OperatorStaking`."

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

> "MEV bots watch the mempool. Broadcast an open intent, a searcher front-runs, price moves, you fill at a worse rate.
>
> Sealed mode closes that with a two-step. Block N: `commitIntent(hash)` — the hash is opaque, nobody knows the trade. Block N+1 or later: `executeIntent` — the intent reveals, the signature is `ecrecover`'d against `policy.attestedSigner`, the swap executes atomically.
>
> Our first sealed-mode reveal is proven on-chain — tx `0x0d7334b8…` on 0G Aristotle, April 27, 2026."

---

## [3:10 – 3:45] PROOF — What's on-chain and what passed audit

**[Visual: split terminal — `npm run test:all` summary 285/285 · Slither badge · explorer link]**

> "Before the V4 cutover we surfaced **127 audit findings**. **Eleven of those were High severity** — all landed before V4 bytecode shipped to mainnet.
>
> CI runs Slither with `fail-on: high` on every `contracts/` change. No PR merges with an active High.
>
> **285 contract tests passing** — including the V4 strategy-binding suite, the ExecutionRegistry audit suite, and the KillCritic fixes suite.
>
> On-chain proof:
> - First AI→policy→DEX execution: tx `0x7efe51ac…` (2026-04-24).
> - First sealed-mode reveal: tx `0x0d7334b8…` (2026-04-27).
> - V4 entry point: factory `0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F`.
>
> All auditable directly at `chainscan.0g.ai`."

---

## [3:45 – 4:15] MARKETPLACE — Fresh, governance-bound from t=0

**[Visual: marketplace diagram — Registry · Staking · Reputation · Insurance · all arrows → AegisGovernor multisig]**

> "The V4 marketplace was redeployed fresh — 0 vaults, 0 operators, 0 claims at launch. No carry-over state from V3.
>
> Four contracts: `OperatorRegistry`, `OperatorStaking`, `OperatorReputation`, `InsurancePool`. Admin and arbitrator on all four are set to **AegisGovernor** — an M-of-N multisig. Not to the deployer EOA.
>
> The implication: slash, treasury spend, operator listing — every privileged action requires multisig approval. No single key can drain the insurance pool or confiscate stake. That's a governance commitment you can read on-chain, not a promise in the docs."

---

## [4:15 – 4:40] TWO CHAINS, ONE BYTECODE — No bridge

**[Visual: chain split — 0G Aristotle (Jaine V3 venue) vs Arbitrum One (Uniswap V3 venue), single vault implementation centered between them]**

> "The same vault runs on 0G Aristotle and Arbitrum One. Bytecode identical. **No bridge.**
>
> Cross-chain safety is free from the standard: the EIP-712 domain separator includes `block.chainid`. An intent signed for chain 16661 **mathematically cannot** be valid on chain 42161 — different domain hash, different intent hash, `ecrecover` produces a different signer, the vault reverts.
>
> Audit once, deploy to any chain — four minutes of gas and one factory transaction."

---

## [4:40 – 5:00] CLOSE

**[Visual: full-frame — logo + URL + entry-point address]**

> "Aegis Vault. Live at **aegisvaults.xyz**.
> V4 entry on 0G: `0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F`.
> Source at `github.com/mdlog`.
>
> **Every AI output is bound to its execution. Every operator commits a slashable strategy hash. Every chain runs the same bytecode.**
>
> Happy auditing."

**[Visual: hold logo 2 seconds, fade out]**

---

## Pre-recording checklist

- [ ] Orchestrator log visible — GLM-5-FP8 + 0G Compute banner showing
- [ ] VS Code split:
  - Left: `contracts/contracts/libraries/ExecLib.sol` pinned at `EXECUTION_INTENT_TYPEHASH`
  - Right: `contracts/contracts/AegisVault.sol` near `commitIntent` / `executeIntent`
- [ ] Browser tabs (in the order the script uses them):
  1. Black-type hook screen (a text editor in presentation mode works)
  2. Three-layer Aegis diagram (slide / `docs/diagrams/*`)
  3. [chainscan.0g.ai/address/0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F](https://chainscan.0g.ai/address/0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F) — V4 factory
  4. [chainscan.0g.ai/address/0x28F8E1a9Af4eBF4Df323861F499B8d87295b72Ed](https://chainscan.0g.ai/address/0x28F8E1a9Af4eBF4Df323861F499B8d87295b72Ed) — V4 vault implementation
  5. [chainscan.0g.ai/address/0x023EC4a54435f94E9395460e4835e75E429D5A2e](https://chainscan.0g.ai/address/0x023EC4a54435f94E9395460e4835e75E429D5A2e) — AegisGovernor multisig
  6. [chainscan.0g.ai/tx/0x7efe51ac](https://chainscan.0g.ai/tx/0x7efe51ac) — first AI→DEX execution
  7. [chainscan.0g.ai/tx/0x0d7334b8](https://chainscan.0g.ai/tx/0x0d7334b8) — first sealed-mode reveal
  8. [aegisvaults.xyz](https://aegisvaults.xyz) — live frontend
- [ ] Separate terminal with `npm run test:all` summary `285 passing` ready to display
- [ ] OBS / screen recorder at 1080p, audio levels confirmed, notifications silenced
- [ ] Two rehearsal runs — target 4:45 ± 10s

---

## Delivery notes

1. **Lead each segment with the code pattern, not the product name.** Judges read Solidity faster than prose.
2. **Pause after acronyms on first use:** "EIP-712 — the Ethereum typed-data standard." After that, use the acronym freely.
3. **Numbers > adjectives:** "285 tests" not "lots of tests"; "11 High audit findings landed" not "thorough audit".
4. **Read the key line aloud when showing source code.** Don't assume viewers parse Solidity at video speed.
5. **Never soften with "we believe" or "we think".** If you can't point to code or an explorer — cut the line.
6. **Cite tx hashes by 8-char prefix only** (`0x7efe51ac`, `0x0d7334b8`) — gives judges a moment to open them in another tab.

---

## 90-second social cut

For Twitter/X or LinkedIn:

- 0:00–0:15 — Hook (the first sentence).
- 0:15–0:45 — BINDING section (typehash + `attestationReportHash`).
- 0:45–1:15 — V4 section (manifest binding) — *the headline*.
- 1:15–1:30 — Close + URL.

That's the densest technical story possible without losing the thesis.

---

## If you have to cut from the 5-minute version

- **First cut**: TWO CHAINS, ONE BYTECODE (4:15–4:40). Important, but the short version survives without it.
- **Second cut**: MARKETPLACE (3:45–4:15). Can be reduced to a text overlay footnote.
- **Never cut**: Hook · BINDING (typehash) · V4 manifest · PROOF on-chain. That's the irreducible thesis.

---

## Supporting files

- Indonesian version of this script: [PITCH_SCRIPT_V4_ID.md](PITCH_SCRIPT_V4_ID.md)
- V2-era reference script (longer, for evolution context): [PITCH_SCRIPT.md](PITCH_SCRIPT.md)
- Architecture detail: [ARCHITECTURE.md](ARCHITECTURE.md)
- Full address book: [CONTRACTS.md](CONTRACTS.md)
- Whitepaper: [WHITEPAPER.md](WHITEPAPER.md)
- Demo walkthrough: [DEMO.md](DEMO.md)
- TEE attestation walkthrough: [docs/TEE_ATTESTATION_VERIFICATION.md](docs/TEE_ATTESTATION_VERIFICATION.md)
