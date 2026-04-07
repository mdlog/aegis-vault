import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

const config = {
  // Network
  rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545',
  chainId: parseInt(process.env.CHAIN_ID || '31337'),
  privateKey: process.env.PRIVATE_KEY || '',

  // Contract addresses
  contracts: {
    vaultFactory: process.env.VAULT_FACTORY_ADDRESS || '',
    executionRegistry: process.env.EXECUTION_REGISTRY_ADDRESS || '',
    vault: process.env.VAULT_ADDRESS || '',
    usdc: process.env.USDC_ADDRESS || '',
    wbtc: process.env.WBTC_ADDRESS || '',
    weth: process.env.WETH_ADDRESS || '',
    // Phase 1-5 production stack
    protocolTreasury: process.env.PROTOCOL_TREASURY_ADDRESS || '',
    operatorRegistry: process.env.OPERATOR_REGISTRY_ADDRESS || '',
    operatorStaking: process.env.OPERATOR_STAKING_ADDRESS || '',
    insurancePool: process.env.INSURANCE_POOL_ADDRESS || '',
    operatorReputation: process.env.OPERATOR_REPUTATION_ADDRESS || '',
    aegisGovernor: process.env.AEGIS_GOVERNOR_ADDRESS || '',
  },

  // 0G Compute (uses mainnet for inference — more models, better availability)
  ogCompute: {
    rpcUrl: process.env.OG_COMPUTE_RPC || 'https://evmrpc.0g.ai',
    privateKey: process.env.OG_COMPUTE_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
    preferredModel: process.env.OG_COMPUTE_MODEL || '', // empty = auto-discover
  },

  // 0G Storage
  ogStorage: {
    rpc: process.env.OG_STORAGE_RPC || 'https://storage-testnet.0g.ai',
    kvAddress: process.env.OG_STORAGE_KV_ADDRESS || '',
  },

  // Market data
  coingeckoUrl: process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3',

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

  // Asset mapping (symbol → coingecko id & contract address)
  assets: {
    BTC: { coingeckoId: 'bitcoin', symbol: 'BTC', decimals: 8 },
    ETH: { coingeckoId: 'ethereum', symbol: 'ETH', decimals: 18 },
    USDC: { coingeckoId: 'usd-coin', symbol: 'USDC', decimals: 6 },
  },
};

export default config;
