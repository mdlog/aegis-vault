// Real TEE attestation engine (off-chain). Verifies that the 0G Compute
// provider's inference enclave is a genuine Intel-TDX enclave by validating its
// DCAP quote against the Automata on-chain verifier, checking the embedded
// signer against the provider's registered teeSignerAddress, checking the
// dstack compose hash, and (Layer B, see attestInference) checking the
// per-chatId response signature. On-chain contracts are untouched: this gates
// trade execution off-chain.
import { ethers } from 'ethers';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const AUTOMATA_ABI = [
  'function verifyAndAttestOnChain(bytes rawQuote) view returns (bool success, bytes output)',
];

// key: `${provider}:${imageDigest}` → { ok:true, attestedSigner, quoteVerified, signerMatch, composeOk, verifiedAt }
const _cache = new Map();
export function _resetCache() { _cache.clear(); }

export function isTeeAttestationRequired(vaultState) {
  return vaultState?._strategy?.execution?.requireTeeAttestation === true;
}

export function extractRawQuote(parsed) {
  // 0G dstack report's `quote` is PLAIN HEX without a 0x prefix (confirmed
  // live: header 0400 0200 81000000 = TDX v4). Prepend 0x; base64 is a fallback.
  const q = parsed.quote || parsed.intel_quote || parsed.tdx_quote || parsed.report;
  if (!q || typeof q !== 'string') throw new Error('no_quote_field');
  if (q.startsWith('0x')) return q;
  if (/^[0-9a-fA-F]+$/.test(q)) return '0x' + q;
  return '0x' + Buffer.from(q, 'base64').toString('hex');
}

function makeAutomata(deps) {
  if (deps.automata) return deps.automata;
  const provider = new ethers.JsonRpcProvider(config.teeAttestation.automataRpc);
  return new ethers.Contract(config.teeAttestation.automataAddress, AUTOMATA_ABI, provider);
}

export async function verifyProviderEnclave(verifier, providerAddress, deps = {}) {
  const now = deps.now || Date.now;
  const automata = makeAutomata(deps);

  let svc, additional;
  try {
    svc = await verifier.getService(providerAddress);
    additional = svc.additionalInfo ? JSON.parse(svc.additionalInfo) : {};
  } catch (e) {
    return { ok: false, reason: 'provider_not_attestable', detail: e.message };
  }
  if (!additional.TEEVerifier) return { ok: false, reason: 'provider_not_attestable' };
  // Separated providers (broker + LLM in distinct enclaves) ARE supported:
  // getQuote() returns the broker-enclave report, whose quote verifies and
  // whose embedded signer is the response signer. (LLM-enclave verification
  // via getQuoteInLLMServer is a documented follow-up.)

  const imageDigest = additional.ImageDigest || 'unknown';
  const cacheKey = `${providerAddress.toLowerCase()}:${imageDigest}`;
  const cached = _cache.get(cacheKey);
  if (cached && now() - cached.verifiedAt < config.teeAttestation.cacheTtlMs) {
    return { ...cached, fromCache: true };
  }

  let parsed;
  try {
    const report = await verifier.getQuote(providerAddress);
    parsed = JSON.parse(report.rawReport);
  } catch (e) {
    return { ok: false, reason: 'provider_not_attestable', detail: e.message };
  }

  let quoteVerified = false;
  try {
    const [success] = await automata.verifyAndAttestOnChain(extractRawQuote(parsed));
    quoteVerified = success === true;
  } catch (e) {
    return { ok: false, reason: 'verifier_unreachable', detail: e.message };
  }
  if (!quoteVerified) return { ok: false, reason: 'quote_invalid' };

  const embedded = verifier.extractTeeSignerAddress(parsed);
  const signerMatch = !!embedded && !!svc.teeSignerAddress
    && embedded.toLowerCase() === svc.teeSignerAddress.toLowerCase();
  if (!signerMatch) return { ok: false, reason: 'signer_mismatch' };

  let composeOk = false;
  try {
    const dstack = await verifier.processDStackVerification({ combined: parsed }, () => {});
    composeOk = dstack.composeVerificationPassed === true;
  } catch (e) {
    return { ok: false, reason: 'compose_mismatch', detail: e.message };
  }
  if (!composeOk) return { ok: false, reason: 'compose_mismatch' };

  const entry = {
    ok: true, attestedSigner: embedded, quoteVerified, signerMatch, composeOk, verifiedAt: now(),
  };
  _cache.set(cacheKey, entry);
  logger.info(`TEE: provider ${providerAddress.slice(0, 10)} enclave verified (signer ${embedded.slice(0, 10)})`);
  return entry;
}

// Layer B — cheap, per cycle: prove THIS response was signed by the attested
// enclave signer (catches cached/forged responses).
export async function verifyResponseSignature(VerifierClass, providerUrl, chatId, model, attestedSigner) {
  if (!chatId) return false;
  const sig = await VerifierClass.fetchSignatureByChatID(providerUrl, chatId, model);
  if (!sig || !sig.signature || !sig.text) return false;
  return VerifierClass.verifySignature(sig.text, sig.signature, attestedSigner) === true;
}

// Combined attestation for one inference: enclave verification (Layer A,
// cached) + this response's signature (Layer B). Returns ok:false with a
// specific reason on any failure — callers fail closed.
export async function attestInference(broker, providerInfo, chatId, deps = {}) {
  const verifier = deps.verifier || broker?.inference?.verifier;
  const VerifierClass = deps.VerifierClass || verifier?.constructor;
  if (!verifier || !VerifierClass) return { ok: false, reason: 'provider_not_attestable' };

  const enclave = await verifyProviderEnclave(verifier, providerInfo.address, deps);
  if (!enclave.ok) return enclave;

  let responseSigned = false;
  try {
    responseSigned = await verifyResponseSignature(
      VerifierClass, providerInfo.endpoint, chatId, providerInfo.model, enclave.attestedSigner,
    );
  } catch (e) {
    return { ok: false, reason: 'response_unsigned', detail: e.message };
  }
  if (!responseSigned) return { ok: false, reason: 'response_unsigned' };

  return {
    ok: true,
    attestedSigner: enclave.attestedSigner,
    quoteVerified: enclave.quoteVerified,
    signerMatch: enclave.signerMatch,
    composeOk: enclave.composeOk,
    responseSigned: true,
    verifiedAt: enclave.verifiedAt,
    verifierContract: config.teeAttestation.automataAddress,
  };
}

// Gate decision for the orchestrator cycle. Ungated when the vault doesn't opt
// in; otherwise proceed only on a passing attestation, else skip the cycle.
export function evaluateTeeGate(vaultState, attestation) {
  if (!isTeeAttestationRequired(vaultState)) return { proceed: true, gated: false };
  if (attestation?.ok === true) return { proceed: true, gated: true, attestation };
  return {
    proceed: false, gated: true,
    status: 'skipped_tee_unattested',
    reason: attestation?.reason || 'provider_not_attestable',
  };
}
