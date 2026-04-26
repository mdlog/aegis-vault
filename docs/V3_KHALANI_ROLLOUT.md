# V3 + Khalani — production rollout checklist

> Applies to deploying the V3 vault stack alongside Khalani as a second
> execution venue, with V2 vaults left untouched and live.

This is the operator-facing companion to `deploy-vault-factory-v3.js`.
It documents the gas budget, wallet topup needs, sequence, and post-deploy
verification steps for going **fully live with Khalani while keeping Jaine**.

## 1. Wallet funding budget

Single deployer wallet runs the entire V3 + Khalani deploy on 0G mainnet.
No multi-chain wallets are needed — `chooseRoute()` issues Khalani intents
with `fromChainId === toChainId === 0G`, so the orchestrator only needs 0G
gas. Solvers carry the cross-chain economics.

### Deployer wallet (one-time)

| Phase | Gas | 0G @ 3 gwei |
|---|---|---|
| ExecLib + IOLib redeploy (audit Fix #3, #8) | 1.5M | 0.0045 |
| CrossChainLib | 0.3M | 0.0009 |
| AegisVault_v3 implementation | 2.1M | 0.0063 |
| AegisVaultFactoryV3 | 0.7M | 0.0021 |
| KhalaniVenueAdapter | 0.6M | 0.0018 |
| Adapter allowlist seed (4 chains + 4 tokens, 8 txs) | 0.4M | 0.0012 |
| `registry.authorizeFactory(v3)` | 0.05M | 0.0002 |
| **Total** | **~5.7M** | **~0.017 0G** |

**Recommended balance:** **0.1 0G** in deployer wallet (3-5x headroom for
gas-price surge or retries). Top up before running
`scripts/deploy-vault-factory-v3.js`.

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

## 2. Pre-deploy checks

Before running the script, confirm:

- [ ] `contracts/deployments-mainnet.json` has populated:
  - `executionRegistryV2` (V2 stack registry — V3 attaches to this via `authorizeFactory`)
  - `protocolTreasury`
  - `execLibrary`, `sealedLibrary`, `ioLibrary` (V2 versions; script will redeploy ExecLib + IOLib for V3 due to audit-fix surface changes — **but it does not** in the current script; verify whether you want shared libraries or v3-private ones)
  - `realTokens.USDCe`, `WETH`, `cbBTC`, `W0G`
- [ ] Deployer wallet has ≥ 0.1 0G
- [ ] Deployer holds `executionRegistryV2.admin()` slot (so `authorizeFactory(v3)` runs inline). If admin sits elsewhere, the script prints the manual coordination call.
- [ ] `contracts/test/AegisVault_v3.test.js` and `AegisVaultFactoryV3.test.js` are green locally (`npx hardhat test`)
- [ ] Slither CI green on the latest commit

## 3. Deploy sequence

```bash
cd contracts

# 1. Deploy V3 + KhalaniVenueAdapter + allowlist + register factory.
DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-vault-factory-v3.js --network og_mainnet

# 2. Sync addresses + ABIs to frontend.
node scripts/sync-frontend.js deployments-mainnet.json

# 3. Verify the new addresses in deployments-mainnet.json appear with
#    crossChainLibrary, aegisVaultImplementationV3, aegisVaultFactoryV3,
#    khalaniVenueAdapter populated.

# 4. Restart orchestrator so it picks up new factory + adapter env.
pm2 restart aegis-orchestrator   # or systemd / docker compose restart
```

After step 2, the frontend will route new vault creates through V3 factory
automatically (see `useVault.js` cutover priority). Existing V2 vaults
continue to operate against the V2 factory.

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
