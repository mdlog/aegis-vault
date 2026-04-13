# Aegis Vault — Architecture

This document describes the production architecture of Aegis Vault (Phase 1-5): economic model, contract topology, trust model, threat analysis, and state machines.

---

## 1. Contract Topology

```
                           ┌─────────────────────────────┐
                           │      User Wallet            │
                           │  (owns vault, deposits USDC)│
                           └──────────────┬──────────────┘
                                          │ deposit / withdraw / createVault
                                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AegisVaultFactory                            │
│  • Clones AegisVault per user                                  │
│  • Wires ExecutionRegistry + ProtocolTreasury                  │
│  • Admin: multi-sig (after TRANSFER_ADMINS=1)                  │
└────────────────────────────────┬────────────────────────────────┘
                                 │ creates
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        AegisVault  (thin orchestrator, 3.4KB)  │
│                                                                  │
│  STATE                                                           │
│  ├── owner                                                       │
│  ├── executor (= operator wallet)                                │
│  ├── baseAsset (USDC)                                            │
│  ├── allowedAssets[]                                             │
│  ├── policy { fees, risk limits, autoExec,                      │
│  │            sealedMode, attestedSigner }                      │
│  ├── highWaterMark (HWM)                                         │
│  ├── accruedManagementFee + accruedPerformanceFee               │
│  ├── pendingFeeChange (7-day cooldown)                          │
│  ├── intentCommits (commit-reveal map)                          │
│  ├── navCalculator (optional, Phase 1.8)                        │
│  └── reputationRecorder (optional, Phase 5)                     │
│                                                                  │
│  ACTIONS (delegatecall to libraries)                            │
│  • deposit()        → IOLib: accrueFees + entry fee + HWM       │
│  • withdraw()       → IOLib: accrueFees + exit fee              │
│  • commitIntent()   → store keccak256(intentHash, reportHash)  │
│  • executeIntent()  → ExecLib: EIP-712 hash + policy check     │
│  │                    SealedLib: ECDSA attest verify (if sealed)│
│  │                    swap + reputation record                  │
│  • accrueFees()     → streaming mgmt fee + HWM-gated perf fee   │
│  • claimFees()      → 80% operator / 20% treasury               │
│  • queueFeeChange() → 7-day delay                               │
│  • pause/unpause    → owner only                                │
└──┬──────────┬──────────┬──────────┬──────────┬─────────────────┘
   │          │          │          │          │
   │delegatecall         │          │          │
   ▼          ▼          │ swap via │ record   │ 20% cut
ExecLib   SealedLib      │          │          │
(3.5KB)   (0.5KB)        ▼          ▼          ▼
           IOLib      Venue   ExecutionReg  OperatorRep   ProtocolTreasury
          (1.1KB)   (Jaine   (replay guard)(stats +      (admin spending
                    or Mock)              ratings)       via governance)


                     ┌──────────────────────┐
                     │  OperatorRegistry    │
                     │  • declared fees     │
                     │  • recommended policy│
                     │  • mandate type      │
                     └──────────┬───────────┘
                                │ gate
                                ▼
                     ┌──────────────────────┐
                     │  OperatorStaking     │
                     │  • 4 tiers           │
                     │  • 14-day cooldown   │
                     │  • freeze/slash      │───▶  InsurancePool
                     │  • arbitrator: gov   │      (payout via gov)
                     └──────────────────────┘

                     ┌──────────────────────┐
                     │   AegisGovernor      │
                     │   (M-of-N multi-sig) │
                     │                      │
                     │   Actions via prop:  │
                     │   • slash operator   │
                     │   • treasury spend   │
                     │   • grant verified   │
                     │   • add/remove owner │
                     │   • change threshold │
                     └──────────────────────┘
```

---

## 2. Economic Model

### 2.1 Fee Schedule

Fees are declared by the operator at registration and stored in the vault's `policy` struct at creation time. Users see them upfront before depositing.

| Fee | Default | Max | When Charged | Splitting |
|---|---|---|---|---|
| Performance | 15% | 30% | On profit above HWM | 80/20 split |
| Management | 2% / yr | 5% / yr | Streaming on NAV | 80/20 split |
| Entry | 0% | 2% | On each deposit | 80/20 split |
| Exit | 0.5% | 2% | On each withdrawal | 80/20 split |

**80/20 split** = 80% to operator (fee recipient), 20% to `ProtocolTreasury`.

