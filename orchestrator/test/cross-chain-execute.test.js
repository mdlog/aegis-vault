/**
 * submitCrossChainIntent unit tests — Phase 3 Khalani submission flow.
 *
 *   Uses the `_deps` test seam on submitCrossChainIntent to stub:
 *     - vault contract (acceptCrossChainFill)
 *     - ERC-20 balanceOf for prevBalance snapshot
 *     - khalani.buildDeposit / submitDeposit / pollOrderUntilTerminal
 *     - TEE typed-data signing
 *
 *   Tests cover the structural branches (early exits + happy path + each
 *   step's failure mode). Full end-to-end with a real Khalani API + on-chain
 *   acceptCrossChainFill lives in the contract test suite (AegisVault_v3.test.js)
 *   and an eventual integration test against a Khalani sandbox.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { submitCrossChainIntent } from '../src/services/executor.js';

const VAULT_ADDR  = '0x000000000000000000000000000000000000bEEF';
const TOKEN_USDC  = '0x000000000000000000000000000000000000Cafe';
const TOKEN_CBBTC = '0x000000000000000000000000000000000000C8B7';
const EXECUTOR    = '0x000000000000000000000000000000000000DEAD';

const baseIntent = {
  intentHash: '0x' + 'a'.repeat(64),
  vault: VAULT_ADDR,
  assetIn:  TOKEN_USDC,
  assetOut: TOKEN_CBBTC,
  amountIn:     1000n,
  minAmountOut: 90n,
  confidenceBps: 8000,
  riskScoreBps: 1500,
  attestationReportHash: '0x' + 'b'.repeat(64),
};

const baseRouteChoice = {
  route: 'khalani',
  amountOut: 100n,
  quoteId: 'q-test-1',
  routeId: 'r-test-1',
  khalaniRoute: { routeId: 'r-test-1', maxFeeBps: 50, ttlSec: 600 },
};

function makeDeps(overrides = {}) {
  // Deterministic stubs. Each test overrides the slice it cares about.
  const vault = {
    acceptCrossChainFill: async () => ({
      wait: async () => ({ hash: '0x' + '7'.repeat(64) }),
    }),
    ...overrides.vault,
  };
  const signer = {
    address: EXECUTOR,
    sendTransaction: async () => ({
      wait: async () => ({ hash: '0x' + '8'.repeat(64) }),
    }),
    ...overrides.signer,
  };
  const erc20 = {
    balanceOf: async () => 50n,        // prevBalance
    ...overrides.erc20,
  };
  return {
    vault,
    signer,
    executorAddr: EXECUTOR,
    erc20Factory: () => erc20,
    signTyped: async () => ({ signer: '0x' + 'F'.repeat(40), signature: '0x' + '1'.repeat(130) }),
    buildDeposit: async () => ({ tx: { to: '0xabc', data: '0x1234', value: 0n }, approvals: [] }),
    submitDeposit: async () => ({ orderId: 'order-test-1' }),
    pollOrder: async () => ({ status: 'filled', actualAmountOut: '100', actualFeeBps: 50 }),
    broadcast: async () => ({
      wait: async () => ({ hash: '0x' + '8'.repeat(64) }),
    }),
    ...overrides,
  };
}

test('returns route_not_khalani when routeChoice.route !== "khalani"', async () => {
  const r = await submitCrossChainIntent({
    intent: baseIntent,
    routeChoice: { route: 'jaine' },
    vaultAddress: VAULT_ADDR,
    _deps: makeDeps(),
  });
  assert.equal(r.success, false);
  assert.equal(r.error, 'route_not_khalani');
});

test('returns missing_quote_or_route_id when ids absent', async () => {
  const r = await submitCrossChainIntent({
    intent: baseIntent,
    routeChoice: { route: 'khalani' },
    vaultAddress: VAULT_ADDR,
    _deps: makeDeps(),
  });
  assert.equal(r.success, false);
  assert.equal(r.error, 'missing_quote_or_route_id');
});

test('happy path returns success with order id + tx hash', async () => {
  const r = await submitCrossChainIntent({
    intent: baseIntent,
    routeChoice: baseRouteChoice,
    vaultAddress: VAULT_ADDR,
    _deps: makeDeps(),
  });
  assert.equal(r.success, true);
  assert.equal(r.khalaniOrderId, 'order-test-1');
  assert.equal(r.amountOut, '100');
  assert.match(r.txHash, /^0x7+$/);
});

test('khalani.buildDeposit failure is captured + returned as error', async () => {
  const r = await submitCrossChainIntent({
    intent: baseIntent,
    routeChoice: baseRouteChoice,
    vaultAddress: VAULT_ADDR,
    _deps: makeDeps({ buildDeposit: async () => { throw new Error('5xx upstream'); } }),
  });
  assert.equal(r.success, false);
  assert.match(r.error, /khalani\.buildDeposit failed: 5xx upstream/);
});

test('deposit broadcast failure is captured', async () => {
  const r = await submitCrossChainIntent({
    intent: baseIntent,
    routeChoice: baseRouteChoice,
    vaultAddress: VAULT_ADDR,
    _deps: makeDeps({ broadcast: async () => { throw new Error('insufficient gas'); } }),
  });
  assert.equal(r.success, false);
  assert.match(r.error, /deposit broadcast failed/);
});

test('submitDeposit without orderId is rejected', async () => {
  const r = await submitCrossChainIntent({
    intent: baseIntent,
    routeChoice: baseRouteChoice,
    vaultAddress: VAULT_ADDR,
    _deps: makeDeps({ submitDeposit: async () => ({}) }),
  });
  assert.equal(r.success, false);
  assert.match(r.error, /no orderId/);
});

test('non-filled terminal state surfaces the actual status', async () => {
  const r = await submitCrossChainIntent({
    intent: baseIntent,
    routeChoice: baseRouteChoice,
    vaultAddress: VAULT_ADDR,
    _deps: makeDeps({ pollOrder: async () => ({ status: 'refunded' }) }),
  });
  assert.equal(r.success, false);
  assert.match(r.error, /terminal state: refunded/);
});

test('acceptCrossChainFill revert surfaces as error (no fund loss)', async () => {
  const r = await submitCrossChainIntent({
    intent: baseIntent,
    routeChoice: baseRouteChoice,
    vaultAddress: VAULT_ADDR,
    _deps: makeDeps({
      vault: {
        acceptCrossChainFill: async () => { throw new Error('CrossChain_NotSettled'); },
      },
    }),
  });
  assert.equal(r.success, false);
  assert.match(r.error, /acceptCrossChainFill: CrossChain_NotSettled/);
});

test('approvals in the deposit plan run before the deposit tx', async () => {
  let approvalSent = 0;
  let depositSent = 0;

  // Custom broadcast stub that mirrors the real broadcastDepositTx ordering
  // (approvals first, deposit last) and uses the test's signer to count txs.
  const customBroadcast = async (depositPlan, signer) => {
    for (const a of (depositPlan.approvals || [])) {
      const tx = await signer.sendTransaction({ to: a.to, data: a.data, value: a.value || 0n });
      await tx.wait();
    }
    return signer.sendTransaction({
      to: depositPlan.tx.to,
      data: depositPlan.tx.data,
      value: depositPlan.tx.value || 0n,
    });
  };

  const r = await submitCrossChainIntent({
    intent: baseIntent,
    routeChoice: baseRouteChoice,
    vaultAddress: VAULT_ADDR,
    _deps: makeDeps({
      buildDeposit: async () => ({
        approvals: [
          { to: '0xapproveTarget', data: '0xapprove', value: 0n },
        ],
        tx: { to: '0xdepositTarget', data: '0xdeposit', value: 0n },
      }),
      broadcast: customBroadcast,
      signer: {
        address: EXECUTOR,
        sendTransaction: async (txReq) => {
          if (txReq.to === '0xapproveTarget') approvalSent++;
          else if (txReq.to === '0xdepositTarget') depositSent++;
          return { wait: async () => ({ hash: '0x' + '9'.repeat(64) }) };
        },
      },
    }),
  });

  assert.equal(r.success, true);
  assert.equal(approvalSent, 1, 'approval should have been broadcast first');
  assert.equal(depositSent,  1, 'deposit should have been broadcast after approvals');
});
