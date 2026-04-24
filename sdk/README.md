# @aegis-vault/sdk

JavaScript SDK for the **Aegis Vault** protocol on 0G Chain.

Wraps three things:

1. **Orchestrator HTTP API** — decisions, executions, NAV, alerts, journals, AI models
2. **On-chain contracts** (via ethers v6) — vaults, factory, operator registry/staking/reputation
3. **Network config** — deployed addresses, RPC URLs, explorer links, asset metadata

Works in Node 18+, modern browsers, Deno, Bun, Cloudflare Workers. Framework-agnostic core — no React dependency.

## Install

```bash
npm install @aegis-vault/sdk ethers
```

`ethers` is a *peer* dependency; install it only if you use the contract clients (`sdk.vault`, `sdk.factory`, `sdk.operator`). The orchestrator client has no peer deps.

## Quick start

### Orchestrator-only (no ethers needed)

```js
import { OrchestratorClient } from '@aegis-vault/sdk/orchestrator';

const orch = new OrchestratorClient({
  baseUrl: 'https://orch.aegis.xyz',
  apiKey: process.env.AEGIS_API_KEY, // optional, required for POST routes
});

const status = await orch.status();
const nav = await orch.nav('0xf7AAFFBddaf66B90f13fc3447634372eBF0Ea181');
const decisions = await orch.decisions({ limit: 20, vault: '0x...' });
```

### Full SDK (reads + writes)

```js
import { AegisSDK } from '@aegis-vault/sdk';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://evmrpc.0g.ai');
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const sdk = new AegisSDK({
  chainId: 16661,                          // 0G Aristotle Mainnet (default)
  signer,                                  // omit for read-only mode
  orchestratorUrl: 'https://orch.aegis.xyz',
  orchestratorApiKey: process.env.AEGIS_API_KEY,
});

// On-chain reads
const vault = sdk.vault('0xf7AAFFBddaf66B90f13fc3447634372eBF0Ea181');
const summary = await vault.getSummary();
// → { owner, executor, baseAsset, nav, totalDeposited, paused, ... }

const policy = await vault.getPolicy();
// → { maxPositionBps, confidenceThreshold, cooldownSeconds, ... }

// Factory enumeration
const factory = sdk.factory();
const all = await factory.allVaults();
const mine = await factory.vaultsOf(await signer.getAddress());

// Operator stack (registry + staking + reputation in one client)
const op = sdk.operator('0xOperatorEOA...');
const snapshot = await op.getSnapshot();
// → { address, registered, active, tier, successRateBps, averageRating }

// Orchestrator data
const regime = await sdk.orchestrator.marketSummary();
const alerts = await sdk.orchestrator.alerts({ level: 'warning', limit: 5 });
```

### Register a new operator

The one-shot helper handles the full onboarding flow — register → declare AI model → publish manifest → approve + stake → activate. Every step after `register` is optional; pass only the parts you need.

```js
import { AegisSDK, Mandate } from '@aegis-vault/sdk';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://evmrpc.0g.ai');
const signer = new ethers.Wallet(process.env.OPERATOR_KEY, provider);

const sdk = new AegisSDK({ chainId: 16661, signer });

const result = await sdk.registerOperator({
  input: {
    name: 'Aegis Alpha',
    description: 'Balanced-mandate momentum strategy',
    endpoint: 'https://op.aegis.xyz',
    mandate: Mandate.Balanced,           // 0 | 1 | 2
    performanceFeePct: 15,               // or `performanceFeeBps: 1500`
    managementFeePct: 2,
    entryFeePct: 0,
    exitFeePct: 0,
    recommendedMaxPositionPct: 50,
    recommendedConfidenceMinPct: 60,
    recommendedStopLossPct: 15,
    recommendedCooldownMinutes: 15,      // or `recommendedCooldownSeconds`
    recommendedMaxActionsPerDay: 6,
  },
  ai: {                                  // optional — only if you run an AI model
    model: 'zai-org/GLM-5-FP8',
    provider: '0xAISignerEOA',           // TEE attestation signer
    endpoint: 'https://ai.aegis.xyz/infer',
  },
  manifest: {                            // optional — strategy transparency
    uri: 'ipfs://bafy.../manifest.json',
    hash: '0x' + 'ab'.repeat(32),        // 32-byte hex content hash
    bonded: true,
  },
  stakeAmount: 1_000_000_000n,           // optional — raw units of stake token
  autoActivate: true,                    // default true
  onStep: (step, tx) => {
    console.log(`→ ${step}`, tx?.hash ?? '(submitting…)');
  },
});

console.log('registered:', result.alreadyRegistered ? '(already was)' : 'yes');
console.log('tx hashes:', result.txHashes);
// → { register, declareAIModel, publishManifest, approveStake, stake, activate }
```

