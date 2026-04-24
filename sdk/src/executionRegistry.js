// ExecutionRegistryClient — intent lifecycle tracking.
//
// The registry is the on-chain source of truth for every intent a vault
// submits: registration, commit, execution result, finalisation. This client
// wraps the read surface (status lookups, enumeration per vault, pure
// `computeIntentHash`) plus the admin writes.

import { Contract, solidityPackedKeccak256 } from 'ethers';
import ExecutionRegistryABI from './abi/ExecutionRegistry.json' with { type: 'json' };

/**
 * Decode the `ExecutionResult` tuple returned by `getResult(intentHash)`.
 *
 *   (bytes32 intentHash, bytes32 txHash,
 *    uint256 amountOut, uint256 executedAt, uint256 slippageBps,
 *    bool success)
 */
function decodeResult(raw) {
  return {
    intentHash: raw[0],
    txHash: raw[1],
    amountOut: raw[2],
    executedAt: Number(raw[3]),
    slippageBps: Number(raw[4]),
    success: raw[5],
  };
}

export class ExecutionRegistryClient {
  /**
   * @param {string} address
   * @param {import('ethers').ContractRunner} runner
   */
  constructor(address, runner) {
    if (!address) throw new Error('ExecutionRegistryClient: address is required');
    if (!runner)  throw new Error('ExecutionRegistryClient: runner is required');
    this.address = address;
    this.contract = new Contract(address, ExecutionRegistryABI, runner);
  }

  // ── Status lookups ───────────────────────────────────────────────

  async isSubmitted(intentHash) { return this.contract.isSubmitted(intentHash); }
  async isFinalized(intentHash) { return this.contract.isFinalized(intentHash); }

  /** Vault address that owns the intent, or zero address if unknown. */
  async intentOwner(intentHash) { return this.contract.intentOwner(intentHash); }

  async getResult(intentHash) {
    const raw = await this.contract.getResult(intentHash);
    return decodeResult(raw);
  }

  async isAuthorizedVault(vault) { return this.contract.authorizedVaults(vault); }

  // ── Per-vault enumeration ────────────────────────────────────────

  async getVaultIntentCount(vault) {
    return Number(await this.contract.getVaultIntentCount(vault));
  }

  async getVaultIntentAt(vault, index) {
    return this.contract.getVaultIntentAt(vault, index);
  }

  /**
   * Walk `[from, to)` of a vault's intent history. Defaults: latest 50.
   * Returns oldest-first for stable pagination; reverse client-side if you
   * want newest-first.
   *
   * @param {string} vault
   * @param {{ from?: number, to?: number, limit?: number }} [opts]
   * @returns {Promise<string[]>}
   */
  async listVaultIntents(vault, opts = {}) {
    const total = await this.getVaultIntentCount(vault);
    if (total === 0) return [];
    const limit = opts.limit ?? 50;
    const to = opts.to ?? total;
    const from = opts.from ?? Math.max(0, to - limit);
    const size = Math.max(0, Math.min(total, to) - from);
    if (size === 0) return [];
    const idxs = Array.from({ length: size }, (_, i) => from + i);
    return Promise.all(idxs.map((i) => this.contract.getVaultIntentAt(vault, i)));
  }

  // ── Hash computation ─────────────────────────────────────────────

  /**
   * Pure on-chain `computeIntentHash` — asks the contract. Always returns
   * the canonical hash (authoritative for disputes).
   *
   * @param {object} intent
   * @param {string} intent.vault
   * @param {string} intent.assetIn
   * @param {string} intent.assetOut
   * @param {bigint} intent.amountIn
   * @param {bigint} intent.minAmountOut
   * @param {number|bigint} intent.createdAt
   * @param {number|bigint} intent.expiresAt
   * @param {number|bigint} intent.confidenceBps
   * @param {number|bigint} intent.riskScoreBps
   */
  async computeIntentHash(intent) {
    return this.contract.computeIntentHash(
      intent.vault,
      intent.assetIn,
      intent.assetOut,
      intent.amountIn,
      intent.minAmountOut,
      intent.createdAt,
      intent.expiresAt,
      intent.confidenceBps,
      intent.riskScoreBps,
    );
  }

  /**
   * Offline equivalent of `computeIntentHash` — useful for pre-submission
   * UX (preview the hash, compare against registry.isSubmitted) without an
   * extra RPC roundtrip. Uses the same packed-keccak256 schema as the
   * contract.
   */
  static computeIntentHashOffline(intent) {
    return solidityPackedKeccak256(
      [
        'address', 'address', 'address',
        'uint256', 'uint256', 'uint256',
        'uint256', 'uint256', 'uint256',
      ],
      [
        intent.vault,
        intent.assetIn,
        intent.assetOut,
        intent.amountIn,
        intent.minAmountOut,
        intent.createdAt,
        intent.expiresAt,
        intent.confidenceBps,
        intent.riskScoreBps,
      ],
    );
  }

  // ── Event streams ────────────────────────────────────────────────

  /**
   * Subscribe to `IntentFinalized(intentHash)` events. Returns an
   * unsubscribe function.
   */
  onIntentFinalized(handler) {
    const contract = this.contract;
    const listener = (...args) => handler(...args);
    contract.on('IntentFinalized', listener);
    return () => { contract.off('IntentFinalized', listener); };
  }

  /** Subscribe to `IntentRegistered(intentHash, vault)` events. */
  onIntentRegistered(handler) {
    const contract = this.contract;
    const listener = (...args) => handler(...args);
    contract.on('IntentRegistered', listener);
    return () => { contract.off('IntentRegistered', listener); };
  }
}
