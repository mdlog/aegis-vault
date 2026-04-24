// Wallet shims — thin EIP-1193 helpers for browser dApps.
//
// These exist because the dance around `wallet_switchEthereumChain` →
// 4902 "Unrecognized chain" → `wallet_addEthereumChain` is surprisingly
// error-prone, and every Aegis frontend that integrates the SDK would
// re-implement it otherwise.
//
// All helpers accept an optional `provider` arg (an EIP-1193 object with
// `.request({ method, params })`). Default: `globalThis.ethereum`. The SDK
// itself remains framework-agnostic — these are opt-in utilities.

import { NETWORK_PARAMS } from './config.js';

const UNRECOGNIZED_CHAIN_CODE = 4902;

function getProvider(provider) {
  const p = provider || globalThis.ethereum;
  if (!p || typeof p.request !== 'function') {
    throw new Error('wallet: no EIP-1193 provider found. Pass one explicitly or ensure window.ethereum is set.');
  }
  return p;
}

function toHexChainId(chainId) {
  return '0x' + Number(chainId).toString(16);
}

/**
 * Prompt the wallet to add a network. Throws if the chain has no entry in
 * `NETWORK_PARAMS`. Safe to call if the network is already added — the wallet
 * will resolve silently.
 *
 * @param {number} chainId
 * @param {object} [provider]  EIP-1193 provider (defaults to window.ethereum)
 * @returns {Promise<void>}
 */
export async function addNetwork(chainId, provider) {
  const params = NETWORK_PARAMS[chainId];
  if (!params) {
    throw new Error(`wallet.addNetwork: no NETWORK_PARAMS entry for chain ${chainId}`);
  }
  const p = getProvider(provider);
  await p.request({ method: 'wallet_addEthereumChain', params: [params] });
}

/**
 * Switch the wallet to `chainId`. If the wallet doesn't know the chain yet
 * (error code 4902), this auto-calls `addNetwork` and retries.
 *
 * @param {number} chainId
 * @param {object} [provider]
 * @returns {Promise<void>}
 */
export async function switchNetwork(chainId, provider) {
  const p = getProvider(provider);
  const hexChainId = toHexChainId(chainId);
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] });
  } catch (err) {
    // MetaMask/Rabby/Coinbase Wallet all surface 4902 when the chain isn't
    // registered yet. Auto-add and retry once.
    const code = err?.code ?? err?.data?.originalError?.code;
    if (code === UNRECOGNIZED_CHAIN_CODE) {
      await addNetwork(chainId, p);
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] });
      return;
    }
    throw err;
  }
}

/**
 * Request account access. Resolves to an array of checksummed addresses.
 * Triggers the wallet's connect UI if the site isn't already authorised.
 */
export async function connect(provider) {
  const p = getProvider(provider);
  return p.request({ method: 'eth_requestAccounts' });
}

/**
 * Read already-authorised accounts without triggering a connect prompt.
 * Returns `[]` when the user hasn't connected yet.
 */
export async function getAccounts(provider) {
  const p = getProvider(provider);
  return p.request({ method: 'eth_accounts' });
}

/**
 * Current chain ID as a number (not hex string). Returns NaN when the
 * provider has no chain connection yet.
 */
export async function getCurrentChainId(provider) {
  const p = getProvider(provider);
  const hex = await p.request({ method: 'eth_chainId' });
  return parseInt(hex, 16);
}

/**
 * Ask the wallet to track an ERC-20 in its UI (`wallet_watchAsset`).
 * Resolves to `true` if the user accepted, `false` otherwise.
 *
 * @param {object} args
 * @param {string} args.address
 * @param {string} args.symbol       2-11 chars, no lowercase in some wallets
 * @param {number} args.decimals
 * @param {string} [args.image]      HTTPS URL of a token logo (<64kb)
 */
export async function watchAsset({ address, symbol, decimals, image }, provider) {
  const p = getProvider(provider);
  return p.request({
    method: 'wallet_watchAsset',
    params: {
      type: 'ERC20',
      options: { address, symbol, decimals, ...(image ? { image } : {}) },
    },
  });
}

/**
 * Subscribe to wallet events. Returns an `off()` function that tears down
 * every listener at once. Pass only the events you care about.
 *
 * @param {object} handlers
 * @param {(accounts: string[]) => void} [handlers.onAccountsChanged]
 * @param {(chainIdHex: string) => void} [handlers.onChainChanged]
 * @param {(info: {code:number,message:string}) => void} [handlers.onDisconnect]
 * @param {object} [provider]
 * @returns {() => void}  unsubscribe
 */
export function onWalletEvents(handlers, provider) {
  const p = getProvider(provider);
  if (typeof p.on !== 'function') {
    throw new Error('wallet.onWalletEvents: provider does not support event subscription');
  }
  const cleanups = [];
  if (handlers.onAccountsChanged) {
    p.on('accountsChanged', handlers.onAccountsChanged);
    cleanups.push(() => p.removeListener?.('accountsChanged', handlers.onAccountsChanged));
  }
  if (handlers.onChainChanged) {
    p.on('chainChanged', handlers.onChainChanged);
    cleanups.push(() => p.removeListener?.('chainChanged', handlers.onChainChanged));
  }
  if (handlers.onDisconnect) {
    p.on('disconnect', handlers.onDisconnect);
    cleanups.push(() => p.removeListener?.('disconnect', handlers.onDisconnect));
  }
  return () => { cleanups.forEach((fn) => fn()); };
}
