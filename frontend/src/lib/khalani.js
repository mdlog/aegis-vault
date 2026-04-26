/**
 * Khalani / HyperStream REST API client (browser-safe).
 *
 * Khalani is a multi-chain intent settlement protocol. HyperStream is its
 * hosted Publishing Service: a public REST API that lets a UI request
 * cross-chain swap quotes, build a deposit plan (chain switch + ERC20
 * approvals + the deposit tx), submit the resulting deposit txHash, and
 * track the resulting order until terminal state.
 *
 * Docs:        https://khalani.gitbook.io/khalani-docs
 * API base:    https://api.hyperstream.dev   (no API key, rate-limited)
 *
 * End-to-end happy path (per docs.gitbook /llms-full.txt + live curl probe):
 *   1. POST /v1/quotes                                    -> { quoteId, routes:[{ routeId, ... }] }
 *   2. POST /v1/deposit/build                             -> { kind, approvals:[...] }
 *   3. Wallet executes approvals[] in order; capture txHash from deposit:true
 *   4. PUT  /v1/deposit/submit                            -> { orderId }
 *   5. GET  /v1/orders/{address}?orderIds={orderId}       -> { data:[ Order ] }
 *
 * This module is plain ES module JavaScript — no React, no contracts, no
 * extra deps. It uses global fetch + AbortController.
 */

const DEFAULT_BASE_URL = 'https://api.hyperstream.dev';
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * @typedef {Object} KhalaniOptions
 * @property {string} [baseUrl] - Override the API base URL.
 * @property {number} [timeoutMs] - Override per-request timeout (default 15000).
 * @property {AbortSignal} [signal] - Caller-provided abort signal (combined with timeout).
 */

/**
 * Internal: perform one HTTP request and return parsed JSON.
 * Throws an Error with the server's error message on non-2xx.
 *
 * @param {string} path - Path beginning with '/'.
 * @param {RequestInit} init - fetch init.
 * @param {KhalaniOptions} [opts]
 */
