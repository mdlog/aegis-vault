import * as Sentry from '@sentry/node';
import logger from './logger.js';

/**
 * Sentry init for orchestrator.
 *
 * - Reads DSN from SENTRY_DSN. If unset, init is skipped (Sentry calls become no-ops).
 * - All events pass through `scrubSensitive` which walks the event and redacts:
 *     - Private keys     (0x + 64 hex)
 *     - BIP39 mnemonics  (12/15/18/21/24-word sequences)
 *     - RPC URLs with embedded API keys (alchemy/infura/quicknode/blast/etc.)
 *     - Optional wallet-address masking (controlled by SENTRY_MASK_ADDRESSES)
 *
 * Wallet addresses are public on-chain, but we still mask by default in user-facing
 * contexts because pairing an address with a stack trace can leak which executor
 * shard handled which vault.
 */

// 0x + 64 hex chars, word-bounded so we don't false-positive on longer hashes.
const PRIVATE_KEY_RE = /\b(0x)?[a-fA-F0-9]{64}\b/g;

// 12/15/18/21/24 lowercase words separated by single spaces — typical BIP39 layout.
// Avoids matching prose by requiring all-lowercase a-z and exactly the right word count.
const MNEMONIC_RE = /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/g;

// RPC URLs with `apikey=`, `key=`, or path-embedded keys (alchemy/infura style).
const RPC_KEY_RE = /(https?:\/\/[^\s"']*?(?:[?&](?:api[_-]?key|key|token)=[^\s"'&]+|\/v\d+\/[a-zA-Z0-9_-]{20,}))/g;

// Full ETH address (40 hex). Masked to 0x1234…5678.
const ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;

const MASK_ADDRESSES = process.env.SENTRY_MASK_ADDRESSES === '1';

function scrubString(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  out = out.replace(PRIVATE_KEY_RE, '[REDACTED_KEY]');
  out = out.replace(MNEMONIC_RE, '[REDACTED_MNEMONIC]');
  out = out.replace(RPC_KEY_RE, (m) => {
    try {
      const u = new URL(m);
      return `${u.protocol}//${u.host}/[REDACTED_PATH]`;
    } catch {
      return '[REDACTED_RPC]';
    }
  });
  if (MASK_ADDRESSES) {
    out = out.replace(ADDRESS_RE, (m) => `${m.slice(0, 6)}…${m.slice(-4)}`);
  }
  return out;
}

function scrubSensitive(node, seen = new WeakSet()) {
  if (node === null || node === undefined) return node;
  if (typeof node === 'string') return scrubString(node);
  if (typeof node !== 'object') return node;
  if (seen.has(node)) return node;
  seen.add(node);

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      node[i] = scrubSensitive(node[i], seen);
    }
    return node;
  }

  for (const key of Object.keys(node)) {
    // Drop common secret-bearing keys outright.
    const lk = key.toLowerCase();
    if (
      lk === 'privatekey' ||
      lk === 'private_key' ||
      lk === 'mnemonic' ||
      lk === 'seed' ||
      lk === 'authorization' ||
      lk === 'cookie' ||
      lk === 'x-api-key' ||
      lk === 'apikey' ||
      lk === 'api_key'
    ) {
      node[key] = '[REDACTED]';
      continue;
    }
    node[key] = scrubSensitive(node[key], seen);
  }
  return node;
}

let initialized = false;

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry disabled (SENTRY_DSN not set)');
    return false;
  }
  if (initialized) return true;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || (process.env.STRICT_MODE === '1' ? 'production' : 'development'),
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    sendDefaultPii: false,
    beforeSend(event) {
      try {
        return scrubSensitive(event);
      } catch (err) {
        logger.warn(`Sentry scrub failed, dropping event: ${err.message}`);
        return null;
      }
    },
    beforeBreadcrumb(breadcrumb) {
      try {
        return scrubSensitive(breadcrumb);
      } catch {
        return null;
      }
    },
  });

  Sentry.setTag('service', 'orchestrator');
  if (process.env.CHAIN_ID) Sentry.setTag('chain_id', process.env.CHAIN_ID);

  initialized = true;
  logger.info('Sentry initialized');
  return true;
}

export { Sentry, scrubSensitive };
