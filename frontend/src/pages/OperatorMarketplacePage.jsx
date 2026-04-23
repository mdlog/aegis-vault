import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useChainId } from 'wagmi';
import {
  ENABLE_DEMO_FALLBACKS,
  getDeployments,
  getExplorerAddressHref,
  isConfiguredAddress,
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
import StatusPill from '../components/ui/StatusPill';
import SectionLabel from '../components/ui/SectionLabel';
import ControlButton from '../components/ui/ControlButton';
import ExplorerAnchor from '../components/ui/ExplorerAnchor';
import {
  Cpu, Search, Plus, ArrowRight, Users, Activity, ShieldCheck, Globe, Tag,
  TrendingUp, Percent, DollarSign, Award, Lock, Star, BadgeCheck, ExternalLink, FileText,
} from 'lucide-react';

const MANDATE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'Conservative', label: 'Conservative' },
  { key: 'Balanced', label: 'Balanced' },
  { key: 'Tactical', label: 'Tactical' },
];

const MANDATE_COLORS = {
  Conservative: 'text-emerald-soft/80 bg-emerald-soft/5 border-emerald-soft/15',
  Balanced: 'text-cyan/80 bg-cyan/5 border-cyan/15',
  Tactical: 'text-gold/80 bg-gold/5 border-gold/15',
};

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
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-baseline gap-3.5 mb-2">
            <span className="ed-eyebrow">§ M.01</span>
            <span className="ed-mono text-[10.5px] tracking-[0.22em] uppercase" style={{ color: 'var(--ed-steel-400)' }}>
              Operator marketplace
            </span>
          </div>
          <h1
            className="ed-display"
            style={{ fontSize: 40, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, margin: 0 }}
          >
            The operators, <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>and their record.</span>
          </h1>
          <p className="text-[13px] mt-3 max-w-[680px]" style={{ color: 'var(--ed-steel-400)', lineHeight: 1.55 }}>
            Stake is skin. Reputation is history. Every operator here can be slashed — and every vault is free to replace them.
          </p>
        </div>
        <Link to="/operator/register">
          <ControlButton variant="gold">
            <Plus className="w-3.5 h-3.5" /> Register as Operator
          </ControlButton>
        </Link>
      </div>

      {useDemoOperators && (
        <GlassPanel gold className="p-4 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gold/75 mb-1">
                Demo Roster Active
              </div>
              <p className="text-sm text-steel/55 max-w-3xl">
                The marketplace is preloaded with three differentiated operators so the product demo always shows selection,
                pricing, staking tiers, and reputation even before the on-chain registry is populated.
              </p>
            </div>
            <Link to="/governance" className="text-[11px] font-mono text-cyan/60 hover:text-cyan transition-colors">
              View governance oversight
            </Link>
          </div>
        </GlassPanel>
      )}

      {!useDemoOperators && registryConfigured && (
        <GlassPanel className="p-4 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-cyan/75 mb-1">
                Live Registry
              </div>
              <p className="text-sm text-steel/55 max-w-3xl">
                This marketplace is reading the real operator registry on-chain. If the roster is still small, that is
                genuine live state, not missing mock data.
              </p>
            </div>
            {registryExplorerHref && (
              <a
                href={registryExplorerHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-mono text-cyan/60 hover:text-cyan transition-colors"
              >
                View registry on explorer <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </GlassPanel>
      )}

      {/* Editorial summary strip — 4-col fortress stat grid */}
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
      >
        {[
          { k: 'Operators', v: String(countLabel), c: 'var(--ed-steel-100)' },
          {
            k: 'Active',
            v: String(operatorSource.filter((o) => o.loaded && o.active).length),
            c: 'var(--ed-emerald)',
          },
          {
            k: 'Mandates',
            v: String(new Set(operatorSource.filter((o) => o.loaded).map((o) => o.mandateLabel)).size),
            c: 'var(--ed-gold)',
          },
          {
            k: 'Source',
            v: useDemoOperators ? 'DEMO' : registryAddress ? 'LIVE' : 'OFFLINE',
            c: useDemoOperators
              ? 'var(--ed-gold)'
              : registryAddress
                ? 'var(--ed-cyan)'
                : 'var(--ed-rose)',
          },
        ].map((x, i) => (
          <div key={i} className="ed-card" style={{ padding: 20 }}>
            <div
              className="ed-mono mb-2"
              style={{ fontSize: 10, color: 'var(--ed-steel-500)', letterSpacing: '0.2em' }}
            >
              {x.k.toUpperCase()}
            </div>
            <div
              className="ed-display"
              style={{
                fontSize: 28,
                color: x.c,
                fontWeight: 600,
                letterSpacing: '-0.03em',
              }}
            >
              {x.v}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex items-center gap-2 flex-1 px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.06]">
            <Search className="w-4 h-4 text-steel/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search operators by name, description, or address..."
              className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-steel/30"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {MANDATE_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-mono transition-all ${
                  filter === f.key
                    ? 'bg-gold/15 text-gold border border-gold/30'
                    : 'bg-white/[0.03] text-steel/50 border border-white/[0.06] hover:border-white/[0.1]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-steel/40 mr-1">Fee:</span>
            {[
              { key: 'all', label: 'Any' },
              { key: 'low', label: '≤ 10% perf' },
              { key: 'mid', label: '≤ 20% perf' },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFeeFilter(f.key)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-mono transition-all ${
                  feeFilter === f.key
                    ? 'bg-cyan/15 text-cyan border border-cyan/30'
                    : 'bg-white/[0.03] text-steel/50 border border-white/[0.06] hover:border-white/[0.1]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-steel/40 mr-1">Tier:</span>
            {[
              { key: 'all', label: 'Any' },
              { key: '1', label: 'Bronze+' },
              { key: '2', label: 'Silver+' },
              { key: '3', label: 'Gold+' },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTierFilter(t.key)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-mono transition-all ${
                  tierFilter === t.key
                    ? 'bg-gold/15 text-gold border border-gold/30'
                    : 'bg-white/[0.03] text-steel/50 border border-white/[0.06] hover:border-white/[0.1]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setVerifiedOnly(v => !v)}
            className={`px-3 py-1.5 rounded-md text-[11px] font-mono transition-all flex items-center gap-1 ${
              verifiedOnly
                ? 'bg-cyan/15 text-cyan border border-cyan/30'
                : 'bg-white/[0.03] text-steel/50 border border-white/[0.06] hover:border-white/[0.1]'
            }`}
          >
            <BadgeCheck className="w-3 h-3" />
            Verified only
          </button>
          <div className="flex items-center gap-1.5 lg:ml-auto">
            <span className="text-[10px] font-mono uppercase tracking-wider text-steel/40 mr-1">Sort:</span>
            {[
              { key: 'newest', label: 'Newest' },
              { key: 'reputation', label: 'Reputation' },
              { key: 'mostExecutions', label: 'Most Trades' },
              { key: 'lowestFee', label: 'Lowest Fee' },
              { key: 'highestTier', label: 'Highest Tier' },
              { key: 'name', label: 'Name' },
            ].map((s) => (
              <button
                key={s.key}
                onClick={() => setSortBy(s.key)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-mono transition-all ${
                  sortBy === s.key
                    ? 'bg-emerald-soft/15 text-emerald-soft border border-emerald-soft/30'
                    : 'bg-white/[0.03] text-steel/50 border border-white/[0.06] hover:border-white/[0.1]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Editorial featured operator + staking tiers legend (2-col) */}
      {filtered.length > 0 && (
        <div className="grid gap-5 mb-6" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
          <FeaturedOperatorCard
            op={filtered[0]}
            tier={tierSource[filtered[0].wallet?.toLowerCase()]}
            reputation={reputationSource[filtered[0].wallet?.toLowerCase()]}
          />
          <StakingTiersPanel />
        </div>
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
        <div className="grid lg:grid-cols-2 gap-4">
          {filtered.map((op) => {
            const tierData = tierSource[op.wallet?.toLowerCase()];
            const tier = tierData?.tier || 0;
            const repData = reputationSource[op.wallet?.toLowerCase()];
            const operatorExplorerHref = getExplorerAddressHref(chainId, op.wallet);
            return (
              <div key={op.wallet}>
                <GlassPanel className="p-5 group hover:border-gold/20 transition-all h-full" hover>
                  <Link to={`/operator/${op.wallet}`} className="block">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center flex-shrink-0">
                          <Cpu className="w-5 h-5 text-gold/70" />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <h3 className="text-base font-display font-semibold text-white">{op.name}</h3>
                            {repData?.verified && (
                              <BadgeCheck className="w-3.5 h-3.5 text-cyan" title="Verified Operator" />
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-steel/40">
                            {shortHexLabel(op.wallet)}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
                            MANDATE_COLORS[op.mandateLabel] || 'text-steel/50 bg-white/[0.02] border-white/[0.06]'
                          }`}
                        >
                          {op.mandateLabel}
                        </span>
                        {tier > 0 && (
                          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border bg-white/[0.02] border-white/[0.06] flex items-center gap-1 ${TIER_COLORS[tier]}`}>
                            <Award className="w-2.5 h-2.5" />
                            {TIER_LABELS[tier]}
                          </span>
                        )}
                        {tierData?.frozen && (
                          <span className="text-[9px] font-mono text-red-warn/80 px-1.5 py-0.5 rounded bg-red-warn/10 border border-red-warn/20">FROZEN</span>
                        )}
                      </div>
                    </div>

                    <p className="text-[11px] text-steel/55 leading-relaxed mb-3 line-clamp-3 min-h-[42px]">
                      {op.description || 'No description provided.'}
                    </p>

                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      <div className="rounded-md bg-gold/[0.04] border border-gold/15 px-2 py-1.5">
                        <div className="flex items-center gap-1 mb-0.5">
                          <TrendingUp className="w-2.5 h-2.5 text-gold/60" />
                          <span className="text-[8px] font-mono uppercase tracking-wider text-steel/40">Perf</span>
                        </div>
                        <div className="text-[11px] font-mono text-gold tabular-nums">
                          {formatBps(op.performanceFeeBps)}
                        </div>
                      </div>
                      <div className="rounded-md bg-cyan/[0.04] border border-cyan/15 px-2 py-1.5">
                        <div className="flex items-center gap-1 mb-0.5">
                          <Percent className="w-2.5 h-2.5 text-cyan/60" />
                          <span className="text-[8px] font-mono uppercase tracking-wider text-steel/40">Mgmt</span>
                        </div>
                        <div className="text-[11px] font-mono text-cyan tabular-nums">
                          {formatBps(op.managementFeeBps)}
                        </div>
                      </div>
                      <div className="rounded-md bg-white/[0.02] border border-white/[0.06] px-2 py-1.5">
                        <div className="flex items-center gap-1 mb-0.5">
                          <DollarSign className="w-2.5 h-2.5 text-steel/40" />
                          <span className="text-[8px] font-mono uppercase tracking-wider text-steel/40">Entry</span>
                        </div>
                        <div className="text-[11px] font-mono text-steel/70 tabular-nums">
                          {formatBps(op.entryFeeBps)}
                        </div>
                      </div>
                      <div className="rounded-md bg-white/[0.02] border border-white/[0.06] px-2 py-1.5">
                        <div className="flex items-center gap-1 mb-0.5">
                          <DollarSign className="w-2.5 h-2.5 text-steel/40" />
                          <span className="text-[8px] font-mono uppercase tracking-wider text-steel/40">Exit</span>
                        </div>
                        <div className="text-[11px] font-mono text-steel/70 tabular-nums">
                          {formatBps(op.exitFeeBps)}
                        </div>
                      </div>
                    </div>
                  </Link>

                  <div className="flex items-center justify-between pt-3 border-t border-white/[0.04] gap-3">
                    <div className="flex items-center gap-3 text-[10px] font-mono text-steel/40 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Tag className="w-3 h-3" />
                        Since {new Date(op.registeredAt * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      </span>
                      {op.endpoint && (
                        <span className="flex items-center gap-1 text-cyan/40">
                          <Globe className="w-3 h-3" />
                          API
                        </span>
                      )}
                      {extendedByAddress[op.wallet?.toLowerCase()]?.aiModel && (
                        <span className="flex items-center gap-1 text-cyan/60" title={`AI Model: ${extendedByAddress[op.wallet.toLowerCase()].aiModel}`}>
                          <Cpu className="w-3 h-3" />
                          {extendedByAddress[op.wallet.toLowerCase()].aiModel.split('/').pop()?.split('-')[0] || 'AI'}
                        </span>
                      )}
                      {extendedByAddress[op.wallet?.toLowerCase()]?.manifestURI && (
                        <span
                          className={`flex items-center gap-1 ${extendedByAddress[op.wallet.toLowerCase()].manifestBonded ? 'text-gold/70' : 'text-steel/50'}`}
                          title={extendedByAddress[op.wallet.toLowerCase()].manifestBonded ? 'Bonded strategy manifest — slashable on deviation' : 'Strategy manifest published'}
                        >
                          <FileText className="w-3 h-3" />
                          {extendedByAddress[op.wallet.toLowerCase()].manifestBonded ? 'Bonded' : 'Manifest'}
                        </span>
                      )}
                      {tierData && tierData.maxVaultSize > 0 && (
                        <span className="flex items-center gap-1 text-emerald-soft/50">
                          <Lock className="w-3 h-3" />
                          Cap {formatVaultCap(tierData.maxVaultSize, tierData.isUnlimited)}
                        </span>
                      )}
                      {repData && repData.totalExecutions > 0 && (
                        <span className="flex items-center gap-1 text-cyan/40">
                          <Activity className="w-3 h-3" />
                          {repData.totalExecutions}
                        </span>
                      )}
                      {repData && repData.ratingCount > 0 && (
                        <span className="flex items-center gap-1 text-amber-warn/60">
                          <Star className="w-3 h-3" fill="currentColor" />
                          {repData.averageRating.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {operatorExplorerHref && (
                        <ExplorerAnchor
                          href={operatorExplorerHref}
                          label="Explorer"
                          className="text-[10px] font-mono text-cyan/60 hover:text-cyan transition-colors"
                        />
                      )}
                      <Link to={`/operator/${op.wallet}`} className="flex items-center gap-1 text-[11px] text-gold/60 group-hover:text-gold transition-colors">
                        View <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                </GlassPanel>
              </div>
            );
          })}
        </div>
      )}

      {/* Trust Disclaimer */}
      <GlassPanel className="p-4 mt-6">
        <SectionLabel color="text-cyan/60">Trust Model</SectionLabel>
        <div className="grid lg:grid-cols-3 gap-4 text-[11px] text-steel/55">
          <div className="flex gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-soft/60 flex-shrink-0 mt-0.5" />
            <p>
              Operators have <strong className="text-white/70">zero access</strong> to your funds. They can only call
              <code className="text-cyan/50 font-mono"> executeIntent()</code> and pass on-chain policy checks.
            </p>
          </div>
          <div className="flex gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-soft/60 flex-shrink-0 mt-0.5" />
            <p>
              You can <strong className="text-white/70">switch operators anytime</strong> from the vault detail page —
              <code className="text-cyan/50 font-mono"> setExecutor()</code> is owner-only.
            </p>
          </div>
          <div className="flex gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-soft/60 flex-shrink-0 mt-0.5" />
            <p>
              Set <strong className="text-white/70">tight policies</strong> (low max position, low daily loss) and you
              cap any operator's worst-case behavior.
            </p>
          </div>
        </div>
      </GlassPanel>
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
        <div className="flex items-center gap-2.5 mb-3">
          <span className="ed-chip ed-chip-gold">FEATURED · TIER {tierLabel}</span>
          <span
            className="ed-mono text-[10px]"
            style={{ color: 'var(--ed-steel-500)', letterSpacing: '0.14em' }}
          >
            RANK 01
          </span>
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