Prefer low-level control? Call each step directly:

```js
const op = sdk.operator(await signer.getAddress());

await (await op.register({ /* input */ })).wait();
await (await op.declareAIModel({ model, provider, endpoint })).wait();
await (await op.publishManifest({ uri, hash, bonded: true })).wait();
await (await op.approveStake(amount))?.wait();  // null if already approved
await (await op.stake(amount)).wait();
await (await op.activate()).wait();
```

### Writes (deposit / createVault)

```js
// Deposit USDC.e into an existing vault — one call, handles approve for you
const amount = 1_000_000n; // 1 USDC.e (6 decimals)
const { approveHash, depositHash } = await sdk.vault(vaultAddress)
  .depositWithApproval(amount, (step, tx) => {
    console.log(`→ ${step}`, tx?.hash ?? '(submitting…)');
  });

// Or run the two steps manually if you need more control:
// const approveTx = await sdk.vault(vaultAddress).approveDeposit(amount);  // null if already approved
// if (approveTx) await approveTx.wait();
// const tx = await sdk.vault(vaultAddress).deposit(amount);
// await tx.wait();

// Create a new vault
const tx = await sdk.factory().createVault({
  operator: '0xOperatorEOA',
  baseAsset: sdk.addresses.tokens.USDCe,
  venue: sdk.addresses.jaineVenueAdapter,
  policy: {
    maxPositionBps: 5000,        // 50%
    confidenceThreshold: 6000,   // 60%
    cooldownSeconds: 900,        // 15 min
    maxActionsPerDay: 6,
    stopLossBps: 1500,           // 15%
  },
  allowedAssets: [
    sdk.addresses.tokens.USDCe,
    sdk.addresses.tokens.WETH,
    sdk.addresses.tokens.WBTC,
    sdk.addresses.tokens.W0G,
  ],
});
```

### Polling

```js
const stop = sdk.orchestrator.poll(
  (c) => c.nav(vaultAddress),
  15000,
  (data) => updateChart(data),
  (err) => console.warn('poll error:', err.message),
);
// later:
stop();
```

### On-chain event streams

```js
const vault = sdk.vault(vaultAddress);

const offDeposit = vault.onDeposit((_vault, depositor, amount) => {
  console.log(`deposit from ${depositor}: ${amount}`);
});
const offExec = vault.onIntentExecuted((_vault, intentHash, amtIn, amtOut, success) => {
  console.log(`intent ${intentHash} → ${success ? 'ok' : 'FAIL'}: ${amtIn} → ${amtOut}`);
});

// Intent registry status
const reg = sdk.executionRegistry();
if (await reg.isFinalized(intentHash)) {
  const result = await reg.getResult(intentHash);
  console.log(result); // { txHash, amountOut, slippageBps, executedAt, success }
}
```

Tip: ethers falls back to ~4s polling on plain JSON-RPC. For live UIs, use a WebSocket provider to get true push delivery.

## API surface

### `new AegisSDK(opts)`

| Option | Default | Notes |
|---|---|---|
| `chainId` | `16661` | 0G Aristotle Mainnet |
| `rpcUrl` | (chain default) | Override RPC endpoint |
| `signer` | — | Ethers signer; without one, contract reads are lazy-read-only |
| `orchestratorUrl` | — | If set, `sdk.orchestrator` is enabled |
| `orchestratorApiKey` | — | Required for `triggerCycle()`, `ogFlush()` |

- `sdk.vault(addr)` → `VaultClient`
- `sdk.factory()` → `FactoryClient`
- `sdk.operator(addr)` → `OperatorClient`
- `sdk.token(addr)` → `TokenClient`
- `sdk.executionRegistry()` → `ExecutionRegistryClient`
- `sdk.multicall()` → `MulticallClient`
- `sdk.batch([...])` → per-call `{success, result, error?}` via Multicall3
- `sdk.registerOperator({...})` → one-shot operator onboarding
- `sdk.orchestrator` → `OrchestratorClient | null`
- `sdk.addresses` → address book for the configured chain
- `sdk.chainId`, `sdk.rpcUrl`

### `OrchestratorClient`

Every method returns a parsed JSON response. All accept an optional `AbortSignal`.

| Method | HTTP | Auth |
|---|---|---|
| `health()` / `status()` / `state()` | GET | — |
| `triggerCycle()` | POST `/api/cycle` | API key |
| `vault(address)` / `operator(address)` | GET | — |
| `market()` / `marketSummary()` / `pythPrices()` | GET | — |
| `nav(vaultAddress?)` | GET | — |
| `journal({limit, vault, type, level})` | GET | — |
| `decisions({limit, vault})` | GET | — |
| `executions({limit, vault})` | GET | — |
| `alerts({limit, vault, level})` | GET | — |
| `aiModels()` | GET | — |
| `ogStatus()` / `ogState()` / `ogKv(key)` | GET | — |
| `ogFlush()` | POST | API key |
| `poll(fn, intervalMs, onData, onError)` | — | Returns `stop()` |

