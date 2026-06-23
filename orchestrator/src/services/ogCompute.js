import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';
import { withRetry } from '../utils/retry.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * 0G Compute Network Integration
 * Uses @0glabs/0g-serving-broker SDK for decentralized AI inference (Direct
 * mode — wallet-signed requests, per-provider ledger sub-accounts). Direct
 * preserves the per-call attestation chain (provider + chatId via
 * processResponse) that V3 sealed-mode commits on-chain.
 *
 * Connects to 0G MAINNET for Compute (more models available),
 * even if vault contracts are on testnet.
 *
 * Live chatbot roster (last refreshed 2026-05-08 via broker.listService).
 * All entries return verifiability='TeeML' on-chain with TDX hardware +
 * dstack verifier (github.com/Dstack-TEE/dstack), and `teeSignerAcknowledged
 * === true` from the InferenceServing contract:
 *   - zai-org/GLM-5.1-FP8                (~1.7 s, 131K ctx)
 *   - zai-org/GLM-5-FP8                  (slower thinking, 202K ctx)
 *   - deepseek/deepseek-chat-v3-0324     (131K ctx)
 *   - qwen/qwen3-vl-30b-a3b-instruct     (vision-capable, 262K ctx)
 *   - qwen3.6-plus                       (1M ctx)
 *   - openai/gpt-5.4-mini                (still listed via broker; absent
 *                                         from Router /v1/models)
 *
 * Operator picks one at register time; the choice is committed on-chain via
 * setStrategy() and verified per cycle. Speech (whisper) and image (z-image)
 * services are exposed by listService but excluded from the operator dropdown
 * because the inference pipeline is chatbot-only.
 */

let broker = null;
let providerInfo = null;
let initialized = false;

/**
 * Initialize the 0G Compute broker and discover a chatbot service.
 */
export async function initOGCompute() {
  if (initialized) return true;

  try {
    const computeRpc = config.ogCompute.rpcUrl;
    const pk = (config.ogCompute.privateKey || config.privateKey || '').replace(/^0x/, '');
    if (!pk || pk === '_SET_YOUR_PRIVATE_KEY_HERE') {
      logger.warn('0G Compute: No PRIVATE_KEY configured, skipping init');
      return false;
    }

    const provider = new ethers.JsonRpcProvider(computeRpc);
    const wallet = new ethers.Wallet(pk, provider);

    const balance = await provider.getBalance(wallet.address);
    logger.info(`0G Compute: Wallet ${wallet.address}, balance: ${ethers.formatEther(balance)} 0G`);

    if (balance < ethers.parseEther('0.5')) {
      logger.warn('0G Compute: Insufficient balance for compute operations');
      return false;
    }

    logger.info(`0G Compute: Connecting to ${computeRpc}...`);
    broker = await createZGComputeNetworkBroker(wallet);

    // Ensure ledger account exists
    try {
      await broker.ledger.getLedger();
      logger.info('0G Compute: Ledger account found');
    } catch {
      logger.info('0G Compute: Creating ledger (deposit 3 0G)...');
      await broker.ledger.addLedger(3);
      logger.info('0G Compute: Ledger created');
    }

    // Discover chatbot services. Drop providers whose TEE signer hasn't been
    // acknowledged on-chain (recommendation A): teeSignerAcknowledged is set
    // by the 0G governance contract once the provider's TEE quote has been
    // verified, so a `false` here means the provider is downgraded or
    // mid-rotation and shouldn't be trusted for sealed-mode inference.
    const services = await broker.inference.listService();
    const chatbots = services.filter(s => s.serviceType === 'chatbot');
    const teeChatbots = chatbots.filter(s => s.teeSignerAcknowledged !== false);
    const dropped = chatbots.length - teeChatbots.length;
    if (dropped > 0) {
      logger.warn(`0G Compute: Filtered out ${dropped} chatbot(s) with unacknowledged TEE signer`);
    }

    if (teeChatbots.length === 0) {
      logger.warn('0G Compute: No TEE-acknowledged chatbot service available');
      return false;
    }

    logger.info(`0G Compute: Found ${teeChatbots.length} TEE-acknowledged chatbot services:`);
    teeChatbots.forEach(s => logger.info(`  - ${s.model} (${s.verifiability || 'unknown-tee'}) @ ${s.url}`));

    // Pick preferred model or first available
    const preferred = config.ogCompute.preferredModel;
    const selected = preferred
      ? teeChatbots.find(s => s.model.includes(preferred)) || teeChatbots[0]
      : teeChatbots[0];

    providerInfo = {
      address: selected.provider,
      endpoint: selected.url,
      model: selected.model,
      verifiability: selected.verifiability || null,
      teeSignerAddress: selected.teeSignerAddress || null,
      teeMetadata: parseTeeMetadata(selected.additionalInfo),
    };

    logger.info(`0G Compute: Selected → ${providerInfo.model}`);
    logger.info(`0G Compute: Provider → ${providerInfo.address}`);
    logger.info(`0G Compute: Endpoint → ${providerInfo.endpoint}`);
    logger.info(`0G Compute: Verifiability → ${providerInfo.verifiability ?? 'unknown'} via ${providerInfo.teeMetadata?.TEEVerifier ?? 'unknown verifier'}`);

    // Fund provider sub-account
    try {
      await broker.ledger.transferFund(providerInfo.address, 'inference', BigInt(1) * BigInt(10 ** 18));
      logger.info('0G Compute: Provider funded (1 0G)');
    } catch (e) {
      logger.debug(`0G Compute: Fund transfer: ${e.message?.substring(0, 100)}`);
    }

    initialized = true;
    return true;

  } catch (err) {
    logger.error(`0G Compute: Init failed: ${err.message}`);
    return false;
  }
}

