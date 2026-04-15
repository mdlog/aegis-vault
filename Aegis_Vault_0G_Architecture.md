# Aegis Vault — Complete Product Architecture on 0G Chain

## 1. Summary

**Aegis Vault** is an **AI-managed risk-controlled trading vault** built on top of the 0G stack.

Its primary function is not to be a new DEX, but to serve as a **layer of risk control, execution policy, and memory/audit** for automated trading.

In the most realistic MVP version for the hackathon:

- **0G Chain** is used for the smart contract vault, policy, custody, and audit events.
- **0G Compute** is used for AI agent inference that produces trading decisions.
- **0G Storage** is used to store state, decision journals, reasoning summaries, and strategy memory.
- **DEX venue** for spot/swap execution is the **Jaine / 0G Hub route** as the most realistic target for the MVP.

Product positioning:

> **Aegis Vault = verifiable AI risk manager with autonomous execution guardrails**

---

## 2. Problems Being Solved

In DeFi and on-chain trading, users face several major problems:

1. **Ordinary trading bots are hard to trust** because their logic is off-chain and there are no truly binding guardrails.
2. **Strategies leak easily** when all signals and parameters are stored on an ordinary backend.
3. **Manual trading lacks discipline** and frequently violates risk management.
4. **Unconstrained autonomous agents are too dangerous** for retail users and small treasuries alike.
5. **AI decision history is difficult to audit** if it is only stored on a private server.

Aegis Vault solves these by:

- producing AI decisions in a structured manner,
- locking policy and risk limits inside the contract,
- allowing execution only through an authorized executor,
- recording action results and reasoning to 0G Storage,
- letting users pause the system at any time.

---

## 3. Why This Product Fits Track 2

Track 2 focuses on:

- intelligent yield optimizers,
- risk management bots,
- AI-driven strategy agents,
- privacy-preserving execution,
- mitigation against front-running.

Aegis Vault is a good fit because:

- it is a **risk-management agent**,
- it uses **AI inference** for decision making,
- it has a **verifiable on-chain policy layer**,
- it can add a **sealed / private strategy mode** in later iterations,
- it is easy to demo live.

---

## 4. Recommended Product Form

### The most realistic final MVP

**Aegis Vault v1 = spot autonomous risk-managed vault on 0G, with swap execution through the Jaine / 0G Hub stack**

Why not perps first?

- easier to finish,
- clearer venue,
- easier to demo end-to-end,
- more natural for 0G integration,
- lower risk of integration failure.

### Roadmap v2

- multi-asset vault,
- multi-strategy vault,
- cross-chain venue adapter,
- perps adapter,
- sealed inference mode,
- social vault / copy-vault.

---

## 5. System Design Principles

Aegis Vault must be built with the following principles:

### a. AI never holds absolute authority
The AI only proposes actions. The contract remains the last line of defense.

### b. All actions must pass through the policy engine
No execution is permitted outside the user's rules.

### c. Execution is separated from reasoning
Compute produces the decision, the executor handles the trade, the contract verifies the policy.

### d. Critical state must be recoverable
Policy history, risk snapshots, and the journal must be stored.

### e. The MVP must be demoable
The minimal flow must truly be alive: deposit -> inference -> policy check -> swap -> update state.

---

## 6. High-Level Architecture

```text
User
  ↓
Frontend Dashboard
  ↓
Vault Contract (0G Chain)
  ├─ Deposit / Withdraw
  ├─ Policy Storage
  ├─ Risk Guardrails
  ├─ Executor Authorization
  └─ Event Emission
        ↓
Strategy Orchestrator Backend
  ├─ Market Data Collector
  ├─ Prompt Builder
  ├─ Inference Caller
  ├─ Policy Pre-check
  └─ Execution Dispatcher
        ↓
0G Compute
  ├─ Market interpretation
  ├─ Decision generation
  └─ Optional private/sealed mode
        ↓
Executor / Venue Adapter
        ↓
Jaine / 0G Hub swap route
        ↓
Execution result
        ↓
0G Storage
  ├─ KV state
  └─ Logs / journal / reports
```

