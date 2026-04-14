import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';
import { withRetry } from '../utils/retry.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * 0G Compute Network Integration
 * Uses @0glabs/0g-serving-broker SDK for decentralized AI inference.
 *
 * Connects to 0G MAINNET for Compute (more models available),
 * even if vault contracts are on testnet.
 *
 * Available mainnet models:
 *   - zai-org/GLM-5-FP8 (chatbot, best for reasoning)
 *   - deepseek/deepseek-chat-v3-0324 (chatbot)
 *   - openai/gpt-oss-120b (chatbot)
 *   - qwen/qwen3-vl-30b-a3b-instruct (chatbot + vision)
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

    // Discover chatbot services
    const services = await broker.inference.listService();
    const chatbots = services.filter(s => s.serviceType === 'chatbot');

    if (chatbots.length === 0) {
      logger.warn('0G Compute: No chatbot service available');
      return false;
    }

    logger.info(`0G Compute: Found ${chatbots.length} chatbot services:`);
    chatbots.forEach(s => logger.info(`  - ${s.model} @ ${s.url}`));

    // Pick preferred model or first available
    const preferred = config.ogCompute.preferredModel;
    const selected = preferred
      ? chatbots.find(s => s.model.includes(preferred)) || chatbots[0]
      : chatbots[0];

    providerInfo = {
      address: selected.provider,
      endpoint: selected.url,
      model: selected.model,
    };

    logger.info(`0G Compute: Selected → ${providerInfo.model}`);
    logger.info(`0G Compute: Provider → ${providerInfo.address}`);
    logger.info(`0G Compute: Endpoint → ${providerInfo.endpoint}`);

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

    // Verify response
    const chatId = response.headers.get('ZG-Res-Key') || data.id;
    if (chatId) {
      try {
        const isValid = await broker.inference.processResponse(providerInfo.address, chatId);
        logger.info(`0G Compute: Verification: ${isValid ? 'VALID' : 'UNVERIFIED'}`);
      } catch (e) {
        logger.debug(`0G Compute: Verification skipped: ${e.message?.substring(0, 80)}`);
      }
    }

    return {
      content,
      reasoning,
      chatId,
      provider: providerInfo.address,
      model: providerInfo.model,
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
    network: 'mainnet',
  };
}

/**
 * List all available chatbot services on 0G Compute (for operator registration UI).
 *
 * Each entry is { model, provider, url, serviceType, verified } as returned by
 * `broker.inference.listService()`. Frontend uses this to populate the AI model
 * dropdown in `/operator/register` so operators commit to a specific model.
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
      .map((s) => ({
        model: s.model,
        provider: s.provider,
        url: s.url,
        serviceType: s.serviceType,
        verified: s.verifiable !== false,
      }));
  } catch (err) {
    logger.error(`0G Compute: listAvailableModels failed: ${err.message}`);
    return [];
  }
}
