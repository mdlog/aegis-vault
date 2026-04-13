import logger from './logger.js';

/**
 * Retry a function with exponential backoff.
 *
 * @param {Function} fn             Async function to execute
 * @param {Object}   opts
 * @param {number}   opts.maxRetries   Max retry attempts (default 3)
 * @param {number}   opts.baseDelayMs  Initial delay in ms (default 2000)
 * @param {Function} opts.shouldRetry  Predicate (error) => bool. Return false for permanent failures.
 * @param {string}   opts.label        Label for log messages
 * @returns {*} Result of fn()
 */
export async function withRetry(fn, {
  maxRetries = 3,
  baseDelayMs = 2000,
  shouldRetry = () => true,
  label = 'operation',
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries || !shouldRetry(err)) {
        throw err;
      }

      const delay = baseDelayMs * Math.pow(2, attempt);
      logger.warn(`${label}: attempt ${attempt + 1}/${maxRetries + 1} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
