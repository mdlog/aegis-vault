import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useChainId } from 'wagmi';
import {
  ENABLE_DEMO_FALLBACKS,
  getDeployments,
  getExplorerAddressHref,
  shortHexLabel,
} from '../lib/contracts';
import {
  demoOperators,
  demoOperatorReputations,
  demoOperatorTiers,
} from '../data/demoContent';
import { useOperatorList } from '../hooks/useOperatorRegistry';
import { useOperatorTiers, TIER_LABELS } from '../hooks/useOperatorStaking';
import { useOperatorReputations, reputationScore } from '../hooks/useOperatorReputation';
import { Search, Plus, ArrowRight, ShieldCheck, RefreshCw, Zap } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────
   "Ledger" palette — ported 1:1 from Aegis Marketplace.dc.html (shares the
   DashboardPage system: IBM Plex, brighter gold). Scoped to this page via
   inline styles so the editorial pages keep their own palette.
   ──────────────────────────────────────────────────────────────────────── */
const P = {
  bg: '#0a0b0e',
  card: '#14161b',
  inner: '#1a1d23',
  inset: '#0e1014',
  tag: '#22262e',
  line: 'rgba(255,255,255,0.07)',
  lineSoft: 'rgba(255,255,255,0.05)',
  gold: '#e3b34e',
  goldHover: '#edc05f',
  emerald: '#5cb88a',
  violet: '#6f7bdb',
  rose: '#df7373',
  ink: '#eceef1',
  body: '#c4c8cf',
  sub: '#9499a2',
  faint: '#6b7078',
  track: '#2a2e36',
};
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

// Mandate → accent. Balanced=gold, Conservative=emerald, Tactical=violet.
function mandateTone(label) {
  switch (label) {
    case 'Balanced':     return { fg: P.gold,    chip: 'rgba(227,179,78,0.12)', icon: 'rgba(227,179,78,0.10)' };
    case 'Conservative': return { fg: P.emerald, chip: 'rgba(92,184,138,0.12)', icon: 'rgba(92,184,138,0.10)' };
    case 'Tactical':     return { fg: P.violet,  chip: 'rgba(111,123,219,0.12)', icon: 'rgba(111,123,219,0.10)' };
    default:             return { fg: P.sub,     chip: P.tag,                    icon: P.tag };
  }
}

const pct1 = (bps) => (bps === undefined || bps === null ? '—' : `${(Number(bps) / 100).toFixed(1)}%`);
const initialOf = (name) => (name || '?').trim().charAt(0).toUpperCase() || '?';
// Featured tier letter from the operator's stake tier (3→S, 2→A, 1→B, else C).
const stakeLetter = (tier) => (tier >= 3 ? 'S' : tier === 2 ? 'A' : tier === 1 ? 'B' : 'C');
const tierName = (td) => td?.tierLabel || TIER_LABELS[td?.tier || 0] || 'None';
const handleOf = (op) => (op.endpoint ? op.endpoint.replace(/^https?:\/\//, '').split('/')[0] : op.name);

/* ─────────────── Small inline-styled primitives ─────────────── */

function GoldButton({ children, full, style, ...rest }) {
  return (
    <button
      type="button"
      style={{
        fontFamily: MONO, fontSize: 12, fontWeight: 600, color: P.bg, background: P.gold,
        border: 'none', borderRadius: 9, padding: '10px 16px', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        width: full ? '100%' : undefined, ...style,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = P.goldHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = P.gold)}
      {...rest}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, style, ...rest }) {
  return (
    <button
      type="button"
      style={{
        fontFamily: MONO, fontSize: 12, fontWeight: 500, color: P.ink, background: 'transparent',
        border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: '10px 16px', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, ...style,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      {...rest}
    >
      {children}
    </button>
  );
}

// One segmented filter/sort button.
function Seg({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.4px',
        padding: '7px 12px', borderRadius: 8, cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
        background: active ? 'rgba(227,179,78,0.14)' : 'rgba(255,255,255,0.03)',
        color: active ? P.gold : P.sub,
      }}
    >
      {children}
    </button>
  );
}

// Section divider eyebrow: "M.0x · Title ─────────"
function SectionRule({ tag, trailing, color = P.faint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', color }}>{tag}</span>
      <div style={{ flex: 1, height: 1, background: P.line }} />
      {trailing && (
        <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '1.4px', textTransform: 'uppercase', color: P.faint }}>{trailing}</span>
      )}
    </div>
  );
}

