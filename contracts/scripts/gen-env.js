/**
 * Generate orchestrator .env from deployments.json
 * Run after deploy: node scripts/gen-env.js
 */
const fs = require('fs');
const path = require('path');

const deploymentsPath = path.resolve(__dirname, '../deployments.json');
const envPath = path.resolve(__dirname, '../../orchestrator/.env');

if (!fs.existsSync(deploymentsPath)) {
  console.error('No deployments.json found. Run deploy first.');
  process.exit(1);
}

const d = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));
const isLocal = d.network === 'localhost' || d.network === 'hardhat';

const env = `# Auto-generated from deployments.json — ${new Date().toISOString()}
# Network${isLocal ? ' (Hardhat Local)' : ' (0G Galileo Testnet)'}
RPC_URL=${isLocal ? 'http://127.0.0.1:8545' : 'https://evmrpc-testnet.0g.ai'}
CHAIN_ID=${isLocal ? '31337' : '16602'}
PRIVATE_KEY=${isLocal ? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' : '0x_SET_YOUR_PRIVATE_KEY_HERE'}

# Contracts
VAULT_FACTORY_ADDRESS=${d.aegisVaultFactory}
EXECUTION_REGISTRY_ADDRESS=${d.executionRegistry}
VAULT_ADDRESS=${d.demoVault}
USDC_ADDRESS=${d.mockUSDC}
WBTC_ADDRESS=${d.mockWBTC}
WETH_ADDRESS=${d.mockWETH}

# 0G Compute
OG_COMPUTE_ENDPOINT=https://compute-testnet.0g.ai/api/v1
OG_COMPUTE_MODEL=meta-llama/Llama-3.1-8B-Instruct

# 0G Storage (Galileo)
OG_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
OG_KV_RPC=http://3.101.147.150:6789
OG_FLOW_CONTRACT=0x22E03a6A89B950F1c82ec5e74F8eCa321a105296

# Orchestrator
CYCLE_INTERVAL_MINUTES=2
PORT=4002
LOG_LEVEL=info
`;

fs.writeFileSync(envPath, env);
console.log('Generated orchestrator .env');
console.log(`  Vault: ${d.demoVault}`);
console.log(`  Network: ${isLocal ? 'Hardhat Local' : '0G Galileo Testnet (16602)'}`);
