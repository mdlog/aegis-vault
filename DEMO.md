# Aegis Vault — Demo Walkthrough

A 10-15 minute guided tour through the full Phase 1-5 production stack. Use this as a script for hackathon demos, judge walkthroughs, or screen recordings.

**Prerequisites:**
- Contracts deployed via `scripts/deploy-all.js`
- Orchestrator running on `localhost:4002`
- Frontend running on `localhost:5173`
- Two MetaMask accounts with test 0G tokens:
  - **Account A** — User (depositor / vault owner)
  - **Account B** — Operator (runs the AI bot + stakes)
- Test USDC minted to both accounts (via `MockERC20.mint()`)

---

## Scene 1 — Landing & Story (1 min)

**Open:** `http://localhost:5173/`

> "Aegis Vault is an AI-managed trading vault where **the contract enforces every rule**.
> The AI proposes trades — the vault decides whether to execute them based on policy you set.
> Unlike Set Protocol or Melon, our operators have **skin in the game**: they stake USDC,
> their reputation is on-chain, and slashing is governed by a multi-sig."

Point to the three differentiators on the landing page:
- **Fee-aware economics** — HWM performance fee, 80/20 protocol cut
- **Skin in the game** — 5 staking tiers gate vault sizes
- **On-chain reputation** — every execution logged, ratings tied to wallets

---

## Scene 2 — Register as Operator (Account B, ~2 min)

**Navigate:** `/operator/register`

**Fill in:**
- **Name:** `Alpha Momentum Bot`
- **Description:** `Conservative momentum strategy. Long BTC/ETH on strong upward regimes, rotates to USDC during high volatility.`
- **Mandate:** `Balanced`
- **Endpoint:** (leave empty or paste orchestrator URL)

**Fee Structure panel:**
- Performance fee: **15%** (default)
- Management fee: **2%** (default)
- Entry fee: **0%**
- Exit fee: **0.5%**

> "Notice the 20% protocol cut disclaimer — every fee dollar an operator earns is split 80/20 with the protocol treasury. This funds audits, grants, and insurance pool top-ups."

**Recommended Policy panel:**
- Max position: `50%`
- Min confidence: `60%`
- Stop-loss: `15%`
- Cooldown: `15 min`
- Max trades / day: `20`

> "These are the operator's *suggested* risk params. Users can override them when creating a vault — your vault, your rules."

**Click "Register"** → MetaMask → confirm.

**Result:** You are now a registered operator.

---

## Scene 3 — Stake to Unlock Tier (Account B, ~2 min)

**Navigate:** `/operator/<your wallet>` (Account B)

Scroll to the **"Skin in the Game · Stake"** panel.

> "Right now I'm tier **None** — I can only manage vaults up to $5k. Watch what happens when I stake."

**Stake form:**
- Input: `10000`
- Click **Approve USDC** → MetaMask → confirm
- Click **Stake** → MetaMask → confirm

**Watch:**
- Active stake jumps to **$10,000**
- Tier badge changes to **Silver** 🥈
- Vault cap jumps to **$500k**
- Progress bar shows: `$90,000 more to unlock Gold ($5M cap)`

> "One stake transaction and I just unlocked the ability to manage half a million dollars.
> Importantly — this stake is **slashable**. If I misbehave, governance can burn up to 50% of it per action."

---

## Scene 4 — Browse Marketplace (Account A, ~1 min)

**Switch to Account A.** **Navigate:** `/marketplace`

Point out the filters:
- **Mandate filter** — Conservative / Balanced / Tactical
- **Fee filter** — ≤ 10% perf, ≤ 20% perf
- **Tier filter** — Bronze+ / Silver+ / Gold+
- **Verified only** — (empty for now — no verified operators yet)
- **Sort by** — Newest / Reputation / Most Trades / Lowest Fee / Highest Tier

Click into the operator you just registered.

> "Here's the full profile. You can see the declared fees, the annual cost estimate on a $10k vault at 10% expected return, the recommended policy, and the stake panel showing Silver tier. Zero executions yet because it's brand new."

---

## Scene 5 — Create Vault (Account A, ~3 min)

**Click "Back to Marketplace"**, then **"Create Vault"** in the top nav (or go to `/create`).

**Step 1: Deposit**
- Amount: `$50,000`

