import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import {
  ENABLE_DEMO_FALLBACKS,
  getExplorerAddressHref,
  getExplorerTxHref,
  getDefaultVaultAddress,
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
  useAlerts,
  useDecisions,
  useExecutions,
} from '../hooks/useOrchestrator';
import { useOperatorList } from '../hooks/useOperatorRegistry';
import { useOperatorTiers } from '../hooks/useOperatorStaking';
import {
  demoPlatformSnapshot,
  demoPythPrices,
  demoSignal,
  demoStatus,
  demoVaults,
} from '../data/demoContent';
import WalletButton from '../components/ui/WalletButton';
import ControlButton from '../components/ui/ControlButton';
import TokenIcon from '../components/ui/TokenIcon';
import {
  Shield, Activity, Plus, ArrowRight, ArrowUpRight, Globe,
  Cpu, ExternalLink, Copy, Bolt, Compass, Layers,
  Sparkles, TriangleAlert, Check, Pause, Play,
} from 'lucide-react';
import {
  EyebrowMono as Eyebrow,
  StatusDot,
  ToneChip as Chip,
  GhostNumeral,
  TokenAvatar,
  Sparkline,
  BarSeries,
  RiskGauge,
  SectionHead,
} from '../components/editorial/atoms';
import { cx, ACCENTS } from '../components/editorial/tokens';

const ACCENT_GOLD = ACCENTS.gold;
const ACCENT_EMERALD = ACCENTS.emerald;
const ACCENT_CYAN = ACCENTS.cyan;
const ACCENT_AMBER = ACCENTS.amber;
const ACCENT_ROSE = ACCENTS.rose;

/* ─────────────── Hero ─────────────── */

