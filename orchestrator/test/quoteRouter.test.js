/**
 * quoteRouter unit tests — five outcomes covered with injected dependencies.
 *
 * chooseRoute accepts a `_deps` test seam that swaps in stubs for the venue
 * quoter and the Khalani client. ESM live bindings are read-only so we can't
 * monkey-patch the imports directly; the seam is the cleanest alternative
 * and keeps the production code path untouched in non-test runs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseRoute } from '../src/services/quoteRouter.js';

const TOKEN_IN = '0x0000000000000000000000000000000000000A11';
const TOKEN_OUT = '0x0000000000000000000000000000000000000B22';
const VENUE = '0x0000000000000000000000000000000000000C33';
const EXECUTOR = '0x0000000000000000000000000000000000000D44';

function makeDeps({ jaine, khalani }) {
  return {
    quoteVenueAmountOut: async () => {
      if (jaine === 'throw') throw new Error('jaine rpc down');
      return jaine; // bigint or null
    },
    khalaniFetchQuote: async () => {
      if (khalani === 'throw') throw new Error('khalani 5xx');
      return khalani; // full response object or null
    },
  };
}

test('chooseRoute: both succeed, Jaine wins (Khalani edge below threshold)', async () => {
  const result = await chooseRoute({
    venue: VENUE, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
    amountIn: 100n, executorAddress: EXECUTOR,
    _deps: makeDeps({
      jaine: 1000n,
      khalani: { quoteId: 'q-1', routes: [{ routeId: 'r-1', type: 'cross', quote: { amountOut: '1000' } }] },
    }),
  });
  assert.equal(result.route, 'jaine');
  assert.equal(result.amountOut, 1000n);
  assert.equal(result.jaineQuote, 1000n);
  assert.equal(result.khalaniQuote, 1000n);
  assert.equal(result.diffBps, 0);
  assert.match(result.rationale, /jaine wins/);
});

test('chooseRoute: both succeed, Khalani wins by >= preference threshold', async () => {
  // Jaine 1000 vs Khalani 1020 -> +200 bps, beats default 10 bps.
  const result = await chooseRoute({
    venue: VENUE, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
    amountIn: 100n, executorAddress: EXECUTOR,
    _deps: makeDeps({
      jaine: 1000n,
      khalani: { quoteId: 'q-2', routes: [{ routeId: 'r-2', type: 'cross', quote: { amountOut: '1020' } }] },
    }),
  });
  assert.equal(result.route, 'khalani');
  assert.equal(result.amountOut, 1020n);
  assert.equal(result.quoteId, 'q-2');
  assert.equal(result.routeId, 'r-2');
  assert.equal(result.diffBps, 200);
  assert.equal(result.jaineQuote, 1000n);
  assert.equal(result.khalaniQuote, 1020n);
  assert.match(result.rationale, /khalani beats jaine/);
});

test('chooseRoute: only Jaine succeeds (Khalani throws)', async () => {
  const result = await chooseRoute({
    venue: VENUE, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
    amountIn: 100n, executorAddress: EXECUTOR,
    _deps: makeDeps({ jaine: 1234n, khalani: 'throw' }),
  });
  assert.equal(result.route, 'jaine');
  assert.equal(result.amountOut, 1234n);
  assert.equal(result.jaineQuote, 1234n);
  assert.equal(result.rationale, 'khalani failed');
});

test('chooseRoute: only Khalani succeeds (Jaine returns null)', async () => {
  const result = await chooseRoute({
    venue: VENUE, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
    amountIn: 100n, executorAddress: EXECUTOR,
    _deps: makeDeps({
      jaine: null,
      khalani: { quoteId: 'q-3', routes: [{ routeId: 'r-3', type: 'direct', quote: { amountOut: '5555' } }] },
    }),
  });
  assert.equal(result.route, 'khalani');
  assert.equal(result.amountOut, 5555n);
  assert.equal(result.quoteId, 'q-3');
  assert.equal(result.routeId, 'r-3');
  assert.equal(result.khalaniQuote, 5555n);
  assert.equal(result.rationale, 'jaine failed');
});

test('chooseRoute: both fail returns zero amountOut for oracle fallback', async () => {
  const result = await chooseRoute({
    venue: VENUE, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
    amountIn: 100n, executorAddress: EXECUTOR,
    _deps: makeDeps({ jaine: null, khalani: 'throw' }),
  });
  assert.equal(result.route, 'jaine');
  assert.equal(result.amountOut, 0n);
  assert.equal(result.rationale, 'both quotes failed');
});

test('chooseRoute: preferenceBps override forces Khalani-wins boundary', async () => {
  // Jaine 1000, Khalani 1001 (+10 bps). preferenceBps=10 -> tie breaks toward
  // Khalani (>= comparison). preferenceBps=11 -> Jaine retains.
  const baseDeps = makeDeps({
    jaine: 1000n,
    khalani: { quoteId: 'q-4', routes: [{ routeId: 'r-4', type: 'cross', quote: { amountOut: '1001' } }] },
  });
  const tight = await chooseRoute({
    venue: VENUE, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
    amountIn: 100n, executorAddress: EXECUTOR,
    preferenceBps: 10, _deps: baseDeps,
  });
  assert.equal(tight.route, 'khalani');
  assert.equal(tight.diffBps, 10);

  const strict = await chooseRoute({
    venue: VENUE, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
    amountIn: 100n, executorAddress: EXECUTOR,
    preferenceBps: 11, _deps: baseDeps,
  });
  assert.equal(strict.route, 'jaine');
  assert.equal(strict.diffBps, 10);
});

test('chooseRoute: malformed Khalani amountOut treated as failure', async () => {
  const result = await chooseRoute({
    venue: VENUE, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
    amountIn: 100n, executorAddress: EXECUTOR,
    _deps: makeDeps({
      jaine: 999n,
      khalani: { quoteId: 'q-5', routes: [{ routeId: 'r-5', type: 'cross', quote: { amountOut: 'not-a-number' } }] },
    }),
  });
  assert.equal(result.route, 'jaine');
  assert.equal(result.amountOut, 999n);
  assert.equal(result.rationale, 'khalani failed');
});
