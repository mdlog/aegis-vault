import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { Wallet } from 'ethers';

const __dirname = dirname(fileURLToPath(import.meta.url));
// `override: true` makes .env win over already-exported shell env vars. Without
// this, a stale `export ORCHESTRATOR_API_KEY=...` from .bashrc silently hides
// whatever the user set in .env, leading to mismatched-key auth failures that
// look like "but the file says X!" — because file says X but process.env is Y.
dotenv.config({ path: resolve(__dirname, '../../.env'), override: true });

function readDeploymentsFile() {
  // Default to the V3 mainnet source-of-truth that `deploy-fresh-mainnet.js`
  // writes. The older `deployments.json` is the original V1 deploy and is
  // no longer updated by any deploy script — pointing at it leaves the
  // orchestrator on stale factory / registry / operator-stack addresses.
  const candidatePath = process.env.DEPLOYMENTS_FILE
    ? resolve(__dirname, '../../', process.env.DEPLOYMENTS_FILE)
    : resolve(__dirname, '../../../contracts/deployments-mainnet.json');

  if (!existsSync(candidatePath)) {
    return { path: candidatePath, data: null };
  }

  try {
    return {
      path: candidatePath,
      data: JSON.parse(readFileSync(candidatePath, 'utf8')),
    };
  } catch {
    return { path: candidatePath, data: null };
  }
}

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') || '';
}

const deploymentFile = readDeploymentsFile();
const deploymentDefaults = deploymentFile.data || {};
const derivedChainId = parseInt(
  process.env.CHAIN_ID ||
    deploymentDefaults.chainId ||
    (deploymentDefaults.network === 'og_mainnet' ? '16661'
      : deploymentDefaults.network === 'og_testnet' ? '16602'
      : '31337')
);
const derivedRpcUrl = firstNonEmpty(
  process.env.RPC_URL,
  derivedChainId === 16661 ? 'https://evmrpc.0g.ai'
    : derivedChainId === 16602 ? 'https://evmrpc-testnet.0g.ai'
    : 'http://127.0.0.1:8545'
);

