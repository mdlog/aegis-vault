import * as Sentry from '@sentry/react';

/**
 * Sentry init for the React frontend.
 *
 * - DSN comes from VITE_SENTRY_DSN. If unset, init is skipped (Sentry calls become no-ops).
 * - All events pass through `scrubSensitive` which redacts:
 *     - Private keys     (0x + 64 hex)
 *     - BIP39 mnemonics  (12/15/18/21/24-word sequences)
 *     - RPC URLs with embedded API keys
 *     - Optional wallet-address masking (controlled by VITE_SENTRY_MASK_ADDRESSES)
 *
 * Wallet addresses are public on-chain; masking is opt-in.
 */

const PRIVATE_KEY_RE = /\b(0x)?[a-fA-F0-9]{64}\b/g;
const MNEMONIC_RE = /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/g;
const RPC_KEY_RE = /(https?:\/\/[^\s"']*?(?:[?&](?:api[_-]?key|key|token)=[^\s"'&]+|\/v\d+\/[a-zA-Z0-9_-]{20,}))/g;
const ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;

const MASK_ADDRESSES = import.meta.env.VITE_SENTRY_MASK_ADDRESSES === '1';

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
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    return false;
  }
  if (initialized) return true;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    tracesSampleRate: parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    sendDefaultPii: false,
    beforeSend(event) {
      try {
        return scrubSensitive(event);
      } catch {
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

  Sentry.setTag('service', 'frontend');

  // Expose for DevTools-console testing in non-production builds.
  if (import.meta.env.MODE !== 'production') {
    if (typeof window !== 'undefined') window.__Sentry = Sentry;
  }

  initialized = true;
  return true;
}

export { Sentry };