**Step 2: Risk Profile**
- Click **Balanced**

**Step 3: Policy**
- Defaults are fine — point out that every slider here maps to an on-chain check

**Step 4: Assets**
- Select BTC, ETH, USDC (default)

**Step 5: Privacy & Execution**
- Leave Sealed Mode OFF
- Auto-execution ON

**Step 6: Review**

Scroll down to **"Executor"** — the marketplace option should be highlighted with a "RECOMMENDED" badge.

Pick **the operator you just registered from Scene 2**. Notice:
- The operator's tier badge (Silver) + vault cap ($500k)
- The fee preview inline: `Perf 15% · Mgmt 2% · Entry 0% · Exit 0.5%`
- **"Cap $500k"** in emerald green (well above our $50k deposit)

Scroll further — the **"Operator Fees"** preview panel now shows:

```
Entry    $0       Mgmt/yr  $1,000   Perf/yr  $750    Total/yr $1,750
```

> "Full transparency — before I deposit a single dollar, I know exactly what this operator will cost me in the first year."

**Click "Deploy Vault"** → MetaMask → two transactions (approve USDC + createVault) → confirm both.

After ~4 seconds you'll be redirected to the dashboard.

---

## Scene 6 — Vault Detail + Deposit (Account A, ~2 min)

**Click the new vault in the dashboard** → you land on `/app/vault/<address>`

Point out:
- NAV: `$50,000`
- All-Time Return: `0%` (brand new)
- Risk Score: computed from policy
- Policy chips show every enforced rule

Scroll to the **"Operator Fees"** panel. Highlight:
- Live NAV: `$50,000`
- High-Water Mark: `$50,000` (initialized on first deposit)
- Accrued: `$0 / $0 / $0` (no fees yet)

> "The vault just initialized the high-water mark. From now on, the operator earns a performance fee **only on profit above $50k**. If we drop to $45k and recover, zero perf fee."

---

## Scene 7 — Orchestrator Executes (Account B → automated, ~2 min)

Open a terminal showing orchestrator logs:

```bash
tail -f orchestrator/logs/decisions.log
```

Or watch the orchestrator stdout. Point out the cycle:

```
[cycle] Reading vault 0x...
  NAV: $50,000 | Base: $50,000 | Paused: false | Actions: 0 | Position: flat
  Operator: Alpha Momentum Bot · Silver · stake $10000 · rep 0x (0% success)
  Inference → 0G Compute (GLM-5-FP8)...
  Decision: BUY BTC 30% · conf 75% · risk 28%
  Decision Engine v1: regime UP_STRONG · edge 72 · quality 81
  Policy pre-check: PASS
  Building intent...
  Submitting executeIntent() → 0x7a8b...
  ✓ Executed · swapped 15000 USDC → 0.214 WBTC
  ✓ Reputation recorded: +1 execution, +$15k volume
```

**Back in the browser, refresh the vault page.**

- NAV: still around $50k (± slippage)
- Allocation panel now shows **BTC** as a position
- AI Reasoning Journal has a new entry

**Navigate to `/operator/<operator wallet>`** (or click the operator name on the vault page).

The **Reputation panel** now shows:
- **Executions: 1**
- **Success: 100%**
- **Volume: $15,000**
- **Composite score: 50/100** (rising)

> "The reputation update is fully on-chain. There's no centralized server tracking stats —
> the vault itself called `OperatorReputation.recordExecution()` inside the same `executeIntent` transaction."

---

## Scene 8 — Fast-Forward Fee Accrual (optional, ~1 min)

If running on Hardhat local:

```bash
# In hardhat console
npx hardhat console --network localhost
> await ethers.provider.send("evm_increaseTime", [90 * 24 * 3600])  // 3 months
> await ethers.provider.send("evm_mine")
```

Back on the vault page, click **"Accrue Fees"**:

- Accrued Mgmt: `~$250` (2% annual × 0.25 year × $50k)
- Accrued Perf: depends on price movement

If connected as the operator (Account B), click **"Claim Fees"**:

- Operator receives 80% of accrued
- Treasury receives 20%
- Toast message: *"Fees claimed · 80% to operator · 20% to protocol treasury"*

---

## Scene 9 — Governance & Slashing (Hackathon showstopper, ~3 min)

