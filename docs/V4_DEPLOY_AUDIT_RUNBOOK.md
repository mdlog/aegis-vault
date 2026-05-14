# V4 Deploy — Audit Fixes Runbook

Pre-deploy checklist + step-by-step operations to land the audit-fix patch
batch alongside the V4 rollout. Reference companion docs:
[V4_DEPLOYMENT_PLAN.md](V4_DEPLOYMENT_PLAN.md) · [V4_MIGRATION_GUIDE.md](V4_MIGRATION_GUIDE.md).

## What this round changes

Patches landed in code (test suite: **285 passing**):

| Contract | Change | Audit ref |
|---|---|---|
| `v4/AegisVault_v4.sol` | Init-locking constructor; atomic `setAttestedSigner(0)` clears `sealedMode` | H-1, M-V4-1 |
| `v4/AegisVaultFactoryV4.sol` | `executionRegistry` marked `immutable` | M-V4-2 |
| `VaultNAVCalculator.sol` | Reject `expo >= 0`; `removeAssetAt(index)`; `pyth` `immutable`; constructor zero-check; `updatePriceFeeds` refunds overpayment | H-2, H-3, H-4, M-Infra-5 |
| `JaineVenueAdapterV2.sol` | Fail-closed on dead pool; slippage cap 2000→500 bps; balance-delta verification; `addFeeTier` dedup + nonzero; `setPyth` requires contract code; `registerAsset` decimals ≤ 18; `TokensRescued` event | H-5, M-Adapter-1, M-Adapter-2, M-Adapter-3, Tier4 Lows |
| `UniswapV3VenueAdapter.sol` | Same set as Jaine (mirrored) | H-5, M-Adapter-* |
| `ProtocolTreasury.sol` | `transferAdmin` → 2-step (`pendingAdmin` + `acceptAdmin` + `cancelAdminTransfer`); `setSpender` zero-check; `NativeTransferFailed` custom error | M-Infra-1 |
| `AegisVault_v3.sol` | Atomic `setAttestedSigner(0)` clears `sealedMode` (mirrors V4) | M-V4-1 mirror |

New script: [`scripts/rotate-2step-admins.js`](../contracts/scripts/rotate-2step-admins.js)
— handles the new Ownable2Step pattern.

## Deploy decision tree

```
                               ┌──────────────────────────────┐
                               │  Are V4 vaults already live? │
                               └──────────────┬───────────────┘
                                       ┌──────┴──────┐
                                       no            yes
                                       │             │
                              ┌────────▼─────────┐  ┌▼────────────────────────────┐
                              │ Greenfield path  │  │ Blue/green migration needed │
                              │ (this runbook)   │  │ (see V4_MIGRATION_GUIDE.md) │
                              └──────────────────┘  └─────────────────────────────┘
```

Today (May 2026) **V4 is not yet deployed** on 0G mainnet — we are on the
greenfield path. The patches will go live in the first V4 deploy.

## Phase 1 — pre-deploy (local)

```bash
cd contracts
npx hardhat compile        # confirm clean compile (1 warning re: unused
                           # ExecLib.baseAssetAddr param is pre-existing)
npx hardhat test           # 285 passing, 0 failing, 10 pending
npx hardhat run scripts/whoami.js --network og_mainnet   # confirm deployer key
```

Verify **deployer USDC balance ≥ 0.5 0G** for gas headroom on the V4 stack.

## Phase 2 — deploy patched contracts (mainnet)

Run **in this order** — each step is idempotent (skips already-deployed
addresses) so re-running on partial failure is safe.

### 2.1 — VaultNAVCalculator (replaces existing)

```bash
DEPLOYER_PRIVATE_KEY=<deployer> npx hardhat run scripts/redeploy-nav-calc.js \
  --network og_mainnet
```

Effect: deploys a new `VaultNAVCalculator` at a new address; old calculator
(`0xBd21bfd6…`) becomes orphaned. The existing redeploy script auto-registers
USDC.e / WETH / WBTC / W0G with their current Pyth feed IDs.

