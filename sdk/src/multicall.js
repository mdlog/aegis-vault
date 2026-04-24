// MulticallClient — batch on-chain reads into a single eth_call via Multicall3.
//
// The "raw" API takes pre-encoded call data (target + callData + allowFailure).
// The "high-level" `batch()` API accepts ethers Contract instances plus
// `{ method, args }` and handles encoding/decoding for you. Both versions
// decode failures into explicit `{ success, result }` tuples so one reverting
// call doesn't poison the rest of the batch.
//
// Benefits over Promise.all of individual calls:
//   - 1 RPC request instead of N (hits fewer rate limits on public nodes)
//   - Atomic block consistency (all reads reflect the same block)
//   - No race between parallel reads that query related state

import { Contract, Interface } from 'ethers';
import Multicall3ABI from './abi/Multicall3.json' with { type: 'json' };
import { MULTICALL3_ADDRESS } from './config.js';

export class MulticallClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.address]   Override address (defaults to canonical Multicall3)
   * @param {import('ethers').ContractRunner} opts.runner
   */
  constructor({ address, runner } = {}) {
    if (!runner) throw new Error('MulticallClient: runner is required');
    this.address = address || MULTICALL3_ADDRESS;
    this.contract = new Contract(this.address, Multicall3ABI, runner);
  }

  /** Current block number from the multicall contract (handy sanity check). */
  async getBlockNumber() {
    return Number(await this.contract.getBlockNumber());
  }

  /**
   * Low-level aggregate3. Accepts pre-encoded calls; returns raw `{ success,
   * returnData }` per call — caller is responsible for decoding `returnData`
   * with the right ABI.
   *
   * @param {Array<{ target: string, callData: string, allowFailure?: boolean }>} calls
   * @returns {Promise<Array<{ success: boolean, returnData: string }>>}
   */
  async aggregate3Raw(calls) {
    const tuples = calls.map((c) => ({
      target: c.target,
      allowFailure: c.allowFailure ?? true,
      callData: c.callData,
    }));
    const raw = await this.contract.aggregate3.staticCall(tuples);
    return raw.map((r) => ({ success: r.success ?? r[0], returnData: r.returnData ?? r[1] }));
  }

  /**
   * High-level batch. Accepts ethers Contract instances (or `{ address, abi }`
   * specs) plus `method` + `args` and handles encode/decode.
   *
   * Each returned entry is `{ success: bool, result: any|null, error?: Error }`.
   * On success, `result` is the decoded return value (scalar for single-output
   * functions, array for tuple returns — same shape as `contract[method](args)`).
   *
   * @param {Array<{
   *   contract?: import('ethers').Contract,
   *   address?: string,
   *   abi?: any[],
   *   method: string,
   *   args?: any[],
   *   allowFailure?: boolean,
   * }>} calls
   * @returns {Promise<Array<{ success: boolean, result: any|null, error?: Error }>>}
   */
  async batch(calls) {
    if (!calls?.length) return [];
    // Build one Interface per unique ABI so we don't re-parse the same one.
    const interfaces = new Map();
    const specs = calls.map((c) => {
      if (c.contract) {
        return {
          target: c.contract.target || c.contract.address,
          iface: c.contract.interface,
          method: c.method,
          args: c.args || [],
          allowFailure: c.allowFailure ?? true,
        };
      }
      if (!c.address || !c.abi) {
        throw new Error('MulticallClient.batch: each call needs `contract` or `{ address, abi }`');
      }
      let iface = interfaces.get(c.abi);
      if (!iface) {
        iface = new Interface(c.abi);
        interfaces.set(c.abi, iface);
      }
      return {
        target: c.address,
        iface,
        method: c.method,
        args: c.args || [],
        allowFailure: c.allowFailure ?? true,
      };
    });

    const encoded = specs.map((s) => ({
      target: s.target,
      allowFailure: s.allowFailure,
      callData: s.iface.encodeFunctionData(s.method, s.args),
    }));

    const results = await this.aggregate3Raw(encoded);

    return results.map((r, i) => {
      if (!r.success) {
        const err = new Error(`multicall: ${specs[i].method} reverted`);
        return { success: false, result: null, error: err };
      }
      try {
        const decoded = specs[i].iface.decodeFunctionResult(specs[i].method, r.returnData);
        // If the function has a single return value, unwrap the array so callers
        // get the scalar they'd get from `contract.method()` directly.
        const frag = specs[i].iface.getFunction(specs[i].method);
        const single = frag?.outputs?.length === 1;
        return { success: true, result: single ? decoded[0] : decoded };
      } catch (e) {
        return { success: false, result: null, error: e };
      }
    });
  }
}