**Switch to a Governor Owner account** (use deployer if deployed with default 1-of-1).

**Navigate:** `/governance`

Show the dashboard stats:
- Multi-sig threshold
- Total proposals
- Treasury balance
- Total staked (should show $10k)
- Insurance pool balance

> "This is the governance war room. Slashing, treasury spending, granting verified badges —
> everything sensitive flows through M-of-N proposals."

**Click "New Proposal"** → **Action: "Grant Verified Badge"**

- Operator Address: (paste Account B address)
- Verified?: `true`

**Submit** → MetaMask → confirm.

If threshold > 1, other owners need to **Confirm**. For a 1-of-1 local setup, click **Execute** immediately.

Go back to the operator profile page → the **VERIFIED** badge now appears next to the name. Composite reputation score jumps by +20.

> "Verified operators rank above unverified ones in marketplace search. This is a protocol-level signal that governance has vetted the operator."

**Now the slashing demo.** Back in `/governance` → **New Proposal** → **Action: "Slash Operator"**

- Operator Address: (Account B)
- Slash Amount: `3000`
- Reason: `performance_manipulation_test`

**Submit + Execute** (or freeze first, then slash).

Go to the operator profile:
- Active stake drops: $10k → $7k
- Tier downgrades: **Silver → Bronze**
- Lifetime slashed: `$3,000` (in red)
- Insurance pool balance: up $3k

Now **Account A** (vault owner) submits an insurance claim via the API or a future UI:

```bash
# One-shot via ethers console
await insurancePool.connect(accountA).submitClaim(parseUnits("1500", 6), "lost funds from slash incident")
```

Back in governance → **New Proposal** → **Action: "Pay Insurance Claim"**

- Claim ID: `1`
- Payout: `1500`

Execute. Account A receives 1500 USDC. Insurance pool drops to $1.5k.

> "Full end-to-end: user loses funds → on-chain arbitration → slash → pay out from insurance pool.
> No centralized servers, no manual wire transfers, no trust required."

---

## Scene 10 — Wrap-up (30 sec)

Show the repo in the terminal:

```bash
cd contracts && npx hardhat test --grep "End-to-End"
```

```
End-to-End (Phase 5 full stack)
  ✓ should execute the full production lifecycle (501ms)

1 passing
```

> "Every step you just saw is covered by an automated integration test. 135 tests across
> 6 suites, all passing. The demo we just ran in 15 minutes runs in under a second on CI."

---

## Troubleshooting

| Issue | Fix |
|---|---|
| "Registry not deployed" on marketplace | Check `deployments.json`, rerun `sync-frontend.js` |
| "TIER_CAP_EXCEEDED" in orchestrator logs | Operator needs more stake for the vault size |
| Rating button missing | You're either the operator self, not connected, or have already rated |
| "Frozen" badge on operator | Governance locked the stake; unfreeze via proposal |
| Fees not accruing | Call `accrueFees()` manually or wait for the next deposit/withdraw |

## Key URLs for Demo

| Path | Purpose |
|---|---|
| `/` | Landing page |
| `/marketplace` | Operator browse + filter |
| `/operator/register` | Operator onboarding (fees + recommended policy) |
| `/operator/<addr>` | Operator profile (stake + reputation + rating) |
| `/create` | 6-step vault creation wizard |
| `/app` | User dashboard |
| `/app/vault/<addr>` | Vault detail (fees, policy, actions, journal) |
| `/governance` | Multi-sig proposal dashboard |

## Key Transactions to Show

| Action | Contract Call |
|---|---|
| Register operator | `OperatorRegistry.register(OperatorInput)` |
| Stake | `USDC.approve` + `OperatorStaking.stake` |
| Create vault | `AegisVaultFactory.createVault(...)` |
| Deposit | `USDC.approve` + `AegisVault.deposit` |
| Execute intent | `AegisVault.executeIntent(intent)` |
| Record reputation | auto — via `executeIntent` |
| Claim fees | `AegisVault.claimFees()` |
| Slash | `AegisGovernor.submit` → `confirm` → `execute(slash)` |
| Insurance payout | `AegisGovernor.submit` → `execute(payoutClaim)` |

All transactions visible on [chainscan-galileo.0g.ai](https://chainscan-galileo.0g.ai).
