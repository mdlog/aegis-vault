/**
 * Khalani / HyperStream client (Node-side mirror of the frontend SDK).
 *
 * Khalani / HyperStream is a multi-chain intent settlement protocol that lets a
 * user express "give X on chain A to receive Y on chain B" as a single intent;
 * solvers compete to fill it and the protocol guarantees atomic settlement.
 * The orchestrator uses this module purely as a *quoting* surface — when the
 * AI proposes a swap on 0G we compare a Jaine direct quote against a Khalani
 * cross-chain quote, take the better of the two, and route accordingly. This
 * file does not sign, build, or broadcast anything that requires a key; it is
 * a pure HTTP client around `https://api.hyperstream.dev`.
 *
 * Docs: https://khalani.gitbook.io/khalani-docs
 *
 * Canonical end-to-end flow (per docs.gitbook llms-full.txt + live curl probe
 * on 2026-04-26 — both sources agree):
 *   1. POST /v1/quotes                                    -> { quoteId, routes:[{ routeId, ... }] }
 *   2. POST /v1/deposit/build  body { from, quoteId, routeId } -> { kind, approvals:[…] }
 *   3. Wallet broadcasts deposit tx; capture txHash
 *   4. PUT  /v1/deposit/submit body { txHash, quoteId, routeId } -> { orderId }
 *   5. GET  /v1/orders/{address}?orderIds={orderId}       -> { data:[ Order ] }
 *
 * Deviations from common assumptions (live-API-checked):
 *   - Tokens endpoint takes `chainIds` (plural list-style), not `chainId`.
 *     Sending `chainId` returns the unfiltered global token list, so we
 *     defensively filter client-side too.
 *   - 0G token symbols come back as `USDCe` and `wETH` (mixed case). Callers
 *     should compare symbols case-insensitively.
 *   - `quoteId` and `orderId` are different identifiers. quoteId is short-lived
 *     and routes through build/submit; orderId is what you track for status.
 */

import logger from '../utils/logger.js';

const KHALANI_API_BASE = process.env.KHALANI_API_BASE || 'https://api.hyperstream.dev';
const DEFAULT_TIMEOUT_MS = 15_000;
const CHAINS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let chainsCache = null; // { expiresAt: number, data: Array }

/**
 * Combine a caller-supplied AbortSignal with our internal timeout signal.
 * If `caller` is provided we listen for its `abort` event and propagate.
 * Returns `{ signal, cleanup }` — call `cleanup()` after the fetch resolves
 * to release the listener and timer (avoids leaks in long-lived processes).
 */
function makeRequestSignal(callerSignal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`khalani: request timed out after ${timeoutMs}ms`)), timeoutMs);

  let onCallerAbort;
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      onCallerAbort = () => controller.abort(callerSignal.reason);
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timer);
    if (callerSignal && onCallerAbort) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  };

  return { signal: controller.signal, cleanup };
}

/**
 * Throw a normalised Error for a non-2xx response. Includes HTTP status and
 * — if the body parses as JSON — the API error code/message so callers can
 * log a single line that explains the failure without an extra round trip.
 */
async function throwForResponse(res, endpoint) {
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch (_) {
    /* fall through with empty body */
  }
  let apiCode = '';
  let apiMessage = '';
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      apiCode = parsed.name || parsed.code || '';
      apiMessage = parsed.message || '';
      if (Array.isArray(parsed.details) && parsed.details.length > 0) {
        const first = parsed.details[0];
        if (first?.field || first?.message) {
          apiMessage = `${apiMessage || ''} [${first.field || ''}: ${first.message || ''}]`.trim();
        }
      }
    } catch (_) {
      /* not JSON — leave fields blank */
    }
  }
  const summary = apiCode || apiMessage
    ? `${apiCode || 'HttpError'}: ${apiMessage || bodyText.slice(0, 200)}`
    : bodyText.slice(0, 200) || res.statusText;
  throw new Error(`khalani ${endpoint} failed: HTTP ${res.status} — ${summary}`);
}

