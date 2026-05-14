# V4 Deployment Plan

Operator / protocol-team facing. Last updated 2026-04-27.

This is the operational runbook for cutting a V4 release of the Aegis Vault stack onto a chain that already runs V3. It complements (does not replace) [V4_MIGRATION_GUIDE.md](V4_MIGRATION_GUIDE.md), which is depositor-facing.

---

## Scope

V4 introduces:

- `contracts/v4/AegisVault_v4.sol` — vault implementation that binds an `acceptedManifestHash` per clone
- `contracts/v4/AegisVaultFactoryV4.sol` — EIP-1167 factory for V4 clones
- `contracts/v4/ExecLibV4.sol` — V4 execution library with the extended `ExecutionIntentV4` struct (adds `strategyHash` + `strategySchemaVer`)

V4 reuses V3's existing `ExecutionRegistry`, `SealedLib`, `IOLib`, and `CrossChainLib` libraries — no fork required for those. V3 vaults are not touched.

The orchestrator already supports both V3 and V4 vaults in the same process (Phase 2 integration). The frontend / SDK are being delivered in parallel by the frontend/SDK workstream.

---

## Pre-flight checklist

Before scheduling the deployment window, confirm:

- [ ] Hardhat suite green: `cd contracts && npx hardhat test` — all 294+ tests pass.
- [ ] V4-specific tests green: `npx hardhat test test/AegisVault_v4.test.js test/AegisVault_v4_strategy.test.js`.
- [ ] Orchestrator strategy tests green: `cd orchestrator && node --test test/strategy/*.test.js`.
- [ ] Migration script runs cleanly against the target chain: `node contracts/scripts/migrate-v3-to-v4.js --output /tmp/plan.json` — produces a non-empty plan, no per-vault `error` fields.
- [ ] All five strategy templates in `orchestrator/strategies/` compute their canonical hashes without error (covered by `test/strategy/loader.test.js`).
- [ ] Deployer wallet has at least 0.5 0G for gas (~12M gas total, with margin).
- [ ] `contracts/deployments-mainnet.json` is checked in at the latest V3 state (the deployment script appends to it; conflicts will be a manual merge).
- [ ] At least one practice run of the deployment script against a local Hardhat node (not yet automated as a script — see Order of Operations below).

---

## Order of operations

The deployment is one-shot — five contracts in one transaction sequence. There is no incremental rollout because V4 contracts are independent of V3 contracts at the on-chain level (they do not share storage, only the `ExecutionRegistry` address).

### 1. Compile + run the full test suite

```bash
cd contracts
npx hardhat compile
npx hardhat test
```

Hard-fail on any test failure. Do not proceed.

### 2. Deploy `ExecLibV4`

Library, deployed standalone so V4 vault clones can link to it. The full
flow (steps 2–5 below) is wrapped in [`scripts/deploy-v4.js`](../contracts/scripts/deploy-v4.js):

```bash
CONFIRM_MAINNET=1 npx hardhat run scripts/deploy-v4.js --network og_mainnet
```

The pseudocode below documents what the script does internally:

```bash
const ExecLibV4 = await ethers.getContractFactory('ExecLibV4');
const execLibV4 = await ExecLibV4.deploy();
await execLibV4.waitForDeployment();
```

Capture the deployed address. ~1.2M gas.

### 3. Deploy `AegisVault_v4` implementation

The implementation is what `AegisVaultFactoryV4` clones. It must be linked against `ExecLibV4` (new) plus the existing `SealedLib`, `IOLib`, `CrossChainLib` libraries deployed at V3 time.

```bash
const AegisVault_v4 = await ethers.getContractFactory('AegisVault_v4', {
  libraries: {
    ExecLibV4:     execLibV4Addr,                 // newly deployed
    SealedLib:     deployments.sealedLibrary,     // from V3
    IOLib:         deployments.ioLibraryV3,       // from V3
    CrossChainLib: deployments.crossChainLibrary, // from V3
  },
});
const vaultImpl = await AegisVault_v4.deploy();
await vaultImpl.waitForDeployment();
```

