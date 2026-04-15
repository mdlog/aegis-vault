import { useState } from 'react';
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { useReadContract } from 'wagmi';
import { getDeployments, MockERC20ABI } from '../lib/contracts';
import GlassPanel from '../components/ui/GlassPanel';
import ControlButton from '../components/ui/ControlButton';
import StatusPill from '../components/ui/StatusPill';
import { Droplets, Coins, Copy, CheckCircle, ExternalLink } from 'lucide-react';

const MINT_AMOUNTS = {
  mUSDC: { amount: '50000', decimals: 6, label: '50,000 mUSDC' },
  mWBTC: { amount: '1', decimals: 8, label: '1 mWBTC' },
  mWETH: { amount: '10', decimals: 18, label: '10 mWETH' },
};

function TokenCard({ symbol, tokenAddress, decimals, mintLabel, mintAmount }) {
  const { address } = useAccount();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { data: balance } = useReadContract({
    address: tokenAddress,
    abi: MockERC20ABI,
    functionName: 'balanceOf',
    args: [address],
    query: { enabled: !!address && !!tokenAddress, refetchInterval: 5000 },
  });

  const handleMint = () => {
    writeContract({
      address: tokenAddress,
      abi: MockERC20ABI,
      functionName: 'mint',
      args: [address, parseUnits(mintAmount, decimals)],
    });
  };

  const formattedBalance = balance !== undefined
    ? parseFloat(formatUnits(balance, decimals)).toLocaleString(undefined, { maximumFractionDigits: decimals > 8 ? 4 : decimals })
    : '—';

  const [copied, setCopied] = useState(false);
  const copyAddress = () => {
    navigator.clipboard.writeText(tokenAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <GlassPanel className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gold/10 flex items-center justify-center">
            <Coins className="w-5 h-5 text-gold" />
          </div>
          <div>
            <h3 className="text-sm font-display font-semibold text-white">{symbol}</h3>
            <button onClick={copyAddress} className="flex items-center gap-1 text-[10px] font-mono text-steel/40 hover:text-steel/70 transition-colors">
              {tokenAddress.slice(0, 8)}...{tokenAddress.slice(-6)}
              {copied ? <CheckCircle className="w-3 h-3 text-emerald-soft" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        </div>
        <StatusPill label={`${decimals} decimals`} variant="info" />
      </div>

      <div className="flex items-center justify-between py-3 border-t border-b border-white/[0.04] mb-4">
        <span className="text-xs text-steel/50">Your Balance</span>
        <span className="text-sm font-mono font-semibold text-white">{formattedBalance}</span>
      </div>

      <ControlButton
        variant="primary"
        className="w-full"
        disabled={isPending || confirming || !address}
        onClick={handleMint}
      >
        <Droplets className="w-4 h-4" />
        {isPending ? 'Confirm in wallet...' : confirming ? 'Minting...' : isSuccess ? 'Minted!' : `Mint ${mintLabel}`}
      </ControlButton>

      {isSuccess && hash && (
        <a
          href={`https://chainscan.0g.ai/tx/${hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 mt-3 text-[10px] font-mono text-cyan/50 hover:text-cyan/80 transition-colors"
        >
          View on explorer <ExternalLink className="w-3 h-3" />
        </a>
      )}

      {error && (
        <p className="mt-3 text-[10px] text-red-warn/70 break-all">
          {error.shortMessage || error.message}
        </p>
      )}
    </GlassPanel>
  );
}

export default function FaucetPage() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);

  const tokens = [
    { symbol: 'mUSDC', address: deployments.mockUSDC, ...MINT_AMOUNTS.mUSDC },
    { symbol: 'mWBTC', address: deployments.mockWBTC, ...MINT_AMOUNTS.mWBTC },
    { symbol: 'mWETH', address: deployments.mockWETH, ...MINT_AMOUNTS.mWETH },
  ].filter(t => t.address);

  return (
    <div className="max-w-2xl mx-auto pt-10">
      <div className="mb-8">
        <h1 className="text-2xl font-display font-bold text-white mb-2">Token Faucet</h1>
        <p className="text-sm text-steel/50">
          Mint mock tokens for testing. These are demo tokens deployed on 0G mainnet — no real value.
        </p>
      </div>

      {!isConnected ? (
        <GlassPanel className="p-8 text-center">
          <Droplets className="w-8 h-8 text-steel/30 mx-auto mb-3" />
          <p className="text-sm text-steel/50">Connect your wallet to mint tokens</p>
        </GlassPanel>
      ) : (
        <div className="space-y-4">
          {tokens.map(t => (
            <TokenCard
              key={t.symbol}
              symbol={t.symbol}
              tokenAddress={t.address}
              decimals={t.decimals}
              mintLabel={t.label}
              mintAmount={t.amount}
            />
          ))}

          <GlassPanel className="p-4">
            <p className="text-[11px] text-steel/40 text-center">
              After minting, add tokens to MetaMask: Import Token → paste contract address above.
              Then deposit into your vault from the Vault Detail page.
            </p>
          </GlassPanel>
        </div>
      )}
    </div>
  );
}
