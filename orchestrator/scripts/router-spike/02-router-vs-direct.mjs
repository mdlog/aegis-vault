// Spike step 2 — head-to-head: same prompt, same model, Router vs Direct.
//
// Measures latency, validates JSON output, and dumps response headers so we
// can hunt for any TEE/attestation metadata Router might expose. Uses the
// real promptBuilder.js + a synthetic but realistic market snapshot so the
// completion is exercising the same code path the orchestrator runs in
// production.
//
// Required env (loaded from orchestrator/.env if present):
//   OG_ROUTER_API_KEY   sk-... key from pc.0g.ai → Dashboard → API Keys
//   PRIVATE_KEY         (or OG_COMPUTE_PRIVATE_KEY) — for Direct mode side
//   OG_COMPUTE_MODEL    optional, default zai-org/GLM-5-FP8
//
// Optional env:
//   OG_ROUTER_NETWORK   mainnet (default) | testnet
//   ROUTER_PROVIDER_PIN 0x... — pin Router to a specific provider for
//                       apples-to-apples comparison with Direct
//
// Usage:
//   node scripts/router-spike/02-router-vs-direct.mjs

import 'dotenv/config';
import { buildSystemPrompt, buildUserPrompt, parseAIResponse } from '../../src/services/promptBuilder.js';
import { initOGCompute, chatCompletion as directChat, isOGComputeAvailable, getOGComputeStatus } from '../../src/services/ogCompute.js';

const ROUTER_ENDPOINTS = {
  mainnet: 'https://router-api.0g.ai/v1',
  testnet: 'https://router-api-testnet.integratenetwork.work/v1',
};

const network = process.env.OG_ROUTER_NETWORK || 'mainnet';
const baseUrl = ROUTER_ENDPOINTS[network];
const apiKey = process.env.OG_ROUTER_API_KEY;
const model = process.env.OG_COMPUTE_MODEL || 'zai-org/GLM-5-FP8';
const providerPin = process.env.ROUTER_PROVIDER_PIN || '';

if (!baseUrl) {
  console.error(`Unknown network "${network}".`);
  process.exit(1);
}

// Synthetic but plausible market snapshot. Fields match what
// orchestrator/services/marketData.js produces — buildUserPrompt stays happy.
const fakeMarket = {
  timestamp: Date.now(),
  prices: {
    BTC: { price: 67500, change24h: 1.4, volume24h: 32_000_000_000 },
    ETH: { price: 3450, change24h: 2.1, volume24h: 18_000_000_000 },
  },
  volatility: { BTC: '38%', ETH: '52%' },
};
const fakeIndicators = {
  ema_20: 67200, ema_50: 66100, ema_200: 61800,
  rsi_14: 58.4, macd_histogram: 42.1, atr_14_pct: 1.8,
  realized_vol_1h_pct: 0.42, volume_zscore: 0.7, price_vs_vwap_pct: 0.35,
  mtf_alignment: 'bullish',
};
const fakeRegime = 'TREND_UP_WEAK';
const fakeVault = {
  nav: 10000, baseAsset: 'USDC', mandate: 'Balanced',
  maxPositionPct: 50, maxDrawdownPct: 15, confidenceThreshold: 60,
  dailyActionsUsed: 0, maxActionsPerDay: 20,
  current_position_side: 'flat',
  allocation: [{ symbol: 'USDC', pct: 100, value: 10000 }],
};

const systemPrompt = buildSystemPrompt();
const userPrompt = buildUserPrompt(fakeMarket, fakeVault, fakeIndicators, fakeRegime);
const messages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: userPrompt },
];

console.log(`Spike: same prompt, model=${model}\n`);
console.log(`Prompt size: system=${systemPrompt.length} chars, user=${userPrompt.length} chars\n`);

