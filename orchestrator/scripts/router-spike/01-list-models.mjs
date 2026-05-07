// Spike step 1 — discover the live model catalog via the Router.
//
// No authentication required. Hits GET /v1/models and GET /v1/providers?model_id=...
// to see what we'd actually have access to if we migrated, and whether the
// 7 TEE-verified models in pc.0g.ai (incl. GLM-5.1-FP8) are exposed here too.
//
// Usage:
//   node scripts/router-spike/01-list-models.mjs            # mainnet (default)
//   OG_ROUTER_NETWORK=testnet node scripts/router-spike/01-list-models.mjs

const ENDPOINTS = {
  mainnet: 'https://router-api.0g.ai/v1',
  testnet: 'https://router-api-testnet.integratenetwork.work/v1',
};

const network = process.env.OG_ROUTER_NETWORK || 'mainnet';
const baseUrl = ENDPOINTS[network];
if (!baseUrl) {
  console.error(`Unknown network "${network}". Use mainnet or testnet.`);
  process.exit(1);
}

console.log(`Router base URL: ${baseUrl}\n`);

const t0 = Date.now();
const modelsRes = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(30_000) });
const modelsLatency = Date.now() - t0;

if (!modelsRes.ok) {
  console.error(`GET /v1/models failed: HTTP ${modelsRes.status}`);
  console.error(await modelsRes.text());
  process.exit(1);
}

const modelsBody = await modelsRes.json();
const models = modelsBody.data || modelsBody.models || modelsBody;
console.log(`GET /v1/models → ${modelsLatency} ms, ${Array.isArray(models) ? models.length : '?'} entries\n`);

if (!Array.isArray(models)) {
  console.log('Unexpected catalog shape — raw body:');
  console.log(JSON.stringify(modelsBody, null, 2));
  process.exit(0);
}

// Pretty-print every model with the fields we care about for the migration
// decision. Field names are best-effort — Router /v1/models follows OpenAI
// shape but extra 0G fields (pricing, provider_count, capabilities) sit
// alongside it. Anything unknown gets dumped as-is.
for (const m of models) {
  const id = m.id || m.model || '???';
  console.log(`• ${id}`);
  if (m.owned_by) console.log(`    owner:        ${m.owned_by}`);
  if (m.context_length) console.log(`    context:      ${m.context_length.toLocaleString()} tokens`);
  if (m.prompt_price !== undefined) {
    console.log(`    prompt:       ${m.prompt_price} neuron/tok`);
  }
  if (m.completion_price !== undefined) {
    console.log(`    completion:   ${m.completion_price} neuron/tok`);
  }
  if (m.provider_count !== undefined) {
    console.log(`    providers:    ${m.provider_count}`);
  }
  if (Array.isArray(m.capabilities) && m.capabilities.length) {
    console.log(`    capabilities: ${m.capabilities.join(', ')}`);
  }
  if (m.tee_verified !== undefined) {
    console.log(`    TEE:          ${m.tee_verified}`);
  }
  // Dump anything we didn't recognise so the next iteration can teach the
  // script — Router is still evolving.
  const known = new Set([
    'id', 'model', 'owned_by', 'context_length', 'prompt_price',
    'completion_price', 'provider_count', 'capabilities', 'tee_verified',
    'object', 'created',
  ]);
  const extras = Object.fromEntries(
    Object.entries(m).filter(([k]) => !known.has(k)),
  );
  if (Object.keys(extras).length) {
    console.log(`    extras:       ${JSON.stringify(extras)}`);
  }
}

// Probe the providers endpoint for our default model so we can compare
// against the on-chain provider commitment in operator registration.
const probeModel = process.env.OG_COMPUTE_MODEL || 'zai-org/GLM-5-FP8';
console.log(`\nGET /v1/providers?model_id=${probeModel}`);
try {
  const tp = Date.now();
  const provRes = await fetch(`${baseUrl}/providers?model_id=${encodeURIComponent(probeModel)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  console.log(`  HTTP ${provRes.status} in ${Date.now() - tp} ms`);
  if (provRes.ok) {
    const body = await provRes.json();
    console.log('  body:');
    console.log(JSON.stringify(body, null, 2));
  } else {
    console.log(`  body: ${(await provRes.text()).substring(0, 400)}`);
  }
} catch (err) {
  console.log(`  request threw: ${err.message}`);
}
