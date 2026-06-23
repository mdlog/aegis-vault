// FactoryClient — list & (optionally) create vaults via AegisVaultFactory.
//
// Factory ABI is version-aware. The live deployment on 0G Aristotle Mainnet
// is the V4 factory (7-arg createVault that binds an accepted manifest hash),
// cut over on 2026-05-14. The V3 ABI (6-arg createVault) and V1 legacy ABI
// (5-arg createVault) remain available for callers reading older factories.
// Audit review identified that always binding the V1 ABI caused createVault
// to revert on V3/V4 factories — the fix selects the ABI by which optional
// args the caller passes.

import { Contract } from 'ethers';
import AegisVaultFactoryABI from './abi/AegisVaultFactory.json' with { type: 'json' };
import AegisVaultFactoryV3ABI from './abi/AegisVaultFactoryV3.json' with { type: 'json' };
import AegisVaultFactoryV4ABI from './abi/AegisVaultFactoryV4.json' with { type: 'json' };

// Default for `_maxCrossChainFeeBps` when caller doesn't override. 50 bps
// (0.5%) matches the protocol-level default used by the orchestrator and
// is the cap most vault owners pick for Khalani-routed flows.
const DEFAULT_MAX_CROSS_CHAIN_FEE_BPS = 50;

/**
 * Pick the factory ABI based on which optional args the caller is using.
 * - acceptedManifestHash present → V4 (7-arg createVault).
 * - maxCrossChainFeeBps present  → V3 (6-arg createVault).
 * - neither                       → V1 legacy (5-arg createVault).
 *
 * `version` ('v1' | 'v3' | 'v4') overrides this auto-detection when callers
 * want to be explicit (e.g. instantiating against a known factory).
 */
function pickFactoryAbi({ version }) {
  if (version === 'v4') return AegisVaultFactoryV4ABI;
  if (version === 'v3') return AegisVaultFactoryV3ABI;
  if (version === 'v1') return AegisVaultFactoryABI;
  // Default: V4 ABI matches the live 0G mainnet factory (cutover 2026-05-14).
  // V3 / V1 ABIs remain available via the explicit `version` opt-in for
  // reading older factories or legacy networks.
  return AegisVaultFactoryV4ABI;
}

/**
 * V3/V4 VaultPolicy is a 15-field struct. Build it from the smaller policy
 * object the SDK has historically accepted, filling any unspecified fields
 * with conservative defaults. Callers that need fine-grained control can
 * pass every key on `policy` directly — ethers will pick them up by name.
 */
function buildV3PolicyStruct(policy) {
  return {
    maxPositionBps:         policy.maxPositionBps         ?? 0n,
    maxDailyLossBps:        policy.maxDailyLossBps        ?? 0n,
    stopLossBps:            policy.stopLossBps            ?? 0n,
    cooldownSeconds:        policy.cooldownSeconds        ?? 0n,
    confidenceThresholdBps: policy.confidenceThresholdBps ?? policy.confidenceThreshold ?? 0n,
    maxActionsPerDay:       policy.maxActionsPerDay       ?? 0n,
    autoExecution:          policy.autoExecution          ?? false,
    paused:                 policy.paused                 ?? false,
    performanceFeeBps:      policy.performanceFeeBps      ?? 0n,
    managementFeeBps:       policy.managementFeeBps       ?? 0n,
    entryFeeBps:            policy.entryFeeBps            ?? 0n,
    exitFeeBps:             policy.exitFeeBps             ?? 0n,
    feeRecipient:           policy.feeRecipient           ?? '0x0000000000000000000000000000000000000000',
    sealedMode:             policy.sealedMode             ?? false,
    attestedSigner:         policy.attestedSigner         ?? '0x0000000000000000000000000000000000000000',
  };
}

/** V1 legacy 5-field tuple shape (kept for backwards-compat). */
function buildV1PolicyTuple(policy) {
  return [
    policy.maxPositionBps,
    policy.confidenceThreshold ?? policy.confidenceThresholdBps,
    policy.cooldownSeconds,
    policy.maxActionsPerDay,
    policy.stopLossBps,
  ];
}