Capture address. ~3.5M gas.

### 4. Deploy `AegisVaultFactoryV4`

```bash
const AegisVaultFactoryV4 = await ethers.getContractFactory('AegisVaultFactoryV4');
const factory = await AegisVaultFactoryV4.deploy(
  vaultImplAddr,                             // step 3
  deployments.executionRegistryV3,           // shared with V3
  deployments.protocolTreasury,              // shared with V3
);
await factory.waitForDeployment();
```

Capture address. ~1.2M gas.

### 5. Authorize the V4 factory in the shared `ExecutionRegistry`

The registry rejects vault registrations from unknown factories. Authorize V4:

```bash
const registry = await ethers.getContractAt('ExecutionRegistry', deployments.executionRegistryV3);
await registry.authorizeFactory(v4FactoryAddr);
```

This is the single coupling between V3 and V4. After this call, V4 clones can call `registry.authorizeVault` during their own deployment.

### 6. Verify on chainscan

For 0G mainnet, this is `https://chainscan.0g.ai/`. Verify:

- `ExecLibV4` (no constructor args)
- `AegisVault_v4` (no constructor args; library linking metadata required)
- `AegisVaultFactoryV4` (3 constructor args: vaultImpl, executionRegistryV3, protocolTreasury)

Verification metadata for the factory contract should include the source for `AegisVault_v4` and the linked libraries so chainscan can resolve clone code.

### 7. Update `contracts/deployments-mainnet.json`

Append (do **not** replace) the new keys:

```json
{
  ...
  "execLibraryV4":             "<step 2 address>",
  "aegisVaultImplementationV4": "<step 3 address>",
  "aegisVaultFactoryV4":        "<step 4 address>",
  "v4DeployedAt":               "<ISO timestamp>"
}
```

Run the existing `scripts/sync-frontend.js` to propagate to `frontend/src/lib/deployments.generated.json` and the SDK.

### 8. Update the orchestrator

The orchestrator already supports V4 vaults at the code level (Phase 2 integration). The remaining wiring is configuration:

- Add the V4 factory address to the orchestrator's `KNOWN_FACTORIES` list (see `src/services/vaultEventListener.js`).
- Restart the orchestrator process. On startup it will enumerate vaults from both V3 and V4 factories.

### 9. Update the frontend

The frontend/SDK workstream owns the UI surface. The deployment task hands them:

- `aegisVaultFactoryV4` address (for the "Create V4 Vault" wizard).
- `aegisVaultImplementationV4` address (for the "verify code" link in the operator-profile screen).
- An updated copy of `frontend/src/lib/deployments.generated.json` (auto-generated by `sync-frontend.js`).

The frontend needs to surface:

- A new wizard at `/create-vault` that includes the `acceptedManifestHash` field (default to operator's published hash).
- A V4 vault management panel exposing `requestManifestUpgrade` / `applyManifestUpgrade` / `cancelManifestUpgrade`.
- The `StrategyApplied` event in the per-vault history feed.

### 10. Announce

Publish the V4 release notes:

- New factory address
- Migration guide link
- Cost estimate (depositors should expect ~3 transactions: pause+withdraw, factory.createVault, deposit)
- Honest disclosure: V4 enforcement is on-chain, V3 enforcement is governance-audited (carry over the language from `WHITEPAPER.md` Section 11).

Operators should also be notified so they can:

- Confirm their published manifest hash matches what they want depositors to bind to.
- Note that depositors moving to V4 will need 24h to apply any future strategy change — manifests should be considered "stable" from that point forward.

---

## Cost estimate (0G mainnet)

| Step | Description                              | Gas (est) | Cost @ 1 gwei |
| ---- | ---------------------------------------- | --------- | ------------- |
| 2    | Deploy ExecLibV4                         | 1.2M      | ~$0.40        |
| 3    | Deploy AegisVault_v4 implementation      | 3.5M      | ~$1.20        |
| 4    | Deploy AegisVaultFactoryV4               | 1.2M      | ~$0.40        |
| 5    | Authorize factory in ExecutionRegistry   | 80k       | ~$0.03        |
| 6    | Verify on chainscan                      | 0         | $0            |
| —    | Per-vault create (depositor pays)        | ~600k     | ~$0.20        |
| **Total (protocol)** |                                | **~6M**   | **~$2**       |

(Gas costs assume 0G mainnet's current ~1 gwei average. Arbitrum deployment, when it happens, would be ~5× more expensive due to typical L2 gas pricing — still under $10.)

---

## Rollback plan

V4 is **non-coupled** to V3 except for the shared `ExecutionRegistry` authorization. Rollback options:

### Soft rollback (preferred)

If V4 has a bug after deployment, revoke factory authorization in the registry:

```bash
const registry = await ethers.getContractAt('ExecutionRegistry', deployments.executionRegistryV3);
await registry.revokeFactory(v4FactoryAddr);
```

After this, no new V4 vaults can be created. Existing V4 vaults continue to operate (they were authorized at create time, which is a separate per-vault flag). Depositors can still withdraw from existing V4 vaults.

### Hard rollback

If a critical bug is discovered in `AegisVault_v4` itself:

1. Revoke factory authorization (above).
2. The orchestrator stops signing intents for any flagged V4 vault — handled by an `OPERATOR_BLACKLIST_VAULTS` env var, hot-reloadable.
3. Notify depositors via the frontend banner and ask them to migrate back to V3 (reverse of `V4_MIGRATION_GUIDE.md`).
4. Patch + redeploy V4 implementation, deploy a new factory pointing at the patched implementation, repeat the migration.

V3 is not affected by any V4 issue because V4 contracts are independent. There is no shared storage and no inheritance.

---

## Post-deployment validation

Within 1 hour of deployment:

- [ ] `ExecLibV4`, `AegisVault_v4`, `AegisVaultFactoryV4` all verified on chainscan.
- [ ] `AegisVaultFactoryV4.version()` returns `"v4"`.
- [ ] `AegisVaultFactoryV4.vaultImplementation()` matches the deployed implementation address.
- [ ] `ExecutionRegistry.authorizedFactories(v4FactoryAddr)` returns `true`.
- [ ] One smoke-test V4 vault created with a known operator + zero-hash strategy commitment, deposited 1 unit of base asset, and verified via chainscan.
- [ ] Smoke-test vault's `executeIntent` rejects an intent with the wrong `strategyHash` (orchestrator's `submit-intent --force-wrong-hash` debug command).
- [ ] `migrate-v3-to-v4.js` against the same chain reports the expected V3 vault count and no errors.

Within 24 hours:

- [ ] First volunteer V4 vault created by an external depositor.
- [ ] First successful `executeIntent` on a real V4 vault, with `StrategyApplied` event emitted as expected.
- [ ] Indexer (subgraph or off-chain pipeline) ingesting V4 events without schema errors.

---

## Open items / known limitations

- ~~The deployment script itself is documented inline above, not yet wrapped in a single `scripts/deploy-v4.js`. That is the next ticket and should mirror `scripts/deploy-vault-factory-v3.js` line-for-line.~~ **Done** — see [`contracts/scripts/deploy-v4.js`](../contracts/scripts/deploy-v4.js). Idempotent: re-running on a chain where V4 is already deployed is a safe no-op.
- V4 only supports schema version 1 (`MAX_SUPPORTED_SCHEMA_VER = 1`). Bumping support to v2 requires a vault implementation upgrade — there is no in-place mechanism. Plan for a V4.1 release when v2 schemas land.
- The `protocolTreasury` is shared with V3. Switching V4 to a different treasury requires the V4 factory admin to call `setProtocolTreasury(newTreasury)` after deployment. This only affects newly created V4 vaults.