/**
 * Send a chat completion request via 0G Compute Network.
 */
export async function chatCompletion(messages, options = {}) {
  if (!initialized || !broker || !providerInfo) {
    const ok = await initOGCompute();
    if (!ok) return null;
  }

  const { temperature = 0.3, max_tokens = 1024 } = options;

  try {
    // Get authenticated headers
    const headers = await broker.inference.getRequestHeaders(providerInfo.address);

    const endpoint = `${providerInfo.endpoint}/v1/proxy/chat/completions`;

    logger.info(`0G Compute: Sending inference to ${providerInfo.model}...`);

    const response = await withRetry(async () => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          model: providerInfo.model,
          messages,
          temperature,
          max_tokens,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      // Retry on 5xx server errors
      if (res.status >= 500 && res.status < 600) {
        throw new Error(`0G Compute server error: ${res.status}`);
      }
      return res;
    }, {
      maxRetries: 2,
      baseDelayMs: 3000,
      label: '0G Compute inference',
      shouldRetry: (err) => err.message?.includes('server error') || err.message?.includes('ETIMEDOUT'),
    });

    if (response.status === 429) {
      logger.warn('0G Compute: Rate limited (429). Will retry next cycle.');
      return null;
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      logger.error(`0G Compute: HTTP ${response.status}: ${errBody.substring(0, 200)}`);
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const reasoning = data?.choices?.[0]?.message?.reasoning_content;

    if (reasoning) {
      logger.debug(`0G Compute: Reasoning: ${reasoning.substring(0, 200)}...`);
    }

    if (!content) {
      logger.warn('0G Compute: Empty response content');
      return null;
    }

    logger.info(`0G Compute: Response received (${content.length} chars, model: ${providerInfo.model})`);

    // Recommendation B — TEE verification gating.
    // When STRICT_TEE_MODE is enabled, an explicit `false` from processResponse
    // (i.e. the broker fetched the TEE attestation and rejected it) drops the
    // entire response. Errors thrown by processResponse don't gate because
    // they often indicate transient verifier-backend hiccups rather than a
    // bad attestation; sealed-mode commit-reveal still binds the response
    // hash on-chain regardless.
    let teeVerified = null; // null = unknown, true = valid, false = rejected
    const chatId = response.headers.get('ZG-Res-Key') || data.id;
    if (chatId) {
      try {
        const isValid = await broker.inference.processResponse(providerInfo.address, chatId);
        teeVerified = isValid === true;
        logger.info(`0G Compute: Verification: ${teeVerified ? 'VALID' : 'UNVERIFIED'}`);
      } catch (e) {
        logger.debug(`0G Compute: Verification skipped: ${e.message?.substring(0, 80)}`);
      }
    }

    if (config.ogCompute.strictTeeMode && teeVerified === false) {
      logger.error(`0G Compute: STRICT_TEE_MODE rejected response — provider ${providerInfo.address} returned UNVERIFIED for ${chatId}`);
      return null;
    }

    return {
      content,
      reasoning,
      chatId,
      provider: providerInfo.address,
      model: providerInfo.model,
      verifiability: providerInfo.verifiability,
      teeVerified,
    };

  } catch (err) {
    logger.error(`0G Compute: Inference failed: ${err.message}`);
    return null;
  }
}

