// Spike step 3 — read account balance + recent usage from the Router.
// Cheap sanity check that the API key is alive and a starting point for
// estimating monthly spend if we migrate.
//
// Required env:
//   OG_ROUTER_API_KEY   sk-... key from pc.0g.ai

const ENDPOINTS = {
  mainnet: 'https://router-api.0g.ai/v1',
  testnet: 'https://router-api-testnet.integratenetwork.work/v1',
};

const network = process.env.OG_ROUTER_NETWORK || 'mainnet';
const baseUrl = ENDPOINTS[network];
const apiKey = process.env.OG_ROUTER_API_KEY;

if (!apiKey) {
  console.error('OG_ROUTER_API_KEY not set. Create one at pc.0g.ai → Dashboard → API Keys.');
  process.exit(1);
}

console.log(`Router base: ${baseUrl}\n`);

async function get(path) {
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  const latency = Date.now() - t0;
  console.log(`GET ${path} → HTTP ${res.status} in ${latency} ms`);
  const body = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : await res.text();
  console.log(JSON.stringify(body, null, 2));
  console.log();
  return body;
}

await get('/account/balance');

// Last 7 days. Router accepts ISO date strings per docs.
const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
await get(`/account/usage/stats?start_date=${start}`);
