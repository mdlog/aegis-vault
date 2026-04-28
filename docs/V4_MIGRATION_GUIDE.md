# V3 → V4 Migration Guide

Version 1.0 · 2026-04-27

This guide is for **vault depositors** who are running on `AegisVaultFactoryV3` and want to move their funds onto the V4 multi-strategy stack. It does **not** apply to operators registering for the first time — see [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) for that.

---

## TL;DR

Migration is **opt-in** and **per-vault**. V3 stays online indefinitely. To move:

1. Pause the V3 vault.
2. Withdraw all assets (non-base first, then base).
3. Create a new V4 vault via `AegisVaultFactoryV4.createVault(...)` with the operator's currently published `acceptedManifestHash`.
4. Deposit into the new vault.

The frontend wizard automates these steps. The CLI walkthrough below is for users who prefer to drive the migration directly.

---

## What's new in V4

V3 already binds the AI signing key + attestation report into every executed intent. V4 closes the **last remaining off-chain trust assumption**: the operator's *strategy framework* is config-driven, so two operators sharing one orchestrator binary distinguish themselves only by a JSON manifest. V4 binds the keccak256 of that manifest into the vault as `acceptedManifestHash`, and `executeIntent` reverts whenever the orchestrator submits an intent whose declared `strategyHash` does not match.

The full scheme:

| Concept                | V3                                                | V4                                                                 |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| Operator strategy      | Off-chain JSON, governance-audited                | On-chain `acceptedManifestHash` bound at create time               |
| Manifest enforcement   | Orchestrator-side (operator can in principle deviate without breaking any contract check) | Vault-side: `intent.strategyHash == acceptedManifestHash`, reverts otherwise |
| Manifest upgrade       | Operator publishes a new file; orchestrator picks it up immediately | Two-step: `requestManifestUpgrade` → 24-hour timelock → `applyManifestUpgrade` |
| Schema versioning      | Best-effort                                       | Vault enforces `1 ≤ strategySchemaVer ≤ MAX_SUPPORTED_SCHEMA_VER`  |
| Provenance event       | None                                              | `StrategyApplied(bytes32 strategyHash, uint32 schemaVer)` per intent |
| Storage layout         | V3 slot map                                       | V3 slot map + appended V4 fields (independent clones, not in-place upgrade) |

V3 vaults are not upgraded in place because EIP-1167 clones cannot grow their storage map without breaking the existing slot layout. V4 introduces a fresh implementation + a fresh factory; users opt in by creating a new vault.

---

## Why migrate

You should migrate if **any** of the following matter to you:

- **Cryptographic assurance** that the orchestrator is following the strategy your operator advertised. A V4 vault guarantees this; a V3 vault relies on governance audit + reputation.
- **24-hour notice** before an operator can change strategies. In V3 the change is instantaneous. In V4 the depositor is the only address that can update the commitment, and the change has a hard timelock so the depositor (or a watcher) can react.
- **Indexable strategy provenance**: the `StrategyApplied` event tags every executed intent with the strategy hash + schema version, so dashboards can attribute outcomes to specific strategies.
- **Future-proofing**: post-V1 schema upgrades will be enforced by the vault. A V3 vault has no way to reject a v2-schema intent if the operator's framework moves ahead.

You can stay on V3 if you trust your operator's off-chain governance (e.g. you are running your own orchestrator) and do not need on-chain strategy attribution.

---

## Pre-flight checklist

Before you start:

- [ ] You know the operator's currently published `manifestHash`. Read it from the V4 frontend, or from `OperatorRegistryV2.getOperator(operator).manifestHash`.
- [ ] You have enough gas in the depositor wallet (~2× a normal trade — withdraw + create + deposit).
- [ ] No open positions in the V3 vault, or you accept that `withdrawAllNonBase` will return them at current market value to the depositor wallet.
- [ ] You have noted your V3 vault address — needed for the post-migration accounting check.

To inspect your V3 vault's state programmatically:

```bash
# From the contracts/ directory; produces a per-vault recipe ready to feed into V4 factory.
node scripts/migrate-v3-to-v4.js --output ./v3-to-v4-plan.json
```

This is a **read-only planner**. It calls no transactions. It enumerates every V3 vault, snapshots state, looks up the operator's currently published manifest hash, and writes a JSON plan with the exact `createVault(...)` arguments for V4.

---

## Step-by-step

The frontend wizard executes all five steps for you. The manual flow is below; addresses are taken from `contracts/deployments-mainnet.json`.

### Step 1 — Pause the V3 vault

```solidity
AegisVault_v3(vaultAddr).pause();
```

This blocks any further `executeIntent` while you drain the vault. Only the depositor (`owner`) can call `pause`. If the operator has an open intent in flight you will hit a benign revert; wait for it to settle (or the cooldown to expire) and try again.

### Step 2 — Withdraw all non-base tokens

```solidity
AegisVault_v3(vaultAddr).withdrawAllNonBase();
```

This drains every whitelisted asset that is not the base asset back to the depositor wallet. If the vault held WBTC / WETH at market, you receive those tokens at their current quantity. Convert them off-platform if you want to redeposit only base into V4.

### Step 3 — Withdraw the base asset

```solidity
uint256 amount = AegisVault_v3(vaultAddr).totalDeposited();
AegisVault_v3(vaultAddr).withdraw(amount);
```