/**
 * Check if 0G Compute is available and initialized.
 */
export function isOGComputeAvailable() {
  return initialized && broker !== null && providerInfo !== null;
}

/**
 * Get current 0G Compute status.
 */
export function getOGComputeStatus() {
  return {
    available: initialized,
    provider: providerInfo?.address || null,
    model: providerInfo?.model || null,
    endpoint: providerInfo?.endpoint || null,
    verifiability: providerInfo?.verifiability || null,
    teeVerifier: providerInfo?.teeMetadata?.TEEVerifier || null,
    teeSignerAddress: providerInfo?.teeSignerAddress || null,
    strictTeeMode: !!config.ogCompute.strictTeeMode,
    network: 'mainnet',
  };
}

/** Expose the initialized broker so the TEE attestation engine can reach broker.inference.verifier. */
export function getBroker() { return broker; }

/** Expose the selected provider service for attestation: { address, endpoint, model }. */
export function getProviderService() {
  if (!providerInfo) return null;
  return { address: providerInfo.address, endpoint: providerInfo.endpoint, model: providerInfo.model };
}

/**
 * List available chatbot services on 0G Compute, filtered to TEE-acknowledged
 * providers, with TEE metadata surfaced for the operator registration UI.
 *
 * Recommendation A — only providers whose `teeSignerAcknowledged === true` are
 * exposed. The on-chain governance contract sets this flag once the provider's
 * TEE quote has been verified, so anything else is a downgrade or
 * mid-rotation provider that shouldn't be picked for sealed-mode vaults.
 *
 * Each returned entry shape (consumed by /operator/register dropdown):
 *   {
 *     model:           "zai-org/GLM-5-FP8",
 *     provider:        "0x…",
 *     url:             "https://…",
 *     serviceType:     "chatbot",
 *     verifiability:   "TeeML" | "TeeTLS",
 *     teeAcknowledged: true,
 *     teeSignerAddress:"0x…",
 *     teeVerifier:     "dstack",
 *     teeImageDigest:  "" | "sha256:…",
 *     providerIdentity:"openrouter" | …,
 *   }
 */
export async function listAvailableModels() {
  if (!initialized || !broker) {
    const ok = await initOGCompute();
    if (!ok) return [];
  }

  try {
    const services = await broker.inference.listService();
    return services
      .filter((s) => s.serviceType === 'chatbot')
      .filter((s) => s.teeSignerAcknowledged !== false)
      .map((s) => {
        const meta = parseTeeMetadata(s.additionalInfo);
        return {
          model: s.model,
          provider: s.provider,
          url: s.url,
          serviceType: s.serviceType,
          verifiability: s.verifiability || null,
          teeAcknowledged: s.teeSignerAcknowledged === true,
          teeSignerAddress: s.teeSignerAddress || null,
          teeVerifier: meta?.TEEVerifier || null,
          teeImageDigest: meta?.ImageDigest || null,
          providerIdentity: meta?.ProviderIdentity || null,
        };
      });
  } catch (err) {
    logger.error(`0G Compute: listAvailableModels failed: ${err.message}`);
    return [];
  }
}

/**
 * Parse the JSON-encoded `additionalInfo` field from a 0G Compute service
 * struct. The contract stores it as an opaque string so providers can ship
 * arbitrary metadata; we extract the fields the registration UI cares about.
 * Returns null on parse failure so callers can fall back gracefully.
 */
function parseTeeMetadata(additionalInfo) {
  if (!additionalInfo || typeof additionalInfo !== 'string') return null;
  try {
    return JSON.parse(additionalInfo);
  } catch {
    return null;
  }
}