---

## 7. Main Components

## 7.1 Frontend Dashboard

Frontend responsibilities:

- create a vault,
- deposit / withdraw,
- configure policy,
- view the risk meter,
- view positions and NAV,
- view action history,
- emergency pause,
- view executor status,
- view the AI reasoning summary.

### Recommended pages

1. **Landing / product overview**
2. **Create Vault**
3. **Vault Dashboard**
4. **Risk Policy Settings**
5. **Execution History**
6. **Storage-backed Journal**
7. **Admin / Executor Monitor**

---

## 7.2 Vault Contract (0G Chain)

This is the core on-chain component.

### Primary responsibilities

- accept user deposits,
- process withdrawals,
- store the risk policy,
- store the list of assets/venues that are permitted,
- authorize the executor,
- record trade requests / trade results,
- activate pause mode,
- reject actions that violate the limits.

### Data stored

- vault owner,
- base asset,
- executor address,
- allowed assets,
- max position size,
- daily loss limit,
- leverage cap,
- global stop-loss,
- cooldown,
- active / paused status,
- cumulative pnl snapshot,
- last execution timestamp.

---

## 7.3 Strategy Orchestrator Backend

This is the off-chain layer that connects all the components.

### Responsibilities

- fetch market data,
- build inference input,
- call 0G Compute,
- validate initial results,
- compose the execution intent,
- send the action to the executor,
- write results to 0G Storage,
- update the UI/API.

### Why this backend is needed

Because the contract cannot directly pull market data or run an AI prompt.

---

## 7.4 0G Compute Layer

Its main functions:

- receive a market summary,
- produce a structured trading decision,
- return a confidence score,
- provide a reason summary,
- optional: run in private / TEE mode.

### Recommended output shape

```json
{
  "action": "buy",
  "asset": "BTC",
  "size_bps": 1200,
  "confidence": 0.82,
  "risk_score": 0.28,
  "reason": "momentum continuation with acceptable volatility",
  "ttl_sec": 180
}
```

### Why the output must be JSON

- easy to validate,
- easy to map to policy,
- easy to display in the UI,
- easy to store in 0G Storage.

---

## 7.5 Executor / Venue Adapter

This is the layer that actually executes the trade.

### The most practical answer: where is the trade executed?

For the **Aegis Vault MVP**, trades are executed through:

- the **Jaine / 0G Hub swap stack** for spot/swap execution within the 0G ecosystem.

So Aegis Vault **does not create its own market**. It merely directs vault funds to perform swaps in a disciplined way.

### Executor duties

- receive intents that have passed the policy,
- call the venue adapter,
- execute the swap,
- read the output result,
- send execution proof to the backend / contract,
- record the tx hash and result metadata.

### Recommended executor model

**Whitelisted executor** that is only permitted to:

- execute if the vault is active,
- execute if the intent has not expired,
- execute if the policy matches,
- execute once per intent,
- not modify parameters from the intent.

---

## 7.6 0G Storage Layer

0G Storage is used for two categories of data:

### Mutable state (KV)

- current equity snapshot,
- last known allocation,
- active policy cache,
- current risk state,
- last signal,
- last execution summary.

### Immutable / append-only logs

- trade journal,
- decision log,
- strategy reports,
- inference output archive,
- executor reports,
- demo screenshots / generated reports.

### Why this matters

Without proper storage, judges only see a typical AI bot. With the right storage, Aegis Vault appears as an **autonomous system with memory and audit trail**.

---

## 8. How Aegis Vault Actually Works

## Step 1 — User creates a vault
The user connects their wallet, then clicks **Create Vault**.

Minimum inputs:

- base asset: e.g. USDC,
- allowed assets: BTC, ETH,
- risk profile: Conservative / Balanced / Aggressive,
- max position size,
- max daily drawdown,
- cooldown,
- auto-execution ON/OFF.

