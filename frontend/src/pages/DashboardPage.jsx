import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import {
  ENABLE_DEMO_FALLBACKS,
  getExplorerAddressHref,
  getExplorerTxHref,
  getDeployments,
  getNetworkLabel,
  isConfiguredAddress,
  ORCHESTRATOR_URL,
  shortHexLabel,
  getVaultRoute,
} from '../lib/contracts';
import { useVaultList, useAllPlatformVaults } from '../hooks/useVault';
import {
  useOrchestratorStatus,
  usePythPrices,
  usePlatformTVL,
  useTvlHistory,
  useAlerts,
  useDecisions,
  useExecutions,
} from '../hooks/useOrchestrator';
import { useOperatorList } from '../hooks/useOperatorRegistry';
import { useOperatorTiers } from '../hooks/useOperatorStaking';
import { useOperatorReputations, reputationScore } from '../hooks/useOperatorReputation';
import {
  demoOperatorReputations,
  demoPlatformSnapshot,
  demoPythPrices,
  demoSignal,
  demoStatus,
  demoVaults,
} from '../data/demoContent';
import WalletButton from '../components/ui/WalletButton';
import TokenIcon from '../components/ui/TokenIcon';
import { cx } from '../components/editorial/tokens';

/* ─────────────────────────────────────────────────────────────────────────
   "Ledger" palette — ported 1:1 from Aegis Vault Dashboard.dc.html.
   Clean IBM Plex terminal aesthetic, brighter gold than the editorial system.
   ──────────────────────────────────────────────────────────────────────── */
const P = {
  bg:         '#0a0b0e',
  card:       '#14161b',
  inner:      '#1a1d23',
  tag:        '#22262e',
  line:       'rgba(255,255,255,0.07)',
  lineSoft:   'rgba(255,255,255,0.04)',
  lineMid:    'rgba(255,255,255,0.06)',
  gold:       '#e3b34e',
  goldHover:  '#edc05f',
  goldDim:    '#b8923f',
  emerald:    '#5cb88a',
  rose:       '#df7373',
  violet:     '#6f7bdb',
  ink:        '#eceef1',
  body:       '#c4c8cf',
  sub:        '#9499a2',
  muted:      '#8a8f98',
  faint:      '#6b7078',
  track:      '#2a2e36',
};
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

const ACCENT = {
  gold: P.gold, emerald: P.emerald, rose: P.rose, violet: P.violet, steel: P.sub,
};
const CHIP = {
  gold:    { bg: 'rgba(227,179,78,0.12)', fg: P.gold },
  emerald: { bg: 'rgba(92,184,138,0.12)', fg: P.emerald },
  rose:    { bg: 'rgba(223,115,115,0.12)', fg: P.rose },
  steel:   { bg: P.tag, fg: P.sub },
};

/* ─────────────── Primitives ─────────────── */

function Mono({ children, className = '', style, ...rest }) {
  return (
    <span className={className} style={{ fontFamily: MONO, ...style }} {...rest}>
      {children}
    </span>
  );
}

// Mono eyebrow label — uppercase, wide-tracked, faint (the recurring section tag)
function Label({ children, className = '', style }) {
  return (
    <Mono
      className={cx('uppercase', className)}
      style={{ fontSize: 10.5, letterSpacing: '1.4px', color: P.faint, ...style }}
    >
      {children}
    </Mono>
  );
}

function Chip({ tone = 'steel', dot = false, children, style }) {
  const c = CHIP[tone] || CHIP.steel;
  return (
    <Mono
      className="inline-flex items-center gap-1.5"
      style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.4px',
        color: c.fg, background: c.bg, padding: '3px 8px', borderRadius: 6, ...style,
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: c.fg }} />}
      {children}
    </Mono>
  );
}

function StatusDot({ tone = 'emerald', size = 7, pulse = false }) {
  const color = ACCENT[tone] || P.sub;
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      {pulse && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full animate-pulse-ring"
          style={{ background: color, opacity: 0.4 }}
        />
      )}
      <span className="relative rounded-full" style={{ width: size, height: size, background: color }} />
    </span>
  );
}

// Base card — flat #14161b with a 1px hairline border (mockup signature)
function Card({ className = '', style, children, ...rest }) {
  return (
    <section
      className={className}
      style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 14, ...style }}
      {...rest}
    >
      {children}
    </section>
  );
}

