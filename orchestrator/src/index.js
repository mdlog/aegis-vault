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

  // Check if vault is configured
  if (!config.contracts.vault) {
    logger.warn('⚠  VAULT_ADDRESS not configured. Orchestrator will start but cycles will fail.');
    logger.warn('   Set VAULT_ADDRESS in .env and restart.');
    logger.warn('   You can still use the API endpoints.');
    return;
  }

  // Run first cycle immediately
  logger.info('Running initial cycle...');
  try {
    await runCycle();
  } catch (err) {
    logger.error(`Initial cycle failed: ${err.message}`);
  }

  // Schedule recurring cycles
  const interval = config.cycleIntervalMinutes;
  const cronExpr = `*/${interval} * * * *`;

  cron.schedule(cronExpr, async () => {
    try {
      await runCycle();
    } catch (err) {
      logger.error(`Scheduled cycle failed: ${err.message}`);
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
  process.exit(1);
});