// ── Side A: Router via OpenAI-compatible HTTP ────────────────────────────
async function runRouter() {
  if (!apiKey) {
    console.log('── Router ──  SKIPPED (OG_ROUTER_API_KEY not set)');
    console.log('   Create a key at pc.0g.ai → Dashboard → API Keys, deposit a few 0G,');
    console.log('   then re-run with OG_ROUTER_API_KEY=sk-...\n');
    return null;
  }
  console.log('── Router ──');
  console.log(`   POST ${baseUrl}/chat/completions`);

  const body = {
    model,
    messages,
    temperature: 0.3,
    max_tokens: 1024,
  };
  if (providerPin) {
    body.provider = { address: providerPin, allow_fallbacks: false };
    console.log(`   pinned provider: ${providerPin}`);
  }

  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    console.log(`   threw: ${err.message}\n`);
    return null;
  }
  const latency = Date.now() - t0;
  console.log(`   HTTP ${res.status} in ${latency} ms`);

  // Dump every response header so we can spot TEE/attestation fields
  // (ZG-Res-Key, x-tee-*, x-provider-*, etc.) — the whole point of this spike.
  console.log('   response headers:');
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  for (const [k, v] of Object.entries(headers)) {
    console.log(`     ${k}: ${v}`);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.log(`   error body: ${txt.substring(0, 400)}\n`);
    return { ok: false, latency, headers };
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  console.log(`   tokens used:  prompt=${data?.usage?.prompt_tokens ?? '?'} completion=${data?.usage?.completion_tokens ?? '?'}`);
  console.log(`   model echoed: ${data?.model ?? '?'}`);
  console.log(`   provider:     ${data?.provider ?? data?.x_provider ?? '?'}`);
  console.log(`   id:           ${data?.id ?? '?'}`);

  const parsed = parseAIResponse(content || '');
  if (parsed) {
    console.log(`   parsed JSON:  action=${parsed.action} asset=${parsed.asset} conf=${parsed.confidence} risk=${parsed.risk_score}`);
  } else {
    console.log(`   parse FAILED. Raw content (first 300):`);
    console.log(`     ${(content || '').substring(0, 300)}`);
  }

  // Sanity-check pricing — Router quotes per-token, multiply by usage.
  if (data?.usage && data?.cost) {
    console.log(`   cost:         ${data.cost} (Router self-reports)`);
  }

  console.log();
  return { ok: true, latency, parsed, data, headers };
}

// ── Side B: Direct mode via @0glabs/0g-serving-broker ────────────────────
async function runDirect() {
  console.log('── Direct (broker SDK) ──');
  const ok = await initOGCompute();
  if (!ok) {
    console.log('   SKIPPED (initOGCompute returned false — check PRIVATE_KEY + ledger balance)\n');
    return null;
  }
  const status = getOGComputeStatus();
  console.log(`   provider:  ${status.provider}`);
  console.log(`   model:     ${status.model}`);
  console.log(`   endpoint:  ${status.endpoint}`);

  const t0 = Date.now();
  const result = await directChat(messages, { temperature: 0.3, max_tokens: 1024 });
  const latency = Date.now() - t0;
  console.log(`   latency:   ${latency} ms`);

  if (!result) {
    console.log('   chatCompletion returned null — see orchestrator log above\n');
    return { ok: false, latency };
  }

  console.log(`   chatId:    ${result.chatId ?? '?'}`);
  console.log(`   model:     ${result.model}`);
  console.log(`   provider:  ${result.provider}`);

  const parsed = parseAIResponse(result.content || '');
  if (parsed) {
    console.log(`   parsed JSON:  action=${parsed.action} asset=${parsed.asset} conf=${parsed.confidence} risk=${parsed.risk_score}`);
  } else {
    console.log(`   parse FAILED. Raw content (first 300):`);
    console.log(`     ${(result.content || '').substring(0, 300)}`);
  }

  console.log();
  return { ok: true, latency, parsed, result };
}

const router = await runRouter();
const direct = await runDirect();

// ── Compare ──────────────────────────────────────────────────────────────
console.log('── Summary ──');
const routerLat = router?.ok ? `${router.latency} ms` : 'n/a';
const directLat = direct?.ok ? `${direct.latency} ms` : 'n/a';
console.log(`   latency:   router=${routerLat}   direct=${directLat}`);

if (router?.parsed && direct?.parsed) {
  const same = router.parsed.action === direct.parsed.action
    && router.parsed.asset === direct.parsed.asset;
  console.log(`   agreement: ${same ? 'YES' : 'NO'}  (router=${router.parsed.action} ${router.parsed.asset} vs direct=${direct.parsed.action} ${direct.parsed.asset})`);
}

// TEE / attestation probe — the gating question for migration.
console.log('\n── TEE / attestation surface on Router ──');
if (router?.headers) {
  const teeRelated = Object.entries(router.headers).filter(([k]) =>
    /tee|attest|zg-|provider|signature|sgx|tdx/i.test(k),
  );
  if (teeRelated.length) {
    console.log('   candidate headers found:');
    teeRelated.forEach(([k, v]) => console.log(`     ${k}: ${v}`));
  } else {
    console.log('   no obvious TEE/attestation headers in Router response.');
    console.log('   Direct mode delivers ZG-Res-Key + processResponse(). If Router does not,');
    console.log('   our V3 sealed-mode attestation chain CANNOT migrate to Router as-is.');
  }
} else {
  console.log('   skipped (Router call did not run or failed)');
}
