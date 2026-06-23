import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useChainId } from 'wagmi';
import { useTriggerCycle, useOrchestratorStatus, useJournal } from '../hooks/useOrchestrator';
import { ENABLE_DEMO_FALLBACKS, getExplorerTxHref, ORCHESTRATOR_URL, shortHexLabel } from '../lib/contracts';
import { demoJournalEntries, demoStatus } from '../data/demoContent';
import ExplorerAnchor from '../components/ui/ExplorerAnchor';

// ── Design tokens (matches the "Aegis Actions" reference comp) ──────────────
// Violet is the signature accent of this surface; emerald = filled/live,
// gold = policy/alert. Mono is used for every label, code, and metric.
const C = {
  card: '#14161b',
  tile: '#1a1d23',
  chipBg: '#22262e',
  border: 'rgba(255,255,255,0.07)',
  hair: 'rgba(255,255,255,0.06)',
  text: '#eceef1',
  muted: '#9499a2',
  faint: '#6b7078',
  sub: '#8a8f98',
  violet: '#6f7bdb',
  emerald: '#5cb88a',
  gold: '#e3b34e',
  rose: '#e06666',
};
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

// Per journal-type visuals: glyph + accent for the row's icon tile.
const TYPE = {
  decision:     { glyph: '◆', fg: C.violet,  bg: 'rgba(111,123,219,0.10)', ring: 'rgba(111,123,219,0.30)', label: 'Decision' },
  execution:    { glyph: '↯', fg: C.emerald, bg: 'rgba(92,184,138,0.10)',  ring: 'rgba(92,184,138,0.30)', label: 'Execution' },
  policy_check: { glyph: '▣', fg: C.gold,    bg: 'rgba(227,179,78,0.10)',  ring: 'rgba(227,179,78,0.30)', label: 'Policy' },
  alert:        { glyph: '!', fg: C.gold,    bg: 'rgba(227,179,78,0.10)',  ring: 'rgba(227,179,78,0.30)', label: 'Alert' },
  cycle:        { glyph: '↻', fg: C.violet,  bg: 'rgba(111,123,219,0.10)', ring: 'rgba(111,123,219,0.30)', label: 'Cycle' },
  system:       { glyph: '▸', fg: C.faint,   bg: 'rgba(255,255,255,0.05)', ring: 'rgba(255,255,255,0.12)', label: 'System' },
};

const CHIP = {
  emerald: { fg: C.emerald, bg: 'rgba(92,184,138,0.12)' },
  gold:    { fg: C.gold,    bg: 'rgba(227,179,78,0.12)' },
  violet:  { fg: C.violet,  bg: 'rgba(111,123,219,0.12)' },
  rose:    { fg: C.rose,    bg: 'rgba(224,102,102,0.12)' },
  steel:   { fg: C.muted,   bg: C.chipBg },
};

const mono = (size, color, extra = {}) => ({ fontFamily: MONO, fontSize: size, color, ...extra });

