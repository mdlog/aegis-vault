# Aegis Vault AI Agent — Decision Flow

This document explains in detail how the AI agent in Aegis Vault decides between **BUY**, **SELL**, and **HOLD** on every cycle.

---

## Overview

Aegis Vault uses AI inference from the **0G Compute Network** (model `GLM-5-FP8` on mainnet) to analyze market conditions and produce a structured trading decision. The AI's decision is then validated by **12 on-chain policy rules** before any swap is executed.

```
Every 2 minutes:

  [Market Data]  →  [AI Inference]  →  [Policy Check]  →  [Execute/Block]
   CoinGecko        0G Compute         Off-chain +         On-chain TX
   Pyth Hermes      GLM-5-FP8          On-chain rules      via MockDEX
```

**Core principle:** the AI only **proposes** — the smart contract is what **decides** whether the proposal is valid.

---

## Step 1: Market Data Collection

On every cycle, the orchestrator collects data from two sources:

### CoinGecko API
- Real-time BTC, ETH, USDC prices in USD
- 24h price change (%)
- 24h volume
- Market cap

### Pyth Hermes Oracle
- Real-time prices with confidence interval
- Updates every 15 seconds

### Volatility Calculation
- Pulls the last 7 days of prices from CoinGecko
- Computes **annualized volatility** from the standard deviation of daily returns
- Used as a market risk indicator

**Example of collected data:**
```
BTC:
  Price: $68,376
  24h Change: +2.00%
  24h Volume: $28.5B
  7d Volatility: 42.15% (annualized)

ETH:
  Price: $2,125
  24h Change: +3.00%
  24h Volume: $12.1B
  7d Volatility: 55.30% (annualized)
```

---

## Step 2: Vault State Read (On-chain)

The orchestrator reads vault state directly from the smart contract:

| Data | Source | Example |
|------|--------|---------|
| NAV (Net Asset Value) | `vault.getVaultSummary()` | $30,000 |
| Policy | `vault.getPolicy()` | Max position 50%, confidence threshold 60% |
| Allowed Assets | `vault.getAllowedAssets()` | USDC, WBTC, WETH |
| Daily Actions Used | `vault.getVaultSummary()` | 2 / 20 |
| Last Execution Time | `vault.getVaultSummary()` | 2 hours ago |
| Paused | `vault.getVaultSummary()` | false |
| Auto-execution | `vault.getPolicy()` | true |
| Mandate | Derived from maxPositionBps | Balanced |

---

## Step 3: Prompt Construction

The orchestrator builds the prompt sent to the AI model.

### System Prompt (identity + rules)

```
You are Aegis Vault AI — a disciplined, risk-aware autonomous trading agent.

RULES:
- Capital preservation is the top priority.
- Never recommend a trade if conditions are ambiguous or volatile.
- If in doubt, recommend "hold" with low confidence.
- Output MUST be valid JSON only.

CONSTRAINTS:
- size_bps must not exceed 2000 (20%)
- If risk_score > 0.7, you SHOULD recommend "hold"
- If confidence < 0.5, you SHOULD recommend "hold"
- Never trade more than one asset at a time
```

### User Prompt (real-time data)

```
=== CURRENT MARKET DATA ===
BTC:
  Price: $68,376
  24h Change: +2.00%
  24h Volume: $28.50B
ETH:
  Price: $2,125.91
  24h Change: +3.00%
  24h Volume: $12.10B

=== VOLATILITY (7d annualized) ===
BTC: 42.15%
ETH: 55.30%

=== VAULT STATE ===
NAV: $30,000
Mandate: Balanced
Max Position: 50%
Max Drawdown: 5%
Confidence Threshold: 60%
Daily Actions Used: 2/20
Last Execution: 2 hours ago

Based on the above data, what is your recommended action?
```

---

## Step 4: AI Reasoning & Decision

### Using 0G Compute (GLM-5-FP8)

The model runs an internal **reasoning chain** before answering:

```
[REASONING — internal, not exposed to user]
Market Analysis:
- BTC: $69,000, up 2.8% in 24h — showing strong bullish momentum
- ETH: $2,140, up 1.5% in 24h — moderate bullish momentum

Vault Status:
- $30,000 USDC (all in stablecoins)
- No current positions in BTC or ETH

Policy Constraints:
- Max position: 50% of vault = $15,000 max per asset
- Confidence threshold: 60% minimum to execute trade

Analysis:
1. BTC is showing stronger momentum (+2.8%) compared to ETH (+1.5%)
2. Vault is 100% in USDC — has full capacity to take a position
3. Position at 40% = $12,000, stays within 50% max limit
4. Confidence: market is clearly bullish but not extreme → 72%
5. Risk: low since entry is with-trend and position is moderate → 4%
```

### Output JSON

```json
{
  "action": "buy",
  "asset": "BTC",
  "size_bps": 4000,
  "confidence": 0.72,
  "risk_score": 0.04,
  "reason": "BTC showing strong bullish momentum (+2.8% 24h), vault fully in USDC with no exposure. Position sizing at 40% stays within 50% max policy limit."
}
```

### Field Definitions

| Field | Type | Range | Meaning |
|-------|------|-------|---------|
| `action` | string | `buy`, `sell`, `hold` | What to do |
| `asset` | string | `BTC`, `ETH`, `USDC` | Asset to trade |
| `size_bps` | number | 0 - 5000 | Position size in basis points (100 = 1% of vault NAV) |
| `confidence` | number | 0.0 - 1.0 | How confident the AI is (0 = uncertain, 1 = very confident) |
| `risk_score` | number | 0.0 - 1.0 | Market risk level (0 = very safe, 1 = very risky) |
| `reason` | string | - | One-sentence explanation of the decision |

---

## Step 5: When the AI Decides Buy / Sell / Hold

### BUY — Triggers:

| Trigger | Example | Confidence |
|---------|---------|-----------|
| Strong BTC upward momentum (+2.5%+ 24h) | BTC $69k (+2.8%) | ~72% |
| Strong ETH upward momentum (+3%+ 24h) | ETH $2.2k (+3.3%) | ~66% |
| Vault has no existing exposure (100% USDC) | NAV $30k all stablecoin | Higher |
| Low-to-moderate volatility (<60%) | BTC vol 42% | Higher |

### SELL — Triggers:

| Trigger | Example | Confidence |
|---------|---------|-----------|
| Sharp BTC drop (-3%+ 24h) | BTC $66k (-3.2%) | ~68% |
| Sharp ETH drop (-3.5%+ 24h) | ETH $2k (-4%) | ~65% |
| Vault has large exposure to a falling asset | 40% in BTC, BTC -3% | Higher |
| Drawdown approaching its limit | Loss 4% out of 5% max | Higher |

### HOLD — Triggers:

| Trigger | Example | Confidence |
|---------|---------|-----------|
| Market sideways / no clear signal | BTC +0.5%, ETH -0.3% | ~45% |
| Volatility too high (>80%) | BTC vol 92% | ~55% |
| Confidence < 50% | Ambiguous signals | ~35% |
| Risk score > 70% | Market crash, many negative indicators | ~40% |
| Daily action limit reached | 20/20 actions today | ~25% |
| Vault paused | Owner has paused the vault | N/A |

---

## Step 6: Policy Check (Double Layer)

The AI's decision must pass **two layers** of validation:

### Layer 1: Off-chain Pre-check (10 rules — gas-saving)

```
✅ Auto-execution enabled?
✅ Vault not paused?
✅ Confidence >= threshold? (e.g. 72% >= 60%)
✅ Position size <= max? (e.g. 40% <= 50%)
✅ Daily actions < limit? (e.g. 2 < 20)
✅ Cooldown elapsed? (e.g. 2 hours > 60 seconds)
✅ Asset whitelisted? (BTC in the allowed assets list)
✅ Daily loss within limit?
✅ Risk score acceptable?
✅ Auto-execution flag on?
```

If even ONE check fails → the intent is **never submitted** to the blockchain (gas saved).

### Layer 2: On-chain Enforcement (12 rules — immutable)