Why mandatory: `pyth` is now `immutable`, so the constructor binding cannot
be migrated on the live contract. The patches (`PriceUnsupportedExpo`,
`removeAssetAt`, overpayment refund) are bytecode-level and require fresh
deploy.

Post-deploy: `deployments-mainnet.json::vaultNAVCalculator` is updated
automatically. The old address remains in chain state but should be ignored
by all integrators.

### 2.2 — JaineVenueAdapterV2 (alongside existing)

```bash
CONFIRM_MAINNET=1 EXECUTOR_ADDRESS=0x98cC8351...  \
  npx hardhat run scripts/deploy-jaine-adapter-v2.js --network og_mainnet
```

Effect: deploys a fresh `JaineVenueAdapterV2` at a new address. The existing
adapter (`0x261244…`) **is not modified or deauthorized** — V3 vaults pinned
to it continue to work (they're allowed to keep using the old adapter; their
owner can opt in to the new one via `setVenue` if desired).

Why additive: vault `venue` is per-clone state; each existing V3 clone has
its own `venue` slot. Replacing the global adapter would require touching
each clone — instead, V4 vaults will be created pointing at the new adapter
from inception, and V3 owners can opt in individually.

Post-deploy: `deployments-mainnet.json::jaineVenueAdapterV2` updated.

### 2.3 — V4 stack

```bash
CONFIRM_MAINNET=1 npx hardhat run scripts/deploy-v4.js --network og_mainnet
```

Effect: deploys `ExecLibV4` + **`CrossChainLibV4`** (V4-only — V3 lib has
the wrong typehash) + `AegisVault_v4` (impl) + `AegisVaultFactoryV4`,
authorizes the V4 factory in the existing `ExecutionRegistry`. The
**implementation** carries the constructor lock fix (H-1) — anyone calling
`initialize` on the impl directly will revert. Clones are unaffected.

Post-deploy:
- `deployments-mainnet.json::aegisVaultFactoryV4` + `crossChainLibraryV4` etc. updated
- `executionRegistryV3.authorizedFactories(factoryV4) == true`

### 2.4 — Fresh marketplace (for clean-slate cutover)

