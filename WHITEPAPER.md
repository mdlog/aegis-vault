# Aegis Vault — Whitepaper

**AI-managed, risk-controlled trading vaults with contract-enforced guardrails and dual-chain real execution.**

*Version 1.4 · 2026-05-14 (V4 multi-strategy stack live on 0G mainnet: on-chain manifest binding, depositor-timelocked strategy upgrade, fresh operator marketplace redeployed alongside V4 for a clean t=0 cutover. V3 stack frozen on-chain for audit trail and historical reads only.)*

---

## Abstract

Aegis Vault is a non-custodial smart-contract trading vault protocol in which an AI agent proposes trades and the vault contract enforces its **trade-shape** policy on-chain — position size, asset whitelist, slippage floor, cooldown, confidence threshold, and daily action count — before any funds move. Users deposit capital, select an operator from an on-chain marketplace, and set per-vault risk parameters at creation. The AI agent has no authority to move funds outside the policy envelope — its role is reduced to producing an EIP-712 signed intent. A cryptographic hash of the AI response (`attestationReportHash`) is bound into the EIP-712 typehash and is therefore covered by the operator's signature; the vault verifies that signature against the approved `attestedSigner`. The drawdown-based limits (`maxDailyLossBps`, `stopLossBps`) are enforced **off-chain** by the orchestrator risk veto, with the owner's `pause()` as the on-chain backstop — see the policy enforcement table (§4) for the exact on-chain/off-chain split.

Aegis runs on two chains. 0G Aristotle Mainnet (chain 16661) serves as both the intelligence layer — with AI inference via 0G Compute, decision journaling via 0G Storage, and the full operator identity + staking + governance stack — and as a real execution venue through the Jaine DEX (a Uniswap V3 fork with approximately $1 million in pool TVL). Arbitrum One (chain 42161) provides a sibling execution layer with canonical USDC / WETH / WBTC via Uniswap V3. The two chains are not bridged. Cross-chain replay protection is secured entirely by the EIP-712 domain separator, which binds each intent to a specific `block.chainid`.

This whitepaper specifies the protocol's cryptographic bindings, policy-enforcement surface, operator economic model, governance mechanics, and explicit off-chain-vs-on-chain trust boundary.

---

## 1. Introduction

### 1.1 The AI vault trust problem

Users who want AI-managed on-chain trading today face a binary choice.

**Trustless DeFi vaults** — Set Protocol, Melon, and their successors — enforce policy with smart contracts and guarantee custody, but the strategies they execute are simple rebalances or copy-trades with no active alpha generation. Their risk model is transparent but their upside is limited to whatever the static strategy returns.

**Centralized AI trading bots** — a large class of off-chain agents, sometimes wrapped in a vault primitive — achieve real alpha by applying machine-learning models to market data. The trust model is correspondingly weaker: users surrender custody to an off-chain operator, whose inference, signing keys, and execution venues are opaque. When the operator misbehaves, the user has no on-chain recourse.

Aegis Vault takes a third path: **retain the non-custodial, contract-enforced trust model of DeFi, while letting AI inference drive execution — with every AI output cryptographically bound to an on-chain policy check.**

The design goal is that the AI's output becomes part of what the operator signs, so it cannot be swapped after the fact. Aegis encodes a hash of the AI response — `attestationReportHash` — as a field in the EIP-712 `ExecutionIntent` typehash. Because that field sits inside the signed structure, the operator cannot alter the claimed AI output without producing a different intent hash and therefore a different signature.

**What the vault verifies on-chain is the signature, not the inference.** It recovers the signer from the intent hash and requires it to equal the vault's approved `attestedSigner` (and, in sealed mode, that a matching commit was posted one block earlier). The vault does **not** parse a TEE/SGX/TDX quote, and there is **no enclave-measurement (`MRENCLAVE`) check in the contract** — so on-chain it cannot prove that the hash corresponds to a genuine 0G Compute inference. That correspondence is established **off-chain**: the orchestrator must verify the 0G Compute attestation (and, in a hardened deployment, the enclave measurement) *before* the `attestedSigner` key ever signs. On-chain trust therefore reduces to **custody of the `attestedSigner` key** — anyone holding it can mint valid intents within the policy caps — which is why that key must live in an HSM/enclave and is revocable via `setAttestedSigner`. The cryptographic binding guarantees the *signed* response hash is immutable and non-replayable across chains; it does not, by itself, prove that an enclave produced it.

### 1.2 Actors and contracts

- **User (depositor)** — creates a vault, chooses an operator, sets policy, deposits capital, retains withdrawal rights.
- **Operator** — registered on-chain in `OperatorRegistry`, has posted stake in `OperatorStaking`, has published a bonded strategy manifest (`keccak256` committed on-chain), runs an orchestrator process that produces EIP-712 intents.
- **Vault contract (`AegisVault`)** — per-user clone of a slim implementation via EIP-1167 minimal proxy. Enforces policy; holds capital.
- **Execution venue** — on 0G: Jaine DEX (Uniswap V3 fork). On Arbitrum: Uniswap V3 SwapRouter02. Accessed through adapter contracts.
- **Governance (`AegisGovernor`)** — M-of-N multisig. Slashes operators, manages protocol treasury, transitions admin roles from deployer.
- **0G Compute service** — provides AI inference (models including `zai-org/GLM-5-FP8`) via a service registry. Returns both a response and a verifiable attestation.