const config = {
  // Network
  rpcUrl: derivedRpcUrl,
  chainId: derivedChainId,
  privateKey: process.env.PRIVATE_KEY || '',
  deploymentsFile: deploymentFile.path,
  // Records which factory ABI generation matches `contracts.vaultFactory`.
  // V4 added a 7th createVault arg (acceptedManifestHash) and a wider
  // VaultDeployed event (8 args). V3 added two args to the V2 event.
  // Indexer must load the matching ABI or queryFilter returns nothing
  // for new vaults. Honors a VAULT_FACTORY_ADDRESS env override only if
  // it matches a known V4/V3/V2 deployment key — otherwise falls back to v1.
  factoryVersion: (() => {
    const override = process.env.VAULT_FACTORY_ADDRESS;
    const match = (addr, ref) => addr && ref && addr.toLowerCase() === ref.toLowerCase();
    if (override) {
      if (match(override, deploymentDefaults.aegisVaultFactoryV4)) return 'v4';
      if (match(override, deploymentDefaults.aegisVaultFactoryV3)) return 'v3';
      if (match(override, deploymentDefaults.aegisVaultFactoryV2)) return 'v2';
      return 'v1';
    }
    if (deploymentDefaults.aegisVaultFactoryV4) return 'v4';
    if (deploymentDefaults.aegisVaultFactoryV3) return 'v3';
    if (deploymentDefaults.aegisVaultFactoryV2) return 'v2';
    return 'v1';
  })(),

  // Contract addresses — resolution priority: V4 → V3 → V2 → V1 (env override
  // always wins). Post-`deploy-fresh-mainnet.js` runs only V3 keys are
  // present and V1/V2 unsuffixed keys are absent from the deployments file;
  // chains that haven't been re-deployed still get the legacy fallback.
  // V4 keys appear once the V4 deploy script has been run.
  contracts: {
    vaultFactory: firstNonEmpty(
      process.env.VAULT_FACTORY_ADDRESS,
      deploymentDefaults.aegisVaultFactoryV4,
      deploymentDefaults.aegisVaultFactoryV3,
      deploymentDefaults.aegisVaultFactoryV2,
      deploymentDefaults.aegisVaultFactory
    ),
    executionRegistry: firstNonEmpty(
      process.env.EXECUTION_REGISTRY_ADDRESS,
      deploymentDefaults.executionRegistryV3,
      deploymentDefaults.executionRegistryV2,
      deploymentDefaults.executionRegistry
    ),
    vault: firstNonEmpty(process.env.VAULT_ADDRESS, deploymentDefaults.demoVault),
    usdc: firstNonEmpty(process.env.USDC_ADDRESS, deploymentDefaults.mockUSDC, deploymentDefaults.realTokens?.USDCe, deploymentDefaults.realTokens?.oUSDT, deploymentDefaults.canonical?.USDC),
    wbtc: firstNonEmpty(process.env.WBTC_ADDRESS, deploymentDefaults.mockWBTC, deploymentDefaults.realTokens?.WBTC, deploymentDefaults.canonical?.WBTC),
    cbbtc: firstNonEmpty(process.env.CBBTC_ADDRESS, deploymentDefaults.realTokens?.cbBTC),
    weth: firstNonEmpty(process.env.WETH_ADDRESS, deploymentDefaults.mockWETH, deploymentDefaults.realTokens?.WETH, deploymentDefaults.canonical?.WETH),
    w0g: firstNonEmpty(process.env.W0G_ADDRESS, deploymentDefaults.realTokens?.W0G, deploymentDefaults.jaine?.w0g),
    // Phase 1-5 production stack — V3 preferred, V2 fallback, V1 fallback.
    // OperatorRegistry / Staking / InsurancePool keep their V2 surface in V3
    // (no breaking change) so the cutover preserves existing operator data.
    protocolTreasury: firstNonEmpty(process.env.PROTOCOL_TREASURY_ADDRESS, deploymentDefaults.protocolTreasury),
    operatorRegistry: firstNonEmpty(process.env.OPERATOR_REGISTRY_ADDRESS, deploymentDefaults.operatorRegistryV2, deploymentDefaults.operatorRegistry),
    operatorStaking: firstNonEmpty(process.env.OPERATOR_STAKING_ADDRESS, deploymentDefaults.operatorStakingV2, deploymentDefaults.operatorStaking),
    insurancePool: firstNonEmpty(process.env.INSURANCE_POOL_ADDRESS, deploymentDefaults.insurancePoolV2, deploymentDefaults.insurancePool),
    operatorReputation: firstNonEmpty(process.env.OPERATOR_REPUTATION_ADDRESS, deploymentDefaults.operatorReputation),
    aegisGovernor: firstNonEmpty(process.env.AEGIS_GOVERNOR_ADDRESS, deploymentDefaults.aegisGovernor),
    // V3 cross-chain venue + Khalani. Optional — only set when a V3 deploy
    // has populated the keys. Used by quoteRouter to query route allowlist
    // governance metadata before publishing intents.
    khalaniVenueAdapter: firstNonEmpty(process.env.KHALANI_VENUE_ADAPTER, deploymentDefaults.khalaniVenueAdapter),
    jaineVenueAdapter: firstNonEmpty(process.env.JAINE_VENUE_ADAPTER, deploymentDefaults.jaineVenueAdapterV2, deploymentDefaults.jaineVenueAdapter),
  },

  // 0G Compute (uses mainnet for inference — more models, better availability)
  ogCompute: {
    rpcUrl: process.env.OG_COMPUTE_RPC || 'https://evmrpc.0g.ai',
    privateKey: process.env.OG_COMPUTE_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
    preferredModel: process.env.OG_COMPUTE_MODEL || '', // empty = auto-discover
  },

  // ── Track 2: Sealed Strategy Mode (TEE attestation signer) ──
  // The TEE signer is the ECDSA key bound to the TEE-attested 0G Compute pipeline.
  // For sealed-mode vaults, the orchestrator signs the intent hash with this key
  // and the vault verifies the signature against policy.attestedSigner on-chain.
  // SECURITY: this key must be different from the orchestrator's hot wallet, and
  // must only ever be used to sign valid TEE-attested inference outputs.
  teeSigner: {
    privateKey: process.env.TEE_SIGNER_PRIVATE_KEY || '',
  },

  // ── Real TEE attestation gate (off-chain DCAP verification of the 0G
  // Compute provider enclave). Defaults mirror the @0glabs SDK's Automata
  // verifier. rpc.ata.network is the official Automata mainnet RPC with the
  // DCAP verifier deployed; the SDK default 1rpc.io/ata is rate-limited.
  // cacheTtlMs caches positive provider-enclave verifications; fetchTimeoutMs
  // bounds quote/RPC fetches. The gate's *enablement* stays manifest-derived
  // (execution.requireTeeAttestation), not these env vars.
  teeAttestation: {
    automataRpc: process.env.AUTOMATA_RPC || 'https://rpc.ata.network',
    automataAddress: process.env.AUTOMATA_CONTRACT_ADDRESS || '0xE26E11B257856B0bEBc4C759aaBDdea72B64351F',
    cacheTtlMs: parseInt(process.env.TEE_CACHE_TTL_MS || '3600000'),
    fetchTimeoutMs: parseInt(process.env.TEE_FETCH_TIMEOUT_MS || '60000'),
  },

  // 0G Storage
  ogStorage: {
    rpc: process.env.OG_STORAGE_RPC || 'https://storage-testnet.0g.ai',
    kvAddress: process.env.OG_STORAGE_KV_ADDRESS || '',
  },

  // Market data
  coingeckoUrl: process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3',

  // Swap execution — minAmountOut is built from the on-chain venue quote
  // (`getAmountOut`) multiplied by (1 - slippage). Oracle price is used only as a
  // sanity floor. On mainnet set this tight (50 bps = 0.5%); on testnet with a
  // MockDEX whose rates drift from oracle, 300–500 bps is usually needed.
  swapSlippageBps: parseInt(process.env.SWAP_SLIPPAGE_BPS || '300'),

  // Orchestrator
  cycleIntervalMinutes: parseInt(process.env.CYCLE_INTERVAL_MINUTES || '5'),
  port: parseInt(process.env.PORT || '4002'),
  logLevel: process.env.LOG_LEVEL || 'info',
  apiKey: process.env.ORCHESTRATOR_API_KEY || '',

  // ── Fail-safe mode (production) ──
  // When STRICT_MODE=1, the orchestrator refuses to operate on stale or fallback data:
  //   - CoinGecko / Pyth fetch failures throw instead of returning hardcoded prices
  //   - 0G Compute failures abort the cycle instead of falling back to local heuristics
  //   - Missing operator/staking contracts cause the cycle to skip the vault, not run unrestricted
  //
  // Recommended for any deployment custodying real funds. Default off to keep
  // dev/testnet ergonomics smooth.
  strictMode: process.env.STRICT_MODE === '1',

  // CORS allowlist (comma-separated origins). Empty = allow all (dev only).
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // File log path (optional). When set, logger writes structured JSON to this file
  // in addition to console output.
  logFile: process.env.LOG_FILE || '',

  // Local state directory. In staging / production, point this at a persistent
  // volume. Defaults to orchestrator/data for local development.
  dataDir: process.env.DATA_DIR || '',

  // Asset mapping (symbol → coingecko id & contract address)
  assets: {
    BTC: { coingeckoId: 'bitcoin', symbol: 'BTC', decimals: 8 },
    ETH: { coingeckoId: 'ethereum', symbol: 'ETH', decimals: 18 },
    USDC: { coingeckoId: 'usd-coin', symbol: 'USDC', decimals: 6 },
    '0G': { coingeckoId: '0g', symbol: '0G', decimals: 18 },
  },
};

