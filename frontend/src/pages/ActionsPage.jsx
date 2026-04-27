import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useChainId } from 'wagmi';
import ActionFeed from '../components/dashboard/ActionFeed';
import { useTriggerCycle, useOrchestratorStatus, useJournal } from '../hooks/useOrchestrator';
import { ENABLE_DEMO_FALLBACKS, getExplorerTxHref, ORCHESTRATOR_URL, shortHexLabel } from '../lib/contracts';
import { demoJournalEntries, demoStatus } from '../data/demoContent';
import ControlButton from '../components/ui/ControlButton';
import GlassPanel from '../components/ui/GlassPanel';
import ExplorerAnchor from '../components/ui/ExplorerAnchor';
import {
  Zap, Radio, FileText, Activity, Shield, AlertTriangle, Settings, Cpu, Plus,
  RefreshCw, Download, ArrowLeft, Layers, CheckCircle2, Search, Pause, Play,
} from 'lucide-react';

// KPI tile used inside the editorial hero's inline metric strip. Tiny tone
// icon + eyebrow label + editorial-italic number + mono sub-caption. Kept
// purpose-built (not reused from MetricCard) so the hero's density matches
// the reference design exactly.
function KPI({ Icon, label, value, sub, tone = 'info', mono }) {
  const tones = {
    info:    { c: 'var(--ed-cyan)',    bg: 'rgba(76,201,240,0.12)' },
    emerald: { c: 'var(--ed-emerald)', bg: 'rgba(16,185,129,0.12)' },
    amber:   { c: 'var(--ed-amber)',   bg: 'rgba(245,158,11,0.12)' },
    gold:    { c: 'var(--ed-gold)',    bg: 'rgba(201,168,76,0.12)' },
    rose:    { c: 'var(--ed-rose)',    bg: 'rgba(225,29,72,0.12)' },
    neutral: { c: 'var(--ed-steel-300)', bg: 'rgba(255,255,255,0.06)' },
  }[tone] || { c: 'var(--ed-cyan)', bg: 'rgba(76,201,240,0.12)' };
  return (
    <div className="rounded-xl ed-ghost p-4" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span
          className="h-6 w-6 rounded-md flex items-center justify-center"
          style={{ background: tones.bg, color: tones.c }}
        >
          <Icon className="w-3 h-3" />
        </span>
        <span
          className="ed-mono uppercase"
          style={{ fontSize: 9, letterSpacing: '0.22em', color: 'var(--ed-steel-500)' }}
        >
          {label}
        </span>
      </div>
      <div
        className={mono ? 'ed-mono' : 'ed-italic'}
        style={{
          fontSize: mono ? 28 : 34,
          lineHeight: 1,
          color: mono ? tones.c : 'var(--ed-steel-100)',
        }}
      >
        {value}
      </div>
      <div className="ed-mono mt-2" style={{ fontSize: 10.5, color: 'var(--ed-steel-500)' }}>
        {sub}
      </div>
    </div>
  );
}

// Per-row visual config. Each journal entry type maps to an icon, an accent
// colour (used for the icon tile + left rail tint), a chip style, and a
// short label. The accent propagates into JournalRow's inline styles so the
// stream reads at a glance: cycle=blue, execution=rose/emerald by side,
// policy=amber, alert=amber, decision=cyan.
const typeConfig = {
  decision:     { icon: Activity,      chip: 'cyan',    label: 'Decision',    accent: 'var(--ed-cyan)',    accentRgb: '76,201,240' },
  execution:    { icon: Zap,           chip: 'emerald', label: 'Execution',   accent: 'var(--ed-emerald)', accentRgb: '16,185,129' },
  policy_check: { icon: Shield,        chip: 'amber',   label: 'Policy',      accent: 'var(--ed-amber)',   accentRgb: '245,158,11' },
  alert:        { icon: AlertTriangle, chip: 'amber',   label: 'Alert',       accent: 'var(--ed-amber)',   accentRgb: '245,158,11' },
  cycle:        { icon: Layers,        chip: 'cyan',    label: 'Cycle',       accent: 'var(--ed-cyan)',    accentRgb: '76,201,240' },
  system:       { icon: Settings,      chip: 'steel',   label: 'System',      accent: 'var(--ed-steel-300)', accentRgb: '154,154,166' },
};

