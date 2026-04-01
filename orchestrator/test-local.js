/**
 * Local E2E Test
 *
 * Tests the full orchestrator pipeline against a local Hardhat node:
 * 1. Starts Hardhat node (must be running separately)
 * 2. Deploys contracts
 * 3. Configures orchestrator
 * 4. Runs a full cycle
 *
 * Usage:
 *   1. In terminal 1: cd ../contracts && npx hardhat node
 *   2. In terminal 2: cd ../contracts && npx hardhat run scripts/deploy.js --network localhost
 *   3. In terminal 3: node test-local.js
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load deployment addresses
let deployments;
try {
  deployments = JSON.parse(readFileSync(resolve(__dirname, '../contracts/deployments.json'), 'utf8'));
  console.log('Loaded deployments:', deployments);
} catch (err) {
  console.error('No deployments.json found. Run deploy script first.');
  console.error('  cd ../contracts && npx hardhat run scripts/deploy.js --network localhost');
  process.exit(1);
}

// Set environment variables for orchestrator
process.env.RPC_URL = 'http://127.0.0.1:8545';
process.env.CHAIN_ID = '31337';
process.env.PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Hardhat account #0
process.env.VAULT_FACTORY_ADDRESS = deployments.aegisVaultFactory;
process.env.EXECUTION_REGISTRY_ADDRESS = deployments.executionRegistry;
process.env.VAULT_ADDRESS = deployments.demoVault;
process.env.USDC_ADDRESS = deployments.mockUSDC;
process.env.WBTC_ADDRESS = deployments.mockWBTC;
process.env.WETH_ADDRESS = deployments.mockWETH;
process.env.PORT = '3001';
process.env.LOG_LEVEL = 'info';

// Now import orchestrator (after env is set)
const { initialize, runCycle, getStatus } = await import('./src/services/orchestrator.js');
const { readVaultState } = await import('./src/services/vaultReader.js');
const { buildMarketSummary } = await import('./src/services/marketData.js');
const { readKVState, readJournal } = await import('./src/services/storage.js');

async function test() {
  console.log('\n' + '='.repeat(60));
  console.log('  AEGIS VAULT ORCHESTRATOR — LOCAL E2E TEST');
  console.log('='.repeat(60) + '\n');

  // Initialize
  console.log('1. Initializing orchestrator...');
  await initialize();

  // Read vault state
  console.log('\n2. Reading vault state from chain...');
  const vaultState = await readVaultState(deployments.demoVault);
  console.log(`   Owner:    ${vaultState.owner}`);
  console.log(`   NAV:      $${vaultState.nav.toLocaleString()}`);
  console.log(`   Paused:   ${vaultState.paused}`);
  console.log(`   Mandate:  ${vaultState.mandate}`);

  // Fetch market data
  console.log('\n3. Fetching market data...');
  const market = await buildMarketSummary();
  console.log(`   ${market.summary}`);

  // Run a full cycle
  console.log('\n4. Running full orchestrator cycle...');
  const result = await runCycle();
  console.log(`   Status: ${result.status}`);
  if (result.decision) {
    console.log(`   Decision: ${result.decision.action} ${result.decision.asset}`);
    console.log(`   Confidence: ${(result.decision.confidence * 100).toFixed(0)}%`);
    console.log(`   Reason: ${result.decision.reason}`);
  }
  if (result.executionResult) {
    console.log(`   TX Hash: ${result.executionResult.txHash || 'N/A'}`);
  }

  // Check orchestrator status
  console.log('\n5. Orchestrator status:');
  const status = getStatus();
  console.log(`   Cycles:     ${status.cycleCount}`);
  console.log(`   Executions: ${status.totalExecutions}`);
  console.log(`   Blocked:    ${status.totalBlocked}`);
  console.log(`   Skipped:    ${status.totalSkipped}`);

  // Check journal
  console.log('\n6. Journal entries:');
  const journal = readJournal();
  console.log(`   Total entries: ${journal.length}`);
  for (const entry of journal.slice(-3)) {
    console.log(`   [${entry.type}] ${entry.timestamp} — ${entry.action || entry.event || entry.status || ''}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('  TEST COMPLETE');
  console.log('='.repeat(60));
}

test()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