async function request(path, init, opts = {}) {
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${baseUrl}${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Khalani request timed out')), timeoutMs);

  // Combine caller signal with our timeout signal.
  if (opts.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timer);
      throw opts.signal.reason || new Error('Aborted');
    }
    opts.signal.addEventListener('abort', () => controller.abort(opts.signal.reason), { once: true });
  }

  let res;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const serverMsg =
      (body && typeof body === 'object' && (body.message || body.error || body.name)) ||
      (typeof body === 'string' ? body : '') ||
      `HTTP ${res.status}`;
    const err = new Error(`Khalani ${init?.method || 'GET'} ${path} failed: ${serverMsg}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

/**
 * GET /v1/chains — list every chain HyperStream currently supports.
 *
 * @param {KhalaniOptions} [opts]
 * @returns {Promise<Array<{
 *   id:number,
 *   name:string,
 *   type?:string,
 *   testnet?:boolean,
 *   nativeCurrency?:{name:string, symbol:string, decimals:number},
 *   rpcUrls?:Object,
 *   blockExplorers?:Object,
 *   contracts?:Object,
 * }>>}
 */
export async function fetchSupportedChains(opts) {
  return request('/v1/chains', { method: 'GET' }, opts);
}

/**
 * GET /v1/tokens?chainIds=<n> — list supported tokens on a chain.
 * The live API accepts a numeric `chainIds` param and returns a flat array.
 *
 * @param {number|string} chainId - e.g. 16661 for 0G Mainnet.
 * @param {KhalaniOptions} [opts]
 * @returns {Promise<Array<{
 *   address:string,
 *   chainId:number,
 *   symbol:string,
 *   name:string,
 *   decimals:number,
 *   logoURI?:string,
 *   extensions?:{ price?:{ usd?:string } },
 * }>>}
 */
export async function fetchSupportedTokens(chainId, opts) {
  if (chainId === undefined || chainId === null || chainId === '') {
    throw new Error('fetchSupportedTokens: chainId is required');
  }
  const qs = new URLSearchParams({ chainIds: String(chainId) }).toString();
  return request(`/v1/tokens?${qs}`, { method: 'GET' }, opts);
}

/**
 * POST /v1/quotes — request a cross-chain swap quote.
 *
 * @param {Object} args
 * @param {string} args.fromAddress - Wallet that will execute the deposit.
 * @param {number} args.fromChainId
 * @param {string} args.fromToken - ERC20 address (lowercase ok); native sentinel for chain native.
 * @param {number} args.toChainId
 * @param {string} args.toToken
 * @param {string} args.amount - Integer string in smallest units (e.g. "1000000" = 1 USDC@6dp).
 * @param {'EXACT_INPUT'|'EXACT_OUTPUT'} [args.tradeType='EXACT_INPUT']
 * @param {string} [args.refundTo] - Optional refund recipient.
 * @param {string} [args.referrer] - Optional referrer address.
 * @param {number} [args.referrerFeeBps] - Optional referrer fee in bps.
 * @param {string} [args.filler] - Optional preferred filler/route hint.
 * @param {KhalaniOptions} [opts]
 * @returns {Promise<{
 *   quoteId:string,
 *   routes: Array<{
 *     routeId:string,
 *     type:string,
 *     exactOutMethod?:string,
 *     depositMethods?:string[],
 *     quote:{ amountIn:string, amountOut:string, expectedDurationSeconds:number, validBefore:number, quoteExpiresAt?:number, tags?:string[] },
 *   }>,
 * }>}
 */
export async function fetchQuote(
  {
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
    filler,
  },
  opts,
) {
  const required = { fromAddress, fromChainId, fromToken, toChainId, toToken, amount };
  for (const [k, v] of Object.entries(required)) {
    if (v === undefined || v === null || v === '') {
      throw new Error(`fetchQuote: '${k}' is required`);
    }
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
  if (filler !== undefined) body.filler = filler;

  return request(
    '/v1/quotes',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    opts,
  );
}

/**
 * POST /v1/deposit/build — get a wallet action plan for a chosen quote/route.
 *
 * Two call shapes are supported:
 *   1. buildDeposit({ from, quoteId, routeId })           // raw, matches API
 *   2. buildDeposit(quoteResponse, { from, routeId? })    // convenience: pass the quote
 *      and we'll pull quoteId + first routeId for you.
 *
 * @param {Object} arg1 - Either { from, quoteId, routeId } or a quote response object.
 * @param {{ from?:string, routeId?:string }|KhalaniOptions} [arg2]
 * @param {KhalaniOptions} [opts]
 * @returns {Promise<{
 *   kind:string,
 *   approvals: Array<{
 *     type:string,
 *     request: { method:string, params?:any[] },
 *     deposit?:boolean,
 *     waitForReceipt?:boolean,
 *   }>,
 * }>}
 */
export async function buildDeposit(arg1, arg2, opts) {
  let from;
  let quoteId;
  let routeId;
  let useOpts = opts;

  if (arg1 && typeof arg1 === 'object' && 'quoteId' in arg1 && !Array.isArray(arg1.routes)) {
    // Shape 1: explicit { from, quoteId, routeId }
    ({ from, quoteId, routeId } = arg1);
    if (arg2 && !useOpts) useOpts = arg2;
  } else if (arg1 && typeof arg1 === 'object' && Array.isArray(arg1.routes)) {
    // Shape 2: full quote response + helper
    quoteId = arg1.quoteId;
    const helper = (arg2 && typeof arg2 === 'object') ? arg2 : {};
    from = helper.from;
    routeId = helper.routeId || arg1.routes?.[0]?.routeId;
    useOpts = opts;
  } else {
    throw new Error('buildDeposit: pass { from, quoteId, routeId } or (quoteResponse, { from, routeId? })');
  }

  if (!from) throw new Error("buildDeposit: 'from' (wallet address) is required");
  if (!quoteId) throw new Error("buildDeposit: 'quoteId' is required");
  if (!routeId) throw new Error("buildDeposit: 'routeId' is required");

  return request(
    '/v1/deposit/build',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, quoteId, routeId }),
    },
    useOpts,
  );
}

/**
 * PUT /v1/deposit/submit — register the wallet-broadcast deposit txHash and
 * receive an orderId you can track.
 *
 * @param {Object} args
 * @param {string} args.txHash
 * @param {string} args.quoteId
 * @param {string} args.routeId
 * @param {KhalaniOptions} [opts]
 * @returns {Promise<{ orderId:string, txHash:string }>}
 */
export async function submitDeposit({ txHash, quoteId, routeId }, opts) {
  if (!txHash) throw new Error("submitDeposit: 'txHash' is required");
  if (!quoteId) throw new Error("submitDeposit: 'quoteId' is required");
  if (!routeId) throw new Error("submitDeposit: 'routeId' is required");

  return request(
    '/v1/deposit/submit',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash, quoteId, routeId }),
    },
    opts,
  );
}

/**
 * GET /v1/orders/{address}?orderIds={orderId} — fetch order status for an
 * address-scoped order. This is the canonical tracking endpoint per the
 * docs end-to-end flow ("track until terminal status"). The wallet address
 * is the same `from` used in `buildDeposit`.
 *
 * Terminal statuses: 'filled' | 'refunded' | 'failed'.
 * Non-terminal:      'created' | 'deposited' | 'published' | 'refund_pending'.
 *
 * @param {string} address - The wallet address that built+submitted the deposit.
 * @param {string} orderId - The order id returned by submitDeposit.
 * @param {KhalaniOptions} [opts]
 * @returns {Promise<{ data: Array<Order> }>}
 */
export async function getOrderStatus(address, orderId, opts) {
  if (!address) throw new Error("getOrderStatus: 'address' is required");
  if (!orderId) throw new Error("getOrderStatus: 'orderId' is required");
  const qs = new URLSearchParams({ orderIds: orderId }).toString();
  return request(
    `/v1/orders/${encodeURIComponent(address)}?${qs}`,
    { method: 'GET' },
    opts,
  );
}

/**
 * Back-compat alias — the original task spec used `getDepositStatus(intentId)`.
 * The current canonical signature is `getOrderStatus(address, orderId)`.
 * This wrapper exists so legacy callers don't break, but it can't actually
 * fetch the order without an address — they should migrate to getOrderStatus.
 *
 * @deprecated Use getOrderStatus(address, orderId) instead.
 */
export async function getDepositStatus(_intentId) {
  throw new Error(
    'getDepositStatus(intentId) is deprecated; use getOrderStatus(address, orderId) — ' +
      'HyperStream order status requires the depositor address.',
  );
}

export const KHALANI_BASE_URL = DEFAULT_BASE_URL;
