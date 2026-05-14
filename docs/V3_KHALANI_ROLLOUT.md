# V3 + Khalani — production rollout checklist (HISTORICAL)

> **Status (as of 2026-05-14): SUPERSEDED by V4.** This doc remains as the
> operational record of the V3 rollout. For the current V4 deploy procedure
> see [`V4_DEPLOY_AUDIT_RUNBOOK.md`](V4_DEPLOY_AUDIT_RUNBOOK.md).
>
> V3 stack remains on-chain (retired for new vault creation, audit trail
> preserved). 1 existing V3 test vault is left as-is. Current entrypoint
> is `AegisVaultFactoryV4` `0x9e36520650Fd7d06CA77Fb0045456c03d3582A5F`.
>
> **Retired V3 addresses (do not create new vaults against these):**
>
> - `AegisVaultFactoryV3`     `0x75668Ca95aCaE419732B0c7AeA1ee7f9B2EFE0e3`
> - `ExecutionRegistryV3`     `0x8DD63Cfcf5D5eBef23822b8B7b7b40b8C2DabfE9` (V4 reuses this registry — multi-factory authorized)
> - `KhalaniVenueAdapter`     `0xB65fdbb69Cbb382792E644b5f9EcA2ff42673dc4` (V4 reuses)
> - `JaineVenueAdapterV2` (pre-audit) `0x261244010A6D87e043b3489D93fA573cdc2274B6` (V4 cuts over to `0xA4E2aeB9…`)
>
> This document is now reference material for the deployment process — useful
> when re-deploying after a contract change, deploying to a new chain, or
> auditing what each step did.

> Applies to deploying the V3 vault stack alongside Khalani as a second
> execution venue, with V2 vaults left untouched and live.

This is the operator-facing companion to the deploy scripts. Two scripts are
available depending on what you want:

  - **`deploy-fresh-mainnet.js`** — fresh full deploy. Deploys the entire V3
    stack from scratch (treasury, governor, registries, NAV calculator,
    Jaine V2 adapter, V3 vault + factory, Khalani adapter) and writes a
    clean deployments file. Use this when you want a single coherent
    deployment with no legacy V1/V2 references in the frontend manifest.
    14 steps, ~14.7M gas total (~0.05 0G at 3 gwei).
  - **`deploy-vault-factory-v3.js`** — incremental V3-only deploy. Reuses
    treasury / NAV / staking / reputation from an existing V2 deployment
    and only adds the V3-specific contracts (libraries, registry, vault,
    factory, Khalani adapter). 7 steps, ~6.3M gas (~0.019 0G).

This doc focuses on the **fresh full deploy** path because it's the cleanest
option for a frontend integration that should not see V1/V2 cutover logic.

## 1. Wallet funding budget

Single deployer wallet runs the entire V3 + Khalani deploy on 0G mainnet.
No multi-chain wallets are needed — `chooseRoute()` issues Khalani intents
with `fromChainId === toChainId === 0G`, so the orchestrator only needs 0G
gas. Solvers carry the cross-chain economics.

### Deployer wallet (one-time, fresh full deploy)

| Phase | Gas | 0G @ 3 gwei |
|---|---|---|
| ProtocolTreasury | 0.6M | 0.0018 |
| AegisGovernor (M-of-N multisig) | 1.3M | 0.0040 |
| OperatorRegistry | 1.8M | 0.0053 |
| InsurancePool_v2 | 1.0M | 0.0029 |
| OperatorStaking_v2 | 1.4M | 0.0042 |
| OperatorReputation | 0.7M | 0.0020 |
| VaultNAVCalculator | 0.9M | 0.0026 |
| Libraries: SealedLib + ExecLib + IOLib + CrossChainLib | 2.0M | 0.0059 |
| ExecutionRegistry v3 (audit Fix #6 + Ownable2Step + events) | 0.7M | 0.0021 |
| AegisVault_v3 implementation | 2.1M | 0.0063 |
| AegisVaultFactoryV3 | 0.7M | 0.0021 |
| JaineVenueAdapterV2 | 1.7M | 0.0050 |
| KhalaniVenueAdapter | 0.7M | 0.0021 |
| Wiring (registry.authorizeFactory + nav.addAsset×4 + reputation.setRecorder + adapter batch allowlist) | 0.6M | 0.0018 |
| **Total (fresh full deploy)** | **~16.2M** | **~0.049 0G** |

**Recommended balance:** **0.1–0.2 0G** in deployer wallet (2-4x headroom
for gas-price surge or retries). Top up before running
`scripts/deploy-fresh-mainnet.js`.

If you instead use the incremental `deploy-vault-factory-v3.js` (V3-only on
top of an existing V2 deployment), the budget drops to ~6.3M gas (~0.019 0G).

**Why v3 deploys its own ExecLib + IOLib + ExecutionRegistry:**
post-audit-fix surfaces aren't backwards compatible (ExecLib added a
`totalDeposited` arg, IOLib added v3-fee-split functions, ExecutionRegistry
added `authorizedFactories` + Ownable2Step). v1/v2 vaults already deployed
on-chain link to the OLD library + registry addresses and keep working
untouched. v3 vaults link to the new ones. Cross-version intent collision
is impossible because intent hashes bind the vault address into the
EIP-712 domain.