function Hero({
  accent = ACCENT_GOLD,
  tvl,
  tvlSource,
  tvlDelta,
  cycleCount,
  riskScore,
  riskLevel,
  vaultCountLabel,
  statusLabel,
  networkLabel,
  sparklineData,
  onCreateVault,
  onRunCycle,
  onBrowseMarketplace,
}) {
  const formattedTvl = Math.round(tvl || 0);
  const [tvlInteger, tvlFraction] = formatHeroNumeral(formattedTvl);

  return (
    <section
      className="relative overflow-hidden"
      style={{
        borderRadius: 28,
        background: 'linear-gradient(180deg,#0F0F13 0%,#0A0A0C 100%)',
        boxShadow: 'var(--ed-ghost-border)',
      }}
    >
      <div aria-hidden className="absolute inset-0 ed-dotgrid opacity-60" />
      <div aria-hidden className="absolute inset-0 pointer-events-none ed-grain-light" />
      <div
        aria-hidden
        className="absolute -right-20 -top-20 h-[440px] w-[440px] rounded-full"
        style={{
          background: `radial-gradient(circle at center, ${accent} 0%, transparent 60%)`,
          opacity: 0.18,
          filter: 'blur(8px)',
        }}
      />
      <div aria-hidden className="absolute right-10 top-8 pointer-events-none select-none">
        <GhostNumeral n="26" style={{ fontSize: 180 }} />
      </div>

      <div className="relative grid grid-cols-12 gap-8 p-8 lg:p-10">
        {/* Left column */}
        <div className="col-span-12 lg:col-span-7 flex flex-col gap-6">
          <div className="flex items-center gap-3 flex-wrap">
            <Eyebrow tone="gold">§ A.01 · Platform Overview · 2026</Eyebrow>
            <div className="flex-1 min-w-[40px] ed-hairline" />
            <Chip tone="emerald" leading={<StatusDot tone="emerald" size={5} />}>
              {statusLabel}
            </Chip>
          </div>

          <h1 className="ed-hero-h1 text-[44px] sm:text-[56px] lg:text-[68px] leading-[0.95] m-0">
            Every vault <em>on record,</em><br />
            in <em>one</em> ledger.
          </h1>

          <p
            className="max-w-[560px] text-[14px] sm:text-[14.5px] leading-[1.65] m-0"
            style={{ color: 'var(--ed-steel-300)' }}
          >
            A sovereign orchestration layer for autonomous vaults. Deploy strategy agents, stream their cycles
            on-chain, and let the protocol keep receipts — auditable by block,{' '}
            <span className="ed-italic" style={{ color: 'var(--ed-steel-50)' }}>settled by consensus.</span>
          </p>

          <div className="flex items-center gap-2 flex-wrap mt-1">
            {onCreateVault}
            {onRunCycle}
            {onBrowseMarketplace}
          </div>

          <div className="flex items-center gap-5 pt-4 mt-2 flex-wrap" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <FootStat label="Block Time" value="100" unit="ms" />
            <FootStat label="Consensus" value="HotStuff-2" mono />
            <FootStat label="Trust Model" value="Intent-Signed" mono />
            <FootStat label="Oracle" value="Pyth" mono leading={<StatusDot tone="emerald" size={5} />} />
            <FootStat label="Network" value={networkLabel} mono />
          </div>
        </div>

        {/* Right column */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-5 relative">
          <div className="flex items-start gap-3">
            <Eyebrow tone="muted" className="pt-2">total value locked · cycle {cycleCount ?? 0}</Eyebrow>
            <span className="flex-1 ed-hairline mt-3" />
          </div>
          <div className="flex items-end gap-3 pl-1 -mt-2">
            <span className="ed-italic text-[28px] sm:text-[32px] leading-none pb-6" style={{ color: 'var(--ed-steel-50)' }}>$</span>
            <span className="ed-hero-num text-[96px] sm:text-[128px] lg:text-[140px]">{tvlInteger}</span>
            {tvlFraction && (
              <span className="ed-hero-num text-[40px] sm:text-[56px] pb-4" style={{ color: 'var(--ed-steel-300)' }}>
                {tvlFraction}
              </span>
            )}
            <div className="flex flex-col gap-1.5 pb-5 ml-2">
              <Chip tone="cyan" dense leading={<StatusDot tone="cyan" size={4} />}>{tvlSource}</Chip>
              {tvlDelta && (
                <span className="ed-mono text-[11px]" style={{ color: tvlDelta.startsWith('-') ? ACCENT_ROSE : ACCENT_EMERALD }}>
                  {tvlDelta}
                </span>
              )}
            </div>
          </div>
          <div className="relative h-[88px] rounded-xl overflow-hidden" style={{ background: 'rgba(0,0,0,0.25)', boxShadow: 'var(--ed-ghost-border)' }}>
            <Sparkline data={sparklineData} color={accent} height={88} />
            <div className="absolute inset-0 flex items-end justify-between px-3 pb-1.5 pointer-events-none">
              {['c.80', 'c.85', 'c.90', 'now'].map((l) => (
                <span key={l} className="ed-mono text-[9.5px]" style={{ color: 'var(--ed-steel-500)' }}>{l}</span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <HeroMiniStat label="Active Vaults" value={vaultCountLabel.value} hint={vaultCountLabel.hint} tone="gold" />
            <HeroMiniStat label="AI Cycles" value={String(cycleCount ?? 0)} hint={cycleCount > 0 ? 'orchestrator streaming' : 'awaiting first cycle'} tone="emerald" />
            <HeroMiniStat label="Risk" value={String(riskScore)} hint={`${riskLevel?.toLowerCase() || 'steady'}`} tone={riskScore < 30 ? 'emerald' : riskScore < 60 ? 'amber' : 'rose'} />
          </div>
        </div>
      </div>
    </section>
  );
}

function formatHeroNumeral(n) {
  if (n == null) return ['0', ''];
  if (n >= 1000) {
    // Show in millions / thousands compact: 2.8M, 128K
    if (n >= 1_000_000) {
      const v = n / 1_000_000;
      const str = v >= 10 ? v.toFixed(0) : v.toFixed(1);
      return [str.split('.')[0], `.${(str.split('.')[1] || '0')}M`];
    }
    const v = n / 1000;
    const str = v >= 10 ? v.toFixed(0) : v.toFixed(1);
    return [str.split('.')[0], `.${(str.split('.')[1] || '0')}K`];
  }
  return [String(n), ''];
}

function FootStat({ label, value, unit, mono, leading }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {leading}
      <div className="flex flex-col leading-tight min-w-0">
        <span className="ed-mono text-[9.5px] uppercase tracking-[0.22em] whitespace-nowrap" style={{ color: 'var(--ed-steel-500)' }}>
          {label}
        </span>
        <span className={cx('text-[13px] leading-[1.3] whitespace-nowrap', mono ? 'ed-mono' : 'ed-italic')} style={{ color: 'var(--ed-steel-50)' }}>
          {value}
          {unit && <span className="ed-mono text-[11px] ml-1" style={{ color: 'var(--ed-steel-500)' }}>{unit}</span>}
        </span>
      </div>
    </div>
  );
}

function HeroMiniStat({ label, value, hint, tone = 'cyan' }) {
  const color =
    tone === 'emerald' ? ACCENT_EMERALD :
    tone === 'gold'    ? ACCENT_GOLD    :
    tone === 'amber'   ? ACCENT_AMBER   :
    tone === 'rose'    ? ACCENT_ROSE    :
                         ACCENT_CYAN;
  return (
    <div className="rounded-xl p-3 relative overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'var(--ed-ghost-border)' }}>
      <div className="flex items-center justify-between mb-1">
        <Eyebrow tone="muted" className="!tracking-[0.18em] !text-[9px]">{label}</Eyebrow>
        <span className="h-1 w-1 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      </div>
      <div className="ed-italic text-[24px] sm:text-[28px] leading-none" style={{ color: 'var(--ed-steel-50)' }}>{value}</div>
      <div className="ed-mono text-[10px] mt-1" style={{ color: 'var(--ed-steel-500)' }}>{hint}</div>
    </div>
  );
}

/* ─────────────── Protocol Pulse (live execution tape) ─────────────── */

function ProtocolPulse({ alerts }) {
  const [streaming, setStreaming] = useState(true);

  const events = useMemo(() => {
    const list = Array.isArray(alerts) ? alerts.slice(0, 6) : [];
    return list.map((e, i) => ({
      id: e.id || `e-${i}`,
      ts: e.timestamp || e.ts || e.time,
      level: e.level || e.kind || 'info',
      title: e.message || e.reason || e.action || 'Event emitted',
      meta: e.vault ? `vault ${e.vault.slice(0, 8)}…${e.vault.slice(-4)}` : 'global',
      txHref: e.txHref || null,
    }));
  }, [alerts]);

  return (
    <SectionHead
      marker="A.02 · Execution Tape"
      ghostNum="02"
      title={
        <span className="ed-italic text-[22px]">
          Protocol pulse <span className="ed-sans text-[14px] not-italic" style={{ color: 'var(--ed-steel-400)' }}>— last six events</span>
        </span>
      }
      trailing={
        <>
          <Chip
            tone={streaming ? 'emerald' : 'steel'}
            leading={<StatusDot tone={streaming ? 'emerald' : 'steel'} size={5} pulse={streaming} />}
          >
            {streaming ? 'Streaming' : 'Paused'}
          </Chip>
          <button
            type="button"
            onClick={() => setStreaming((s) => !s)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md ed-mono text-[11px] uppercase tracking-[0.14em] transition-colors"
            style={{ color: 'var(--ed-steel-300)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {streaming ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {streaming ? 'Pause' : 'Resume'}
          </button>
        </>
      }
    >
      <div className="relative rounded-2xl overflow-hidden" style={{ background: '#0C0C0F', boxShadow: 'var(--ed-ghost-border)' }}>
        <div className="relative h-9 overflow-hidden" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="absolute inset-y-0 flex items-center gap-8 ed-tape-scroll whitespace-nowrap px-5 ed-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: 'var(--ed-steel-500)' }}>
            {[...Array(2)].map((_, k) => (
              <PulseTickerContent key={k} />
            ))}
          </div>
        </div>

        <div className={cx('relative', streaming && 'ed-tape-shimmer')}>
          {events.length === 0 ? (
            <div className="text-center py-8 px-5">
              <div className="ed-italic mb-2" style={{ fontSize: 18, color: 'var(--ed-steel-300)' }}>
                Waiting for the first heartbeat…
              </div>
              <p className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-500)' }}>
                Start the orchestrator and trigger a cycle. Events stream here as they're emitted on-chain.
              </p>
            </div>
          ) : (
            events.map((e, i) => <TapeRow key={e.id} event={e} delay={i * 40} />)
          )}
        </div>
      </div>
    </SectionHead>
  );
}

function PulseTickerContent() {
  return (
    <>
      <span>Cycle · <span style={{ color: 'var(--ed-steel-50)' }}>5 min</span></span>
      <span style={{ color: ACCENT_CYAN }}>✦</span>
      <span>Intent · <span style={{ color: 'var(--ed-steel-50)' }}>EIP-712 sealed</span></span>
      <span style={{ color: ACCENT_CYAN }}>✦</span>
      <span>Venue · <span style={{ color: 'var(--ed-steel-50)' }}>Jaine V3 · 0G</span></span>
      <span style={{ color: ACCENT_CYAN }}>✦</span>
      <span>AI · <span style={{ color: 'var(--ed-steel-50)' }}>GLM-5-FP8 · TEE signed</span></span>
      <span style={{ color: ACCENT_CYAN }}>✦</span>
      <span>Vault · <span style={{ color: 'var(--ed-steel-50)' }}>v2 · asset-rescue live</span></span>
      <span style={{ color: ACCENT_CYAN }}>✦</span>
      <span className="ed-italic normal-case tracking-[0.02em]" style={{ color: 'var(--ed-steel-50)' }}>"every intent binds to its execution"</span>
      <span style={{ color: ACCENT_CYAN }}>✦</span>
    </>
  );
}

function TapeRow({ event, delay }) {
  const toneMap = {
    critical: { tone: 'rose', icon: TriangleAlert, chip: 'veto',    color: ACCENT_ROSE },
    blocked:  { tone: 'rose', icon: TriangleAlert, chip: 'veto',    color: ACCENT_ROSE },
    warning:  { tone: 'amber', icon: TriangleAlert, chip: 'signal', color: ACCENT_AMBER },
    executed: { tone: 'emerald', icon: Check, chip: 'execute', color: ACCENT_EMERALD },
    info:     { tone: 'cyan', icon: Sparkles, chip: 'event', color: ACCENT_CYAN },
  };
  const { tone, icon: IconEl, chip, color } = toneMap[event.level] || toneMap.info;

  // Show the viewer's local timezone (same convention as Decision feed on the
  // vault detail page). Orchestrator logs print in local time, so echoing local
  // here avoids the UTC ↔ server-time reconciliation confusion.
  const timeLabel = useMemo(() => {
    const ts = event.ts;
    if (!ts) return '—:—:—';
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    if (Number.isNaN(d.getTime())) return '—:—:—';
    const hhmmss = d.toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    let abbr = '';
    try {
      const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d);
      abbr = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    } catch {
      abbr = '';
    }
    return abbr ? `${hhmmss} ${abbr}` : hhmmss;
  }, [event.ts]);

  return (
    <div
      className="ed-tape-in ed-row-hover grid items-center gap-4 px-5 py-3"
      style={{
        gridTemplateColumns: '92px 32px 1fr auto',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        '--ed-tape-d': `${delay}ms`,
      }}
    >
      <span className="ed-mono text-[11px] tracking-[0.1em]" style={{ color: 'var(--ed-steel-500)' }}>{timeLabel}</span>
      <span
        className="h-6 w-6 rounded-md flex items-center justify-center"
        style={{ background: `${color}22`, color }}
      >
        <IconEl className="w-3.5 h-3.5" />
      </span>
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[13px] font-medium truncate" style={{ color: 'var(--ed-steel-50)' }}>{event.title}</span>
        <span className="ed-mono text-[11px] truncate" style={{ color: 'var(--ed-steel-500)' }}>{event.meta}</span>
      </div>
      <div className="flex items-center gap-2">
        <Chip tone={tone} dense>{chip}</Chip>
        {event.txHref ? (
          <a
            href={event.txHref}
            target="_blank"
            rel="noopener noreferrer"
            title="View transaction on 0G Explorer"
            className="inline-flex items-center justify-center h-5 w-5 rounded transition-colors"
            onMouseEnter={(e) => (e.currentTarget.style.color = color)}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ed-steel-300)')}
            style={{ color: 'var(--ed-steel-300)' }}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        ) : (
          <ArrowUpRight className="w-3.5 h-3.5" style={{ color: 'var(--ed-steel-500)' }} />
        )}
      </div>
    </div>
  );
}

/* ─────────────── Protocol Health ─────────────── */

function ProtocolHealthSection({ status, myVaultCount, totalVaults, operatorCount, runningCount }) {
  const executions = status?.totalExecutions ?? 0;
  const blocked = status?.totalBlocked ?? 0;
  const skipped = status?.totalSkipped ?? 0;
  const isRunning = !!status?.running;

  const metrics = [
    { label: 'Operators registered', value: String(operatorCount ?? 0), sub: `${operatorCount > 0 ? 'bonded via registry' : 'none registered yet'}`, icon: Shield, tone: 'cyan' },
    { label: 'Active vaults',         value: String(totalVaults ?? 0),  sub: `${runningCount ?? 0} running · ${myVaultCount ?? 0} yours`, icon: Layers, tone: 'emerald' },
    { label: 'Blocks / skips',        value: `${blocked} / ${skipped}`, sub: 'lifetime veto footprint', icon: TriangleAlert, tone: 'amber' },
    { label: 'Executions',            value: String(executions),        sub: 'lifetime settled', icon: Check, tone: 'gold' },
  ];

  return (
    <SectionHead
      marker="A.03 · Protocol Health"
      title={<span className="ed-italic text-[22px]">Capital under guarantee <span className="ed-sans text-[14px] not-italic" style={{ color: 'var(--ed-steel-400)' }}>— orchestrator lineage</span></span>}
      trailing={
        <Chip tone={isRunning ? 'emerald' : 'amber'} leading={<StatusDot tone={isRunning ? 'emerald' : 'amber'} size={5} />}>
          Orchestrator · {isRunning ? 'live' : 'idle'}
        </Chip>
      }
    >
      <div className="rounded-2xl p-5 space-y-5" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {metrics.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.label}
                className="rounded-xl p-4 relative overflow-hidden transition-colors"
                style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'var(--ed-ghost-border)' }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="h-7 w-7 rounded-md flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--ed-steel-300)' }}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <Eyebrow tone="muted" className="!text-[9px]">{m.label}</Eyebrow>
                </div>
                <div className="ed-italic text-[28px] sm:text-[32px] leading-none" style={{ color: 'var(--ed-steel-50)' }}>{m.value}</div>
                <div className="ed-mono text-[10.5px] mt-2" style={{ color: 'var(--ed-steel-500)' }}>{m.sub}</div>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(0,0,0,0.3)', boxShadow: 'var(--ed-ghost-border)' }}>
          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5" style={{ color: 'var(--ed-steel-300)' }} />
              <span className="ed-mono text-[11px] uppercase tracking-[0.2em]" style={{ color: 'var(--ed-steel-300)' }}>Orchestrator</span>
            </div>
            <Chip tone={isRunning ? 'emerald' : 'amber'} dense leading={<StatusDot tone={isRunning ? 'emerald' : 'amber'} size={5} />}>
              {isRunning ? 'live · streaming' : 'idle · ready'}
            </Chip>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4">
            {[
              { label: 'Cycles',     value: String(status?.cycleCount ?? 0), sub: 'lifetime' },
              { label: 'Executions', value: String(executions), sub: 'settled on-chain' },
              { label: 'Blocked',    value: String(blocked),    sub: 'veto · guardrail' },
              { label: 'Pending',    value: String(status?.pendingApprovalCount ?? 0), sub: 'awaiting approval', italic: status?.pendingApprovalCount === 0 },
            ].map((c, i) => (
              <div key={c.label} className="p-4 relative" style={{ borderRight: i < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                <Eyebrow tone="muted" className="!text-[9px]">{c.label}</Eyebrow>
                <div
                  className={cx('mt-2 leading-none', c.italic ? 'ed-italic' : 'ed-mono')}
                  style={{ fontSize: c.italic ? 24 : 22, color: c.italic ? 'var(--ed-steel-300)' : 'var(--ed-steel-50)' }}
                >
                  {c.value}
                </div>
                <div className="ed-mono text-[10px] mt-2" style={{ color: 'var(--ed-steel-500)' }}>{c.sub}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)' }}>
            <span className="ed-mono text-[10.5px] flex items-center gap-2" style={{ color: 'var(--ed-steel-500)' }}>
              <Shield className="w-3 h-3" /> Staking · treasury · insurance paid via governance
            </span>
            <Link
              to="/marketplace"
              className="ed-mono text-[10.5px] uppercase tracking-[0.2em] flex items-center gap-1.5 transition-colors"
              style={{ color: ACCENT_CYAN }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-cyan-ink)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = ACCENT_CYAN)}
            >
              Browse operators <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    </SectionHead>
  );
}

/* ─────────────── AI Signal ─────────────── */

function AISignalSection({ signal, signalStats, signalTxHref, isDemo }) {
  const noSignal = !signal;
  const action = signal?.action ? String(signal.action).toUpperCase() : 'HOLD';
  const asset = signal?.asset || 'USDC';
  const conf = signal?.confidence ?? 0;
  const confPct = Math.round(conf * 100);

  const chipTone =
    action === 'BUY' ? 'emerald' :
    action === 'SELL' ? 'rose' :
    'amber';

  // Real rolling accuracy derived from `platformDecisions` (30d non-veto rate
  // per bucket). Falls back to a demo curve when orchestrator has no decisions
  // yet — tagged with `isSynthetic` so the UI can flag it.
  const hasRealStats = signalStats && Array.isArray(signalStats.accuracy) && signalStats.accuracy.length > 0;
  const rollingAcc = hasRealStats
    ? signalStats.accuracy
    : [62, 68, 71, 74, 78, 81, 79, 84, 86, 88, 87, 90, 88];
  const isSynthetic = !hasRealStats;

  const accuracyValue = Math.round((rollingAcc[rollingAcc.length - 1] || 0));
  const accuracyDelta = accuracyValue - (rollingAcc[0] || 0);

  const features = signal ? [
    { k: 'edge_score',  v: signal.final_edge_score ?? '—' },
    { k: 'risk_score',  v: signal.risk_score != null ? (signal.risk_score * 100).toFixed(0) : '—' },
    { k: 'regime',      v: signal.regime || '—' },
    { k: 'approval',    v: signal.approval_tier || '—' },
    { k: 'hard_veto',   v: signal.hard_veto ? 'yes' : 'no' },
    { k: 'quality',     v: signal.trade_quality_score ?? '—' },
  ] : [];

  return (
    <SectionHead
      marker="A.05 · Latest AI Signal"
      title={<span className="ed-italic text-[22px]">Model reasoning <span className="ed-sans text-[14px] not-italic" style={{ color: 'var(--ed-steel-400)' }}>— {signal?.source || '0g-compute · engine v1'}</span></span>}
      trailing={
        <Link
          to="/app/actions"
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md ed-mono text-[11px] uppercase tracking-[0.14em] transition-colors"
          style={{ color: 'var(--ed-steel-300)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          All signals <ArrowRight className="w-3 h-3" />
        </Link>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
        {/* Signal card */}
        <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
          <div
            aria-hidden
            className="absolute -right-16 -top-16 h-[240px] w-[240px] rounded-full"
            style={{ background: `radial-gradient(circle, ${ACCENT_GOLD} 0%, transparent 65%)`, opacity: 0.12 }}
          />
          <div className="relative flex items-start gap-5">
            <div
              className="h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, rgba(201,168,76,0.25), rgba(16,185,129,0.25))',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
              }}
            >
              <Sparkles className="w-5 h-5" style={{ color: 'var(--ed-steel-50)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="ed-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--ed-steel-50)' }}>
                  {action} {asset}
                </span>
                <Chip tone={chipTone} dense>{action.toLowerCase()}</Chip>
                {signal?.approval_tier && signal.approval_tier !== 'not_required' && (
                  <Chip tone={signal.approval_tier === 'auto_execute' ? 'emerald' : 'amber'} dense>
                    {signal.approval_tier.replace(/_/g, ' ')}
                  </Chip>
                )}
                {signal?.hard_veto && <Chip tone="rose" dense>veto</Chip>}
                {isDemo && <Chip tone="gold" dense>demo</Chip>}
                {!noSignal && (
                  <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
                    Conf <span style={{ color: 'var(--ed-steel-50)' }}>{confPct}%</span>
                  </span>
                )}
              </div>
              {noSignal ? (
                <p className="text-[13px] leading-[1.6]" style={{ color: 'var(--ed-steel-300)' }}>
                  No live AI signal recorded yet. Set a vault executor, start the orchestrator, and trigger
                  the first cycle — decisions, vetoes, and confidence scores will land here.
                </p>
              ) : (
                <p className="text-[13.5px] leading-[1.55]" style={{ color: 'var(--ed-steel-300)' }}>
                  {signal.reason}
                </p>
              )}
            </div>
          </div>

          {!noSignal && (
            <>
              <div className="mt-5 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-center justify-between mb-2">
                  <Eyebrow tone="muted">Confidence</Eyebrow>
                  <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-50)' }}>{conf.toFixed(2)} / 1.00</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)', boxShadow: 'var(--ed-ghost-border)' }}>
                  <div
                    className="h-full rounded-full ed-anim-gs"
                    style={{ width: `${Math.min(100, confPct)}%`, background: `linear-gradient(90deg, ${ACCENT_CYAN}, ${ACCENT_EMERALD})` }}
                  />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-1.5">
                {features.map((f) => (
                  <span
                    key={f.k}
                    className="ed-mono text-[10.5px] px-2 py-1 rounded-md"
                    style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'var(--ed-ghost-border)', color: 'var(--ed-steel-300)' }}
                  >
                    <span style={{ color: 'var(--ed-steel-500)' }}>{f.k}</span>
                    {f.v !== undefined && <span className="ml-1.5" style={{ color: 'var(--ed-steel-50)' }}>{f.v}</span>}
                  </span>
                ))}
                {signalTxHref && (
                  <a
                    href={signalTxHref}
                    target="_blank"
                    rel="noreferrer"
                    className="ed-mono text-[10.5px] px-2 py-1 rounded-md inline-flex items-center gap-1.5 transition-colors"
                    style={{ background: 'rgba(76,201,240,0.08)', boxShadow: 'inset 0 0 0 1px rgba(76,201,240,0.24)', color: 'var(--ed-cyan-ink)' }}
                  >
                    tx
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </>
          )}
        </div>

        {/* Accuracy card */}
        <div className="rounded-2xl p-6 flex flex-col" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
          <div className="flex items-start justify-between mb-1">
            <div className="flex items-center gap-2">
              <Eyebrow tone="muted">Rolling accuracy · 30d</Eyebrow>
              {isSynthetic && <Chip tone="gold" dense>demo</Chip>}
            </div>
            <Sparkles className="w-3.5 h-3.5" style={{ color: ACCENT_CYAN }} />
          </div>
          <div className="flex items-end gap-3 mt-1">
            <span className="ed-italic text-[48px] sm:text-[56px] leading-none" style={{ color: 'var(--ed-steel-50)' }}>
              {accuracyValue}<span className="text-[20px] ml-1" style={{ color: 'var(--ed-steel-500)' }}>%</span>
            </span>
            {rollingAcc.length > 1 && (
              <span
                className="ed-mono text-[11px] pb-2"
                style={{ color: accuracyDelta >= 0 ? ACCENT_EMERALD : ACCENT_ROSE }}
              >
                {accuracyDelta >= 0 ? '+' : ''}{accuracyDelta} pts
              </span>
            )}
          </div>
          <div className="mt-1 ed-mono text-[10px]" style={{ color: 'var(--ed-steel-500)' }}>
            {isSynthetic
              ? 'Awaiting first cycle — showing indicative curve'
              : 'Non-veto rate · bucketed from live decision journal'}
          </div>
          <div className="mt-4 flex-1">
            <BarSeries data={rollingAcc} color={ACCENT_CYAN} height={60} />
          </div>
          <div className="mt-4 pt-4 grid grid-cols-3 gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <MiniStat label="Signals" value={String(signalStats?.totalSignals ?? '—')} />
            <MiniStat label="Hits"    value={String(signalStats?.totalHits ?? '—')} />
            <MiniStat label="Veto"    value={String(signalStats?.totalVeto ?? '—')} />
          </div>
        </div>
      </div>
    </SectionHead>
  );
}

function MiniStat({ label, value }) {
  return (
    <div>
      <Eyebrow tone="muted" className="!text-[9px]">{label}</Eyebrow>
      <div className="ed-mono text-[14px] mt-1" style={{ color: 'var(--ed-steel-50)' }}>{value}</div>
    </div>
  );
}

/* ─────────────── Operator Leaderboard ─────────────── */

function OperatorLeaderboard({ operators, tiersByAddress }) {
  const ranked = useMemo(() => {
    return (operators || [])
      .map((op) => {
        const tier = tiersByAddress?.[op.wallet?.toLowerCase()] || {};
        const stake = Number(tier.stakedAmount || 0);
        const tierVal = Number(tier.tier || 0);
        const feeInv = 10000 - (Number(op.performanceFeeBps) || 0);
        const score = stake * (1 + tierVal) + feeInv;
        return { ...op, stake, tier: tierVal, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [operators, tiersByAddress]);

  if (!ranked.length) return null;

  const tierLabel = (n) => (n === 3 ? 'S' : n === 2 ? 'A' : n === 1 ? 'B' : '—');
  const stakeLabel = (s) => (s > 0 ? `${(s / 1000).toFixed(1)}K` : '—');

  return (
    <SectionHead
      marker="A.06 · Operator Leaderboard"
      title={<span className="ed-italic text-[22px]">Ranked by <em>stake × reputation</em></span>}
      trailing={
        <Link to="/marketplace">
          <ControlButton variant="secondary" size="sm">
            View marketplace <ArrowRight className="w-3 h-3" />
          </ControlButton>
        </Link>
      }
    >
      <div className="rounded-2xl overflow-hidden" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        {/* Desktop table */}
        <div className="hidden lg:grid items-center gap-3 px-5 py-3" style={{ gridTemplateColumns: '48px minmax(200px,1.6fr) 110px 130px 80px 140px 24px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          {['#', 'Operator', 'Staked', 'Mandate', 'Fee', 'Reputation', ''].map((h) => (
            <span key={h} className="ed-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--ed-steel-500)' }}>{h}</span>
          ))}
        </div>

        {ranked.map((op, i) => {
          const mandate = op.mandateLabel || '—';
          const mandateTone = /conservative|defensive/i.test(mandate) ? 'cyan' : /aggressive|tactical/i.test(mandate) ? 'rose' : 'emerald';
          const rep = Math.min(1, 0.6 + op.tier * 0.12 + (op.stake > 0 ? 0.1 : 0));
          const feePct = ((op.performanceFeeBps || 0) / 100).toFixed(1);
          return (
            <Link
              key={op.wallet}
              to={`/operator/${op.wallet}`}
              className="ed-row-hover grid items-center gap-3 px-5 py-3.5"
              style={{
                gridTemplateColumns: 'minmax(48px,48px) minmax(200px,1.6fr) 110px 130px 80px 140px 24px',
                borderBottom: i < ranked.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                display: 'grid',
              }}
            >
              <span
                className="ed-italic text-[22px] leading-none"
                style={{ color: i === 0 ? ACCENT_GOLD : 'var(--ed-steel-500)' }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="flex items-center gap-3 min-w-0">
                <TokenAvatar symbol={op.name?.slice(0, 2) || 'OP'} size={32} />
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-medium truncate" style={{ color: 'var(--ed-steel-50)' }}>{op.name || 'Operator'}</span>
                    {i === 0 && <Chip tone="gold" dense>TOP</Chip>}
                    {op.tier >= 2 && <Chip tone="cyan" dense>tier {tierLabel(op.tier)}</Chip>}
                  </div>
                  <span className="ed-mono text-[10.5px] truncate" style={{ color: 'var(--ed-steel-500)' }}>
                    {op.wallet ? `${op.wallet.slice(0, 8)}…${op.wallet.slice(-4)}` : 'unbonded'}
                  </span>
                </div>
              </div>
              <span className="ed-mono text-[13px]" style={{ color: 'var(--ed-steel-50)' }}>
                {stakeLabel(op.stake)} <span className="text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>A0G</span>
              </span>
              <Chip tone={mandateTone} dense>{mandate}</Chip>
              <span className="ed-mono text-[13px]" style={{ color: ACCENT_EMERALD }}>{feePct}%</span>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.round(rep * 100)}%`, background: `linear-gradient(90deg, ${ACCENT_CYAN}, ${ACCENT_EMERALD})` }}
                  />
                </div>
                <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-50)' }}>{rep.toFixed(2)}</span>
              </div>
              <ArrowUpRight className="w-3.5 h-3.5" style={{ color: 'var(--ed-steel-500)' }} />
            </Link>
          );
        })}
      </div>
    </SectionHead>
  );
}

/* ─────────────── Right rail ─────────────── */

function YourVaultCard({ vault, isConnected, balanceUsd, dailyActions, assetSymbol }) {
  if (!isConnected || !vault) {
    return (
      <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        <div className="flex items-center justify-between mb-4">
          <RailEyebrow>Your vault</RailEyebrow>
          <Chip tone="steel" dense>None</Chip>
        </div>
        <div className="ed-italic text-[15px] leading-tight mb-3" style={{ color: 'var(--ed-steel-50)' }}>
          {isConnected ? 'This wallet owns no vaults yet.' : 'Connect a wallet to resolve vault ownership.'}
        </div>
        <p className="ed-mono text-[10.5px] leading-[1.55] mb-3" style={{ color: 'var(--ed-steel-500)' }}>
          Platform state stays visible without a wallet. Ownership and signals hydrate once connected.
        </p>
        {!isConnected ? <WalletButton /> : (
          <Link to="/create">
            <ControlButton variant="gold" size="sm">
              <Plus className="w-3 h-3" /> Create Vault
            </ControlButton>
          </Link>
        )}
      </div>
    );
  }

  const short = `${vault.address?.slice(0, 6)}…${vault.address?.slice(-4)}`;
  const isPaused = !!vault.paused;
  return (
    <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
      <div
        aria-hidden
        className="absolute -right-10 -top-10 h-[160px] w-[160px] rounded-full"
        style={{ background: `radial-gradient(circle, ${ACCENT_EMERALD} 0%, transparent 65%)`, opacity: 0.18 }}
      />
      <div className="relative flex items-start justify-between mb-4">
        <div className="flex flex-col gap-1.5">
          <RailEyebrow>Your vault</RailEyebrow>
          <div className="flex items-center gap-2">
            <TokenAvatar symbol={vault.name?.slice(0, 2) || 'V1'} size={26} />
            <span className="ed-mono text-[13px]" style={{ color: 'var(--ed-steel-50)' }}>{short}</span>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText?.(vault.address || '')}
              className="transition-colors"
              style={{ color: 'var(--ed-steel-500)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-steel-50)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ed-steel-500)')}
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        </div>
        <Chip tone={isPaused ? 'amber' : 'emerald'} dense leading={<StatusDot tone={isPaused ? 'amber' : 'emerald'} size={5} />}>
          {isPaused ? 'Paused' : 'Active'}
        </Chip>
      </div>

      <div className="grid grid-cols-3 gap-3 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <RailEyebrow className="!text-[9px]">NAV</RailEyebrow>
          <div className="ed-italic text-[24px] leading-none mt-1.5" style={{ color: 'var(--ed-steel-50)' }}>
            ${Math.round(balanceUsd).toLocaleString()}
          </div>
        </div>
        <div>
          <RailEyebrow className="!text-[9px]">Actions 24h</RailEyebrow>
          <div className="ed-mono text-[20px] leading-none mt-2" style={{ color: ACCENT_CYAN }}>{dailyActions ?? 0}</div>
        </div>
        <div>
          <RailEyebrow className="!text-[9px]">Asset</RailEyebrow>
          <div className="ed-mono text-[14px] mt-2.5" style={{ color: 'var(--ed-steel-50)' }}>{assetSymbol || 'USDC'}</div>
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <Link to={getVaultRoute(vault.address)} className="flex-1">
          <ControlButton variant="primary" size="sm">
            <Bolt className="w-3 h-3" /> Open vault
          </ControlButton>
        </Link>
        <Link to="/app/actions">
          <ControlButton variant="ghost" size="sm">
            <Activity className="w-3 h-3" /> Tune
          </ControlButton>
        </Link>
      </div>
    </div>
  );
}

function RailEyebrow({ className = '', children }) {
  return (
    <span className={cx('ed-mono text-[10px] uppercase tracking-[0.18em] whitespace-nowrap', className)} style={{ color: 'var(--ed-steel-500)' }}>
      {children}
    </span>
  );
}

function RiskRailCard({ score, level, confidence }) {
  const tone = score < 30 ? 'emerald' : score < 60 ? 'amber' : 'rose';
  return (
    <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
      <div className="flex items-center justify-between mb-3">
        <RailEyebrow>Risk · aggregate</RailEyebrow>
        <Chip tone={tone} dense>{level || 'Steady'}</Chip>
      </div>
      <div className="flex items-center justify-center py-2">
        <RiskGauge value={score} label={(level || 'LOW').toUpperCase()} tone={tone} />
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <RailEyebrow className="!text-[9px]">Conf</RailEyebrow>
          <div className="ed-mono text-[13px] mt-1.5" style={{ color: 'var(--ed-steel-50)' }}>{confidence != null ? confidence.toFixed(2) : '—'}</div>
        </div>
        <div>
          <RailEyebrow className="!text-[9px]">Level</RailEyebrow>
          <div className="ed-mono text-[13px] mt-1.5" style={{ color: 'var(--ed-steel-50)' }}>{level || '—'}</div>
        </div>
        <div>
          <RailEyebrow className="!text-[9px]">Slip</RailEyebrow>
          <div className="ed-mono text-[13px] mt-1.5" style={{ color: 'var(--ed-steel-50)' }}>0.08</div>
        </div>
      </div>
    </div>
  );
}

function MarketPricesCard({ prices, isLive }) {
  const entries = prices ? Object.entries(prices) : [];
  return (
    <div className="rounded-2xl p-5" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
      <div className="flex items-center justify-between mb-4">
        <RailEyebrow>Market · Pyth</RailEyebrow>
        <span className="ed-mono text-[10px] flex items-center gap-1.5" style={{ color: 'var(--ed-steel-500)' }}>
          <StatusDot tone={isLive ? 'emerald' : 'steel'} size={5} pulse={isLive} /> {isLive ? 'Live' : 'Idle'}
        </span>
      </div>
      {entries.length === 0 ? (
        <div className="text-center py-4">
          <Globe className="w-5 h-5 mx-auto mb-2" style={{ color: 'var(--ed-steel-500)' }} />
          <p className="text-[12px]" style={{ color: 'var(--ed-steel-400)' }}>Waiting on Pyth snapshot…</p>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
          {entries.map(([sym, data]) => {
            const price = data.price;
            const formatted = price != null ? price.toLocaleString(undefined, { maximumFractionDigits: sym === 'USDC' ? 4 : 2 }) : '—';
            return (
              <div key={sym} className="flex items-center gap-2.5 py-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <TokenIcon symbol={sym} size={22} />
                <span className="ed-mono text-[11px] flex-1" style={{ color: 'var(--ed-steel-50)' }}>{sym}/USD</span>
                <span className="ed-mono text-[11.5px]" style={{ color: 'var(--ed-steel-50)' }}>${formatted}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="ed-mono text-[10px]" style={{ color: 'var(--ed-steel-500)' }}>{entries.length} feeds · 100ms</span>
        <Link
          to="/app/actions"
          className="ed-mono text-[10px] uppercase tracking-[0.18em] transition-colors"
          style={{ color: ACCENT_CYAN }}
        >
          Journal →
        </Link>
      </div>
    </div>
  );
}

function AllVaultsCard({ total, primaryVault }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2">
          <RailEyebrow>All vaults</RailEyebrow>
          <Chip tone="steel" dense>{String(total ?? 0).padStart(2, '0')}</Chip>
        </div>
        <Link to="/marketplace" className="ed-mono text-[10px] uppercase tracking-[0.18em] flex items-center gap-1 transition-colors" style={{ color: ACCENT_CYAN }}>
          Market <ArrowRight className="w-2.5 h-2.5" />
        </Link>
      </div>
      <div className="relative p-4">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(76,201,240,0.18), rgba(16,185,129,0.18))',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
            }}
          >
            <Compass className="w-3.5 h-3.5" style={{ color: 'var(--ed-steel-50)' }} />
          </div>
          <div className="ed-italic text-[15px] leading-tight" style={{ color: 'var(--ed-steel-50)' }}>
            {total > 1 ? `${total} vaults on record.` : total === 1 ? 'Only one vault on record.' : 'No vaults on record yet.'}
          </div>
        </div>
        <p className="ed-mono text-[10.5px] leading-[1.55] mb-3" style={{ color: 'var(--ed-steel-500)' }}>
          Public vaults opt-in via the marketplace. Ownership resolves to your connected wallet automatically.
        </p>
        {primaryVault ? (
          <Link to={getVaultRoute(primaryVault)}>
            <ControlButton variant="secondary" size="sm">
              <Shield className="w-3 h-3" /> Inspect vault
            </ControlButton>
          </Link>
        ) : (
          <Link to="/create">
            <ControlButton variant="gold" size="sm">
              <Plus className="w-3 h-3" /> Deploy vault
            </ControlButton>
          </Link>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Readiness / demo helpers (preserved from previous page) ─────────────── */

function LiveReadinessBanner({ chainId, deployments, displayStatus }) {
  const activeFactory = deployments.aegisVaultFactoryV2 || deployments.aegisVaultFactory;
  const activeRegistry = deployments.operatorRegistryV2 || deployments.operatorRegistry;
  const factoryHref = getExplorerAddressHref(chainId, activeFactory);
  const registryHref = getExplorerAddressHref(chainId, activeRegistry);
  const governorHref = getExplorerAddressHref(chainId, deployments.aegisGovernor);
  const cards = [
    { label: 'Vault Factory', ok: isConfiguredAddress(activeFactory), addr: activeFactory, href: factoryHref },
    { label: 'Operator Registry', ok: isConfiguredAddress(activeRegistry), addr: activeRegistry, href: registryHref },
    { label: 'Governance', ok: isConfiguredAddress(deployments.aegisGovernor), addr: deployments.aegisGovernor, href: governorHref },
  ];
  return (
    <div className="rounded-2xl p-5 mb-6" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Eyebrow tone="cyan">§ Live mainnet view</Eyebrow>
        <span className="ed-mono text-[10px]" style={{ color: 'var(--ed-steel-400)' }}>{getNetworkLabel(chainId)}</span>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.02)', boxShadow: 'var(--ed-ghost-border)' }}>
            <div className="ed-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--ed-steel-500)' }}>{c.label}</div>
            <div className="ed-display text-[13px] mt-1" style={{ color: c.ok ? '#8AE6C2' : 'var(--ed-rose)' }}>
              {c.ok ? 'Live on-chain' : 'Missing'}
            </div>
            {c.href ? (
              <a href={c.href} target="_blank" rel="noreferrer" className="ed-mono text-[10px] transition-colors" style={{ color: ACCENT_CYAN }}>
                {shortHexLabel(c.addr)}
              </a>
            ) : (
              <span className="ed-mono text-[10px]" style={{ color: 'var(--ed-steel-500)' }}>{c.addr || 'not configured'}</span>
            )}
          </div>
        ))}
      </div>
      {!displayStatus && (
        <div className="mt-3 rounded-lg px-3 py-2.5" style={{ background: 'rgba(245,158,11,0.05)', boxShadow: 'inset 0 0 0 1px rgba(245,158,11,0.2)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Cpu className="w-3.5 h-3.5" style={{ color: '#F5C97E' }} />
            <span className="ed-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: '#F5C97E' }}>Telemetry pending</span>
          </div>
          <p className="text-[11.5px] leading-[1.55]" style={{ color: 'var(--ed-steel-400)' }}>
            Point the orchestrator at <code className="ed-mono" style={{ color: ACCENT_CYAN }}>{ORCHESTRATOR_URL || 'VITE_ORCHESTRATOR_URL'}</code> to
            stream signals, prices, and alerts onto this screen.
          </p>
        </div>
      )}
    </div>
  );
}

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

/* ─────────────── Dashboard page ─────────────── */

export default function DashboardPage() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);

  const { vaults: myVaults, count: myCount } = useVaultList(deployments.aegisVaultFactory, address);
  const { vaults: allVaults, isLoading: allLoading, total: totalVaults } = useAllPlatformVaults(deployments.aegisVaultFactory);
  const { data: orchStatus } = useOrchestratorStatus();
  const { data: protocolAlerts } = useAlerts(6);
  const { data: protocolExecutions } = useExecutions(6);
  // Protocol Pulse shows both successes AND failures on the execution tape —
  // merge the two journal streams and keep the six most recent regardless of
  // type. Successful executions are type='execution', failures surface as
  // type='alert'. Without this merge the tape silently omits every settled
  // swap and the dashboard looks stuck on the last veto.
  const protocolEvents = useMemo(() => {
    const alertList = Array.isArray(protocolAlerts) ? protocolAlerts : [];
    const execList  = Array.isArray(protocolExecutions) ? protocolExecutions : [];
    const mapped = [
      ...alertList.map((e) => ({
        ...e,
        _level: e.level || 'critical',
        _title: e.message || e.reason || `Execution failed${e.action ? ` for ${e.action.toUpperCase()} ${e.asset || ''}`.trim() : ''}`,
      })),
      ...execList.map((e) => ({
        ...e,
        _level: e.success === false ? 'critical' : 'executed',
        _title: e.success === false
          ? `Execution reverted${e.action ? ` · ${e.action.toUpperCase()} ${e.asset || ''}`.trim() : ''}`
          : `${(e.action || 'trade').toUpperCase()} settled${e.asset ? ` · ${e.asset}` : ''}${e.txHash ? ` · ${e.txHash.slice(0, 10)}…` : ''}`,
      })),
    ];
    mapped.sort((a, b) => {
      const ta = new Date(a.timestamp || a.ts || a.time || 0).getTime();
      const tb = new Date(b.timestamp || b.ts || b.time || 0).getTime();
      return tb - ta;
    });
    return mapped.slice(0, 6).map((e) => ({
      ...e,
      level: e._level,
      message: e._title,
      txHref: e.txHash ? getExplorerTxHref(chainId, e.txHash) : null,
    }));
  }, [protocolAlerts, protocolExecutions, chainId]);
  const { operators: marketplaceOps } = useOperatorList(deployments.operatorRegistryV2 || deployments.operatorRegistry);
  const activeMarketplaceOps = marketplaceOps.filter((op) => op.loaded && op.active);
  const marketplaceAddrs = activeMarketplaceOps.map((op) => op.wallet);
  const { tiersByAddress } = useOperatorTiers(
    deployments.operatorStakingV2 || deployments.operatorStaking,
    marketplaceAddrs,
  );
  // `lastSignal` is surfaced via /api/status (public), so we don't need the
  // auth-gated /api/state endpoint on the public dashboard.
  const { data: pythPrices } = usePythPrices();
  // Platform-wide decision stream (omit vaultAddress → all vaults). Powers the
  // "Rolling accuracy · 30d" panel — non-veto rate bucketed over time.
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
  const displayTVLSource = showDemoExperience ? 'Demo · live' : tvlSource || 'Pyth · live';
  const displaySignal = orchStatus?.lastSignal || (showDemoExperience ? demoSignal : null);
  const displayStatus = orchStatus || (showDemoExperience ? demoStatus : null);
  const displayPrices = pythPrices || (showDemoExperience ? demoPythPrices : null);
  const risk = computeRisk(displaySignal, demoPlatformSnapshot.aggregateRisk);

  const primaryVault = displayMyVaults[0] || (otherVaults[0] && !showDemoExperience ? otherVaults[0] : displayMyVaults[0]);
  const primaryVaultAddress =
    primaryVault?.address ||
    otherVaults[0]?.address ||
    getDefaultVaultAddress(chainId);

  const hasVaultFactory = isConfiguredAddress(deployments.aegisVaultFactoryV2 || deployments.aegisVaultFactory);
  const allContractsDeployed =
    hasVaultFactory &&
    isConfiguredAddress(deployments.operatorRegistryV2 || deployments.operatorRegistry) &&
    isConfiguredAddress(deployments.aegisGovernor);

  const signalTxHref = getExplorerTxHref(chainId, displaySignal?.txHash);

  // Hero sparkline — prefer real alert density as a proxy; fall back to curve.
  const sparklineData = useMemo(() => {
    const base = [0.72, 0.78, 0.74, 0.81, 0.85, 0.82, 0.88, 0.91, 0.94, 0.97, 0.98, 1.0];
    if (!displayPlatformTVL) return base;
    const peak = displayPlatformTVL;
    return base.map((b, i) => peak * (0.6 + b * 0.4) + i * (peak * 0.002));
  }, [displayPlatformTVL]);

  // Rolling accuracy — bucket the last 30 days of AI decisions into up to 13
  // groups and compute non-veto rate per bucket. Non-veto rate = how often AI
  // signals survive policy checks (hard_veto=false). Null when orchestrator
  // hasn't emitted any real decisions yet — `AISignalSection` falls back to a
  // demo curve in that case so the panel still reads as a design surface.
  const signalStats = useMemo(() => {
    if (!Array.isArray(platformDecisions) || platformDecisions.length === 0) return null;
    // Anchor the 30d window to the newest decision in the batch (not Date.now)
    // so the memoised value stays pure — same input always yields same output.
    const timestamps = platformDecisions
      .map((d) => new Date(d.timestamp).getTime())
      .filter(Number.isFinite);
    if (timestamps.length === 0) return null;
    const newest = Math.max(...timestamps);
    const cutoff = newest - 30 * 24 * 60 * 60 * 1000;
    const recent = platformDecisions.filter((d) => {
      const ts = new Date(d.timestamp).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    });
    if (recent.length === 0) return null;
    // Journal returns newest-first; flip so the chart reads left-to-right
    // (oldest → newest). Equal-size buckets so sparse days don't drop points.
    const ordered = [...recent].reverse();
    const numBuckets = Math.min(13, ordered.length);
    const buckets = Array.from({ length: numBuckets }, () => ({ total: 0, veto: 0 }));
    ordered.forEach((d, i) => {
      const idx = Math.min(numBuckets - 1, Math.floor((i / ordered.length) * numBuckets));
      buckets[idx].total += 1;
      if (d.hard_veto) buckets[idx].veto += 1;
    });
    const accuracy = buckets.map((b) =>
      b.total === 0 ? 0 : Math.round((1 - b.veto / b.total) * 100),
    );
    const totalSignals = recent.length;
    const totalVeto = recent.filter((d) => d.hard_veto).length;
    const totalHits = totalSignals - totalVeto;
    return { accuracy, totalSignals, totalHits, totalVeto };
  }, [platformDecisions]);

  const deltaPct = showDemoExperience ? '+12.4% · 7d' : displayPlatformTVL > 0 ? `${tvlSource || 'on-chain'}` : null;

  const vaultCountLabel = {
    value: String(displayTotalVaults || 0),
    hint: showDemoExperience
      ? `${displayRunningCount} running · ${displayMyCount} featured`
      : isConnected
        ? `${displayRunningCount} running · ${displayMyCount} owned`
        : `${displayRunningCount} running · wallet off`,
  };

  const statusLabel = displayStatus?.running
    ? `Live · ${displayStatus?.managedVaultCount || 1} managed vault${(displayStatus?.managedVaultCount || 1) === 1 ? '' : 's'}`
    : 'Idle · awaiting heartbeat';

  // Primary vault derived NAV + activity for rail card
  const primaryVaultNav = primaryVault?.nav ?? (primaryVault?.balance ? parseFloat(primaryVault.balance) : 0);
  const primaryVaultActions = primaryVault?.dailyActions ?? 0;
  const primaryVaultAsset = primaryVault?.asset || primaryVault?.baseAsset || 'USDC';

  return (
    <div className="relative min-h-screen">
      {/* Ambient backdrop */}
      <div aria-hidden className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 ed-dotgrid opacity-30" />
        <div
          className="absolute -top-[400px] -left-[200px] h-[800px] w-[800px] rounded-full"
          style={{ background: `radial-gradient(circle, ${ACCENT_GOLD}18 0%, transparent 55%)`, filter: 'blur(40px)' }}
        />
        <div
          className="absolute -bottom-[400px] -right-[200px] h-[800px] w-[800px] rounded-full"
          style={{ background: `radial-gradient(circle, ${ACCENT_EMERALD}10 0%, transparent 55%)`, filter: 'blur(40px)' }}
        />
      </div>

      <div className="relative max-w-[1540px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
        {!showDemoExperience && !allContractsDeployed && (
          <LiveReadinessBanner chainId={chainId} deployments={deployments} displayStatus={displayStatus} />
        )}

        {/* Hero */}
        <div className="ed-rise" style={{ '--ed-rise-d': '0ms' }}>
          <Hero
            accent={ACCENT_GOLD}
            tvl={displayPlatformTVL}
            tvlSource={displayTVLSource}
            tvlDelta={deltaPct}
            cycleCount={displayStatus?.cycleCount || 0}
            riskScore={risk.score}
            riskLevel={risk.level}
            vaultCountLabel={vaultCountLabel}
            statusLabel={statusLabel}
            networkLabel={getNetworkLabel(chainId)}
            sparklineData={sparklineData}
            onCreateVault={
              <Link to="/create">
                <ControlButton variant="gold">
                  <Plus className="w-3.5 h-3.5" /> Create Vault
                </ControlButton>
              </Link>
            }
            onRunCycle={
              <Link to="/app/actions">
                <ControlButton variant="secondary">
                  <Bolt className="w-3.5 h-3.5" /> Run Cycle
                </ControlButton>
              </Link>
            }
            onBrowseMarketplace={
              <Link to="/marketplace">
                <ControlButton variant="ghost">
                  <Compass className="w-3.5 h-3.5" /> Browse Marketplace
                </ControlButton>
              </Link>
            }
          />
        </div>

        {/* Main + rail */}
        <div className="mt-6 lg:mt-8 grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 lg:gap-8">
          <div className="flex flex-col gap-10 min-w-0">
            <div className="ed-rise" style={{ '--ed-rise-d': '80ms' }}>
              <ProtocolPulse alerts={protocolEvents} />
            </div>
            <div className="ed-rise" style={{ '--ed-rise-d': '160ms' }}>
              <ProtocolHealthSection
                status={displayStatus}
                myVaultCount={displayMyCount}
                totalVaults={displayTotalVaults}
                operatorCount={activeMarketplaceOps.length || (showDemoExperience ? 5 : 0)}
                runningCount={displayRunningCount}
              />
            </div>
            <div className="ed-rise" style={{ '--ed-rise-d': '240ms' }}>
              <AISignalSection
                signal={displaySignal}
                signalTxHref={signalTxHref}
                isDemo={showDemoExperience && !orchStatus?.lastSignal}
                signalStats={signalStats}
              />
            </div>
            <div className="ed-rise" style={{ '--ed-rise-d': '320ms' }}>
              <OperatorLeaderboard operators={activeMarketplaceOps} tiersByAddress={tiersByAddress} />
            </div>
          </div>

          {/* Right rail */}
          <aside className="flex flex-col gap-5 xl:sticky xl:top-[108px] self-start">
            <div className="ed-rise" style={{ '--ed-rise-d': '120ms' }}>
              <YourVaultCard
                vault={primaryVault}
                isConnected={isConnected || showDemoExperience}
                balanceUsd={primaryVaultNav}
                dailyActions={primaryVaultActions}
                assetSymbol={primaryVaultAsset}
              />
            </div>
            <div className="ed-rise" style={{ '--ed-rise-d': '200ms' }}>
              <RiskRailCard score={risk.score} level={risk.level} confidence={displaySignal?.confidence} />
            </div>
            <div className="ed-rise" style={{ '--ed-rise-d': '280ms' }}>
              <MarketPricesCard prices={displayPrices} isLive={!!pythPrices} />
            </div>
            <div className="ed-rise" style={{ '--ed-rise-d': '360ms' }}>
              <AllVaultsCard total={displayTotalVaults} primaryVault={primaryVaultAddress} />
            </div>
          </aside>
        </div>

        {/* Footer ticker */}
        <footer
          className="mt-10 relative rounded-2xl overflow-hidden h-10"
          style={{ background: '#0C0C0F', boxShadow: 'var(--ed-ghost-border)' }}
        >
          <div
            className="absolute inset-y-0 flex items-center gap-10 ed-tape-scroll whitespace-nowrap px-5 ed-mono text-[10.5px] uppercase tracking-[0.3em]"
            style={{ color: 'var(--ed-steel-500)' }}
          >
            {[...Array(3)].map((_, k) => (
              <FooterTickerContent key={k} />
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}

function FooterTickerContent() {
  return (
    <>
      <span>Aegis · AI-managed DeFi vaults on 0G</span>
      <span style={{ color: ACCENT_CYAN }}>✦</span>
      <span>Chain <span style={{ color: 'var(--ed-steel-50)' }}>0G Aristotle · 16661</span></span>
      <span style={{ color: ACCENT_CYAN }}>✦</span>
      <span>Venue <span style={{ color: 'var(--ed-steel-50)' }}>Jaine V3</span></span>
      <span style={{ color: ACCENT_CYAN }}>✦</span>
      <span>AI <span style={{ color: 'var(--ed-steel-50)' }}>GLM-5-FP8 · TEE-signed</span></span>
      <span style={{ color: ACCENT_CYAN }}>✦</span>
      <span>Intent <span style={{ color: 'var(--ed-steel-50)' }}>EIP-712 sealed</span></span>
      <span style={{ color: ACCENT_CYAN }}>✦</span>
      <span className="ed-italic normal-case tracking-[0.02em]" style={{ color: 'var(--ed-steel-50)' }}>"receipts, not promises"</span>
      <span style={{ color: ACCENT_CYAN }}>✦</span>
    </>
  );
}