The contract then creates a new vault.

---

## Step 2 — User deposits funds
The user deposits assets into the vault contract.

In the MVP, it is safest if:

- only a single base asset is supported,
- deposits are simple,
- withdrawals are allowed only when there is no pending execution.

---

## Step 3 — Orchestrator reads market data
The backend pulls the market data it needs, for example:

- spot price,
- short-term volatility,
- moving average,
- volume,
- spread,
- simple momentum.

For a hackathon, keep it simple. A few stable indicators are preferable.

---

## Step 4 — Data is sent to 0G Compute
The backend assembles a structured prompt / input, then sends an inference request.

Inference goals:

- determine the action,
- determine the position size,
- determine the confidence,
- determine the reason summary.

Output must always be structured.

---

## Step 5 — Policy engine validates
Before execution, the AI result is inspected.

### Minimum validations

- asset is still in the whitelist,
- size does not exceed the max limit,
- cooldown has elapsed,
- vault is not in pause mode,
- intent has not expired,
- drawdown has not crossed the threshold.

If any of these fail, the intent is rejected.

---

## Step 6 — Executor performs the swap
After validation, the executor submits the transaction to the venue.

For the MVP:

- the swap is routed through the designated path,
- the executor stores the tx hash,
- the realized output amount is read,
- execution status is returned to the system.

---

## Step 7 — Result is stored
After a successful swap:

- the contract emits an event,
- the backend updates the state snapshot,
- reasoning + result is written to 0G Storage,
- the UI displays the new history entry.

---

## Step 8 — User monitors and can pause
The user can always:

- view positions,
- view the reason summary,
- pause the vault,
- change policy,
- withdraw funds.

---

## 9. Recommended Contract Structure

For modularity, the contracts should be split apart.

## 9.1 AegisVaultFactory.sol

Functions:

- create a vault,
- store the owner -> vault list mapping,
- emit a vault-created event.

## 9.2 AegisVault.sol

Functions:

- deposit,
- requestWithdraw,
- executeIntent,
- updatePolicy,
- pause,
- unpause,
- setExecutor,
- recordExecution,
- emergencyWithdraw.

## 9.3 PolicyLibrary.sol

Contains:

- max position validation,
- cooldown validation,
- asset whitelist validation,
- loss limit validation,
- risk check helpers.

## 9.4 ExecutionRegistry.sol

Functions:

- store intent hashes that have been executed,
- prevent replay,
- store execution status.

## 9.5 VaultEvents.sol

Optional, useful to keep event structs clean and reusable.

---

## 10. Recommended Data Model

### VaultPolicy

```solidity
struct VaultPolicy {
    uint256 maxPositionBps;
    uint256 maxDailyLossBps;
    uint256 stopLossBps;
    uint256 cooldownSeconds;
    bool autoExecution;
    bool paused;
}
```

### ExecutionIntent

```solidity
struct ExecutionIntent {
    bytes32 intentHash;
    address vault;
    address assetIn;
    address assetOut;
    uint256 amountIn;
    uint256 minAmountOut;
    uint256 createdAt;
    uint256 expiresAt;
    uint256 confidenceBps;
    uint256 riskScoreBps;
}
```

### ExecutionResult

```solidity
struct ExecutionResult {
    bytes32 intentHash;
    bytes32 venueTxRef;
    uint256 amountIn;
    uint256 amountOut;
    uint256 executedAt;
    bool success;
}
```

---

## 11. User Flow

## 11.1 Create Vault Flow

1. User connects the wallet.
2. User picks a base asset.
3. User sets a risk profile.
4. User approves the deposit.
5. User creates the vault.
6. Frontend redirects to the dashboard.

## 11.2 Auto Execution Flow

1. Market data refreshes.
2. Inference request is built.
3. 0G Compute returns an output.
4. Policy check passes.
5. Intent is formed.
6. Executor sends the swap.
7. Result is recorded.
8. UI refreshes.