Sends the remaining base asset (e.g. USDC.e) back to the depositor. Apply the exit fee (`policy.exitFeeBps`) if your vault has one configured.

### Step 4 — Create the V4 vault

```solidity
IERC20(baseAsset).approve(v4FactoryAddr, type(uint256).max);

address newVault = AegisVaultFactoryV4(v4FactoryAddr).createVault(
    operatorAddress,        // same operator as before, or a different one
    baseAsset,              // same base asset
    venue,                  // JaineVenueAdapterV2 or KhalaniVenueAdapter
    policy,                 // VaultPolicy struct (copy from V3 or update)
    allowedAssets,          // same whitelist (or trim down)
    maxCrossChainFeeBps,    // e.g. 50
    acceptedManifestHash    // operator's current manifest hash (or 0 for unbound mode)
);
```

The `acceptedManifestHash` is the load-bearing new parameter. Three choices:

- **Operator's currently published hash** (recommended). The orchestrator can immediately sign intents.
- **A specific historical hash** (advanced) if you want to pin to a strategy version that the operator has since superseded. The orchestrator must continue to use that older manifest.
- **`bytes32(0)`** ("unbound" mode). The vault accepts only zero-hash strategy intents. This is the V3-equivalent behavior — useful when the operator has not yet published a manifest, but reduces the V4 trust upgrade to nothing. You can later use `requestManifestUpgrade` → `applyManifestUpgrade` (24h timelock) to bind a real hash.

### Step 5 — Deposit

```solidity
AegisVault_v4(newVault).deposit(amount);
```

Same surface as V3. Apply the entry fee (`policy.entryFeeBps`) if configured.

After deposit, the new vault is live. The orchestrator picks it up on its next cycle (it polls the factory for new vaults).

---

## Rollback

The migration is **non-destructive**. The V3 vault still exists and is fully operational — `pause` is reversible via `unpause`, and you can resume V3 trading at any time without affecting the V4 vault.

If you decide V4 was the wrong choice:

1. Pause the V4 vault.
2. Withdraw via the same withdraw / withdrawAllNonBase pattern.
3. Re-deposit into the V3 vault.

There is no protocol-level coupling between V3 and V4 vaults beyond the shared `ExecutionRegistry` (which is just a replay guard).

---

## Future manifest upgrades

Once you are on V4, switching strategies is a deliberate two-step:

```solidity
// 1. Queue the new hash. Starts a 24-hour timelock.
AegisVault_v4(vaultAddr).requestManifestUpgrade(newHash);

// 2. After 24 hours have elapsed:
AegisVault_v4(vaultAddr).applyManifestUpgrade();
```

You can cancel a queued upgrade at any time before applying it:

```solidity
AegisVault_v4(vaultAddr).cancelManifestUpgrade();
```

Re-requesting a different hash before applying will **overwrite** the pending value and **restart the timer** — useful if you typo'd the first request.

Only the depositor (`owner`) can call any of these three functions. The operator publishes new manifests off-chain but cannot unilaterally change what the on-chain vault accepts.

---

## FAQ

**Q: Is migration mandatory?**
No. V3 stays operational. There is no deprecation timeline currently announced.

**Q: Will the orchestrator drop my V3 vault when V4 launches?**
No. The orchestrator runs both V3 and V4 vaults in parallel. V3 vaults continue to work exactly as today.

**Q: My operator publishes a new manifest tomorrow. Will my V4 vault automatically follow?**
No, and that is the point. You will see the new hash in the operator's profile (or get a notification from the indexer). To accept it, call `requestManifestUpgrade(newHash)` — there is then a 24-hour window during which you can `cancelManifestUpgrade()` if you change your mind.

**Q: Can the operator force-upgrade my V4 vault?**
No. Only the depositor (`owner`) can call `requestManifestUpgrade` / `applyManifestUpgrade` / `cancelManifestUpgrade`. The operator role (`executor`) cannot touch the manifest commitment.

**Q: I created a V4 vault with `acceptedManifestHash == 0`. How do I bind a real hash later?**
Call `requestManifestUpgrade(newHash)` followed by `applyManifestUpgrade()` after 24h. Note that the contract will not accept a zero-hash request because zero is the "no upgrade in flight" sentinel — to go from zero → real you must request a real hash directly.

**Q: What happens if my operator changes the strategy off-chain but I don't upgrade?**
The orchestrator will sign intents with the new manifest's hash. Your V4 vault will revert every `executeIntent` with `WrongStrategyHash` until you upgrade (or cancel and re-bind to the older hash). Trading effectively halts — which is the safe default.

**Q: What about cross-chain (Khalani) fills?**
The cross-chain acceptance path (`acceptCrossChainFill`) is bit-identical between V3 and V4 — no strategy binding is enforced on cross-chain fills because the off-chain Khalani intent is already signed by the same TEE-attested key that signs swap intents. The `StrategyApplied` event only fires from the on-chain swap path (`executeIntent`).

**Q: Where is the V4 factory deployed?**
Pending — V4 is staged behind this migration tooling. The deployment plan (operator-facing) is documented in [V4_DEPLOYMENT_PLAN.md](V4_DEPLOYMENT_PLAN.md). Once the V4 factory is live, its address will be added to `contracts/deployments-mainnet.json` under `aegisVaultFactoryV4`.