### `VaultClient`

**Reads:**
- `getSummary()`, `getPolicy()`, `getAllowedAssets()`
- `getBaseAsset()`, `getOwner()`, `getExecutor()`, `getVenue()`
- `getTotalDeposited()`, `getLastExecution()`

**Writes** *(signer required)*:
- `deposit(amount)`, `withdraw(amount)` — raw
- `approveDeposit(amount)` — smart approve (skips if allowance already covers)
- `depositWithApproval(amount, onStep?)` — one-call flow, returns `{ approveHash, depositHash }`

**Event subscriptions** *(return unsubscribe function)*:
- `onDeposit`, `onWithdraw`, `onIntentCommitted`, `onIntentExecuted`
- `onIntentSubmitted`, `onIntentExpired`, `onSealedIntentExecuted`
- `onPaused`, `onUnpaused`, `onRiskBreached`, `onIntentBlocked`, `onFeeAccrued`
- `on(eventName, handler)` — generic escape hatch

### `TokenClient`

ERC-20 wrapper with one non-trivial helper:
- `balanceOf(addr)`, `allowance(owner, spender)`, `totalSupply()`
- `name()`, `symbol()`, `decimals()`, `getMetadata()` (cached)
- `approve(spender, amount)`, `ensureAllowance(spender, amount, owner?)` — skips tx if already approved

### `ExecutionRegistryClient`

- `isSubmitted(hash)`, `isFinalized(hash)`, `intentOwner(hash)`, `getResult(hash)`
- `isAuthorizedVault(vault)`
- `getVaultIntentCount(vault)`, `getVaultIntentAt(vault, i)`, `listVaultIntents(vault, { from, to, limit })`
- `computeIntentHash(intent)` — on-chain (authoritative)
- `ExecutionRegistryClient.computeIntentHashOffline(intent)` — pure offline, same schema
- `onIntentFinalized(handler)`, `onIntentRegistered(handler)`

### Multicall3 batch reads

```js
const token = sdk.addresses.tokens.USDCe;
const owner = '0xabc…';

const [balance, symbol, decimals] = await sdk.batch([
  { address: token, abi: ERC20_ABI, method: 'balanceOf', args: [owner] },
  { address: token, abi: ERC20_ABI, method: 'symbol' },
  { address: token, abi: ERC20_ABI, method: 'decimals' },
]).then(results => results.map(r => r.result));
```

One RPC call instead of three. Each returned entry is `{ success, result, error? }` — one reverting call does **not** poison the batch. Uses the canonical Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11`, verified deployed on 0G Mainnet.

### Manifest utilities

```js
import { buildManifest, computeManifestHash, parseManifest } from '@aegis-vault/sdk';

const manifest = buildManifest({
  name: 'Aegis Alpha',
  operator: '0x98cC…',
  mandate: 'Balanced',
  policy: {
    maxPositionBps: 5000, confidenceThresholdBps: 6000,
    stopLossBps: 1500, cooldownSeconds: 900, maxActionsPerDay: 6,
  },
  fees: { performanceBps: 1500, managementBps: 200 },
  allowedAssets: [
    { symbol: 'USDC.e', address: sdk.addresses.tokens.USDCe, decimals: 6 },
    { symbol: 'WETH',   address: sdk.addresses.tokens.WETH,  decimals: 18 },
  ],
});

// Deterministic content hash — same manifest bytes → same hash, regardless
// of key ordering. Matches what `publishManifest(uri, hash, bonded)` expects.
const hash = computeManifestHash(manifest);

// Later: fetch + verify
const text = await fetch('ipfs://…/manifest.json').then(r => r.text());
const fetched = parseManifest(text);               // throws on bad shape
const ok = computeManifestHash(fetched) === hash;  // tamper check
```

### Wallet helpers (browser)

```js
import { wallet } from '@aegis-vault/sdk';
// or: import * as wallet from '@aegis-vault/sdk/wallet';

await wallet.connect();                         // eth_requestAccounts
await wallet.switchNetwork(16661);              // auto-adds 0G Mainnet on 4902
const [account] = await wallet.getAccounts();
const chainId = await wallet.getCurrentChainId();

await wallet.watchAsset({
  address: sdk.addresses.tokens.USDCe,
  symbol: 'USDC.e', decimals: 6,
});

const offWallet = wallet.onWalletEvents({
  onAccountsChanged: (accounts) => refreshUI(accounts),
  onChainChanged: (chainIdHex) => reload(),
});
```

All helpers accept an optional second arg for a custom EIP-1193 provider (for wallets that don't inject to `window.ethereum`).

### Error handling

```js
import { parseContractError } from '@aegis-vault/sdk';