## 11.3 Emergency Pause Flow

1. User clicks pause.
2. Contract sets paused = true.
3. The executor automatically halts.
4. All new intents are rejected.
5. User can choose to withdraw or reconfigure.

---

## 12. Risk Engine Logic

Aegis Vault must focus on **risk-first automation**, not all-in alpha hunting.

### Simple rules that suit the MVP

- maximum 20% of funds per action,
- maximum 2 actions within a given window,
- cooldown of 5–15 minutes,
- no trade if volatility is too high,
- no trade if confidence is below the threshold,
- no trade if the slippage estimate is too large,
- no trade if the vault has just taken consecutive losses.

### Score-based rules

You can also apply a simple model:

`final_trade_allowed = confidence_ok && volatility_ok && drawdown_ok && cooldown_ok && policy_ok`

This is easy to explain during the demo.

---

## 13. Why Execution Through Jaine / 0G Hub Fits the MVP

Technical and product reasoning:

1. **More natural for the 0G ecosystem**
2. **Easier to verify on-chain**
3. **Simpler for an end-to-end demo**
4. **No need to build your own matching engine**
5. **Reduces integration failure risk**

With this approach, Aegis Vault still fulfills the agentic trading character, because the product's value proposition is:

- the agent picks the action,
- the policy locks behavior,
- the executor performs the swap,
- the user can audit everything.

---

## 14. Privacy Mode / Sealed Strategy (Roadmap or Bonus)

Once the MVP is stable, the next strong feature is **sealed strategy mode**.

### Goals

- strategy parameters do not leak,
- prompts are not visible in the open,
- sensitive reasoning is processed privately,
- users/protocols can use proprietary logic.

### Phased implementation

#### Phase 1
- regular inference,
- limited public reasoning summary.

#### Phase 2
- TEE-verified provider,
- sealed inputs,
- signed inference metadata.

#### Phase 3
- encrypted strategy blobs on 0G Storage,
- policy-aware sealed execution.

---

## 15. Security Considerations

This is an important section for the submission.

### Main risks

#### a. Executor abuses its rights
Mitigations:
- whitelist the executor,
- single-use intent hashes,
- expiry,
- on-chain policy check,
- pause mechanism.

#### b. AI issues a bad decision
Mitigations:
- AI only proposes,
- contract enforces hard limits,
- size is capped,
- cooldown is mandatory,
- confidence threshold.

#### c. Replay attack on an execution intent
Mitigations:
- store the intent hash,
- reject duplicates.

#### d. Withdraw while state has not yet synchronized
Mitigations:
- pending execution lock,
- last execution finality check.

#### e. Slippage is too large
Mitigations:
- min amount out,
- slippage cap per policy,
- pre-trade estimation.

#### f. Market data is corrupted / stale
Mitigations:
- timestamp check,
- dual-source sanity check,
- no-trade on stale data.

---

## 16. The Safest MVP Scope for a Solo Builder

To truly finish, the scope must be bounded.

### Features that MUST exist

- create vault,
- deposit,
- update policy,
- pause/unpause,
- inference call to 0G Compute,
- a single spot execution route,
- on-chain event log,
- journal to 0G Storage,
- vault status dashboard.

### Features NOT required for the MVP

- multi-user pooled vault,
- multi-venue routing,
- advanced portfolio optimization,
- leverage/perps,
- copy trading,
- DAO governance,
- tokenomics.

---

## 17. A Strong Demo Flow for Judges

Here is the most effective demo flow:

### Demo Scene 1 — Create and Fund Vault
- connect wallet,
- create a vault,
- set the risk policy,
- deposit funds.

### Demo Scene 2 — AI Decision
- display the market signal,
- call 0G Compute,
- display the structured output,
- show the confidence and reason summary.

### Demo Scene 3 — Policy Enforcement
- show that an oversized size will be rejected,
- then show a valid intent passing.

### Demo Scene 4 — Swap Execution
- executor submits the swap,
- show the tx hash,
- show the state changing.

