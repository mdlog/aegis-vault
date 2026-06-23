// Spike step 4 — confirm Direct/broker SDK sees the same catalog as Router.
//
// We're staying on Direct mode for sealed-mode attestation. This script
// just verifies broker.inference.listService() returns the same 7 entries
// the Router /v1/models endpoint exposed in script 01. If yes, the only
// thing we need to do is refresh the FE fallback list — live discovery
// already covers everything.
//
// Required env (from orchestrator/.env):
//   PRIVATE_KEY (or OG_COMPUTE_PRIVATE_KEY) — wallet with a funded ledger

import 'dotenv/config';
import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';

const rpc = process.env.OG_COMPUTE_RPC || 'https://evmrpc.0g.ai';
const pk = (process.env.OG_COMPUTE_PRIVATE_KEY || process.env.PRIVATE_KEY || '').replace(/^0x/, '');

if (!pk) {
  console.error('PRIVATE_KEY not set in orchestrator/.env');
  process.exit(1);
}

console.log(`Direct mode RPC: ${rpc}\n`);

const provider = new ethers.JsonRpcProvider(rpc);
const wallet = new ethers.Wallet(pk, provider);
console.log(`Wallet: ${wallet.address}\n`);

const t0 = Date.now();
const broker = await createZGComputeNetworkBroker(wallet);
console.log(`Broker init: ${Date.now() - t0} ms`);

const t1 = Date.now();
const services = await broker.inference.listService();
console.log(`listService(): ${Date.now() - t1} ms, ${services.length} entries\n`);

// Group by service type so chatbots are easy to see at a glance.
const byType = services.reduce((acc, s) => {
  (acc[s.serviceType] ||= []).push(s);
  return acc;
}, {});

for (const [type, list] of Object.entries(byType)) {
  console.log(`── ${type} (${list.length}) ──`);
  for (const s of list) {
    console.log(`  • ${s.model}`);
    console.log(`      provider:    ${s.provider}`);
    console.log(`      endpoint:    ${s.url}`);
    console.log(`      verifiable:  ${s.verifiable}`);
    if (s.inputPrice) console.log(`      input:       ${s.inputPrice}`);
    if (s.outputPrice) console.log(`      output:      ${s.outputPrice}`);
  }
}

// Cross-check: emit a JSON array we can paste straight into
// FALLBACK_OG_COMPUTE_MODELS in OperatorRegisterPage.jsx
const chatbots = (byType.chatbot || []).map((s) => ({
  model: s.model,
  provider: s.provider,
  url: s.url,
}));
console.log('\n── Suggested FE fallback list (chatbots only) ──');
console.log(JSON.stringify(chatbots, null, 2));