export class FactoryClient {
  /**
   * @param {string} address  Factory contract address (V3 on 0G mainnet)
   * @param {import('ethers').ContractRunner} runner
   * @param {{ version?: 'v1' | 'v3' | 'v4' }} [opts]
   *   Optional ABI override. Defaults to V3 (matches the live mainnet factory).
   *   `createVault` will auto-upgrade to V4 if the caller passes
   *   `acceptedManifestHash`, regardless of this constructor hint.
   */
  constructor(address, runner, opts = {}) {
    if (!address) throw new Error('FactoryClient: address is required');
    if (!runner)  throw new Error('FactoryClient: runner is required');
    this.address = address;
    this.runner = runner;
    this.version = opts.version ?? 'v3';
    const abi = pickFactoryAbi({ version: this.version });
    this.contract = new Contract(address, abi, runner);
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
   * Selects factory arity based on which optional args are present:
   *   - `acceptedManifestHash` present → V4 (7-arg).
   *   - `maxCrossChainFeeBps`  present → V3 (6-arg).
   *   - neither                         → V1 legacy (5-arg).
   *
   * When the auto-detected version differs from the ABI bound at
   * construction (e.g. V4 path with a V3 instance), this method
   * transparently rebinds the contract instance to the correct ABI
   * for this call so encoding succeeds.
   *
   * @param {object} params
   * @param {string} params.operator       Operator address (must be registered)
   * @param {string} params.baseAsset      Base-asset ERC-20 (e.g. USDC.e)
   * @param {string} params.venue          Venue adapter address
   * @param {object} params.policy         VaultPolicy. V3/V4 expects the
   *   15-field struct; legacy V1 path accepts the historical 5-field shape.
   *   Unspecified fields default to 0/false/zero-address.
   * @param {string[]} params.allowedAssets Addresses allowed for trading
   * @param {number} [params.maxCrossChainFeeBps] V3+: cap on Khalani fees (bps).
   * @param {string} [params.acceptedManifestHash] V4 only: bytes32 hash of the
   *   strategy manifest the vault will accept on cross-chain executions.
   */
  async createVault({
    operator,
    baseAsset,
    venue,
    policy,
    allowedAssets,
    maxCrossChainFeeBps,
    acceptedManifestHash,
  }) {
    // V4 path — manifest hash binds cross-chain strategy commitments.
    if (acceptedManifestHash !== undefined) {
      const contract = this.version === 'v4'
        ? this.contract
        : new Contract(this.address, AegisVaultFactoryV4ABI, this.runner);
      const policyStruct = buildV3PolicyStruct(policy);
      return contract.createVault(
        operator,
        baseAsset,
        venue,
        policyStruct,
        allowedAssets,
        maxCrossChainFeeBps ?? DEFAULT_MAX_CROSS_CHAIN_FEE_BPS,
        acceptedManifestHash,
      );
    }

    // V3 path — current 0G mainnet factory.
    if (maxCrossChainFeeBps !== undefined || this.version === 'v3') {
      const contract = this.version === 'v3'
        ? this.contract
        : new Contract(this.address, AegisVaultFactoryV3ABI, this.runner);
      const policyStruct = buildV3PolicyStruct(policy);
      return contract.createVault(
        operator,
        baseAsset,
        venue,
        policyStruct,
        allowedAssets,
        maxCrossChainFeeBps ?? DEFAULT_MAX_CROSS_CHAIN_FEE_BPS,
      );
    }

    // V1 legacy path — only used when caller explicitly opted into v1.
    const contract = this.version === 'v1'
      ? this.contract
      : new Contract(this.address, AegisVaultFactoryABI, this.runner);
    const policyTuple = buildV1PolicyTuple(policy);
    return contract.createVault(operator, baseAsset, venue, policyTuple, allowedAssets);
  }
}
