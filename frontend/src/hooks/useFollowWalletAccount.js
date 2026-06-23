import { useEffect, useRef } from 'react';
import { useAccount, useReconnect, useDisconnect } from 'wagmi';

/**
 * Auto-follow the account currently selected in the injected wallet (MetaMask):
 * when the active account changes, the app's connected account changes with it.
 *
 * wagmi's injected connector emits `accountsChanged` natively and updates
 * `useAccount()` on its own. As a robust safety net we also attach our own
 * provider listener and, if the store hasn't already moved to the newly-selected
 * account after a short settle, call `reconnect()`.
 *
 * `reconnect()` is the CORRECT primitive here: it re-runs the connector's
 * `getAccounts()` and overwrites the connection's accounts with the wallet's
 * current selection. `connect()` would instead throw
 * `ConnectorAlreadyConnectedError` on an already-connected connector.
 *
 * IMPORTANT — MetaMask permission model: MetaMask only fires `accountsChanged`
 * for accounts that are already CONNECTED/permitted to this site. Switching to
 * an account that has never connected here emits nothing, so the app cannot
 * follow it automatically. To auto-follow such an account, connect it to the
 * site once (e.g. via the wallet menu's "Switch account" → select the account
 * in MetaMask). After that, switching between connected accounts auto-follows.
 *
 * Mount once, high in the tree (App), inside the Wagmi + QueryClient providers.
 */
export function useFollowWalletAccount() {
  const { address, status, connector } = useAccount();
  const { reconnect } = useReconnect();
  const { disconnect } = useDisconnect();

  // Latest values, read inside a stable listener (subscribe once). Updated in an
  // effect — never during render.
  const ref = useRef({});
  useEffect(() => {
    ref.current = { address, status, connector, reconnect, disconnect };
  });

  useEffect(() => {
    const provider = typeof window !== 'undefined' ? window.ethereum : null;
    if (!provider || typeof provider.on !== 'function') return undefined;

    let cancelled = false;

    const onAccountsChanged = (accounts) => {
      const next = Array.isArray(accounts) ? accounts[0] : undefined;

      // Let wagmi's own injected handler settle first; only force a re-sync if
      // it didn't already move the store to the newly-selected account.
      window.setTimeout(() => {
        if (cancelled) return;
        const {
          address: current, status: st, connector: active,
          reconnect: doReconnect, disconnect: doDisconnect,
        } = ref.current;

        if (!next) {
          // Wallet locked / all accounts revoked for this site.
          if (st === 'connected') doDisconnect();
          return;
        }
        // Don't interfere with an initial connect / reconnect in flight.
        if (st !== 'connected') return;
        // Already in sync — wagmi's native handler did the work.
        if (current && current.toLowerCase() === next.toLowerCase()) return;

        // Force wagmi to re-derive the active account from the wallet.
        doReconnect(active ? { connectors: [active] } : undefined);
      }, 120);
    };

    provider.on('accountsChanged', onAccountsChanged);
    return () => {
      cancelled = true;
      provider.removeListener?.('accountsChanged', onAccountsChanged);
    };
  }, []);
}
