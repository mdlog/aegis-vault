# Pre-Deploy Checklist — 0G Mainnet (Jaine) + Arbitrum Execution

You have **two fresh deploys** to run: 0G Aristotle Mainnet (Jaine real venue)
and Arbitrum One (Uniswap V3 real venue). This checklist walks both. Every
item should be checked off **before** you run a deploy command — skipping any
of these is how you burn gas for nothing.

**Arbitrum has already been deployed (2026-04-21).** Skip section 4.B if you
don't need to redeploy Arbitrum. This doc now leads with the fresh 0G redeploy.

---

## 0. Repository state sanity

- [ ] `git status` clean (commit everything first; you'll want a safe revert
      point if deploy misbehaves)
- [ ] `cd contracts && npx hardhat compile` ends with "Compiled N Solidity
      files successfully"
- [ ] `cd contracts && npx hardhat test 2>&1 | tail -3` shows **145 passing**,
      **7 failing** (the 7 are legacy full-vault tests against the slim build;
      they will NOT affect Arbitrum deploy — they fail on an old 2-arg factory
      constructor pattern that no longer matches the 3-arg slim factory)
- [ ] `cd frontend && npm run build` completes without errors

---

## 1. Key hygiene (do NOT skip)

The repo currently has `orchestrator/.env` with a single private key reused
for `PRIVATE_KEY`, `OG_COMPUTE_PRIVATE_KEY`, and `TEE_SIGNER_PRIVATE_KEY`.
The config file's own header (`orchestrator/src/config/index.js:83`) says the
TEE signer must be a separate key. Before you deploy anything real:

- [ ] Generate **three distinct keys** (e.g. `openssl rand -hex 32` × 3,
      or use a hardware wallet for the deployer):
      ```
      DEPLOYER_KEY          # 0G deploy + Arbitrum deploy (can be same if hot)
      ORCH_HOT_KEY          # orchestrator hot wallet (executor)
      TEE_SIGNER_KEY        # signs EIP-712 attestation hashes only
      OG_COMPUTE_KEY        # funds 0G Compute service account
      ```
- [ ] `.env` is already gitignored at repo root (verified — line 3 of
      `.gitignore`). Confirm with `git ls-files | grep -i '\.env$'` — only
      `.env.example` files should appear.
- [ ] Update `orchestrator/.env` with the new keys; remove the placeholder key.
- [ ] **Never commit** any file containing a real private key. If you
      accidentally do, rotate the key immediately.

---

## 2. Fund the deployer

### 0G Aristotle Mainnet (NEW — redeploy for real Jaine venue)
- [ ] Deployer address: `0x4E08B728087158a02aB458f03d833137b282eC5d`
      (dedicated 0G deployer; Arbitrum uses separate wallet — operator identity
      can be consolidated post-deploy via OperatorRegistry registration).
- [ ] Required balance: **≥ 2–3 native 0G** (comfortable margin)
  - At 4 gwei gas, full deploy ≈ 0.08 native 0G
  - Buffer covers setup tx + possible retries + demo vault creation later
- [ ] How to acquire native 0G:
  - CEX withdraw (Binance / Bybit / OKX — list the `0G` token; withdraw via
    "0G Mainnet" network to the deployer address)
  - Cross-chain bridge (Hyperlane / dedicated 0G bridge if/when available)

