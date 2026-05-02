// TokenClient — minimal ERC-20 wrapper. We use the MockERC20 ABI because it
// contains the standard ERC-20 surface (balanceOf / allowance / approve /
// decimals / symbol / Transfer + Approval events) plus OpenZeppelin custom
// errors that our `parseContractError` already maps.

import { Contract } from 'ethers';
import ERC20ABI from './abi/MockERC20.json' with { type: 'json' };

export class TokenClient {
  /**
   * @param {string} address  ERC-20 contract address
   * @param {import('ethers').ContractRunner} runner
   */
  constructor(address, runner) {
    if (!address) throw new Error('TokenClient: address is required');
    if (!runner)  throw new Error('TokenClient: runner is required');
    this.address = address;
    this.contract = new Contract(address, ERC20ABI, runner);
    this.runner = runner;
    this._metadata = null; // lazily-cached { name, symbol, decimals }
  }

  async balanceOf(account) { return this.contract.balanceOf(account); }
  async allowance(owner, spender) { return this.contract.allowance(owner, spender); }
  async totalSupply() { return this.contract.totalSupply(); }

  async name()     { return this.contract.name(); }
  async symbol()   { return this.contract.symbol(); }
  async decimals() { return Number(await this.contract.decimals()); }

  /**
   * Fetch + cache `name`, `symbol`, `decimals` in one roundtrip. Safe to call
   * repeatedly — subsequent calls return the cached value. Useful for UI code
   * that needs to format amounts per-token.
   */
  async getMetadata() {
    if (this._metadata) return this._metadata;
    const [name, symbol, decimals] = await Promise.all([
      this.contract.name(),
      this.contract.symbol(),
      this.contract.decimals(),
    ]);
    this._metadata = { name, symbol, decimals: Number(decimals) };
    return this._metadata;
  }

  /** Raw approve. Prefer `ensureAllowance` for the common "approve if needed" case. */
  async approve(spender, amount) {
    return this.contract.approve(spender, amount);
  }

  /**
   * Approve only if the current allowance is below `amount`. Returns:
   *   - the approve tx (if one was sent), OR
   *   - `null` when allowance already covers the amount (no tx submitted).
   *
   * Saves a wallet prompt + ~$pennies of gas on the hot path when users
   * re-deposit into the same vault.
   *
   * Race-safe: when an existing nonzero allowance must be raised, we first
   * reset it to 0 in a separate transaction. The classic ERC-20 issue is that
   * a malicious or compromised spender can spend the *old* allowance after
   * seeing the new approve in the mempool, then spend the new allowance once
   * mined — totalling (old + new) instead of new. Resetting first closes that
   * window and keeps the SDK compatible with strict tokens (USDT) that revert
   * on a non-zero → non-zero approval.
   *
   * @param {string} spender
   * @param {bigint} amount
   * @param {string} [owner]  Defaults to the runner's address (when runner is a signer)
   */
  async ensureAllowance(spender, amount, owner) {
    const ownerAddr = owner || await this._resolveOwner();
    const current = await this.contract.allowance(ownerAddr, spender);
    const currentBn = BigInt(current);
    const targetBn = BigInt(amount);
    if (currentBn >= targetBn) return null;
    if (currentBn > 0n) {
      const resetTx = await this.contract.approve(spender, 0n);
      // Wait for confirmation so the next approve cannot be reordered ahead
      // of the reset. `wait()` resolves with the receipt; we do not need it.
      if (typeof resetTx?.wait === 'function') {
        await resetTx.wait();
      }
    }
    return this.contract.approve(spender, targetBn);
  }

  async _resolveOwner() {
    if (typeof this.runner?.getAddress === 'function') {
      return this.runner.getAddress();
    }
    throw new Error('TokenClient: owner address is required when runner is not a signer');
  }
}