// Card header: title + mono subtitle on the left, trailing slot on the right
function CardHead({ title, subtitle, trailing, size = 17, className = '' }) {
  return (
    <div className={cx('flex items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="m-0 truncate" style={{ fontSize: size, fontWeight: 600, color: P.ink }}>{title}</h2>
        {subtitle && (
          <Mono className="block mt-1 truncate" style={{ fontSize: 11, color: P.faint }}>{subtitle}</Mono>
        )}
      </div>
      {trailing && <div className="flex items-center gap-2 flex-shrink-0">{trailing}</div>}
    </div>
  );
}

function GhostButton({ children, className = '', style, ...rest }) {
  return (
    <button
      type="button"
      className={cx('inline-flex items-center gap-1.5 transition-colors', className)}
      style={{
        fontFamily: MONO, fontSize: 11, color: P.ink, background: 'transparent',
        border: `1px solid rgba(255,255,255,0.14)`, borderRadius: 8, padding: '7px 13px', ...style,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ─────────────── Charts ─────────────── */

function Sparkline({ data, color = P.gold, height = 84 }) {
  if (!data || data.length < 2) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height, marginTop: 14, border: `1px dashed ${P.lineMid}`, borderRadius: 10 }}
      >
        <Mono style={{ fontSize: 10.5, color: P.faint }}>TVL history — awaiting indexer</Mono>
      </div>
    );
  }
  const w = 320;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [
    (i * w) / (data.length - 1),
    height - ((v - min) / span) * (height - 14) - 8,
  ]);
  const line = 'M' + pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' L');
  const area = `${line} L${w},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, marginTop: 14 }}>
      <defs>
        <linearGradient id="av-tvlg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#av-tvlg)" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function AccuracyBars({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height: 60 }}>
        <Mono style={{ fontSize: 10.5, color: P.faint }}>no decisions yet</Mono>
      </div>
    );
  }
  const max = Math.max(...data) || 1;
  return (
    <div className="flex items-end" style={{ gap: 4, height: 60 }}>
      {data.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1, borderRadius: '3px 3px 0 0',
            background: 'linear-gradient(180deg,#e3b34e,#7a6128)',
            height: `${Math.max(8, (v / max) * 100)}%`,
          }}
        />
      ))}
    </div>
  );
}

// Radial risk dial — r=60, stroke 9, like the mockup's Risk Aggregate gauge
function RiskRing({ value, tone = 'emerald' }) {
  const r = 60;
  const circ = 2 * Math.PI * r;
  const hasValue = typeof value === 'number';
  const pct = hasValue ? Math.min(1, Math.max(0, value / 100)) : 0;
  const color = ACCENT[tone] || P.emerald;
  return (
    <div className="relative mx-auto" style={{ width: 148, height: 148, margin: '8px auto 4px' }}>
      <svg width="148" height="148" viewBox="0 0 148 148">
        <circle cx="74" cy="74" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
        <circle
          cx="74" cy="74" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={circ.toFixed(2)} strokeDashoffset={(circ * (1 - pct)).toFixed(2)}
          transform="rotate(-90 74 74)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-1px', color: P.ink }}>
          {hasValue ? value : '—'}
        </span>
        <Mono style={{ fontSize: 10, letterSpacing: '1.5px', color: P.faint }}>RISK SCORE</Mono>
      </div>
    </div>
  );
}

/* ─────────────── Hero ─────────────── */

function Hero({
  tvl, tvlSource, tvlDelta, caption, sparklineData,
  onCreateVault, onRunCycle,
}) {
  return (
    <Card
      className="relative overflow-hidden grid gap-8 lg:gap-10"
      style={{ borderRadius: 16, padding: 38, gridTemplateColumns: '1fr' }}
    >
      <div
        aria-hidden
        className="absolute pointer-events-none"
        style={{ top: -120, right: -60, width: 420, height: 420, background: `radial-gradient(circle, rgba(227,179,78,0.10), transparent 65%)` }}
      />
      <div className="relative grid gap-8 lg:gap-10" style={{ gridTemplateColumns: '1fr' }}>
        <div className="grid gap-8 lg:gap-10 lg:[grid-template-columns:1.3fr_1fr]">
          {/* Left */}
          <div className="relative">
            <Label style={{ letterSpacing: '1.8px', marginBottom: 20, display: 'block' }}>Platform Overview · 2026</Label>
            <h1
              className="m-0"
              style={{ fontSize: 'clamp(30px, 4vw, 42px)', lineHeight: 1.12, fontWeight: 600, letterSpacing: '-1px', color: P.ink, marginBottom: 16 }}
            >
              Every vault <span style={{ color: P.gold }}>on record</span>,<br />in one ledger.
            </h1>
            <p style={{ fontSize: 15, lineHeight: 1.65, color: P.sub, maxWidth: 440, margin: '0 0 28px' }}>
              A sovereign orchestration layer for autonomous vaults. Deploy strategy agents, stream cycles
              on-chain, and let the protocol keep the receipts.
            </p>
            <div className="flex gap-2.5 flex-wrap">
              {onCreateVault}
              {onRunCycle}
              <Link
                to="/marketplace"
                className="inline-flex items-center gap-1.5 transition-colors"
                style={{ fontSize: 13.5, fontWeight: 500, color: P.sub, padding: '11px 14px' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = P.ink)}
                onMouseLeave={(e) => (e.currentTarget.style.color = P.sub)}
              >
                Browse Marketplace →
              </Link>
            </div>
          </div>

          {/* Right — TVL */}
          <div
            className="relative flex flex-col justify-between lg:pl-9 lg:border-l"
            style={{ borderColor: P.line }}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label style={{ letterSpacing: '1.5px' }}>Total Value Locked</Label>
                <Chip tone="emerald" dot>{tvlSource}</Chip>
              </div>
              <div className="flex items-baseline gap-2.5" style={{ marginTop: 14 }}>
                <span style={{ fontSize: 46, fontWeight: 600, letterSpacing: '-1.5px', color: P.ink }}>{formatUsdCompact(tvl)}</span>
                {tvlDelta && (
                  <Mono style={{ fontSize: 13, color: tvlDelta.startsWith('-') ? P.rose : P.emerald }}>{tvlDelta}</Mono>
                )}
              </div>
              <Mono style={{ fontSize: 11, color: P.faint, marginTop: 4, display: 'block' }}>
                {caption}
              </Mono>
            </div>
            <Sparkline data={sparklineData} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function formatUsdCompact(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}

/* ─────────────── KPI row ─────────────── */

function KpiCard({ label, value, suffix, sub, chip }) {
  return (
    <Card style={{ padding: 20 }}>
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {chip}
      </div>
      <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.5px', marginTop: 14, color: P.ink }}>
        {value}
        {suffix && <span style={{ fontSize: 16, color: P.faint, fontWeight: 400 }}>{suffix}</span>}
      </div>
      <Mono className="block" style={{ fontSize: 11, color: P.muted, marginTop: 6 }}>{sub}</Mono>
    </Card>
  );
}

/* ─────────────── Protocol Health ─────────────── */

function ProtocolHealthSection({ status }) {
  const cycles = status?.cycleCount ?? 0;
  const executions = status?.totalExecutions ?? 0;
  const blocked = status?.totalBlocked ?? 0;
  const pending = status?.pendingApprovalCount ?? 0;
  const isRunning = !!status?.running;

  const tiles = [
    { k: 'Cycles', v: cycles.toLocaleString(), sub: 'this orchestrator' },
    { k: 'Executions', v: executions.toLocaleString(), sub: 'this orchestrator' },
    { k: 'Blocked', v: blocked.toLocaleString(), sub: 'vetoed · guardrail' },
    { k: 'Pending', v: pending.toLocaleString(), sub: 'awaiting approval' },
  ];

  return (
    <Card style={{ padding: 24 }}>
      <CardHead
        title="Protocol Health"
        subtitle="connected orchestrator · lineage"
        className="mb-5"
        trailing={
          <Chip tone={isRunning ? 'emerald' : 'gold'} dot>{isRunning ? 'LIVE · STREAMING' : 'IDLE · READY'}</Chip>
        }
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <div key={t.k} style={{ background: P.inner, borderRadius: 11, padding: 16 }}>
            <Label style={{ fontSize: 10, letterSpacing: '1.2px' }}>{t.k}</Label>
            <div style={{ fontSize: 24, fontWeight: 600, marginTop: 10, color: P.ink }}>{t.v}</div>
            <Mono className="block" style={{ fontSize: 10.5, color: P.muted, marginTop: 4 }}>{t.sub}</Mono>
          </div>
        ))}
      </div>
      <div
        className="flex items-center justify-between flex-wrap gap-2"
        style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${P.lineMid}` }}
      >
        <Mono style={{ fontSize: 11, color: P.faint }}>Staking · Treasury · insurance paid via governance</Mono>
        <Link to="/marketplace" style={{ fontFamily: MONO, fontSize: 11, color: P.gold }}>Browse operators →</Link>
      </div>
    </Card>
  );
}