---

## 2. Protocol Architecture

### 2.1 Contract topology

The 0G mainnet deployment comprises sixteen live contracts — the V4 vault stack (AegisVault V4, AegisVaultFactory V4, ExecutionRegistry shared with V3) plus the freshly redeployed operator marketplace (OperatorRegistry, OperatorStaking_v2, OperatorReputation, InsurancePool_v2 — all rebased on 2026-05-14 alongside V4 for a clean t=0 cutover with all admin/arbitrator slots bound to AegisGovernor from genesis) plus shared infrastructure (governor, treasury, NAV calculator) plus venue adapters (JaineVenueAdapterV2 for in-chain swaps and KhalaniVenueAdapter for cross-chain routing) plus the V4 supporting libraries (ExecLibV4 / CrossChainLibV4) and the reused V3 libraries (IOLib / SealedLib). The retired V3, V2, and V1 vault stacks and the pre-fresh operator marketplace are no longer surfaced in the SDK address book; their addresses remain queryable on-chain for historical reads only. The Arbitrum mainnet deployment comprises eight contracts (V3/V4 not yet ported). All live addresses are enumerated in Section 9.

```
                    User
                     │
                     │ factory.createVault(...)  — EIP-1167 clone
                     ▼
┌───────────────────────────────────┐
│ AegisVaultFactory                 │
│ clones (vaultImplementation, ...) │
└───────────────────────────────────┘
                     │
                     ▼
┌───────────────────────────────────┐       delegatecall        ┌──────────────┐
│ AegisVault (slim, 3.4 KB)         ├──────────────────────────▶│ ExecLib      │
│ • owner                           │                           │ (3.5 KB)     │
│ • executor                        │                           │ EIP-712 hash │
│ • baseAsset, venue                │       delegatecall        │ policy check │
│ • policy (15 fields)              ├──────────────────────────▶│ swap pipeline│
│ • allowedAssets[]                 │                           └──────────────┘
│ • intentCommits mapping           │       delegatecall        ┌──────────────┐
└─────┬─────────────────────────────┘──────────────────────────▶│ SealedLib    │
      │                                                         │ (0.5 KB)     │
      │ calls                                                   │ ecrecover    │
      ▼                                                         │ attestation  │
┌───────────────────────────────────┐                           └──────────────┘
│ ExecutionRegistry                 │
│ intent-replay guard               │       delegatecall        ┌──────────────┐
│ execution history                 │───────────────────────────▶│ IOLib        │
└───────────────────────────────────┘                           │ (1.1 KB)     │
                                                                │ deposit /    │
                                                                │ withdraw     │
                                                                └──────────────┘
```

### 2.2 Slim vault via external libraries

The original `AegisVault` contract was 16 KB. 0G Aristotle Mainnet has a per-block gas limit approximately one-third of Ethereum mainnet's, making large contracts impossible to deploy. Aegis decomposes the vault into a slim 3.4 KB implementation plus three external libraries invoked via `DELEGATECALL`:

- **`ExecLib`** (3.5 KB) — EIP-712 typed-data hashing, policy checks, venue swap pipeline, `ExecutionRegistry` interactions. Called by `AegisVault.executeIntent`.
- **`SealedLib`** (0.5 KB) — TEE attestation ECDSA signature verification. Returns recovered signer address; `ExecLib` compares it against `policy.attestedSigner`.
- **`IOLib`** (1.1 KB) — deposit / withdraw paths with entry/exit fee accounting.

Because the library is invoked via `DELEGATECALL`, it shares the vault's storage, `msg.sender`, and `address(this)` context. The library is deployed once; every vault clone delegates into the same bytecode, amortizing deployment cost across all users.

### 2.3 EIP-1167 minimal proxy clones

Each user vault is an EIP-1167 minimal proxy — a deterministic 45-byte clone whose runtime code is a static delegatecall dispatcher to `vaultImplementation`. A clone deploys for approximately 400,000 gas, versus 2.7 million gas for a fresh `AegisVault` deployment. This makes per-user vaults economically viable even on chains with moderate gas prices.

### 2.4 Dual-chain architecture without a bridge

Aegis does not use a cross-chain messaging protocol. Cross-chain replay protection is handled entirely by the EIP-712 standard's domain separator, which includes `block.chainid`:

```solidity
function _domainSeparator() private view returns (bytes32) {
    return keccak256(abi.encode(
        DOMAIN_TYPE_HASH,
        NAME_HASH,       // keccak256("AegisVault")
        VERSION_HASH,    // keccak256("1")
        block.chainid,   // ← cross-chain safety
        address(this)    // ← per-vault binding
    ));
}
```

