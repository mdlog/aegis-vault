// CrossChainDepositCard
// ----------------------
// Self-contained UI for the "Step A" of a cross-chain vault deposit. The user
// picks a source chain + USDC token + amount, we ask Khalani / HyperStream for
// a quote, then drive the wallet through the resulting approval/deposit plan
// (chain switch -> ERC-20 approve(s) -> deposit tx). After the deposit tx is
// mined we register it with HyperStream, receive an orderId, and poll order
// status until the bridge fills (funds land in the user's 0G wallet) or fails.
//
// When the user is already on 0G mainnet (chainId 16661), this card hides
// itself entirely and the parent's existing direct-deposit flow takes over.
//
// Wallet integration uses raw `window.ethereum` because Khalani's deposit/build
// endpoint hands back EIP-1193 request payloads ({ method, params }) that we
// must forward verbatim — wagmi's higher-level hooks would need us to recreate
// chain configs for every supported source chain just to pass them through.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { ArrowDownToDot, Loader2, RefreshCw, X } from 'lucide-react';
import GlassPanel from '../ui/GlassPanel';
import SectionLabel from '../ui/SectionLabel';
import ControlButton from '../ui/ControlButton';
import {
  fetchSupportedChains,
  fetchSupportedTokens,
  fetchQuote,
  buildDeposit,
  submitDeposit,
  getOrderStatus,
} from '../../lib/khalani.js';

const ZERO_G_CHAIN_ID = 16661;
const POLL_INTERVAL_MS = 5000;
const TERMINAL_STATUSES = new Set(['filled', 'failed', 'refunded']);
const USDC_RX = /usdc/i;

