/**
 * Sync deployment addresses to frontend/src/lib/deployments.generated.json
 *
 * Reads either deployments.json (default) or a path passed as argv[2].
 * Auto-detects the target chain from `network` or `chainId`.
 *
 * Run after each deploy:
 *   node scripts/sync-frontend.js
 *   node scripts/sync-frontend.js deployments-mainnet.json
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
  arbitrum: 42161,
  arbitrum_one: 42161,
  arbitrum_sepolia: 421614,
  hardhat: 31337,
  localhost: 31337,
};

const argPath = process.argv[2];
const deploymentsPath = argPath
  ? path.resolve(process.cwd(), argPath)
  : path.resolve(__dirname, '../deployments.json');

if (!fs.existsSync(deploymentsPath)) {
  console.error(`Deployments file not found: ${deploymentsPath}`);
  process.exit(1);
}

const frontendRootCandidates = [
  path.resolve(__dirname, '../../frontend/src/lib'),
  path.resolve(__dirname, '../../landing/src/lib'),
];
const frontendLibDir = frontendRootCandidates.find((candidate) => fs.existsSync(candidate));
if (!frontendLibDir) {
  console.error('Could not find frontend/src/lib or landing/src/lib');
  process.exit(1);
}

const generatedManifestPath = path.resolve(frontendLibDir, 'deployments.generated.json');
const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));

let chainId = null;
if (Number.isInteger(deployments.chainId)) {
  chainId = String(deployments.chainId);
} else if (deployments.network && NETWORK_TO_CHAIN_ID[deployments.network]) {
  chainId = String(NETWORK_TO_CHAIN_ID[deployments.network]);
}

if (!chainId) {
  console.error('Unable to infer chain id from deployments file.');
  console.error(`  network: ${JSON.stringify(deployments.network)}`);
  console.error(`  chainId: ${JSON.stringify(deployments.chainId)}`);
  process.exit(1);
}

function buildManifestEntry(targetChainId, source) {
  if (targetChainId === '16661') {
    return {
      operatorRegistry: source.operatorRegistry || '',
      operatorStaking: source.operatorStaking || '',
      insurancePool: source.insurancePool || '',
      operatorReputation: source.operatorReputation || '',
      aegisGovernor: source.aegisGovernor || '',
      protocolTreasury: source.protocolTreasury || '',
      executionRegistry: source.executionRegistry || '',
      aegisVaultFactory: source.aegisVaultFactory || '',
      oUSDT: source.realTokens?.oUSDT || source.stakeToken || '0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189',
      W0G: source.realTokens?.W0G || '0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c',
      mockUSDC: source.realTokens?.oUSDT || source.stakeToken || '0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189',
      mockWBTC: '',
      mockWETH: '',
      mockDEX: '',
      demoVault: '',
      orchestratorWallet: source.orchestratorWallet || '',
    };
  }

  if (targetChainId === '42161') {
    return {
      executionRegistry: source.executionRegistry || '',
      aegisVaultFactory: source.aegisVaultFactory || '',
      uniswapV3VenueAdapter: source.uniswapV3VenueAdapter || source.jaineVenueAdapter || '',
      vaultNAVCalculator: source.vaultNAVCalculator || source.navCalculator || '',
      operatorRegistry: '',
      operatorStaking: '',
      insurancePool: '',
      operatorReputation: '',
      aegisGovernor: '',
      protocolTreasury: '',
      USDC: source.canonical?.USDC || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      WETH: source.canonical?.WETH || '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      WBTC: source.canonical?.WBTC || '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
      mockUSDC: source.canonical?.USDC || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      mockWBTC: source.canonical?.WBTC || '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
      mockWETH: source.canonical?.WETH || '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      uniV3Router: source.canonical?.UniV3_Router || '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      uniV3Factory: source.canonical?.UniV3_Factory || '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      pyth: source.canonical?.Pyth || '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
      mockDEX: '',
      demoVault: '',
      orchestratorWallet: source.orchestratorWallet || '',
    };
  }

  return {
    executionRegistry: source.executionRegistry || '',
    aegisVaultFactory: source.aegisVaultFactory || '',
    operatorRegistry: source.operatorRegistry || '',
    protocolTreasury: source.protocolTreasury || '',
    operatorStaking: source.operatorStaking || '',
    insurancePool: source.insurancePool || '',
    operatorReputation: source.operatorReputation || '',
    aegisGovernor: source.aegisGovernor || '',
    mockUSDC: source.mockUSDC || '',
    mockWBTC: source.mockWBTC || '',
    mockWETH: source.mockWETH || '',
    mockDEX: source.mockDEX || '',
    demoVault: source.demoVault || '',
    orchestratorWallet: source.orchestratorWallet || '',
  };
}

let generatedManifest = {};
if (fs.existsSync(generatedManifestPath)) {
  generatedManifest = JSON.parse(fs.readFileSync(generatedManifestPath, 'utf8'));
}

generatedManifest[chainId] = buildManifestEntry(chainId, deployments);
fs.writeFileSync(generatedManifestPath, `${JSON.stringify(generatedManifest, null, 2)}\n`);

console.log(`Frontend deployment manifest updated for chain ${chainId}`);
console.log(`  Source:   ${deploymentsPath}`);
console.log(`  Output:   ${generatedManifestPath}`);
console.log(`  Factory:  ${deployments.aegisVaultFactory || '(not set)'}`);
console.log(`  Registry: ${deployments.executionRegistry || '(not set)'}`);