const journalFilters = [
  { k: 'all',          l: 'All' },
  { k: 'decision',     l: 'Decisions' },
  { k: 'execution',    l: 'Executed' },
  { k: 'policy_check', l: 'Policy-rejected' },
  { k: 'alert',        l: 'Alerts' },
  { k: 'cycle',        l: 'Cycles' },
];

function JournalTab({ fallbackEntries = [] }) {
  const chainId = useChainId();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const { data: entries, loading } = useJournal(100);
  const sourceEntries = entries && entries.length > 0 ? entries : fallbackEntries;
  const usingFallback = (!entries || entries.length === 0) && fallbackEntries.length > 0;

  const filtered = (sourceEntries || [])
    .filter((e) => (filter === 'all' ? true : e.type === filter))
    .filter((e) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase().trim();
      return (
        (e.id && String(e.id).toLowerCase().includes(q)) ||
        (e.asset && e.asset.toLowerCase().includes(q)) ||
        (e.action && e.action.toLowerCase().includes(q)) ||
        (e.message && e.message.toLowerCase().includes(q)) ||
        (e.reason && e.reason.toLowerCase().includes(q))
      );
    });

  return (
    <div>
      {/* L.03 section header */}
      <div className="flex items-center gap-4 mb-4">
        <span className="ed-eyebrow">§ L.03 · Log Stream</span>
        <div className="flex-1 ed-hairline" />
        <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
          {filtered.length} row{filtered.length === 1 ? '' : 's'} · auto-scroll
        </span>
      </div>

      {/* Tabs + filters row */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {journalFilters.map((t) => (
            <button
              key={t.k}
              onClick={() => setFilter(t.k)}
              className="ed-mono uppercase whitespace-nowrap transition rounded-lg"
              style={{
                fontSize: 11.5,
                letterSpacing: '0.18em',
                padding: '0 12px',
                height: 36,
                color: filter === t.k ? 'var(--ed-steel-100)' : 'var(--ed-steel-500)',
                background: filter === t.k ? 'rgba(255,255,255,0.08)' : 'transparent',
                boxShadow: filter === t.k ? 'var(--ed-ghost-border)' : 'none',
              }}
            >
              {t.l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="flex items-center gap-1.5 rounded-lg ed-ghost px-3"
            style={{ background: 'rgba(0,0,0,0.3)', height: 36 }}
          >
            <Search className="w-3 h-3" style={{ color: 'var(--ed-steel-500)' }} />
            <input
              placeholder="Search by id, asset, reason…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent outline-none w-[220px]"
              style={{ fontSize: 12, color: 'var(--ed-steel-100)' }}
            />
          </div>
          <span className="ed-chip ed-chip-steel">Sort · Newest</span>
        </div>
      </div>

      {loading && !usingFallback && (
        <p className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-500)' }}>Loading journal…</p>
      )}

      {!loading && filtered.length === 0 && (
        <GlassPanel className="p-8">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-5 h-5 text-steel/25" />
            <span className="text-sm font-display font-semibold text-white">Journal has not received a live cycle yet</span>
          </div>
          <p className="text-[11px] text-steel/50 leading-relaxed mb-4">
            When the orchestrator publishes its first decision, policy check, or execution result, the full audit trail
            will appear here. Until then this page stays intentionally empty in live mode.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            <Link to="/create">
              <GlassPanel className="px-3 py-2 flex items-center gap-2 text-[11px] text-gold/70 hover:border-gold/20" hover>
                <Plus className="w-3 h-3" />
                Create or fund a vault
              </GlassPanel>
            </Link>
            <Link to="/marketplace">
              <GlassPanel className="px-3 py-2 flex items-center gap-2 text-[11px] text-cyan/60 hover:border-cyan/20" hover>
                <Cpu className="w-3 h-3" />
                Wire an operator
              </GlassPanel>
            </Link>
          </div>
        </GlassPanel>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((entry, i) => (
          <JournalRow key={entry.id || i} entry={entry} chainId={chainId} usingFallback={usingFallback} />
        ))}
      </div>

      {filtered.length > 0 && <StreamTail />}
    </div>
  );
}

// One log row. Cycles get a blue gradient rail + single-line summary; all
// other types are full cards with icon tile + title + metadata + optional
// policy-tag pills + timestamp + Receipt link.
function JournalRow({ entry, chainId, usingFallback }) {
  const cfg = typeConfig[entry.type] || typeConfig.system;
  const RowIcon = cfg.icon;
  const txHref = getExplorerTxHref(chainId, entry.txHash);
  const timestamp = entry.timestamp
    ? new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '';

  // Cycle entries render as a single-line gradient strip
  if (entry.type === 'cycle') {
    return (
      <div
        className="rounded-xl ed-ghost relative overflow-hidden"
        style={{ background: 'linear-gradient(90deg, rgba(76,201,240,0.06), rgba(15,15,19,0.8))' }}
      >
        <div
          className="grid items-center gap-4 px-5 py-3.5"
          style={{ gridTemplateColumns: '46px 1fr auto' }}
        >
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center"
            style={{
              background: 'rgba(76,201,240,0.12)',
              color: 'var(--ed-cyan)',
              boxShadow: 'inset 0 0 0 1px rgba(76,201,240,0.28)',
            }}
          >
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span style={{ fontSize: 13.5, color: 'var(--ed-steel-100)' }} className="whitespace-nowrap">
              {entry.message || `AI Cycle #${entry.cycleCount || '—'}`}
            </span>
            <span className="ed-chip ed-chip-cyan">Cycle</span>
            {entry.id && <span className="ed-chip ed-chip-steel">{String(entry.id).slice(0, 10)}</span>}
            {entry.duration_ms && (
              <span className="ed-mono ml-2" style={{ fontSize: 10.5, color: 'var(--ed-steel-500)' }}>
                {entry.duration_ms} ms
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="ed-mono whitespace-nowrap" style={{ fontSize: 10.5, color: 'var(--ed-steel-500)' }}>
              {timestamp}
            </span>
            {txHref && (
              <ExplorerAnchor
                href={txHref}
                label="Receipt →"
                className="ed-mono uppercase whitespace-nowrap transition-colors"
                style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--ed-cyan)' }}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Action entries (decision, execution, policy_check, alert, system)
  const accent = cfg.accent;
  const accentRgb = cfg.accentRgb;
  const badgeTone = cfg.chip;
  const titleText = entry.action
    ? `${entry.action.toUpperCase()}${entry.asset ? ` ${entry.asset}` : ''}`
    : entry.message || cfg.label;

  // Decide the short status word that sits next to the title
  let statusLabel = null;
  let statusTone = badgeTone;
  if (entry.type === 'execution') {
    if (entry.success === false) { statusLabel = 'Failed'; statusTone = 'rose'; }
    else if (entry.success === true) { statusLabel = 'Filled'; statusTone = 'emerald'; }
    else { statusLabel = 'Exec'; }
  } else if (entry.type === 'policy_check') {
    statusLabel = entry.valid === false ? 'Blocked' : 'Passed';
    statusTone = entry.valid === false ? 'amber' : 'emerald';
  } else if (entry.type === 'alert') {
    statusLabel = (entry.level || 'info').toUpperCase();
    statusTone = entry.level === 'critical' ? 'rose' : entry.level === 'warning' ? 'amber' : 'cyan';
  } else if (entry.type === 'decision') {
    statusLabel = entry.action ? entry.action.toUpperCase() : 'Signal';
    statusTone = 'cyan';
  }

  const policyTags = Array.isArray(entry.policy_checks) ? entry.policy_checks : null;

  return (
    <div
      className="rounded-xl ed-ghost transition"
      style={{ background: 'var(--ed-surface-0)' }}
    >
      <div
        className="grid gap-4 px-5 py-4 items-start"
        style={{ gridTemplateColumns: '46px 1fr auto' }}
      >
        <div
          className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: `rgba(${accentRgb}, 0.1)`,
            color: accent,
            boxShadow: `inset 0 0 0 1px rgba(${accentRgb}, 0.35)`,
          }}
        >
          <RowIcon className="w-3.5 h-3.5" />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span style={{ fontSize: 13.5, color: 'var(--ed-steel-100)' }} className="whitespace-nowrap">
              {titleText}
            </span>
            {statusLabel && <span className={`ed-chip ed-chip-${statusTone}`}>{statusLabel}</span>}
            <span className="ed-chip ed-chip-steel">{cfg.label}</span>
            {entry.confidence !== undefined && (
              <span className="ed-mono" style={{ fontSize: 10.5, color: 'var(--ed-cyan)' }}>
                conf {(entry.confidence * 100).toFixed(0)}%
              </span>
            )}
            {entry.pnl !== undefined && entry.pnl !== null && (
              <span
                className="ed-mono"
                style={{ fontSize: 11, color: Number(entry.pnl) >= 0 ? 'var(--ed-emerald)' : 'var(--ed-rose)' }}
              >
                {Number(entry.pnl) >= 0 ? '+' : ''}${Number(entry.pnl).toFixed(2)}
              </span>
            )}
            {usingFallback && (
              <span className="ed-chip ed-chip-gold">Demo</span>
            )}
          </div>

          {(entry.message || entry.reason) && (
            <p style={{ fontSize: 12.5, color: 'var(--ed-steel-400)', lineHeight: 1.55 }}>
              {entry.reason || entry.message}
            </p>
          )}

          {/* Policy-check tag pills */}
          {policyTags && policyTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {policyTags.map((tag, j) => {
                const passed = typeof tag === 'object' ? tag.passed : true;
                const label = typeof tag === 'object' ? tag.name : tag;
                const tagColor = passed ? 'var(--ed-emerald)' : 'var(--ed-amber)';
                const tagRgb = passed ? '16,185,129' : '245,158,11';
                return (
                  <span
                    key={`${label}-${j}`}
                    className="ed-mono uppercase whitespace-nowrap rounded-md ed-ghost"
                    style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      background: `rgba(${tagRgb}, 0.1)`,
                      color: tagColor,
                    }}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          )}

          {/* Exec-specific metadata row */}
          {entry.type === 'execution' && (entry.venue || entry.slippage_bps !== undefined) && (
            <div className="flex items-center gap-4 mt-2.5 flex-wrap">
              {entry.venue && (
                <span className="ed-mono" style={{ fontSize: 10.5, color: 'var(--ed-steel-500)' }}>
                  venue <span style={{ color: 'var(--ed-steel-100)' }}>{entry.venue}</span>
                </span>
              )}
              {entry.sealed && (
                <span className="ed-mono" style={{ fontSize: 10.5, color: 'var(--ed-steel-500)' }}>
                  seal <span style={{ color: 'var(--ed-steel-100)' }}>commit+reveal</span>
                </span>
              )}
              {entry.slippage_bps !== undefined && (
                <span className="ed-mono" style={{ fontSize: 10.5, color: 'var(--ed-steel-500)' }}>
                  slip <span style={{ color: 'var(--ed-steel-100)' }}>{entry.slippage_bps} bps</span>
                </span>
              )}
              {entry.duration_ms && (
                <span className="ed-mono" style={{ fontSize: 10.5, color: 'var(--ed-steel-500)' }}>
                  latency <span style={{ color: 'var(--ed-steel-100)' }}>{entry.duration_ms} ms</span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <span className="ed-mono whitespace-nowrap" style={{ fontSize: 10.5, color: 'var(--ed-steel-500)' }}>
            {timestamp}
          </span>
          {entry.txHash && txHref && (
            <ExplorerAnchor
              href={txHref}
              label="Receipt →"
              className="ed-mono uppercase whitespace-nowrap transition-colors"
              style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--ed-cyan)' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Live-stream footer — shown below the journal rows to signal "the feed is
// still ticking, more rows will arrive at the top." Pause button is a
// placeholder; the underlying poll is driven by useJournal's interval.
function StreamTail() {
  const [paused, setPaused] = useState(false);
  return (
    <div
      className="mt-5 rounded-xl ed-ghost p-4 flex items-center gap-4"
      style={{ background: 'rgba(255,255,255,0.02)' }}
    >
      <div
        className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(76,201,240,0.15)', color: 'var(--ed-cyan)' }}
      >
        <Radio className="w-3 h-3 animate-pulse" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span
            className="ed-mono uppercase whitespace-nowrap"
            style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--ed-steel-100)' }}
          >
            Stream tail
          </span>
          <span className="ed-chip ed-chip-cyan">
            <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: 'var(--ed-cyan)' }} />
            {paused ? 'Paused' : 'Live'}
          </span>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--ed-steel-400)' }}>
          New signals stream in at the top as the orchestrator ticks. The feed polls the journal every 10 s.
        </p>
      </div>
      <ControlButton variant="secondary" size="sm" onClick={() => setPaused((p) => !p)}>
        {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
        {paused ? 'Resume' : 'Pause'}
      </ControlButton>
    </div>
  );
}

export default function ActionsPage() {
  const { trigger, loading } = useTriggerCycle();
  const { data: status } = useOrchestratorStatus();
  const fallbackEntries = ENABLE_DEMO_FALLBACKS ? demoJournalEntries : [];
  const displayStatus = status || (ENABLE_DEMO_FALLBACKS ? demoStatus : null);
  const [tab, setTab] = useState('feed');

  const cycleNum = displayStatus?.cycleCount ? String(displayStatus.cycleCount).padStart(2, '0') : '—';

  return (
    <div className="max-w-[1540px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-5">
        <Link
          to="/app"
          className="ed-mono text-[11px] uppercase tracking-[0.18em] inline-flex items-center gap-1.5 whitespace-nowrap transition-colors hover:text-white"
          style={{ color: 'var(--ed-steel-500)' }}
        >
          <ArrowLeft className="w-3 h-3" /> Back to Dashboard
        </Link>
        <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-600)' }}>/</span>
        <span
          className="ed-mono text-[11px] uppercase tracking-[0.18em]"
          style={{ color: 'var(--ed-steel-500)' }}
        >
          AI Actions
        </span>
        <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-600)' }}>/</span>
        <span
          className="ed-mono text-[11px] uppercase tracking-[0.18em]"
          style={{ color: 'var(--ed-steel-100)' }}
        >
          Cycle {cycleNum}
        </span>
      </div>

      {/* Editorial hero header with ghost numeral + inline KPI strip */}
      <section
        className="relative rounded-[28px] ed-ghost p-8 lg:p-9 mb-6 overflow-hidden"
        style={{ background: 'linear-gradient(180deg, var(--ed-surface-0), var(--ed-obsidian))' }}
      >
        <div aria-hidden className="absolute inset-0 ed-dotgrid opacity-40 pointer-events-none" />
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            top: -80,
            right: -96,
            width: 360,
            height: 360,
            borderRadius: '50%',
            opacity: 0.12,
            background: 'radial-gradient(circle, var(--ed-cyan) 0%, transparent 60%)',
            filter: 'blur(10px)',
          }}
        />
        <div
          aria-hidden
          className="absolute hidden lg:block pointer-events-none ed-ghost-numeral"
          style={{ top: -16, right: 40, fontSize: 160 }}
        >
          L.01
        </div>

        <div className="relative grid gap-8 lg:grid-cols-[1.6fr_1fr] items-end">
          <div className="flex flex-col gap-4 min-w-0">
            <div className="flex items-center gap-3">
              <span className="ed-eyebrow">§ L.01 · Execution Log · Cycle {cycleNum}</span>
              <div className="flex-1 ed-hairline" />
              <span className="ed-chip ed-chip-emerald whitespace-nowrap">
                <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: 'var(--ed-emerald)' }} />
                {status ? 'Streaming' : 'Demo'}
              </span>
            </div>
            <h1
              className="ed-display"
              style={{ fontSize: 'clamp(36px, 5vw, 56px)', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1, margin: 0, color: 'var(--ed-steel-100)' }}
            >
              Every decision,{' '}
              <span className="ed-italic" style={{ fontWeight: 400, color: 'var(--ed-steel-100)' }}>
                on the record.
              </span>
            </h1>
            <p className="max-w-[620px]" style={{ fontSize: 14, color: 'var(--ed-steel-400)', lineHeight: 1.6 }}>
              Signed by an operator. Gated by policy. Recorded on-chain. Nothing the agent does escapes{' '}
              <span className="ed-italic" style={{ color: 'var(--ed-steel-100)' }}>this page.</span>
            </p>
          </div>

          <div className="flex flex-col gap-3 w-full items-end">
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="ed-chip ed-chip-steel">Range · Live</span>
              {displayStatus?.executorAddress && (
                <span className="ed-chip ed-chip-steel">
                  Executor · {shortHexLabel(displayStatus.executorAddress, 4, 4)}
                </span>
              )}
              {!status && <span className="ed-chip ed-chip-gold">Demo mode</span>}
            </div>
            <div className="flex gap-2">
              <ControlButton variant="secondary" size="md" onClick={trigger} disabled={loading}>
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Running…' : 'Rerun cycle'}
              </ControlButton>
              <ControlButton variant="ghost" size="md" disabled>
                <Download className="w-3 h-3" /> Export CSV
              </ControlButton>
            </div>
          </div>
        </div>

        {/* Inline KPI strip */}
        {displayStatus && (
          <div
            className="relative grid gap-4 mt-8 pt-8"
            style={{ gridTemplateColumns: 'repeat(5, 1fr)', borderTop: '1px solid rgba(255,255,255,0.05)' }}
          >
            <KPI
              Icon={Layers}
              label="Total actions"
              value={String(
                (displayStatus.totalExecutions || 0) +
                (displayStatus.totalBlocked || 0) +
                (displayStatus.totalSkipped || 0),
              )}
              sub={`Since c.${cycleNum}`}
              tone="info"
            />
            <KPI
              Icon={CheckCircle2}
              label="Filled"
              value={String(displayStatus.totalExecutions || 0)}
              sub="Live pairs"
              tone="emerald"
            />
            <KPI
              Icon={Shield}
              label="AI rejected"
              value={String(displayStatus.totalBlocked || 0)}
              sub="Policy vetoes"
              tone="amber"
            />
            <KPI
              Icon={RefreshCw}
              label="Cycles"
              value={cycleNum}
              sub="Lifetime"
              tone="info"
            />
            <KPI
              Icon={Radio}
              label="Stream"
              value={status ? 'LIVE' : 'DEMO'}
              sub={status ? '100 ms feed' : 'Fallback data'}
              tone={status ? 'emerald' : 'gold'}
              mono
            />
          </div>
        )}
      </section>

      <DecisionTracePrimer />

      {!displayStatus && !ENABLE_DEMO_FALLBACKS && (
        <GlassPanel className="p-4 mb-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 mb-2">
                <Cpu className="w-4 h-4 text-steel/35" />
                <span className="text-sm font-display font-semibold text-white">Live telemetry is waiting for its first backend heartbeat</span>
              </div>
              <p className="text-[11px] text-steel/50 leading-relaxed">
                This route is showing the real action feed. Start the orchestrator, make sure one vault points to the same executor wallet,
                then run a cycle to populate decisions, policy checks, and execution logs here.
              </p>
            </div>
            <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[10px] font-mono text-steel/40">
              Endpoint: {ORCHESTRATOR_URL || 'VITE_ORCHESTRATOR_URL not set'}
            </div>
          </div>
        </GlassPanel>
      )}

      {/* Mode switch — pill-style tabs, no border-baseline */}
      <div className="flex items-center gap-2 mb-5">
        {[
          { id: 'feed', label: 'Intelligence feed' },
          { id: 'journal', label: 'Execution journal' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="ed-mono uppercase whitespace-nowrap transition rounded-lg"
            style={{
              fontSize: 11.5,
              letterSpacing: '0.18em',
              padding: '0 14px',
              height: 36,
              color: tab === t.id ? 'var(--ed-steel-100)' : 'var(--ed-steel-500)',
              background: tab === t.id ? 'rgba(255,255,255,0.08)' : 'transparent',
              boxShadow: tab === t.id ? 'var(--ed-ghost-border)' : 'none',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'feed' && <ActionFeed limit={20} fallbackEntries={fallbackEntries} />}
      {tab === 'journal' && <JournalTab fallbackEntries={fallbackEntries} />}
    </div>
  );
}

// Editorial 3-gate control surface — shown above the action feed to frame
// what readers are looking at. Each gate is the conceptual checkpoint every
// AI action traverses: operator signal → policy gate → execution. Rows are
// the concrete mechanics we rely on today (GLM-5-FP8 / commit-reveal /
// Jaine V3 — the 0G Aristotle deployment).
function DecisionTracePrimer() {
  const gates = [
    {
      n: '01',
      Icon: Cpu,
      title: 'Operator signal',
      chip: { tone: 'cyan', text: 'Live' },
      rows: [
        ['Model', 'GLM-5-FP8'],
        ['Decision', 'commit + reveal + sealed'],
        ['Latency', '~400 ms avg'],
        ['Inference', '0G Compute · TEE-attested'],
      ],
    },
    {
      n: '02',
      Icon: Shield,
      title: 'Policy gate',
      chip: { tone: 'emerald', text: 'Enforced' },
      rows: [
        ['Max pos', '50% nav cap'],
        ['Stop-loss', '15% drawdown'],
        ['Cooldown', '15 min gate'],
        ['Confidence', '≥ 60% floor'],
      ],
    },
    {
      n: '03',
      Icon: Zap,
      title: 'Execution',
      chip: { tone: 'gold', text: 'Monitored' },
      rows: [
        ['Venue', 'Jaine V3 on 0G'],
        ['Seal', 'commit → reveal'],
        ['Signer', 'TEE-attested'],
        ['Settlement', 'on-chain · intent-signed'],
      ],
    },
  ];
  return (
    <section
      className="rounded-2xl ed-ghost relative overflow-hidden mb-6 p-6"
      style={{ background: 'var(--ed-surface-0)' }}
    >
      <div className="flex items-center gap-4 mb-5">
        <span className="ed-eyebrow">§ L.02 · Control Surface</span>
        <div className="flex-1 ed-hairline" />
        <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
          Three gates,{' '}
          <span className="ed-italic" style={{ color: 'var(--ed-steel-100)' }}>all aligned.</span>
        </span>
      </div>
      <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {gates.map((g) => (
          <div
            key={g.n}
            className="rounded-xl ed-ghost p-5"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="h-8 w-8 rounded-lg flex items-center justify-center"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                  color: 'var(--ed-steel-100)',
                }}
              >
                <g.Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1">
                <div
                  className="ed-mono uppercase"
                  style={{ fontSize: 9.5, letterSpacing: '0.22em', color: 'var(--ed-steel-500)' }}
                >
                  Gate · {g.n}
                </div>
                <div className="mt-0.5" style={{ fontSize: 15, color: 'var(--ed-steel-100)' }}>
                  {g.title}
                </div>
              </div>
              <span className={`ed-chip ed-chip-${g.chip.tone}`}>{g.chip.text}</span>
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }} className="pt-1">
              {g.rows.map(([k, v], j) => (
                <div
                  key={j}
                  className="flex items-center justify-between py-1.5"
                  style={{ borderTop: j === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)' }}
                >
                  <span
                    className="ed-mono uppercase"
                    style={{ fontSize: 10.5, letterSpacing: '0.18em', color: 'var(--ed-steel-500)' }}
                  >
                    {k}
                  </span>
                  <span className="ed-mono" style={{ fontSize: 11.5, color: 'var(--ed-steel-100)' }}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