```
✅ autoExecution == true
✅ intent.vault == address(this) (prevents cross-vault attacks)
✅ EIP-712 intentHash recomputed and matches (anti-tampering + cross-chain replay)
✅ [Sealed mode] ECDSA signature verified against policy.attestedSigner
✅ [Sealed mode] commit-reveal: commit exists at block < current (anti-MEV)
✅ [Sealed mode] commit deleted after use (anti-replay)
✅ ExecLib policy checks:
   - Intent expiry
   - Cooldown elapsed
   - Confidence threshold
   - Daily action count
   - Token balance sufficient
✅ Intent registered in ExecutionRegistry (anti-replay)
✅ Swap executed via venue (ExecLib._swap with slippage check)
```

---

## Full Example: Cycle #573 (Real Data)

### Input

```
Timestamp: 2026-04-01T14:07:01Z

Market:
  BTC: $68,215 (+1.65% 24h)
  ETH: $2,120.57 (+2.54% 24h)
  USDC: $1.00

Vault (0xFFac...DAB2):
  NAV: $6,688
  Paused: false
  Auto-execution: true
  Daily Actions: 20/20
```

### AI Decision (0G Compute — GLM-5-FP8)

```json
{
  "action": "hold",
  "asset": "USDC",
  "size_bps": 0,
  "confidence": 0.25,
  "risk_score": 0.55,
  "reason": "Daily action limit reached (20/20), volatility data unavailable, and market shows no strong directional signals.",
  "source": "0g-compute"
}
```

**Why HOLD:**
1. Daily action limit 20/20 reached — the AI knows no more trading is allowed today
2. Volatility data unavailable (CoinGecko rate-limited)
3. Market movement not strong enough for a clear signal
4. Confidence only 25% — well below the 60% threshold

### Result: Skipped (no on-chain transaction)

---

## Full Example: BUY ETH Cycle (Real Data)

### Input

```
Timestamp: 2026-04-01T13:40:06Z

Market:
  BTC: $68,376 (+2.00% 24h)
  ETH: $2,125.91 (+3.00% 24h)
  USDC: $1.00

Vault (0xFFac...DAB2):
  NAV: ~$30,000
  Daily Actions: <20
```

### AI Decision (local-fallback)

```json
{
  "action": "buy",
  "asset": "ETH",
  "size_bps": 600,
  "confidence": 0.66,
  "risk_score": 0.38,
  "reason": "ETH momentum continuation (+3.0% 24h). Risk-adjusted entry within mandate.",
  "source": "local-fallback"
}
```

**Why BUY ETH:**
1. ETH up +3.0% in 24h — meets the momentum threshold (+3%+)
2. BTC also up (+2.0%) but does not meet the BTC buy threshold (+2.5%+)
3. Risk score 38% — moderate, below the 70% threshold
4. Confidence 66% — above the 60% policy threshold
5. Size 600 bps (6%) — conservative, well under the 50% max

### Policy Check

```
Off-chain:
  ✅ Confidence 66% >= 60% threshold
  ✅ Position 6% <= 50% max
  ✅ Daily actions < 20
  ✅ Cooldown elapsed
  ✅ ETH whitelisted
  → PASSED — submit intent to chain
```

### On-chain Execution

```
vault.executeIntent(intent):
  ✅ autoExecution = true
  ✅ intent.vault matches
  ✅ intentHash verified
  ✅ Stop-loss not triggered
  ✅ PolicyLibrary.validateAll() passed
  → registerIntent in Registry
  → forceApprove(venue, amountIn)
  → MockDEX.swap(USDC, WETH, amount)
  → forceApprove(venue, 0)
  → verify balanceOf delta
  → finalizeIntent in Registry
  → emit IntentExecuted
```

**Result:** TX `0x6611cca6...` confirmed on Galileo testnet. USDC swapped into WETH.

---

## Full Example: BLOCKED by Policy

### AI Decision

```json
{
  "action": "buy",
  "asset": "ETH",
  "size_bps": 600,
  "confidence": 0.66,
  "risk_score": 0.38,
  "reason": "ETH momentum continuation (+3.3% 24h)."
}
```

### Policy Check — BLOCKED

```
Off-chain:
  ✅ Confidence 66% >= 60%
  ✅ Position 6% <= 50%
  ❌ Daily action limit reached (20/20)
  → BLOCKED — intent NOT submitted to chain
```

**Log:**
```json
{
  "type": "policy_check",
  "action": "buy",
  "asset": "ETH",
  "valid": false,
  "reason": "Daily action limit reached (20/20)"
}
```