### 2.2 High-Water Mark (HWM)

Performance fee is only charged on **net-new profit**:

```
If  NAV_now > HWM:
    performance_fee = (NAV_now - HWM) × perfFeeBps / 10000
    HWM ← NAV_now
Else:
    performance_fee = 0
    HWM unchanged
```

The vault owner is protected from paying performance fees on volatility — if the vault hits $100k, drops to $90k, and recovers to $100k, the operator earns **zero** performance fee on the recovery.

### 2.3 Streaming Management Fee

Management fee accrues continuously (per-second) on NAV:

```
time_elapsed = block.timestamp - lastFeeAccrual
management_fee = (NAV × mgmtFeeBps × time_elapsed) / (10000 × SECONDS_PER_YEAR)
```

Accrual is lazy — triggered on `deposit()`, `withdraw()`, or any explicit `accrueFees()` call.

### 2.4 Fee Change Cooldown

Operators cannot surprise-raise fees. Changes go through:

1. Operator calls `queueFeeChange(newPerfBps, newMgmtBps, newEntryBps, newExitBps)`
2. `pendingFeeChange` stored with `effectiveAt = now + 7 days`
3. During the 7-day window, users can withdraw at old fees
4. After cooldown, anyone can call `applyFeeChange()` to activate

### 2.5 Protocol Treasury

The 20% protocol cut funds:

- Security audits (grants via `treasurySpend` proposal)
- Operator growth rewards
- Insurance pool top-ups
- Dev bounties

Treasury is admin-controlled (multi-sig after `TRANSFER_ADMINS=1`). Individual spends require governance proposals.

---

## 3. Skin-in-the-Game Staking

### 3.1 Tier System

| Tier | Stake (USDC) | Max Vault Cap |
|---|---|---|
| None | $0 | $5k |
| Bronze | $1k | $50k |
| Silver | $10k | $500k |
| Gold | $100k | $5M |
| Platinum | $1M | Unlimited |

The **orchestrator + frontend enforce** this cap at vault creation time and during execution. A Silver operator cannot execute intents on a $1M vault — the orchestrator skips the cycle with `TIER_CAP_EXCEEDED`.

### 3.2 Unstake Cooldown

Operators cannot withdraw stake instantly — slashing would be trivially avoided:

```
requestUnstake(amount):
    active -= amount
    pending += amount
    unstakeAvailableAt = now + 14 days

claimUnstake():
    require(now >= unstakeAvailableAt)
    pending → wallet
```

During the 14-day window, pending stake **is still slashable**. This closes the "see a slash coming, unstake instantly" attack.

### 3.3 Slashing

Slashing is gated by the `arbitrator` role on `OperatorStaking` — in production this is the `AegisGovernor` multi-sig. Flow:

1. Evidence of misbehavior submitted off-chain (journal, tx hash, etc.)
2. Governance proposal: `freeze(operator)` — locks stake during review
3. Multi-sig votes on the slash amount (hard cap: 50% of stake per action)
4. Approved proposal executes `slash(operator, amount, reason)`
5. Slashed funds flow to `InsurancePool`
6. Vault owners with losses submit `InsurancePool.submitClaim()`
7. Governance reviews + executes `payoutClaim(claimId, actualAmount)`

The 50% cap prevents single-tx reputation destruction. Repeat offenders can be slashed again after another governance round.

---

## 4. Reputation System

### 4.1 Sources of Truth

Reputation is split between **on-chain verifiable** (authoritative) and **off-chain display** (subjective):

| Metric | Source | Verifiable? |
|---|---|---|
| Total executions | `vault.executeIntent → reputation.recordExecution` | Yes |
| Success rate | Same | Yes |
| Total volume (USDC) | Same | Yes |
| Cumulative PnL | Same (signed int) | Yes |
| Ratings (1-5 ★) | `user.submitRating(operator, stars, comment)` | Partial — one-per-wallet |
| Verified badge | Admin-granted via governance | Gated |

**Anti-gaming:** Only authorized vault contracts can call `recordExecution`. The factory is authorized at deployment, and individual vaults get authorized when the owner calls `vault.setReputationRecorder()` + the multi-sig approves via `reputation.setRecorder(vaultAddress, true)`.

### 4.2 Composite Reputation Score

The frontend computes a 0-100 score for sorting/ranking:

```
score = successRate × 0.5              // 0..50
      + (avgRating / 5) × 100 × 0.3    // 0..30
      + (verified ? 20 : 0)            // 0 or 20
```