An intent signed with a domain separator for chain 42161 (Arbitrum) produces a different EIP-712 hash from one signed for chain 16661 (0G). When a vault on chain 16661 calls `ecrecover` on an intent signed for chain 42161, it recovers a different address, which will not match `policy.attestedSigner`, and the transaction reverts. No bridge contract, no message relayer, no off-chain oracle. The only assumption is that the EIP-712 standard is implemented correctly — which every major Solidity toolchain has enforced since 2018.

Consequently, the exact same compiled bytecode runs on both chains. Aegis can be deployed to any EVM chain in under five minutes, with no bytecode changes, and inherit cross-chain replay protection for free.

---

## 3. Intent Lifecycle

An execution proceeds in eight steps, alternating between off-chain inference and on-chain enforcement.

### Step 1 — Market data fetch

The orchestrator pulls current prices from Pyth on-chain and from CoinGecko. In `STRICT_MODE`, a fetch failure aborts the cycle rather than falling back to stale or hardcoded data.

### Step 2 — AI inference (0G Compute)

The orchestrator calls a 0G Compute chatbot service (e.g., `zai-org/GLM-5-FP8`) with a structured prompt containing the vault's current state, recent market snapshot, and the operator's policy constraints. The service returns a structured response `{action, asset, confidence, risk_score, reason}`.

### Step 3 — Attestation hash construction

The orchestrator computes:
```
attestationReportHash = keccak256(provider, chatId, model, contentDigest)
```
This hash uniquely identifies the AI response. `provider` is the 0G Compute provider address, `chatId` is the service's session identifier, `model` is the model name, and `contentDigest` is the `keccak256` of the raw response content.

### Step 4 — Intent construction and signing

The orchestrator builds an `ExecutionIntent` struct containing the target vault address, `assetIn`, `assetOut`, `amountIn`, `minAmountOut`, timestamps, `confidenceBps`, `riskScoreBps`, and `attestationReportHash`. It computes the EIP-712 intent hash using the vault's domain separator and the `EXECUTION_INTENT_TYPEHASH`. The TEE signer key signs the hash.

### Step 5 — Decision journaling

The orchestrator appends a journal entry to local storage (with optional 0G Storage propagation) recording the market snapshot, AI output, intent hash, and signature. The **authoritative** audit trail is on-chain — the EIP-712 intent hash, the `attestationReportHash`, and (in sealed mode) the commit-reveal record are emitted by the vault and can be replayed from chain events. The local journal is a non-authoritative convenience mirror (lossy by design — recent entries only); it is not required to verify what executed.

### Step 6 — Commit (sealed mode only)

For sealed-mode vaults, the orchestrator first calls:
```solidity
vault.commitIntent(bytes32 commitHash)
```
where `commitHash = keccak256(intentHash, attestationReportHash)`. The vault stores `block.number` against `commitHash`. Nobody else knows what the intent is — only its opaque commitment. MEV searchers cannot front-run.

### Step 7 — Execute

At least one block later:
```solidity
vault.executeIntent(ExecutionIntent intent, bytes signature)
```
The vault's `executeIntent` function, through `ExecLib.runExecution` and `SealedLib.verifyAttestation`, performs:

1. EIP-712 intent hash recomputation and match against `intent.intentHash`.
2. `ecrecover(intentHash, signature)` against `policy.attestedSigner` — reverts if the signer does not match.
3. For sealed mode: recompute `commitHash = keccak256(intentHash, attestationReportHash)`; verify `intentCommits[commitHash]` is nonzero and `block.number >= commitBlock + 1`. Delete the commit.
4. Policy checks (Section 4).
5. Asset whitelist check: both `intent.assetIn` and `intent.assetOut` must appear in `vault._allowedAssets`, or revert.
6. Call `venue.swap(tokenIn, tokenOut, amountIn, minAmountOut)`. The swap is atomic — if the venue reverts, the whole transaction reverts and funds never leave the vault.
7. Register the intent and final amounts in `ExecutionRegistry` for replay protection and historical auditing.

### Step 8 — Post-execution journaling

The orchestrator records the transaction hash, actual `amountOut`, and venue fill price in its journal. It also writes to `OperatorReputation` if it holds the recorder role, updating the operator's on-chain performance metrics.

---

## 4. Policy Enforcement

### 4.1 Policy structure

Every vault's `policy` is a 15-field struct set at creation and partially mutable:

| Field | Type | Contract-enforced | Notes |
|---|---|---|---|
| `maxPositionBps` | `uint256` | Off-chain | Orchestrator rejects intents that exceed |
| `maxDailyLossBps` | `uint256` | Off-chain | Orchestrator tracks daily PnL |
| `stopLossBps` | `uint256` | Off-chain | Orchestrator evaluates per-position |
| `cooldownSeconds` | `uint256` | **On-chain** | `ExecLib` checks `block.timestamp >= lastExec + cooldown` |
| `confidenceThresholdBps` | `uint256` | **On-chain** | `require(intent.confidenceBps >= threshold)` |
| `maxActionsPerDay` | `uint256` | **On-chain** | Daily counter reset via rolling timestamp window |
| `autoExecution` | `bool` | **On-chain** | If false, `executeIntent` reverts — manual approval mode |
| `paused` | `bool` | **On-chain** | Guard at entry of `deposit`, `withdraw`, `executeIntent` |
| `performanceFeeBps` | `uint256` | On-chain via cap | Max 30% (3000 bps) enforced at initialize |
| `managementFeeBps` | `uint256` | On-chain via cap | Max 5% (500 bps) |
| `entryFeeBps` | `uint256` | On-chain via cap | Max 2% (200 bps) |
| `exitFeeBps` | `uint256` | On-chain via cap | Max 2% (200 bps) |
| `feeRecipient` | `address` | **On-chain** | Set at initialize |
| `sealedMode` | `bool` | **On-chain** | Gates commit-reveal and attestation check |
| `attestedSigner` | `address` | **On-chain** | The ECDSA signer address required in sealed mode |

Eleven of fifteen fields are enforced at the contract layer. The four size-based risk limits (`maxPositionBps`, `maxDailyLossBps`, `stopLossBps`, and an implied `minTradeBps`) are currently enforced by the orchestrator as pre-submission validation. Moving these to contract-level enforcement is tracked as roadmap, prioritized for Arbitrum first where gas budget is plentiful.

### 4.2 Asset whitelist (both sides)

After a third-party audit flagged that earlier builds allowed the orchestrator to swap *into* any token not in the vault's allowed list, Aegis added a strict both-sides whitelist check:

```solidity
// ExecLib.sol, runExecution():
bool inOk;
bool outOk;
for (uint256 i = 0; i < allowedAssets.length; i++) {
    if (allowedAssets[i] == intent.assetIn)  inOk  = true;
    if (allowedAssets[i] == intent.assetOut) outOk = true;
}
require(inOk,  "assetIn!wl");
require(outOk, "assetOut!wl");
```

The `allowedAssets` array is set once at vault initialization and is immutable for the life of the vault. An adversarial AI cannot convince the vault to accept an arbitrary output token. The check closes the window in which intermediate token balances could include tokens with hostile transfer hooks (for example, ERC-777 reentrancy vectors).

### 4.3 Replay protection

Every intent hash is registered in `ExecutionRegistry` before swap execution and finalized afterward. Submitting the same intent hash twice reverts. The combination of per-vault, per-chain, per-intent uniqueness in the EIP-712 domain + `ExecutionRegistry` gate makes replay attacks cryptographically impossible without collision of `keccak256`.

---

## 5. Operator Economics

### 5.1 Registration

An operator registers in `OperatorRegistry` by submitting their wallet, display metadata, recommended vault policy, and fee schedule. The wallet becomes their on-chain identity. Registration is a single transaction; post-registration, the operator can declare their AI model and publish a strategy manifest (Section 5.3).

### 5.2 Stake token and tiers

Operator stake is denominated in the same asset as the vault base asset — USDC.e on 0G, canonical USDC on Arbitrum. This deliberately avoids the token-price-volatility games that occur when operator stake is denominated in a protocol's native token (if the native token drops 90%, operator collateral effectively vanishes).

Five stake tiers determine which vault sizes an operator is eligible to manage:

| Tier | Minimum stake (USDC) | Vault size cap (USDC) |
|---|---|---|
| None | 0 | 5,000 |
| Bronze | 1,000 | 50,000 |
| Silver | 10,000 | 500,000 |
| Gold | 100,000 | 5,000,000 |
| Platinum | 1,000,000 | unlimited |

### 5.3 Bonded strategy manifests

An operator publishes a strategy manifest via:

```solidity
OperatorRegistry.publishManifest(
    string memory uri,      // points to JSON, e.g. IPFS or GitHub raw
    bytes32 manifestHash,   // keccak256 of the JSON
    bool bonded             // true = slashable on deviation
)
```

The `manifestHash` is an on-chain commitment to the strategy. If `bonded` is true, governance can slash the operator's stake if future executions deviate from what the manifest committed (for example, trading assets not in the declared allowed list). Users can audit the committed hash against the published JSON at any time.

### 5.4 Slashing

`OperatorStaking.slash(operator, amount)` is callable only by the governor. Two caps bound the attack surface:

- **Per-action cap** — no single `slash` call may take more than 50% (`MAX_SLASH_BPS = 5000`) of the operator's total slashable stake.
- **Per-window cap** — cumulative slashing within a rolling `SLASH_WINDOW` may not exceed 50% of the stake at the start of the window.

These caps prevent a compromised or malicious governor from draining an operator's collateral in one transaction, and constrain the rate at which slashing can occur even across multiple transactions.

### 5.5 Unstake cooldown

An operator who requests unstake enters a 14-day cooldown. **During the cooldown, the pending stake remains slashable**. This prevents an operator from rug-pulling their collateral immediately after a policy violation but before governance can react.

### 5.6 Reputation

`OperatorReputation` records per-operator execution statistics: total executions, success rate, cumulative PnL, average confidence. When a vault (or an authorized recorder, e.g., the orchestrator) reports an execution result, the operator's public reputation metrics update. This is the primary signal users consume when selecting an operator from the marketplace.