**Result:** No on-chain transaction. Gas saved. The AI is informed that the action was blocked.

---

## Real Stats (from the Orchestrator)

Data from a running orchestrator:

```
Total Cycles:        574
Total Decisions:     574

Buy Decisions:       127 (BTC + ETH)
Sell Decisions:      0 (market hasn't dropped sharply)
Hold Decisions:      447

Executed on-chain:   18
Blocked by policy:   109 (mostly "daily limit 20/20")
Skipped (hold):      447

Source 0G Compute:   1 (just activated)
Source local-fallback: 573

Block Reasons:
  109x: "Daily action limit reached (20/20)"
```

---

## Track 2: Sealed Strategy Mode — Decision Flow Extension

When a vault uses **Sealed Strategy Mode** (`policy.sealedMode = true`), additional steps wrap the AI decision:

### Pre-Execution: TEE Attestation

```
Standard Flow:
  AI Decision → Policy Check → executeIntent(intent, "0x")

Sealed Flow:
  AI Decision → 0G Compute verified response → computeAttestationReportHash()
              → commitIntent(keccak256(intentHash, attestationReportHash))
              → wait 1 block (anti-MEV)
              → executeIntent(intent, teeSignature)
              → vault verifies ECDSA signature (EIP-712 typed data)
              → vault checks that commit exists and is old enough
              → vault deletes commit (replay protection)
              → execute swap
```

### Attestation Report Hash

The orchestrator computes a hash of the 0G Compute response:
```
attestationReportHash = keccak256(abi.encode(
  providerAddress,   // 0G Compute provider that ran inference
  chatId,            // conversation ID (unique per request)
  model,             // model used (e.g., "GLM-5-FP8")
  keccak256(content) // hash of the AI output (decision JSON)
))
```

This hash is bound into the intent hash (EIP-712), so:
- The AI output cannot be swapped out after attestation
- The vault is auditable: match the attestation hash against the 0G Compute log

### EIP-712 Intent Hash

The intent hash now uses **EIP-712 typed structured data**:
```
digest = keccak256(\x19\x01 || domainSeparator || structHash)

domainSeparator = keccak256(EIP712Domain(name, version, chainId, verifyingContract))
  name = "AegisVault"
  version = "1"
  chainId = block.chainid (16661 mainnet, 16602 testnet)
  verifyingContract = address(vault)

structHash = keccak256(ExecutionIntent typehash || vault || assetIn || ... || attestationReportHash)
```

Benefits:
- Cross-chain replay protection (testnet hash ≠ mainnet hash)
- Cross-vault replay protection (vault A hash ≠ vault B hash)
- Industry standard (MetaMask, Ledger, etc. can display readable data)

### Trust Model

| Layer | What it protects | Depends on |
|---|---|---|
| On-chain: ECDSA verify | Only `attestedSigner` can authorize a trade | `TEE_SIGNER_PRIVATE_KEY` stays safe |
| On-chain: commit-reveal | Front-runners cannot see swap params before reveal | ≥ 1 block delay between commit and reveal |
| Off-chain: 0G Compute | Inference runs on a registered provider | Provider integrity + `processResponse()` verification |
| Off-chain: TEE hardware | Strategy params stay confidential during inference | Provider hardware (SGX/TDX) — honest disclosure |

---

## Summary

| Aspect | Detail |
|--------|--------|
| **Who decides?** | AI (GLM-5-FP8 via 0G Compute) proposes, the Smart Contract decides |
| **Input data** | Real-time prices (CoinGecko + Pyth), 7d volatility, on-chain vault state |
| **Output** | JSON: action, asset, size, confidence, risk_score, reason |
| **When BUY?** | Strong momentum (+2.5%+ BTC, +3%+ ETH), low volatility, high confidence |
| **When SELL?** | Sharp drop (-3%+ BTC, -3.5%+ ETH), exposure needs to be reduced |
| **When HOLD?** | Sideways market, high volatility, low confidence, action limit reached |
| **Safety** | EIP-712 intent hash, commit-reveal, TEE attestation, policy rules, replay prevention |
| **Sealed mode** | TEE-attested 0G Compute inference + commit-reveal anti-MEV + on-chain ECDSA verify |
| **Transparency** | Every decision is recorded in the journal + 0G Storage (immutable) |