function HeaderStat({ label, value, dot, color }) {
  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '1.8px', textTransform: 'uppercase', color: P.faint }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        {dot && <span style={{ width: 5, height: 5, borderRadius: 999, background: color || P.ink }} />}
        <span style={{ fontFamily: MONO, fontSize: 18, color: color || P.ink }}>{value}</span>
      </div>
    </div>
  );
}

/* ─────────────── Page ─────────────── */

const MANDATE_FILTERS = ['all', 'Conservative', 'Balanced', 'Tactical'];
const SORT_OPTIONS = [
  { key: 'reputation', label: 'Reputation' },
  { key: 'trades', label: 'Most Trades' },
  { key: 'lowFee', label: 'Lowest Fee' },
  { key: 'tier', label: 'Highest Tier' },
];

export default function OperatorMarketplacePage() {
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const registryAddress = deployments.operatorRegistryV2 || deployments.operatorRegistry;
  const stakingAddress = deployments.operatorStakingV2 || deployments.operatorStaking;
  const reputationAddress = deployments.operatorReputation;
  const { operators, count, isLoading } = useOperatorList(registryAddress);

  const liveAddrs = operators.filter((op) => op.loaded).map((op) => op.wallet);
  const { tiersByAddress } = useOperatorTiers(stakingAddress, liveAddrs);
  const { reputationByAddress } = useOperatorReputations(reputationAddress, liveAddrs);

  const [mandate, setMandate] = useState('all');
  const [sort, setSort] = useState('reputation');
  const [search, setSearch] = useState('');

  const registryConfigured = Boolean(registryAddress);
  const activeLive = operators.filter((op) => op.loaded && op.active);
  const useDemo = ENABLE_DEMO_FALLBACKS && (!registryConfigured || (!isLoading && activeLive.length === 0));

  const opSource = useDemo ? demoOperators : operators;
  const tierSource = useDemo ? demoOperatorTiers : tiersByAddress;
  const repSource = useDemo ? demoOperatorReputations : reputationByAddress;
  const countLabel = useDemo ? demoOperators.length : count;

  const tierOf = (op) => tierSource[op.wallet?.toLowerCase()] || null;
  const repOf = (op) => repSource[op.wallet?.toLowerCase()] || null;

  const activeOps = opSource.filter((op) => op.loaded && op.active);
  const mandateSet = [...new Set(activeOps.map((o) => o.mandateLabel).filter(Boolean))];
  const mandatesValue = mandateSet.length
    ? `${mandateSet.length} · ${mandateSet.map((m) => m.slice(0, 3)).join('·')}`
    : '—';

  const filtered = activeOps
    .filter((op) => (mandate === 'all' ? true : op.mandateLabel === mandate))
    .filter((op) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        op.name?.toLowerCase().includes(q) ||
        op.description?.toLowerCase().includes(q) ||
        op.wallet?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sort === 'reputation') return reputationScore(repOf(b)) - reputationScore(repOf(a));
      if (sort === 'trades') return (repOf(b)?.totalExecutions || 0) - (repOf(a)?.totalExecutions || 0);
      if (sort === 'lowFee') return (a.performanceFeeBps || 0) - (b.performanceFeeBps || 0);
      if (sort === 'tier') return (tierOf(b)?.tier || 0) - (tierOf(a)?.tier || 0);
      return 0;
    });

  const registryExplorerHref = getExplorerAddressHref(chainId, registryAddress);
  const sourceMeta = useDemo
    ? { label: 'Demo roster', color: P.gold }
    : registryAddress
      ? { label: 'Live · on-chain', color: P.emerald }
      : { label: 'Offline', color: P.rose };

  return (
    <div style={{ fontFamily: SANS, color: P.ink, background: P.bg }}>
      <style>{`.mkt-search::placeholder{color:${P.faint}}.mkt-search:focus{outline:none}`}</style>
      <div className="max-w-[1540px] mx-auto px-4 lg:px-6" style={{ paddingTop: 24, paddingBottom: 48, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* ============ HEADER ============ */}
        <section style={{ position: 'relative', overflow: 'hidden', background: P.card, border: `1px solid ${P.line}`, borderRadius: 16, padding: 34, display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 36 }}>
          <div aria-hidden style={{ position: 'absolute', top: -120, right: -60, width: 380, height: 380, background: 'radial-gradient(circle,rgba(227,179,78,0.09),transparent 65%)', pointerEvents: 'none' }} />

          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '1.8px', textTransform: 'uppercase', color: P.faint }}>Operator Marketplace · M.01</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 10, color: P.emerald, background: 'rgba(92,184,138,0.12)', padding: '3px 9px', borderRadius: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: P.emerald }} />
                {registryAddress && !useDemo ? 'On-chain registry' : 'Registry preview'}
              </span>
            </div>
            <h1 style={{ fontSize: 40, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-1.2px', margin: '0 0 14px' }}>
              The operators,<br /><span style={{ color: P.gold }}>and their record.</span>
            </h1>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: P.sub, maxWidth: 480, margin: '0 0 26px' }}>
              Stake is skin. Reputation is history. Every operator here can be slashed — and every vault is free to replace them.
            </p>

            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', paddingTop: 22, borderTop: `1px solid ${P.line}` }}>
              <HeaderStat label="Operators" value={String(countLabel).padStart(2, '0')} />
              <HeaderStat label="Active" value={String(activeOps.length).padStart(2, '0')} dot color={P.emerald} />
              <HeaderStat label="Mandates" value={mandatesValue} />
              <HeaderStat label="Source" value={sourceMeta.label} dot color={sourceMeta.color} />
            </div>
          </div>

          {/* register CTA */}
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ background: P.inner, border: '1px solid rgba(227,179,78,0.18)', borderRadius: 14, padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(227,179,78,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: P.gold }}>
                  <Plus style={{ width: 18, height: 18 }} />
                </div>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '1.6px', textTransform: 'uppercase', color: P.gold }}>Join the registry</div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginTop: 3 }}>Register as operator</div>
                </div>
              </div>
              <p style={{ fontSize: 12.5, lineHeight: 1.55, color: P.sub, margin: '0 0 18px' }}>
                Bond a manifest, declare your model, stake collateral, and start executing signed intents on vaults that pick you.
              </p>
              <Link to="/operator/register"><GoldButton full><Plus style={{ width: 13, height: 13 }} /> Register as operator</GoldButton></Link>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, fontFamily: MONO, fontSize: 10.5, color: P.faint }}>
                <span>Onboarding · 24h review</span>
                <Link to="/whitepaper" style={{ color: P.gold, textDecoration: 'none' }}>Read spec →</Link>
              </div>
            </div>
          </div>
        </section>

        {/* ============ TOOLBAR ============ */}
        <section style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 14, padding: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1, minWidth: 220, background: P.inset, border: `1px solid ${P.line}`, borderRadius: 10, padding: '0 13px', height: 42 }}>
            <Search style={{ width: 15, height: 15, color: P.faint, flexShrink: 0 }} />
            <input
              className="mkt-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, strategy, or address…"
              style={{ flex: 1, background: 'transparent', border: 'none', color: P.ink, fontFamily: SANS, fontSize: 13 }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', color: P.faint }}>Mandate</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {MANDATE_FILTERS.map((m) => (
                <Seg key={m} active={mandate === m} onClick={() => setMandate(m)}>{m === 'all' ? 'All' : m}</Seg>
              ))}
            </div>
          </div>

          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.08)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', color: P.faint }}>Sort</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {SORT_OPTIONS.map((s) => (
                <Seg key={s.key} active={sort === s.key} onClick={() => setSort(s.key)}>{s.label}</Seg>
              ))}
            </div>
          </div>
        </section>

        {/* ============ FEATURED + TIERS ============ */}
        {filtered.length > 0 && (
          <>
            <SectionRule tag="M.02 · Featured" />
            <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 22 }}>
              <FeaturedCard op={filtered[0]} tier={tierOf(filtered[0])} rep={repOf(filtered[0])} />
              <StakeTiers />
            </div>
          </>
        )}

        {/* ============ LISTINGS ============ */}
        <SectionRule
          tag="M.04 · Operator listings"
          trailing={`Showing ${String(filtered.length).padStart(2, '0')} of ${String(activeOps.length).padStart(2, '0')}`}
        />

        {!registryConfigured && !useDemo ? (
          <EmptyCard title="Operator registry not deployed on this network yet." sub="Run the deploy script to enable the marketplace." />
        ) : isLoading && !useDemo ? (
          <EmptyCard title="Loading operators from chain…" sub="Reading the on-chain registry." />
        ) : filtered.length === 0 ? (
          <EmptyCard
            title={activeOps.length === 0 ? 'No active operators registered yet.' : 'No operators match your filters.'}
            sub={activeOps.length === 0 ? 'Vaults can still use a custom executor while the registry warms up.' : 'Reset the mandate filter or search a broader term.'}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map((op) => (
              <OperatorRow key={op.wallet} op={op} tier={tierOf(op)} rep={repOf(op)} chainId={chainId} />
            ))}
          </div>
        )}

        {/* ============ TRUST MODEL ============ */}
        <section style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 14, padding: 24, marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', color: P.emerald }}>Trust model</span>
            <div style={{ flex: 1, height: 1, background: P.line }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 22 }}>
            <TrustItem Icon={ShieldCheck}>
              <strong style={{ color: P.ink, fontWeight: 500 }}>Operators have zero access</strong> to your funds. They can only call <code style={{ fontFamily: MONO, color: P.violet }}>executeIntent()</code> and pass on-chain policy checks.
            </TrustItem>
            <TrustItem Icon={RefreshCw}>
              <strong style={{ color: P.ink, fontWeight: 500 }}>Switch operators anytime</strong> from the vault detail page — <code style={{ fontFamily: MONO, color: P.violet }}>setExecutor()</code> is owner-only.
            </TrustItem>
            <TrustItem Icon={Zap}>
              <strong style={{ color: P.ink, fontWeight: 500 }}>Set tight policies</strong> (low max position, low daily loss) and you cap any operator&rsquo;s worst-case behavior.
            </TrustItem>
          </div>
          {registryExplorerHref && !useDemo && (
            <div style={{ marginTop: 18, fontFamily: MONO, fontSize: 11, color: P.faint }}>
              <a href={registryExplorerHref} target="_blank" rel="noreferrer" style={{ color: P.violet, textDecoration: 'none' }}>View registry on explorer →</a>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}

/* ─────────────── Featured operator ─────────────── */

function FeaturedCard({ op, tier, rep }) {
  if (!op) return null;
  const repScore = reputationScore(rep);
  const stats = [
    { k: 'Mandate', v: op.mandateLabel || '—', c: P.gold },
    { k: 'Perf fee', v: pct1(op.performanceFeeBps), c: P.ink },
    { k: 'Mgmt fee', v: pct1(op.managementFeeBps), c: P.ink },
    { k: 'Reputation', v: rep ? String(repScore) : '—', c: P.emerald },
  ];
  return (
    <section style={{ position: 'relative', overflow: 'hidden', background: P.card, border: '1px solid rgba(227,179,78,0.2)', borderRadius: 16, padding: 26 }}>
      <div aria-hidden style={{ position: 'absolute', top: 0, right: 0, width: 280, height: 280, background: 'radial-gradient(circle at 100% 0%,rgba(227,179,78,0.1),transparent 60%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 10, fontWeight: 600, color: P.gold, background: 'rgba(227,179,78,0.12)', padding: '4px 10px', borderRadius: 6 }}>
            ★ Featured · tier {stakeLetter(tier?.tier || 0)}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '1.6px', textTransform: 'uppercase', color: P.faint }}>Rank #01</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 20, alignItems: 'start' }}>
          <div style={{ width: 72, height: 72, borderRadius: 16, background: P.tag, border: '1px solid rgba(227,179,78,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: P.gold, fontSize: 30, fontWeight: 600 }}>
            {initialOf(op.name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.8px', margin: 0 }}>{op.name}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: P.violet }}>{handleOf(op)}</span>
              <span style={{ color: '#3a3e46' }}>·</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: P.faint }}>{shortHexLabel(op.wallet)}</span>
            </div>
            <p style={{ fontSize: 13.5, color: P.body, lineHeight: 1.55, margin: '14px 0 0', maxWidth: 520 }}>{op.description || 'No strategy description provided.'}</p>
          </div>
        </div>

        <div style={{ height: 1, background: P.line, margin: '22px 0' }} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)' }}>
          {stats.map((s, i) => (
            <div key={s.k} style={{ borderLeft: i ? `1px solid ${P.line}` : 'none', paddingLeft: i ? 18 : 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '1.8px', textTransform: 'uppercase', color: P.faint }}>{s.k}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: s.c, marginTop: 6 }}>{s.v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <Link to={`/operator/${op.wallet}`}><GoldButton>View profile <ArrowRight style={{ width: 14, height: 14 }} /></GoldButton></Link>
          <Link to={`/create?operator=${op.wallet}`}><GhostButton>Assign to vault</GhostButton></Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────── Stake tiers legend ─────────────── */

const TIERS = [
  { t: 'S', range: '≥ 50K A0G', perks: 'Featured + sealed mode + governance vote', col: '#e3b34e', border: 'rgba(227,179,78,0.28)' },
  { t: 'A', range: '20K – 50K', perks: 'Multi-vault assignments · slashing 20%', col: '#6f7bdb', border: 'rgba(255,255,255,0.08)' },
  { t: 'B', range: '5K – 20K', perks: 'Single vault · review-tier signals', col: '#5cb88a', border: 'rgba(255,255,255,0.08)' },
  { t: 'C', range: '< 5K', perks: 'Shadow mode · no live assignment', col: '#9499a2', border: 'rgba(255,255,255,0.08)' },
];

function StakeTiers() {
  return (
    <section style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 14 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', color: P.faint }}>M.03 · Stake tiers</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {TIERS.map((t, i) => (
          <div key={t.t} style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: 12, alignItems: 'center', padding: '13px 0', borderTop: i ? `1px solid ${P.lineSoft}` : 'none' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: P.tag, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 13, fontWeight: 700, color: t.col, border: `1px solid ${t.border}` }}>{t.t}</div>
            <div>
              <div style={{ fontSize: 12.5, color: P.ink }}>{t.perks}</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: P.faint, marginTop: 2 }}>{t.range}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, background: P.inset, border: '1px solid rgba(227,179,78,0.15)', borderRadius: 10, padding: 14 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '1.6px', color: P.gold, marginBottom: 6 }}>SLASHING</div>
        <p style={{ fontSize: 12, color: P.sub, lineHeight: 1.5, margin: 0 }}>
          Misbehavior forfeits 10–50% of stake. Treasury claim goes to the affected vault first, then to the insurance tranche.
        </p>
      </div>
    </section>
  );
}