### Demo Scene 5 — Audit Trail
- open the event history,
- open the reasoning journal from 0G Storage,
- show that the action can be traced.

### Demo Scene 6 — Emergency Pause
- click pause,
- show that a new intent fails.

This lets the judges see four things at once:

- the AI is real,
- the contracts are real,
- the storage is real,
- the UX is clear.

---

## 18. Recommended Tech Stack

### Smart Contract
- Solidity
- Hardhat or Foundry
- OpenZeppelin base contracts

### Frontend
- Next.js
- TypeScript
- Tailwind CSS
- wagmi / viem

### Backend / Orchestrator
- Node.js / TypeScript
- simple cron / queue
- inference caller service
- execution service
- storage writer service

### Indexing / Data
- subgraph or event listener
- optional local PostgreSQL for UI cache

### 0G Integrations
- 0G Chain RPC
- 0G Compute inference API
- 0G Storage SDK

---

## 19. Recommended Repo Structure

```text
AegisVault/
├─ apps/
│  ├─ web/
│  └─ orchestrator/
├─ contracts/
│  ├─ src/
│  │  ├─ AegisVault.sol
│  │  ├─ AegisVaultFactory.sol
│  │  ├─ ExecutionRegistry.sol
│  │  └─ libraries/
│  └─ test/
├─ packages/
│  ├─ sdk/
│  ├─ ui/
│  └─ shared-types/
├─ docs/
│  ├─ architecture.md
│  ├─ demo-flow.md
│  └─ deployment.md
└─ README.md
```

---

## 20. 7-Day Build Roadmap

## Day 1
- set up the repo,
- deploy basic contracts,
- create vault + deposit.

## Day 2
- add policy storage,
- pause/unpause,
- executor whitelist.

## Day 3
- integrate 0G Compute,
- standardize the JSON output.

## Day 4
- build the orchestrator,
- market input,
- intent builder.

## Day 5
- swap execution adapter,
- record result,
- event tracking.

## Day 6
- integrate 0G Storage,
- journal page,
- risk dashboard.

## Day 7
- polish the UI,
- demo script,
- README,
- contract addresses and explorer links.

---

## 21. Why Aegis Vault Is Strong in the Judges' Eyes

Aegis Vault checks every evaluation area:

### 0G Technical Integration Depth & Innovation
- uses 0G Chain,
- uses 0G Compute,
- uses 0G Storage,
- can be extended with a private mode.

### Technical Implementation & Completeness
- has real contracts,
- has a deployable MVP,
- has an end-to-end flow,
- has on-chain verification.

### Product Value & Market Potential
- addresses risk management,
- can extend into treasury automation,
- fits retail power users and small funds.

### User Experience & Demo Quality
- the flow is easy to explain,
- the results are visual,
- a live demo can land strongly.

### Team Capability & Documentation
- the documentation can be very polished,
- the architecture story is clear,
- open-source friendly.

---

## 22. Conclusion

The most realistic version of Aegis Vault is:

> **An AI-managed spot trading vault on 0G that automatically executes swaps through a venue in the 0G ecosystem, with on-chain risk policy and audit/memory on 0G Storage.**

This is the best sweet spot between:

- feasibility for a solo builder,
- depth of 0G integration,
- demo-day impact,
- and a real chance of actually finishing.

If you want to win, Aegis Vault should not be pitched as "just another trading bot."

The more accurate narrative is:

> **Aegis Vault is a verifiable AI risk manager for on-chain execution.**

---

## 23. Most Useful Next Documents

After this document, the three most useful follow-up files are:

1. `smart-contract-architecture.md`
2. `README_hackathon_submission.md`
3. `7_day_build_plan.md`

---

## 24. One-Line Pitch

**Aegis Vault enables users to deposit into a policy-constrained AI vault that autonomously executes on-chain swaps while keeping every action auditable, risk-limited, and storage-backed by the 0G stack.**
