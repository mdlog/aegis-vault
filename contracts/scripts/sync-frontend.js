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
    // 0G Aristotle Mainnet — real Jaine DEX tokens (USDC.e, WETH, WBTC, W0G).
    // Addresses are the live Jaine-pair tokens verified via swap events.
    const USDC_E = source.realTokens?.USDCe || '0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E';
    const WETH_REAL = source.realTokens?.WETH || '0x564770837Ef8bbF077cFe54E5f6106538c815B22';
    const WBTC_REAL = source.realTokens?.WBTC || '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c';
    const W0G = source.realTokens?.W0G || '0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c';
    const CBBTC = source.realTokens?.cbBTC || '';

    // Resolution chain: prefer the most recent stack version, fall back to
    // older ones, finally empty string. Keeps post-fresh-deploy frontends
    // working when only V3 is populated, while legacy V1/V2 deployments
    // remain readable for older frontend code paths that still use the
    // unsuffixed key names.
    const factoryAny  = source.aegisVaultFactoryV3  || source.aegisVaultFactoryV2  || source.aegisVaultFactory  || '';
    const registryAny = source.executionRegistryV3 || source.executionRegistryV2 || source.executionRegistry || '';
    const operatorReg = source.operatorRegistryV2  || source.operatorRegistry      || '';
    const stakingAny  = source.operatorStakingV2   || source.operatorStaking       || '';
    const insuranceAny = source.insurancePoolV2    || source.insurancePool         || '';
    const adapterAny  = source.jaineVenueAdapterV2 || source.jaineVenueAdapter     || '';

    return {
      // Legacy unsuffixed keys — populated via the resolution chain above so
      // frontend code that still reads e.g. `deployments.aegisVaultFactory`
      // continues to work after a fresh V3-only deploy. New code should
      // prefer the explicit `…V3` keys.
      operatorRegistry:    operatorReg,
      operatorStaking:     stakingAny,
      insurancePool:       insuranceAny,
      operatorReputation:  source.operatorReputation || '',
      aegisGovernor:       source.aegisGovernor || '',
      protocolTreasury:    source.protocolTreasury || '',
      executionRegistry:   registryAny,
      aegisVaultFactory:   factoryAny,
      vaultNAVCalculator:  source.vaultNAVCalculator || '',
      jaineVenueAdapter:   adapterAny,
      // V2 multi-hop adapter: explicit key kept even after fresh V3 deploy
      // because executor / orchestrator route quotes through it directly.
      jaineVenueAdapterV2: source.jaineVenueAdapterV2 || '',
      // v2 stack — kept for back-compat. Empty after a clean V3 deploy.
      aegisVaultImplementationV2: source.aegisVaultImplementationV2 || '',
      aegisVaultFactoryV2:        source.aegisVaultFactoryV2 || '',
      executionRegistryV2:        source.executionRegistryV2 || '',
      insurancePoolV2:            source.insurancePoolV2 || '',
      operatorStakingV2:          source.operatorStakingV2 || '',
      operatorRegistryV2:         source.operatorRegistryV2 || '',
      // v3 stack — canonical surface after `deploy-fresh-mainnet.js`.
      execLibraryV3:               source.execLibraryV3 || '',
      ioLibraryV3:                 source.ioLibraryV3 || '',
      crossChainLibrary:           source.crossChainLibrary || '',
      executionRegistryV3:         source.executionRegistryV3 || '',
      aegisVaultImplementationV3:  source.aegisVaultImplementationV3 || '',
      aegisVaultFactoryV3:         source.aegisVaultFactoryV3 || '',
      khalaniVenueAdapter:         source.khalaniVenueAdapter || '',
      USDCe: USDC_E,
      WETH:  WETH_REAL,
      WBTC:  WBTC_REAL,
      W0G:   W0G,
      cbBTC: CBBTC,
      // Back-compat aliases for CreateVaultPage's BTC/ETH/USDC asset map
      mockUSDC: USDC_E,
      mockWETH: WETH_REAL,
      mockWBTC: WBTC_REAL,
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
// Resolve via the same V3 → V2 → V1 chain that buildManifestEntry uses, so
// post-fresh-deploy runs (where legacy V1 keys are intentionally absent)
// don't print misleading "(not set)" lines.
console.log(`  Factory:  ${deployments.aegisVaultFactoryV3 || deployments.aegisVaultFactoryV2 || deployments.aegisVaultFactory || '(not set)'}`);
console.log(`  Registry: ${deployments.executionRegistryV3 || deployments.executionRegistryV2 || deployments.executionRegistry || '(not set)'}`);
