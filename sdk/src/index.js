// Aegis Vault SDK — main entry point.
//
// Two ways to use this package:
//
// 1) High-level `AegisSDK` class — opinionated wiring for the common case:
//      const sdk = new AegisSDK({ chainId: 16661, orchestratorUrl, signer? });
//      await sdk.orchestrator.status();
//      await sdk.vault('0x...').getSummary();
//
// 2) Direct imports — if you only need one piece:
//      import { OrchestratorClient } from '@aegis-vault/sdk/orchestrator';
//      import { VaultClient }        from '@aegis-vault/sdk/vault';
//
// Ethers is a *peer* dependency: the orchestrator client works fine without
// it, but the contract clients will throw an import error if it's missing.

import { OrchestratorClient, OrchestratorError } from './orchestrator.js';
import { VaultClient } from './vault.js';
import { FactoryClient } from './factory.js';
import { OperatorClient, Mandate, MandateLabel, buildOperatorInput } from './operator.js';
import { TokenClient } from './token.js';
import { ExecutionRegistryClient } from './executionRegistry.js';
import { parseContractError, parseTxError, isUserRejection } from './errors.js';
import { MulticallClient } from './multicall.js';
import {
  canonicalizeJson,
  computeManifestHash,
  validateManifest,
  parseManifest,
  buildManifest,
} from './manifest.js';
import * as wallet from './wallet.js';
import {
  CHAINS,
  DEFAULT_RPC,
  EXPLORERS,
  ADDRESSES,
  ASSET_DECIMALS,
  MULTICALL3_ADDRESS,
  NETWORK_PARAMS,
  getAddresses,
  resolveRpcUrl,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  hasMulticall3,
  rawDeployments,
} from './config.js';

export class AegisSDK {
  /**
   * @param {object} [opts]
   * @param {number} [opts.chainId=16661]          Default: 0G Aristotle Mainnet
   * @param {string} [opts.rpcUrl]                 Override the RPC endpoint
   * @param {import('ethers').ContractRunner} [opts.signer]
   *   Ethers signer for write operations. If omitted, a read-only
   *   JsonRpcProvider is created lazily from `rpcUrl`.
   * @param {string} [opts.orchestratorUrl]        If set, enables `sdk.orchestrator`
   * @param {string} [opts.orchestratorApiKey]     Required for mutating orchestrator routes
   */
  constructor(opts = {}) {
    const chainId = opts.chainId ?? CHAINS.OG_MAINNET;
    this.chainId = chainId;
    this.addresses = getAddresses(chainId);
    this.rpcUrl = resolveRpcUrl(chainId, opts.rpcUrl);

    // Runner: caller-provided signer wins; otherwise lazily construct a
    // read-only provider the first time someone asks for it, so users who
    // only want the orchestrator API don't pay the ethers import cost.
    this._signer = opts.signer || null;
    this._provider = null;

    this.orchestrator = opts.orchestratorUrl
      ? new OrchestratorClient({
          baseUrl: opts.orchestratorUrl,
          apiKey: opts.orchestratorApiKey,
        })
      : null;
  }

  /** Lazily-constructed read-only provider. Only imports ethers on first use. */
  async _getProvider() {
    if (this._signer) return this._signer;
    if (this._provider) return this._provider;
    const { JsonRpcProvider } = await import('ethers');
    this._provider = new JsonRpcProvider(this.rpcUrl, this.chainId);
    return this._provider;
  }

  /**
   * VaultClient for the given address. Uses the configured signer for writes
   * (deposit/withdraw) or falls back to a read-only provider.
   */
  vault(address) {
    if (this._signer) return new VaultClient(address, this._signer);
    // Async runner path: we can't construct ethers Contract without a real
    // runner, so we defer to a helper that callers can await.
    return this._buildContractClient(VaultClient, address);
  }

  /** FactoryClient pinned to the chain's V2 factory address. */
  factory() {
    return this._buildContractClient(FactoryClient, this.addresses.vaultFactory);
  }

  /** ERC-20 TokenClient for an arbitrary token address. */
  token(address) {
    return this._buildContractClient(TokenClient, address);
  }

  /** ExecutionRegistryClient pinned to the chain's V2 registry. */
  executionRegistry() {
    return this._buildContractClient(ExecutionRegistryClient, this.addresses.executionRegistry);
  }

