/**
 * Generate orchestrator/.env from contracts/deployments.json
 *
 * Usage:
 *   node scripts/gen-env.js
 *   node scripts/gen-env.js deployments-mainnet.json
 */
const fs = require('fs');
const path = require('path');

const argPath = process.argv[2];
const deploymentsPath = argPath
  ? path.resolve(process.cwd(), argPath)
  : path.resolve(__dirname, '../deployments.json');
const envPath = path.resolve(__dirname, '../../orchestrator/.env');

if (!fs.existsSync(deploymentsPath)) {
  console.error(`Deployments file not found: ${deploymentsPath}`);
  process.exit(1);
}

const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));
const orchestratorRoot = path.resolve(__dirname, '../../orchestrator');
const relativeDeploymentsPath = path.relative(orchestratorRoot, deploymentsPath) || '../contracts/deployments.json';
const chainId = Number(deployments.chainId || (
  deployments.network === 'og_mainnet' ? 16661 :
  deployments.network === 'og_testnet' ? 16602 :
  31337
));

const isLocal = chainId === 31337;
const isMainnet = chainId === 16661;
const networkLabel = isLocal
  ? 'Hardhat Local'
  : isMainnet
    ? '0G Aristotle Mainnet'
    : '0G Galileo Testnet';

const rpcUrl = isLocal
  ? 'http://127.0.0.1:8545'
  : isMainnet
    ? 'https://evmrpc.0g.ai'
    : 'https://evmrpc-testnet.0g.ai';

const usdcAddress =
  deployments.mockUSDC ||
  deployments.realTokens?.oUSDT ||
  deployments.canonical?.USDC ||
  '';
const wbtcAddress = deployments.mockWBTC || deployments.canonical?.WBTC || '';
const wethAddress = deployments.mockWETH || deployments.canonical?.WETH || '';

const env = `# Auto-generated from ${path.basename(deploymentsPath)} — ${new Date().toISOString()}
# Network (${networkLabel})
RPC_URL=${rpcUrl}
CHAIN_ID=${chainId}
PRIVATE_KEY=${isLocal ? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' : '0x_SET_YOUR_ORCHESTRATOR_PRIVATE_KEY_HERE'}

# Contracts
VAULT_FACTORY_ADDRESS=${deployments.aegisVaultFactory || ''}
EXECUTION_REGISTRY_ADDRESS=${deployments.executionRegistry || ''}
VAULT_ADDRESS=${deployments.demoVault || ''}
USDC_ADDRESS=${usdcAddress}
WBTC_ADDRESS=${wbtcAddress}
WETH_ADDRESS=${wethAddress}
PROTOCOL_TREASURY_ADDRESS=${deployments.protocolTreasury || ''}
OPERATOR_REGISTRY_ADDRESS=${deployments.operatorRegistry || ''}
OPERATOR_STAKING_ADDRESS=${deployments.operatorStaking || ''}
INSURANCE_POOL_ADDRESS=${deployments.insurancePool || ''}
OPERATOR_REPUTATION_ADDRESS=${deployments.operatorReputation || ''}
AEGIS_GOVERNOR_ADDRESS=${deployments.aegisGovernor || ''}

# 0G Compute
OG_COMPUTE_RPC=https://evmrpc.0g.ai
OG_COMPUTE_PRIVATE_KEY=
OG_COMPUTE_MODEL=zai-org/GLM-5-FP8

# 0G Storage
OG_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
OG_KV_RPC=http://3.101.147.150:6789
OG_FLOW_CONTRACT=0x22E03a6A89B950F1c82ec5e74F8eCa321a105296
OG_STREAM_ID=

# Orchestrator
CYCLE_INTERVAL_MINUTES=${isLocal ? '2' : '5'}
PORT=4002
LOG_LEVEL=info
ORCHESTRATOR_API_KEY=${isLocal ? '' : 'change-me'}

# Production hardening
STRICT_MODE=${isLocal ? '0' : '1'}
CORS_ALLOWED_ORIGINS=${isLocal ? 'http://localhost:5173' : 'https://app.example.com'}
LOG_FILE=${isLocal ? '' : 'logs/orchestrator.jsonl'}
DATA_DIR=./data
DEPLOYMENTS_FILE=${relativeDeploymentsPath}
`;

fs.writeFileSync(envPath, env);
console.log('Generated orchestrator .env');
console.log(`  Source:  ${deploymentsPath}`);
console.log(`  Output:  ${envPath}`);
console.log(`  Network: ${networkLabel}`);