/* ─────────────── AI Signal ─────────────── */

function AISignalSection({ signal, signalStats, signalTxHref, isDemo }) {
  const noSignal = !signal;
  const action = signal?.action ? String(signal.action).toUpperCase() : 'HOLD';
  const asset = signal?.asset || 'USDC';
  const conf = signal?.confidence ?? 0;
  const chipTone = action === 'BUY' ? 'emerald' : action === 'SELL' ? 'rose' : 'gold';

  const hasRealStats = signalStats && Array.isArray(signalStats.accuracy) && signalStats.accuracy.length > 0;
  const rollingAcc = hasRealStats ? signalStats.accuracy : [];
  const accuracyValue = hasRealStats ? Math.round(rollingAcc[rollingAcc.length - 1] || 0) : null;

  const features = signal ? [
    { k: 'edge_score', v: signal.final_edge_score ?? '—' },
    { k: 'risk_score', v: signal.risk_score != null ? (signal.risk_score * 100).toFixed(0) : '—' },
    { k: 'regime', v: signal.regime || '—' },
    { k: 'approval', v: signal.approval_tier || '—' },
    { k: 'hard_veto', v: signal.hard_veto ? 'yes' : 'no' },
    { k: 'quality', v: signal.trade_quality_score ?? '—' },
  ] : [];

  return (
    <Card style={{ padding: 24 }}>
      <CardHead
        title="Latest AI Signal"
        subtitle={`model reasoning · ${signal?.source || 'local + engine-v1'}`}
        className="mb-5"
        trailing={<Link to="/app/actions" style={{ fontFamily: MONO, fontSize: 11, color: P.muted }}>All signals →</Link>}
      />
      <div className="grid gap-5 lg:[grid-template-columns:1.25fr_1fr]">
        {/* Reasoning */}
        <div style={{ background: P.inner, borderRadius: 12, padding: 20 }}>
          <div className="flex items-center gap-2.5 flex-wrap" style={{ marginBottom: 14 }}>
            <Mono style={{ fontSize: 12, fontWeight: 600, color: P.sub }}>{action} {asset}</Mono>
            <Chip tone={chipTone}>{action}</Chip>
            {isDemo && <Chip tone="gold">DEMO</Chip>}
            {signal?.hard_veto && <Chip tone="rose">VETO</Chip>}
          </div>
          {noSignal ? (
            <p style={{ fontSize: 13.5, lineHeight: 1.55, color: P.body, margin: 0 }}>
              No live AI signal recorded yet. Set a vault executor, start the orchestrator, and trigger the first
              cycle — decisions, vetoes, and confidence scores land here.
            </p>
          ) : (
            <p style={{ fontSize: 13.5, lineHeight: 1.55, color: P.body, margin: '0 0 18px' }}>{signal.reason}</p>
          )}

          {!noSignal && (
            <>
              <div className="flex items-center justify-between" style={{ marginBottom: 7 }}>
                <Label style={{ letterSpacing: '1px' }}>Confidence</Label>
                <Mono style={{ fontSize: 10.5, color: P.ink }}>{conf.toFixed(2)} / 1.00</Mono>
              </div>
              <div style={{ height: 7, borderRadius: 99, background: P.track, overflow: 'hidden', marginBottom: 18 }}>
                <div style={{ height: '100%', width: `${Math.min(100, Math.round(conf * 100))}%`, borderRadius: 99, background: 'linear-gradient(90deg,#b8923f,#e3b34e)' }} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {features.map((f) => (
                  <Mono
                    key={f.k}
                    style={{ fontSize: 10.5, color: P.muted, background: P.tag, border: `1px solid ${P.lineSoft}`, padding: '4px 9px', borderRadius: 6 }}
                  >
                    {f.k} <span style={{ color: P.gold }}>{f.v}</span>
                  </Mono>
                ))}
                {signalTxHref && (
                  <a
                    href={signalTxHref} target="_blank" rel="noreferrer"
                    style={{ fontFamily: MONO, fontSize: 10.5, color: P.gold, background: 'rgba(227,179,78,0.1)', padding: '4px 9px', borderRadius: 6 }}
                  >
                    tx ↗
                  </a>
                )}
              </div>
            </>
          )}
        </div>

        {/* Accuracy */}
        <div className="flex flex-col" style={{ background: P.inner, borderRadius: 12, padding: 20 }}>
          <div className="flex items-center justify-between">
            <Label style={{ fontSize: 10.5, letterSpacing: '1.2px' }}>Rolling Accuracy · 30d</Label>
            {!hasRealStats && <Chip tone="gold">NO DATA</Chip>}
          </div>
          <div className="flex items-baseline gap-1.5" style={{ marginTop: 8 }}>
            <span style={{ fontSize: 38, fontWeight: 600, letterSpacing: '-1px', color: P.ink }}>
              {accuracyValue == null ? '—' : accuracyValue}
            </span>
            {accuracyValue != null && <Mono style={{ fontSize: 12, color: P.emerald }}>% hit</Mono>}
          </div>
          <div style={{ margin: '16px 0 18px' }}>
            <AccuracyBars data={rollingAcc} />
          </div>
          <div
            className="flex justify-between mt-auto"
            style={{ paddingTop: 14, borderTop: `1px solid ${P.lineMid}` }}
          >
            <MiniStat label="SIGNALS" value={signalStats?.totalSignals ?? '—'} />
            <MiniStat label="HITS" value={signalStats?.totalHits ?? '—'} color={P.emerald} />
            <MiniStat label="VETOS" value={signalStats?.totalVeto ?? '—'} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function MiniStat({ label, value, color = P.ink }) {
  return (
    <div>
      <Mono style={{ fontSize: 10, color: P.faint }}>{label}</Mono>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 3, color }}>{value}</div>
    </div>
  );
}