  /**
   * MulticallClient using the canonical Multicall3 address for batched reads.
   * Construction is lazy — only resolves the provider on first batch call.
   */
  multicall() {
    if (this._signer) {
      return new MulticallClient({ runner: this._signer });
    }
    const promise = this._getProvider().then((runner) => new MulticallClient({ runner }));
    return wrapAsyncClient(promise);
  }

  /**
   * Convenience: `sdk.batch([{ contract, method, args }, ...])` — proxies to
   * `MulticallClient.batch` with the default Multicall3 address. Returns per-
   * call `{ success, result }` entries.
   *
   * @param {Array<any>} calls  See `MulticallClient.batch` for shape.
   */
  async batch(calls) {
    const runner = await this._getProvider();
    const mc = new MulticallClient({ runner });
    return mc.batch(calls);
  }

  /** OperatorClient wired with the chain's registry/staking/reputation addresses. */
  operator(address) {
    const { operatorRegistry, operatorStaking, operatorReputation } = this.addresses;
    return this._buildOperatorClient(address, {
      registry: operatorRegistry,
      staking: operatorStaking,
      reputation: operatorReputation,
    });
  }

  /**
   * One-shot operator onboarding. Thin wrapper over `OperatorClient.createOperator`
   * that auto-resolves the caller's address from the SDK's signer. Requires the
   * SDK to be constructed with a `signer` (or a signer-capable runner).
   *
   * Flow: register → (declareAIModel) → (publishManifest) → (approve + stake) → activate.
   *
   * @param {object} params
   * @param {object} params.input                 OperatorInput (see `buildOperatorInput`)
   * @param {{model, provider, endpoint}} [params.ai]
   * @param {{uri, hash, bonded}} [params.manifest]
   * @param {bigint} [params.stakeAmount]         Raw token units; omit to skip staking
   * @param {boolean} [params.autoActivate=true]
   * @param {(step, tx?) => void} [params.onStep]
   */
  async registerOperator(params) {
    if (!this._signer) {
      throw new Error('registerOperator requires a signer. Pass `signer` to AegisSDK(...).');
    }
    if (typeof this._signer.getAddress !== 'function') {
      throw new Error('registerOperator: configured signer does not expose getAddress()');
    }
    const operatorAddress = await this._signer.getAddress();
    const client = new OperatorClient({
      address: operatorAddress,
      registry: this.addresses.operatorRegistry,
      staking: this.addresses.operatorStaking,
      reputation: this.addresses.operatorReputation,
      runner: this._signer,
    });
    return client.createOperator(params);
  }

  _buildContractClient(Klass, address) {
    if (this._signer) return new Klass(address, this._signer);
    // Sync-callable facade that resolves lazily. Exposes the same methods by
    // forwarding to a real client once the provider is ready.
    const promise = this._getProvider().then((runner) => new Klass(address, runner));
    return wrapAsyncClient(promise);
  }

  _buildOperatorClient(address, addrs) {
    if (this._signer) {
      return new OperatorClient({ address, runner: this._signer, ...addrs });
    }
    const promise = this._getProvider().then((runner) =>
      new OperatorClient({ address, runner, ...addrs }),
    );
    return wrapAsyncClient(promise);
  }
}

/**
 * Wrap a Promise<Client> so callers can do `await sdk.vault(addr).getSummary()`
 * without first awaiting the client itself. Every method call awaits the
 * underlying promise and forwards the invocation.
 */
function wrapAsyncClient(promise) {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return undefined; // don't masquerade as a thenable
      return async (...args) => {
        const client = await promise;
        const value = client[prop];
        return typeof value === 'function' ? value.apply(client, args) : value;
      };
    },
  });
}

// ── Re-exports ────────────────────────────────────────────────────────
export {
  OrchestratorClient,
  OrchestratorError,
  VaultClient,
  FactoryClient,
  OperatorClient,
  TokenClient,
  ExecutionRegistryClient,
  MulticallClient,
  Mandate,
  MandateLabel,
  buildOperatorInput,
  parseContractError,
  parseTxError,
  isUserRejection,
  canonicalizeJson,
  computeManifestHash,
  validateManifest,
  parseManifest,
  buildManifest,
  wallet,
  CHAINS,
  DEFAULT_RPC,
  EXPLORERS,
  ADDRESSES,
  ASSET_DECIMALS,
  MULTICALL3_ADDRESS,
  NETWORK_PARAMS,
  getAddresses,
  resolveRpcUrl,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  hasMulticall3,
  rawDeployments,
};

export default AegisSDK;