Verified operators always rank higher than unverified ones with identical stats.

---

## 5. Governance

### 5.1 M-of-N Multi-sig

`AegisGovernor` is a minimal multi-sig:

- `owners[]` with `threshold` (M-of-N)
- Anyone in `owners` can `submit(target, value, data, description)`
- Proposer auto-confirms at submission
- Other owners `confirm(id)` until `threshold` reached
- Anyone (owner or not) can `execute(id)` once threshold met
- Owners can `revokeConfirmation(id)` before execution
- Owners can `cancel(id)` before execution

### 5.2 Owner Rotation (Self-call Pattern)

Adding/removing owners and changing the threshold are **self-call only**:

```solidity
function addOwner(address newOwner) external onlyGovernor { ... }
//                                            ^^^^^^^^^^^^
//                                   requires msg.sender == address(this)
```

The only way to call `addOwner` is through an executed proposal, which means **all current owners must collectively agree**.

### 5.3 Gated Actions

All sensitive protocol actions route through governance proposals. The frontend's `ProposalBuilders` helper translates domain actions into `(target, data)` tuples:

| Action | Target | Calldata |
|---|---|---|
| Slash operator | `OperatorStaking` | `slash(op, amount, reason)` |
| Freeze stake | `OperatorStaking` | `freeze(op)` |
| Unfreeze stake | `OperatorStaking` | `unfreeze(op)` |
| Pay insurance claim | `InsurancePool` | `payoutClaim(id, amount)` |
| Treasury spend | `ProtocolTreasury` | `spend(token, to, amount, purpose)` |
| Grant verified badge | `OperatorReputation` | `setVerified(op, true)` |
| Add governor owner | `AegisGovernor` (self) | `addOwner(wallet)` |
| Change threshold | `AegisGovernor` (self) | `changeThreshold(N)` |

---

## 6. Track 2: Sealed Strategy Mode

### 6.1 Contract Layer

`VaultPolicy` gains two new fields for sealed vaults:

| Field | Type | Purpose |
|---|---|---|
| `sealedMode` | `bool` | Requires commit-reveal + TEE attestation |
| `attestedSigner` | `address` | The TEE key whose ECDSA signature is accepted |

`ExecutionIntent` gains `attestationReportHash` — a `bytes32` keccak256 of the 0G Compute provider identifier, chatId, and content hash. Strategy parameters never appear on-chain; only this digest is committed.

**Two-phase execution:**

```solidity
// Phase 1 — commit (block N)
commitIntent(bytes32 commitHash)
    // commitHash = keccak256(abi.encode(intentHash, attestationReportHash))
    // stored: intentCommits[commitHash] = block.number

// Phase 2 — reveal (block N+1 or later)
executeIntent(ExecutionIntent calldata intent, bytes calldata teeSignature)
    // vault reconstructs commitHash, verifies it was committed at an earlier block
    // ExecLib.computeIntentHash  → EIP-712 structured hash
    // SealedLib.verifyAttestation → ecrecover == attestedSigner
    // policy checks (unchanged from non-sealed path)
    // delete intentCommits[commitHash]  ← replay protection
    // execute swap
```

**EIP-712 domain separator** (computed once at vault creation):

```
name            = "AegisVault"
version         = "1"
chainId         = block.chainid
verifyingContract = address(this)
```

`ExecLib` computes the EIP-712 structured hash and all inline policy checks. `SealedLib` performs a single `ecrecover` call — no EIP-191 double-prefix, because the TEE signs the domain-separated hash directly from the `eth_signTypedData_v4` spec.

### 6.2 Commit-Reveal Flow

```
Block N:   orchestrator → commitIntent(keccak256(intentHash, attestationReportHash))
                          vault stores: intentCommits[commitHash] = N

Block N+1: orchestrator → executeIntent(intent, teeSignature)
           vault → ExecLib.computeIntentHash(intent)      (EIP-712 structured hash)
           vault → SealedLib.verifyAttestation(intentHash, teeSignature)
                   ecrecover(intentHash, teeSignature) == policy.attestedSigner  ✓
           vault → reconstruct commitHash, look up intentCommits[commitHash]
                   require(commitBlock < block.number)     ✓  (same-block forbidden)
           vault → delete intentCommits[commitHash]        ← replay protection
           vault → policy checks (position size, confidence, cooldown …)
           vault → execute swap via venue
           vault → recordExecution on OperatorReputation
```

