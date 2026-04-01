import cron from 'node-cron';
import config from './config/index.js';
import { initialize, runCycle, getStatus } from './services/orchestrator.js';
import { startAPI } from './api.js';
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
  logger.info('╔════════════════════════════════════════════════╗');
  logger.info('║       AEGIS VAULT ORCHESTRATOR v1.0           ║');
  logger.info('║       AI-Managed Risk-Controlled Vault        ║');
  logger.info('╚════════════════════════════════════════════════╝');
  logger.info('');
  logger.info(`Network:  ${config.rpcUrl}`);
  logger.info(`Chain ID: ${config.chainId}`);
  logger.info(`Vault:    ${config.contracts.vault || 'Not configured'}`);
  logger.info(`Interval: Every ${config.cycleIntervalMinutes} minutes`);
  logger.info(`Port:     ${config.port}`);
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
process.on('SIGINT', () => {
  logger.info('\nShutting down orchestrator...');
  const status = getStatus();
  logger.info(`Final status: ${status.cycleCount} cycles, ${status.totalExecutions} executions`);
  process.exit(0);
});

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
