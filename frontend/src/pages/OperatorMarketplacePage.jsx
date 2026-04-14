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
  const registryAddress = deployments.operatorRegistry;
  const stakingAddress = deployments.operatorStaking;
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
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-display font-semibold text-white tracking-tight mb-1">
            Operator Marketplace
          </h1>
          <p className="text-xs text-steel/50 max-w-2xl">
            Browse AI agent operators registered on-chain. Pick an operator to manage your vault — they only execute
            within your policy and can be replaced anytime. Funds stay in your vault.
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

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-3.5 h-3.5 text-cyan/60" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-steel/50">Operators</span>
          </div>
          <div className="text-2xl font-display font-semibold text-white">{countLabel}</div>
        </GlassPanel>
        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-soft/60" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-steel/50">Active</span>
          </div>
          <div className="text-2xl font-display font-semibold text-emerald-soft">
            {operatorSource.filter((o) => o.loaded && o.active).length}
          </div>
        </GlassPanel>
        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-3.5 h-3.5 text-gold/60" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-steel/50">Strategies</span>
          </div>
          <div className="text-2xl font-display font-semibold text-gold">
            {new Set(operatorSource.filter((o) => o.loaded).map((o) => o.mandateLabel)).size}
          </div>
        </GlassPanel>
        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Cpu className="w-3.5 h-3.5 text-steel/60" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-steel/50">Registry</span>
          </div>
          <div className="text-[10px] font-mono text-white/50 break-all">
            {useDemoOperators
              ? 'Hackathon demo roster'
              : registryAddress
                ? `${registryAddress.slice(0, 8)}...${registryAddress.slice(-6)}`
                : 'Not deployed'}
          </div>
        </GlassPanel>
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
