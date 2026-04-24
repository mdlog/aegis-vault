// VaultClient — thin ethers wrapper around a single AegisVault contract.
//
// Reads are the main use case (decoding `getVaultSummary` / `getPolicy` into
// friendly objects). Write methods require a signer; `approveDeposit` and
// `depositWithApproval` handle the ERC-20 approve dance so callers don't
// have to wire that themselves. Event helpers use the VaultEvents ABI
// because the actual events are emitted by a library that's inlined into
// the vault bytecode — they show up as logs *from the vault address*.

import { Contract } from 'ethers';
import AegisVaultABI from './abi/AegisVault.json' with { type: 'json' };
import VaultEventsABI from './abi/VaultEvents.json' with { type: 'json' };
import { TokenClient } from './token.js';

function decodeVaultSummary(raw) {
  return {
    owner: raw[0],
    executor: raw[1],
    baseAsset: raw[2],
    totalDeposited: raw[3],
    nav: raw[4],
    lastExecutionTime: Number(raw[5]),
    commitBlock: Number(raw[6]),
    paused: raw[7],
    hasPendingCommit: raw[8],
  };
}

function decodePolicy(raw) {
  return {
    maxPositionBps: Number(raw[0] ?? 0n),
    confidenceThreshold: Number(raw[1] ?? 0n),
    cooldownSeconds: Number(raw[2] ?? 0n),
    maxActionsPerDay: Number(raw[3] ?? 0n),
    stopLossBps: Number(raw[4] ?? 0n),
    raw,
  };
}

export class VaultClient {
  /**
   * @param {string} address  Vault contract address
   * @param {import('ethers').ContractRunner} runner  Provider or signer
   */
  constructor(address, runner) {
    if (!address) throw new Error('VaultClient: address is required');
    if (!runner)  throw new Error('VaultClient: runner (provider or signer) is required');
    this.address = address;
    this.runner = runner;
    this.contract = new Contract(address, AegisVaultABI, runner);
    // Separate Contract instance bound to the VaultEvents ABI so we can
    // subscribe to events that aren't in the AegisVault ABI itself.
    this.events = new Contract(address, VaultEventsABI, runner);
  }

  // ── Reads ────────────────────────────────────────────────────────

  async getSummary() {
    const raw = await this.contract.getVaultSummary();
    return decodeVaultSummary(raw);
  }

  async getPolicy() {
    const raw = await this.contract.getPolicy();
    return decodePolicy(raw);
  }

  async getAllowedAssets() { return this.contract.getAllowedAssets(); }

  async getBaseAsset()      { return this.contract.baseAsset(); }
  async getOwner()          { return this.contract.owner(); }
  async getExecutor()       { return this.contract.executor(); }
  async getVenue()          { return this.contract.venue(); }
  async getTotalDeposited() { return this.contract.totalDeposited(); }
  async getLastExecution()  { return Number(await this.contract.lastExecutionTime()); }

  // ── Deposit path ────────────────────────────────────────────────

  /**
   * Ensure the vault has enough ERC-20 allowance to pull `amount` of the
   * base asset from the caller. Returns the approve tx if one was sent, or
   * `null` if the existing allowance already covers `amount`.
   */
  async approveDeposit(amount) {
    const baseAssetAddr = await this.contract.baseAsset();
    const token = new TokenClient(baseAssetAddr, this.runner);
    return token.ensureAllowance(this.address, amount);
  }

  /**
   * Approve + deposit in one call. Waits for the approve receipt (when a
   * new approve was needed) before submitting the deposit so nonce ordering
   * is guaranteed.
   *
   * @param {bigint} amount
   * @param {(step: 'approve'|'deposit', tx: import('ethers').ContractTransactionResponse|null) => void} [onStep]
   * @returns {Promise<{ approveHash: string|null, depositHash: string }>}
   */
  async depositWithApproval(amount, onStep = () => {}) {
    const approveTx = await this.approveDeposit(amount);
    let approveHash = null;
    if (approveTx) {
      approveHash = approveTx.hash;
      onStep('approve', approveTx);
      await approveTx.wait();
    }
    onStep('deposit', null);
    const depositTx = await this.contract.deposit(amount);
    onStep('deposit', depositTx);
    return { approveHash, depositHash: depositTx.hash };
  }

  /** Raw deposit (caller approves allowance separately). */
  async deposit(amount) {
    return this.contract.deposit(amount);
  }

  /** Withdraw shares. `amount` is share units, not base-asset. */
  async withdraw(amount) {
    return this.contract.withdraw(amount);
  }

  // ── Event subscriptions ─────────────────────────────────────────
  //
  // Each helper returns an unsubscribe function. The runner must be connected
  // to a WebSocket or filter-capable provider for the subscription to stream;
  // with a plain JsonRpcProvider, ethers falls back to polling every ~4s.

  /** Generic subscribe by event name (uses VaultEvents ABI by default). */
  on(eventName, handler) {
    const listener = (...args) => handler(...args);
    this.events.on(eventName, listener);
    return () => { this.events.off(eventName, listener); };
  }

  /** `Deposited(vault, depositor, amount)` */
  onDeposit(handler) { return this.on('Deposited', handler); }

  /** `Withdrawn(vault, owner, amount)` */
  onWithdraw(handler) { return this.on('Withdrawn', handler); }

  /** `IntentCommitted(vault, commitHash, commitBlock)` */
  onIntentCommitted(handler) { return this.on('IntentCommitted', handler); }

  /** `IntentExecuted(vault, intentHash, amountIn, amountOut, success)` */
  onIntentExecuted(handler) { return this.on('IntentExecuted', handler); }

  /** `IntentSubmitted(vault, intentHash, assetIn, assetOut, amountIn)` */
  onIntentSubmitted(handler) { return this.on('IntentSubmitted', handler); }

  /** `IntentExpired(vault, intentHash)` */
  onIntentExpired(handler) { return this.on('IntentExpired', handler); }

  /** `SealedIntentExecuted(vault, intentHash, attestedSigner, attestationReportHash)` */
  onSealedIntentExecuted(handler) { return this.on('SealedIntentExecuted', handler); }

  /** `VaultPaused(vault, triggeredBy)` / `VaultUnpaused(vault, triggeredBy)` */
  onPaused(handler)   { return this.on('VaultPaused', handler); }
  onUnpaused(handler) { return this.on('VaultUnpaused', handler); }

  /** `RiskThresholdBreached(vault, riskType, currentValue, limitValue)` */
  onRiskBreached(handler) { return this.on('RiskThresholdBreached', handler); }

  /** `IntentBlocked(vault, intentHash, reason)` */
  onIntentBlocked(handler) { return this.on('IntentBlocked', handler); }

  /** `FeeAccrued(vault, managementFee, performanceFee, newHwm)` */
  onFeeAccrued(handler) { return this.on('FeeAccrued', handler); }
}
