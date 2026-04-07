import winston from 'winston';
import { mkdirSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import config from '../config/index.js';

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