/* ─────────────── Operator Leaderboard ─────────────── */

const OP_COLS = '36px 1fr 90px 110px 70px 150px';

function OperatorLeaderboard({ operators, tiersByAddress, reputationByAddress }) {
  const ranked = useMemo(() => {
    return (operators || [])
      .map((op) => {
        const tier = tiersByAddress?.[op.wallet?.toLowerCase()] || {};
        const stake = Number(tier.stakedAmount || 0);
        const tierVal = Number(tier.tier || 0);
        // Real on-chain reputation (0..100 composite). reputationScore() returns
        // 0 when an operator has no recorded executions — we keep `hasRep` so the
        // bar/score render '—' instead of a fabricated number in that case.
        const repState = reputationByAddress?.[op.wallet?.toLowerCase()] || null;
        const rep = reputationScore(repState);
        const hasRep = !!repState && repState.totalExecutions > 0;
        const feeInv = 10000 - (Number(op.performanceFeeBps) || 0);
        const score = rep * 1_000_000 + stake * (1 + tierVal) + feeInv;
        return { ...op, stake, tier: tierVal, rep, hasRep, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [operators, tiersByAddress, reputationByAddress]);

  if (!ranked.length) return null;

  const stakeLabel = (s) => (s > 0 ? `${(s / 1000).toFixed(1)}K` : '—');

  return (
    <Card style={{ padding: 24 }}>
      <CardHead
        title="Operator Leaderboard"
        subtitle="ranked by stake × reputation"
        className="mb-4"
        trailing={<Link to="/marketplace"><GhostButton>View Marketplace →</GhostButton></Link>}
      />
      <div className="overflow-x-auto -mx-1 px-1">
      <div style={{ minWidth: 560 }}>
      <div
        className="hidden lg:grid"
        style={{ gridTemplateColumns: OP_COLS, gap: 12, padding: '0 4px 12px', borderBottom: `1px solid ${P.lineMid}` }}
      >
        {['#', 'Operator', 'Staked', 'Mandate', 'Fee', 'Reputation'].map((h) => (
          <Label key={h} style={{ fontSize: 10, letterSpacing: '1px' }}>{h}</Label>
        ))}
      </div>
      {ranked.map((op, i) => {
        const mandate = op.mandateLabel || '—';
        const feePct = ((op.performanceFeeBps || 0) / 100).toFixed(1);
        const ini = (op.name?.slice(0, 1) || 'O').toUpperCase();
        const col = i === 0 ? '#8b8ff0' : i === 1 ? '#5fc2b8' : '#c9a3e0';
        return (
          <Link
            key={op.wallet}
            to={`/operator/${op.wallet}`}
            className="grid items-center transition-colors"
            style={{ gridTemplateColumns: OP_COLS, gap: 12, padding: '14px 4px', borderBottom: i < ranked.length - 1 ? `1px solid ${P.lineSoft}` : 'none' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Mono style={{ fontSize: 13, color: P.faint }}>{String(i + 1).padStart(2, '0')}</Mono>
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{ width: 32, height: 32, borderRadius: 9, background: col, fontWeight: 600, fontSize: 13, color: P.bg }}
              >
                {ini}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate" style={{ fontSize: 13.5, fontWeight: 500, color: P.ink }}>{op.name || 'Operator'}</span>
                  {i === 0 && <Chip tone="gold">TOP</Chip>}
                </div>
                <Mono className="block truncate" style={{ fontSize: 11, color: P.faint, marginTop: 2 }}>
                  {op.wallet ? `${op.wallet.slice(0, 6)}…${op.wallet.slice(-4)}` : 'unbonded'}
                </Mono>
              </div>
            </div>
            <Mono style={{ fontSize: 13, color: P.muted }}>{stakeLabel(op.stake)}</Mono>
            <Mono className="w-fit" style={{ fontSize: 10.5, fontWeight: 600, color: P.sub, background: P.tag, padding: '5px 10px', borderRadius: 6, letterSpacing: '0.5px' }}>{mandate}</Mono>
            <Mono style={{ fontSize: 13, color: P.ink }}>{feePct}%</Mono>
            <div className="flex items-center gap-2.5">
              <div className="flex-1" style={{ height: 6, borderRadius: 99, background: P.track, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${op.hasRep ? op.rep : 0}%`, background: P.gold, borderRadius: 99 }} />
              </div>
              <Mono style={{ fontSize: 12, color: P.muted }}>{op.hasRep ? op.rep : '—'}</Mono>
            </div>
          </Link>
        );
      })}
      </div>
      </div>
    </Card>
  );
}

/* ─────────────── Right rail ─────────────── */

function RailCard({ title, trailing, children, style }) {
  return (
    <Card style={{ padding: 22, ...style }}>
      {title && (
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <h3 className="m-0" style={{ fontSize: 14, fontWeight: 600, color: P.ink }}>{title}</h3>
          {trailing}
        </div>
      )}
      {children}
    </Card>
  );
}

function YourVaultCard({ vault, isConnected }) {
  if (!isConnected || !vault) {
    return (
      <RailCard title="Your Vault" trailing={<Chip tone={isConnected ? 'steel' : 'rose'}>NONE</Chip>}>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: P.sub, margin: '0 0 16px' }}>
          {isConnected
            ? 'This wallet owns no vaults yet. Protocol state stays visible — deploy one to begin.'
            : 'Connect a wallet to view vault ownership. Protocol state stays visible without one.'}
        </p>
        {!isConnected ? (
          <WalletButton />
        ) : (
          <Link to="/create">
            <button
              type="button" className="w-full transition-colors"
              style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: P.bg, background: P.gold, border: 'none', borderRadius: 9, padding: 11 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = P.goldHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = P.gold)}
            >
              + Create Vault
            </button>
          </Link>
        )}
      </RailCard>
    );
  }

  const short = `${vault.address?.slice(0, 6)}…${vault.address?.slice(-4)}`;
  const isPaused = !!vault.paused;
  const nav = vault.nav ?? (vault.balance ? parseFloat(vault.balance) : 0);
  return (
    <RailCard title="Your Vault" trailing={<Chip tone={isPaused ? 'gold' : 'emerald'}>{isPaused ? 'PAUSED' : 'ACTIVE'}</Chip>}>
      <div className="flex items-baseline gap-2">
        <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-1px', color: P.ink }}>{formatUsdCompact(nav)}</span>
      </div>
      <Mono className="block" style={{ fontSize: 11, color: P.faint, marginTop: 4 }}>
        {vault.name ? `${vault.name} · ` : ''}{short}
      </Mono>
      <Link to={getVaultRoute(vault.address)}>
        <button
          type="button" className="w-full transition-colors"
          style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: P.ink, background: 'transparent', border: `1px solid rgba(255,255,255,0.14)`, borderRadius: 9, padding: 10, marginTop: 16 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          Inspect Vault →
        </button>
      </Link>
    </RailCard>
  );
}

function RiskRailCard({ score, level, confidence }) {
  const hasScore = typeof score === 'number';
  const tone = !hasScore ? 'emerald' : score < 30 ? 'emerald' : score < 60 ? 'gold' : 'rose';
  return (
    <RailCard
      title="Risk Aggregate"
      trailing={<Chip tone={tone}>{hasScore ? (level || 'STEADY').toUpperCase() : 'NO SIGNAL'}</Chip>}
      style={{ paddingBottom: 22 }}
    >
      <RiskRing value={hasScore ? score : null} tone={tone} />
      <div
        className="grid grid-cols-3 gap-2"
        style={{ marginTop: 14, paddingTop: 16, borderTop: `1px solid ${P.lineMid}` }}
      >
        <RailStat label="CONF" value={confidence != null ? confidence.toFixed(2) : '—'} />
        <RailStat label="LEVEL" value={hasScore ? (level || 'Low') : '—'} color={hasScore ? P.emerald : P.ink} />
        <RailStat label="SLIP" value="—" />
      </div>
    </RailCard>
  );
}

function RailStat({ label, value, color = P.ink }) {
  return (
    <div>
      <Mono style={{ fontSize: 10, color: P.faint }}>{label}</Mono>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 3, color }}>{value}</div>
    </div>
  );
}

function MarketPricesCard({ prices, isLive }) {
  const entries = prices ? Object.entries(prices) : [];
  return (
    <RailCard
      title="Market · Pyth"
      trailing={
        <Mono className="flex items-center gap-1.5" style={{ fontSize: 10, color: isLive ? P.emerald : P.muted }}>
          <StatusDot tone={isLive ? 'emerald' : 'steel'} size={6} pulse={isLive} /> {isLive ? 'LIVE' : 'IDLE'}
        </Mono>
      }
    >
      {entries.length === 0 ? (
        <div className="text-center" style={{ padding: '16px 0' }}>
          <Mono style={{ fontSize: 12, color: P.sub }}>Waiting on Pyth snapshot…</Mono>
        </div>
      ) : (
        <div className="flex flex-col">
          {entries.map(([sym, data], i) => {
            const price = data.price;
            const formatted = price != null ? price.toLocaleString(undefined, { maximumFractionDigits: sym === 'USDC' ? 4 : 2 }) : '—';
            return (
              <div
                key={sym}
                className="flex items-center justify-between"
                style={{ padding: '9px 0', borderBottom: i < entries.length - 1 ? `1px solid ${P.lineSoft}` : 'none' }}
              >
                <div className="flex items-center gap-2.5">
                  <TokenIcon symbol={sym} size={28} />
                  <div>
                    <Mono style={{ fontSize: 12.5, fontWeight: 500, color: P.ink, display: 'block' }}>{sym}/USD</Mono>
                    <Mono style={{ fontSize: 10, color: P.faint }}>{TOKEN_NAME[sym?.toUpperCase()] || sym}</Mono>
                  </div>
                </div>
                <Mono style={{ fontSize: 12.5, color: P.ink }}>${formatted}</Mono>
              </div>
            );
          })}
        </div>
      )}
    </RailCard>
  );
}

const TOKEN_NAME = { BTC: 'Bitcoin', WBTC: 'Bitcoin', ETH: 'Ethereum', WETH: 'Ethereum', USDC: 'USD Coin', '0G': '0G', W0G: '0G', SOL: 'Solana' };

function ExecutionTapeCard({ events }) {
  const idle = !events || events.length === 0;
  return (
    <RailCard
      title="Execution Tape"
      trailing={
        <Mono className="flex items-center gap-1.5" style={{ fontSize: 10, color: idle ? P.muted : P.gold }}>
          <StatusDot tone={idle ? 'steel' : 'gold'} size={6} pulse={!idle} /> {idle ? 'IDLE' : 'STREAMING'}
        </Mono>
      }
    >
      {idle ? (
        <div className="text-center" style={{ padding: '24px 8px' }}>
          <Mono style={{ fontSize: 13, color: P.sub, display: 'block' }}>Waiting for the first heartbeat…</Mono>
          <Mono style={{ fontSize: 11, color: P.faint, marginTop: 8, lineHeight: 1.5, display: 'block' }}>
            Trigger the orchestrator and cycles stream here as they settle on-chain.
          </Mono>
        </div>
      ) : (
        <div className="flex flex-col">
          {events.map((e, i) => (
            <div
              key={e.id || i}
              className="flex gap-2.5"
              style={{ padding: '10px 0', borderBottom: i < events.length - 1 ? `1px solid ${P.lineSoft}` : 'none' }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 999, background: ACCENT[e.tone] || P.violet, marginTop: 5, flex: 'none' }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <Mono className="truncate" style={{ fontSize: 11, fontWeight: 600, color: P.ink }}>{e.label}</Mono>
                  <Mono style={{ fontSize: 10, color: P.faint, flexShrink: 0 }}>{e.time}</Mono>
                </div>
                <div className="flex items-center gap-1.5" style={{ marginTop: 2 }}>
                  <Mono className="truncate" style={{ fontSize: 11, color: P.muted }}>{e.detail}</Mono>
                  {e.txHref && (
                    <a href={e.txHref} target="_blank" rel="noreferrer" style={{ color: P.gold, flexShrink: 0 }}>↗</a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </RailCard>
  );
}

/* ─────────────── Live-readiness banner (only when contracts missing) ─────────────── */

function LiveReadinessBanner({ chainId, deployments, displayStatus }) {
  const activeFactory = deployments.aegisVaultFactoryV2 || deployments.aegisVaultFactory;
  const activeRegistry = deployments.operatorRegistryV2 || deployments.operatorRegistry;
  const cards = [
    { label: 'Vault Factory', ok: isConfiguredAddress(activeFactory), addr: activeFactory, href: getExplorerAddressHref(chainId, activeFactory) },
    { label: 'Operator Registry', ok: isConfiguredAddress(activeRegistry), addr: activeRegistry, href: getExplorerAddressHref(chainId, activeRegistry) },
    { label: 'Governance', ok: isConfiguredAddress(deployments.aegisGovernor), addr: deployments.aegisGovernor, href: getExplorerAddressHref(chainId, deployments.aegisGovernor) },
  ];
  return (
    <Card style={{ padding: 20, marginBottom: 24 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
        <Chip tone="gold" dot>LIVE MAINNET VIEW</Chip>
        <Mono style={{ fontSize: 10, color: P.muted }}>{getNetworkLabel(chainId)}</Mono>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.label} style={{ background: P.inner, borderRadius: 11, padding: '10px 12px' }}>
            <Label style={{ fontSize: 10, letterSpacing: '1.2px' }}>{c.label}</Label>
            <div style={{ fontSize: 13, marginTop: 4, color: c.ok ? P.emerald : P.rose }}>{c.ok ? 'Live on-chain' : 'Missing'}</div>
            {c.href ? (
              <a href={c.href} target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 10, color: P.gold }}>{shortHexLabel(c.addr)}</a>
            ) : (
              <Mono style={{ fontSize: 10, color: P.faint }}>{c.addr || 'not configured'}</Mono>
            )}
          </div>
        ))}
      </div>
      {!displayStatus && (
        <div style={{ marginTop: 12, borderRadius: 11, padding: '10px 12px', background: 'rgba(227,179,78,0.06)', border: `1px solid rgba(227,179,78,0.2)` }}>
          <Label style={{ color: P.gold, letterSpacing: '1.2px' }}>Telemetry pending</Label>
          <p style={{ fontSize: 11.5, lineHeight: 1.55, color: P.sub, marginTop: 4 }}>
            Point the orchestrator at <Mono style={{ color: P.gold }}>{ORCHESTRATOR_URL || 'VITE_ORCHESTRATOR_URL'}</Mono> to
            stream signals, prices, and alerts onto this screen.
          </p>
        </div>
      )}
    </Card>
  );
}

/* ─────────────── Risk helper ─────────────── */

function computeRisk(signal, fallback) {
  if (!signal?.confidence) return fallback;
  let score = 5;
  const c = signal.confidence;
  score += c < 0.4 ? 20 : c < 0.6 ? 12 : c < 0.8 ? 5 : 0;
  if (signal.hard_veto) score += 25;
  const bounded = Math.min(100, Math.max(0, score));
  return {
    score: bounded,
    level: bounded < 30 ? 'Low' : bounded < 60 ? 'Moderate' : bounded < 80 ? 'Elevated' : 'Critical',
  };
}

const EVENT_TONE = {
  executed: { tone: 'emerald', label: 'CYCLE SETTLED' },
  info: { tone: 'violet', label: 'ORACLE TICK' },
  warning: { tone: 'gold', label: 'SIGNAL EMITTED' },
  critical: { tone: 'rose', label: 'EXECUTION BLOCKED' },
  blocked: { tone: 'rose', label: 'EXECUTION BLOCKED' },
};

/* ─────────────── Page ─────────────── */

export default function DashboardPage() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);

  const { vaults: myVaults, count: myCount } = useVaultList(deployments.aegisVaultFactory, address);
  const { vaults: allVaults, isLoading: allLoading, total: totalVaults } = useAllPlatformVaults(deployments.aegisVaultFactory);
  const { data: orchStatus } = useOrchestratorStatus();
  const { data: protocolAlerts } = useAlerts(6);
  const { data: protocolExecutions } = useExecutions(6);

  // Merge the success + failure journal streams into one execution tape (six
  // most recent, regardless of type) — without this the tape silently omits
  // every settled swap and looks stuck on the last veto.
  const protocolEvents = useMemo(() => {
    const alertList = Array.isArray(protocolAlerts) ? protocolAlerts : [];
    const execList = Array.isArray(protocolExecutions) ? protocolExecutions : [];
    const mapped = [
      ...alertList.map((e) => ({
        ...e,
        _level: e.level || 'critical',
        _title: e.message || e.reason || `Execution failed${e.action ? ` · ${e.action.toUpperCase()} ${e.asset || ''}`.trim() : ''}`,
      })),
      ...execList.map((e) => ({
        ...e,
        _level: e.success === false ? 'critical' : 'executed',
        _title: e.success === false
          ? `Execution reverted${e.action ? ` · ${e.action.toUpperCase()} ${e.asset || ''}`.trim() : ''}`
          : `${(e.action || 'trade').toUpperCase()} settled${e.asset ? ` · ${e.asset}` : ''}`,
      })),
    ];
    mapped.sort((a, b) => {
      const ta = new Date(a.timestamp || a.ts || a.time || 0).getTime();
      const tb = new Date(b.timestamp || b.ts || b.time || 0).getTime();
      return tb - ta;
    });
    return mapped.slice(0, 6).map((e, i) => {
      const meta = EVENT_TONE[e._level] || EVENT_TONE.info;
      const ts = e.timestamp || e.ts || e.time;
      let time = '—:—:—';
      if (ts) {
        const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
        if (!Number.isNaN(d.getTime())) {
          time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        }
      }
      return {
        id: e.id || `e-${i}`,
        tone: meta.tone,
        label: e._title?.split('·')[0]?.trim() || meta.label,
        detail: e.vault ? `vault ${e.vault.slice(0, 6)}…${e.vault.slice(-4)}` : (e._title || 'event'),
        time,
        txHref: e.txHash ? getExplorerTxHref(chainId, e.txHash) : null,
      };
    });
  }, [protocolAlerts, protocolExecutions, chainId]);

  const { operators: marketplaceOps } = useOperatorList(deployments.operatorRegistryV2 || deployments.operatorRegistry);
  const activeMarketplaceOps = marketplaceOps.filter((op) => op.loaded && op.active);
  const marketplaceAddrs = activeMarketplaceOps.map((op) => op.wallet);
  const { tiersByAddress } = useOperatorTiers(deployments.operatorStakingV2 || deployments.operatorStaking, marketplaceAddrs);
  const { reputationByAddress } = useOperatorReputations(deployments.operatorReputation, marketplaceAddrs);
  const { data: pythPrices } = usePythPrices();
  const { data: platformDecisions } = useDecisions(100);

  const myAddrsLower = new Set(myVaults.map((v) => v.address?.toLowerCase()));
  const otherVaults = allVaults.filter((v) => !myAddrsLower.has(v.address?.toLowerCase()));
  const runningCount = allVaults.filter((v) => v.loaded && !v.paused).length;

  const allVaultAddrs = allVaults.map((v) => v.address).filter(Boolean);
  const { tvl: platformTVL, source: tvlSource } = usePlatformTVL(allVaultAddrs);

  const showDemoExperience = ENABLE_DEMO_FALLBACKS && (!isConnected || (!allLoading && totalVaults === 0));
  const displayMyVaults = showDemoExperience ? demoVaults.slice(0, 2) : myVaults;
  const displayMyCount = showDemoExperience ? demoPlatformSnapshot.myVaults : myCount;
  const displayTotalVaults = showDemoExperience ? demoPlatformSnapshot.totalVaults : totalVaults;
  const displayRunningCount = showDemoExperience ? demoPlatformSnapshot.runningVaults : runningCount;
  const displayPlatformTVL = showDemoExperience ? demoPlatformSnapshot.platformTVL : platformTVL;
  const displayTVLSource = showDemoExperience ? 'Demo · live' : tvlSource || 'Pyth Oracle';
  const displaySignal = orchStatus?.lastSignal || (showDemoExperience ? demoSignal : null);
  const displayStatus = orchStatus || (showDemoExperience ? demoStatus : null);
  const displayPrices = pythPrices || (showDemoExperience ? demoPythPrices : null);
  // Honest fallback: demo risk only under demo mode; on the live page with no
  // signal, render an explicit unknown state (not a hardcoded score).
  const risk = computeRisk(displaySignal, showDemoExperience ? demoPlatformSnapshot.aggregateRisk : { score: null, level: '—' });

  const primaryVault = displayMyVaults[0] || (otherVaults[0] && !showDemoExperience ? otherVaults[0] : displayMyVaults[0]);

  const hasVaultFactory = isConfiguredAddress(deployments.aegisVaultFactoryV2 || deployments.aegisVaultFactory);
  const allContractsDeployed =
    hasVaultFactory &&
    isConfiguredAddress(deployments.operatorRegistryV2 || deployments.operatorRegistry) &&
    isConfiguredAddress(deployments.aegisGovernor);

  const signalTxHref = getExplorerTxHref(chainId, displaySignal?.txHash);

  // Platform TVL time-series from the orchestrator indexer (one point per
  // cycle, ascending). We never synthesize a trend — when the series is empty
  // (nothing indexed yet) the hero sparkline renders its honest "awaiting
  // indexer" placeholder via Sparkline's < 2-points guard.
  const { data: tvlHistory } = useTvlHistory();
  const sparklineData = useMemo(
    () => (Array.isArray(tvlHistory)
      ? tvlHistory.map((p) => p?.tvl).filter((v) => Number.isFinite(v))
      : []),
    [tvlHistory],
  );

  // Rolling accuracy — bucket the last 30 days of AI decisions and compute
  // non-veto rate per bucket. Null when the orchestrator has emitted nothing.
  const signalStats = useMemo(() => {
    if (!Array.isArray(platformDecisions) || platformDecisions.length === 0) return null;
    const timestamps = platformDecisions.map((d) => new Date(d.timestamp).getTime()).filter(Number.isFinite);
    if (timestamps.length === 0) return null;
    const newest = Math.max(...timestamps);
    const cutoff = newest - 30 * 24 * 60 * 60 * 1000;
    const recent = platformDecisions.filter((d) => {
      const ts = new Date(d.timestamp).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    });
    if (recent.length === 0) return null;
    const ordered = [...recent].reverse();
    const numBuckets = Math.min(16, ordered.length);
    const buckets = Array.from({ length: numBuckets }, () => ({ total: 0, veto: 0 }));
    ordered.forEach((d, i) => {
      const idx = Math.min(numBuckets - 1, Math.floor((i / ordered.length) * numBuckets));
      buckets[idx].total += 1;
      if (d.hard_veto) buckets[idx].veto += 1;
    });
    const accuracy = buckets.map((b) => (b.total === 0 ? 0 : Math.round((1 - b.veto / b.total) * 100)));
    const totalSignals = recent.length;
    const totalVeto = recent.filter((d) => d.hard_veto).length;
    return { accuracy, totalSignals, totalHits: totalSignals - totalVeto, totalVeto };
  }, [platformDecisions]);

  const deltaPct = showDemoExperience ? '▲ 12.4%' : null;
  const operatorCount = activeMarketplaceOps.length || (showDemoExperience ? 5 : 0);

  const vaultsHint = showDemoExperience
    ? `${displayRunningCount} running · ${displayMyCount} featured`
    : isConnected
      ? `${displayRunningCount} running · ${displayMyCount} owned`
      : `${displayRunningCount} running · wallet off`;

  const networkLabel = getNetworkLabel(chainId);

  // Platform-wide on-chain execution count — summed from OperatorReputation
  // across operators. Unlike the orchestrator's per-process cycleCount, this is
  // an on-chain trail: correct regardless of how many orchestrators run (or
  // whether any is online), since each operator's executions are recorded
  // on-chain by whichever orchestrator manages it.
  const platformExecutions = useMemo(() => {
    const src = showDemoExperience ? demoOperatorReputations : reputationByAddress;
    if (!src) return 0;
    return Object.values(src).reduce((sum, s) => sum + (Number(s?.totalExecutions) || 0), 0);
  }, [showDemoExperience, reputationByAddress]);

  const heroCaption = displayTotalVaults > 0
    ? `across ${displayTotalVaults} vault${displayTotalVaults === 1 ? '' : 's'} · ${networkLabel}`
    : `${networkLabel} · no vaults yet`;

  return (
    <div style={{ background: P.bg, fontFamily: SANS, color: P.ink, minHeight: '100vh', paddingBottom: 40 }}>
      <div className="mx-auto max-w-[1540px] px-4 lg:px-6 py-6 lg:py-8">
        {!showDemoExperience && !allContractsDeployed && (
          <LiveReadinessBanner chainId={chainId} deployments={deployments} displayStatus={displayStatus} />
        )}

        {/* Hero */}
        <div style={{ marginBottom: 24 }}>
          <Hero
            tvl={displayPlatformTVL}
            tvlSource={displayTVLSource}
            tvlDelta={deltaPct}
            caption={heroCaption}
            sparklineData={sparklineData}
            onCreateVault={
              <Link to="/create">
                <button
                  type="button" className="inline-flex items-center gap-1.5 transition-colors"
                  style={{ fontSize: 13.5, fontWeight: 600, color: P.bg, background: P.gold, border: 'none', borderRadius: 10, padding: '11px 18px' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = P.goldHover)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = P.gold)}
                >
                  + Create Vault
                </button>
              </Link>
            }
            onRunCycle={
              <Link to="/app/actions">
                <button
                  type="button" className="inline-flex items-center gap-1.5 transition-colors"
                  style={{ fontSize: 13.5, fontWeight: 500, color: P.ink, background: 'transparent', border: `1px solid rgba(255,255,255,0.14)`, borderRadius: 10, padding: '11px 18px' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  ▶ Run Cycle
                </button>
              </Link>
            }
          />
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" style={{ marginBottom: 24 }}>
          <KpiCard
            label="Active Vaults"
            value={displayTotalVaults || 0}
            sub={vaultsHint}
          />
          <KpiCard
            label="AI Executions"
            value={platformExecutions.toLocaleString()}
            sub={platformExecutions > 0 ? `settled on-chain · ${operatorCount} operator${operatorCount === 1 ? '' : 's'}` : 'settled on-chain · none yet'}
            chip={<Chip tone="steel">ON-CHAIN</Chip>}
          />
          <KpiCard
            label="Operators"
            value={operatorCount}
            sub={operatorCount > 0 ? 'bonded via registry' : 'none registered yet'}
          />
          <KpiCard
            label="Risk Score"
            value={risk.score == null ? '—' : risk.score}
            suffix={risk.score == null ? null : ' / 100'}
            sub={displaySignal?.confidence != null ? `confidence ${displaySignal.confidence.toFixed(2)}` : 'no live signal'}
            chip={<Chip tone={risk.score == null ? 'steel' : risk.score < 30 ? 'emerald' : risk.score < 60 ? 'gold' : 'rose'}>{risk.score == null ? 'N/A' : (risk.level || 'LOW').toUpperCase()}</Chip>}
          />
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 xl:[grid-template-columns:1fr_360px] gap-6 items-start">
          {/* Left column */}
          <div className="flex flex-col gap-6 min-w-0">
            <ProtocolHealthSection status={displayStatus} />
            <AISignalSection
              signal={displaySignal}
              signalTxHref={signalTxHref}
              signalStats={signalStats}
              isDemo={showDemoExperience && !orchStatus?.lastSignal}
            />
            <OperatorLeaderboard operators={activeMarketplaceOps} tiersByAddress={tiersByAddress} reputationByAddress={reputationByAddress} />
          </div>

          {/* Right rail */}
          <aside className="flex flex-col gap-6 xl:sticky xl:top-[88px] self-start">
            <YourVaultCard vault={primaryVault} isConnected={isConnected || showDemoExperience} />
            <RiskRailCard score={risk.score} level={risk.level} confidence={displaySignal?.confidence} />
            <MarketPricesCard prices={displayPrices} isLive={!!pythPrices} />
            <ExecutionTapeCard events={protocolEvents} />
          </aside>
        </div>

        {/* Footer ribbon */}
        <footer
          className="flex items-center justify-center gap-x-6 gap-y-2 flex-wrap"
          style={{ marginTop: 28, paddingTop: 22, borderTop: `1px solid ${P.lineMid}`, fontFamily: MONO, fontSize: 11, color: P.faint }}
        >
          <RibbonItem k="CHAIN" v={`${networkLabel} · ${chainId}`} />
          <RibbonSep />
          <RibbonItem k="CONSENSUS" v="HotStuff-2" />
          <RibbonSep />
          <RibbonItem k="ORACLE" v="Pyth" />
          <RibbonSep />
          <RibbonItem k="INTENT" v="EIP-712 Sealed" />
          <RibbonSep />
          <RibbonItem k="ENGINE" v="GLM-5-FP8 · TEE-Signed" />
        </footer>
      </div>
    </div>
  );
}

function RibbonItem({ k, v }) {
  return (
    <span>{k} <span style={{ color: P.sub }}>{v}</span></span>
  );
}
function RibbonSep() {
  return <span style={{ color: P.track }}>·</span>;
}
