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
  port: parseInt(process.env.PORT || '3001'),
  logLevel: process.env.LOG_LEVEL || 'info',

  // Asset mapping (symbol → coingecko id & contract address)
  assets: {
    BTC: { coingeckoId: 'bitcoin', symbol: 'BTC', decimals: 8 },
    ETH: { coingeckoId: 'ethereum', symbol: 'ETH', decimals: 18 },
    USDC: { coingeckoId: 'usd-coin', symbol: 'USDC', decimals: 6 },
  },
};

export default config;
