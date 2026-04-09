import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain, useBalance, useReadContracts } from 'wagmi';
import { useState } from 'react';
import { formatUnits } from 'viem';
import { arbitrumOne, ogMainnet, ogTestnet } from '../../lib/wagmiConfig';
import { getDeployments, getNetworkLabel, MockERC20ABI } from '../../lib/contracts';
import TokenIcon from './TokenIcon';

const SUPPORTED_CHAIN_IDS = new Set([ogMainnet.id, arbitrumOne.id, ogTestnet.id, 31337]);
const DEFAULT_SWITCH_CHAIN_ID = import.meta.env.VITE_DISABLE_TESTNETS === '1' ? ogMainnet.id : ogTestnet.id;

export default function WalletButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const deployments = getDeployments(chainId);

  // Native balance (A0GI / ETH)
  const { data: nativeBalance } = useBalance({ address, query: { enabled: isConnected } });

  // Token balances via multicall
  const tokenList = [
    { symbol: 'USDC', address: deployments.mockUSDC, decimals: 6 },
    { symbol: 'WBTC', address: deployments.mockWBTC, decimals: 8 },
    { symbol: 'WETH', address: deployments.mockWETH, decimals: 18 },
  ].filter(t => !!t.address);

  const balanceContracts = tokenList.map(t => ({
    address: t.address,
    abi: MockERC20ABI,
    functionName: 'balanceOf',
    args: [address],
  }));

  const { data: tokenBalances } = useReadContracts({
    contracts: balanceContracts,
    query: { enabled: isConnected && !!address && tokenList.length > 0, refetchInterval: 15000 },
  });

  if (!isConnected) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={() => {
            const mm = connectors.find(c => c.id === 'metaMaskSDK' || c.id === 'metaMask' || c.id === 'injected');
            if (mm) {
              connect({ connector: mm });
            } else if (connectors.length > 0) {
              connect({ connector: connectors[0] });
            }
          }}
          disabled={isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium tracking-[0.08em] uppercase
            bg-gold/10 text-gold border border-gold/20
            hover:bg-gold/20 hover:border-gold/40 transition-all duration-300
            disabled:opacity-50"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
          </svg>
          {isPending ? 'Connecting...' : 'Connect Wallet'}
        </button>
        {connectError && (
          <span className="text-[9px] text-red-warn/70 max-w-[220px] text-right">
            {connectError.message?.includes('rejected') ? 'Connection rejected by user'
              : connectError.message?.includes('provider') ? 'No wallet detected — install MetaMask'
              : 'Connection failed — try again'}
          </span>
        )}
      </div>
    );
  }

  const isWrongChain = chain ? !SUPPORTED_CHAIN_IDS.has(chain.id) : false;
  const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const chainName = getNetworkLabel(chainId);

  return (
    <div className="relative flex items-center gap-2">
      {isWrongChain && (
        <button
          onClick={() => switchChain({ chainId: DEFAULT_SWITCH_CHAIN_ID })}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-mono
            bg-amber-warn/10 text-amber-warn border border-amber-warn/20
            hover:bg-amber-warn/20 transition-all"
        >
          Switch Network
        </button>
      )}

      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06]
          hover:border-white/[0.12] transition-all text-xs text-white/60"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isWrongChain ? 'bg-amber-warn' : 'bg-emerald-soft'}`} />
        <span className="font-mono">{shortAddr}</span>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute top-full right-0 mt-1 w-72 rounded-lg py-2 z-50 shadow-2xl bg-[#13131a] border border-white/[0.08]">
            {/* Network */}
            <div className="px-3 py-1.5 text-[10px] font-mono text-steel/40 border-b border-white/[0.04]">
              {chainName} ({chainId})
            </div>

            {/* Full address + copy icon */}
            <div className="px-3 py-2 border-b border-white/[0.04] flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono text-white/50 break-all">{address}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center
                  hover:bg-white/[0.06] transition-colors text-steel/40 hover:text-white/70"
                title="Copy address"
              >
                {copied ? (
                  <svg className="w-3.5 h-3.5 text-emerald-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                  </svg>
                )}
              </button>
            </div>

            {/* Native balance */}
            {nativeBalance && (
              <div className="px-3 py-2 border-b border-white/[0.04]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-steel/50">Native</span>
                  <span className="text-[11px] font-mono text-white/70">
                    {nativeBalance.formatted
                      ? parseFloat(nativeBalance.formatted).toFixed(4)
                      : nativeBalance.value !== undefined
                        ? (Number(nativeBalance.value) / 1e18).toFixed(4)
                        : '0.0000'
                    } {nativeBalance.symbol || '0G'}
                  </span>
                </div>
              </div>
            )}

            {/* Token balances */}
            {tokenList.length > 0 && (
              <div className="px-3 py-2 space-y-1.5 border-b border-white/[0.04]">
                <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/30">Token Balances</span>
                {tokenList.map((t, i) => {
                  const raw = tokenBalances?.[i]?.result;
                  const bal = raw ? parseFloat(formatUnits(raw, t.decimals)) : 0;
                  return (
                    <div key={t.symbol} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <TokenIcon symbol={t.symbol} size={14} />
                        <span className="text-[11px] text-steel/60">{t.symbol}</span>
                      </div>
                      <span className="text-[11px] font-mono text-white/70">
                        {t.symbol === 'USDC'
                          ? bal.toLocaleString(undefined, { maximumFractionDigits: 2 })
                          : bal.toLocaleString(undefined, { maximumFractionDigits: 6 })
                        }
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Actions */}
            {chain?.id === 31337 && (
              <button
                onClick={() => { switchChain({ chainId: DEFAULT_SWITCH_CHAIN_ID }); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-cyan/60 hover:text-cyan hover:bg-white/[0.02] transition-colors text-left"
              >
                Switch to {DEFAULT_SWITCH_CHAIN_ID === ogMainnet.id ? '0G Aristotle' : '0G Galileo'}
              </button>
            )}
            <button
              onClick={() => { disconnect(); setMenuOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-red-warn/70 hover:text-red-warn hover:bg-white/[0.02] transition-colors text-left"
            >
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
