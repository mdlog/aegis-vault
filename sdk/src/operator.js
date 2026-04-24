// OperatorClient — read + write surface over the operator stack:
//   - OperatorRegistry    : profile, manifest, mandate, activation
//   - OperatorStaking     : stake amount, tier, stake/unstake flow
//   - OperatorReputation  : execution stats, rating, success rate

import { Contract } from 'ethers';
import OperatorRegistryABI from './abi/OperatorRegistry.json' with { type: 'json' };
import OperatorStakingABI from './abi/OperatorStaking.json' with { type: 'json' };
import OperatorReputationABI from './abi/OperatorReputation.json' with { type: 'json' };
import MockERC20ABI from './abi/MockERC20.json' with { type: 'json' };

const TIER_LABELS = ['None', 'Bronze', 'Silver', 'Gold', 'Platinum'];

/**
 * Mandate enum — must match `OperatorRegistry.Mandate` solidity enum order.
 *
 *   enum Mandate { Conservative, Balanced, Tactical }
 */
export const Mandate = Object.freeze({
  Conservative: 0,
  Balanced: 1,
  Tactical: 2,
});

export const MandateLabel = Object.freeze({
  0: 'Conservative',
  1: 'Balanced',
  2: 'Tactical',
});

/**
 * Build the `OperatorInput` tuple expected by `register()` / `updateMetadata()`.
 *
 * Accepts either bps values directly (fields ending in `Bps`) OR percentages
 * (fields ending in `Pct`) — percent inputs are rounded to bps. Either form
 * works; mixing is allowed. Duration accepts `cooldownSeconds` directly or
 * `cooldownMinutes` (converted to seconds).
 *
 * @param {object} input
 * @param {string} input.name
 * @param {string} input.description
 * @param {string} input.endpoint
 * @param {number} input.mandate           0 | 1 | 2 (use `Mandate.*`)
 * @param {number} [input.performanceFeeBps]
 * @param {number} [input.performanceFeePct]
 * @param {number} [input.managementFeeBps]
 * @param {number} [input.managementFeePct]
 * @param {number} [input.entryFeeBps]
 * @param {number} [input.entryFeePct]
 * @param {number} [input.exitFeeBps]
 * @param {number} [input.exitFeePct]
 * @param {number} [input.recommendedMaxPositionBps]
 * @param {number} [input.recommendedMaxPositionPct]
 * @param {number} [input.recommendedConfidenceMinBps]
 * @param {number} [input.recommendedConfidenceMinPct]
 * @param {number} [input.recommendedStopLossBps]
 * @param {number} [input.recommendedStopLossPct]
 * @param {number} [input.recommendedCooldownSeconds]
 * @param {number} [input.recommendedCooldownMinutes]
 * @param {number} input.recommendedMaxActionsPerDay
 * @returns {object} the normalised tuple (ready to pass to register/updateMetadata)
 */
export function buildOperatorInput(input) {
  if (typeof input !== 'object' || !input) {
    throw new Error('buildOperatorInput: input object required');
  }
  // Validate required *identity* fields first so a missing `name` reports the
  // right error even when numeric fields are also missing.
  if (!input.name || !input.description || !input.endpoint) {
    throw new Error('buildOperatorInput: name, description, endpoint required');
  }
  if (input.mandate === undefined || ![0, 1, 2].includes(Number(input.mandate))) {
    throw new Error('buildOperatorInput: mandate must be 0 (Conservative), 1 (Balanced), or 2 (Tactical)');
  }
  if (input.recommendedMaxActionsPerDay === undefined) {
    throw new Error('buildOperatorInput: recommendedMaxActionsPerDay required');
  }

  const pctToBps = (pct) => Math.round(Number(pct) * 100);
  const pick = (bpsKey, pctKey) => {
    if (input[bpsKey] !== undefined) return Math.round(Number(input[bpsKey]));
    if (input[pctKey] !== undefined) return pctToBps(input[pctKey]);
    throw new Error(`buildOperatorInput: provide ${bpsKey} or ${pctKey}`);
  };
  const cooldown =
    input.recommendedCooldownSeconds !== undefined
      ? Math.round(Number(input.recommendedCooldownSeconds))
      : input.recommendedCooldownMinutes !== undefined
        ? Math.round(Number(input.recommendedCooldownMinutes) * 60)
        : (() => { throw new Error('buildOperatorInput: provide recommendedCooldownSeconds or recommendedCooldownMinutes'); })();

  return {
    name: input.name,
    description: input.description,
    endpoint: input.endpoint,
    mandate: Number(input.mandate),
    performanceFeeBps: pick('performanceFeeBps', 'performanceFeePct'),
    managementFeeBps: pick('managementFeeBps', 'managementFeePct'),
    entryFeeBps: pick('entryFeeBps', 'entryFeePct'),
    exitFeeBps: pick('exitFeeBps', 'exitFeePct'),
    recommendedMaxPositionBps: pick('recommendedMaxPositionBps', 'recommendedMaxPositionPct'),
    recommendedConfidenceMinBps: pick('recommendedConfidenceMinBps', 'recommendedConfidenceMinPct'),
    recommendedStopLossBps: pick('recommendedStopLossBps', 'recommendedStopLossPct'),
    recommendedCooldownSeconds: cooldown,
    recommendedMaxActionsPerDay: Math.round(Number(input.recommendedMaxActionsPerDay)),
  };
}

