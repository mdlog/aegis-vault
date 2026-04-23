import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ExternalLink,
  BookOpen,
  Rocket,
  Layers,
  FileCode2,
  Terminal,
  Wallet,
  Cpu,
  ShieldCheck,
  LinkIcon,
  Copy,
  Check,
} from 'lucide-react';
import Logo from '../components/ui/Logo';
import generatedDeployments from '../lib/deployments.generated.json';

const SECTIONS = [
  { id: 'introduction', label: 'Introduction', icon: BookOpen },
  { id: 'quick-start', label: 'Quick Start', icon: Rocket },
  { id: 'architecture', label: 'Architecture', icon: Layers },
  { id: 'contracts', label: 'Contracts', icon: FileCode2 },
  { id: 'api', label: 'API Reference', icon: Terminal },
  { id: 'user-guide', label: 'User Guide', icon: Wallet },
  { id: 'operator-guide', label: 'Operator Guide', icon: Cpu },
  { id: 'trust-model', label: 'Trust Model', icon: ShieldCheck },
  { id: 'resources', label: 'Resources', icon: LinkIcon },
];

const EXPLORERS = {
  16661: 'https://chainscan.0g.ai/address/',
  42161: 'https://arbiscan.io/address/',
};

function explorerHref(addr, chainId = 16661) {
  if (!addr) return null;
  const base = EXPLORERS[chainId] || EXPLORERS[16661];
  return `${base}${addr}`;
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-white/[0.06] transition-colors"
      title="Copy address"
    >
      {copied ? (
        <Check className="w-3 h-3 text-emerald-400" />
      ) : (
        <Copy className="w-3 h-3 text-steel-400" />
      )}
    </button>
  );
}

function AddressRow({ label, address, description, chainId = 16661 }) {
  const href = explorerHref(address, chainId);
  const missing = !address;
  return (
    <tr className="border-t border-white/[0.04]">
      <td className="py-2.5 pr-4 align-top">
        <div className="text-[13px] text-steel-100">{label}</div>
        {description && (
          <div className="text-[11px] text-steel-500 leading-relaxed mt-0.5">{description}</div>
        )}
      </td>
      <td className="py-2.5 align-top">
        {missing ? (
          <span className="text-[11px] font-mono text-steel-600">— not deployed —</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-cyan-300/80 hover:text-cyan-300 break-all"
            >
              {address}
            </a>
            <CopyButton value={address} />
          </div>
        )}
      </td>
    </tr>
  );
}

function SectionHeader({ id, number, label, title, subtitle }) {
  return (
    <header className="mb-6">
      <div className="flex items-baseline gap-3 mb-2">
        <span
          className="ed-mono"
          style={{ fontSize: 10, color: 'var(--ed-gold)', letterSpacing: '0.22em' }}
        >
          § {number} · {label.toUpperCase()}
        </span>
      </div>
      <h2
        id={id}
        className="ed-display scroll-mt-24"
        style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.03em', margin: 0, lineHeight: 1.1 }}
      >
        {title}
      </h2>
      {subtitle && (
        <p className="text-[14px] text-steel-400 mt-3 max-w-2xl leading-relaxed">{subtitle}</p>
      )}
    </header>
  );
}