The `attestationReportHash` baked into the commit binds the on-chain execution to a specific 0G Compute inference job. An orchestrator cannot substitute a different model output without invalidating the commit.

### 6.3 Library Decomposition

The vault is refactored into a thin state-management shell (~3.4KB) that `delegatecall`s into purpose-built libraries:

| Library | Size | Responsibility |
|---|---|---|
| `ExecLib` | ~3.5KB | EIP-712 intent hash, policy validation, swap execution, registry call |
| `SealedLib` | ~0.5KB | TEE attestation ECDSA verification (`ecrecover`) |
| `IOLib` | ~1.1KB | `deposit` / `withdraw` with fee accrual and HWM updates |
| `AegisVault` | ~3.4KB | State storage, routing, access control |

Each library operates on the vault's storage layout via `delegatecall` — no proxy pattern, no storage collision risk beyond the explicit slot layout documented in `AegisVault.sol`.

### 6.4 Trust Model

| Layer | What is enforced |
|---|---|
| On-chain | Vault checks that only `attestedSigner` can authorize trades; commit must precede reveal by at least one block; each commit is single-use |
| Off-chain | Orchestrator routes inference through 0G Compute; collects verified TEE response including provider attestation; signs intent with TEE key |
| Hardware | TEE-grade confidentiality depends on the 0G Compute provider's hardware (SGX/TDX); Aegis Vault trusts the `attestedSigner` public key, not any specific hardware claim |
| Strategy privacy | Strategy parameters (prompt, model output, trade rationale) never touch the chain — only `keccak256(provider, chatId, contentHash)` is committed |
| Front-running protection | Commit-reveal ensures swap parameters are hidden until the reveal block; validators and mempool observers cannot act on the intent before it is executable |

---

## 7. State Machines

### 7.1 Vault Lifecycle

```
created ─deposit──▶ funded ─executeIntent──▶ trading ─withdraw──▶ depleted
  │                   │                         │
  │                   ├─pause──▶ paused         │
  │                   │             │            │
  │                   │             └─unpause──▶ funded
  │                   │
  │                   └─queueFeeChange──▶ pendingFees (7d) ─applyFeeChange──▶ funded
  │
  └─(never deposited) ─▶ can be ignored indefinitely
```

### 7.2 Operator Staking Lifecycle

```
unstaked ─stake──▶ active(tier) ─requestUnstake──▶ cooling(14d) ─claimUnstake──▶ unstaked
                      │                                    │
                      │ freeze                             │ freeze
                      ▼                                    ▼
                   frozen(active)                    frozen(cooling)
                      │                                    │
                      │ unfreeze / slash                   │ unfreeze / slash
                      ▼                                    ▼
                   active                              cooling
```

Key invariants:
- **Frozen stakes cannot request unstake or claim**
- **Slashing works on active + cooling combined**, capped at 50% per action
- **Tier downgrade is automatic** after slashing (e.g., Silver → Bronze if stake falls below $10k)

### 7.3 Proposal Lifecycle

```
submitted ─confirm──▶ (if conf < threshold) ───▶ submitted
    │                                              │
    │                                              │ more confirms
    │                                              ▼
    │                                         (conf = threshold)
    │                                              │
    │                                              │ execute
    │                                              ▼
    │                                          executed
    │
    ├─revoke──▶ submitted (confirmations -= 1)
    │
    └─cancel──▶ canceled (terminal)
```

---

## 8. Trust Model

### 8.1 Who Can Do What

| Actor | Can | Cannot |
|---|---|---|
| Vault owner | Deposit, withdraw, pause, setExecutor, setReputationRecorder, setNavCalculator | Change fees mid-stream (must queue + wait 7d), slash operators |
| Operator (executor) | Call `executeIntent` within policy | Withdraw funds, pause vault, raise fees beyond queued change |
| Governor owner (single) | Submit proposals | Execute without M-of-N approval |
| Governor (M-of-N) | Slash, treasury spend, grant verified, rotate owners | Withdraw user funds, change fees on a user's vault |
| Protocol admin (pre-rotation) | Same as governor — **before** `TRANSFER_ADMINS=1` | — |

### 8.2 What The AI Can Do

**The AI has zero on-chain authority.** It proposes intents via the orchestrator, which signs and submits to `executeIntent()`. The vault's policy enforces:

- `maxPositionBps` — max size per trade
- `maxDailyLossBps` — cumulative daily loss cap
- `stopLossBps` — global stop-loss on total loss
- `cooldownSeconds` — minimum time between trades
- `confidenceThresholdBps` — AI must be this confident
- `maxActionsPerDay` — hard daily action cap
- `allowedAssets[]` — whitelist only
- `autoExecution` — owner kill switch
- Intent hash single-use (replay-proof)
- Intent expiry (signed time-bounded)
- Min amount out (sandwich attack protection)

If the AI goes rogue, the vault **refuses** to execute. Worst case: 0 intents pass, vault stays idle.

---

## 9. Threat Model

### 9.1 What We Protect Against

| Threat | Mitigation |
|---|---|
| **Malicious executor drains vault** | Executor can only call `executeIntent`, which is bounded by policy. Cannot call `withdraw`. |
| **Operator front-runs user deposits** | Entry fee is pre-computed from policy; operator has no advantage. |
| **Operator takes perf fee on volatility** | HWM guard — only new profit counted. |
| **Operator raises fees on active vault** | 7-day cooldown via `queueFeeChange`. |
| **Oracle manipulation causing bad NAV** | Multi-asset NAV falls back to base-asset balance if Pyth reverts. |
| **Sandwich attack on swap** | `minAmountOut > 0` enforced if venue set. |
| **Intent replay** | Single-use intent hashes via `ExecutionRegistry`. |
| **Reputation inflation** | Only authorized recorders (vaults) can write stats. |
| **Rating spam** | One rating per (operator, wallet) pair. |
| **Stake withdrawal to dodge slash** | 14-day cooldown; pending stake remains slashable. |
| **Single slash wipes operator** | 50% cap per slash action. |
| **Admin rug pull** | Multi-sig governance after `TRANSFER_ADMINS=1`; owner rotation via self-call. |
| **Compromised governor owner** | M-of-N threshold + revokeConfirmation before execution. |

### 9.2 Known Limitations

- **Reputation PnL is 0 in Phase 5** — the vault can't yet reconcile realized PnL across heterogeneous swap outputs. Tracked as Phase 6 work.
- **No slashing appeal** — Phase 4 governance is final; a disputed slash requires a counter-proposal.
- **Insurance pool is first-come-first-served** — no pro-rata distribution if claims exceed pool balance.
- **Chain-level censorship** — if the 0G network censors a vault, owner can't withdraw. Same risk as any L1.

---

## 10. Gas & Deployment

### 10.1 Deployment Order

`scripts/deploy-all.js` handles this:

1. `ProtocolTreasury(admin=deployer)`
2. `ExecutionRegistry()`
3. `AegisVaultFactory(executionRegistry, protocolTreasury)`
4. Transfer `executionRegistry` admin → factory
5. `OperatorRegistry()`
6. (testnet) Mock USDC/WBTC/WETH + MockDEX + pair rates + liquidity
7. `InsurancePool(usdc, arbitrator=deployer)`
8. `OperatorStaking(usdc, operatorRegistry, insurancePool, arbitrator=deployer)`
9. `OperatorReputation(admin=deployer)` + authorize factory as recorder
10. `AegisGovernor(owners, threshold)`
11. (optional, `TRANSFER_ADMINS=1`) Rotate all admin roles → governor

### 10.2 Per-vault Deployment

Each user vault is a fresh `AegisVault` contract cloned via `factory.createVault()`. Gas cost is ~2-3M per clone. Future optimization: minimal proxy (EIP-1167).

---

## 11. Upgrade Path

Aegis Vault uses **no proxies** — all contracts are immutable by design. Upgrades happen via:

1. Deploy new contract (e.g., `OperatorStakingV2`)
2. Governance proposal to migrate: `OperatorStaking.setArbitrator(address(0))` to freeze old, wire new
3. Users opt in voluntarily to migrate their stake

This is deliberate — immutability is a security feature for a vault protocol. There is no "pause everything and upgrade" escape hatch that could be exploited.

---

## 12. References

- [Decision Engine v1 Spec](Aegis_Vault_Decision_Matrix_v1.md) — 8 regimes, 15 veto rules, dynamic position sizing
- [0G Integration Design](Aegis_Vault_0G_Architecture.md) — how vault ↔ compute ↔ storage interact
- Pyth Network — on-chain multi-asset NAV via `VaultNAVCalculator`
- OpenZeppelin — `SafeERC20`, `ReentrancyGuard` used throughout