function Chip({ tone = 'steel', children }) {
  const c = CHIP[tone] || CHIP.steel;
  return (
    <span style={{ ...mono(9.5, c.fg), fontWeight: 600, background: c.bg, padding: '2px 8px', borderRadius: 5, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// Eyebrow divider used as each numbered section header (L.01 … L.03).
function SectionRule({ label, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={mono(11, C.faint, { letterSpacing: '1.6px', textTransform: 'uppercase' })}>{label}</span>
      <div style={{ flex: 1, height: 1, background: C.hair }} />
      {right && <span style={mono(10.5, C.faint)}>{right}</span>}
    </div>
  );
}

// ── HERO ────────────────────────────────────────────────────────────────────
function Hero({ status, displayStatus, cycleNum, kpis, onRerun, rerunning }) {
  return (
    <section style={{ position: 'relative', overflow: 'hidden', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32 }}>
      <div aria-hidden style={{ position: 'absolute', top: -100, right: -60, width: 380, height: 380, background: 'radial-gradient(circle, rgba(111,123,219,0.10), transparent 65%)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', display: 'grid', gap: 32 }} className="grid-cols-1 lg:grid-cols-[1.6fr_1fr] items-end">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            <span style={mono(11, C.faint, { letterSpacing: '1.8px', textTransform: 'uppercase' })}>
              L.01 · Execution Log · Cycle {cycleNum}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, ...mono(10, status ? C.emerald : C.gold), background: status ? 'rgba(92,184,138,0.12)' : 'rgba(227,179,78,0.12)', padding: '3px 9px', borderRadius: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: status ? C.emerald : C.gold }} />
              {status ? 'Streaming' : 'Demo'}
            </span>
          </div>
          <h1 style={{ fontSize: 46, lineHeight: 1.02, fontWeight: 600, letterSpacing: '-1.4px', margin: '0 0 14px' }}>
            Every decision,<br />
            <span style={{ color: C.violet }}>on the record.</span>
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: C.muted, maxWidth: 540, margin: 0 }}>
            Signed by an operator. Gated by policy. Recorded on-chain. Nothing the agent does escapes this page.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {displayStatus?.executorAddress && (
              <span style={{ ...mono(10, C.muted), background: C.chipBg, padding: '4px 10px', borderRadius: 6 }}>
                Executor · {shortHexLabel(displayStatus.executorAddress, 4, 4)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onRerun}
              disabled={rerunning}
              style={{ display: 'flex', alignItems: 'center', gap: 7, ...mono(12, C.text), fontWeight: 600, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: '10px 16px', cursor: rerunning ? 'not-allowed' : 'pointer', opacity: rerunning ? 0.65 : 1 }}
              onMouseEnter={(e) => { if (!rerunning) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              ↻ {rerunning ? 'Running…' : 'Rerun cycle'}
            </button>
            <button
              disabled
              title="Coming soon"
              style={{ display: 'flex', alignItems: 'center', gap: 7, ...mono(12, C.faint), fontWeight: 500, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 9, padding: '10px 16px', cursor: 'not-allowed' }}
            >
              ↓ Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      {displayStatus && (
        <div style={{ display: 'grid', gap: 14, marginTop: 28, paddingTop: 26, borderTop: `1px solid ${C.hair}` }} className="grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {kpis.map((k) => (
            <div key={k.label} style={{ background: C.tile, borderRadius: 12, padding: 16 }}>
              <div style={mono(9, C.faint, { letterSpacing: '1.5px', textTransform: 'uppercase' })}>{k.label}</div>
              <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-1px', marginTop: 10, color: k.col }}>{k.value}</div>
              <div style={{ ...mono(10, C.sub), marginTop: 5 }}>{k.sub}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── CONTROL SURFACE (three gates) ────────────────────────────────────────────
// Static framing of the path every action traverses. Values are honest to the
// live system: sealed mode is ECDSA commit→reveal (not a hardware enclave), and
// stop-loss is enforced off-chain by the orchestrator risk veto.
const GATES = [
  {
    n: '01', glyph: '◈', title: 'Operator signal', chip: 'Live', tone: 'violet',
    rows: [['Model', 'GLM-5-FP8'], ['Decision', 'commit + reveal'], ['Latency', '~400 ms'], ['Inference', '0G Compute']],
  },
  {
    n: '02', glyph: '▣', title: 'Policy gate', chip: 'Enforced', tone: 'emerald',
    rows: [['Max pos', '50% nav'], ['Confidence', '≥ 60%'], ['Cooldown', '15 min'], ['Stop-loss', '15% · off-chain']],
  },
  {
    n: '03', glyph: '↯', title: 'Execution', chip: 'Monitored', tone: 'gold',
    rows: [['Venue', 'Jaine · 0G'], ['Seal', 'commit → reveal'], ['Signer', 'ECDSA'], ['Settle', 'on-chain']],
  },
];

function ControlSurface() {
  return (
    <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
      <SectionRule label="L.02 · Control surface" right="Three gates, all aligned." />
      <div style={{ display: 'grid', gap: 16, marginTop: 20 }} className="grid-cols-1 lg:!grid-cols-3">
        {GATES.map((g) => {
          const c = CHIP[g.tone];
          return (
            <div key={g.n} style={{ background: C.tile, borderRadius: 12, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.fg, fontSize: 15 }}>{g.glyph}</div>
                <div style={{ flex: 1 }}>
                  <div style={mono(9, C.faint, { letterSpacing: '1.6px', textTransform: 'uppercase' })}>Gate · {g.n}</div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 2 }}>{g.title}</div>
                </div>
                <Chip tone={g.tone}>{g.chip}</Chip>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {g.rows.map(([k, v], j) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderTop: j === 0 ? 'none' : `1px solid rgba(255,255,255,0.04)` }}>
                    <span style={mono(10, C.faint, { letterSpacing: '1px', textTransform: 'uppercase' })}>{k}</span>
                    <span style={mono(11.5, C.text)}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── LOG ROW ───────────────────────────────────────────────────────────────
function statusFor(entry) {
  if (entry.type === 'execution') {
    if (entry.success === false) return ['Failed', 'rose'];
    if (entry.success === true) return ['Filled', 'emerald'];
    return ['Exec', 'violet'];
  }
  if (entry.type === 'policy_check') {
    return entry.valid === false ? ['Blocked', 'gold'] : ['Passed', 'emerald'];
  }
  if (entry.type === 'alert') {
    const lvl = (entry.level || 'info').toUpperCase();
    return [lvl, entry.level === 'critical' ? 'rose' : entry.level === 'warning' ? 'gold' : 'violet'];
  }
  if (entry.type === 'decision') {
    return [entry.action ? entry.action.toUpperCase() : 'Signal', 'violet'];
  }
  return null;
}

function LogRow({ entry, chainId, usingFallback }) {
  const t = TYPE[entry.type] || TYPE.system;
  const txHref = getExplorerTxHref(chainId, entry.txHash);
  const time = entry.timestamp
    ? new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '';

  const title = entry.action
    ? `${entry.action.toUpperCase()}${entry.asset ? ` ${entry.asset}` : ''}`
    : entry.message || (entry.type === 'cycle' ? `AI Cycle #${entry.cycleCount || '—'}` : t.label);
  const body = entry.reason || (entry.message && entry.message !== title ? entry.message : '');
  const st = statusFor(entry);

  const execMeta = entry.type === 'execution' && [
    entry.venue && ['venue', entry.venue],
    entry.sealed && ['seal', 'commit→reveal'],
    entry.slippage_bps !== undefined && ['slip', `${entry.slippage_bps} bps`],
    entry.duration_ms && ['latency', `${entry.duration_ms} ms`],
  ].filter(Boolean);

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', display: 'grid', gridTemplateColumns: '42px 1fr auto', gap: 16, alignItems: 'start' }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.fg, fontSize: 16, border: `1px solid ${t.ring}` }}>{t.glyph}</div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: body ? 6 : 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.text }}>{title}</span>
          {st && <Chip tone={st[1]}>{st[0]}</Chip>}
          <span style={{ ...mono(9.5, C.muted), background: C.chipBg, padding: '2px 8px', borderRadius: 5 }}>{t.label}</span>
          {entry.confidence !== undefined && (
            <span style={mono(10.5, C.violet)}>conf {(entry.confidence * 100).toFixed(0)}%</span>
          )}
          {entry.pnl !== undefined && entry.pnl !== null && (
            <span style={mono(11, Number(entry.pnl) >= 0 ? C.emerald : C.rose)}>
              {Number(entry.pnl) >= 0 ? '+' : ''}${Number(entry.pnl).toFixed(2)}
            </span>
          )}
          {usingFallback && <Chip tone="gold">Demo</Chip>}
        </div>

        {body && <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, margin: 0, maxWidth: 680 }}>{body}</p>}

        {execMeta && execMeta.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 9, flexWrap: 'wrap' }}>
            {execMeta.map(([k, v]) => (
              <span key={k} style={mono(10.5, C.faint)}>{k} <span style={{ color: C.text }}>{v}</span></span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7, flex: 'none' }}>
        <span style={{ ...mono(10.5, C.faint), whiteSpace: 'nowrap' }}>{time}</span>
        {entry.txHash && txHref && (
          <ExplorerAnchor href={txHref} label="Receipt →" style={{ ...mono(9.5, C.violet), letterSpacing: '1px', textTransform: 'uppercase', textDecoration: 'none' }} />
        )}
      </div>
    </div>
  );
}

// ── LOG STREAM (filters + search + rows) ─────────────────────────────────────
const FILTERS = [
  { k: 'all', l: 'All' },
  { k: 'decision', l: 'Decisions' },
  { k: 'execution', l: 'Executed' },
  { k: 'policy_check', l: 'Policy' },
  { k: 'alert', l: 'Alerts' },
  { k: 'cycle', l: 'Cycles' },
];

function LogStream({ fallbackEntries }) {
  const chainId = useChainId();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data: entries, loading } = useJournal(100);

  const source = entries && entries.length > 0 ? entries : fallbackEntries;
  const usingFallback = (!entries || entries.length === 0) && fallbackEntries.length > 0;

  const rows = (source || [])
    .filter((e) => (filter === 'all' ? true : e.type === filter))
    .filter((e) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        (e.id && String(e.id).toLowerCase().includes(q)) ||
        (e.asset && e.asset.toLowerCase().includes(q)) ||
        (e.action && e.action.toLowerCase().includes(q)) ||
        (e.message && e.message.toLowerCase().includes(q)) ||
        (e.reason && e.reason.toLowerCase().includes(q))
      );
    });

  const PAGE_SIZE = 20;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const seg = (active) => ({
    ...mono(11, active ? C.text : C.faint, { letterSpacing: '0.6px', textTransform: 'uppercase' }),
    fontWeight: 600, padding: '8px 13px', borderRadius: 8, cursor: 'pointer', border: 'none',
    whiteSpace: 'nowrap', background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
  });

  const pager = (active, disabled) => ({
    ...mono(11, active ? C.text : C.faint, { letterSpacing: '0.4px' }),
    fontWeight: 600, minWidth: 34, height: 32, padding: '0 11px', borderRadius: 8, border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
    background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
  });

  return (
    <>
      <SectionRule label="L.03 · Log stream" right={`${rows.length} ${rows.length === 1 ? 'row' : 'rows'} · auto-scroll`} />

      {/* filters + search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => {
            const active = filter === f.k;
            return (
              <button
                key={f.k}
                onClick={() => { setFilter(f.k); setPage(1); }}
                style={seg(active)}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = C.text; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = C.faint; }}
              >
                {f.l}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: '0 12px', height: 38 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by id, asset, reason…"
            style={{ width: 200, maxWidth: '46vw', background: 'transparent', border: 'none', outline: 'none', color: C.text, fontFamily: SANS, fontSize: 12.5 }}
          />
        </div>
      </div>

      {loading && !usingFallback && (
        <p style={mono(11.5, C.faint)}>Loading journal…</p>
      )}

      {/* rows */}
      {rows.length > 0 ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pageRows.map((e, i) => (
              <LogRow key={e.id || `${safePage}-${i}`} entry={e} chainId={chainId} usingFallback={usingFallback} />
            ))}
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 6, flexWrap: 'wrap' }}>
              <span style={mono(10.5, C.faint)}>
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, rows.length)} of {rows.length}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  style={pager(false, safePage === 1)}
                >
                  ← Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button key={n} onClick={() => setPage(n)} style={pager(n === safePage, false)}>{n}</button>
                ))}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  style={pager(false, safePage === totalPages)}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      ) : !loading ? (
        <div style={{ background: C.card, border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 12, padding: 44, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: C.muted }}>No log entries match this filter.</div>
          <div style={{ ...mono(11.5, C.faint), marginTop: 8 }}>
            {(entries && entries.length === 0 && fallbackEntries.length === 0)
              ? 'Run a cycle once the orchestrator and a vault are wired.'
              : 'Switch filter or clear the search.'}
          </div>
          {entries && entries.length === 0 && fallbackEntries.length === 0 && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
              <Link to="/create" style={{ ...mono(11, C.gold), textDecoration: 'none', border: `1px solid rgba(227,179,78,0.25)`, borderRadius: 8, padding: '7px 13px' }}>+ Create or fund a vault</Link>
              <Link to="/marketplace" style={{ ...mono(11, C.violet), textDecoration: 'none', border: `1px solid rgba(111,123,219,0.25)`, borderRadius: 8, padding: '7px 13px' }}>Wire an operator →</Link>
            </div>
          )}
        </div>
      ) : null}

      {rows.length > 0 && <StreamTail />}
    </>
  );
}

