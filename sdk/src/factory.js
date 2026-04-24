// FactoryClient — list & (optionally) create vaults via AegisVaultFactory.

import { Contract } from 'ethers';
import AegisVaultFactoryABI from './abi/AegisVaultFactory.json' with { type: 'json' };

export class FactoryClient {
  /**
   * @param {string} address  Factory contract address (use V2 on 0G mainnet)
   * @param {import('ethers').ContractRunner} runner
   */
  constructor(address, runner) {
    if (!address) throw new Error('FactoryClient: address is required');
    if (!runner)  throw new Error('FactoryClient: runner is required');
    this.address = address;
    this.contract = new Contract(address, AegisVaultFactoryABI, runner);
  }

  /** Total number of vaults ever created. */
  async totalVaults() {
    return Number(await this.contract.totalVaults());
  }

  /** Get the vault address at index `i`. */
  async vaultAt(index) {
    return this.contract.getVaultAt(index);
  }

  /**
   * Enumerate all vault addresses. For large registries prefer `vaultAt`
   * + pagination; this helper exists because the typical deployment has
   * tens-to-hundreds of vaults, not millions.
   */
  async allVaults() {
    const total = await this.totalVaults();
    if (total === 0) return [];
    const idxs = Array.from({ length: total }, (_, i) => i);
    return Promise.all(idxs.map((i) => this.contract.allVaults(i)));
  }

  /** All vault addresses whose owner is `owner`. */
  async vaultsOf(owner) {
    return this.contract.getOwnerVaults(owner);
  }

  async isVault(address) {
    return this.contract.isVault(address);
  }

  async vaultImplementation() {
    return this.contract.vaultImplementation();
  }

  /**
   * Create a new vault. Caller must pass a signer-connected runner.
   *
   * @param {object} params
   * @param {string} params.operator       Operator address (must be registered)
   * @param {string} params.baseAsset      Base-asset ERC-20 (e.g. USDC.e)
   * @param {string} params.venue          Venue adapter address
   * @param {{
   *   maxPositionBps: number|bigint,
   *   confidenceThreshold: number|bigint,
   *   cooldownSeconds: number|bigint,
   *   maxActionsPerDay: number|bigint,
   *   stopLossBps: number|bigint,
   * }} params.policy                       VaultPolicy tuple
   * @param {string[]} params.allowedAssets Addresses allowed for trading
   */
  async createVault({ operator, baseAsset, venue, policy, allowedAssets }) {
    const policyTuple = [
      policy.maxPositionBps,
      policy.confidenceThreshold,
      policy.cooldownSeconds,
      policy.maxActionsPerDay,
      policy.stopLossBps,
    ];
    return this.contract.createVault(operator, baseAsset, venue, policyTuple, allowedAssets);
  }
}
