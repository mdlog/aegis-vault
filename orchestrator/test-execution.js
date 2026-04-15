/**
 * Test that exercises the full execution path (not just hold).
 * Forces a buy decision via the local engine by mocking market data.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const deployments = JSON.parse(readFileSync(resolve(__dirname, '../contracts/deployments.json'), 'utf8'));

process.env.RPC_URL = 'http://127.0.0.1:8545';
process.env.CHAIN_ID = '31337';
process.env.PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
process.env.VAULT_FACTORY_ADDRESS = deployments.aegisVaultFactory;
process.env.EXECUTION_REGISTRY_ADDRESS = deployments.executionRegistry;
process.env.VAULT_ADDRESS = deployments.demoVault;
process.env.USDC_ADDRESS = deployments.mockUSDC;
process.env.WBTC_ADDRESS = deployments.mockWBTC;
process.env.WETH_ADDRESS = deployments.mockWETH;
process.env.PORT = '3002';
process.env.LOG_LEVEL = 'info';

const { initialize } = await import('./src/services/orchestrator.js');
const { readVaultState } = await import('./src/services/vaultReader.js');
const { localDecisionEngine } = await import('./src/services/inference.js');
const { preCheckPolicy } = await import('./src/services/policyCheck.js');
const { buildExecutionIntent, submitIntent, recordExecutionResult, setAssetAddresses } = await import('./src/services/executor.js');
const { readJournal, logDecision, logExecution } = await import('./src/services/storage.js');

async function test() {
  console.log('\n=== EXECUTION PATH TEST ===\n');

  // Initialize
  await initialize();

  // Read vault state
  const vaultState = await readVaultState(deployments.demoVault);
  console.log(`Vault NAV: $${vaultState.nav.toLocaleString()}`);

  // Force a buy signal by simulating strong BTC momentum
  const fakeMarket = {
    timestamp: Date.now(),
    prices: {
      BTC: { symbol: 'BTC', price: 70000, change24h: 4.5, volume24h: 30e9, marketCap: 1.4e12, timestamp: Date.now() },
      ETH: { symbol: 'ETH', price: 2200, change24h: 1.0, volume24h: 12e9, marketCap: 265e9, timestamp: Date.now() },
      USDC: { symbol: 'USDC', price: 1, change24h: 0, volume24h: 5e9, marketCap: 33e9, timestamp: Date.now() },
    },
    volatility: { BTC: '45%', ETH: '52%' },
  };

  // Get decision from local engine
  const decision = localDecisionEngine(fakeMarket, vaultState);
  console.log(`\nDecision: ${decision.action} ${decision.asset}`);
  console.log(`Size: ${decision.size_bps} bps | Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
  console.log(`Reason: ${decision.reason}`);

  // Policy check
  const policyResult = preCheckPolicy(decision, vaultState, vaultState.policy);
  console.log(`\nPolicy check: ${policyResult.valid ? 'PASSED ✓' : 'BLOCKED ✗ ' + policyResult.reason}`);

  if (!policyResult.valid) {
    console.log('Cannot test execution — policy blocked');
    process.exit(0);
  }

  // Build intent
  const intent = await buildExecutionIntent(decision, vaultState);
  console.log(`\nIntent hash: ${intent.intentHash.substring(0, 18)}...`);
  console.log(`AssetIn:  ${intent.assetIn}`);
  console.log(`AssetOut: ${intent.assetOut}`);
  console.log(`AmountIn: ${intent.amountIn.toString()}`);

  // Submit to contract
  console.log('\nSubmitting intent to contract...');
  const execResult = await submitIntent(intent);
  console.log(`Result: ${execResult.success ? 'SUCCESS ✓' : 'FAILED ✗'}`);
  if (execResult.txHash) {
    console.log(`TX Hash: ${execResult.txHash}`);
  }
  if (execResult.error) {
    console.log(`Error: ${execResult.error}`);
  }

  // Final vault state (swap already auto-recorded on-chain)
  const finalState = await readVaultState(deployments.demoVault);
  console.log(`\nFinal vault NAV: $${finalState.nav.toLocaleString()}`);
  console.log(`Daily actions: ${finalState.dailyActionsUsed}`);

  console.log('\n=== EXECUTION TEST COMPLETE ===');
}

test()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
  });