### 5.7 STRICT_MODE orchestrator eligibility

In addition to the contract-level tier check, the Aegis orchestrator enforces a protocol-layer commitment: in `STRICT_MODE`, operators with zero active stake are rejected regardless of which tier their zero stake would technically allow. The check lives in `operatorReader.js`:

```javascript
if (strictMode && (!operatorState.stake || operatorState.stake.amountUsd === 0)) {
    return { eligible: false, reason: 'OPERATOR_NO_STAKE', ... };
}
```

This is a belt-and-suspenders check. The contract permits zero-stake operators to manage small vaults, but production orchestrators refuse to execute trades for them. Users who run a less-strict orchestrator can opt out of this additional layer, but the default posture is explicit skin-in-the-game.

---

## 6. Governance

`AegisGovernor` is an M-of-N multisig. At deployment time, the owners and threshold are set by the deployer. The governor has authority over:

- Slashing operators via `OperatorStaking.slash`
- Adjusting insurance pool admin and notifier
- Blacklisting operators in `OperatorRegistry`
- Spending from `ProtocolTreasury`
- Transitioning admin roles from the deployer (one-time, via `TRANSFER_ADMINS=1` flag at deploy time)

Governor signatures are ECDSA, collected off-chain and aggregated in a single on-chain `execute(target, data, signatures[])` call. No one signer can act unilaterally.

Fresh deployments bootstrap with a 1-of-1 governor where the signer is the deployer, with the expectation of rotation to a real multisig within the first week of live operation. The orchestrator logs a loud warning at startup if `TRANSFER_ADMINS` has not been executed.

---

## 7. Fee Model

### 7.1 Fee types

- **Performance fee** (max 30%) — percentage of realized profit above the high-water mark. Accrues per execution.
- **Management fee** (max 5%/year) — flat annual fee on assets under management. Accrues continuously.
- **Entry fee** (max 2%) — one-time fee on deposit.
- **Exit fee** (max 2%) — one-time fee on withdraw.

All caps are enforced at `AegisVault.initialize` — a vault cannot be created with out-of-range fees.

### 7.2 Protocol split

Of every fee dollar an operator earns, **80% goes to the operator** and **20% goes to `ProtocolTreasury`**. The protocol cut is intended to fund audits, bug bounties, grants, and — at governance discretion — insurance-pool seeding. There is **no enforced, automatic routing** from the treasury to the insurance pool today: `ProtocolTreasury.spend()` is discretionary. The split is hard-coded (`PROTOCOL_FEE_CUT_BPS = 2000`). Note: this 20% cut is currently collected on **entry/exit fees only** — performance/management-fee accrual is not yet shipped on the live vaults.

### 7.3 High-water mark

Performance fees are HWM-protected: the operator only earns performance fee on profit above the vault's previous all-time high. This prevents the operator from double-charging on losses-then-recoveries. HWM logic lives in `IOLib`.

### 7.4 Fee change cooldown

Fee changes require a 7-day cooldown (`queueFeeChange` → wait 7 days → `applyFeeChange`). This prevents an operator from sneak-raising fees on a user mid-vault without giving the user time to withdraw at the old terms.

---

## 8. Security Model

### 8.1 Trust boundary

| Actor | Trusted to |
|---|---|
| User | Set policy honestly at vault creation. Retain withdrawal rights. |
| Operator | Produce EIP-712-signed intents from real AI output. Post truthful manifests. |
| Orchestrator | Run in STRICT_MODE. Refuse to submit intents that violate off-chain policy constraints. |
| Governor | Slash only in verified violations. Spend treasury only via multisig quorum. |
| AI provider (0G Compute) | Deliver deterministic model output for a given input and session. |
| 0G Chain validators | Order transactions honestly; finalize blocks. |
| EIP-712 standard | Correctly implement typed-data hashing and ECDSA. |

The user does not need to trust the operator beyond "will run the strategy their manifest committed to." They do not need to trust the AI provider beyond "will not change the model between sessions without updating the attestation." They do not need to trust the orchestrator beyond "will compute hashes correctly." All of the above are verifiable post-hoc via on-chain records.

### 8.2 Attack vectors and mitigations

- **Malicious operator** — posts manifest claiming strategy X, executes strategy Y. Mitigated by bonded manifest + governance slashing + on-chain reputation signal.
- **Compromised orchestrator hot wallet** — executor key stolen. Mitigated by sealed-mode: attacker can submit any intent, but the TEE signer key is a separate address, and the vault verifies against `attestedSigner`. In non-sealed mode, the attacker can indeed trade; users should only use non-sealed mode for trusted executors.
- **MEV front-running** — searcher observes intent in mempool. Mitigated by commit-reveal: commit the opaque hash at block N, reveal + execute at block N+1, atomic swap prevents fill/sandwich timing attacks.
- **Oracle manipulation** — stale or manipulated price causes bad `minAmountOut`. Mitigated by Pyth freshness checks in `VaultNAVCalculator` and by the adapter's own `getAmountOut` quote as secondary check.
- **Reentrancy** — venue adapter calls back into vault during swap. Mitigated by `nonReentrant` on adapter + vault's explicit token-balance delta check post-swap.
- **Replay across chains or vaults** — same signature accepted elsewhere. Mitigated by EIP-712 domain separator (chainId + vault address) + `ExecutionRegistry` single-use intent hash.
- **Admin-role rug** — deployer who never calls `TRANSFER_ADMINS` has unchecked power. Mitigated by orchestrator loud warning + public roadmap commitment. Users are urged to only deposit into vaults whose factory admin is a governor, not a deployer EOA.

