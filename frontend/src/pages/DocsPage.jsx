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
  ShieldAlert,
  Lock,
  Network,
} from 'lucide-react';
import Logo from '../components/ui/Logo';
import generatedDeployments from '../lib/deployments.generated.json';

const SECTIONS = [
  { id: 'introduction', label: 'Introduction', icon: BookOpen },
  { id: 'quick-start', label: 'Quick Start', icon: Rocket },
  { id: 'architecture', label: 'Architecture', icon: Layers },
  { id: 'policy', label: 'Policy & Risk', icon: ShieldAlert },
  { id: 'sealed-mode', label: 'Sealed Mode', icon: Lock },
  { id: 'venues', label: 'Venues & Routing', icon: Network },
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
        <div className="text-[15px] text-steel-100">{label}</div>
        {description && (
          <div className="text-[13px] text-steel-500 leading-relaxed mt-0.5">{description}</div>
        )}
      </td>
      <td className="py-2.5 align-top">
        {missing ? (
          <span className="text-[13px] font-mono text-steel-600">— not deployed —</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] font-mono text-cyan-300/80 hover:text-cyan-300 break-all"
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
          style={{ fontSize: 12, color: 'var(--ed-gold)', letterSpacing: '0.22em' }}
        >
          § {number} · {label.toUpperCase()}
        </span>
      </div>
      <h2
        id={id}
        className="ed-display scroll-mt-24"
        style={{ fontSize: 38, fontWeight: 500, letterSpacing: '-0.03em', margin: 0, lineHeight: 1.1 }}
      >
        {title}
      </h2>
      {subtitle && (
        <p className="text-[16px] text-steel-400 mt-3 max-w-2xl leading-relaxed">{subtitle}</p>
      )}
    </header>
  );
}

const cardStyle = {
  background: 'var(--ed-surface-1)',
  border: '1px solid rgba(255,255,255,0.05)',
};