export default function DocsPage() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);

  const mainnet = generatedDeployments['16661'] || {};
  const arbitrum = generatedDeployments['42161'] || {};

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: [0, 0.25, 0.5, 1] }
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const apiEndpoints = useMemo(
    () => [
      { method: 'GET', path: '/api/health', desc: 'Liveness probe. Returns 200 when the orchestrator process is up.' },
      { method: 'GET', path: '/api/status', desc: 'Orchestrator state: running flag, executor address, cycle count, managed vaults.' },
      { method: 'POST', path: '/api/cycle', desc: 'Manually trigger a decision cycle. Auth required (API key or localhost).' },
      { method: 'GET', path: '/api/vault', desc: 'Read vault on-chain state: NAV, policy, executor, paused status.' },
      { method: 'GET', path: '/api/market', desc: 'Latest market prices (BTC / ETH / USDC) from Pyth + venue fallbacks.' },
      { method: 'GET', path: '/api/market/summary', desc: 'Full market summary incl. regime, RSI, ATR, MACD.' },
      { method: 'GET', path: '/api/journal', desc: 'Decision + execution + policy journal (paginated). Filter by vault, type, level.' },
      { method: 'GET', path: '/api/journal/decisions', desc: 'AI decisions only (buy / sell / hold with confidence + edge score).' },
      { method: 'GET', path: '/api/journal/executions', desc: 'On-chain execution log with tx hashes + duration.' },
      { method: 'GET', path: '/api/alerts', desc: 'Alerts + pending approval-tier trades.' },
      { method: 'GET', path: '/api/og-compute/models', desc: 'Available AI models advertised by 0G Compute network.' },
      { method: 'GET', path: '/api/og/status', desc: '0G Storage state: ready / disabled + indexer mode.' },
      { method: 'GET', path: '/api/og/state', desc: 'Local KV state mirror (totals, last signal, last execution).' },
      { method: 'GET', path: '/api/pyth/prices', desc: 'Live Pyth oracle prices used by the decision engine.' },
    ],
    []
  );

  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--ed-obsidian)', color: 'var(--ed-steel-50)' }}
    >
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-obsidian/95 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-10 h-24 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center group">
            <Logo height={88} />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/whitepaper"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.08] text-[11px] font-mono text-steel-300 hover:text-white hover:border-white/20 transition-colors"
            >
              Whitepaper
            </Link>
            <a
              href="https://github.com/mdlog/aegis-vault"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.08] text-[11px] font-mono text-steel-300 hover:text-white hover:border-white/20 transition-colors"
            >
              GitHub <ExternalLink className="w-3 h-3" />
            </a>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-mono text-steel-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3 h-3" /> Back
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-10 py-10 lg:py-14">
        {/* Page intro */}
        <div className="mb-12 pb-8 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-3.5 h-3.5 text-gold/70" />
            <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-steel-500">
              Documentation · v1.0 · 0G Aristotle Mainnet
            </span>
          </div>
          <h1
            className="ed-display"
            style={{ fontSize: 48, fontWeight: 500, letterSpacing: '-0.035em', margin: 0, lineHeight: 1 }}
          >
            Build,{' '}
            <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>
              operate, and integrate.
            </span>
          </h1>
          <p className="text-[15px] text-steel-400 mt-4 max-w-[720px] leading-relaxed">
            Everything you need to deploy capital into an Aegis vault, register as a delegated
            operator, or integrate the orchestrator API into your own tooling. All contract
            addresses below are live on 0G Aristotle Mainnet (chain id 16661).
          </p>
        </div>

        {/* Two-column layout */}
        <div className="grid gap-10 lg:gap-14" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div
            className="grid gap-10 lg:gap-14"
            style={{ gridTemplateColumns: '220px minmax(0, 1fr)' }}
          >
            {/* Sidebar TOC */}
            <aside className="hidden lg:block">
              <div className="sticky top-24">
                <div
                  className="ed-mono mb-4"
                  style={{ fontSize: 10, color: 'var(--ed-gold)', letterSpacing: '0.22em' }}
                >
                  ON THIS PAGE
                </div>
                <nav className="flex flex-col gap-0.5">
                  {SECTIONS.map((s) => {
                    const Icon = s.icon;
                    const active = activeId === s.id;
                    return (
                      <a
                        key={s.id}
                        href={`#${s.id}`}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-md text-[12px] transition-colors"
                        style={{
                          color: active ? 'var(--ed-steel-50)' : 'var(--ed-steel-400)',
                          background: active ? 'rgba(201,168,76,0.08)' : 'transparent',
                          borderLeft: `2px solid ${active ? 'var(--ed-gold)' : 'transparent'}`,
                        }}
                      >
                        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{s.label}</span>
                      </a>
                    );
                  })}
                </nav>
                <div
                  className="mt-6 p-3 rounded-md"
                  style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <div className="text-[10px] font-mono uppercase tracking-wider text-gold/70 mb-1">
                    Need the app?
                  </div>
                  <Link
                    to="/app"
                    className="text-[12px] text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1"
                  >
                    Launch dashboard →
                  </Link>
                </div>
              </div>
            </aside>

            {/* Content */}
            <main className="min-w-0">
              {/* Introduction */}
              <section className="mb-16">
                <SectionHeader
                  id="introduction"
                  number="01"
                  label="Introduction"
                  title="What is Aegis Vault?"
                  subtitle="Aegis Vault is an AI-managed, risk-controlled trading vault. Users deposit tokens, configure a policy (max position, max daily loss, stop-loss, confidence floor), and an AI operator executes trades within those guardrails. Breaching a guardrail is not a soft warning — it's a reverted transaction."
                />
                <div className="grid md:grid-cols-3 gap-3 mt-6">
                  {[
                    {
                      h: 'Non-custodial',
                      p: 'Operators never hold user funds. They can only call executeIntent(), which is checked against on-chain policy before settlement.',
                    },
                    {
                      h: 'Policy-enforced',
                      p: 'Max position size, daily loss cap, stop-loss, confidence threshold — all stored on-chain and checked every trade.',
                    },
                    {
                      h: 'Operator-switchable',
                      p: 'Vault owners can replace the executor at any time via setExecutor(). Reputation lives on-chain, not in the operator.',
                    },
                  ].map((x) => (
                    <div
                      key={x.h}
                      className="p-4 rounded-md"
                      style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                      <div className="text-[13px] text-steel-100 font-medium mb-1.5">{x.h}</div>
                      <p className="text-[12px] text-steel-400 leading-relaxed">{x.p}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Quick Start */}
              <section className="mb-16">
                <SectionHeader
                  id="quick-start"
                  number="02"
                  label="Quick Start"
                  title="Pick your path."
                  subtitle="Three entry points, depending on whether you want to deposit capital, manage capital, or integrate at the protocol level."
                />

                <div className="grid md:grid-cols-3 gap-4 mt-6">
                  {[
                    {
                      h: 'For depositors',
                      steps: [
                        'Connect wallet to 0G Aristotle Mainnet',
                        'Pick a vault from the marketplace or create a new one',
                        'Approve and deposit USDC / WETH / WBTC',
                        'Set policy, pick an operator, watch the action feed',
                      ],
                      cta: { label: 'Open dashboard →', to: '/app' },
                    },
                    {
                      h: 'For operators',
                      steps: [
                        'Stake A0G in OperatorStaking to unlock a tier',
                        'Call OperatorRegistry.register() with your mandate + fees',
                        'Publish a strategy manifest (optional, bondable)',
                        'Wait for vault owners to assign you via setExecutor()',
                      ],
                      cta: { label: 'Register as operator →', to: '/operator/register' },
                    },
                    {
                      h: 'For developers',
                      steps: [
                        'Read the contract addresses below',
                        'Fetch ABIs from frontend/src/lib/abi/',
                        'Use the orchestrator HTTP API (no keys needed for reads)',
                        'Open the whitepaper for the full state machine',
                      ],
                      cta: { label: 'GitHub repo →', href: 'https://github.com/mdlog/aegis-vault' },
                    },
                  ].map((card) => (
                    <div
                      key={card.h}
                      className="p-5 rounded-md flex flex-col"
                      style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                      <div className="text-[14px] text-steel-100 font-medium mb-3">{card.h}</div>
                      <ol className="flex-1 space-y-2 mb-4">
                        {card.steps.map((s, i) => (
                          <li key={i} className="flex gap-2.5 text-[12px] text-steel-400 leading-relaxed">
                            <span
                              className="font-mono flex-shrink-0"
                              style={{ color: 'var(--ed-gold)' }}
                            >
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ol>
                      {card.cta.to ? (
                        <Link
                          to={card.cta.to}
                          className="text-[12px] font-mono text-cyan-300/90 hover:text-cyan-300"
                        >
                          {card.cta.label}
                        </Link>
                      ) : (
                        <a
                          href={card.cta.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[12px] font-mono text-cyan-300/90 hover:text-cyan-300"
                        >
                          {card.cta.label}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* Architecture */}
              <section className="mb-16">
                <SectionHeader
                  id="architecture"
                  number="03"
                  label="Architecture"
                  title="Dual-layer: intelligence + execution."
                  subtitle="Aegis splits the AI decision layer (0G Aristotle Mainnet) from the capital execution layer (0G Jaine DEX, optionally Arbitrum + Uniswap V3). Each chain enforces what it's best at."
                />

                <div className="grid md:grid-cols-2 gap-4 mt-6">
                  <div
                    className="p-5 rounded-md"
                    style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-gold/80 mb-2">
                      Intelligence layer · 0G chain id 16661
                    </div>
                    <ul className="space-y-2 text-[12.5px] text-steel-300 leading-relaxed">
                      <li>· 0G Compute — verified AI inference (sealed execution mode)</li>
                      <li>· 0G Storage — tamper-evident journal of every decision</li>
                      <li>· OperatorRegistry + OperatorStaking — identity and skin-in-the-game</li>
                      <li>· AegisGovernor — multisig treasury, freeze, slashing votes</li>
                    </ul>
                  </div>
                  <div
                    className="p-5 rounded-md"
                    style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-300/80 mb-2">
                      Execution layer
                    </div>
                    <ul className="space-y-2 text-[12.5px] text-steel-300 leading-relaxed">
                      <li>· AegisVault (ERC-4626 extension) holds deposits and enforces policy</li>
                      <li>· JaineVenueAdapter — real DEX settlement on 0G</li>
                      <li>· ExecutionRegistry — tx hash ledger per intent</li>
                      <li>· Optional: Uniswap V3 on Arbitrum for deeper liquidity</li>
                    </ul>
                  </div>
                </div>

                <div
                  className="mt-4 p-4 rounded-md"
                  style={{
                    background: 'var(--ed-obsidian-dim)',
                    border: '1px solid rgba(201,168,76,0.18)',
                  }}
                >
                  <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-gold mb-1.5">
                    Decision flow
                  </div>
                  <p className="text-[12.5px] text-steel-300 leading-relaxed">
                    Market data → 0G Compute inference → Decision Engine v1 (regime + confidence +
                    edge) → Policy check on-chain → executeIntent() → Settlement on Jaine → Execution
                    receipt logged to journal. Any failing check reverts before settlement.
                  </p>
                </div>
              </section>

              {/* Contracts */}
              <section className="mb-16">
                <SectionHeader
                  id="contracts"
                  number="04"
                  label="Contracts"
                  title="Live deployment addresses."
                  subtitle="All addresses below are the real 0G Aristotle Mainnet deployment (chain id 16661). Click to open the explorer."
                />

                <div
                  className="mt-6 rounded-md overflow-hidden"
                  style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <div
                    className="px-4 py-2.5 flex items-center justify-between"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <span className="text-[11px] font-mono text-steel-300 uppercase tracking-wider">
                      0G Aristotle Mainnet · chain 16661
                    </span>
                    <a
                      href="https://chainscan.0g.ai"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-mono text-cyan-300/80 hover:text-cyan-300 inline-flex items-center gap-1"
                    >
                      chainscan.0g.ai <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <table className="w-full text-left">
                    <tbody>
                      <AddressRow
                        label="AegisVaultFactory"
                        description="Deploys new AegisVault clones (EIP-1167 proxy)."
                        address={mainnet.aegisVaultFactory}
                      />
                      <AddressRow
                        label="OperatorRegistry"
                        description="Operator identity, mandate, fees, endpoint, manifest."
                        address={mainnet.operatorRegistry}
                      />
                      <AddressRow
                        label="OperatorStaking"
                        description="Stake A0G for tier access + slashable bond."
                        address={mainnet.operatorStaking}
                      />
                      <AddressRow
                        label="OperatorReputation"
                        description="On-chain track record: executions, volume, PnL, ratings."
                        address={mainnet.operatorReputation}
                      />
                      <AddressRow
                        label="AegisGovernor"
                        description="Multisig: treasury spend, freeze, slash, insurance claims."
                        address={mainnet.aegisGovernor}
                      />
                      <AddressRow
                        label="ProtocolTreasury"
                        description="Protocol fee sink — timelocked spending via Governor."
                        address={mainnet.protocolTreasury}
                      />
                      <AddressRow
                        label="InsurancePool"
                        description="Backstop for user losses from slashed operators."
                        address={mainnet.insurancePool}
                      />
                      <AddressRow
                        label="ExecutionRegistry"
                        description="Intent → tx hash ledger across all vaults."
                        address={mainnet.executionRegistry}
                      />
                      <AddressRow
                        label="JaineVenueAdapter"
                        description="Real DEX settlement adapter for Jaine pools."
                        address={mainnet.jaineVenueAdapter}
                      />
                      <AddressRow
                        label="VaultNAVCalculator"
                        description="Pure view calculator for vault NAV using Pyth + venue prices."
                        address={mainnet.vaultNAVCalculator}
                      />
                    </tbody>
                  </table>
                </div>

                <div className="mt-5">
                  <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-steel-400 mb-2">
                    Tokens
                  </div>
                  <div
                    className="rounded-md overflow-hidden"
                    style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <table className="w-full text-left">
                      <tbody>
                        <AddressRow label="USDC.e" description="6-decimal stablecoin (Jaine canonical)." address={mainnet.USDCe} />
                        <AddressRow label="WETH" description="Wrapped ETH on 0G." address={mainnet.WETH} />
                        <AddressRow label="WBTC" description="Wrapped BTC on 0G (8 dec)." address={mainnet.WBTC} />
                        <AddressRow label="W0G" description="Wrapped native 0G." address={mainnet.W0G} />
                      </tbody>
                    </table>
                  </div>
                </div>

                {arbitrum.aegisVaultFactory && (
                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-steel-400">
                        Arbitrum execution layer · chain 42161 (optional)
                      </span>
                      <a
                        href="https://arbiscan.io"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-mono text-cyan-300/80 hover:text-cyan-300 inline-flex items-center gap-1"
                      >
                        arbiscan.io <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div
                      className="rounded-md overflow-hidden"
                      style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                      <table className="w-full text-left">
                        <tbody>
                          <AddressRow
                            label="AegisVaultFactory (Arbitrum)"
                            description="Vault deployment on Arbitrum for Uniswap V3 liquidity."
                            address={arbitrum.aegisVaultFactory}
                            chainId={42161}
                          />
                          <AddressRow
                            label="ExecutionRegistry (Arbitrum)"
                            description="Intent → tx hash ledger on the Arbitrum execution side."
                            address={arbitrum.executionRegistry}
                            chainId={42161}
                          />
                          <AddressRow
                            label="UniswapV3 VenueAdapter"
                            description="Settles Arbitrum vault trades via Uniswap V3."
                            address={arbitrum.uniswapV3VenueAdapter}
                            chainId={42161}
                          />
                          <AddressRow
                            label="VaultNAVCalculator (Arbitrum)"
                            description="Pure view calculator for vault NAV on Arbitrum."
                            address={arbitrum.vaultNAVCalculator}
                            chainId={42161}
                          />
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>

              {/* API */}
              <section className="mb-16">
                <SectionHeader
                  id="api"
                  number="05"
                  label="API Reference"
                  title="Orchestrator HTTP API."
                  subtitle="The orchestrator runs off-chain and exposes a read-mostly REST API. Default port 4002. Mutations require either localhost origin or an API key via x-api-key."
                />

                <div
                  className="mt-6 p-3 rounded-md font-mono text-[12px]"
                  style={{ background: 'var(--ed-obsidian-dim)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <span className="text-steel-500">Base URL (dev):</span>{' '}
                  <span className="text-cyan-300">http://localhost:4002</span>
                </div>

                <div
                  className="mt-4 rounded-md overflow-hidden"
                  style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                >
                  <table className="w-full text-left">
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <th className="py-2.5 px-4 text-[10px] font-mono uppercase tracking-wider text-steel-500">
                          Method
                        </th>
                        <th className="py-2.5 px-4 text-[10px] font-mono uppercase tracking-wider text-steel-500">
                          Path
                        </th>
                        <th className="py-2.5 px-4 text-[10px] font-mono uppercase tracking-wider text-steel-500">
                          Description
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiEndpoints.map((ep) => (
                        <tr key={ep.path} className="border-t border-white/[0.04]">
                          <td className="py-2.5 px-4 align-top w-16">
                            <span
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                              style={{
                                color: ep.method === 'GET' ? 'var(--ed-cyan)' : 'var(--ed-gold)',
                                background:
                                  ep.method === 'GET' ? 'rgba(90,180,210,0.08)' : 'rgba(201,168,76,0.08)',
                                border: `1px solid ${
                                  ep.method === 'GET' ? 'rgba(90,180,210,0.18)' : 'rgba(201,168,76,0.22)'
                                }`,
                              }}
                            >
                              {ep.method}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 align-top">
                            <span className="text-[12px] font-mono text-steel-100">{ep.path}</span>
                          </td>
                          <td className="py-2.5 px-4 align-top">
                            <span className="text-[12px] text-steel-400 leading-relaxed">{ep.desc}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* User Guide */}
              <section className="mb-16">
                <SectionHeader
                  id="user-guide"
                  number="06"
                  label="User Guide"
                  title="Deposit, configure, monitor."
                  subtitle="The minimum path for a user who wants capital managed by an Aegis vault."
                />

                <ol className="mt-6 space-y-4">
                  {[
                    {
                      h: 'Connect a wallet on 0G Aristotle Mainnet',
                      p: 'Chain id 16661, RPC https://evmrpc.0g.ai. Bridge in A0G for gas or use the faucet if you only need to test.',
                    },
                    {
                      h: 'Create or pick a vault',
                      p: 'From /app, either click Create Vault (picks a mandate + policy template) or browse the marketplace and assign yourself to an existing vault you control.',
                    },
                    {
                      h: 'Approve the deposit asset',
                      p: 'ERC-20 allowance to the vault address. USDC.e, WETH, WBTC are all supported on 0G.',
                    },
                    {
                      h: 'Deposit',
                      p: 'deposit(assets, receiver) mints shares. NAV is calculated via VaultNAVCalculator using Pyth + venue prices.',
                    },
                    {
                      h: 'Set policy',
                      p: 'maxPositionBps, maxDailyLossBps, stopLossBps, confidenceThresholdBps, cooldownSeconds, maxActionsPerDay. These are hard gates — the vault reverts if an executed trade would breach them.',
                    },
                    {
                      h: 'Pick an operator',
                      p: 'Browse the marketplace, filter by tier, fee, reputation. setExecutor(operator) attaches them to your vault. You can rotate at any time.',
                    },
                    {
                      h: 'Monitor + withdraw',
                      p: 'Actions feed shows every decision, approval, execution, block. redeem(shares, receiver, owner) exits at current NAV.',
                    },
                  ].map((step, i) => (
                    <li
                      key={i}
                      className="flex gap-4 p-4 rounded-md"
                      style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                      <div
                        className="ed-display flex-shrink-0"
                        style={{
                          fontSize: 22,
                          color: 'var(--ed-gold)',
                          fontWeight: 500,
                          width: 36,
                        }}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </div>
                      <div>
                        <div className="text-[13.5px] text-steel-50 font-medium mb-1">{step.h}</div>
                        <p className="text-[12.5px] text-steel-400 leading-relaxed">{step.p}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              {/* Operator Guide */}
              <section className="mb-16">
                <SectionHeader
                  id="operator-guide"
                  number="07"
                  label="Operator Guide"
                  title="Register, stake, operate."
                  subtitle="Operators are AI trading services that can be assigned to user vaults. They never custody funds — they propose intents that the vault validates."
                />

                <div className="mt-6 space-y-4">
                  <div
                    className="p-5 rounded-md"
                    style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <div className="text-[13px] text-steel-100 font-medium mb-2">Staking tiers</div>
                    <div className="grid grid-cols-4 gap-2 text-[12px]">
                      {[
                        { t: 'Bronze', r: '5K – 20K A0G', p: 'Single vault assignment' },
                        { t: 'Silver', r: '20K – 50K A0G', p: 'Multi-vault, 20% slash risk' },
                        { t: 'Gold', r: '≥ 50K A0G', p: 'Featured slot, sealed mode, gov vote' },
                        { t: 'Frozen', r: 'under review', p: 'No new assignments until cleared' },
                      ].map((x) => (
                        <div
                          key={x.t}
                          className="p-2.5 rounded"
                          style={{ background: 'var(--ed-obsidian-dim)', border: '1px solid rgba(255,255,255,0.05)' }}
                        >
                          <div className="font-mono text-[11px] text-gold/90 mb-0.5">{x.t}</div>
                          <div className="text-[10.5px] text-steel-500 mb-1">{x.r}</div>
                          <div className="text-[11px] text-steel-300 leading-snug">{x.p}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-steel-500 mt-3 leading-relaxed">
                      Slashing forfeits 10–50% of stake depending on severity. Affected vault is paid
                      first from the stake, then from InsurancePool if the loss exceeds the bond.
                    </p>
                  </div>

                  <div
                    className="p-5 rounded-md"
                    style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <div className="text-[13px] text-steel-100 font-medium mb-2">Registration checklist</div>
                    <ul className="space-y-1.5 text-[12.5px] text-steel-300 leading-relaxed">
                      <li>· Stake A0G into OperatorStaking to reach your target tier</li>
                      <li>· Call OperatorRegistry.register(mandate, fees, endpoint, metadata)</li>
                      <li>· Optional: publish a strategy manifest and bond it (enables slashing on deviation)</li>
                      <li>· Run an inference endpoint that returns signed intents compatible with the vault</li>
                      <li>· Answer reputation queries — executions, PnL, and ratings are all public</li>
                    </ul>
                  </div>

                  <div
                    className="p-5 rounded-md"
                    style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <div className="text-[13px] text-steel-100 font-medium mb-2">What you can NOT do</div>
                    <ul className="space-y-1.5 text-[12.5px] text-steel-300 leading-relaxed">
                      <li>· Withdraw user funds — the vault has no transferOut path for operators</li>
                      <li>· Bypass policy — executeIntent() checks every guardrail on-chain before settlement</li>
                      <li>· Silently change strategy — bonded manifests are slashable on deviation</li>
                      <li>· Hide a losing track record — reputation is on-chain and append-only</li>
                    </ul>
                  </div>
                </div>
              </section>

              {/* Trust Model */}
              <section className="mb-16">
                <SectionHeader
                  id="trust-model"
                  number="08"
                  label="Trust Model"
                  title="What you are actually trusting."
                  subtitle="The honest list of where the trust lives — and where it doesn't."
                />

                <div className="grid md:grid-cols-2 gap-4 mt-6">
                  {[
                    {
                      h: 'You DO trust',
                      color: 'var(--ed-rose)',
                      items: [
                        'The vault contract bytecode is correct (auditable, immutable per deployment)',
                        'Your own wallet / key hygiene',
                        'The price oracle (Pyth) reports honest prices',
                        'The AI model will occasionally be wrong — that is why policy caps exist',
                      ],
                    },
                    {
                      h: 'You do NOT trust',
                      color: 'var(--ed-emerald)',
                      items: [
                        'The operator to move your funds — they literally cannot',
                        'The operator to stay aligned — you can rotate at any time',
                        'The operator to tell the truth — reputation is on-chain',
                        'Us. There is no Aegis team key that can drain your vault',
                      ],
                    },
                  ].map((col) => (
                    <div
                      key={col.h}
                      className="p-5 rounded-md"
                      style={{ background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                      <div
                        className="ed-mono text-[11px] uppercase tracking-[0.2em] mb-3"
                        style={{ color: col.color }}
                      >
                        {col.h}
                      </div>
                      <ul className="space-y-2 text-[12.5px] text-steel-300 leading-relaxed">
                        {col.items.map((x, i) => (
                          <li key={i}>· {x}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              {/* Resources */}
              <section className="mb-8">
                <SectionHeader
                  id="resources"
                  number="09"
                  label="Resources"
                  title="Where to go next."
                />

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
                  {[
                    { h: 'Whitepaper', p: 'Full thesis, state machine, and proof design.', to: '/whitepaper' },
                    { h: 'Dashboard', p: 'Launch the app and connect your wallet.', to: '/app' },
                    { h: 'Marketplace', p: 'Browse live operators with fees + reputation.', to: '/marketplace' },
                    { h: 'Governance', p: 'Multisig proposals, treasury, insurance claims.', to: '/governance' },
                    { h: 'Faucet', p: 'Mint test tokens on 0G testnet.', to: '/faucet' },
                    {
                      h: 'GitHub',
                      p: 'Source code, ABIs, deploy scripts.',
                      href: 'https://github.com/mdlog/aegis-vault',
                    },
                    {
                      h: '0G Explorer',
                      p: 'Inspect contracts + transactions on chain 16661.',
                      href: 'https://chainscan.0g.ai',
                    },
                    {
                      h: 'Pyth',
                      p: 'Price feeds used by the vault NAV calculator.',
                      href: 'https://pyth.network',
                    },
                  ].map((r) => {
                    const inner = (
                      <>
                        <div className="text-[13px] text-steel-100 font-medium mb-1 flex items-center gap-1.5">
                          {r.h}
                          {r.href && <ExternalLink className="w-3 h-3 text-steel-500" />}
                        </div>
                        <p className="text-[11.5px] text-steel-400 leading-relaxed">{r.p}</p>
                      </>
                    );
                    const cls =
                      'p-4 rounded-md hover:border-white/[0.12] transition-colors block';
                    const style = {
                      background: 'var(--ed-surface-1)',
                      border: '1px solid rgba(255,255,255,0.05)',
                    };
                    return r.to ? (
                      <Link key={r.h} to={r.to} className={cls} style={style}>
                        {inner}
                      </Link>
                    ) : (
                      <a
                        key={r.h}
                        href={r.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cls}
                        style={style}
                      >
                        {inner}
                      </a>
                    );
                  })}
                </div>
              </section>
            </main>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-8 mt-10">
        <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-10 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] font-mono text-steel-500">
          <div>© Aegis Vault · Experimental software · Not audited</div>
          <div className="flex items-center gap-4">
            <Link to="/whitepaper" className="hover:text-white transition-colors">
              Whitepaper
            </Link>
            <a
              href="https://github.com/mdlog/aegis-vault"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              github.com/mdlog/aegis-vault
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
