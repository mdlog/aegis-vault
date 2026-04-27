// Sentry must initialize before any other module so its instrumentation can
// patch http/https + uncaughtException handlers cleanly. Keep this import first.
import { initSentry, Sentry } from './utils/sentry.js';
initSentry();

import cron from 'node-cron';
import config, { validateConfig } from './config/index.js';
import { initialize, runCycle, getStatus } from './services/orchestrator.js';
import { startAPI } from './api.js';
import { flushJournalBuffer } from './services/storage.js';
import logger from './utils/logger.js';

/**
 * Aegis Vault Orchestrator
 *
 * Main entry point. Starts:
 * 1. API server for frontend integration
 * 2. Cron-based orchestration cycle
 *
 * The orchestrator loop:
 *   Market Data → AI Inference (0G Compute) → Policy Check → Execute → Record (0G Storage)
 */

async function main() {
  const validation = validateConfig();
  if (!validation.ok) {
    logger.error('Runtime configuration is incomplete:');
    for (const issue of validation.errors) {
      logger.error(`  - ${issue}`);
    }
    process.exit(1);
  }

  logger.info('╔════════════════════════════════════════════════╗');
  logger.info('║       AEGIS VAULT ORCHESTRATOR v1.0           ║');
  logger.info('║       AI-Managed Risk-Controlled Vault        ║');
  logger.info('╚════════════════════════════════════════════════╝');
  logger.info('');
  logger.info(`Network:  ${config.rpcUrl}`);
  logger.info(`Chain ID: ${config.chainId}`);
  logger.info(`Vault:    ${config.contracts.vault || 'Not configured'}`);
  logger.info(`Factory:  ${config.contracts.vaultFactory || 'Not configured'}`);
  logger.info(`Interval: Every ${config.cycleIntervalMinutes} minutes`);
  logger.info(`Port:     ${config.port}`);
  logger.info(`Strict:   ${config.strictMode ? 'ON' : 'OFF'}`);
  logger.info(`Deploys:  ${config.deploymentsFile}`);
  logger.info('');

  // Initialize orchestrator (includes 0G Storage init)
  await initialize();

  // Start API server
  startAPI();

  // VAULT_ADDRESS is optional now — the indexer auto-discovers all vaults
  // from the factory via VaultDeployed events. We keep the warning for users
  // who rely on the old single-vault mode, but we no longer early-return,
  // so the scheduler is set up regardless and processes whatever the indexer
  // has assigned to this wallet each cycle.
  if (!config.contracts.vault) {
    logger.info('ℹ  VAULT_ADDRESS not set — running in multi-vault indexer mode.');
    logger.info('   Indexer auto-discovers vaults from factory by executor wallet.');
  }

  // Run first cycle immediately
  logger.info('Running initial cycle...');
  try {
    await runCycle();
  } catch (err) {
    logger.error(`Initial cycle failed: ${err.message}`);
    Sentry.captureException(err, { tags: { phase: 'initial_cycle' } });
  }

  // Schedule recurring cycles
  const interval = config.cycleIntervalMinutes;
  const cronExpr = `*/${interval} * * * *`;

  cron.schedule(cronExpr, async () => {
    try {
      await runCycle();
    } catch (err) {
      logger.error(`Scheduled cycle failed: ${err.message}`);
      Sentry.captureException(err, { tags: { phase: 'scheduled_cycle' } });
    }
  });

  logger.info(`Orchestrator scheduled: running every ${interval} minutes`);
  logger.info('Press Ctrl+C to stop.\n');
}

// Handle graceful shutdown
async function shutdown(signal) {
  logger.info(`\nShutting down orchestrator (${signal})...`);
  try {
    await flushJournalBuffer();
  } catch (err) {
    logger.warn(`Journal flush during shutdown failed: ${err.message}`);
  }
  try {
    await Sentry.close(2000);
  } catch {}
  const status = getStatus();
  logger.info(`Final status: ${status.cycleCount} cycles, ${status.totalExecutions} executions`);
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  Sentry.captureException(err, { tags: { phase: 'main_bootstrap' } });
  Sentry.close(2000).finally(() => process.exit(1));
});
