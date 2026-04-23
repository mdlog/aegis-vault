# Hackathon Checkpoint Draft

> Untuk diisi di form **Checkpoints** pada platform hackathon.

---

## Type

```
Development
```

---

## Title (47 / 50)

```
Dual-chain real venue: Jaine (0G) + Arbitrum V3
```

---

## Description (199 / 200)

```
0G v2 stack live (20 contracts, asset-rescue on vault + staking + insurance pool, real Jaine venue ~$1M TVL). Arbitrum UniV3 execution (8 contracts, v1). Post-audit both-sides whitelist fix. Dead hook cleanup. Docs refreshed.
```

---

## Link

```
https://github.com/mdlog/aegis-vault/commit/5f62523
```

---

## Image (saran)

**Gunakan `docs/diagrams/architecture-multichain.png`** (1920×1080).

Diagram ini paling representatif untuk checkpoint ini:
- Menampilkan dual-chain split: 0G (cyan, INTELLIGENCE + REAL EXECUTION via Jaine) + Arbitrum (gold, REAL EXECUTION via Uniswap V3).
- Box 0G menandai Jaine adapter **ACTIVE** dengan TVL breakdown per pool (USDC.e/W0G $360K, WETH/W0G $278K, WBTC/W0G $189K).
- Middle: EIP-712 domain-separator binding (`block.chainid`) sebagai cross-chain replay protection.
- Bottom: 7-step trade flow strip (cyan steps = 0G, gold steps = target chain).
- Tagline: *AI on 0G. Real liquidity on 0G (Jaine) + Arbitrum (Uniswap V3). Bound by EIP-712.*

---

## Konteks (reference internal)

### Fresh 0G Aristotle Mainnet redeploy (chain 16661, 2026-04-21)

Prior deploy ditargetkan ke MockDEX karena asumsi awal "Jaine pools empty". Post-investigation via swap-event scan: Jaine punya pools aktif — oUSDT yang kami query sebelumnya adalah token yang BEDA dari USDC.e yang benar-benar di-seed di Jaine. Full redeploy dengan real Jaine-pair tokens.

| Contract | Address |
|---|---|
| AegisVaultFactory | `0x9450ac911D06c81a54007a768d4278929d87A17e` |
| AegisVault impl | `0xf7AAFFBddaf66B90f13fc3447634372eBF0Ea181` |
| ExecutionRegistry | `0x3a8a59865546e99c8377aFd2d02736e25Ac5d04E` |
| SealedLib / ExecLib / IOLib | 3 DELEGATECALL'd libraries (slim architecture) |
| OperatorRegistry v2 | `0xF775D9634bFCe4D0F1F56874873FE6cb35A28CA5` |
| OperatorStaking (USDC.e) | `0xAABC708aA3d5e9a37A90ff675EdBD681C204a376` |
| OperatorReputation | `0xc270c579400a45975B2EBff05A2fF80f620080CA` |
| AegisGovernor (M-of-N) | `0x023EC4a54435f94E9395460e4835e75E429D5A2e` |
| InsurancePool | `0x0CaCfc2a5a47C315343f20A8841EE29133AD1598` |
| ProtocolTreasury | `0xCDc5D994590D0BF407E5be390A62A8d1eBbf0dF4` |
| **JaineVenueAdapter (ACTIVE)** | `0x0F8B269368925Fd55C62560B6f818173A8cB25eD` |
| VaultNAVCalculator (Pyth) | `0xBd21bfd62a11e1F8d04e7bE42D2cbDB6C51C4Ae1` |

Real Jaine-pair tokens (verified via on-chain swap events):
- USDC.e: `0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E` (6 decimals)
- WETH: `0x564770837Ef8bbF077cFe54E5f6106538c815B22`
- WBTC: `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c`
- W0G: `0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c`

### Arbitrum One execution layer (chain 42161)

8 contracts live menargetkan Uniswap V3 canonical. Same AegisVault bytecode, berbeda hanya pada `block.chainid` di EIP-712 domain separator — cross-chain replay protection zero-bridge.

- AegisVaultFactory: `0x49354460eAdE1C2E786E36B3B3e7A18Fb4283C45`
- UniswapV3VenueAdapter: `0xB3f6611Dd1d76d20d3BF47C7173310F9e606FAb1`

### Post-audit contract hardening