function toTuple(normalised) {
  return [
    normalised.name,
    normalised.description,
    normalised.endpoint,
    normalised.mandate,
    normalised.performanceFeeBps,
    normalised.managementFeeBps,
    normalised.entryFeeBps,
    normalised.exitFeeBps,
    normalised.recommendedMaxPositionBps,
    normalised.recommendedConfidenceMinBps,
    normalised.recommendedStopLossBps,
    normalised.recommendedCooldownSeconds,
    normalised.recommendedMaxActionsPerDay,
  ];
}

export class OperatorClient {
  /**
   * @param {object} opts
   * @param {string} opts.address         The operator EOA being queried
   * @param {string} opts.registry        OperatorRegistry contract address
   * @param {string} opts.staking         OperatorStaking contract address
   * @param {string} opts.reputation      OperatorReputation contract address
   * @param {import('ethers').ContractRunner} opts.runner
   */
  constructor({ address, registry, staking, reputation, runner }) {
    if (!address) throw new Error('OperatorClient: address is required');
    if (!runner)  throw new Error('OperatorClient: runner is required');
    this.address = address;
    this.runner = runner;
    this.registry   = registry   ? new Contract(registry,   OperatorRegistryABI,   runner) : null;
    this.staking    = staking    ? new Contract(staking,    OperatorStakingABI,    runner) : null;
    this.reputation = reputation ? new Contract(reputation, OperatorReputationABI, runner) : null;
  }

  // ── Registry reads ────────────────────────────────────────────────

  async isRegistered() {
    this._requireRegistry();
    return this.registry.isRegistered(this.address);
  }

  async isActive() {
    this._requireRegistry();
    return this.registry.isActive(this.address);
  }

  /** Full profile tuple from `getOperator` (fields depend on contract layout). */
  async getProfile() {
    this._requireRegistry();
    return this.registry.getOperator(this.address);
  }

  async getExtended() {
    this._requireRegistry();
    return this.registry.getOperatorExtended(this.address);
  }

  /**
   * Strategy manifest + AI commitment, pulled via the public `operatorExtended`
   * mapping. Field order MUST match the solidity struct:
   *   (manifestURI, manifestHash, manifestVersion, manifestUpdatedAt,
   *    aiModel, aiProvider, aiEndpoint, manifestBonded)
   */
  async getManifest() {
    this._requireRegistry();
    const raw = await this.registry.operatorExtended(this.address);
    return {
      manifestURI: raw[0],
      manifestHash: raw[1],
      manifestVersion: Number(raw[2]),
      manifestUpdatedAt: Number(raw[3]),
      aiModel: raw[4],
      aiProvider: raw[5],
      aiEndpoint: raw[6],
      manifestBonded: raw[7],
    };
  }

  // ── Registry writes ───────────────────────────────────────────────