try {
  await sdk.vault(addr).deposit(amount);
} catch (err) {
  const parsed = parseContractError(err);
  // → { title, message, isUserReject, code?, raw }
  if (parsed.isUserReject) {
    // user clicked reject — don't show an error
  } else {
    toast.error(`${parsed.title}: ${parsed.message}`);
  }
}
```

`parseContractError` maps ethers v6 errors, EIP-1193 wallet rejections (code 4001), ERC-20 standard errors, and protocol custom errors (`TierCapExceeded`, `OperatorFrozen`, `IntentAlreadyFinalized`, etc.) to friendly `{ title, message }` pairs. Falls back to first-line-of-message for anything unknown.

### `FactoryClient`

- `totalVaults()`, `allVaults()`, `vaultAt(i)`, `vaultsOf(owner)`
- `isVault(addr)`, `vaultImplementation()`
- `createVault({operator, baseAsset, venue, policy, allowedAssets})` *(signer required)*

### `OperatorClient`

**Reads:**
- `isRegistered()`, `isActive()`, `getProfile()`, `getExtended()`, `getManifest()`
- `getStake()`, `getTier()`, `getMaxVaultSize()`, `getStakeToken()`
- `getStats()`, `getSuccessRateBps()`, `getAverageRating()`
- `getSnapshot()` — convenience one-shot across all three modules

**Writes** *(signer required)*:
- `register(input)`, `updateMetadata(input)` — see `buildOperatorInput`
- `declareAIModel({ model, provider, endpoint })`
- `publishManifest({ uri, hash, bonded })`
- `activate()`, `deactivate()`
- `approveStake(amount)`, `stake(amount)`, `requestUnstake(amount)`, `claimUnstake()`
- `createOperator({ input, ai?, manifest?, stakeAmount?, autoActivate?, onStep? })` — one-shot flow

## Network config

Exported as named constants from the root and from `@aegis-vault/sdk/config`:

```js
import { CHAINS, ADDRESSES, ASSET_DECIMALS, rawDeployments } from '@aegis-vault/sdk';

CHAINS.OG_MAINNET;               // 16661
ADDRESSES[16661].vaultFactory;   // V2 factory address
ADDRESSES[16661].tokens.USDCe;   // USDC.e on 0G mainnet
rawDeployments;                  // full deployments-mainnet.json
```

## Examples

- `examples/orchestrator-status.js` — print live orchestrator status
- `examples/read-vault.js` — read on-chain vault summary + NAV
- `examples/register-operator.js` — dry-run + live operator onboarding

Run with:

```bash
AEGIS_ORCHESTRATOR=https://orch.aegis.xyz node examples/orchestrator-status.js
AEGIS_VAULT=0xf7AAFFBddaf66B90f13fc3447634372eBF0Ea181 node examples/read-vault.js
```

### `MulticallClient`

- `aggregate3Raw(calls)` — raw: `[{target, callData, allowFailure?}]` → `[{success, returnData}]`
- `batch(calls)` — high-level: accepts ethers Contract instances or `{address, abi, method, args, allowFailure?}`; returns `[{success, result, error?}]` with decoded values
- `getBlockNumber()` — sanity check

### Manifest helpers

- `canonicalizeJson(obj)` — deterministic JSON (keys sorted recursively)
- `computeManifestHash(obj)` — keccak256 of canonical JSON (32-byte hex)
- `validateManifest(obj)` — throws on missing/invalid fields
- `parseManifest(text)` — JSON.parse + validate, returns object
- `buildManifest(params)` — constructor with defaults (`version: '1.0.0'`, `publishedAt: now`)

### Wallet helpers (`import { wallet } from '@aegis-vault/sdk'`)

- `addNetwork(chainId, provider?)`, `switchNetwork(chainId, provider?)` — auto-add on 4902
- `connect(provider?)` → `eth_requestAccounts`
- `getAccounts(provider?)` → `eth_accounts`
- `getCurrentChainId(provider?)` → number
- `watchAsset({address, symbol, decimals, image?}, provider?)` → boolean
- `onWalletEvents({onAccountsChanged, onChainChanged, onDisconnect}, provider?)` → unsubscribe

## Versioning

The SDK currently targets the **V2** contract stack on 0G Aristotle Mainnet (chain 16661). V1 addresses remain accessible via `sdk.addresses.legacy.*` for historical queries.

### Changelog
- **v0.3.0** — Multicall3 batch reads, manifest utilities, wallet shims
- **v0.2.0** — ERC-20 `TokenClient` + `approveDeposit`/`depositWithApproval`, `parseContractError`, `ExecutionRegistryClient`, vault event subscriptions
- **v0.1.0** — Core clients: orchestrator, vault, factory, operator + one-shot `registerOperator`

## License

MIT