**Audit Finding 1 fix**: whitelist enforcement di [ExecLib.sol:68-77](contracts/contracts/libraries/ExecLib.sol#L68-L77). Loop verifies both `assetIn` dan `assetOut` appear di vault's `_allowedAssets`. Revert `assetIn!wl` / `assetOut!wl` otherwise. Vault `executeIntent` sekarang pass `_allowedAssets` ke `runExecution`.

**Finding 4 fix**: OperatorRegistry address unified across frontend + orchestrator + contracts/deployments.

**Finding 5 hardening**: `STRICT_MODE=1` di orchestrator/.env. 0G Storage explicit opt-out (`OG_INDEXER_RPC=`) allowed under strict mode — matching honest disclosure tentang Storage KV instability selama hackathon window.

### Live operator + vault on 0G Jaine

- Operator `0x4E08B728087158a02aB458f03d833137b282eC5d` registered:
  - AI model declared: `zai-org/GLM-5-FP8`
  - Bonded manifest hash: `0xef462f339acbb414...ba21c79e` (slashable)
  - Stake: scalable via OperatorStaking (Tier None → $5K vault cap)
- Vault (legacy v1, historical) `0xAEDAc17B531d55b8Ac587691922DEAec6C273181`:
  - Sealed mode ENABLED · attestedSigner = operator
  - 0.999 USDC.e deposited (1.0 USDC.e minus 0.1% entry fee)
  - Allowed assets: real WBTC / WETH / USDC.e (Jaine canonical)
  - Post-v2 cutover: new vaults route through `AegisVaultFactory V2` (`0x9450ac91…A17e`) with asset-rescue paths. This v1 vault kept on-chain as reference.

### Frontend upgrades

- `chainConfig.js` — per-chain venue + asset + mode resolver (0G → Jaine production, Arbitrum → Uniswap V3 production, testnet → mock demo).
- `CreateVaultPage` — venue dari `resolveVenueAddress(chainId)` + pre-flight refusal kalau venue unset.
- `useVault.js` / `useVaultFees.js` — dead-hook neutering (pause/unpause/updatePolicy/setExecutor/setReputationRecorder/fee-accrual/etc) → toast "not available in slim vault build" alih-alih silent revert.
- `FaucetPage` — chain-aware: mainnet (16661/42161) menampilkan info panel dengan link Jaine / Uniswap swap + canonical token addresses. Nav link auto-hidden di mainnet.
- `STATIC_DEPLOYMENTS[16661]` — alias `mockUSDC`/`mockWETH`/`mockWBTC` point ke real Jaine tokens untuk backward-compat dengan hook lama.

### Orchestrator upgrades

- `src/config/chains.js` — per-chain registry scaffold (non-breaking; cycle masih single-chain default).
- `initialize()` — STRICT_MODE respects `OG_INDEXER_RPC=` as explicit storage opt-out, jatuh ke local-JSON journal fallback dengan loud warn.
- `.env` refreshed: fresh 0G addresses, real USDC.e / WETH / WBTC / W0G, Arbitrum `ARB_*` fields.

### Docs + pitch assets

- Updated: **README.md**, **ARCHITECTURE.md**, **DEMO.md**, **HACKATHON_SUBMISSION.md** — dual-chain real-venue narrative + fresh address tables.
- New: **PITCH_SCRIPT.md** — pitch video naskah dengan 7 technical differentiators (AI-to-intent binding, 3.4 KB slim vault, zero-bridge multichain via EIP-712, commit-reveal in-contract, bonded manifests, both-sides whitelist, STRICT_MODE). Each claim paired with source-code reference + on-chain proof.
- New: **PRE_DEPLOY_CHECKLIST.md** — stepwise guide untuk 0G + Arbitrum deploys.
- New: **docs/diagrams/architecture-multichain.svg** + 1920×1080 PNG (slide-ready).

### Verification

- Hardhat compile: clean.
- Hardhat test: **145 passing / 7 failing** (same baseline — 7 failures are legacy full-vault fee tests against the slim 3-arg factory, documented).
- `npm run build` (frontend): clean, **786 KB** bundle (unchanged).
- On-chain wiring probed:
  - `registry.admin() == factory` ✓
  - `factory.vaultImplementation() == slim impl` ✓
  - `adapter.router()` points to Jaine canonical router ✓
  - `staking.stakeToken() == USDC.e` ✓
  - `nav.pyth()` points to Pyth canonical on 0G ✓
  - `factory.totalVaults() == 1` (fresh state) ✓