For a truly clean V4 launch where the operator marketplace must start
with zero operators / zero stakers / zero claim history, deploy a fresh
marketplace stack. The 4 contracts are interlinked (staking's `registry`
is `immutable`, pool's `setNotifier` is arbitrator-gated), so they
deploy together.

```bash
ROTATE_TO_GOVERNOR=1 CONFIRM_MAINNET=1 \
  npx hardhat run scripts/deploy-fresh-marketplace.js --network og_mainnet
```

Effect:
- Deploys fresh `OperatorRegistry` (empty operator list).
- Deploys fresh `InsurancePool_v2` (deployer as initial arbitrator).
- Deploys fresh `OperatorStaking_v2` (bound to fresh registry + fresh pool;
  deployer as initial arbitrator).
- Deploys fresh `OperatorReputation` (deployer as initial admin).
- Auto-wires `pool.setNotifier(staking, true)` (works because deployer is
  the fresh pool's arbitrator — sidesteps the live pool's governor-gated
  notifier flow).
- If `ROTATE_TO_GOVERNOR=1`, rotates arbitrator + admin of the three
  stateful contracts to `AegisGovernor` at the end. This closes audit
  H-7 (reputation admin EOA) + posture for H-6/H-9 on the fresh
  instances.

Old marketplace addresses are preserved in `deployments-mainnet.json`
under `*_retired` keys for the on-chain audit trail; the canonical keys
(`operatorRegistryV2`, `operatorStakingV2`, `insurancePoolV2`,
`operatorReputation`) overwrite with the fresh addresses so
`sync-frontend.js` cuts the UI over automatically.

Operators who were registered on the OLD registry are not migrated —
they must re-register on the new registry. This is the desired
clean-slate behavior.

Skip this step if you want to keep the existing marketplace (just hide
the 1 existing operator via `OperatorRegistry.deactivate()` from the
operator's wallet; the frontend's `op.active === true` filter takes
care of UI hiding without redeploy).

### 2.5 — Decision: ProtocolTreasury

The patched treasury (Ownable2Step + `NativeTransferFailed` error) requires
a fresh deploy. Two paths:

| Path | Effect | When to choose |
|---|---|---|
| **A — Defer** | Live treasury (`0xCDc5D…`) keeps single-step admin. V4 vaults send fees to the same address. | Default for this round — minimizes ops surface; the patch lands in the next major deploy cycle. |
| **B — Migrate** | Deploy fresh `ProtocolTreasury_v2` (2-step). Sweep balances of old → new. Re-authorize spenders + reporters on new. V4 factory points at new. V3 vaults still send to old. | Only if a treasury admin rotation is also planned this cycle. |

**Recommended: Path A.** Document plan to migrate in the next ProtocolTreasury_v2 deploy.

### 2.6 — Sync downstream

```bash
node scripts/sync-frontend.js deployments-mainnet.json
cd ../frontend && npm run build
# (deploy frontend bundle separately)
cd ../orchestrator && pm2 restart aegis-orchestrator   # picks up new addresses
```

## Phase 3 — live state operations

### 3.1 — Tighten arbitrator/admin roles to AegisGovernor (H-6, H-7)

These are LIVE marketplace contracts (`OperatorStaking_v2`,
`OperatorReputation`, `InsurancePool_v2`). Their arbitrator/admin is
currently the executor EOA `0x98cC8351…` per the
`admin_wallets_centralized_on_executor` operational note.

**Operational rotation** (executor key → AegisGovernor multisig). All three
are single-step contracts (the 2-step migration ships in v3.1):

```bash
# OperatorStaking_v2.arbitrator + InsurancePool_v2.arbitrator + factoryV2.admin
DEPLOYER_PRIVATE_KEY=<executor> FRESH_ADMIN=<aegisGovernor address> \
  npx hardhat run scripts/rotate-v2-admins.js --network og_mainnet

# OperatorReputation.admin (single-step transferAdmin)
# Inline tx — there's no dedicated script; one-line cast suffices:
cast send <operatorReputation> "transferAdmin(address)" <aegisGovernor> \
  --rpc-url https://evmrpc.0g.ai --private-key <executor>
```

After: every governance-gated action (`slash`, `freeze`, `payoutClaim`,
`setVerified`) must go through an AegisGovernor M-of-N proposal. Direct
EOA calls revert with `OnlyArbitrator` / `OnlyAdmin`.

### 3.2 — Optional: rotate 2-step admins to AegisGovernor

If the same trust posture is desired for the new 2-step contracts (factory
v3 / v4 admins, NAV calc admin, ExecutionRegistry admin):

```bash
# Step 1 — current admin proposes
DEPLOYER_PRIVATE_KEY=<executor> NEW_ADMIN=<aegisGovernor> MODE=propose \
  npx hardhat run scripts/rotate-2step-admins.js --network og_mainnet

# Step 2 — AegisGovernor accepts. Multisig must execute a proposal calling
# `acceptAdmin()` on each contract, OR run from a temporary EOA owner.
# (For a multisig, generate the calldata with cast:)
cast calldata "acceptAdmin()"
# → 0x4e71e0c8
# Then submit a governor proposal: target=<contract>, value=0, data=0x4e71e0c8
```

After: any admin-only call on those contracts (`authorizeFactory`,
`setProtocolTreasury`, `transferAdmin`) requires multisig consensus.

### 3.3 — Verify

```bash
# Quick sanity check after rotations
cast call <executionRegistry> "admin()(address)" --rpc-url https://evmrpc.0g.ai
cast call <aegisVaultFactoryV4> "admin()(address)" --rpc-url https://evmrpc.0g.ai
cast call <protocolTreasury> "admin()(address)" --rpc-url https://evmrpc.0g.ai
cast call <vaultNAVCalculator> "admin()(address)" --rpc-url https://evmrpc.0g.ai
cast call <operatorStakingV2> "arbitrator()(address)" --rpc-url https://evmrpc.0g.ai
cast call <insurancePoolV2> "arbitrator()(address)" --rpc-url https://evmrpc.0g.ai
cast call <operatorReputation> "admin()(address)" --rpc-url https://evmrpc.0g.ai
```

Each should print the AegisGovernor address.

## Phase 4 — smoke test

1. Create a V4 vault via the new factory:
   ```bash
   # Frontend: connect wallet → Operators → pick → "Create V4 Vault"
   # Or programmatically via SDK with vaultFactoryV4 address
   ```

2. Verify the vault's `acceptedManifestHash` matches the operator's
   published manifest (use `vault.acceptedManifestHash()`).

3. Run one orchestrator cycle. Confirm:
   - `IntentExecuted` event fires
   - `StrategyApplied` event fires with the matching `strategyHash`
   - Tx hash visible at chainscan.0g.ai

4. Rotate the TEE signer to test the new atomic clear-sealed-mode behavior:
   ```bash
   # As the V4 vault owner
   cast send <newV4Vault> "setAttestedSigner(address)" 0x0 \
     --private-key <vault-owner-key>
   # Verify: policy.sealedMode is now false; vault still operable
   ```

5. Confirm rate-limit on `/api/cycle`: `for i in {1..10}; do curl -X POST .../api/cycle; done` —
   the 7th request should return HTTP 429.

## Phase 5 — observability

Set up alerts for:

| Signal | Why | Threshold |
|---|---|---|
| `AdminTransferStarted` events on any 2-step contract | Indicates a rotation is in flight; should match a multisig proposal | Any single occurrence |
| `arbitrator()` of staking/insurance != AegisGovernor | Detects unauthorized rotation | Continuous poll, alert on mismatch |
| `TokensRescued` events on either adapter | Admin sweep — rare, should be investigated | Any occurrence |
| `calculateNAV` revert rate | Pyth feed health | > 5% of calls in 5min window |
| `executeIntent` revert with `BalanceDeltaBelowMin` | Router lying about output | Any occurrence |
| `executeIntent` revert with `NoRoute` | Pool discovery failed (could be griefing) | Spike vs baseline |
| `setAttestedSigner` events | TEE key rotations | Any occurrence — confirm matches incident response log |

## Rollback

If V4 deploy reveals an issue post-launch and before vault TVL accumulates:

1. Pause new vault creation: revoke V4 factory authorization on the
   ExecutionRegistry: `cast send <registry> "revokeFactory(address)" <factoryV4>`
   (admin only). Existing V4 clones already authorized stay operational —
   only NEW creations are blocked.

2. Communicate that V4 is in maintenance; new deposits should use V3.

3. If a critical bug requires impl swap: deploy a new factory pointing at a
   patched impl (V4.1 binary). Existing V4 clones remain on the original
   impl forever (clones reference impl by immutable address) — they are
   safe to keep operating if the bug is in non-critical code.

## Deferred to next deploy cycle

- **OperatorStaking_v3** — multi-window slash compounding cap (H-8),
  arbitrator immutable.
- **OperatorReputation_v2** — Ownable2Step + governor binding (H-7
  permanent fix); per-vault rating scope.
- **InsurancePool_v3** — Ownable2Step `setArbitrator` (H-9), governor-bound
  payouts (H-10), separate `ClaimRejected` event (H-11),
  `notifySlashReceived` pulls tokens.
- **ExecutionRegistry_v2** — `revokeVaultBatch` for incident response.
- **ProtocolTreasury_v2** — already 2-step in code, deploys when an admin
  rotation is needed.

## Acceptance criteria

V4 is considered launched when:

- [ ] Phase 2.1–2.5 complete; addresses written to `deployments-mainnet.json`.
- [ ] Phase 3.1 complete; `arbitrator()` returns AegisGovernor on
      OperatorStaking_v2 and InsurancePool_v2; `admin()` returns
      AegisGovernor on OperatorReputation.
- [ ] Phase 4 smoke test passes (V4 vault created, intent executed,
      sealed-mode rotation works).
- [ ] Frontend bundle deployed with new ABIs.
- [ ] Orchestrator restarted; logs show V4 vault discovery within first
      cycle.
- [ ] Monitoring alerts (Phase 5) wired into Sentry / dashboard.