### Orchestrator wallet (ongoing, post-deploy)

The executor wallet (`config.executor`) signs every cycle's tx. Per-cycle
gas depends on which path wins:

| Route | Tx count | Total gas | 0G @ 3 gwei |
|---|---|---|---|
| Jaine on-chain swap | 1 (executeIntent) | ~250k | 0.00075 |
| Khalani cross-chain | 2 (deposit + acceptCrossChainFill) | ~300k | 0.00090 |
| Sealed mode (commit+reveal+execute) | 2 | ~350k | 0.00105 |

**Monthly burn estimate** (assuming 1 cycle/min, 50% Jaine / 50% Khalani):
~720 cycles/day × 30 days × 0.0008 0G ≈ **17 0G/month**.

**Recommended ongoing balance:** **30–50 0G** in executor wallet, monitored
via Grafana / alerting. Topup whenever balance < 5 0G.

## 2. Pre-deploy checks (fresh full deploy)

Before running `deploy-fresh-mainnet.js`, confirm:

- [ ] `contracts/deployments-mainnet.json` has external references populated
      (these aren't deployed by the script — they must already exist on chain):
  - `pyth.address` and `pyth.feedBTC` / `feedETH` / `feedUSDC` / `feed0G`
  - `realTokens.USDCe`, `WETH`, `cbBTC`, `W0G`
  - `jaine.router`, `jaine.factory`, `jaine.w0g`
- [ ] Deployer wallet has ≥ 0.1 0G (recommended 0.2 for full headroom)
- [ ] All tests green locally: `cd contracts && npx hardhat test` (255+
      contract tests across `AegisVault_v3.test.js`, `AegisVaultFactoryV3.test.js`,
      `ExecutionRegistry.audit.test.js`, `KhalaniVenueAdapter.test.js`)
- [ ] Slither CI green on the latest commit
- [ ] Governance owners + threshold decided (env vars `GOVERNOR_OWNERS`
      comma-separated and `GOVERNOR_THRESHOLD`)
- [ ] Orchestrator executor address ready (env `EXECUTOR_ADDRESS`; this
      becomes the authorized recorder on `OperatorReputation`)

The script writes ONLY V3 keys to the output deployments file. Legacy V1
unsuffixed keys (`aegisVaultFactory`, `executionRegistry`, etc.) are
intentionally dropped. `sync-frontend.js` still surfaces those keys in
the frontend manifest by falling back through `V3 → V2 → V1`, so legacy
frontend code that hasn't migrated to explicit `…V3` keys keeps working.

## 3. Deploy sequence (fresh full deploy)

```bash
cd contracts

# 1. Run the full fresh deploy — 14 steps in one go.
DEPLOYER_PRIVATE_KEY=0x... \
GOVERNOR_OWNERS=0xaaa,0xbbb,0xccc \
GOVERNOR_THRESHOLD=2 \
EXECUTOR_ADDRESS=0x... \
CONFIRM_MAINNET=1 \
  npx hardhat run scripts/deploy-fresh-mainnet.js --network og_mainnet

# 2. Sync addresses + ABIs to the frontend manifest.
node scripts/sync-frontend.js deployments-mainnet.json

# 3. Verify the manifest in frontend/src/lib/deployments.generated.json
#    contains the V3 addresses (aegisVaultFactoryV3, executionRegistryV3,
#    khalaniVenueAdapter, operatorReputation, etc.). Legacy unsuffixed
#    keys will be auto-populated with V3 fallbacks.

# 4. Rebuild + restart frontend, restart orchestrator.
cd ../frontend && npm run build
cd ../orchestrator && pm2 restart aegis-orchestrator
```

**Incremental V3-only deploy** (alternative — keeps existing V2 stack):

```bash
DEPLOYER_PRIVATE_KEY=0x... \
  npx hardhat run scripts/deploy-vault-factory-v3.js --network og_mainnet
node scripts/sync-frontend.js deployments-mainnet.json
```

After step 2, the frontend will route new vault creates through V3 factory
automatically (see `useVault.js` cutover priority). Existing V2 vaults
continue to operate against the V2 factory.

## 3a. Reset orchestrator cycle to a fresh state

After the fresh deploy, the orchestrator is still tracking V2-stack vault
state in `orchestrator/data/`. Use the helper script to back up + clear
the cycle state files so the next start re-indexes from the new V3 factory:

```bash
cd orchestrator
./scripts/fresh-cycle.sh
```

The script removes (after backing up to `data/.fresh-cycle-backup-<ts>/`):
- `data/kv-state.json` — last cycle snapshot
- `data/vault-index.json` — vault list + lastIndexedBlock
- `data/tmp/*` — scratch decision/execution files

Preserved untouched:
- `data/journal.json` — audit trail of past executions
- `logs/orchestrator.jsonl` — structured log
- `logs/orchestrator.stdout.log` — raw stdout

After the reset, restart the orchestrator (`pm2 start aegis-orchestrator`
or `npm start`). The first log line of interest is
`Vault indexer ready — N cached vault(s)` where `N=0` immediately after
reset, growing as new V3 factory events are indexed.

## 4. Post-deploy verification

In order:

1. **Smoke test V3 factory deployment**
   ```bash
   cast call $V3_FACTORY "vaultImplementation()(address)" --rpc-url $OG_RPC
   cast call $REGISTRY "authorizedFactories(address)(bool)" $V3_FACTORY --rpc-url $OG_RPC
   # Expect: V3 impl address; authorizedFactories[v3]=true.
   ```

2. **Create a test V3 vault from the frontend** (use a test wallet on
   mainnet with minimal capital, e.g. $10 USDC.e). Verify:
   - `vault.version()` returns `"v3"`
   - `vault.maxCrossChainFeeBps()` matches the slider value
   - `vault.protocolTreasury()` matches the deployments treasury

3. **Smoke test Khalani inbound deposit** (CrossChainDepositCard flow):
   - Connect wallet on Ethereum/Arbitrum/Base
   - Pick the test V3 vault
   - Deposit a small USDC amount
   - Verify tokens land in vault on 0G and `step === 'done'` state hits

4. **Smoke test Khalani AI execution path** (Phase 3):
   - Watch orchestrator logs for `Route: khalani | diff X bps`
   - When Khalani wins: confirm log line `Khalani order accepted: order-...`
   - Confirm `acceptCrossChainFill mined: 0x...` follows
   - Check `vault.consumedKhalaniIds(<id>)` returns true on-chain

## 5. Rollback plan

If Khalani path misbehaves in production:

1. **Soft disable per vault**: vault owner sets `maxCrossChainFeeBps = 0`
   via `vault.setMaxCrossChainFeeBps(0)` — every Khalani fill reverts with
   `CrossChain_FeeTooHigh`. Vault keeps Jaine route untouched.

2. **Soft disable protocol-wide**: adapter owner
   `khalaniAdapter.setChainAllowed(<chainId>, false)` per chain to stop
   orchestrator from publishing new intents. Existing in-flight orders
   complete or refund.

3. **Hard pause**: vault owner `vault.pause()` halts all execution
   (Jaine and Khalani) until unpaused.

4. **Code revert**: orchestrator env `KHALANI_DISABLED=1` (if added) or
   downgrade to pre-Phase-3 commit. Jaine path continues unchanged.

## 6. Open ops items (not blocking initial rollout)

- [ ] Multi-chain wallet pool — needed only if vault expands to non-0G
  destination chains in future. Not relevant for current single-chain (0G)
  Khalani routing.
- [ ] LI.FI as second cross-chain venue — defer until vault expands to a
  chain LI.FI supports (Arbitrum/Ethereum/Base). See `quoteRouter.js`
  for the integration pattern that should generalize.
- [ ] On-chain Pyth deviation guard re-enable on Jaine adapter — depends on
  Pyth Hermes push cadence on 0G crossing the 5-min staleness threshold.
- [ ] Adapter ownership rotation to AegisGovernor multisig once initial
  allowlist is verified and stable.

## 7. Quick reference

- V3 deploy script: [`contracts/scripts/deploy-vault-factory-v3.js`](../contracts/scripts/deploy-vault-factory-v3.js)
- Khalani client (orchestrator): [`orchestrator/src/services/khalani.js`](../orchestrator/src/services/khalani.js)
- Phase 3 execution: [`orchestrator/src/services/executor.js`](../orchestrator/src/services/executor.js) (`submitCrossChainIntent`)
- Cross-chain deposit UI: [`frontend/src/components/dashboard/CrossChainDepositCard.jsx`](../frontend/src/components/dashboard/CrossChainDepositCard.jsx)
- V3 vault contract: [`contracts/contracts/AegisVault_v3.sol`](../contracts/contracts/AegisVault_v3.sol)
- Tests: [`orchestrator/test/cross-chain-execute.test.js`](../orchestrator/test/cross-chain-execute.test.js), [`contracts/test/AegisVault_v3.test.js`](../contracts/test/AegisVault_v3.test.js), [`contracts/test/AegisVaultFactoryV3.test.js`](../contracts/test/AegisVaultFactoryV3.test.js)