const dimStyle = {
  background: 'var(--ed-obsidian-dim)',
  border: '1px solid rgba(255,255,255,0.05)',
};

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

  // Orchestrator HTTP API — all routes verified against orchestrator/src/api.js.
  // auth: 'public' | 'public-sanitized' | 'operator' | 'mutation'
  const apiEndpoints = useMemo(
    () => [
      { method: 'GET', path: '/api/health', auth: 'public', desc: 'Liveness probe. Returns { status:"ok", timestamp }.' },
      { method: 'GET', path: '/api/status', auth: 'public-sanitized', desc: 'Orchestrator state: running, cycleCount, executorAddress(es), lastSignal, lastExecution, totals, pendingApprovalCount, managed/tracked vaults, poolSize. Public view is sanitized; full view needs x-api-key.' },
      { method: 'POST', path: '/api/cycle', auth: 'mutation', desc: 'Trigger one decision cycle. Rate-limited to 6 requests / 60s per key or IP (429 + Retry-After over limit).' },
      { method: 'GET', path: '/api/vault', auth: 'public', desc: 'On-chain vault state (NAV, policy, executor, paused). ?vault= (defaults to configured vault); 400 if no address.' },
      { method: 'GET', path: '/api/operator', auth: 'public', desc: 'Operator state (stake, reputation, fees). ?address= is required; 400 if missing; { registered:false } if unknown.' },
      { method: 'GET', path: '/api/market', auth: 'public', desc: 'Latest market spot prices / 24h change / volume.' },
      { method: 'GET', path: '/api/market/summary', auth: 'public', desc: 'Market summary incl. regime + indicators (RSI / ATR / MACD).' },
      { method: 'GET', path: '/api/pyth/prices', auth: 'public', desc: 'Live Pyth oracle prices used off-chain by the decision engine.' },
      { method: 'GET', path: '/api/nav', auth: 'public', desc: 'Multi-asset NAV for a vault. ?vault= (defaults to configured vault); 400 if no address.' },
      { method: 'GET', path: '/api/tvl/history', auth: 'public', desc: 'Ascending platform-TVL time series for the hero sparkline. ?limit= (clamped), ?hours= (window to last N hours).' },
      { method: 'GET', path: '/api/state', auth: 'operator', desc: 'LOCAL KV state mirror (totals, last signal, last execution). Requires x-api-key / localhost.' },
      { method: 'GET', path: '/api/journal', auth: 'public-sanitized', desc: 'Newest-first journal (default 50). Filter ?type, ?vault, ?level. Public view drops internal scoring fields.' },
      { method: 'GET', path: '/api/journal/decisions', auth: 'public-sanitized', desc: 'Decision entries (buy / sell / hold + confidence). Default 20, filter ?vault.' },
      { method: 'GET', path: '/api/journal/executions', auth: 'public-sanitized', desc: 'Execution entries (tx hashes, duration). Default 20, filter ?vault.' },
      { method: 'GET', path: '/api/alerts', auth: 'public-sanitized', desc: 'Alert entries + pending approval-tier trades. Default 10, filter ?vault, ?level.' },
      { method: 'GET', path: '/api/og-compute/models', auth: 'public', desc: '{ models, count } advertised by the 0G Compute network.' },
      { method: 'GET', path: '/api/og/status', auth: 'public', desc: '{ available, indexer, kvNode } — 0G Storage readiness + the indexer and KV-node RPC URLs.' },
      { method: 'GET', path: '/api/og/state', auth: 'operator', desc: 'Vault state read back FROM 0G Storage. Requires x-api-key / localhost.' },
      { method: 'GET', path: '/api/og/kv/:key', auth: 'operator', desc: 'Read a 0G KV key. Must match ^[A-Za-z0-9._-]{1,128}$ and start with vault- / decision- / execution- / cycle- / manifest- (else 400). Requires x-api-key / localhost.' },
      { method: 'POST', path: '/api/og/flush', auth: 'mutation', desc: 'Flush the journal buffer to 0G Storage. Requires x-api-key / localhost.' },
    ],
    []
  );

  const authBadge = (auth) => {
    const map = {
      public: { label: 'Public', color: 'var(--ed-emerald)', bg: 'rgba(80,180,120,0.08)', bd: 'rgba(80,180,120,0.2)' },
      'public-sanitized': { label: 'Public *', color: 'var(--ed-cyan)', bg: 'rgba(90,180,210,0.08)', bd: 'rgba(90,180,210,0.2)' },
      operator: { label: 'Operator', color: 'var(--ed-gold)', bg: 'rgba(201,168,76,0.08)', bd: 'rgba(201,168,76,0.22)' },
      mutation: { label: 'Mutation', color: 'var(--ed-rose)', bg: 'rgba(210,110,120,0.08)', bd: 'rgba(210,110,120,0.22)' },
    };
    return map[auth] || map.public;
  };

  // On-chain hard gate vs off-chain risk-veto table (verified: ExecLibV4.runExecution).
  const enforcementRows = [
    { gate: 'Intent integrity', field: 'EIP-712 intent hash', where: 'On-chain', note: 'computeIntentHash must equal intent.intentHash, else reverts ("hash").' },
    { gate: 'Expiry', field: 'intent.expiresAt', where: 'On-chain', note: 'block.timestamp ≤ expiresAt ("expired").' },
    { gate: 'Cooldown', field: 'cooldownSeconds', where: 'On-chain', note: 'block.timestamp ≥ lastExecutionTime + cooldownSeconds ("cooldown").' },
    { gate: 'AI confidence', field: 'confidenceThresholdBps', where: 'On-chain', note: 'intent.confidenceBps ≥ confidenceThresholdBps ("conf").' },
    { gate: 'Daily action cap', field: 'maxActionsPerDay', where: 'On-chain', note: 'dailyActionCount < maxActionsPerDay over a rolling 24h window ("actions").' },
    { gate: 'Input balance', field: '—', where: 'On-chain', note: 'balanceOf(assetIn) ≥ amountIn ("tokIn").' },
    { gate: 'Position size', field: 'maxPositionBps', where: 'On-chain', note: 'BUY leg only (assetIn == baseAsset). cap = totalDeposited × maxPositionBps / 10000. Skipped on the SELL leg to avoid a decimals revert (PositionTooLarge).' },
    { gate: 'Asset whitelist', field: '_allowedAssets[]', where: 'On-chain', note: 'BOTH assetIn and assetOut must be listed (≤10 assets).' },
    { gate: 'Slippage floor', field: 'intent.minAmountOut', where: 'On-chain', note: 'Per-intent floor (not a bps policy field). minAmountOut must be > 0 with a venue ("minOut"); actual out ≥ minAmountOut ("slippage").' },
    { gate: 'Strategy binding (V4)', field: 'acceptedManifestHash', where: 'On-chain', note: 'intent.strategyHash == acceptedManifestHash (strict) and strategySchemaVer ∈ [1,1].' },
    { gate: 'Daily-loss halt', field: 'maxDailyLossBps', where: 'Off-chain', note: 'Orchestrator risk veto; only blocks opening/increasing risk (BUY). Defensive SELL/REDUCE is never blocked.' },
    { gate: 'Stop-loss', field: 'stopLossBps', where: 'Off-chain', note: 'Orchestrator risk veto. The field exists in VaultPolicy but no executeIntent path reads it.' },
    { gate: 'Owner kill-switch', field: 'paused', where: 'On-chain', note: 'Owner-only pause() halts deposit / withdraw / executeIntent — the on-chain backstop for the off-chain limits.' },
  ];

  const stakingTiers = [
    { t: 'None', s: '$0', cap: '$5,000' },
    { t: 'Bronze', s: '1,000 USDC.e', cap: '$50,000' },
    { t: 'Silver', s: '10,000 USDC.e', cap: '$500,000' },
    { t: 'Gold', s: '100,000 USDC.e', cap: '$5,000,000' },
    { t: 'Platinum', s: '1,000,000 USDC.e', cap: 'Unlimited' },
  ];

  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--ed-obsidian)', color: 'var(--ed-steel-50)' }}
    >
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-obsidian/95 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-10 h-24 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center group">
            <Logo height={88} />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/whitepaper"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.08] text-[13px] font-mono text-steel-300 hover:text-white hover:border-white/20 transition-colors"
            >
              Whitepaper
            </Link>
            <a
              href="https://github.com/mdlog/aegis-vault"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.08] text-[13px] font-mono text-steel-300 hover:text-white hover:border-white/20 transition-colors"
            >
              GitHub <ExternalLink className="w-3 h-3" />
            </a>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-mono text-steel-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3 h-3" /> Back
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-10 py-10 lg:py-14">
        {/* Page intro */}
        <div className="mb-12 pb-8 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-3.5 h-3.5 text-gold/70" />
            <span className="text-[12px] font-mono uppercase tracking-[0.22em] text-steel-500">
              Documentation · Vault stack V4 · 0G Aristotle Mainnet (16661)
            </span>
          </div>
          <h1
            className="ed-display"
            style={{ fontSize: 56, fontWeight: 500, letterSpacing: '-0.035em', margin: 0, lineHeight: 1 }}
          >
            Deposit, operate,{' '}
            <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>
              and verify.
            </span>
          </h1>
          <p className="text-[17px] text-steel-400 mt-4 max-w-[760px] leading-relaxed">
            Aegis Vault is a non-custodial, AI-managed trading vault. A delegated operator can only
            propose intents; the vault validates each against on-chain policy before settlement, so
            breaching an on-chain gate reverts the transaction. All addresses below are read live from
            the deployment manifest for 0G Aristotle Mainnet (chain id 16661). This page reflects the
            current source — it is candid about what is enforced on-chain and what is not.
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
                  style={{ fontSize: 12, color: 'var(--ed-gold)', letterSpacing: '0.22em' }}
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
                        className="flex items-center gap-2 px-2.5 py-2 rounded-md text-[14px] transition-colors"
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
                  subtitle="Users deposit a base asset, set a policy, and pick an operator. The operator's orchestrator runs an AI decision engine and submits signed intents; the vault enforces trade-shape policy on every executeIntent. The on-chain price protection is a per-intent minAmountOut floor — not a configurable slippage field. Daily-loss and stop-loss are enforced off-chain, with the owner's pause() as the on-chain backstop."
                />
                <div className="grid md:grid-cols-3 gap-3 mt-6">
                  {[
                    {
                      h: 'Non-custodial',
                      p: 'Operators never hold user funds. The vault exposes no transferOut path for the executor — an operator can only call executeIntent(), which is policy-checked before settlement.',
                    },
                    {
                      h: 'Policy-enforced',
                      p: 'maxPositionBps (BUY leg), confidenceThresholdBps, cooldownSeconds, maxActionsPerDay, the both-sides asset whitelist and the minAmountOut floor are on-chain hard gates — a breach reverts the trade. Daily-loss and stop-loss are off-chain (see §04).',
                    },
                    {
                      h: 'Operator-switchable',
                      p: 'The vault owner is the depositor and can rotate the executor at any time via setExecutor(). Reputation is on-chain and append-only in OperatorReputation, not held by the operator.',
                    },
                  ].map((x) => (
                    <div key={x.h} className="p-4 rounded-md" style={cardStyle}>
                      <div className="text-[15px] text-steel-100 font-medium mb-1.5">{x.h}</div>
                      <p className="text-[14px] text-steel-400 leading-relaxed">{x.p}</p>
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
                  subtitle="Three entry points: deposit capital, manage capital as an operator, or integrate at the protocol level."
                />

                <div className="grid md:grid-cols-3 gap-4 mt-6">
                  {[
                    {
                      h: 'For depositors',
                      steps: [
                        'Connect a wallet to 0G Aristotle Mainnet (16661)',
                        'Create a vault or pick one you own from the dashboard',
                        'Approve and deposit the base asset (USDC.e)',
                        'Set policy, assign an operator, watch the action feed',
                      ],
                      cta: { label: 'Open dashboard →', to: '/app' },
                    },
                    {
                      h: 'For operators',
                      steps: [
                        'Stake USDC.e in OperatorStaking to unlock a tier',
                        'Register with OperatorRegistry.register(OperatorInput)',
                        'Optionally publishManifest() and bond it',
                        'Get assigned by vault owners via setExecutor()',
                      ],
                      cta: { label: 'Register as operator →', to: '/operator/register' },
                    },
                    {
                      h: 'For developers',
                      steps: [
                        'Read the live addresses in §07',
                        'Fetch ABIs from frontend/src/lib/abi/',
                        'Hit the orchestrator API (public reads, no key)',
                        'Open the whitepaper for the full state machine',
                      ],
                      cta: { label: 'GitHub repo →', href: 'https://github.com/mdlog/aegis-vault' },
                    },
                  ].map((card) => (
                    <div key={card.h} className="p-5 rounded-md flex flex-col" style={cardStyle}>
                      <div className="text-[16px] text-steel-100 font-medium mb-3">{card.h}</div>
                      <ol className="flex-1 space-y-2 mb-4">
                        {card.steps.map((s, i) => (
                          <li key={i} className="flex gap-2.5 text-[14px] text-steel-400 leading-relaxed">
                            <span className="font-mono flex-shrink-0" style={{ color: 'var(--ed-gold)' }}>
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ol>
                      {card.cta.to ? (
                        <Link to={card.cta.to} className="text-[14px] font-mono text-cyan-300/90 hover:text-cyan-300">
                          {card.cta.label}
                        </Link>
                      ) : (
                        <a
                          href={card.cta.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[14px] font-mono text-cyan-300/90 hover:text-cyan-300"
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
                  subtitle="Aegis separates the AI decision layer from capital settlement. Both run on 0G Aristotle Mainnet (chain id 16661); Jaine is the live settlement DEX. An Arbitrum + Uniswap V3 mirror is deployed but currently holds 0 vaults — available, not active. The two chains are never bridged: cross-chain/cross-vault replay is blocked by the EIP-712 domain separator (chainId + vault address)."
                />

                <div className="grid md:grid-cols-2 gap-4 mt-6">
                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[12px] font-mono uppercase tracking-[0.2em] text-gold/80 mb-2">
                      Intelligence layer · 0G chain id 16661
                    </div>
                    <ul className="space-y-2 text-[14.5px] text-steel-300 leading-relaxed">
                      <li>· 0G Compute — AI inference (an input to the rule engine, not the sole decider)</li>
                      <li>· 0G Storage — decision journal mirror (a lossy mirror; on-chain events are authoritative)</li>
                      <li>· OperatorRegistry + OperatorStaking — identity and slashable USDC.e bond</li>
                      <li>· OperatorReputation — append-only execution stats and ratings</li>
                      <li>· AegisGovernor — M-of-N multisig for slashing, treasury, badges</li>
                    </ul>
                  </div>
                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[12px] font-mono uppercase tracking-[0.2em] text-cyan-300/80 mb-2">
                      Execution layer
                    </div>
                    <ul className="space-y-2 text-[14.5px] text-steel-300 leading-relaxed">
                      <li>· AegisVault (single-owner EIP-1167 clone) holds deposits and enforces policy</li>
                      <li>· JaineVenueAdapterV2 — live 0G DEX settlement, W0G-hub multi-hop routing</li>
                      <li>· ExecutionRegistry — intent-hash ledger + replay guard (shared V3/V4)</li>
                      <li>· KhalaniVenueAdapter — view-only cross-chain route registry (off-chain fills)</li>
                      <li>· Optional: Uniswap V3 on Arbitrum (deployed, 0 vaults today)</li>
                    </ul>
                  </div>
                </div>

                <div className="mt-4 p-4 rounded-md" style={{ background: 'var(--ed-obsidian-dim)', border: '1px solid rgba(201,168,76,0.18)' }}>
                  <div className="text-[12px] font-mono uppercase tracking-[0.2em] text-gold mb-1.5">
                    Decision flow · 5-minute cycle
                  </div>
                  <p className="text-[14.5px] text-steel-300 leading-relaxed">
                    Discover managed vaults → fetch shared market data (Pyth Hermes + CoinGecko, prices
                    &gt; 300s rejected) → per vault: indicators → regime → 0G Compute inference → Decision
                    Engine v1 (8 regimes, 15-rule hard veto, edge/quality scoring) → off-chain policy
                    pre-check → submitIntent → executeIntent on-chain → Jaine settlement → journal +
                    OperatorReputation write. The AI is one input; the deterministic rule engine applies
                    thresholds, hysteresis and veto on top.
                  </p>
                </div>

                <div className="mt-3 p-4 rounded-md" style={dimStyle}>
                  <div className="text-[12px] font-mono uppercase tracking-[0.2em] text-steel-400 mb-1.5">
                    Venue capacity caveat
                  </div>
                  <p className="text-[14.5px] text-steel-400 leading-relaxed">
                    Jaine pools are thin. Realistic single trades clear roughly $150–$900 before
                    reverting on slippage / liquidity, and active trading on 0G can be net-negative after
                    costs. Aegis does not promise large size or guaranteed yield on 0G; sizing is
                    intentionally small and minAmountOut is the hard floor.
                  </p>
                </div>
              </section>

              {/* Policy & Risk */}
              <section className="mb-16">
                <SectionHeader
                  id="policy"
                  number="04"
                  label="Policy & Risk"
                  title="On-chain hard gates vs off-chain risk veto."
                  subtitle="The most important accuracy section on this page. Every executeIntent runs through ExecLibV4.runExecution, which enforces trade-shape policy — any breach reverts the whole transaction. maxPositionBps, maxDailyLossBps and stopLossBps exist in VaultPolicy, but only maxPositionBps (BUY leg) is read on-chain; daily-loss and stop-loss are off-chain orchestrator vetoes. Of the VaultPolicy fields, 11 are contract-enforced and the loss limits are not."
                />

                <div className="mt-6 rounded-md overflow-hidden" style={cardStyle}>
                  <table className="w-full text-left">
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <th className="py-2.5 px-4 text-[12px] font-mono uppercase tracking-wider text-steel-500">Gate</th>
                        <th className="py-2.5 px-4 text-[12px] font-mono uppercase tracking-wider text-steel-500">Field</th>
                        <th className="py-2.5 px-4 text-[12px] font-mono uppercase tracking-wider text-steel-500">Where</th>
                        <th className="py-2.5 px-4 text-[12px] font-mono uppercase tracking-wider text-steel-500">Behaviour</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enforcementRows.map((r) => {
                        const onChain = r.where === 'On-chain';
                        return (
                          <tr key={r.gate} className="border-t border-white/[0.04]">
                            <td className="py-2.5 px-4 align-top">
                              <span className="text-[14.5px] text-steel-100">{r.gate}</span>
                            </td>
                            <td className="py-2.5 px-4 align-top">
                              <span className="text-[13px] font-mono text-steel-400">{r.field}</span>
                            </td>
                            <td className="py-2.5 px-4 align-top w-24">
                              <span
                                className="text-[12px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap"
                                style={{
                                  color: onChain ? 'var(--ed-emerald)' : 'var(--ed-gold)',
                                  background: onChain ? 'rgba(80,180,120,0.08)' : 'rgba(201,168,76,0.08)',
                                  border: `1px solid ${onChain ? 'rgba(80,180,120,0.2)' : 'rgba(201,168,76,0.22)'}`,
                                }}
                              >
                                {r.where}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 align-top">
                              <span className="text-[14px] text-steel-400 leading-relaxed">{r.note}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mt-5">
                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[15px] text-steel-100 font-medium mb-2">Why maxPositionBps is BUY-leg only</div>
                    <p className="text-[14px] text-steel-400 leading-relaxed">
                      The cap is bps of totalDeposited and is only applied when assetIn == baseAsset (the
                      BUY leg), where amountIn shares the base asset's decimals. It is deliberately skipped
                      on the SELL leg: comparing a 6-decimal USDC cap against an 18-decimal WETH amountIn
                      would revert essentially every non-base SELL / stop-loss. SELL legs are bounded
                      instead by the assetIn balance check and the minAmountOut floor.
                    </p>
                  </div>
                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[15px] text-steel-100 font-medium mb-2">Off-chain risk veto + pause()</div>
                    <p className="text-[14px] text-steel-400 leading-relaxed">
                      maxDailyLossBps and stopLossBps are computed from the vault's real NAV by the
                      orchestrator and only block opening/increasing risk — a defensive SELL/REDUCE is never
                      blocked. A journal-independent fail-safe blocks principal-risking BUYs even if local
                      baselines are corrupted (fails closed). The on-chain backstop for all of this is the
                      owner-only pause(), which halts deposit / withdraw / executeIntent.
                    </p>
                  </div>
                </div>

                <div className="mt-4 p-4 rounded-md" style={dimStyle}>
                  <div className="text-[12px] font-mono uppercase tracking-[0.2em] text-steel-400 mb-1.5">
                    Fee caps (enforced at initialize)
                  </div>
                  <p className="text-[14.5px] text-steel-400 leading-relaxed">
                    performanceFeeBps ≤ 30%, managementFeeBps ≤ 5%/yr, entryFeeBps ≤ 2%, exitFeeBps ≤ 2%
                    (all bps of 10,000). The slim live vaults charge only entry/exit fees inline via
                    IOLib, split 80/20 operator/ProtocolTreasury. Performance/management fee accrual is not
                    wired into the live execute path, so no perf/mgmt cut currently reaches the treasury.
                  </p>
                </div>
              </section>

              {/* Sealed Mode & Attestation */}
              <section className="mb-16">
                <SectionHeader
                  id="sealed-mode"
                  number="05"
                  label="Sealed Mode"
                  title="Sealed mode = ECDSA + commit-reveal."
                  subtitle="The claim most worth being precise about. On-chain, sealed mode is an ECDSA signature over the EIP-712 intent plus a commit-reveal delay — NOT a hardware enclave. The vault does not parse an SGX/TDX quote and has no MRENCLAVE check. A real DCAP/TDX attestation engine exists, but it is opt-in and entirely off-chain."
                />

                <div className="mt-6 space-y-4">
                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[15px] text-steel-100 font-medium mb-2">What sealed mode does on-chain</div>
                    <ul className="space-y-2 text-[14.5px] text-steel-300 leading-relaxed">
                      <li>
                        · <span className="text-steel-100">Signed intent.</span> The orchestrator signs the
                        intent hash with a TEE signer key — a separate address from the executor hot wallet
                        (the orchestrator refuses to start if the two keys are equal). The vault recovers
                        the signer and requires it to equal policy.attestedSigner.
                      </li>
                      <li>
                        · <span className="text-steel-100">Attestation hash binding.</span>{' '}
                        attestationReportHash = keccak256(provider, chatId, model, keccak256(content)) is a
                        field inside the signed struct, so the claimed AI output cannot be swapped after
                        signing.
                      </li>
                      <li>
                        · <span className="text-steel-100">Commit-reveal.</span> commitIntent records
                        block.number; executeIntent requires the commit to be at least one block old
                        (block.number ≥ commitBlock + 1, "cr") then deletes it. This blocks MEV
                        front-running and back-fitting an attestation after the fact.
                      </li>
                      <li>
                        · <span className="text-steel-100">Hard gate.</span> executeIntent reverts with
                        MissingAttestationReport() if the hash is zero, so a local-heuristic fallback cannot
                        impersonate a real inference — the orchestrator skips the cycle instead. The
                        signature is verified whenever attestedSigner != address(0), even in open mode, as
                        a backstop against a compromised executor key.
                      </li>
                    </ul>
                  </div>

                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[15px] text-steel-100 font-medium mb-2">Where real DCAP / TDX attestation applies</div>
                    <p className="text-[14px] text-steel-400 leading-relaxed">
                      A genuine DCAP/TDX engine exists in the orchestrator (teeAttestation.js): it verifies
                      the 0G Compute provider's DCAP quote against the Automata on-chain verifier (default
                      0xE26E11B257856B0bEBc4C759aaBDdea72B64351F via rpc.ata.network), checks the embedded
                      TDX signer against the provider's registered teeSignerAddress and the dstack compose
                      hash, plus a per-chatId response signature. Two honest qualifiers: it is opt-in (only
                      runs when a strategy manifest sets execution.requireTeeAttestation === true), and it
                      is entirely off-chain — on failure the orchestrator skips the cycle; the contract
                      never sees a quote. Even with it enabled, the on-chain guarantee is still ECDSA +
                      commit-reveal.
                    </p>
                  </div>

                  <div className="p-4 rounded-md" style={{ background: 'var(--ed-obsidian-dim)', border: '1px solid rgba(201,168,76,0.18)' }}>
                    <div className="text-[12px] font-mono uppercase tracking-[0.2em] text-gold mb-1.5">
                      Proven on mainnet
                    </div>
                    <p className="text-[14.5px] text-steel-300 leading-relaxed">
                      First V3 sealed-mode execution at block 31665957, tx 0x0d7334b8…536005e (2026-04-27),
                      where the off-chain-recomputed attestationReportHash 0x9b08c5c6…fba6 matched the
                      on-chain SealedIntentExecuted event byte-for-byte. What this proves: an intent signed
                      by the approved key, carrying an immutable AI-response hash, committed before it
                      executed. What it does NOT prove on-chain: that an enclave produced the inference.
                    </p>
                  </div>
                </div>
              </section>

              {/* Venues & Routing */}
              <section className="mb-16">
                <SectionHeader
                  id="venues"
                  number="06"
                  label="Venues & Routing"
                  title="How trades settle."
                  subtitle="The vault calls a venue adapter's swap(tokenIn, tokenOut, amountIn, minAmountOut) via a low-level call, sandwiched between forceApprove(venue, amountIn) and forceApprove(venue, 0), and measures its own tokenOut balance delta as the realized output. Any revert in the adapter bubbles up and the whole executeIntent reverts atomically — no tokens can be stranded."
                />

                <div className="mt-6 space-y-4">
                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[15px] text-steel-100 font-medium mb-2">Jaine (live 0G venue) — W0G-hub multi-hop</div>
                    <p className="text-[14px] text-steel-400 leading-relaxed mb-2">
                      All V4 vaults settle through JaineVenueAdapterV2, a Uniswap-V3-style DEX. swap()
                      decides deterministically: tokenIn == tokenOut reverts; a direct pool with readable
                      liquidity goes single-hop; otherwise it routes two-hop through the immutable hub token
                      W0G (tokenIn ‖ feeIn ‖ W0G ‖ feeOut ‖ tokenOut); if neither leg has liquidity it
                      reverts NoRoute. Jaine's deep liquidity is W0G-centric, so USDC.e ↔ WETH/WBTC route
                      via W0G.
                    </p>
                    <ul className="space-y-1.5 text-[14px] text-steel-400 leading-relaxed">
                      <li>· Fails closed: a pool counts only if it returns non-zero readable liquidity, so a maliciously seeded slot0() pool is skipped (anyone can createPool on Jaine).</li>
                      <li>· Output verified by balance delta, not router return: reverts BalanceDeltaBelowMin / SwapFailed. minAmountOut is the end-to-end floor for multi-hop.</li>
                      <li>· maxSlippageBps (venue field, default 3%, ceiling tightened to 5%) feeds an optional Pyth oracle guard — disabled on Jaine because on-chain Pyth on 0G is too stale, so minAmountOut is the sole price protection.</li>
                      <li>· previewRoute() / getAmountOut() are off-chain helpers only — a Q64.96 spot estimate, no Quoter sim, no fee or price-impact; never a hard quote.</li>
                    </ul>
                  </div>

                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[15px] text-steel-100 font-medium mb-2">ExecutionRegistry — the intent ledger</div>
                    <p className="text-[14px] text-steel-400 leading-relaxed">
                      An intent-hash ledger and replay guard, not a literal intent→tx-hash map. Per intent
                      it records submitted/finalized flags and an ExecutionResult
                      {' '}{'{ intentHash, venueTxRef, amountIn, amountOut, executedAt, success }'}. Note:
                      the on-chain venueTxRef is set to the venue contract address (not a transaction hash),
                      and 0 for cross-chain fills — the real settlement tx hash is captured off-chain by the
                      orchestrator and surfaced in the journal/UI. Replay is impossible (IntentAlreadySubmitted
                      / IntentAlreadyFinalized). A multi-factory model lets the V3 and V4 factories share one
                      registry without rotating admin (Ownable2Step).
                    </p>
                  </div>

                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[15px] text-steel-100 font-medium mb-2">Khalani — cross-chain route registry (off-chain settlement)</div>
                    <p className="text-[14px] text-steel-400 leading-relaxed">
                      KhalaniVenueAdapter is a view-only allowlist/validator for Khalani HyperStream, not a
                      swapping venue. Settlement is off-chain: solvers fill intents and deliver tokens; the
                      adapter holds no funds and never moves ERC-20. It exposes chain/token allowlists, a fee
                      guideline (hard-capped at 2%), isRouteAllowed(), and khalaniApiBase()
                      = https://api.hyperstream.dev. Today the orchestrator issues Khalani intents with
                      fromChainId == toChainId == 0G (single-chain). The V4 vault's acceptCrossChainFill path
                      re-applies the same on-chain gates plus fee caps (≤ 200 bps), a balance-delta
                      settlement check, the registry replay guard and a per-fill consumedKhalaniIds guard.
                    </p>
                  </div>

                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[15px] text-steel-100 font-medium mb-2">Optional: Arbitrum / Uniswap V3 (deployed, 0 vaults)</div>
                    <p className="text-[14px] text-steel-400 leading-relaxed">
                      A sibling Uniswap V3 execution layer is deployed on Arbitrum One (42161) but currently
                      has 0 vaults — available, not active. UniswapV3VenueAdapter targets SwapRouter02 and is
                      single-hop only (canonical Uniswap V3 has direct USDC/WETH and USDC/WBTC pools), with
                      the same hardening as Jaine V2 plus a strict-oracle flag. It is V1-class contracts and
                      lacks the full operator stack (no marketplace, tier caps, on-chain reputation, or
                      governance) — validation / test-capital only.
                    </p>
                  </div>
                </div>
              </section>

              {/* Contracts */}
              <section className="mb-16">
                <SectionHeader
                  id="contracts"
                  number="07"
                  label="Contracts"
                  title="Live deployment addresses."
                  subtitle="All addresses below are read from the deployment manifest for 0G Aristotle Mainnet (chain id 16661). The vault stack cut over to V4 on 2026-05-14 (manifest-bound factory + refreshed operator marketplace); the V3 factory remains exposed for read-only access to pre-cutover vaults. Click to open the explorer."
                />

                <div className="mt-6 rounded-md overflow-hidden" style={cardStyle}>
                  <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <span className="text-[13px] font-mono text-steel-300 uppercase tracking-wider">
                      0G Aristotle Mainnet · chain 16661
                    </span>
                    <a
                      href="https://chainscan.0g.ai"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] font-mono text-cyan-300/80 hover:text-cyan-300 inline-flex items-center gap-1"
                    >
                      chainscan.0g.ai <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <table className="w-full text-left">
                    <tbody>
                      <AddressRow
                        label="AegisVaultFactoryV4"
                        description="Live factory — deploys manifest-bound EIP-1167 vault clones (7-arg createVault). Depositor becomes owner; chosen operator becomes executor. Default for new vaults since the 2026-05-14 cutover. Ownable2Step; MAX_CROSS_CHAIN_FEE_BPS_CAP = 200."
                        address={mainnet.aegisVaultFactoryV4 || mainnet.aegisVaultFactory}
                      />
                      <AddressRow
                        label="AegisVaultImplementationV4"
                        description="Clone target, linked to ExecLibV4 + SealedLib + IOLib + CrossChainLibV4. Implementation owner locked to 0xdEaD so it can never be initialized directly."
                        address={mainnet.aegisVaultImplementationV4}
                      />
                      {mainnet.aegisVaultFactoryV3 && mainnet.aegisVaultFactoryV3 !== mainnet.aegisVaultFactoryV4 ? (
                        <AddressRow
                          label="AegisVaultFactoryV3 (legacy)"
                          description="Pre-cutover 6-arg factory. Read-only access to vaults deployed before 2026-05-14; V3 vaults are not migrated in place (clones cannot grow the acceptedManifestHash slot)."
                          address={mainnet.aegisVaultFactoryV3}
                        />
                      ) : null}
                      <AddressRow
                        label="OperatorRegistry"
                        description="Public, fund-less directory: mandate, declared fees, recommended-policy suggestions, manifest, declared AI model. Redeployed fresh on 2026-05-14."
                        address={mainnet.operatorRegistry}
                      />
                      <AddressRow
                        label="OperatorStaking (v2)"
                        description="Stake USDC.e for tier access + slashable bond. 14-day unstake cooldown; slashing capped at 50% per call and 50% per rolling 7-day window. Redeployed 2026-05-14."
                        address={mainnet.operatorStaking}
                      />
                      <AddressRow
                        label="OperatorReputation"
                        description="Append-only on-chain track record: executions, success, USDC-6 volume, signed PnL, Sybil-gated ratings, verified badge. Only authorized vault recorders can write. Redeployed 2026-05-14."
                        address={mainnet.operatorReputation}
                      />
                      <AddressRow
                        label="AegisGovernor"
                        description="M-of-N multisig: slashing arbitration, treasury spend, verified badges, arbitrator role, owner rotation. Generation counter invalidates stale proposals."
                        address={mainnet.aegisGovernor}
                      />
                      <AddressRow
                        label="ProtocolTreasury"
                        description="Holds protocol fee revenue (USDC + native 0G). Receives a 20% cut of entry/exit fees, split inline in IOLib. Ownable2Step; spend gated to admin / approved spenders."
                        address={mainnet.protocolTreasury}
                      />
                      <AddressRow
                        label="InsurancePool (v2)"
                        description="USDC backstop funded by slashed stake + voluntary deposits; arbitrator-reviewed claim payout flow. Redeployed 2026-05-14."
                        address={mainnet.insurancePool}
                      />
                      <AddressRow
                        label="ExecutionRegistry"
                        description="Intent-hash ledger + replay guard (submitted / finalized + ExecutionResult), shared across the V3 and V4 factories via a multi-factory authorization model."
                        address={mainnet.executionRegistry}
                      />
                      <AddressRow
                        label="JaineVenueAdapter (V2)"
                        description="Live 0G settlement venue. Auto-routes USDC.e ↔ BTC/ETH via the W0G hub when no direct pool exists. Balance-delta is the source of truth; minAmountOut is the sole on-chain price protection (Pyth guard disabled on Jaine). All V4 vaults settle here."
                        address={mainnet.jaineVenueAdapterV2 || mainnet.jaineVenueAdapter}
                      />
                      {mainnet.khalaniVenueAdapter ? (
                        <AddressRow
                          label="KhalaniVenueAdapter"
                          description="View-only cross-chain route registry/validator for Khalani HyperStream (off-chain solver fills). Holds no funds; exposes allowlists, a ≤ 2% fee cap, and isRouteAllowed()."
                          address={mainnet.khalaniVenueAdapter}
                        />
                      ) : null}
                      <AddressRow
                        label="VaultNAVCalculator"
                        description="Standalone view-only contract returning NAV in USDC-6 terms from Pyth (5-min staleness, ≤5% confidence band). Stablecoins valued at $1. Not used by the vault's on-chain gates."
                        address={mainnet.vaultNAVCalculator}
                      />
                    </tbody>
                  </table>
                </div>

                {/* V4 supporting libraries */}
                {(mainnet.execLibraryV4 || mainnet.crossChainLibraryV4) && (
                  <div className="mt-5">
                    <div className="text-[12px] font-mono uppercase tracking-[0.2em] text-steel-400 mb-2">
                      Supporting libraries (linked into V4 implementation)
                    </div>
                    <div className="rounded-md overflow-hidden" style={cardStyle}>
                      <table className="w-full text-left">
                        <tbody>
                          <AddressRow
                            label="ExecLibraryV4"
                            description="Trade execution + EIP-712 intent validation. New in V4 — typehash threads strategyHash + strategySchemaVer."
                            address={mainnet.execLibraryV4}
                          />
                          <AddressRow
                            label="CrossChainLibraryV4"
                            description="Khalani intent verification. New typehash binds the strategy commitment, so V3 cross-chain signatures cannot replay against V4 vaults."
                            address={mainnet.crossChainLibraryV4}
                          />
                          <AddressRow
                            label="IOLibraryV3"
                            description="Deposit / withdraw + 80/20 entry-exit fee split. Reused from V3 (unchanged ABI). SealedLib, also reused unchanged, is linked but not surfaced here."
                            address={mainnet.ioLibraryV3}
                          />
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="mt-5">
                  <div className="text-[12px] font-mono uppercase tracking-[0.2em] text-steel-400 mb-2">
                    Tokens
                  </div>
                  <div className="rounded-md overflow-hidden" style={cardStyle}>
                    <table className="w-full text-left">
                      <tbody>
                        <AddressRow label="USDC.e" description="6-decimal stablecoin. Base asset and the OperatorStaking stake token." address={mainnet.USDCe} />
                        <AddressRow label="WETH" description="Wrapped ETH on 0G (18 dec)." address={mainnet.WETH} />
                        <AddressRow label="WBTC" description="Wrapped BTC on 0G (8 dec)." address={mainnet.WBTC} />
                        {mainnet.cbBTC ? (
                          <AddressRow label="cbBTC" description="8-decimal BTC asset actually wired into the mainnet NAV calculator and Khalani allow-list." address={mainnet.cbBTC} />
                        ) : null}
                        <AddressRow label="W0G" description="Wrapped native 0G (18 dec). The DEX hub token for Jaine multi-hop routing." address={mainnet.W0G} />
                      </tbody>
                    </table>
                  </div>
                </div>

                {arbitrum.aegisVaultFactory && (
                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[12px] font-mono uppercase tracking-[0.2em] text-steel-400">
                        Arbitrum execution layer · chain 42161 (deployed, 0 vaults)
                      </span>
                      <a
                        href="https://arbiscan.io"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] font-mono text-cyan-300/80 hover:text-cyan-300 inline-flex items-center gap-1"
                      >
                        arbiscan.io <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="rounded-md overflow-hidden" style={cardStyle}>
                      <table className="w-full text-left">
                        <tbody>
                          <AddressRow
                            label="AegisVaultFactory (Arbitrum)"
                            description="V1-class factory for Uniswap V3 liquidity. Execution-layer infra only — no operator/governance stack; 0 active vaults."
                            address={arbitrum.aegisVaultFactory}
                            chainId={42161}
                          />
                          <AddressRow
                            label="ExecutionRegistry (Arbitrum)"
                            description="Intent-hash ledger on the Arbitrum execution side."
                            address={arbitrum.executionRegistry}
                            chainId={42161}
                          />
                          <AddressRow
                            label="UniswapV3 VenueAdapter"
                            description="Single-hop Uniswap V3 settlement (SwapRouter02). Same hardening as Jaine V2 plus a strict-oracle flag."
                            address={arbitrum.uniswapV3VenueAdapter}
                            chainId={42161}
                          />
                          <AddressRow
                            label="VaultNAVCalculator (Arbitrum)"
                            description="Pure view NAV calculator on Arbitrum (Pyth canonical + fresh there)."
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
                  number="08"
                  label="API Reference"
                  title="Orchestrator HTTP API."
                  subtitle="The orchestrator runs off-chain (Node/Express) and exposes a read-mostly REST API. Default port 4002; every route is defined directly in orchestrator/src/api.js (no sub-routers). Three access tiers: Public (no auth), Operator (x-api-key, or loopback-only when no key is set), and Mutation (x-api-key, or localhost-only). Public * means the route is public but the non-operator view is sanitized."
                />

                <div className="mt-6 p-3 rounded-md font-mono text-[14px]" style={{ background: 'var(--ed-obsidian-dim)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="text-steel-500">Base URL (dev):</span>{' '}
                  <span className="text-cyan-300">http://localhost:4002</span>
                </div>

                <div className="mt-4 rounded-md overflow-hidden" style={cardStyle}>
                  <table className="w-full text-left">
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <th className="py-2.5 px-4 text-[12px] font-mono uppercase tracking-wider text-steel-500">Method</th>
                        <th className="py-2.5 px-4 text-[12px] font-mono uppercase tracking-wider text-steel-500">Path</th>
                        <th className="py-2.5 px-4 text-[12px] font-mono uppercase tracking-wider text-steel-500">Auth</th>
                        <th className="py-2.5 px-4 text-[12px] font-mono uppercase tracking-wider text-steel-500">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiEndpoints.map((ep) => {
                        const b = authBadge(ep.auth);
                        return (
                          <tr key={ep.method + ep.path} className="border-t border-white/[0.04]">
                            <td className="py-2.5 px-4 align-top w-16">
                              <span
                                className="text-[12px] font-mono px-1.5 py-0.5 rounded"
                                style={{
                                  color: ep.method === 'GET' ? 'var(--ed-cyan)' : 'var(--ed-gold)',
                                  background: ep.method === 'GET' ? 'rgba(90,180,210,0.08)' : 'rgba(201,168,76,0.08)',
                                  border: `1px solid ${ep.method === 'GET' ? 'rgba(90,180,210,0.18)' : 'rgba(201,168,76,0.22)'}`,
                                }}
                              >
                                {ep.method}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 align-top">
                              <span className="text-[14px] font-mono text-steel-100">{ep.path}</span>
                            </td>
                            <td className="py-2.5 px-4 align-top w-24">
                              <span
                                className="text-[12px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap"
                                style={{ color: b.color, background: b.bg, border: `1px solid ${b.bd}` }}
                              >
                                {b.label}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 align-top">
                              <span className="text-[14px] text-steel-400 leading-relaxed">{ep.desc}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="text-[13.5px] text-steel-500 mt-3 leading-relaxed max-w-2xl">
                  Loopback is detected from the socket address only (127.0.0.1 / ::1 / ::ffff:127.0.0.1);
                  a spoofed Host: localhost header is ignored. With STRICT_MODE the server refuses to start
                  without an API key, and a production-like deploy refuses to start with an empty CORS
                  allowlist. This API exposes read state and a single mutation cycle trigger — there is no
                  hardware-TEE confidential-compute endpoint here.
                </p>
              </section>

              {/* User Guide */}
              <section className="mb-16">
                <SectionHeader
                  id="user-guide"
                  number="09"
                  label="User Guide"
                  title="Deposit, configure, monitor."
                  subtitle="The minimum path for a depositor. The live V4 vault is a single-owner, principal-accounting vault — not an ERC-4626 share vault. There is no share token, no mint, and no redeem(); capital is tracked by a single totalDeposited and moved only by the owner."
                />

                <ol className="mt-6 space-y-4">
                  {[
                    {
                      h: 'Connect a wallet on 0G Aristotle Mainnet',
                      p: 'Chain id 16661, RPC https://evmrpc.0g.ai. Hold native 0G for gas.',
                    },
                    {
                      h: 'Create or pick a vault',
                      p: 'From /app, create a vault (you become its owner) or assign yourself to an existing vault you control. createVault is 7-arg in V4 and binds an acceptedManifestHash.',
                    },
                    {
                      h: 'Approve the base asset',
                      p: 'Grant an ERC-20 allowance of USDC.e (the base asset) to the vault address. WETH/WBTC are not deposited as principal — the operator trades into them.',
                    },
                    {
                      h: 'Deposit',
                      p: 'deposit(uint256 amount) is owner-only. It pulls the base asset, charges entryFeeBps (split 80/20 operator/treasury in V4), and credits the net to totalDeposited. No shares are minted.',
                    },
                    {
                      h: 'Set policy',
                      p: 'maxPositionBps (BUY leg), confidenceThresholdBps, cooldownSeconds, maxActionsPerDay, the asset whitelist and the minAmountOut floor are on-chain hard gates — the vault reverts if a trade would breach them. maxDailyLossBps and stopLossBps are off-chain orchestrator vetoes (see §04).',
                    },
                    {
                      h: 'Pick an operator',
                      p: 'Browse the marketplace, filter by tier, fee, mandate, manifest and on-chain reputation. setExecutor(operator) attaches them; you can rotate at any time.',
                    },
                    {
                      h: 'Monitor + withdraw',
                      p: 'The action feed shows every decision, approval, execution and block. Exit with withdraw(uint256 amount) for the base asset, or withdrawToken / withdrawAllNonBase to sweep non-base assets acquired during trading. Exits are at token balances, not an oracle NAV.',
                    },
                  ].map((step, i) => (
                    <li key={i} className="flex gap-4 p-4 rounded-md" style={cardStyle}>
                      <div className="ed-display flex-shrink-0" style={{ fontSize: 26, color: 'var(--ed-gold)', fontWeight: 500, width: 36 }}>
                        {String(i + 1).padStart(2, '0')}
                      </div>
                      <div>
                        <div className="text-[15.5px] text-steel-50 font-medium mb-1">{step.h}</div>
                        <p className="text-[14.5px] text-steel-400 leading-relaxed">{step.p}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              {/* Operator Guide */}
              <section className="mb-16">
                <SectionHeader
                  id="operator-guide"
                  number="10"
                  label="Operator Guide"
                  title="Register, stake, operate."
                  subtitle="Anyone can run the orchestrator, register an on-chain identity, optionally stake a slashable USDC.e bond, and be assigned as a vault's executor. Operators compete on fee, mandate, stake tier, published strategy and on-chain reputation. The invariant: operators never custody funds and cannot bypass on-chain policy — they only call executeIntent()."
                />

                <div className="mt-6 space-y-4">
                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[15px] text-steel-100 font-medium mb-1">Staking tiers (OperatorStaking v2)</div>
                    <p className="text-[13.5px] text-steel-500 mb-3 leading-relaxed">
                      The stake token is USDC.e (6 decimals), not a native token. tierOf() reads active
                      stake only; vault-NAV caps gate the managed vault size.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[14px]">
                      {stakingTiers.map((x) => (
                        <div key={x.t} className="p-2.5 rounded" style={dimStyle}>
                          <div className="font-mono text-[13px] text-gold/90 mb-0.5">{x.t}</div>
                          <div className="text-[12.5px] text-steel-500 mb-1">{x.s}</div>
                          <div className="text-[13px] text-steel-300 leading-snug">Max vault {x.cap}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[13px] text-steel-500 mt-3 leading-relaxed">
                      Slashing (arbitrator-only, rotated to the AegisGovernor multisig) is capped at 50% per
                      call and 50% cumulative per rolling 7-day window — there is no graduated severity table
                      in code; any 10–50% framing is governance discretion. Slashed funds flow to the
                      InsurancePool, which compensates affected vault owners. requestUnstake() starts a
                      14-day cooldown during which stake stays slashable. "Frozen" is an arbitration state
                      (freeze() / unfreeze()) that halts withdrawals — not a stake tier.
                    </p>
                  </div>

                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[15px] text-steel-100 font-medium mb-2">Registration checklist</div>
                    <ul className="space-y-1.5 text-[14.5px] text-steel-300 leading-relaxed">
                      <li>· Stake USDC.e into OperatorStaking to reach your target tier</li>
                      <li>· Call OperatorRegistry.register(OperatorInput) — a single struct (name, description, endpoint, mandate, 4 fee bps, 5 recommended-policy fields). There is no feeRecipient argument.</li>
                      <li>· Optionally publishManifest(uri, hash, bonded) — commits a keccak256 of your canonical strategy JSON; bonded stakes reputation</li>
                      <li>· Optionally declareAIModel(model, provider, endpoint) — e.g. zai-org/GLM-5-FP8</li>
                      <li>· Run an inference endpoint that returns signed intents compatible with the vault</li>
                      <li>· Reputation queries (executions, PnL, ratings) are public and append-only</li>
                    </ul>
                  </div>

                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[15px] text-steel-100 font-medium mb-2">Recommended-policy fields are display-only</div>
                    <p className="text-[14px] text-steel-400 leading-relaxed">
                      recommendedMaxPositionBps / ConfidenceMinBps / StopLossBps / CooldownSeconds /
                      MaxActionsPerDay are suggestions surfaced in the marketplace — none are enforced
                      on-chain. The binding values live in each vault's policy. Declared fee caps mirror the
                      vault: perf ≤ 30%, mgmt ≤ 5%/yr, entry/exit ≤ 2%.
                    </p>
                  </div>

                  <div className="p-5 rounded-md" style={cardStyle}>
                    <div className="text-[15px] text-steel-100 font-medium mb-2">What you can NOT do</div>
                    <ul className="space-y-1.5 text-[14.5px] text-steel-300 leading-relaxed">
                      <li>· Withdraw user funds — the vault has no transferOut path for the executor</li>
                      <li>· Bypass policy — executeIntent() re-checks every on-chain gate before settlement</li>
                      <li>· Silently change strategy — V4 reverts on-chain if intent.strategyHash ≠ acceptedManifestHash; for bonded manifests, governance can slash on proven deviation (detected off-chain, slash executed on-chain — not automatic)</li>
                      <li>· Inflate your own stats — only authorized vault recorders write to OperatorReputation</li>
                      <li>· Hide a losing record or self-grant the verified badge — stats are append-only and the badge is governance-only</li>
                    </ul>
                  </div>
                </div>
              </section>

              {/* Trust Model */}
              <section className="mb-16">
                <SectionHeader
                  id="trust-model"
                  number="11"
                  label="Trust Model"
                  title="What you are actually trusting."
                  subtitle="The honest version. Aegis is experimental software deployed on mainnet — not audited. No capital-protection guarantee is made. Verify every claim against the source before depositing real funds."
                />

                <div className="grid md:grid-cols-2 gap-4 mt-6">
                  {[
                    {
                      h: 'You DO trust',
                      color: 'var(--ed-rose)',
                      items: [
                        'The vault bytecode is correct — auditable and immutable per deployment, but NOT yet third-party audited; smart-contract bug risk is accepted',
                        'Your own owner key — it controls deposit / withdraw and setExecutor',
                        'The attestedSigner ECDSA key — the real root of trust in sealed mode; anyone holding it can mint valid intents within the policy caps (revocable via setAttestedSigner)',
                        'The price oracle, with a caveat — NAV uses Pyth, but on 0G/Jaine the on-chain Pyth freshness guard is disabled, so minAmountOut is the only execution-time price protection',
                        'The orchestrator to compute hashes honestly and run the off-chain risk veto (daily-loss / stop-loss live here, not in the contract)',
                        'The AI will sometimes be wrong — that is why the policy caps and the off-chain veto exist',
                      ],
                    },
                    {
                      h: 'You do NOT trust',
                      color: 'var(--ed-emerald)',
                      items: [
                        'The operator to move your funds — they literally cannot (no transferOut path)',
                        'The operator to stay aligned — rotate any time via setExecutor()',
                        'The operator to self-report — OperatorReputation is on-chain and append-only (a post-hoc signal, not a pre-trade guarantee)',
                        'A team "god key" — there is none that can drain a vault. Caveat: fresh deployments start with a 1-of-1 governor (the deployer) until rotated to a multisig — only deposit into vaults whose factory admin is already a governor multisig',
                      ],
                    },
                  ].map((col) => (
                    <div key={col.h} className="p-5 rounded-md" style={cardStyle}>
                      <div className="ed-mono text-[13px] uppercase tracking-[0.2em] mb-3" style={{ color: col.color }}>
                        {col.h}
                      </div>
                      <ul className="space-y-2 text-[14.5px] text-steel-300 leading-relaxed">
                        {col.items.map((x, i) => (
                          <li key={i}>· {x}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="mt-4 p-4 rounded-md" style={dimStyle}>
                  <div className="text-[12px] font-mono uppercase tracking-[0.2em] text-steel-400 mb-1.5">
                    Frank limitations
                  </div>
                  <ul className="space-y-1.5 text-[14.5px] text-steel-400 leading-relaxed">
                    <li>· Experimental, unaudited mainnet software — deploy small allocations only. Audits, bug bounty and insurance are post-hackathon roadmap.</li>
                    <li>· Hardware-grade on-chain TEE is not shipped. Sealed mode is ECDSA + commit-reveal; real DCAP/TDX verification is off-chain and opt-in (§05).</li>
                    <li>· Size / daily-loss / stop-loss limits are off-chain — they depend on the orchestrator running honestly; pause() is the only on-chain circuit breaker.</li>
                    <li>· Thin venue liquidity — Jaine viable trades are roughly $150–900 before a revert; active trading on 0G can be net-negative. Do not size for institutional flow on 0G.</li>
                    <li>· Arbitrum / Uniswap V3 is available but unused — deployed infra, 0 vaults today.</li>
                    <li>· 0G Storage KV can be unstable — the authoritative audit trail is on-chain events; the journal is a lossy mirror.</li>
                  </ul>
                </div>
              </section>

              {/* Resources */}
              <section className="mb-8">
                <SectionHeader
                  id="resources"
                  number="12"
                  label="Resources"
                  title="Where to go next."
                />

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
                  {[
                    { h: 'Whitepaper', p: 'Full thesis + state machine.', to: '/whitepaper' },
                    { h: 'Dashboard', p: 'Launch the app, connect a wallet.', to: '/app' },
                    { h: 'Marketplace', p: 'Live operators, fees, reputation.', to: '/marketplace' },
                    { h: 'Governance', p: 'Multisig, treasury, insurance.', to: '/governance' },
                    { h: 'Faucet', p: 'Mint 0G testnet tokens.', to: '/faucet' },
                    { h: 'GitHub', p: 'Source, ABIs, deploy scripts.', href: 'https://github.com/mdlog/aegis-vault' },
                    { h: '0G Explorer', p: 'Contracts + txs on chain 16661.', href: 'https://chainscan.0g.ai' },
                    { h: 'Pyth', p: 'Feeds used by the NAV calculator.', href: 'https://pyth.network' },
                  ].map((r) => {
                    const inner = (
                      <>
                        <div className="text-[15px] text-steel-100 font-medium mb-1 flex items-center gap-1.5">
                          {r.h}
                          {r.href && <ExternalLink className="w-3 h-3 text-steel-500" />}
                        </div>
                        <p className="text-[13.5px] text-steel-400 leading-relaxed">{r.p}</p>
                      </>
                    );
                    const cls = 'p-4 rounded-md hover:border-white/[0.12] transition-colors block';
                    const style = { background: 'var(--ed-surface-1)', border: '1px solid rgba(255,255,255,0.05)' };
                    return r.to ? (
                      <Link key={r.h} to={r.to} className={cls} style={style}>
                        {inner}
                      </Link>
                    ) : (
                      <a key={r.h} href={r.href} target="_blank" rel="noopener noreferrer" className={cls} style={style}>
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
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-10 flex flex-col sm:flex-row items-center justify-between gap-3 text-[13px] font-mono text-steel-500">
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
