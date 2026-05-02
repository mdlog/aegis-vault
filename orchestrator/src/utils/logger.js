import winston from 'winston';
import { mkdirSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import config from '../config/index.js';

// Mirrors the Sentry scrubber so anything that lands in console / file logs
// has the same redactions applied. Keeps secret-bearing keys (privateKey,
// mnemonic, …) out of stack traces and forensic dumps even when a careless
// caller does `logger.error('boom', { config })`.
const PRIVATE_KEY_RE = /\b(0x)?[a-fA-F0-9]{64}\b/g;
const RPC_KEY_RE = /(https?:\/\/[^\s"']*?(?:[?&](?:api[_-]?key|key|token)=[^\s"'&]+|\/v\d+\/[a-zA-Z0-9_-]{20,}))/g;
const SECRET_KEYS = new Set([
  'privatekey', 'private_key', 'mnemonic', 'seed',
  'authorization', 'cookie', 'x-api-key', 'apikey', 'api_key',
  'tee_signer_private_key', 'og_compute_private_key',
]);

function scrubString(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  out = out.replace(PRIVATE_KEY_RE, '[REDACTED_KEY]');
  out = out.replace(RPC_KEY_RE, (m) => {
    try { const u = new URL(m); return `${u.protocol}//${u.host}/[REDACTED_PATH]`; } catch { return '[REDACTED_RPC]'; }
  });
  return out;
}

function scrubNode(node, seen = new WeakSet()) {
  if (node === null || node === undefined) return node;
  if (typeof node === 'string') return scrubString(node);
  if (typeof node !== 'object') return node;
  if (seen.has(node)) return node;
  seen.add(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = scrubNode(node[i], seen);
    return node;
  }
  for (const key of Object.keys(node)) {
    if (SECRET_KEYS.has(key.toLowerCase())) {
      node[key] = '[REDACTED]';
      continue;
    }
    node[key] = scrubNode(node[key], seen);
  }
  return node;
}

const redactionFormat = winston.format((info) => {
  // winston gives us a fresh `info` object per log; mutating it in place is
  // safe and avoids deep-cloning every record on the hot path.
  return scrubNode(info);
})();

/**
 * Logger
 *
 * Console output: human-readable single-line format with timestamps + level colour.
 * Optional file sink: structured JSON, one record per line, suitable for log shippers
 * (Vector, Filebeat, Fluent Bit) or grep-based forensics. Enable via LOG_FILE env var.
 *
 * The file sink uses winston's built-in rotation hooks via `tailable: true` so log
 * shippers can follow without losing entries during writes. We bound on-disk size to
 * 50 MB across 5 files = 250 MB total before recycling.
 */

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      redactionFormat,
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${metaStr}`;
      })
    ),
  }),
];

if (config.logFile) {
  const filePath = isAbsolute(config.logFile)
    ? config.logFile
    : resolve(process.cwd(), config.logFile);
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch (_) {
    // ignore — winston will surface a clearer error if the path is unwritable
  }

  transports.push(
    new winston.transports.File({
      filename: filePath,
      level: config.logLevel,
      format: winston.format.combine(
        redactionFormat,
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      maxsize: 50 * 1024 * 1024, // 50 MB per file
      maxFiles: 5,
      tailable: true,
    })
  );
}

const logger = winston.createLogger({
  level: config.logLevel,
  transports,
});

if (config.logFile) {
  logger.info('logger:file_sink_enabled', { path: config.logFile });
}

export default logger;