export function validateConfig(targetConfig = config) {
  const errors = [];

  if (!targetConfig.contracts.vaultFactory) {
    errors.push('VAULT_FACTORY_ADDRESS missing');
  }
  if (!targetConfig.contracts.executionRegistry) {
    errors.push('EXECUTION_REGISTRY_ADDRESS missing');
  }

  if (targetConfig.strictMode) {
    if (!targetConfig.privateKey) {
      errors.push('PRIVATE_KEY missing in STRICT_MODE');
    }
    if (!targetConfig.apiKey) {
      errors.push('ORCHESTRATOR_API_KEY missing in STRICT_MODE');
    }
    if (!targetConfig.corsAllowedOrigins.length) {
      errors.push('CORS_ALLOWED_ORIGINS missing in STRICT_MODE');
    }

    const strictContracts = [
      ['protocolTreasury', 'PROTOCOL_TREASURY_ADDRESS'],
      ['operatorRegistry', 'OPERATOR_REGISTRY_ADDRESS'],
      ['operatorStaking', 'OPERATOR_STAKING_ADDRESS'],
      ['insurancePool', 'INSURANCE_POOL_ADDRESS'],
      ['operatorReputation', 'OPERATOR_REPUTATION_ADDRESS'],
      ['aegisGovernor', 'AEGIS_GOVERNOR_ADDRESS'],
    ];

    for (const [key, label] of strictContracts) {
      if (!targetConfig.contracts[key]) {
        errors.push(`${label} missing in STRICT_MODE`);
      }
    }
  }

  // Security invariant (Post-TEE remediation P0-10): the TEE attestation signer
  // key must never equal the executor hot-wallet key. Reusing a single key
  // collapses the trust separation documented above — a leaked executor key
  // would then also be able to mint valid sealed-mode attestation signatures.
  // Until now this was only a comment; enforce it whenever both keys are set.
  if (targetConfig.privateKey && targetConfig.teeSigner?.privateKey) {
    try {
      const execAddr = new Wallet(targetConfig.privateKey).address.toLowerCase();
      const teeAddr = new Wallet(targetConfig.teeSigner.privateKey).address.toLowerCase();
      if (execAddr === teeAddr) {
        errors.push(
          'TEE_SIGNER_PRIVATE_KEY must differ from PRIVATE_KEY (executor hot wallet) — a shared key collapses attestation trust separation'
        );
      }
    } catch {
      errors.push('PRIVATE_KEY or TEE_SIGNER_PRIVATE_KEY is not a valid private key');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export default config;