### Arbitrum One
- [ ] Deployer address: whatever wallet address corresponds to `DEPLOYER_KEY`
- [ ] Required balance: **≥ 0.01 ETH**
  - 0.003 ETH minimum enforced by the deploy script's pre-flight check
    ([deploy-arbitrum-execution.js](contracts/scripts/deploy-arbitrum-execution.js#L75))
  - Realistic total for deploy + 3–5 test swaps: 0.008–0.012 ETH
- [ ] Bridge options (pick any):
  - Arbitrum official bridge: https://bridge.arbitrum.io
  - A CEX that withdraws directly to Arbitrum (Binance, Kraken, Coinbase,
    Bybit — all support native Arbitrum withdrawal; withdraw ETH to your
    deployer address, chain=Arbitrum One)

---

## 3. Verify the code that will be deployed

### 3.1 Whitelist enforcement (audit Finding 1)
The slim vault now passes `_allowedAssets` to `ExecLib.runExecution`, which
enforces that both `assetIn` and `assetOut` appear in the whitelist.

- [ ] Verify: `grep -n 'assetIn!wl\|assetOut!wl' contracts/contracts/libraries/ExecLib.sol`
      → should show lines 69–77 (the new whitelist check)
- [ ] Verify: `grep -n '_allowedAssets' contracts/contracts/AegisVault.sol`
      → line 93 should pass `_allowedAssets` into `ExecLib.runExecution`

### 3.2 Factory constructor on Arbitrum
Old Arbitrum deploy script tried to call factory with 2 args (the previous
`(registry, treasury)` signature). The current slim factory needs 3 args:
`(vaultImplementation, registry, treasury)`. Fixed in this branch.

- [ ] Verify: `grep -n 'Factory.deploy' contracts/scripts/deploy-arbitrum-execution.js`
      → should show the 3-arg call with `deployments.aegisVaultImplementation`
      as the first argument
- [ ] Verify: `grep -n 'aegisVaultImplementation' contracts/scripts/deploy-arbitrum-execution.js`
      → should show the impl deploy step [2d/4] before the factory deploy

### 3.3 Registry consistency across configs
- [ ] Verify: `grep -n 'operatorRegistry' contracts/deployments.json contracts/deployments-mainnet.json orchestrator/.env`
      → all three should show the **same** registry address.
      Fresh deploy (2026-04-21) current address: `0x4C6e88812101C346974c7E48c1587D6Cd3B2C2A9`.
      The prior split-brain issue (two different registries) was fixed in the redeploy —
      `sync-frontend.js deployments-mainnet.json` keeps all three files aligned automatically.

### 3.4 STRICT_MODE (audit Finding 5)
- [ ] Verify: `grep '^STRICT_MODE' orchestrator/.env` → `STRICT_MODE=1`

---

## 4.A Deploy 0G Aristotle Mainnet (Jaine real venue)

```bash
cd contracts

# The deployer key corresponds to the 0x4E08B728087158a02aB458f03d833137b282eC5d
# wallet (funded with 14.6 native 0G verified @ block #31142121).
export DEPLOYER_PRIVATE_KEY="<your 0G deployer key for 0x4E08...eC5d>"

# Governance: bootstrap 1-of-1 with deployer (rotate later via TRANSFER_ADMINS)
export GOVERNOR_OWNERS="0x4E08B728087158a02aB458f03d833137b282eC5d"
export GOVERNOR_THRESHOLD=1
export ARBITRATOR_ADDRESS="0x4E08B728087158a02aB458f03d833137b282eC5d"
export CONFIRM_MAINNET=1

# Optional: rotate admin roles to governor at end of deploy
# export TRANSFER_ADMINS=1

npx hardhat run scripts/deploy-mainnet.js --network og_mainnet
```

Expected output: `deployments-mainnet.json` + `deployments.json` populated with
fresh addresses for all 11 protocol contracts (ExecutionRegistry, 3 libraries,
AegisVault impl, AegisVaultFactory, OperatorRegistry, Staking, Reputation,
Governor, Treasury, InsurancePool, JaineVenueAdapter, VaultNAVCalculator).

**Key change from prior deploy:** no MockDEX, no mock tokens, no pre-built demo
vault. NAV calculator is seeded with **real** USDC.e, WETH, WBTC (the tokens
Jaine pools are actually seeded with).

Verify on https://chainscan.0g.ai:
- [ ] Factory, registry, governor, treasury all have code
- [ ] `JaineVenueAdapter.router() == 0x8b598a7c136215a95ba0282b4d832b9f9801f2e2`
- [ ] `VaultNAVCalculator.addAsset` tx history shows USDC.e, WETH, WBTC
- [ ] `AegisVaultFactory.totalVaults() == 0` (fresh — no demo vaults)
- [ ] `OperatorRegistry.getOperatorCount() == 0` (fresh — no operators)

Then propagate:

```bash
node scripts/sync-frontend.js deployments-mainnet.json
```

This writes chain 16661 entry into `frontend/src/lib/deployments.generated.json`
with real Jaine token addresses baked in.

Update `orchestrator/.env` 0G section:
- [ ] `VAULT_FACTORY_ADDRESS=<new factory>`
- [ ] `EXECUTION_REGISTRY_ADDRESS=<new registry>`
- [ ] `OPERATOR_REGISTRY_ADDRESS=<new operator registry>`
- [ ] `OPERATOR_STAKING_ADDRESS=<new staking>`
- [ ] `OPERATOR_REPUTATION_ADDRESS=<new reputation>`
- [ ] `INSURANCE_POOL_ADDRESS=<new insurance pool>`
- [ ] `AEGIS_GOVERNOR_ADDRESS=<new governor>`
- [ ] `PROTOCOL_TREASURY_ADDRESS=<new treasury>`
- [ ] `USDC_ADDRESS=0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E` (USDC.e)
- [ ] `WBTC_ADDRESS=0x0555E30da8f98308EdB960aa94C0Db47230d2B9c`
- [ ] `WETH_ADDRESS=0x564770837Ef8bbF077cFe54E5f6106538c815B22`

---

## 4.B Deploy Arbitrum execution layer

> **Already deployed 2026-04-21.** Skip this section unless redeploying.

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY="<your freshly rotated Arbitrum deployer key>"
export CONFIRM_MAINNET=1
export TREASURY_ADDRESS_0G=0xb71d34Bc3DE959f5681d28c2496f754664b925c5   # optional — 0G ProtocolTreasury (fresh deploy 2026-04-21)
npx hardhat run scripts/deploy-arbitrum-execution.js --network arbitrum
```

Expected output: `deployments-arbitrum.json` written with addresses for
`executionRegistry`, `sealedLibrary`, `execLibrary`, `ioLibrary`,
`aegisVaultImplementation`, `aegisVaultFactory`, `uniswapV3VenueAdapter`,
`vaultNAVCalculator`.

Verify on https://arbiscan.io:
- [ ] Factory address has code
- [ ] NAV calculator has `addAsset` calls in its history for USDC/WETH/WBTC
- [ ] Registry admin is set to the factory (query `registry.admin()`)

Propagate addresses:

```bash
cd contracts
node scripts/sync-frontend.js deployments-arbitrum.json
```

This writes chain 42161 entry into `frontend/src/lib/deployments.generated.json`.

Update `orchestrator/.env` Arbitrum section (look for `ARB_*`):
- [ ] `ARB_VAULT_FACTORY=<factory address from deploy>`
- [ ] `ARB_EXECUTION_REGISTRY=<registry address from deploy>`
- [ ] `ARB_VENUE_ADDRESS=<uniswapV3VenueAdapter address>`
- [ ] `ARB_NAV_CALCULATOR=<vaultNAVCalculator address>`
- [ ] `ARBITRUM_PRIVATE_KEY=<executor key for Arbitrum>`

---

## 6. Smoke test a vault on Arbitrum

1. Open the frontend (`cd frontend && npm run dev`), connect wallet, switch
   network to **Arbitrum One**.
2. Open `/create`, pick USDC as base asset (decimals 6), pick a small deposit
   (e.g. 1 USDC = `1`), pick Defensive risk profile, confirm.
3. Verify on arbiscan:
   - Vault address deterministic from factory (CREATE2 via EIP-1167 clone)
   - Factory `VaultDeployed` event fired
   - `forceApprove(vault, 1000000)` from your wallet → vault
   - `deposit(1000000)` → vault holds 1 USDC

### Sealed-mode test (optional but a strong demo moment)
4. Toggle sealed mode, set attested signer to `TEE_SIGNER_KEY` address, create
   another vault.
5. From orchestrator, trigger a cycle on that vault. It should:
   - Fetch market signal (Pyth on Arbitrum)
   - Call 0G Compute for AI decision
   - Build EIP-712 intent with `block.chainid = 42161`
   - Sign with `TEE_SIGNER_KEY`
   - `commitIntent(hash)` on Arbitrum
   - Wait 1 block, then `executeIntent(intent, sig)` on Arbitrum
   - The swap routes through Uniswap V3 (`UniswapV3VenueAdapter.swap`)
     against a real pool
6. Save the tx hash. This is the **real-liquidity execution tx** for the
   pitch video's "proof" moment.

---

## 7. Update pitch video + submission doc

- [ ] Record a 15–30s segment showing the Arbitrum tx on arbiscan during the
      demo portion of the pitch video (step 6 above gives you the hash)
- [ ] Fill the "pending deploy" rows in `HACKATHON_SUBMISSION.md` under
      "Key Deployed Contracts → Arbitrum One" with the real addresses
- [ ] Add the Arbitrum real-liquidity TX hash to the "Verifiable Execution"
      section

---

## 8. Final lint pass

- [ ] `cd frontend && npm run lint` — currently 5 errors per audit; fix or
      explicitly `// eslint-disable-*` with reason before submitting
- [ ] `cd contracts && npx hardhat test 2>&1 | tail -3` — should still be
      **145 passing, 7 failing** (same 7 legacy tests)

---

## Known limitations shipped in this build

These are documented honestly in `HACKATHON_SUBMISSION.md` → "Honest
Disclosures". Judges are expected to see them rather than discover them.

- `maxPositionBps` / `maxDailyLossBps` / `stopLossBps` are **orchestrator-
  enforced pre-submit**, not on-chain. On-chain enforcement is roadmapped.
- Slim vault (both chains) has no pause/updatePolicy/fee-accrual — the
  frontend shows a clear "not available in this build" toast for those
  controls.
- 0G Storage KV falls back to local JSON during hackathon window.
- Governance is 1-of-1 on both chains initially (`TRANSFER_ADMINS=1` flips
  admin roles to the governor but multi-sig signer rotation is manual).

---

When every box above is checked, you can ship.