### 8.3 Cryptographic primitives used

- `keccak256` (EVM built-in) — all intent and manifest hashes.
- ECDSA `ecrecover` (EVM precompile at `0x01`) — attestation signature verification in `SealedLib`.
- EIP-712 typed-data encoding — all signed messages. Domain includes chain ID and vault address.

---

## 9. Deployed Instances

### 9.1 0G Aristotle Mainnet (chain 16661) — V4 stack live since 2026-05-14 (canonical for new vaults)

V4 went live on **2026-05-14** following a pre-V4 line-by-line audit (127 findings surfaced, 11 Highs landed) + final regression review catch (Critical CrossChainLibV4 link fix); 285 contract tests pass post-patch. V4 adds operator strategy-manifest binding — every clone commits an `acceptedManifestHash` at create time, and `executeIntent` reverts unless `intent.strategyHash` matches. The four marketplace contracts (`OperatorRegistry`, `OperatorStaking_v2`, `OperatorReputation`, `InsurancePool_v2`) were redeployed fresh in the same window for a clean cutover (0 vaults, 0 operators at t=0) with all four arbitrator/admin slots bound to `AegisGovernor` from t=0 — closing audit H-6 / H-7 / H-9.

| Contract | Address |
|---|---|
| **AegisVaultFactoryV4** | `0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F` |
| AegisVault_v4 impl (init-locked) | `0x28F8E1a9Af4eBF4Df323861F499B8d87295b72Ed` |
| ExecutionRegistry | `0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9` |
| **KhalaniVenueAdapter** (cross-chain route registry) | `0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4` |
| JaineVenueAdapterV2 (multi-hop, post-audit) | `0xA4E2aeB9e1a5297DE38d7Ad8e11b1714ca481F2f` |
| ExecLibV4 (V4 typehash binds strategyHash + schemaVer) | `0x3080424E4d8E9CEde828151d85D526374e176108` |
| CrossChainLibV4 (V4 cross-chain typehash) | `0x049DF2321DD1D409799139b5A5b475d2E8a8B536` |
| IOLib (reused from V3) | `0x49b201603ae393054eF9377f456eDDc827748f37` |
| SealedLib (reused from V3) | `0x9dD28eE7d9B7D3e913D23dD1Fc3f4FB36b0F9063` |
| OperatorRegistry (fresh) | `0x8A12238E20e9CE5D8Ea350E58B7d03D0551CA22b` |
| OperatorStaking_v2 (fresh, stake = USDC.e) | `0xF46b6b76c5021a21dc0029FDEAEba6713472CBE6` |
| OperatorReputation (fresh, admin = AegisGovernor) | `0x4389d082dE464defF665612A73f36b99059F2Da4` |
| AegisGovernor (multisig) | `0x023EC4a54435f94E9395460e4835e75E429D5A2e` |
| InsurancePool_v2 (fresh, arbitrator = AegisGovernor) | `0xe69eAff976b6AEf35556cb3D09972E401a85DD77` |
| ProtocolTreasury | `0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4` |
| VaultNAVCalculator (Pyth-backed, post-audit: expo guard + removeAssetAt + immutable pyth) | `0xFA632b02dFe6770E0B147659fD336980E138bA3a` |

Retired V3 stack remains on-chain for audit trail (`AegisVaultFactoryV3` `0x75668Ca9…`, `AegisVault_v3` impl `0x0c782575…`, ExecLib `0x48594040…`, CrossChainLib `0x505C1C76…`, pre-audit Jaine adapter `0x26124401…`, pre-audit NAV `0xBd21bfd6…`, and the pre-fresh marketplace quartet). Cross-version replay between V3 and V4 is impossible by construction: the V4 EIP-712 typehashes append `strategyHash` + `strategySchemaVer`, so the digest differs and `ecrecover` returns a different signer.

Canonical Jaine-pair tokens (verified via pool swap events):

| Symbol | Address | Decimals |
|---|---|---|
| USDC.e | `0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E` | 6 |
| WETH | `0x564770837Ef8bbF077cFe54E5f6106538c815B22` | 18 |
| WBTC | `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` | 8 |
| W0G | `0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c` | 18 |

Canonical Jaine infrastructure:

- SwapRouter: `0x8b598a7c136215a95ba0282b4d832b9f9801f2e2`
- Factory: `0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4`
- Pyth oracle: `0x2880ab155794e7179c9ee2e38200202908c17b43`

### 9.2 Arbitrum One (chain 42161)

