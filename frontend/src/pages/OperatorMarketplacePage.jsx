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
import { useOperatorList, MandateLabel, useOperatorExtendedBatch } from '../hooks/useOperatorRegistry';
import { formatBps } from '../hooks/useVaultFees';
import {
  useOperatorTiers, TIER_LABELS, TIER_COLORS, formatVaultCap,
} from '../hooks/useOperatorStaking';
import {
  useOperatorReputations, reputationScore,
} from '../hooks/useOperatorReputation';
import GlassPanel from '../components/ui/GlassPanel';
import ControlButton from '../components/ui/ControlButton';
import {
  Cpu, Search, Plus, ArrowRight, Users, Activity, ShieldCheck,
  TrendingUp, Percent, Award, Star, BadgeCheck, ExternalLink,
  Trophy, RefreshCw, Zap as Bolt, Sparkles, Clock, Layers, Bookmark, Shield,
} from 'lucide-react';

// Row-stat Pill — tiny tinted chip with label + value used on operator rows.
// Mirrors the visual density of the editorial HTML reference (colour-coded
// per metric: perf=emerald, mgmt=cyan, actions=amber, rep=cyan).
function RowPill({ label, value, tone, Icon: PillIcon }) {
  const tones = {
    emerald: { color: 'var(--ed-emerald)', bg: 'rgba(16,185,129,0.06)' },
    cyan:    { color: 'var(--ed-cyan)',    bg: 'rgba(76,201,240,0.06)' },
    gold:    { color: 'var(--ed-gold)',    bg: 'rgba(201,168,76,0.06)' },
    steel:   { color: 'var(--ed-steel-300)', bg: 'rgba(255,255,255,0.03)' },
  }[tone] || { color: 'var(--ed-steel-300)', bg: 'rgba(255,255,255,0.03)' };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md ed-ghost"
      style={{ background: tones.bg }}
    >
      {PillIcon && <PillIcon className="w-2.5 h-2.5" style={{ color: tones.color }} />}
      <span className="ed-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--ed-steel-500)' }}>
        {label}
      </span>
      <span className="ed-mono text-[11px]" style={{ color: tones.color }}>{value}</span>
    </span>
  );
}

