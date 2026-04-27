// Pure-unit smoke tests — no network, no ethers runtime calls. Validates
// that the SDK loads cleanly, config resolves, and the orchestrator client
// composes requests correctly against a stubbed fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AegisSDK,
  OrchestratorClient,
  OrchestratorError,
  CHAINS,
  ADDRESSES,
  ASSET_DECIMALS,
  getAddresses,
  resolveRpcUrl,
} from '../src/index.js';

test('config: mainnet address book exposes V3 vault stack as live', () => {
  const a = getAddresses(CHAINS.OG_MAINNET);
  assert.match(a.vaultFactory, /^0x[a-fA-F0-9]{40}$/);
  assert.match(a.vaultImplementation, /^0x[a-fA-F0-9]{40}$/);
  assert.match(a.executionRegistry, /^0x[a-fA-F0-9]{40}$/);
  assert.match(a.khalaniVenueAdapter, /^0x[a-fA-F0-9]{40}$/);
  assert.match(a.jaineVenueAdapter, /^0x[a-fA-F0-9]{40}$/);
  assert.match(a.operatorRegistry, /^0x[a-fA-F0-9]{40}$/);
  assert.match(a.operatorStaking, /^0x[a-fA-F0-9]{40}$/);
  assert.match(a.tokens.USDCe, /^0x[a-fA-F0-9]{40}$/);
  assert.equal(ASSET_DECIMALS.USDCe, 6);
  assert.equal(ASSET_DECIMALS.WETH, 18);
  // V2 vault stack must remain reachable for historical reads.
  assert.match(a.legacy.vaultFactoryV2, /^0x[a-fA-F0-9]{40}$/);
  assert.match(a.legacy.executionRegistryV2, /^0x[a-fA-F0-9]{40}$/);
});

test('config: unknown chain throws', () => {
  assert.throws(() => getAddresses(999999), /No Aegis deployment/);
});

test('config: resolveRpcUrl prefers override, falls back to default', () => {
  assert.equal(resolveRpcUrl(CHAINS.OG_MAINNET), 'https://evmrpc.0g.ai');
  assert.equal(resolveRpcUrl(CHAINS.OG_MAINNET, 'https://x'), 'https://x');
});

test('AegisSDK: constructs without orchestrator', () => {
  const sdk = new AegisSDK({ chainId: CHAINS.OG_MAINNET });
  assert.equal(sdk.chainId, 16661);
  assert.equal(sdk.orchestrator, null);
  assert.equal(sdk.addresses, ADDRESSES[16661]);
});

test('OrchestratorClient: builds URLs, applies API key on mutations', async () => {
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, echoedPath: new URL(url).pathname + new URL(url).search }),
    };
  };

  const orch = new OrchestratorClient({
    baseUrl: 'https://orch.test',
    apiKey: 'k-123',
    fetch: mockFetch,
  });

  await orch.status();
  await orch.nav('0xabc');
  await orch.journal({ limit: 5, vault: '0xabc', level: 'warning' });
  await orch.triggerCycle();

  assert.equal(calls[0].url, 'https://orch.test/api/status');
  assert.equal(calls[1].url, 'https://orch.test/api/nav?vault=0xabc');
  assert.equal(
    calls[2].url,
    'https://orch.test/api/journal?limit=5&vault=0xabc&level=warning',
  );
  assert.equal(calls[3].url, 'https://orch.test/api/cycle');
  assert.equal(calls[3].init.method, 'POST');
  assert.equal(calls[3].init.headers['x-api-key'], 'k-123');
  assert.equal(calls[0].init.headers['x-api-key'], undefined,
    'GET requests must not send the API key');
});

test('OrchestratorClient: non-2xx surfaces OrchestratorError with status + body', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 503,
    text: async () => JSON.stringify({ error: 'overloaded' }),
  });
  const orch = new OrchestratorClient({ baseUrl: 'https://x', fetch: mockFetch });
  await assert.rejects(
    () => orch.status(),
    (err) => {
      assert.ok(err instanceof OrchestratorError);
      assert.equal(err.status, 503);
      assert.deepEqual(err.body, { error: 'overloaded' });
      return true;
    },
  );
});

test('OrchestratorClient: poll() fires immediately and is cancellable', async () => {
  let ticks = 0;
  const mockFetch = async () => ({ ok: true, status: 200, text: async () => '{}' });
  const orch = new OrchestratorClient({ baseUrl: 'https://x', fetch: mockFetch });
  const stop = orch.poll((c) => c.status(), 10, () => { ticks++; });
  // wait for at least the immediate call + one interval
  await new Promise((r) => setTimeout(r, 30));
  stop();
  const snapshot = ticks;
  // After stopping, no more ticks should happen
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(snapshot >= 2, `expected >=2 ticks, got ${snapshot}`);
  assert.equal(ticks, snapshot, 'stop() must halt further polling');
});