| Contract | Address |
|---|---|
| AegisVaultFactory | `0x49354460eAdE1C2E786E36B3B3e7A18Fb4283C45` |
| AegisVault (implementation) | `0x9047E26eE93F68732eF614D0636b15bD493A3d0b` |
| ExecutionRegistry | `0x43CAEB5209C0Bd7c3c748219361f884B660B08D6` |
| UniswapV3VenueAdapter | `0xB3f6611Dd1d76d20d3BF47C7173310F9e606FAb1` |
| VaultNAVCalculator | `0x0F8B269368925Fd55C62560B6f818173A8cB25eD` |

Canonical infrastructure:

- Uniswap V3 SwapRouter02: `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`
- Uniswap V3 Factory: `0x1F98431c8aD98523631AE4a59f267346ea31F984`
- Canonical USDC (Circle): `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
- Pyth oracle: `0xff1a0f4744e8582DF1aE09D5611b887B6a12925C`

### 9.3 Verified on-chain state

Post-deploy wiring verified by direct RPC calls:

- `registry.admin() == factory` ✓ (both chains)
- `factory.vaultImplementation() == impl` ✓
- `adapter.router()` points to canonical venue router ✓
- `staking.stakeToken() == USDC.e` on 0G ✓
- `nav.pyth()` points to canonical Pyth on both chains ✓

### 9.4 Historical artifact — first vault on the original V1 deployment

- Operator `0x4E08B728087158a02aB458f03d833137b282eC5d` — name "Aegis Alpha bot", balanced mandate, AI model `zai-org/GLM-5-FP8`, bonded manifest hash `0xef462f339acbb414...ba21c79e`. Re-registered against the fresh 2026-04-27 `OperatorRegistry`.
- Vault (legacy V1) `0xAEDAc17B531d55b8Ac587691922DEAec6C273181` — sealed mode enabled, 0.999 USDC.e deposited (after 0.1% entry fee), allowed assets = WBTC / WETH / USDC.e. Kept on-chain as historical reference for the original deploy. Vaults created from 2026-04-27 onward route through `AegisVaultFactory V3` (`0x75668Ca9...`) with the V3 multi-asset rescue surface (`withdrawToken`, `withdrawAllNonBase`), pause/unpause control, and the cross-chain fee cap (`setMaxCrossChainFeeBps`).

---

## 10. Roadmap and Explicit Limitations

The following are known gaps or roadmapped items, disclosed here so that judges and integrators can audit them independently rather than discover them.

- **`maxPositionBps`, `maxDailyLossBps`, `stopLossBps`** — currently orchestrator-enforced pre-submission. On-chain enforcement is the next contract-level hardening. It is blocked on integrating NAV oracle reads into every `executeIntent` call without exceeding the 0G per-block gas budget; likely lands on Arbitrum first.
- **0G Storage KV** — the public KV endpoints were unstable during the hackathon window. The orchestrator uses local JSON journal as a fallback. In `STRICT_MODE`, this fallback is permitted only when `OG_INDEXER_RPC` is explicitly set to empty (an opt-out acknowledgment by the operator); otherwise strict mode fails closed.
- **TEE hardware-grade attestation** — sealed mode currently binds AI inference to execution via ECDSA commitment + commit-reveal. Hardware-grade SGX / TDX attestation depends on 0G Compute provider hardware being exposed in the attestation envelope. The architecture is designed for that transition; the additional work is configuration rather than redesign.
- **Governance** — fresh deployments initialize with a 1-of-1 governor (the deployer). Rotating to a real multisig with external cosigners is a post-deploy operational step, not an automated part of the deployment script.
- **Fee accrual + HWM in the slim vault** — the V3 slim vault on 0G adds `pause` / `unpause` and the cross-chain fee cap (`setMaxCrossChainFeeBps`), but still does not expose `accrueFees`, `claimFees`, `queueFeeChange`, `applyFeeChange`, `setNavCalculator`, or `updatePolicy`; the Arbitrum slim vault is unchanged from the original deploy and exposes none of these. The frontend hooks for the unimplemented functions show a user-facing "not available in this build" toast. A full fee-bearing vault can be deployed on gas-plentiful chains (Arbitrum) in a follow-up release.
- **Multichain orchestrator** — the orchestrator currently runs in single-chain mode per process. Running parallel cycles across 0G and Arbitrum from a single process is a scaffolded but not activated feature (see `orchestrator/src/config/chains.js`).

### 10.1 V4 Multi-Strategy Architecture

V4 is a strict superset of V3 that closes the last off-chain trust assumption in the protocol: the operator's *strategy framework*. Today (V3) the orchestrator is a single binary, and operators differentiate themselves through governance-audited JSON manifests that the orchestrator loads at runtime. V4 binds the keccak256 of that manifest into each vault as `acceptedManifestHash`, and `executeIntent` reverts whenever the orchestrator submits an intent whose declared `strategyHash` does not match.

The full design — schema, mini-DSL, AI integration modes, hash binding, and migration model — is documented in [docs/MULTI_STRATEGY_RFC.md](docs/MULTI_STRATEGY_RFC.md). The user-facing migration walkthrough is in [docs/V4_MIGRATION_GUIDE.md](docs/V4_MIGRATION_GUIDE.md); the operator/protocol deployment runbook is in [docs/V4_DEPLOYMENT_PLAN.md](docs/V4_DEPLOYMENT_PLAN.md).

**V3 vs V4 in one table:**

| Concept                | V3                                                                                  | V4                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Strategy enforcement   | **Off-chain.** Operator's manifest is governance-audited and loaded by orchestrator. | **On-chain.** `intent.strategyHash == acceptedManifestHash`, enforced by `AegisVault_v4.executeIntent`. |
| Schema versioning      | Best-effort                                                                         | Vault enforces `1 ≤ strategySchemaVer ≤ MAX_SUPPORTED_SCHEMA_VER`                                 |
| Strategy upgrade flow  | Operator publishes; orchestrator picks up immediately                               | Two-step depositor-only timelock: `requestManifestUpgrade` → 24h → `applyManifestUpgrade`         |
| Provenance event       | None                                                                                | `StrategyApplied(bytes32 strategyHash, uint32 schemaVer)` per executed intent                     |
| Storage layout         | V3 slot map                                                                         | V3 slot map + appended V4 fields. V4 vaults are independent clones, not in-place upgrades.        |
| Migration              | n/a                                                                                 | Opt-in, per-vault. V3 stays operational indefinitely. See V4_MIGRATION_GUIDE.md.                  |

**Honest disclosure of what each version actually guarantees:**

- **V3 guarantees on-chain** that (a) every intent is signed by the AI signing key bound to the vault's `attestedSigner`, (b) the attestation report hash is committed before the intent executes (sealed mode), and (c) all policy thresholds — slippage, max position, daily limits, asset whitelist — are checked on-chain. It does **not** guarantee on-chain that the orchestrator computed the intent under any particular strategy. That assurance comes from the operator's stake-bonded governance commitment to a published manifest.
- **V4 adds the manifest binding to the on-chain enforcement set.** An orchestrator that deviates from the depositor-approved strategy cannot submit a valid intent — the `executeIntent` call reverts before any swap is attempted. Strategy changes still require depositor consent (only the `owner` can call `requestManifestUpgrade`), and the 24-hour timelock means a compromised operator cannot push and accept a malicious manifest in the same block.

V4 does **not** verify that the orchestrator's *implementation* of a given manifest is correct — only that the manifest the orchestrator claims to be using matches the one the depositor accepted. A manifest with subtle logic errors will still execute; the strategy hash binding only blocks deviation from a known-bad to a different (possibly worse) strategy without the depositor noticing.

**Non-coupling with V3.** V3 contracts are not upgraded. V4 ships as a fresh implementation + factory; the only shared state is the `ExecutionRegistry` replay guard. This was a deliberate constraint — EIP-1167 clones cannot grow their storage layout retroactively without breaking the existing slot map. The trade-off is that depositors who want V4's guarantees must opt in by withdrawing from V3 and creating a new V4 vault.

**Phase status (2026-05-15):** Phase 0–3 complete. V4 contracts went live on 0G Aristotle Mainnet on 2026-05-14 (factory + implementation + ExecLibV4 + CrossChainLibV4 addresses listed in Section 9.1). 285 contract tests pass post-patch (including the Critical CrossChainLibV4 link fix caught in the final regression review). The SDK address book defaults new vaults to V4; V3 vaults remain operational and are not force-migrated. Arbitrum V4 port is the next on the roadmap and is unblocked once gas-budget benchmarking is finalized.

---

## 11. References

- **EIP-712**: Typed structured data hashing and signing — [https://eips.ethereum.org/EIPS/eip-712](https://eips.ethereum.org/EIPS/eip-712)
- **EIP-1167**: Minimal Proxy Contract — [https://eips.ethereum.org/EIPS/eip-1167](https://eips.ethereum.org/EIPS/eip-1167)
- **Uniswap V3 Core** — [https://docs.uniswap.org/contracts/v3/overview](https://docs.uniswap.org/contracts/v3/overview)
- **0G Documentation** — [https://docs.0g.ai](https://docs.0g.ai)
- **Pyth Network** — [https://pyth.network](https://pyth.network)
- **Aegis Vault source code** — [https://github.com/mdlog/aegis-vault](https://github.com/mdlog/aegis-vault)
- **Aegis Vault architecture details** — [ARCHITECTURE.md](ARCHITECTURE.md)
- **Aegis Vault hackathon submission** — [HACKATHON_SUBMISSION.md](HACKATHON_SUBMISSION.md)

---

*Aegis Vault is experimental software deployed on mainnet. Users who deposit real assets accept the risk of smart contract bugs, oracle manipulation, operator misbehavior, and the explicit limitations in Section 10. No capital-protection guarantees are made. Audits, bug bounty programs, and insurance coverage are roadmapped post-hackathon. Until a formal third-party audit is complete, operators and users are encouraged to deploy with small allocations and to verify every claim in this document against the source code at the referenced commit.*
