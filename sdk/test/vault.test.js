// VaultClient tests — approve+deposit coordination and event subscription
// handles. Uses stubs for the underlying ethers Contracts so no RPC is hit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VaultClient } from '../src/vault.js';

function makeVault({ baseAsset = '0xBASE', allowance = 0n } = {}) {
  const calls = [];
  const events = new Map(); // eventName -> Set<listener>
  const vaultContract = {
    target: '0xVAULT',
    baseAsset: async () => baseAsset,
    deposit: async (amount) => {
      calls.push({ name: 'deposit', args: [amount] });
      return { hash: '0xDEPOSIT', wait: async () => ({ status: 1 }) };
    },
    withdraw: async (amount) => {
      calls.push({ name: 'withdraw', args: [amount] });
      return { hash: '0xWITHDRAW', wait: async () => ({ status: 1 }) };
    },
  };
  const eventsContract = {
    target: '0xVAULT',
    on: (name, listener) => {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(listener);
    },
    off: (name, listener) => {
      events.get(name)?.delete(listener);
    },
  };

  const runner = {
    getAddress: async () => '0xOWNER',
    // Used when TokenClient is constructed: we can't easily stub this without
    // monkey-patching its Contract too. For event tests we don't need approveDeposit,
    // and for approveDeposit tests we override the whole method.
  };

  const client = Object.create(VaultClient.prototype);
  client.address = '0xVAULT';
  client.runner = runner;
  client.contract = vaultContract;
  client.events = eventsContract;

  // approveDeposit builds a TokenClient via `new` — stub it inline so we don't
  // drag ethers Contract() into this unit test.
  client.approveDeposit = async (amount) => {
    calls.push({ name: 'approveDeposit', args: [amount] });
    if (BigInt(allowance) >= BigInt(amount)) return null;
    return { hash: '0xAPPROVE', wait: async () => ({ status: 1 }) };
  };

  return { client, calls, events };
}

test('depositWithApproval: runs approve → deposit when allowance insufficient', async () => {
  const { client, calls } = makeVault({ allowance: 0n });
  const steps = [];
  const out = await client.depositWithApproval(1_000n, (step, tx) => {
    if (tx) steps.push(step);
  });
  assert.deepEqual(calls.map((c) => c.name), ['approveDeposit', 'deposit']);
  assert.deepEqual(steps, ['approve', 'deposit']);
  assert.equal(out.approveHash, '0xAPPROVE');
  assert.equal(out.depositHash, '0xDEPOSIT');
});

test('depositWithApproval: skips approve when allowance already covers', async () => {
  const { client, calls } = makeVault({ allowance: 999_999_999n });
  const out = await client.depositWithApproval(1_000n);
  assert.deepEqual(calls.map((c) => c.name), ['approveDeposit', 'deposit']);
  // approveDeposit was called but returned null (our stub); depositWithApproval
  // must NOT wait on a nonexistent approve tx — check that approveHash is null.
  assert.equal(out.approveHash, null);
  assert.equal(out.depositHash, '0xDEPOSIT');
});

test('event subscriptions register + unsubscribe cleanly', () => {
  const { client, events } = makeVault();
  let received = null;
  const off = client.onDeposit((...args) => { received = args; });
  assert.equal(events.get('Deposited')?.size, 1);

  // Simulate an event being emitted by calling the stored listener
  const listener = [...events.get('Deposited')][0];
  listener('0xVAULT', '0xDEP', 123n);
  assert.deepEqual(received, ['0xVAULT', '0xDEP', 123n]);

  off();
  assert.equal(events.get('Deposited').size, 0, 'off() must remove the listener');
});

test('generic on() works for arbitrary event names', () => {
  const { client, events } = makeVault();
  const off = client.on('RiskThresholdBreached', () => {});
  assert.equal(events.get('RiskThresholdBreached')?.size, 1);
  off();
  assert.equal(events.get('RiskThresholdBreached').size, 0);
});

test('all documented event helpers bind to their advertised event name', () => {
  const { client, events } = makeVault();
  const pairs = [
    ['onDeposit', 'Deposited'],
    ['onWithdraw', 'Withdrawn'],
    ['onIntentCommitted', 'IntentCommitted'],
    ['onIntentExecuted', 'IntentExecuted'],
    ['onIntentSubmitted', 'IntentSubmitted'],
    ['onIntentExpired', 'IntentExpired'],
    ['onSealedIntentExecuted', 'SealedIntentExecuted'],
    ['onPaused', 'VaultPaused'],
    ['onUnpaused', 'VaultUnpaused'],
    ['onRiskBreached', 'RiskThresholdBreached'],
    ['onIntentBlocked', 'IntentBlocked'],
    ['onFeeAccrued', 'FeeAccrued'],
  ];
  const unsubs = pairs.map(([method, event]) => {
    const off = client[method](() => {});
    assert.equal(events.get(event)?.size, 1, `${method} should register for ${event}`);
    return [event, off];
  });
  unsubs.forEach(([event, off]) => {
    off();
    assert.equal(events.get(event).size, 0, `unsubscribe for ${event} must work`);
  });
});
