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

/**
 * Mainnet chains use real canonical tokens that do not expose a public mint().
 * On those chains the faucet would only be a misleading UI, so we route the
 * page to an info panel that tells users how to actually acquire tokens.
 */
const MAINNET_TOKEN_GUIDES = {
  16661: {
    label: '0G Aristotle Mainnet',
    intro: 'Vault base asset on 0G is the real Jaine-pair USDC.e. Swap some native 0G for USDC.e to deposit into a vault.',
    actions: [
      { label: 'Swap 0G → USDC.e on Jaine', href: 'https://jaine.app/swap', primary: true },
      { label: 'Jaine liquidity pools', href: 'https://jaine.app/liquidity' },
    ],
    addresses: [
      { label: 'USDC.e', addr: '0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E' },
      { label: 'WETH',   addr: '0x564770837Ef8bbF077cFe54E5f6106538c815B22' },
      { label: 'WBTC',   addr: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c' },
      { label: 'W0G',    addr: '0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c' },
    ],
  },
  42161: {
    label: 'Arbitrum One',
    intro: 'Vault base asset on Arbitrum is canonical Circle USDC. Acquire it via Uniswap V3 or withdraw directly from a centralized exchange on the Arbitrum network.',
    actions: [
      { label: 'Swap ETH → USDC on Uniswap', href: 'https://app.uniswap.org/#/swap', primary: true },
      { label: 'Bridge assets to Arbitrum', href: 'https://bridge.arbitrum.io' },
    ],
    addresses: [
      { label: 'USDC', addr: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
      { label: 'WETH', addr: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' },
      { label: 'WBTC', addr: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f' },
    ],
  },
};

export default function FaucetPage() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const mainnetGuide = MAINNET_TOKEN_GUIDES[chainId];

  // Mainnet: tokens are real canonical assets without a public mint().
  // Render an info panel instead of broken mint buttons.
  if (mainnetGuide) {
    return (
      <div className="max-w-2xl mx-auto pt-10">
        <div className="mb-8">
          <div className="flex items-baseline gap-3.5 mb-2">
            <span className="ed-eyebrow">§ F.01</span>
            <span className="ed-mono text-[10.5px] tracking-[0.22em] uppercase" style={{ color: 'var(--ed-steel-400)' }}>
              How to acquire tokens
            </span>
          </div>
          <h1 className="ed-display" style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, margin: 0 }}>
            Real tokens on <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>{mainnetGuide.label}.</span>
          </h1>
          <p className="text-[13px] mt-3" style={{ color: 'var(--ed-steel-400)', lineHeight: 1.55 }}>
            {mainnetGuide.intro} No faucet — these are real canonical assets without a public <code className="font-mono text-[11px]">mint()</code>.
          </p>
        </div>

        <GlassPanel className="p-6 mb-4">
          <div className="flex flex-col gap-3">
            {mainnetGuide.actions.map((a) => (
              <a
                key={a.href}
                href={a.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-between gap-3 p-3 rounded-md border transition-colors
                  ${a.primary
                    ? 'bg-gold/10 border-gold/30 hover:bg-gold/15 text-gold'
                    : 'border-white/[0.08] hover:border-white/20 text-white/70 hover:text-white'}`}
              >
                <span className="text-sm font-display">{a.label}</span>
                <ExternalLink className="w-4 h-4 opacity-70" />
              </a>
            ))}
          </div>
        </GlassPanel>

        <GlassPanel className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-steel/40 mb-3">Canonical token addresses</div>
          <div className="space-y-2">
            {mainnetGuide.addresses.map((t) => (
              <div key={t.addr} className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-white/80 w-16">{t.label}</span>
                <span className="text-steel/60 break-all">{t.addr}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[10px] text-steel/40 text-center">
            Import into MetaMask: <em>Import Token</em> → paste address → set decimals to match ({mainnetGuide.label === '0G Aristotle Mainnet' ? '6 / 18 / 8 / 18' : '6 / 18 / 8'}).
          </p>
        </GlassPanel>
      </div>
    );
  }

  // Testnet / local: keep the original mock-token mint flow.
  const tokens = [
    { symbol: 'mUSDC', address: deployments.mockUSDC, ...MINT_AMOUNTS.mUSDC },
    { symbol: 'mWBTC', address: deployments.mockWBTC, ...MINT_AMOUNTS.mWBTC },
    { symbol: 'mWETH', address: deployments.mockWETH, ...MINT_AMOUNTS.mWETH },
  ].filter(t => t.address);

  return (
    <div className="max-w-2xl mx-auto pt-10">
      <div className="mb-8">
        <div className="flex items-baseline gap-3.5 mb-2">
          <span className="ed-eyebrow">§ F.01</span>
          <span
            className="ed-mono text-[10.5px] tracking-[0.22em] uppercase"
            style={{ color: 'var(--ed-steel-400)' }}
          >
            Testnet spigot
          </span>
        </div>
        <h1
          className="ed-display"
          style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, margin: 0 }}
        >
          Mint mock tokens, <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>for testing.</span>
        </h1>
        <p className="text-[13px] mt-3" style={{ color: 'var(--ed-steel-400)', lineHeight: 1.55 }}>
          Demo tokens deployed on this testnet — no real value. Use them to create vaults, deposit, and exercise the
          full flow end-to-end.
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