  /**
   * Register as a new operator. `input` accepts either normalised bps form
   * (use directly) or human-friendly `*Pct` / `*Minutes` form — `buildOperatorInput`
   * is applied before sending. See {@link buildOperatorInput} for the schema.
   *
   * @returns {Promise<import('ethers').ContractTransactionResponse>}
   */
  async register(input) {
    this._requireRegistry();
    const normalised = buildOperatorInput(input);
    return this.registry.register(toTuple(normalised));
  }

  /** Update operator metadata (same shape as `register`). */
  async updateMetadata(input) {
    this._requireRegistry();
    const normalised = buildOperatorInput(input);
    return this.registry.updateMetadata(toTuple(normalised));
  }

  /**
   * Declare the AI model + attestation signer. Required for TEE-backed
   * operators that produce signed inference payloads.
   *
   * @param {object} args
   * @param {string} args.model     e.g. 'zai-org/GLM-5-FP8'
   * @param {string} args.provider  On-chain address of the attestation signer
   * @param {string} args.endpoint  Public inference endpoint URL
   */
  async declareAIModel({ model, provider, endpoint }) {
    this._requireRegistry();
    return this.registry.declareAIModel(model, provider, endpoint);
  }

  /**
   * Publish the strategy manifest (URI + content hash). Set `bonded=true`
   * once an on-chain bond backs the manifest; set `false` for unbonded drafts.
   *
   * @param {object} args
   * @param {string} args.uri   Public URI (ipfs://… or https://…)
   * @param {string} args.hash  32-byte hex hash of manifest contents
   * @param {boolean} args.bonded
   */
  async publishManifest({ uri, hash, bonded }) {
    this._requireRegistry();
    return this.registry.publishManifest(uri, hash, !!bonded);
  }

  /** Flip operator status to active (marketplace-visible). */
  async activate() {
    this._requireRegistry();
    return this.registry.activate();
  }

  async deactivate() {
    this._requireRegistry();
    return this.registry.deactivate();
  }

  // ── Staking reads ────────────────────────────────────────────────

  /** Current stake record (amount, lockedUntil, unstakeRequested, …). */
  async getStake() {
    this._requireStaking();
    return this.staking.getStake(this.address);
  }

  async getTier() {
    this._requireStaking();
    const idx = Number(await this.staking.tierOf(this.address));
    return TIER_LABELS[idx] ?? `Tier(${idx})`;
  }

  async getMaxVaultSize() {
    this._requireStaking();
    return this.staking.maxVaultSize(this.address);
  }

  /** The ERC-20 token accepted by the staking contract. */
  async getStakeToken() {
    this._requireStaking();
    return this.staking.stakeToken();
  }

  // ── Staking writes ───────────────────────────────────────────────

  /**
   * Approve the staking contract to pull `amount` of the stake token from
   * the caller. Returns null if the existing allowance already covers
   * `amount` (avoids a wasted tx on hot paths).
   *
   * @param {bigint} amount  Raw units
   */
  async approveStake(amount) {
    this._requireStaking();
    const tokenAddr = await this.getStakeToken();
    const token = new Contract(tokenAddr, MockERC20ABI, this.runner);
    const owner = await this._resolveCallerAddress();
    const current = await token.allowance(owner, this.staking.target);
    if (current >= BigInt(amount)) return null;
    return token.approve(this.staking.target, amount);
  }

  /**
   * Stake tokens. Caller is responsible for approving first (or call
   * `approveStake(amount)` right before this).
   */
  async stake(amount) {
    this._requireStaking();
    return this.staking.stake(amount);
  }

  async requestUnstake(amount) {
    this._requireStaking();
    return this.staking.requestUnstake(amount);
  }

  async claimUnstake() {
    this._requireStaking();
    return this.staking.claimUnstake();
  }

  // ── Reputation ────────────────────────────────────────────────────

  async getStats() {
    this._requireReputation();
    return this.reputation.getStats(this.address);
  }

  async getSuccessRateBps() {
    this._requireReputation();
    return Number(await this.reputation.successRateBps(this.address));
  }

  async getAverageRating() {
    this._requireReputation();
    return Number(await this.reputation.averageRatingScaled(this.address));
  }

  // ── Convenience ───────────────────────────────────────────────────

