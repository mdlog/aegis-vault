// Wallet shim tests — stub an EIP-1193 provider and verify every helper
// calls the right method with the right params, plus the 4902 auto-add
// retry on switchNetwork.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addNetwork,
  switchNetwork,
  connect,
  getAccounts,
  getCurrentChainId,
  watchAsset,
  onWalletEvents,
} from '../src/wallet.js';

function makeProvider({ onRequest, supportEvents = true } = {}) {
  const calls = [];
  const listeners = new Map();
  const provider = {
    request: async ({ method, params }) => {
      calls.push({ method, params });
      if (onRequest) return onRequest({ method, params });
      return null;
    },
  };
  if (supportEvents) {
    provider.on = (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    };
    provider.removeListener = (event, handler) => {
      listeners.get(event)?.delete(handler);
    };
  }
  return { provider, calls, listeners };
}

test('addNetwork: calls wallet_addEthereumChain with NETWORK_PARAMS entry', async () => {
  const { provider, calls } = makeProvider();
  await addNetwork(16661, provider);
  assert.equal(calls[0].method, 'wallet_addEthereumChain');
  assert.equal(calls[0].params[0].chainId, '0x4115');
  assert.equal(calls[0].params[0].chainName, '0G Aristotle Mainnet');
});

test('addNetwork: throws for unknown chain', async () => {
  const { provider } = makeProvider();
  await assert.rejects(() => addNetwork(999999, provider), /no NETWORK_PARAMS entry/);
});

test('switchNetwork: happy path — switch succeeds', async () => {
  const { provider, calls } = makeProvider();
  await switchNetwork(16661, provider);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'wallet_switchEthereumChain');
  assert.equal(calls[0].params[0].chainId, '0x4115');
});

test('switchNetwork: 4902 → auto-add + retry switch', async () => {
  let attempt = 0;
  const { provider, calls } = makeProvider({
    onRequest: ({ method }) => {
      if (method === 'wallet_switchEthereumChain' && attempt === 0) {
        attempt++;
        const err = new Error('Unrecognized chain');
        err.code = 4902;
        throw err;
      }
      return null;
    },
  });
  await switchNetwork(16661, provider);
  assert.equal(calls[0].method, 'wallet_switchEthereumChain'); // first try (fails)
  assert.equal(calls[1].method, 'wallet_addEthereumChain');     // auto-add
  assert.equal(calls[2].method, 'wallet_switchEthereumChain'); // retry (succeeds)
});

test('switchNetwork: rethrows non-4902 errors without retry', async () => {
  const { provider } = makeProvider({
    onRequest: () => { const e = new Error('nope'); e.code = -32000; throw e; },
  });
  await assert.rejects(() => switchNetwork(16661, provider), /nope/);
});

test('connect & getAccounts: use eth_requestAccounts vs eth_accounts', async () => {
  const { provider, calls } = makeProvider({
    onRequest: ({ method }) => method === 'eth_accounts' ? [] : ['0xABC'],
  });
  const connected = await connect(provider);
  const existing = await getAccounts(provider);
  assert.deepEqual(connected, ['0xABC']);
  assert.deepEqual(existing, []);
  assert.equal(calls[0].method, 'eth_requestAccounts');
  assert.equal(calls[1].method, 'eth_accounts');
});

test('getCurrentChainId: parses hex → number', async () => {
  const { provider } = makeProvider({
    onRequest: ({ method }) => method === 'eth_chainId' ? '0x4115' : null,
  });
  const chainId = await getCurrentChainId(provider);
  assert.equal(chainId, 16661);
});

test('watchAsset: wraps args in the wallet_watchAsset shape', async () => {
  const { provider, calls } = makeProvider({
    onRequest: () => true,
  });
  const accepted = await watchAsset(
    { address: '0xTOK', symbol: 'TOK', decimals: 6, image: 'https://x/logo.png' },
    provider,
  );
  assert.equal(accepted, true);
  assert.equal(calls[0].method, 'wallet_watchAsset');
  assert.equal(calls[0].params.type, 'ERC20');
  assert.deepEqual(calls[0].params.options, {
    address: '0xTOK', symbol: 'TOK', decimals: 6, image: 'https://x/logo.png',
  });
});

test('onWalletEvents: binds + unbinds accountsChanged, chainChanged, disconnect', () => {
  const { provider, listeners } = makeProvider();
  let accounts = null, chain = null, disc = null;
  const off = onWalletEvents({
    onAccountsChanged: (a) => { accounts = a; },
    onChainChanged: (c) => { chain = c; },
    onDisconnect: (d) => { disc = d; },
  }, provider);

  // Fire fake events
  listeners.get('accountsChanged').forEach((h) => h(['0xABC']));
  listeners.get('chainChanged').forEach((h) => h('0x4115'));
  listeners.get('disconnect').forEach((h) => h({ code: 4900, message: 'offline' }));

  assert.deepEqual(accounts, ['0xABC']);
  assert.equal(chain, '0x4115');
  assert.deepEqual(disc, { code: 4900, message: 'offline' });

  off();
  assert.equal(listeners.get('accountsChanged').size, 0);
  assert.equal(listeners.get('chainChanged').size, 0);
  assert.equal(listeners.get('disconnect').size, 0);
});

test('helpers throw when no EIP-1193 provider available', async () => {
  await assert.rejects(() => connect(null), /no EIP-1193 provider/);
});