/* ─────────────── Operator listing row ─────────────── */

function OperatorRow({ op, tier, rep, chainId }) {
  const tone = mandateTone(op.mandateLabel);
  const repScore = reputationScore(rep);
  const stake = tier?.stakeAmount;
  const trades = rep?.totalExecutions;
  const success = rep?.successRatePct != null ? `${rep.successRatePct.toFixed(1)}%` : null;
  const rating = rep?.ratingCount > 0 ? rep.averageRating.toFixed(1) : null;
  const explorerHref = getExplorerAddressHref(chainId, op.wallet);

  return (
    <div style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 14, padding: 20, display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 20, alignItems: 'center' }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: tone.icon, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone.fg, fontSize: 19, fontWeight: 600 }}>
        {initialOf(op.name)}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 5 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: P.ink }}>{op.name}</span>
          {rep?.verified && (
            <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 600, color: P.violet, background: 'rgba(111,123,219,0.12)', padding: '2px 7px', borderRadius: 5 }}>✓ VERIFIED</span>
          )}
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: P.faint }}>{shortHexLabel(op.wallet)}</span>
          {op.mandateLabel && (
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, color: tone.fg, background: tone.chip, padding: '3px 9px', borderRadius: 6, letterSpacing: '0.4px' }}>{op.mandateLabel}</span>
          )}
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, color: P.sub, background: P.tag, padding: '3px 9px', borderRadius: 6, textTransform: 'uppercase' }}>{tierName(tier)}</span>
        </div>
        <p style={{ fontSize: 12.5, color: P.sub, lineHeight: 1.5, margin: '0 0 12px', maxWidth: 640 }}>{op.description || 'No description provided.'}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <RowMetric label="Perf" value={pct1(op.performanceFeeBps)} color={P.emerald} />
          <RowMetric label="Mgmt" value={pct1(op.managementFeeBps)} color={P.violet} />
          {trades != null && <RowMetric label="Trades" value={trades} color={P.gold} />}
          {success && <RowMetric label="Success" value={success} color={P.ink} />}
          {rating && <RowMetric label="Rating" value={`★ ${rating}`} color={P.gold} />}
          {stake != null && (
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: P.faint }}>Stake {formatStake(stake)}</span>
          )}
          {explorerHref && (
            <a href={explorerHref} target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 10.5, color: P.faint, textDecoration: 'none' }}>Explorer ↗</a>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12, minWidth: 130 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '1px', textTransform: 'uppercase', color: P.faint }}>Reputation</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: P.emerald, marginTop: 2 }}>{rep ? repScore : '—'}</div>
        </div>
        <div style={{ width: 120, height: 6, borderRadius: 99, background: P.track, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${rep ? repScore : 0}%`, background: P.emerald, borderRadius: 99 }} />
        </div>
        <Link to={`/operator/${op.wallet}`}>
          <GhostButton style={{ fontSize: 11, fontWeight: 600, padding: '8px 16px' }}>View →</GhostButton>
        </Link>
      </div>
    </div>
  );
}

function RowMetric({ label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '1px', textTransform: 'uppercase', color: P.faint }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 12, color }}>{value}</span>
    </div>
  );
}

function formatStake(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return String(n);
}

/* ─────────────── Misc ─────────────── */

function EmptyCard({ title, sub }) {
  return (
    <div style={{ background: P.card, border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 14, padding: 48, textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: P.sub }}>{title}</div>
      <div style={{ fontFamily: MONO, fontSize: 11.5, color: P.faint, marginTop: 8 }}>{sub}</div>
    </div>
  );
}

function TrustItem({ Icon, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(92,184,138,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', color: P.emerald }}>
        <Icon style={{ width: 15, height: 15 }} />
      </div>
      <p style={{ fontSize: 13, color: P.sub, lineHeight: 1.55, margin: 0 }}>{children}</p>
    </div>
  );
}