// ── STREAM TAIL ─────────────────────────────────────────────────────────────
function StreamTail() {
  const [paused, setPaused] = useState(false);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(111,123,219,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.violet, flex: 'none', fontSize: 13 }}>◉</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 2, flexWrap: 'wrap' }}>
          <span style={mono(11, C.text, { letterSpacing: '1.5px', textTransform: 'uppercase' })}>Stream tail</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, ...mono(9.5, paused ? C.faint : C.emerald), background: paused ? C.chipBg : 'rgba(92,184,138,0.12)', padding: '2px 8px', borderRadius: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: paused ? C.faint : C.emerald }} />
            {paused ? 'Paused' : 'Live'}
          </span>
        </div>
        <p style={{ fontSize: 12.5, color: C.muted, margin: 0 }}>New signals stream in at the top as the orchestrator ticks. The feed polls the journal every 10s.</p>
      </div>
      <button
        onClick={() => setPaused((p) => !p)}
        style={{ ...mono(11, C.text), fontWeight: 500, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {paused ? '▷ Resume' : '⏸ Pause'}
      </button>
    </div>
  );
}

// ── PAGE ────────────────────────────────────────────────────────────────────
export default function ActionsPage() {
  const { trigger, loading } = useTriggerCycle();
  const { data: status } = useOrchestratorStatus();
  const fallbackEntries = ENABLE_DEMO_FALLBACKS ? demoJournalEntries : [];
  const displayStatus = status || (ENABLE_DEMO_FALLBACKS ? demoStatus : null);

  const cycleNum = displayStatus?.cycleCount ? String(displayStatus.cycleCount) : '—';
  const totalActions =
    (displayStatus?.totalExecutions || 0) + (displayStatus?.totalBlocked || 0) + (displayStatus?.totalSkipped || 0);

  const kpis = [
    { label: 'Total actions', value: String(totalActions), sub: `Since c.${cycleNum}`, col: C.text },
    { label: 'Filled', value: String(displayStatus?.totalExecutions || 0), sub: 'Live pairs', col: C.emerald },
    { label: 'AI rejected', value: String(displayStatus?.totalBlocked || 0), sub: 'Policy vetoes', col: C.gold },
    { label: 'Cycles', value: cycleNum, sub: 'Lifetime', col: C.text },
    { label: 'Stream', value: status ? 'LIVE' : 'DEMO', sub: status ? '10s feed' : 'Fallback data', col: status ? C.emerald : C.gold },
  ];

  return (
    <div className="max-w-[1540px] mx-auto px-4 lg:px-6" style={{ paddingTop: 24, paddingBottom: 48, display: 'flex', flexDirection: 'column', gap: 22, fontFamily: SANS, color: C.text }}>
      {/* breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, ...mono(11, C.muted, { letterSpacing: '1px', textTransform: 'uppercase' }) }}>
        <Link to="/app" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.muted, textDecoration: 'none' }}>← Back to Dashboard</Link>
        <span style={{ color: '#3a3e46' }}>/</span>
        <span style={{ color: C.muted }}>AI Actions</span>
        <span style={{ color: '#3a3e46' }}>/</span>
        <span style={{ color: C.text }}>Cycle {cycleNum}</span>
      </div>

      <Hero
        status={status}
        displayStatus={displayStatus}
        cycleNum={cycleNum}
        kpis={kpis}
        onRerun={trigger}
        rerunning={loading}
      />

      <ControlSurface />

      {/* mode banner — keep demo / waiting states unmistakable */}
      {!status && ENABLE_DEMO_FALLBACKS && (
        <div style={{ background: 'rgba(227,179,78,0.05)', border: '1px solid rgba(227,179,78,0.25)', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text, marginBottom: 3 }}>Showing demo data — orchestrator unreachable</div>
            <p style={{ fontSize: 12, color: C.muted, margin: 0, maxWidth: 640 }}>Decisions, executions, and alerts here are illustrative content packaged with the build. Restart the orchestrator to see live data.</p>
          </div>
          <span style={{ ...mono(10, C.faint), background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.hair}`, borderRadius: 6, padding: '6px 10px' }}>
            {ORCHESTRATOR_URL || 'VITE_ORCHESTRATOR_URL not set'}
          </span>
        </div>
      )}
      {!displayStatus && !ENABLE_DEMO_FALLBACKS && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: C.text, marginBottom: 3 }}>Waiting for the first backend heartbeat</div>
            <p style={{ fontSize: 12, color: C.muted, margin: 0, maxWidth: 640 }}>Start the orchestrator, point one vault at the same executor wallet, then run a cycle to populate this log.</p>
          </div>
          <span style={{ ...mono(10, C.faint), background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.hair}`, borderRadius: 6, padding: '6px 10px' }}>
            {ORCHESTRATOR_URL || 'VITE_ORCHESTRATOR_URL not set'}
          </span>
        </div>
      )}

      <LogStream fallbackEntries={fallbackEntries} />
    </div>
  );
}