function shortHash(h) {
  if (!h || typeof h !== 'string') return '';
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

function formatUnitsString(amountStr, decimals) {
  if (!amountStr) return '0';
  const s = String(amountStr);
  if (!decimals || decimals <= 0) return s;
  const pad = s.padStart(decimals + 1, '0');
  const whole = pad.slice(0, -decimals);
  const frac = pad.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

function toBaseUnits(humanAmount, decimals) {
  const [whole, frac = ''] = String(humanAmount).split('.');
  const fracPad = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const joined = `${whole || '0'}${fracPad}`.replace(/^0+(?=\d)/, '');
  return joined === '' ? '0' : joined;
}

function StatusPill({ status }) {
  const tone =
    status === 'filled' ? 'emerald'
      : status === 'failed' || status === 'refunded' ? 'rose'
        : status === 'refund_pending' ? 'amber'
          : 'cyan';
  const colors = {
    emerald: 'bg-[rgba(16,185,129,0.12)] text-[#8AE6C2] ring-[rgba(16,185,129,0.28)]',
    rose:    'bg-[rgba(225,29,72,0.12)] text-[#F4A0B3] ring-[rgba(225,29,72,0.32)]',
    amber:   'bg-[rgba(245,158,11,0.12)] text-[#F5C97E] ring-[rgba(245,158,11,0.28)]',
    cyan:    'bg-[rgba(76,201,240,0.10)] text-[#9AE2FA] ring-[rgba(76,201,240,0.28)]',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded ed-mono text-[10px] uppercase tracking-[0.18em] ring-1 ring-inset ${colors[tone]}`}>
      {status || 'idle'}
    </span>
  );
}

export default function CrossChainDepositCard({
  vaultAddress,
  baseAssetAddress,
  baseAssetSymbol = 'USDC',
  baseAssetDecimals = 6,
  onArrived,
}) {
  const { address: connectedAddress, chainId: connectedChainId, isConnected } = useAccount();

  // ── Reference data ────────────────────────────────────────────────────
  const [chains, setChains] = useState([]);
  const [chainsLoading, setChainsLoading] = useState(false);
  const [chainsError, setChainsError] = useState(null);

  const [tokens, setTokens] = useState([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState(null);

  // ── User selections ──────────────────────────────────────────────────
  const [sourceChainId, setSourceChainId] = useState(null);
  const [sourceTokenAddress, setSourceTokenAddress] = useState('');
  const [amountHuman, setAmountHuman] = useState('');

  // ── Flow state ───────────────────────────────────────────────────────
  // step: 'idle' | 'quoting' | 'quoted' | 'signing' | 'submitted' | 'tracking' | 'done' | 'error'
  const [step, setStep] = useState('idle');
  const [quote, setQuote] = useState(null);
  const [pickedRoute, setPickedRoute] = useState(null);
  const [depositTxHash, setDepositTxHash] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const [orderStatus, setOrderStatus] = useState(null);
  const [trackingStartTs, setTrackingStartTs] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState(null);

  // Used to stop the order-status poll on unmount or reset.
  const pollAbortRef = useRef(null);

  // Tick a clock while we're tracking, so the elapsed counter updates.
  useEffect(() => {
    if (step !== 'tracking' || !trackingStartTs) return undefined;
    const id = setInterval(() => setElapsedMs(Date.now() - trackingStartTs), 1000);
    return () => clearInterval(id);
  }, [step, trackingStartTs]);

  // Hide entirely on 0G mainnet — caller has a direct-deposit flow there.
  const onZeroG = connectedChainId === ZERO_G_CHAIN_ID;

  // ── Load supported chains once ───────────────────────────────────────
  useEffect(() => {
    if (onZeroG) return undefined;
    let aborted = false;
    setChainsLoading(true);
    setChainsError(null);
    fetchSupportedChains()
      .then((list) => {
        if (aborted) return;
        const filtered = (list || [])
          .filter((c) => c && c.id !== ZERO_G_CHAIN_ID)
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setChains(filtered);
        // Default: prefer Ethereum (1), then first.
        const preferred = filtered.find((c) => c.id === 1) || filtered[0];
        if (preferred) setSourceChainId(preferred.id);
      })
      .catch((e) => { if (!aborted) setChainsError(e.message || String(e)); })
      .finally(() => { if (!aborted) setChainsLoading(false); });
    return () => { aborted = true; };
  }, [onZeroG]);

  // ── Reload tokens whenever the source chain changes ──────────────────
  useEffect(() => {
    if (!sourceChainId) return undefined;
    let aborted = false;
    setTokensLoading(true);
    setTokensError(null);
    setTokens([]);
    setSourceTokenAddress('');
    fetchSupportedTokens(sourceChainId)
      .then((list) => {
        if (aborted) return;
        const usdcOnly = (list || []).filter((t) => t && USDC_RX.test(t.symbol || ''));
        setTokens(usdcOnly);
        if (usdcOnly[0]) setSourceTokenAddress(usdcOnly[0].address);
      })
      .catch((e) => { if (!aborted) setTokensError(e.message || String(e)); })
      .finally(() => { if (!aborted) setTokensLoading(false); });
    return () => { aborted = true; };
  }, [sourceChainId]);

  const selectedToken = useMemo(
    () => tokens.find((t) => t.address?.toLowerCase() === sourceTokenAddress?.toLowerCase()) || null,
    [tokens, sourceTokenAddress],
  );
  const sourceDecimals = selectedToken?.decimals ?? 6;

  const reset = useCallback(() => {
    if (pollAbortRef.current) {
      pollAbortRef.current.abort();
      pollAbortRef.current = null;
    }
    setStep('idle');
    setQuote(null);
    setPickedRoute(null);
    setDepositTxHash(null);
    setOrderId(null);
    setOrderStatus(null);
    setTrackingStartTs(null);
    setElapsedMs(0);
    setError(null);
  }, []);

  // Cancel any in-flight poll if we unmount.
  useEffect(() => () => {
    if (pollAbortRef.current) pollAbortRef.current.abort();
  }, []);

  // ── Step A.1: Get quote ──────────────────────────────────────────────
  const handleGetQuote = useCallback(async () => {
    if (!isConnected || !connectedAddress) {
      setError('Connect a wallet first.');
      setStep('error');
      return;
    }
    if (!sourceChainId || !sourceTokenAddress) {
      setError('Pick a source chain and token.');
      setStep('error');
      return;
    }
    if (!baseAssetAddress) {
      setError('Vault base asset not loaded yet — try again in a moment.');
      setStep('error');
      return;
    }
    const amtNum = Number(amountHuman);
    if (!Number.isFinite(amtNum) || amtNum <= 0) {
      setError('Enter an amount greater than 0.');
      setStep('error');
      return;
    }
    // Defence-in-depth: HTML5 `min`/`type=number` is bypassable from devtools,
    // and `Number(amountHuman)` silently coerces values like "1e308" to a
    // finite double that survives the `<= 0` check. Compute the on-chain base
    // units up front so we can reject anything that would overflow uint256
    // before we hand the string to a quote/build endpoint or to a wallet
    // signer that would only fail later with a less actionable error.
    const amount = toBaseUnits(amountHuman, sourceDecimals);
    let amountAsBigInt;
    try {
      amountAsBigInt = BigInt(amount);
    } catch {
      setError('Amount could not be parsed as an integer.');
      setStep('error');
      return;
    }
    const UINT256_MAX = (1n << 256n) - 1n;
    if (amountAsBigInt <= 0n || amountAsBigInt > UINT256_MAX) {
      setError('Amount is outside the on-chain valid range.');
      setStep('error');
      return;
    }
    setStep('quoting');
    setError(null);
    setQuote(null);
    setPickedRoute(null);
    try {
      const q = await fetchQuote({
        fromAddress: connectedAddress,
        fromChainId: sourceChainId,
        fromToken: sourceTokenAddress,
        toChainId: ZERO_G_CHAIN_ID,
        toToken: baseAssetAddress,
        amount,
        tradeType: 'EXACT_INPUT',
      });
      const route = q?.routes?.[0];
      if (!route) throw new Error('No routes returned for this pair.');
      setQuote(q);
      setPickedRoute(route);
      setStep('quoted');
    } catch (e) {
      setError(e.message || String(e));
      setStep('error');
    }
  }, [isConnected, connectedAddress, sourceChainId, sourceTokenAddress, amountHuman, sourceDecimals, baseAssetAddress]);

  // ── Step A.2: build + sign + submit ──────────────────────────────────
  const handleSignAndSend = useCallback(async () => {
    if (!quote || !pickedRoute) return;
    if (typeof window === 'undefined' || !window.ethereum) {
      setError('No injected wallet (window.ethereum) found.');
      setStep('error');
      return;
    }
    setStep('signing');
    setError(null);
    try {
      const plan = await buildDeposit({
        from: connectedAddress,
        quoteId: quote.quoteId,
        routeId: pickedRoute.routeId,
      });
      const approvals = Array.isArray(plan?.approvals) ? plan.approvals : [];
      let lastDepositHash = null;

      for (const action of approvals) {
        if (action?.type !== 'eip1193_request' || !action.request?.method) {
          continue;
        }
        const { method, params } = action.request;
        // Forward verbatim to the injected provider. waitForReceipt + deposit
        // tags only matter for eth_sendTransaction; chain switches resolve
        // synchronously enough that we don't poll for them.
        const result = await window.ethereum.request({ method, params: params || [] });
        if (method === 'eth_sendTransaction') {
          const txHash = typeof result === 'string' ? result : result?.hash || result;
          if (action.deposit && txHash) lastDepositHash = txHash;
          if (action.waitForReceipt && txHash) {
            await waitForReceiptViaProvider(window.ethereum, txHash);
          }
        }
      }

      if (!lastDepositHash) {
        throw new Error('Deposit plan executed but no deposit tx hash captured.');
      }
      setDepositTxHash(lastDepositHash);
      setStep('submitted');

      const submitRes = await submitDeposit({
        txHash: lastDepositHash,
        quoteId: quote.quoteId,
        routeId: pickedRoute.routeId,
      });
      if (!submitRes?.orderId) throw new Error('submitDeposit returned no orderId.');
      setOrderId(submitRes.orderId);
      setTrackingStartTs(Date.now());
      setStep('tracking');
    } catch (e) {
      // EIP-1193 user-rejected: code 4001
      const msg = e?.code === 4001
        ? 'Wallet request was rejected.'
        : (e?.message || String(e));
      setError(msg);
      setStep('error');
    }
  }, [quote, pickedRoute, connectedAddress]);

  // ── Step A.3: poll order status until terminal ───────────────────────
  useEffect(() => {
    if (step !== 'tracking' || !orderId || !connectedAddress) return undefined;
    let cancelled = false;
    const ac = new AbortController();
    pollAbortRef.current = ac;

    const tick = async () => {
      try {
        const res = await getOrderStatus(connectedAddress, orderId, { signal: ac.signal });
        const order = res?.data?.[0];
        const status = order?.status;
        if (cancelled) return;
        if (status) setOrderStatus(status);
        if (status && TERMINAL_STATUSES.has(status)) {
          if (status === 'filled') {
            setStep('done');
            const out = pickedRoute?.quote?.amountOut;
            if (typeof onArrived === 'function') {
              try { onArrived(out); } catch { /* swallow consumer errors */ }
            }
          } else {
            setError(`Order ${status}.`);
            setStep('error');
          }
          return;
        }
      } catch (e) {
        if (cancelled || ac.signal.aborted) return;
        // Transient errors: keep polling. Surface only persistent failures.
        console.warn('[CrossChainDepositCard] order poll error:', e?.message || e);
      }
      if (!cancelled) setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      ac.abort();
      if (pollAbortRef.current === ac) pollAbortRef.current = null;
    };
  }, [step, orderId, connectedAddress, pickedRoute, onArrived]);

  if (onZeroG) return null;

  // ── Render ────────────────────────────────────────────────────────────
  const amountInDisplay = pickedRoute?.quote?.amountIn
    ? formatUnitsString(pickedRoute.quote.amountIn, sourceDecimals)
    : null;
  const amountOutDisplay = pickedRoute?.quote?.amountOut
    ? formatUnitsString(pickedRoute.quote.amountOut, baseAssetDecimals)
    : null;
  const feePct = pickedRoute?.quote?.amountIn && pickedRoute?.quote?.amountOut
    ? (() => {
      // Both legs are USD-pegged stables here, so a raw amountIn vs amountOut
      // ratio is a reasonable "all-in cost" surface (bridge + fill + slippage).
      const inHuman = Number(formatUnitsString(pickedRoute.quote.amountIn, sourceDecimals));
      const outHuman = Number(formatUnitsString(pickedRoute.quote.amountOut, baseAssetDecimals));
      if (!Number.isFinite(inHuman) || !Number.isFinite(outHuman) || inHuman <= 0) return null;
      return (((inHuman - outHuman) / inHuman) * 100).toFixed(3);
    })()
    : null;

  const elapsedSec = Math.floor(elapsedMs / 1000);
  const expectedSec = pickedRoute?.quote?.expectedDurationSeconds;

  const isBusy = step === 'quoting' || step === 'signing' || step === 'submitted' || step === 'tracking';

  return (
    <div>
      <SectionLabel color="text-steel/50">Cross-chain deposit</SectionLabel>
      <GlassPanel className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="ed-mono text-[10.5px] uppercase tracking-[0.22em] text-white/55">
              Bridge USDC → vault asset on 0G
            </p>
            <p className="ed-mono text-[10px] text-white/35 mt-1">
              Powered by Khalani · destination {baseAssetSymbol}
            </p>
          </div>
          {step !== 'idle' && (
            <button
              type="button"
              onClick={reset}
              className="text-white/40 hover:text-white/80 transition"
              title="Reset"
              aria-label="Reset cross-chain deposit"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Source chain dropdown */}
        <div>
          <label htmlFor="ccd-chain" className="block text-[9px] font-mono tracking-[0.18em] uppercase text-white/45 mb-1.5">
            Source chain
          </label>
          <select
            id="ccd-chain"
            value={sourceChainId ?? ''}
            onChange={(e) => setSourceChainId(Number(e.target.value))}
            disabled={chainsLoading || isBusy}
            className="w-full px-3 py-2 rounded-md bg-black/30 ring-1 ring-inset ring-white/10 text-white text-xs font-mono focus:outline-none focus:ring-white/30 disabled:opacity-60"
          >
            {chainsLoading && <option>Loading chains…</option>}
            {!chainsLoading && chains.length === 0 && <option>No chains available</option>}
            {chains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (id {c.id})
              </option>
            ))}
          </select>
          {chainsError && <p className="mt-1 text-[10px] font-mono text-[#F4A0B3]">{chainsError}</p>}
        </div>

        {/* Source token dropdown (USDC variants only) */}
        <div>
          <label htmlFor="ccd-token" className="block text-[9px] font-mono tracking-[0.18em] uppercase text-white/45 mb-1.5">
            Source token (USDC)
          </label>
          <select
            id="ccd-token"
            value={sourceTokenAddress}
            onChange={(e) => setSourceTokenAddress(e.target.value)}
            disabled={tokensLoading || tokens.length === 0 || isBusy}
            className="w-full px-3 py-2 rounded-md bg-black/30 ring-1 ring-inset ring-white/10 text-white text-xs font-mono focus:outline-none focus:ring-white/30 disabled:opacity-60"
          >
            {tokensLoading && <option>Loading tokens…</option>}
            {!tokensLoading && tokens.length === 0 && <option>No USDC available on this chain</option>}
            {tokens.map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol} · {t.name}
              </option>
            ))}
          </select>
          {tokensError && <p className="mt-1 text-[10px] font-mono text-[#F4A0B3]">{tokensError}</p>}
        </div>

        {/* Amount */}
        <div>
          <label htmlFor="ccd-amount" className="block text-[9px] font-mono tracking-[0.18em] uppercase text-white/45 mb-1.5">
            Amount ({selectedToken?.symbol || 'USDC'})
          </label>
          <input
            id="ccd-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.000001"
            value={amountHuman}
            onChange={(e) => setAmountHuman(e.target.value)}
            placeholder="0.00"
            disabled={isBusy}
            className="w-full px-3 py-2 rounded-md bg-black/30 ring-1 ring-inset ring-white/10 text-white font-mono text-sm focus:outline-none focus:ring-white/30 disabled:opacity-60"
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <ControlButton
            variant="primary"
            className="flex-1"
            onClick={handleGetQuote}
            disabled={isBusy || !isConnected || !sourceChainId || !sourceTokenAddress || !amountHuman}
          >
            {step === 'quoting' ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Quoting…</>) : (<><RefreshCw className="w-3.5 h-3.5" /> Get quote</>)}
          </ControlButton>
          <ControlButton
            variant="gold"
            className="flex-1"
            onClick={handleSignAndSend}
            disabled={step !== 'quoted'}
          >
            {step === 'signing' || step === 'submitted' ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Signing…</>) : (<><ArrowDownToDot className="w-3.5 h-3.5" /> Sign & send</>)}
          </ControlButton>
        </div>

        {!isConnected && (
          <p className="text-[10px] font-mono text-white/45">Connect a wallet to bridge funds to your 0G address.</p>
        )}

        {/* Quote panel */}
        {pickedRoute && (
          <div className="rounded-md bg-black/20 ring-1 ring-inset ring-white/[0.06] p-3 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono text-white/55 uppercase tracking-[0.18em]">
              <span>Quote</span>
              <StatusPill status={orderStatus || step} />
            </div>
            <div className="grid grid-cols-2 gap-y-1 text-[11px] font-mono">
              <span className="text-white/40">You send</span>
              <span className="text-right text-white">{amountInDisplay} {selectedToken?.symbol || 'USDC'}</span>
              <span className="text-white/40">You receive</span>
              <span className="text-right text-white">{amountOutDisplay} {baseAssetSymbol}</span>
              <span className="text-white/40">Bridge cost</span>
              <span className="text-right text-white">{feePct != null ? `${feePct}%` : '—'}</span>
              <span className="text-white/40">Est. duration</span>
              <span className="text-right text-white">{expectedSec ? `${expectedSec}s` : '—'}</span>
            </div>
          </div>
        )}

        {/* Tracking panel */}
        {(orderId || depositTxHash) && (
          <div className="rounded-md bg-black/20 ring-1 ring-inset ring-white/[0.06] p-3 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono text-white/55 uppercase tracking-[0.18em]">
              <span>Order</span>
              <StatusPill status={orderStatus || step} />
            </div>
            <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10.5px] font-mono">
              {depositTxHash && (
                <>
                  <span className="text-white/40">Source tx</span>
                  <span className="text-white truncate" title={depositTxHash}>{shortHash(depositTxHash)}</span>
                </>
              )}
              {orderId && (
                <>
                  <span className="text-white/40">Order id</span>
                  <span className="text-white truncate" title={orderId}>{orderId}</span>
                </>
              )}
              {step === 'tracking' && (
                <>
                  <span className="text-white/40">Elapsed</span>
                  <span className="text-white">{elapsedSec}s{expectedSec ? ` / ~${expectedSec}s` : ''}</span>
                </>
              )}
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="rounded-md bg-[rgba(16,185,129,0.08)] ring-1 ring-inset ring-[rgba(16,185,129,0.28)] p-3 text-[11px] font-mono text-[#8AE6C2]">
            Funds arrived on 0G. Continue with “Approve & deposit” in the standard flow above.
          </div>
        )}

        {step === 'error' && error && (
          <div className="rounded-md bg-[rgba(225,29,72,0.08)] ring-1 ring-inset ring-[rgba(225,29,72,0.32)] p-3 text-[11px] font-mono text-[#F4A0B3]">
            {error}
          </div>
        )}

        {/* Hidden but valid: prove vaultAddress is part of the contract for
            future targeting (we rely on baseAssetAddress for routing today). */}
        {vaultAddress && (
          <p className="text-[9px] font-mono text-white/25 truncate">
            Destination vault: <span title={vaultAddress}>{shortHash(vaultAddress)}</span>
          </p>
        )}
      </GlassPanel>
    </div>
  );
}

// Poll for a tx receipt via the injected provider only — keeps us off any
// pre-configured viem chain list (Khalani supports 18 chains, we don't want
// to maintain that list in the frontend just to sniff a confirmation).
async function waitForReceiptViaProvider(provider, txHash, { intervalMs = 4000, timeoutMs = 5 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await provider.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
      if (r && r.blockNumber) return r;
    } catch {
      // ignore transient RPC errors and retry
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  throw new Error(`Timed out waiting for receipt: ${txHash}`);
}
