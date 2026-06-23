// orchestrator/scripts/probe-tee-attestation.js
//
// REAL feasibility probe (Step 0 of the real-TEE plan). Answers: does the
// configured 0G Compute provider expose a genuine Intel-TDX attestation that
// validates against the Automata DCAP verifier?
//
// READ-ONLY & ZERO-SPEND: it only lists services, reads on-chain service
// metadata, HTTP-GETs the provider's attestation report, and does a read-only
// (view) eth_call to the Automata DCAP verifier. It never funds a ledger,
// never runs inference, and never sends a transaction.
//
// Run:  node scripts/probe-tee-attestation.js
import config from '../src/config/index.js'; // loads orchestrator/.env via dotenv
import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';

const AUTOMATA_ABI = [
  'function verifyAndAttestOnChain(bytes rawQuote) view returns (bool success, bytes output)',
];
// 1rpc.io/ata (the SDK default) is rate-limited; rpc.ata.network is the
// official Automata mainnet RPC and has the verifier deployed.
const AUTOMATA_RPC = process.env.AUTOMATA_RPC || 'https://rpc.ata.network';
const AUTOMATA_ADDR = process.env.AUTOMATA_CONTRACT_ADDRESS || '0xE26E11B257856B0bEBc4C759aaBDdea72B64351F';

function line(k, v) { console.log(`  ${k.padEnd(22)} ${v}`); }

function extractRawQuote(parsed) {
  const q = parsed.quote || parsed.intel_quote || parsed.tdx_quote || parsed.report || parsed.attestation;
  if (!q || typeof q !== 'string') return null;
  // 0G dstack reports carry the raw TDX quote as PLAIN HEX without a 0x prefix
  // (confirmed live: header "0400 0200 81000000" = v4, ECDSA-256, TDX).
  if (q.startsWith('0x')) return q;
  if (/^[0-9a-fA-F]+$/.test(q)) return '0x' + q;
  return '0x' + Buffer.from(q, 'base64').toString('hex'); // base64 fallback
}

async function main() {
  const pk = (config.ogCompute.privateKey || '').replace(/^0x/, '');
  if (!pk || pk === '_SET_YOUR_PRIVATE_KEY_HERE') { console.error('PROBE: no 0G Compute key configured'); process.exit(2); }

  const provider = new ethers.JsonRpcProvider(config.ogCompute.rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  console.log('\n=== 0G Compute TEE attestation probe (read-only) ===');
  line('wallet', wallet.address);
  line('0g rpc', config.ogCompute.rpcUrl);
  line('automata rpc', AUTOMATA_RPC);

  const broker = await createZGComputeNetworkBroker(wallet);
  const services = await broker.inference.listService();
  const chatbots = services.filter((s) => s.serviceType === 'chatbot');
  console.log(`\n  discovered ${services.length} services, ${chatbots.length} chatbots:`);
  chatbots.forEach((s) => console.log(`    - ${s.model}  @ ${s.provider}  verifiable=${s.verifiable}`));

  const preferred = config.ogCompute.preferredModel;
  const selected = preferred ? (chatbots.find((s) => s.model.includes(preferred)) || chatbots[0]) : chatbots[0];
  if (!selected) { console.error('\nPROBE: no chatbot service available'); process.exit(1); }
  console.log('');
  line('selected provider', selected.provider);
  line('selected model', selected.model);

  const verifier = broker.inference.verifier;
  const svc = await verifier.getService(selected.provider);
  let additional = {};
  try { additional = svc.additionalInfo ? JSON.parse(svc.additionalInfo) : {}; } catch { /* non-JSON */ }
  console.log('\n  --- service metadata (on-chain) ---');
  line('TEEVerifier', additional.TEEVerifier || '(none)');
  line('TargetSeparated', additional.TargetSeparated === true);
  line('ImageName', additional.ImageName || '(none)');
  line('ImageDigest', additional.ImageDigest || '(none)');
  line('teeSignerAddress', svc.teeSignerAddress || '(none)');

  if (!additional.TEEVerifier) {
    console.log('\nRESULT: ❌ provider is NOT TEE-attestable (no TEEVerifier in additionalInfo).');
    process.exit(1);
  }

  // Download the attestation report (read-only HTTP GET to the provider).
  let report, parsed;
  try {
    report = await verifier.getQuote(selected.provider);
    parsed = typeof report.rawReport === 'string' ? JSON.parse(report.rawReport) : (report.rawReport || report);
  } catch (e) {
    console.log(`\nRESULT: ❌ getQuote failed — ${e.message}`);
    process.exit(1);
  }
  console.log('\n  --- attestation report ---');
  line('report keys', Object.keys(parsed).join(', '));

  let embedded = null;
  try { embedded = verifier.extractTeeSignerAddress(parsed); } catch { /* shape mismatch */ }
  const signerMatch = !!embedded && !!svc.teeSignerAddress
    && embedded.toLowerCase() === svc.teeSignerAddress.toLowerCase();
  line('embedded signer', embedded || '(none found)');
  line('signer match', signerMatch);

  const rawQuote = extractRawQuote(parsed);
  if (!rawQuote) {
    console.log('\nRESULT: ⚠️  could not locate raw quote bytes in report. Field name differs —');
    console.log('        update extractRawQuote() to use one of the keys printed above.');
    process.exit(1);
  }
  line('raw quote len', `${(rawQuote.length - 2) / 2} bytes`);

  const automata = new ethers.Contract(AUTOMATA_ADDR, AUTOMATA_ABI, new ethers.JsonRpcProvider(AUTOMATA_RPC));
  try {
    const [ok] = await automata.verifyAndAttestOnChain(rawQuote);
    console.log('\n  --- Automata DCAP verification ---');
    line('quoteVerified', ok);
    if (ok && signerMatch) {
      console.log('\nRESULT: ✅ PASS — provider runs a verifiable Intel-TDX enclave (quote chains to Intel root, signer bound).');
      process.exit(0);
    }
    console.log('\nRESULT: ❌ FAIL — quote and/or signer did not fully verify.');
    process.exit(1);
  } catch (e) {
    console.log(`\nRESULT: ⚠️  Automata verify call errored — ${e.message}`);
    process.exit(3);
  }
}

main().catch((e) => { console.error(`\nPROBE error: ${e.message}`); process.exit(3); });
