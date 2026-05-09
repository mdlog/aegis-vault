// Orchestrator HTTP client — wraps every /api/* route exposed by
// `orchestrator/src/api.js` so consumers never have to hand-build URLs.
//
// Works in any environment with global `fetch` (Node 18+, all modern browsers,
// Cloudflare Workers, Deno, Bun). Mutating routes accept an API key via the
// `x-api-key` header; read routes don't require auth.

function buildQuery(params) {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      q.set(key, String(value));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export class OrchestratorError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'OrchestratorError';
    this.status = status;
    this.body = body;
  }
}

export class OrchestratorClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl        Orchestrator base URL, e.g. `https://orch.aegis.xyz`
   * @param {string} [opts.apiKey]       API key for mutating routes (sent as `x-api-key`)
   * @param {typeof fetch} [opts.fetch]  Inject a fetch implementation (tests / custom agents)
   * @param {number} [opts.timeoutMs]    Per-request timeout (default 15000)
   */
  constructor({ baseUrl, apiKey, fetch: fetchImpl, timeoutMs = 15000 } = {}) {
    if (!baseUrl) throw new Error('OrchestratorClient: baseUrl is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey || null;
    this.fetch = fetchImpl || globalThis.fetch;
    if (!this.fetch) {
      throw new Error('OrchestratorClient: global fetch not available; pass opts.fetch');
    }
    this.timeoutMs = timeoutMs;
  }

  async #request(path, { method = 'GET', body, auth = false, signal } = {}) {
    const controller = signal ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    const headers = { 'accept': 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth && this.apiKey) headers['x-api-key'] = this.apiKey;

    try {
      const res = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal || controller?.signal,
      });
      const text = await res.text();
      const parsed = text ? safeJson(text) : null;
      if (!res.ok) {
        throw new OrchestratorError(
          `Orchestrator ${method} ${path} failed: HTTP ${res.status}`,
          { status: res.status, body: parsed ?? text },
        );
      }
      return parsed;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ── Health & status ────────────────────────────────────────────────
  health(signal) { return this.#request('/api/health', { signal }); }
  status(signal) { return this.#request('/api/status', { signal }); }
  // `/api/state` is gated by `requireOperatorAuth` on the server: without the
  // API key (and not called from loopback), it returns 401. Send the key.
  state(signal)  { return this.#request('/api/state',  { auth: true, signal }); }

  // ── Manual control (mutations — need apiKey unless localhost dev) ──
  triggerCycle(signal) {
    return this.#request('/api/cycle', { method: 'POST', auth: true, signal });
  }

  // ── Vault & operator reads ────────────────────────────────────────
  vault(vaultAddress, signal) {
    return this.#request(`/api/vault${buildQuery({ vault: vaultAddress })}`, { signal });
  }

  operator(address, signal) {
    return this.#request(`/api/operator${buildQuery({ address })}`, { signal });
  }

  // ── Market + pricing ──────────────────────────────────────────────
  market(signal)        { return this.#request('/api/market', { signal }); }
  marketSummary(signal) { return this.#request('/api/market/summary', { signal }); }
  pythPrices(signal)    { return this.#request('/api/pyth/prices', { signal }); }

  /** Multi-asset NAV breakdown. Pass `vaultAddress` for per-vault NAV. */
  nav(vaultAddress, signal) {
    const q = vaultAddress ? buildQuery({ vault: vaultAddress }) : '';
    return this.#request(`/api/nav${q}`, { signal });
  }

  // ── Journal & decisions ───────────────────────────────────────────
  /**
   * @param {object} [opts]
   * @param {number} [opts.limit=20]
   * @param {string} [opts.vault]
   * @param {string} [opts.type]   e.g. 'decision' | 'execution' | 'alert'
   * @param {string} [opts.level]  e.g. 'info' | 'warning' | 'critical'
   */
  journal(opts = {}, signal) {
    const { limit = 20, vault, type, level } = opts;
    return this.#request(`/api/journal${buildQuery({ limit, vault, type, level })}`, { signal });
  }

  decisions({ limit = 10, vault } = {}, signal) {
    return this.#request(`/api/journal/decisions${buildQuery({ limit, vault })}`, { signal });
  }

  executions({ limit = 10, vault } = {}, signal) {
    return this.#request(`/api/journal/executions${buildQuery({ limit, vault })}`, { signal });
  }

  alerts({ limit = 10, vault, level } = {}, signal) {
    return this.#request(`/api/alerts${buildQuery({ limit, vault, level })}`, { signal });
  }

  // ── 0G infrastructure ─────────────────────────────────────────────
  aiModels(signal)     { return this.#request('/api/og-compute/models', { signal }); }
  ogStatus(signal)     { return this.#request('/api/og/status', { signal }); }
  // `/api/og/state` and `/api/og/kv/:key` are gated by `requireOperatorAuth`
  // on the server. Send the API key so non-loopback callers aren't rejected
  // with 401.
  ogState(signal)      { return this.#request('/api/og/state', { auth: true, signal }); }
  ogKv(key, signal)    { return this.#request(`/api/og/kv/${encodeURIComponent(key)}`, { auth: true, signal }); }
  ogFlush(signal)      { return this.#request('/api/og/flush', { method: 'POST', auth: true, signal }); }

  // ── Polling helper ────────────────────────────────────────────────
  /**
   * Poll any client method at a fixed interval. Returns a `stop()` function.
   * First call fires immediately.
   *
   *   const stop = sdk.orchestrator.poll(c => c.status(), 5000, data => ...);
   *   // later:
   *   stop();
   *
   * **Error handling — read this:** the loop deliberately survives a single
   * bad response (an orchestrator restart, a transient 5xx, an aborted fetch)
   * by routing the rejection to `onError` and continuing on the next tick.
   * If you do **not** pass an `onError`, the rejection is silently dropped —
   * a misconfigured base URL, a wrong API key, or a permanent backend
   * failure will show up as "no data ever arrives" with no stack trace and
   * no console output. **Always pass an `onError` in production code**, even
   * if it just logs. For tests / scripts where you want any failure to be
   * fatal, throw inside `onError` (the throw will surface on the next macro
   * task) or use `client.status()` directly without `poll()`.
   *
   * @param {(client: OrchestratorClient) => Promise<any>} fn
   * @param {number} intervalMs
   * @param {(data: any) => void} onData
   * @param {(err: Error) => void} [onError] — STRONGLY RECOMMENDED. Without
   *        this, polling failures are invisible.
   */
  poll(fn, intervalMs, onData, onError) {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const data = await fn(this);
        if (!cancelled) onData(data);
      } catch (err) {
        if (!cancelled && onError) onError(err);
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
