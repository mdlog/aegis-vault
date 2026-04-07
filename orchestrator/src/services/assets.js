import config from '../config/index.js';

const TRACKED_ASSETS = [
  {
    tradeSymbol: 'USDC',
    contractSymbol: 'USDC',
    address: config.contracts.usdc,
    decimals: 6,
    coingeckoId: 'usd-coin',
    isStablecoin: true,
    aliases: ['USDC'],
  },
  {
    tradeSymbol: 'BTC',
    contractSymbol: 'WBTC',
    address: config.contracts.wbtc,
    decimals: 8,
    coingeckoId: 'bitcoin',
    isStablecoin: false,
    aliases: ['BTC', 'WBTC'],
  },
  {
    tradeSymbol: 'ETH',
    contractSymbol: 'WETH',
    address: config.contracts.weth,
    decimals: 18,
    coingeckoId: 'ethereum',
    isStablecoin: false,
    aliases: ['ETH', 'WETH'],
  },
];

function bySymbolOrAlias(symbol) {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();
  return TRACKED_ASSETS.find((asset) =>
    asset.tradeSymbol === upper ||
    asset.contractSymbol === upper ||
    asset.aliases.includes(upper)
  ) || null;
}

export function getTrackedAssets() {
  return TRACKED_ASSETS.filter((asset) => !!asset.address);
}

export function getTrackedAsset(symbol) {
  return bySymbolOrAlias(symbol);
}

export function normalizeTradeSymbol(symbol) {
  return bySymbolOrAlias(symbol)?.tradeSymbol || (symbol ? symbol.toUpperCase() : null);
}

export function normalizeContractSymbol(symbol) {
  return bySymbolOrAlias(symbol)?.contractSymbol || (symbol ? symbol.toUpperCase() : null);
}

export function getAssetAddress(symbol) {
  return bySymbolOrAlias(symbol)?.address || null;
}

export function getAssetDecimals(symbol) {
  return bySymbolOrAlias(symbol)?.decimals ?? null;
}

export function getTokenAddresses() {
  return {
    usdc: getAssetAddress('USDC'),
    wbtc: getAssetAddress('WBTC'),
    weth: getAssetAddress('WETH'),
  };
}

export function buildAssetAddressMap() {
  const map = {};
  for (const asset of getTrackedAssets()) {
    map[asset.tradeSymbol] = asset.address;
    map[asset.contractSymbol] = asset.address;
    for (const alias of asset.aliases) {
      map[alias] = asset.address;
    }
  }
  return map;
}

export function getAllowedAssetSymbols(addresses = []) {
  const normalized = new Set(
    addresses
      .filter(Boolean)
      .map((address) => address.toLowerCase())
  );

  return getTrackedAssets()
    .filter((asset) => asset.address && normalized.has(asset.address.toLowerCase()))
    .map((asset) => asset.tradeSymbol);
}