  async getSnapshot() {
    const [registered, active, tier, successRateBps, averageRating] = await Promise.all([
      this.registry   ? this.isRegistered()       : Promise.resolve(null),
      this.registry   ? this.isActive()           : Promise.resolve(null),
      this.staking    ? this.getTier()            : Promise.resolve(null),
      this.reputation ? this.getSuccessRateBps()  : Promise.resolve(null),
      this.reputation ? this.getAverageRating()   : Promise.resolve(null),
    ]);
    return { address: this.address, registered, active, tier, successRateBps, averageRating };
  }

  /**
   * One-shot operator onboarding. Runs the sub-steps that are relevant for
   * the given params, waiting for each tx to confirm before the next so the
   * registry's monotonic state is respected. Every step is optional except
   * `register` (skipped if already registered).
   *
   * Flow:
   *   1. register(input)            — unless already registered
   *   2. declareAIModel(ai)         — if `ai` provided
   *   3. publishManifest(manifest)  — if `manifest` provided
   *   4. approveStake + stake       — if `stakeAmount > 0n`
   *   5. activate()                 — unless `autoActivate === false`
   *
   * @param {object} params
   * @param {object} params.input     Same shape as `buildOperatorInput`
   * @param {{model:string, provider:string, endpoint:string}} [params.ai]
   * @param {{uri:string, hash:string, bonded:boolean}} [params.manifest]
   * @param {bigint} [params.stakeAmount]   Stake in raw token units
   * @param {boolean} [params.autoActivate=true]
   * @param {(step: string, tx?: import('ethers').ContractTransactionResponse|null) => void} [params.onStep]
   * @returns {Promise<{ txHashes: Record<string, string|null>, alreadyRegistered: boolean }>}
   */
  async createOperator(params) {
    this._requireRegistry();
    const { input, ai, manifest, stakeAmount, autoActivate = true, onStep = () => {} } = params || {};
    if (!input) throw new Error('createOperator: params.input is required');

    const txHashes = {
      register: null,
      declareAIModel: null,
      publishManifest: null,
      approveStake: null,
      stake: null,
      activate: null,
    };

    const alreadyRegistered = await this.isRegistered();
    if (!alreadyRegistered) {
      onStep('register', null);
      const tx = await this.register(input);
      txHashes.register = tx.hash;
      onStep('register', tx);
      await tx.wait();
    }

    if (ai) {
      onStep('declareAIModel', null);
      const tx = await this.declareAIModel(ai);
      txHashes.declareAIModel = tx.hash;
      onStep('declareAIModel', tx);
      await tx.wait();
    }

    if (manifest) {
      onStep('publishManifest', null);
      const tx = await this.publishManifest(manifest);
      txHashes.publishManifest = tx.hash;
      onStep('publishManifest', tx);
      await tx.wait();
    }

    if (stakeAmount && BigInt(stakeAmount) > 0n) {
      this._requireStaking();
      onStep('approveStake', null);
      const approveTx = await this.approveStake(stakeAmount);
      if (approveTx) {
        txHashes.approveStake = approveTx.hash;
        onStep('approveStake', approveTx);
        await approveTx.wait();
      }
      onStep('stake', null);
      const stakeTx = await this.stake(stakeAmount);
      txHashes.stake = stakeTx.hash;
      onStep('stake', stakeTx);
      await stakeTx.wait();
    }

    if (autoActivate) {
      const active = await this.isActive();
      if (!active) {
        onStep('activate', null);
        const tx = await this.activate();
        txHashes.activate = tx.hash;
        onStep('activate', tx);
        await tx.wait();
      }
    }

    return { txHashes, alreadyRegistered };
  }

  // ── internals ─────────────────────────────────────────────────────

  async _resolveCallerAddress() {
    // runner is a Signer when it has .getAddress(); otherwise fall back to
    // the queried operator address (allowance lookup on self is a reasonable
    // default for static-call dry-runs).
    if (typeof this.runner?.getAddress === 'function') {
      return this.runner.getAddress();
    }
    return this.address;
  }

  _requireRegistry()   { if (!this.registry)   throw new Error('OperatorClient: registry address not configured'); }
  _requireStaking()    { if (!this.staking)    throw new Error('OperatorClient: staking address not configured'); }
  _requireReputation() { if (!this.reputation) throw new Error('OperatorClient: reputation address not configured'); }
}
