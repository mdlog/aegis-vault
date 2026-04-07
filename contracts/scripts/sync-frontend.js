/**
 * Sync deployment addresses to frontend lib/contracts.js
 *
 * Reads either deployments.json (default) or a path passed as argv[2].
 * Auto-detects target chain from `network` or `chainId` field.
 *
 * Supported networks:
 *   og_mainnet  → chain 16661
 *   og_testnet  → chain 16602
 *   localhost / hardhat → chain 31337
 *
 * Run after each deploy:
 *   node scripts/sync-frontend.js                          # uses deployments.json
 *   node scripts/sync-frontend.js deployments-mainnet.json # explicit
 */
const fs = require('fs');
const path = require('path');

const NETWORK_TO_CHAIN_ID = {
  og_mainnet: 16661,
  '0g_mainnet': 16661,
  aristotle: 16661,
  og_testnet: 16602,
  '0g_testnet': 16602,
  galileo: 16602,
  hardhat: 31337,
  localhost: 31337,
};

// Determine which deployments file to read
const argPath = process.argv[2];
const deploymentsPath = argPath
  ? path.resolve(process.cwd(), argPath)
  : path.resolve(__dirname, '../deployments.json');

if (!fs.existsSync(deploymentsPath)) {
  console.error(`Deployments file not found: ${deploymentsPath}`);
  console.error('Run a deploy script first (deploy-all.js, deploy-mainnet.js, …)');
  process.exit(1);
}

const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));

// Resolve chain id from explicit chainId field, then network name, then fail loud
let chainId = null;
if (deployments.chainId && Number.isInteger(deployments.chainId)) {
  chainId = String(deployments.chainId);
} else if (deployments.network && NETWORK_TO_CHAIN_ID[deployments.network]) {
  chainId = String(NETWORK_TO_CHAIN_ID[deployments.network]);
}

if (!chainId) {
  console.error(`Cannot determine chain id from deployments file.`);
  console.error(`  network field: ${JSON.stringify(deployments.network)}`);
  console.error(`  chainId field: ${JSON.stringify(deployments.chainId)}`);
  console.error(`Supported networks: ${Object.keys(NETWORK_TO_CHAIN_ID).join(', ')}`);
  process.exit(1);
}

// Find the frontend contracts.js
const candidatePaths = [
  path.resolve(__dirname, '../../frontend/src/lib/contracts.js'),
  path.resolve(__dirname, '../../landing/src/lib/contracts.js'),
];
const contractsPath = candidatePaths.find((p) => fs.existsSync(p));
if (!contractsPath) {
  console.error('Frontend contracts.js not found in frontend/ or landing/');
  process.exit(1);
}

let content = fs.readFileSync(contractsPath, 'utf8');

// Build the replacement object — supports both legacy (mock-based) and mainnet schemas
const isMainnet = chainId === '16661';
const addrBlock = isMainnet
  ? `  ${chainId}: {
    executionRegistry: '${deployments.executionRegistry || ''}',
    aegisVaultFactory: '${deployments.aegisVaultFactory || ''}',
    operatorRegistry: '${deployments.operatorRegistry || ''}',
    protocolTreasury: '${deployments.protocolTreasury || ''}',
    operatorStaking: '${deployments.operatorStaking || ''}',
    insurancePool: '${deployments.insurancePool || ''}',
    operatorReputation: '${deployments.operatorReputation || ''}',
    aegisGovernor: '${deployments.aegisGovernor || ''}',
    jaineVenueAdapter: '${deployments.jaineVenueAdapter || ''}',
    oUSDT: '${deployments.realTokens?.oUSDT || '0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189'}',
    W0G:   '${deployments.realTokens?.W0G   || '0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c'}',
    mockUSDC: '${deployments.realTokens?.oUSDT || '0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189'}',
    mockWBTC: '',
    mockWETH: '',
    mockDEX: '',
    demoVault: '',
    orchestratorWallet: '${deployments.orchestratorWallet || ''}',
  },`
  : `  ${chainId}: {
    executionRegistry: '${deployments.executionRegistry || ''}',
    aegisVaultFactory: '${deployments.aegisVaultFactory || ''}',
    operatorRegistry: '${deployments.operatorRegistry || ''}',
    protocolTreasury: '${deployments.protocolTreasury || ''}',
    operatorStaking: '${deployments.operatorStaking || ''}',
    insurancePool: '${deployments.insurancePool || ''}',
    operatorReputation: '${deployments.operatorReputation || ''}',
    aegisGovernor: '${deployments.aegisGovernor || ''}',
    mockUSDC: '${deployments.mockUSDC || ''}',
    mockWBTC: '${deployments.mockWBTC || ''}',
    mockWETH: '${deployments.mockWETH || ''}',
    mockDEX: '${deployments.mockDEX || ''}',
    demoVault: '${deployments.demoVault || ''}',
    orchestratorWallet: '${deployments.orchestratorWallet || ''}',
  },`;

// Replace the chain block using regex
const regex = new RegExp(`  ${chainId}: \\{[^}]+\\},`, 's');
if (!regex.test(content)) {
  console.error(`Could not find chain ${chainId} block in ${contractsPath}`);
  console.error('Make sure the DEPLOYMENTS object has an entry for this chain.');
  process.exit(1);
}
content = content.replace(regex, addrBlock);

fs.writeFileSync(contractsPath, content);
console.log(`Frontend contracts.js updated for chain ${chainId} (${deployments.network || 'unknown'})`);
console.log(`  Source: ${deploymentsPath}`);
console.log(`  Factory: ${deployments.aegisVaultFactory || '(not set)'}`);
if (isMainnet) {
  console.log(`  Jaine venue: ${deployments.jaineVenueAdapter || '(not set)'}`);
  console.log(`  Governor: ${deployments.aegisGovernor || '(not set)'}`);
} else {
  console.log(`  Demo vault: ${deployments.demoVault || '(not set)'}`);
}