async function khalaniRequest(method, path, { query, body, signal } = {}) {
  const url = new URL(path, KHALANI_API_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const { signal: combinedSignal, cleanup } = makeRequestSignal(signal);
  try {
    const init = {
      method,
      signal: combinedSignal,
      headers: { accept: 'application/json' },
    };
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    if (!res.ok) await throwForResponse(res, `${method} ${path}`);
    // 204 No Content guard
    if (res.status === 204) return null;
    return await res.json();
  } finally {
    cleanup();
  }
}

/**
 * GET /v1/chains — cached for 5 minutes.
 * Returns the raw chain array as exposed by the Khalani API.
 */
export async function fetchSupportedChains(signal) {
  const now = Date.now();
  if (chainsCache && chainsCache.expiresAt > now) {
    return chainsCache.data;
  }
  const data = await khalaniRequest('GET', '/v1/chains', { signal });
  if (!Array.isArray(data)) {
    throw new Error('khalani /v1/chains: expected array, got ' + typeof data);
  }
  chainsCache = { expiresAt: now + CHAINS_CACHE_TTL_MS, data };
  logger.debug(`khalani: cached ${data.length} chains for ${CHAINS_CACHE_TTL_MS / 1000}s`);
  return data;
}

/**
 * GET /v1/tokens?chainIds=<id> — list of tokens supported on `chainId`.
 *
 * We pass `chainIds` (plural) because that's the parameter the live API honours
 * (see deviation note at top of file). We additionally filter client-side so a
 * future spec drift can't silently leak in tokens from other chains.
 */
export async function fetchSupportedTokens(chainId, signal) {
  if (!Number.isInteger(chainId)) {
    throw new Error(`khalani.fetchSupportedTokens: chainId must be an integer, got ${chainId}`);
  }
  const data = await khalaniRequest('GET', '/v1/tokens', {
    query: { chainIds: chainId },
    signal,
  });
  if (!Array.isArray(data)) {
    throw new Error('khalani /v1/tokens: expected array, got ' + typeof data);
  }
  return data.filter((t) => t && t.chainId === chainId);
}

/**
 * POST /v1/quotes — request a quote for a (potentially cross-chain) swap.
 *
 * The request body mirrors the frontend SDK. `tradeType` defaults to
 * `EXACT_INPUT`. Optional fields (`refundTo`, `referrer`, `referrerFeeBps`)
 * are forwarded only when provided.
 *
 * Quotes are NEVER cached — prices move and the API returns a freshly-priced
 * quote each call.
 */
export async function fetchQuote(params, signal) {
  const {
    fromAddress,
    fromChainId,
    fromToken,
    toChainId,
    toToken,
    amount,
    tradeType = 'EXACT_INPUT',
    refundTo,
    referrer,
    referrerFeeBps,
  } = params || {};

  // Surface missing-required-field errors locally rather than burning a round
  // trip on a request the API will only reject.
  const missing = [];
  if (!fromAddress) missing.push('fromAddress');
  if (!Number.isInteger(fromChainId)) missing.push('fromChainId');
  if (!fromToken) missing.push('fromToken');
  if (!Number.isInteger(toChainId)) missing.push('toChainId');
  if (!toToken) missing.push('toToken');
  if (amount === undefined || amount === null || amount === '') missing.push('amount');
  if (missing.length > 0) {
    throw new Error(`khalani.fetchQuote: missing required fields: ${missing.join(', ')}`);
  }

  const body = {
    fromAddress,
    fromChainId,
    fromToken,
    toChainId,
    toToken,
    amount: String(amount),
    tradeType,
  };
  if (refundTo !== undefined) body.refundTo = refundTo;
  if (referrer !== undefined) body.referrer = referrer;
  if (referrerFeeBps !== undefined) body.referrerFeeBps = referrerFeeBps;

  return khalaniRequest('POST', '/v1/quotes', { body, signal });
}

/**
 * POST /v1/deposit/build — build the wallet action plan (chain switch +
 * approvals + the deposit tx) for a chosen route from a quote.
 *
 * Two call shapes:
 *   1. buildDeposit({ from, quoteId, routeId })           — explicit
 *   2. buildDeposit(quoteResponse, { from, routeId? })    — convenience
 */
export async function buildDeposit(arg1, arg2, signal) {
  let from;
  let quoteId;
  let routeId;
  let useSignal = signal;

  if (arg1 && typeof arg1 === 'object' && 'quoteId' in arg1 && !Array.isArray(arg1.routes)) {
    ({ from, quoteId, routeId } = arg1);
    if (arg2 && !useSignal && typeof arg2?.aborted === 'boolean') useSignal = arg2;
  } else if (arg1 && typeof arg1 === 'object' && Array.isArray(arg1.routes)) {
    quoteId = arg1.quoteId;
    const helper = (arg2 && typeof arg2 === 'object' && !('aborted' in arg2)) ? arg2 : {};
    from = helper.from;
    routeId = helper.routeId || arg1.routes?.[0]?.routeId;
  } else {
    throw new Error("khalani.buildDeposit: pass { from, quoteId, routeId } or (quoteResponse, { from, routeId? })");
  }

  if (!from) throw new Error("khalani.buildDeposit: 'from' is required");
  if (!quoteId) throw new Error("khalani.buildDeposit: 'quoteId' is required");
  if (!routeId) throw new Error("khalani.buildDeposit: 'routeId' is required");

  return khalaniRequest('POST', '/v1/deposit/build', {
    body: { from, quoteId, routeId },
    signal: useSignal,
  });
}

/**
 * PUT /v1/deposit/submit — register the wallet-broadcast deposit txHash and
 * receive an `orderId` for downstream tracking.
 */
export async function submitDeposit({ txHash, quoteId, routeId }, signal) {
  if (!txHash) throw new Error("khalani.submitDeposit: 'txHash' is required");
  if (!quoteId) throw new Error("khalani.submitDeposit: 'quoteId' is required");
  if (!routeId) throw new Error("khalani.submitDeposit: 'routeId' is required");

  return khalaniRequest('PUT', '/v1/deposit/submit', {
    body: { txHash, quoteId, routeId },
    signal,
  });
}

/**
 * GET /v1/orders/{address}?orderIds={orderId} — current order status for
 * an address-scoped order. Use the same `from` address that signed/built
 * the deposit. Returns `{ data: [Order, ...] }`.
 *
 * Terminal statuses: 'filled' | 'refunded' | 'failed'.
 * Non-terminal:      'created' | 'deposited' | 'published' | 'refund_pending'.
 */
export async function getOrderStatus(address, orderId, signal) {
  if (!address || typeof address !== 'string') {
    throw new Error("khalani.getOrderStatus: 'address' must be a non-empty string");
  }
  if (!orderId || typeof orderId !== 'string') {
    throw new Error("khalani.getOrderStatus: 'orderId' must be a non-empty string");
  }
  return khalaniRequest('GET', `/v1/orders/${encodeURIComponent(address)}`, {
    query: { orderIds: orderId },
    signal,
  });
}

/**
 * @deprecated Use getOrderStatus(address, orderId) instead — HyperStream
 * order status is address-scoped.
 */
export async function getDepositStatus(_intentId, _signal) {
  throw new Error(
    'khalani.getDepositStatus(intentId) is deprecated; use getOrderStatus(address, orderId).',
  );
}

// Exposed for tests so they can reset between runs without poking at internals.
export function _resetCachesForTest() {
  chainsCache = null;
}

export { KHALANI_API_BASE };