// Segmented toolbar group — shared by Mandate / Perf / Tier / Sort filters.
// Active option switches to the tinted state using a tone colour map so each
// filter group has a subtle visual identity without going overboard.
function SegGroup({ label, options, activeKey, onChange, tone = 'gold' }) {
  const tones = {
    gold:    { bg: 'rgba(201,168,76,0.15)',  fg: 'var(--ed-gold)' },
    cyan:    { bg: 'rgba(76,201,240,0.15)',  fg: 'var(--ed-cyan)' },
    emerald: { bg: 'rgba(16,185,129,0.15)',  fg: 'var(--ed-emerald)' },
  }[tone] || { bg: 'rgba(201,168,76,0.15)', fg: 'var(--ed-gold)' };

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span
        className="ed-mono text-[10px] uppercase tracking-[0.2em] mr-1 whitespace-nowrap"
        style={{ color: 'var(--ed-steel-500)' }}
      >
        {label}
      </span>
      {options.map((o) => {
        const active = activeKey === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className="ed-mono text-[11px] uppercase tracking-[0.16em] px-3 h-7 rounded-md ed-ghost transition whitespace-nowrap"
            style={{
              background: active ? tones.bg : 'rgba(255,255,255,0.02)',
              color: active ? tones.fg : 'var(--ed-steel-300)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Inline metric shown in the header's footer strip (Operators / Active / …).
// Keeps the rhythm consistent: small mono label, large display value, optional
// leading status dot.
function FootStat({ label, value, tone, dot }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="ed-mono text-[9.5px] uppercase tracking-[0.22em]" style={{ color: 'var(--ed-steel-500)' }}>
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        {dot && (
          <span
            className="inline-block rounded-full"
            style={{ width: 5, height: 5, background: tone || 'var(--ed-emerald)' }}
          />
        )}
        <span className="ed-mono text-[13px]" style={{ color: tone || 'var(--ed-steel-100)' }}>{value}</span>
      </div>
    </div>
  );
}

const MANDATE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'Conservative', label: 'Conservative' },
  { key: 'Balanced', label: 'Balanced' },
  { key: 'Tactical', label: 'Tactical' },
];

export default function OperatorMarketplacePage() {
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const registryAddress = deployments.operatorRegistryV2 || deployments.operatorRegistry;
  const stakingAddress = deployments.operatorStakingV2 || deployments.operatorStaking;
  const reputationAddress = deployments.operatorReputation;
  const { operators, count, isLoading } = useOperatorList(registryAddress);

  // Batch-fetch tiers + reputation for all operators
  const allOperatorAddrs = operators.filter((op) => op.loaded).map((op) => op.wallet);
  const { tiersByAddress } = useOperatorTiers(stakingAddress, allOperatorAddrs);
  const { reputationByAddress } = useOperatorReputations(reputationAddress, allOperatorAddrs);
  const { byAddress: extendedByAddress } = useOperatorExtendedBatch(registryAddress, allOperatorAddrs);

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [feeFilter, setFeeFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sortBy, setSortBy] = useState('newest');

  const registryConfigured = Boolean(registryAddress);
  const activeLiveOperators = operators.filter((op) => op.loaded && op.active);
  const useDemoOperators = ENABLE_DEMO_FALLBACKS && (!registryConfigured || (!isLoading && activeLiveOperators.length === 0));
  const operatorSource = useDemoOperators ? demoOperators : operators;
  const countLabel = useDemoOperators ? demoOperators.length : count;
  const tierSource = useDemoOperators ? demoOperatorTiers : tiersByAddress;
  const reputationSource = useDemoOperators ? demoOperatorReputations : reputationByAddress;
  const registryExplorerHref = getExplorerAddressHref(chainId, registryAddress);

  const filtered = operatorSource
    .filter((op) => op.loaded && op.active)
    .filter((op) => {
      if (filter === 'all') return true;
      return op.mandateLabel === filter;
    })
    .filter((op) => {
      if (feeFilter === 'all') return true;
      if (feeFilter === 'low') return (op.performanceFeeBps || 0) <= 1000; // ≤10%
      if (feeFilter === 'mid') return (op.performanceFeeBps || 0) <= 2000; // ≤20%
      return true;
    })
    .filter((op) => {
      if (tierFilter === 'all') return true;
      const tier = tierSource[op.wallet?.toLowerCase()]?.tier || 0;
      return tier >= Number(tierFilter);
    })
    .filter((op) => {
      if (!verifiedOnly) return true;
      return reputationSource[op.wallet?.toLowerCase()]?.verified || false;
    })
    .filter((op) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase().trim();
      return (
        op.name?.toLowerCase().includes(q) ||
        op.description?.toLowerCase().includes(q) ||
        op.wallet?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'lowestFee') {
        return (a.performanceFeeBps || 0) - (b.performanceFeeBps || 0);
      }
      if (sortBy === 'highestTier') {
        const ta = tierSource[a.wallet?.toLowerCase()]?.tier || 0;
        const tb = tierSource[b.wallet?.toLowerCase()]?.tier || 0;
        return tb - ta;
      }
      if (sortBy === 'reputation') {
        const ra = reputationScore(reputationSource[a.wallet?.toLowerCase()]);
        const rb = reputationScore(reputationSource[b.wallet?.toLowerCase()]);
        return rb - ra;
      }
      if (sortBy === 'mostExecutions') {
        const ea = reputationSource[a.wallet?.toLowerCase()]?.totalExecutions || 0;
        const eb = reputationSource[b.wallet?.toLowerCase()]?.totalExecutions || 0;
        return eb - ea;
      }
      if (sortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '');
      }
      // newest first
      return (b.registeredAt || 0) - (a.registeredAt || 0);
    });

  return (
    <div className="max-w-[1540px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      {/* Header — editorial hero with ghost numeral + inline register CTA card */}
      <section
        className="relative rounded-[28px] p-8 lg:p-10 mb-6 overflow-hidden ed-ghost"
        style={{ background: 'linear-gradient(180deg, var(--ed-surface-0), var(--ed-obsidian))' }}
      >
        <div aria-hidden className="absolute inset-0 ed-dotgrid opacity-40 pointer-events-none" />
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            top: -96,
            right: -96,
            width: 420,
            height: 420,
            borderRadius: '50%',
            opacity: 0.14,
            background: 'radial-gradient(circle, var(--ed-gold) 0%, transparent 60%)',
            filter: 'blur(10px)',
          }}
        />
        <div
          aria-hidden
          className="absolute hidden lg:block pointer-events-none ed-ghost-numeral"
          style={{ top: -16, right: 40, fontSize: 160 }}
        >
          M.01
        </div>

        <div className="relative grid gap-8 lg:grid-cols-[1.6fr_1fr]">
          {/* Left: eyebrow + title + footer stats */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="ed-eyebrow">§ M.01 · Operator Marketplace</span>
              <div className="flex-1 ed-hairline" />
              <span className="ed-chip ed-chip-cyan">
                <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: 'var(--ed-cyan)' }} />
                On-chain registry
              </span>
            </div>

            <h1
              className="ed-display"
              style={{ fontSize: 'clamp(40px, 6vw, 68px)', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 0.98, margin: 0, color: 'var(--ed-steel-100)' }}
            >
              The operators,{' '}
              <span className="ed-italic" style={{ fontWeight: 400, color: 'var(--ed-steel-100)' }}>
                and their record.
              </span>
            </h1>

            <p
              className="max-w-[620px]"
              style={{ fontSize: 14.5, color: 'var(--ed-steel-400)', lineHeight: 1.6 }}
            >
              Stake is skin. Reputation is history. Every operator here can be slashed — and every vault is free to{' '}
              <span className="ed-italic" style={{ color: 'var(--ed-steel-100)' }}>replace them.</span>
            </p>

            <div
              className="flex items-center gap-6 pt-5 mt-1 flex-wrap"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              <FootStat label="Operators" value={String(countLabel).padStart(2, '0')} />
              <FootStat
                label="Active"
                value={String(operatorSource.filter((o) => o.loaded && o.active).length).padStart(2, '0')}
                dot
                tone="var(--ed-emerald)"
              />
              <FootStat
                label="Mandates"
                value={`${new Set(operatorSource.filter((o) => o.loaded).map((o) => o.mandateLabel)).size} · Bal·Tac·Con`}
              />
              <FootStat
                label="Source"
                value={useDemoOperators ? 'Demo roster' : registryAddress ? 'Live · on-chain' : 'Offline'}
                dot
                tone={useDemoOperators ? 'var(--ed-gold)' : registryAddress ? 'var(--ed-emerald)' : 'var(--ed-rose)'}
              />
            </div>
          </div>

          {/* Right: inline register CTA card */}
          <div className="flex flex-col items-end relative">
            <div className="rounded-2xl ed-ghost p-5 w-full" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <div className="flex items-start gap-3 mb-4">
                <div
                  className="h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    background: 'rgba(201,168,76,0.15)',
                    boxShadow: 'inset 0 0 0 1px rgba(201,168,76,0.3)',
                    color: 'var(--ed-gold)',
                  }}
                >
                  <Plus className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="ed-mono text-[10.5px] uppercase tracking-[0.22em] whitespace-nowrap" style={{ color: 'var(--ed-gold)' }}>
                    Join the registry
                  </div>
                  <div className="ed-italic mt-0.5" style={{ fontSize: 18, color: 'var(--ed-steel-100)' }}>
                    Register as operator
                  </div>
                </div>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--ed-steel-400)', lineHeight: 1.55, marginBottom: 16 }}>
                Bond a manifest, declare your model, stake collateral, and start executing signed intents on vaults that pick you.
              </p>
              <Link to="/operator/register" className="block">
                <ControlButton variant="gold" className="w-full">
                  <Plus className="w-3 h-3" /> Register as operator
                </ControlButton>
              </Link>
              <div
                className="flex items-center justify-between mt-3 ed-mono text-[10.5px]"
                style={{ color: 'var(--ed-steel-500)' }}
              >
                <span>Onboarding · 24 h review</span>
                <Link to="/whitepaper" className="transition-colors" style={{ color: 'var(--ed-cyan)' }}>
                  Read spec →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Registry banner — adapts copy to demo vs live, single compact strip */}
      <div
        className="relative rounded-2xl ed-ghost p-5 flex items-start gap-4 overflow-hidden mb-6"
        style={{
          background: useDemoOperators
            ? 'linear-gradient(90deg, rgba(201,168,76,0.06), rgba(15,15,19,0.8))'
            : 'linear-gradient(90deg, rgba(76,201,240,0.06), rgba(15,15,19,0.8))',
        }}
      >
        <div aria-hidden className="absolute inset-0 ed-dotgrid opacity-20 pointer-events-none" />
        <div
          className="relative h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: useDemoOperators ? 'rgba(201,168,76,0.15)' : 'rgba(76,201,240,0.15)',
            color: useDemoOperators ? 'var(--ed-gold)' : 'var(--ed-cyan)',
          }}
        >
          <Activity className="w-3.5 h-3.5" />
        </div>
        <div className="relative flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span
              className="ed-mono text-[11px] uppercase tracking-[0.2em] whitespace-nowrap"
              style={{ color: 'var(--ed-steel-100)' }}
            >
              {useDemoOperators ? 'Demo roster' : 'Live registry'}
            </span>
            <span className={`ed-chip ${useDemoOperators ? 'ed-chip-gold' : 'ed-chip-cyan'}`}>
              {useDemoOperators ? 'Preview mode' : 'On-chain'}
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--ed-steel-400)', lineHeight: 1.55, maxWidth: 760 }}>
            {useDemoOperators ? (
              <>
                Preloaded with three differentiated operators so selection, pricing, tiers, and reputation stay demo-legible
                even when the on-chain registry is empty. Real state takes over as soon as someone registers.
              </>
            ) : (
              <>
                This marketplace reads from the real operator registry on-chain. If the roster is still small, that&rsquo;s genuine{' '}
                <span className="ed-italic" style={{ color: 'var(--ed-steel-100)' }}>live state</span>, not missing mock data.
              </>
            )}
          </p>
        </div>
        {useDemoOperators ? (
          <Link
            to="/governance"
            className="ed-mono text-[11px] uppercase tracking-[0.2em] whitespace-nowrap inline-flex items-center gap-1.5 transition-colors"
            style={{ color: 'var(--ed-cyan)' }}
          >
            View governance oversight
          </Link>
        ) : registryExplorerHref ? (
          <a
            href={registryExplorerHref}
            target="_blank"
            rel="noreferrer"
            className="ed-mono text-[11px] uppercase tracking-[0.2em] whitespace-nowrap inline-flex items-center gap-1.5 transition-colors"
            style={{ color: 'var(--ed-cyan)' }}
          >
            View registry on explorer <ExternalLink className="w-3 h-3" />
          </a>
        ) : null}
      </div>

      {/* Toolbar — search + mandate in row 1, filters + sort in row 2 */}
      <div
        className="rounded-2xl ed-ghost p-3 flex flex-col gap-3 mb-6"
        style={{ background: 'var(--ed-surface-0)' }}
      >
        <div className="flex flex-col lg:flex-row gap-3">
          <div
            className="flex items-center gap-2 flex-1 px-3 rounded-xl ed-ghost"
            style={{ background: 'rgba(0,0,0,0.3)', height: 40 }}
          >
            <Search className="w-3.5 h-3.5" style={{ color: 'var(--ed-steel-500)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search operators by name, description, or address…"
              className="flex-1 bg-transparent outline-none text-[13px]"
              style={{ color: 'var(--ed-steel-100)' }}
            />
          </div>
          <SegGroup
            label="Mandate"
            activeKey={filter}
            onChange={setFilter}
            options={MANDATE_FILTERS}
          />
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <SegGroup
            label="Perf"
            activeKey={feeFilter}
            onChange={setFeeFilter}
            tone="cyan"
            options={[
              { key: 'all', label: 'Any' },
              { key: 'low', label: '≤ 10% perf' },
              { key: 'mid', label: '≤ 20% perf' },
            ]}
          />
          <span className="h-5 w-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <SegGroup
            label="Tier"
            activeKey={tierFilter}
            onChange={setTierFilter}
            options={[
              { key: 'all', label: 'Any' },
              { key: '1', label: 'Bronze+' },
              { key: '2', label: 'Silver+' },
              { key: '3', label: 'Gold+' },
            ]}
          />
          <button
            onClick={() => setVerifiedOnly((v) => !v)}
            className="ed-mono text-[11px] uppercase tracking-[0.16em] h-7 px-3 rounded-md ed-ghost whitespace-nowrap flex items-center gap-1.5 transition-all"
            style={{
              background: verifiedOnly ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.02)',
              color: verifiedOnly ? 'var(--ed-emerald)' : 'var(--ed-steel-300)',
            }}
          >
            <BadgeCheck className="w-3 h-3" /> Verified only
          </button>
          <div className="flex-1" />
          <SegGroup
            label="Sort"
            activeKey={sortBy}
            onChange={setSortBy}
            tone="emerald"
            options={[
              { key: 'newest', label: 'Newest' },
              { key: 'reputation', label: 'Reputation' },
              { key: 'mostExecutions', label: 'Most Trades' },
              { key: 'lowestFee', label: 'Lowest Fee' },
              { key: 'highestTier', label: 'Highest Tier' },
              { key: 'name', label: 'Name' },
            ]}
          />
        </div>
      </div>

      {/* Featured operator + staking tiers legend (2-col) */}
      {filtered.length > 0 && (
        <>
          <div className="flex items-center gap-4 mb-4">
            <span className="ed-eyebrow">§ M.02 · Featured · tier S</span>
            <div className="flex-1 ed-hairline" />
          </div>
          <div className="grid gap-5 mb-8" style={{ gridTemplateColumns: '1.55fr 1fr' }}>
            <FeaturedOperatorCard
              op={filtered[0]}
              tier={tierSource[filtered[0].wallet?.toLowerCase()]}
              reputation={reputationSource[filtered[0].wallet?.toLowerCase()]}
            />
            <StakingTiersPanel />
          </div>
        </>
      )}

      {/* Operator Grid */}
      {!registryConfigured && !useDemoOperators ? (
        <GlassPanel className="p-8 text-center">
          <Cpu className="w-10 h-10 text-steel/20 mx-auto mb-3" />
          <p className="text-sm text-steel/50">Operator Registry not deployed on this network yet.</p>
          <p className="text-[11px] text-steel/30 mt-1">Run the deploy script to enable the marketplace.</p>
        </GlassPanel>
      ) : isLoading ? (
        <GlassPanel className="p-8 text-center">
          <div className="w-6 h-6 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-steel/40">Loading operators from chain...</p>
        </GlassPanel>
      ) : filtered.length === 0 ? (
        <GlassPanel className="p-12 text-center border-dashed">
          <Users className="w-10 h-10 text-steel/20 mx-auto mb-3" />
          <p className="text-sm text-steel/50">
            {operatorSource.length === 0
              ? 'No operators registered yet — be the first.'
              : 'No operators match your filters.'}
          </p>
          <p className="text-[11px] text-steel/35 mt-1 max-w-xl mx-auto leading-relaxed">
            {operatorSource.length === 0
              ? 'The registry is live, but nobody has published an active operator profile yet. Vaults can still use a custom executor while the marketplace warms up.'
              : 'The live registry has entries, but your current filters are hiding all of them. Reset filters or search a broader term.'}
          </p>
          {operatorSource.length === 0 && (
            <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
              <Link to="/operator/register">
                <ControlButton variant="gold" size="sm">
                  <Plus className="w-3 h-3" /> Register as Operator
                </ControlButton>
              </Link>
              <Link to="/create">
                <ControlButton variant="secondary" size="sm">
                  <Cpu className="w-3 h-3" /> Use Custom Executor
                </ControlButton>
              </Link>
            </div>
          )}
        </GlassPanel>
      ) : (
        <>
          {/* Listings section header */}
          <div className="flex items-center gap-4 mb-4">
            <span className="ed-eyebrow">§ M.02 · Operator listings</span>
            <div className="flex-1 ed-hairline" />
            <span
              className="ed-mono text-[10.5px] uppercase tracking-[0.2em]"
              style={{ color: 'var(--ed-steel-500)' }}
            >
              Showing {String(filtered.length).padStart(2, '0')} of {String(operatorSource.filter((o) => o.loaded && o.active).length).padStart(2, '0')}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {filtered.map((op) => (
              <OperatorRowCard
                key={op.wallet}
                op={op}
                chainId={chainId}
                tierData={tierSource[op.wallet?.toLowerCase()]}
                repData={reputationSource[op.wallet?.toLowerCase()]}
                extended={extendedByAddress[op.wallet?.toLowerCase()]}
              />
            ))}
          </div>
        </>
      )}

      {/* Trust model — emerald gradient strip with three reassurances */}
      <div
        className="rounded-2xl ed-ghost p-5 relative overflow-hidden mt-6"
        style={{ background: 'linear-gradient(90deg, rgba(16,185,129,0.04), rgba(15,15,19,0.8))' }}
      >
        <div className="flex items-center gap-4 mb-4">
          <span className="ed-eyebrow" style={{ color: 'var(--ed-emerald)' }}>— trust model</span>
          <div className="flex-1 ed-hairline" />
        </div>
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {[
            {
              Icon: ShieldCheck,
              accent: 'Operators have zero access',
              body: (
                <>
                  {' '}to your funds. They can only call
                  <code className="ed-mono ml-1" style={{ color: 'var(--ed-cyan)' }}>executeIntent()</code> and pass on-chain policy checks.
                </>
              ),
            },
            {
              Icon: RefreshCw,
              accent: 'You can switch operators anytime',
              body: (
                <>
                  {' '}from the vault detail page —
                  <code className="ed-mono ml-1" style={{ color: 'var(--ed-cyan)' }}>setExecutor()</code> is owner-only.
                </>
              ),
            },
            {
              Icon: Bolt,
              accent: 'Set tight policies',
              body: ' (low max position, low daily loss) and you cap any operator’s worst-case behavior.',
            },
          ].map((t, i) => (
            <div key={i} className="flex items-start gap-3">
              <div
                className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--ed-emerald)' }}
              >
                <t.Icon className="w-[13px] h-[13px]" />
              </div>
              <p style={{ fontSize: 13, color: 'var(--ed-steel-400)', lineHeight: 1.55, margin: 0 }}>
                <span className="ed-italic" style={{ color: 'var(--ed-steel-100)' }}>{t.accent}</span>{t.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Editorial featured-operator card — highlighted top row in the marketplace.
// Uses the actual filtered[0] operator so featured content is data-driven, not
// hardcoded. Bio comes from the on-chain description field.
function FeaturedOperatorCard({ op, tier, reputation }) {
  if (!op) return null;
  const tierLabel = tier?.tier === 3 ? 'S' : tier?.tier === 2 ? 'A' : tier?.tier === 1 ? 'B' : '—';
  const handle = op.endpoint ? op.endpoint.replace(/^https?:\/\//, '').split('/')[0] : op.name;
  const shortAddr = op.wallet ? `${op.wallet.slice(0, 8)}…${op.wallet.slice(-6)}` : '—';
  const bio = op.description || 'No strategy description provided.';
  const perfPct = ((op.performanceFeeBps || 0) / 100).toFixed(1);
  const mgmtPct = ((op.managementFeeBps || 0) / 100).toFixed(1);
  const repScore = reputation?.reputationScore ?? reputation?.score;
  const totalExec = reputation?.totalExecutions ?? 0;
  return (
    <div
      className="ed-card ed-ghost-gold relative overflow-hidden"
      style={{ padding: 28 }}
    >
      <div
        className="absolute pointer-events-none"
        style={{
          top: 0,
          right: 0,
          width: 300,
          height: 300,
          backgroundImage:
            'radial-gradient(circle at 100% 0%, rgba(201,168,76,0.10), transparent 60%)',
        }}
      />
      <div className="relative">
        <div className="flex items-center justify-between gap-2.5 mb-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="ed-chip ed-chip-gold">
              <Trophy className="w-[11px] h-[11px]" /> Featured · tier {tierLabel}
            </span>
            <span
              className="ed-mono text-[10.5px] uppercase"
              style={{ color: 'var(--ed-steel-500)', letterSpacing: '0.22em' }}
            >
              Rank #01
            </span>
          </div>
          <button
            className="transition-colors"
            style={{ color: 'var(--ed-steel-500)' }}
            aria-label="Bookmark operator"
            type="button"
          >
            <Bookmark className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid items-start gap-5" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <div
            className="flex items-center justify-center"
            style={{
              width: 80,
              height: 80,
              borderRadius: 16,
              background: 'linear-gradient(135deg, var(--ed-surface-2), var(--ed-surface-1))',
              boxShadow: 'var(--ed-ghost-border-gold)',
              color: 'var(--ed-gold)',
            }}
          >
            <Cpu className="w-9 h-9" />
          </div>
          <div className="min-w-0">
            <h3
              className="ed-display"
              style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em', margin: 0 }}
            >
              {op.name}
            </h3>
            <div className="flex gap-2.5 items-center flex-wrap mt-1.5">
              <span className="ed-mono text-[12px]" style={{ color: 'var(--ed-cyan)' }}>
                {handle}
              </span>
              <span style={{ color: 'var(--ed-steel-600)' }}>·</span>
              <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-500)' }}>
                {shortAddr}
              </span>
            </div>
            <p
              className="ed-italic mt-3.5"
              style={{
                fontSize: 14,
                color: 'var(--ed-steel-200)',
                lineHeight: 1.55,
                margin: '14px 0 0',
                maxWidth: 560,
              }}
            >
              "{bio}"
            </p>
          </div>
        </div>

        <div className="ed-hairline my-5" />

        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {[
            { k: 'Mandate', v: op.mandateLabel || '—', c: 'var(--ed-gold)' },
            { k: 'Perf fee', v: `${perfPct}%`, c: 'var(--ed-steel-100)' },
            { k: 'Mgmt fee', v: `${mgmtPct}%`, c: 'var(--ed-steel-100)' },
            {
              k: repScore != null ? 'Reputation' : 'Actions',
              v: repScore != null ? String(repScore) : String(totalExec),
              c: 'var(--ed-emerald)',
            },
          ].map((x, i) => (
            <div
              key={i}
              style={{ borderLeft: i ? '1px solid rgba(255,255,255,0.06)' : 'none', paddingLeft: i ? 18 : 0 }}
            >
              <div
                className="ed-mono mb-1"
                style={{ fontSize: 9.5, color: 'var(--ed-steel-500)', letterSpacing: '0.2em' }}
              >
                {x.k.toUpperCase()}
              </div>
              <div
                className="ed-display"
                style={{ fontSize: 20, color: x.c, fontWeight: 600, letterSpacing: '-0.02em' }}
              >
                {x.v}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2.5 mt-5">
          <Link to={`/operator/${op.wallet}`}>
            <ControlButton variant="gold">
              View profile <ArrowRight className="w-3.5 h-3.5" />
            </ControlButton>
          </Link>
          <Link to={`/create?operator=${op.wallet}`}>
            <ControlButton variant="secondary">Assign to vault</ControlButton>
          </Link>
        </div>
      </div>
    </div>
  );
}

// Editorial stake-tiers panel — reference legend showing what each tier
// entitles an operator to, and a short note on how slashing works. Sits next
// to the featured operator card so vault owners see the floor requirement
// alongside who's at the top of the leaderboard.
function StakingTiersPanel() {
  const tiers = [
    {
      t: 'S',
      range: '≥ 50K A0G',
      perks: 'Featured + sealed mode + governance vote',
      color: 'var(--ed-gold)',
      border: 'rgba(201,168,76,0.28)',
    },
    {
      t: 'A',
      range: '20K – 50K',
      perks: 'Multi-vault assignments · slashing 20%',
      color: 'var(--ed-cyan)',
      border: 'rgba(255,255,255,0.08)',
    },
    {
      t: 'B',
      range: '5K – 20K',
      perks: 'Single vault · review-tier signals',
      color: 'var(--ed-emerald)',
      border: 'rgba(255,255,255,0.08)',
    },
    {
      t: 'C',
      range: '< 5K',
      perks: 'Shadow mode · no live assignment',
      color: 'var(--ed-steel-300)',
      border: 'rgba(255,255,255,0.08)',
    },
  ];
  return (
    <div className="ed-card p-6 flex flex-col">
      <div className="flex items-baseline gap-3.5 mb-2">
        <span className="ed-eyebrow">§ M.03</span>
        <span
          className="ed-mono text-[10.5px] tracking-[0.22em] uppercase"
          style={{ color: 'var(--ed-steel-400)' }}
        >
          Stake tiers
        </span>
      </div>
      <h3
        className="ed-display mb-4"
        style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}
      >
        Skin,{' '}
        <span className="ed-italic" style={{ color: 'var(--ed-gold)', fontWeight: 400 }}>
          in tiers
        </span>
      </h3>

      <div className="mt-3">
        {tiers.map((r, i) => (
          <div
            key={r.t}
            className="grid items-center gap-3 py-3.5"
            style={{
              gridTemplateColumns: '38px 1fr auto',
              borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none',
            }}
          >
            <div
              className="flex items-center justify-center"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'var(--ed-surface-2)',
                boxShadow: `inset 0 0 0 1px ${r.border}`,
                color: r.color,
              }}
            >
              <span className="ed-mono text-[13px] font-bold">{r.t}</span>
            </div>
            <div>
              <div className="text-[12.5px]" style={{ color: 'var(--ed-steel-100)' }}>
                {r.perks}
              </div>
              <div
                className="ed-mono text-[10px] mt-0.5"
                style={{ color: 'var(--ed-steel-500)' }}
              >
                {r.range}
              </div>
            </div>
            <ArrowRight className="w-3.5 h-3.5" color="var(--ed-steel-500)" />
          </div>
        ))}
      </div>

      <div className="flex-1" />
      <div
        className="ed-ghost-gold mt-4 p-3.5"
        style={{ background: 'var(--ed-obsidian-dim)', borderRadius: 10 }}
      >
        <div
          className="ed-mono mb-1.5"
          style={{ fontSize: 10, color: 'var(--ed-gold)', letterSpacing: '0.18em' }}
        >
          SLASHING
        </div>
        <p style={{ fontSize: 12, color: 'var(--ed-steel-300)', lineHeight: 1.5, margin: 0 }}>
          Misbehavior forfeits 10–50% of stake. Treasury claim goes to the affected vault first,
          then to the insurance tranche.
        </p>
      </div>
    </div>
  );
}

// Full-width operator row — [icon | main column | actions] grid, dense
// metadata pills + tiny mono annotations underneath. Used for every
// non-featured operator listing. Mirrors the OpRow component in the
// editorial Marketplace.html reference.
function OperatorRowCard({ op, chainId, tierData, repData, extended }) {
  const operatorExplorerHref = getExplorerAddressHref(chainId, op.wallet);
  const tier = tierData?.tier || 0;
  const aiModelShort = extended?.aiModel
    ? (extended.aiModel.split('/').pop()?.split('-').slice(0, 2).join('-') || extended.aiModel)
    : null;
  // `nowSec` is captured once per mount — re-reading Date.now() during render
  // is flagged by react-hooks/purity and can give unstable results across
  // re-renders. Pinning it at mount is fine: the "new operator" badge drifts
  // off on the next mount, which happens every navigation.
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000));
  const isNew = op.registeredAt && (nowSec - op.registeredAt) < 7 * 24 * 3600;

  return (
    <div
      className="rounded-2xl ed-ghost p-5 grid gap-5 items-center transition-all hover:bg-white/[0.02]"
      style={{ background: 'var(--ed-surface-0)', gridTemplateColumns: 'auto 1fr auto' }}
    >
      {/* Icon tile */}
      <div
        className="h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          background: 'rgba(76,201,240,0.1)',
          boxShadow: 'inset 0 0 0 1px rgba(76,201,240,0.25)',
          color: 'var(--ed-cyan)',
        }}
      >
        <Cpu className="w-5 h-5" />
      </div>

      {/* Main column: name + description + pills */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[15px] font-medium whitespace-nowrap" style={{ color: 'var(--ed-steel-100)' }}>
            {op.name}
          </span>
          {repData?.verified && (
            <BadgeCheck className="w-3.5 h-3.5" style={{ color: 'var(--ed-cyan)' }} />
          )}
          <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-500)' }}>
            {shortHexLabel(op.wallet)}
          </span>
          <span className="ed-chip ed-chip-cyan">{op.mandateLabel}</span>
          {isNew && (
            <span className="ed-chip ed-chip-emerald">
              <span className="inline-block rounded-full" style={{ width: 4, height: 4, background: 'var(--ed-emerald)' }} />
              New
            </span>
          )}
          {tier > 0 && (
            <span className={`ed-chip ed-chip-steel ${TIER_COLORS[tier] || ''}`}>
              <Award className="w-2.5 h-2.5" /> {TIER_LABELS[tier]}
            </span>
          )}
          {tierData?.frozen && <span className="ed-chip ed-chip-rose">Frozen</span>}
        </div>

        <p
          className="line-clamp-2"
          style={{ fontSize: 12.5, color: 'var(--ed-steel-400)', lineHeight: 1.5 }}
        >
          {op.description || 'No description provided.'}
        </p>

        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          <RowPill label="Perf" value={formatBps(op.performanceFeeBps)} tone="emerald" Icon={TrendingUp} />
          <RowPill label="Mgmt" value={formatBps(op.managementFeeBps)} tone="cyan" Icon={Percent} />
          {repData && repData.totalExecutions > 0 && (
            <RowPill label="Actions" value={repData.totalExecutions} tone="gold" Icon={Bolt} />
          )}
          {repData && typeof repData.reputationScore === 'number' && (
            <RowPill label="Rep" value={repData.reputationScore} tone="cyan" Icon={Trophy} />
          )}
          {repData && repData.ratingCount > 0 && (
            <RowPill label="Rating" value={repData.averageRating.toFixed(1)} tone="gold" Icon={Star} />
          )}

          {/* Tiny metadata annotations */}
          <span className="ed-mono text-[10.5px] ml-1 flex items-center gap-1.5" style={{ color: 'var(--ed-steel-500)' }}>
            <Clock className="w-2.5 h-2.5" />
            Since {new Date(op.registeredAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          {aiModelShort && (
            <span
              className="ed-mono text-[10.5px] flex items-center gap-1.5"
              style={{ color: 'var(--ed-steel-500)' }}
              title={`AI Model: ${extended.aiModel}`}
            >
              <Sparkles className="w-2.5 h-2.5" />
              {aiModelShort}
            </span>
          )}
          {extended?.manifestURI && (
            <span
              className="ed-mono text-[10.5px] flex items-center gap-1.5"
              style={{ color: extended.manifestBonded ? 'var(--ed-gold)' : 'var(--ed-steel-500)' }}
              title={extended.manifestBonded ? 'Bonded manifest — slashable on deviation' : 'Strategy manifest published'}
            >
              <Shield className="w-2.5 h-2.5" />
              {extended.manifestBonded ? 'Bonded' : 'Manifest'}
            </span>
          )}
          {tierData && tierData.maxVaultSize > 0 && (
            <span className="ed-mono text-[10.5px] flex items-center gap-1.5" style={{ color: 'var(--ed-steel-500)' }}>
              <Layers className="w-2.5 h-2.5" />
              Cap {formatVaultCap(tierData.maxVaultSize, tierData.isUnlimited)}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {operatorExplorerHref && (
          <a
            href={operatorExplorerHref}
            target="_blank"
            rel="noreferrer"
            className="ed-mono text-[11px] uppercase tracking-[0.2em] inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
            style={{ color: 'var(--ed-steel-500)' }}
          >
            Explorer <ExternalLink className="w-[11px] h-[11px]" />
          </a>
        )}
        <Link to={`/operator/${op.wallet}`}>
          <ControlButton variant="secondary" size="sm">
            <ArrowRight className="w-3 h-3" /> View
          </ControlButton>
        </Link>
      </div>
    </div>
  );
}
