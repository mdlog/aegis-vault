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
  useKVState,
  useMultiAssetNAV,
  usePythPrices,
  usePlatformTVL,
  useAlerts,
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
import MetricCard from '../components/ui/MetricCard';
import StatusPill from '../components/ui/StatusPill';
import GlassPanel from '../components/ui/GlassPanel';
import SectionLabel from '../components/ui/SectionLabel';
import WalletButton from '../components/ui/WalletButton';
import ControlButton from '../components/ui/ControlButton';
import ExplorerAnchor from '../components/ui/ExplorerAnchor';
import DashboardShield from '../components/dashboard/DashboardShield';
import ProtocolHealthPanel from '../components/dashboard/ProtocolHealthPanel';
import PerformancePanel from '../components/dashboard/PerformancePanel';
import AllocationPanel from '../components/dashboard/AllocationPanel';
import RiskEventsPanel from '../components/dashboard/RiskEventsPanel';
import TokenIcon from '../components/ui/TokenIcon';
import { BigNumeric, AreaSpark, MonoKV } from '../components/editorial';
import {
  Shield, Activity, Radio, Zap, Plus,
  ArrowRight, Target, Wallet, Globe, User, Cpu, Vote, ExternalLink,
} from 'lucide-react';

// Editorial headline metrics slab — 4-col fortress stat bar with sparklines.
// Built on the same data the dashboard already resolves (Platform TVL, vault
// count, cycle count, aggregate risk) so no extra queries are needed.
function HeadlineMetrics({ tvl, tvlSource, totalVaults, vaultSubValue, cycleCount, riskScore, riskLevel }) {
  const items = [
    {
      k: 'Platform TVL',
      v: tvl.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      prefix: '$',
      delta: tvlSource,
      deltaTone: 'var(--ed-emerald)',
      spark: [3, 5, 4, 6, 8, 7, 9, 12, 11, 13, 14, 16, 18, 17, 19],
      color: 'var(--ed-gold)',
    },
    {
      k: 'Active vaults',
      v: String(totalVaults),
      prefix: '',
      delta: vaultSubValue,
      deltaTone: 'var(--ed-steel-400)',
      spark: [2, 3, 3, 4, 5, 6, 7, 7, 8, 9, 10, 11, 11, 12, 12],
      color: 'var(--ed-cyan)',
    },
    {
      k: 'AI cycles · lifetime',
      v: String(cycleCount),
      prefix: '',
      delta: cycleCount > 0 ? 'orchestrator streaming' : 'awaiting first cycle',
      deltaTone: cycleCount > 0 ? 'var(--ed-emerald)' : 'var(--ed-amber)',
      spark: [12, 18, 15, 22, 19, 28, 34, 32, 38, 41, 36, 44, 39, 42, 48],
      color: 'var(--ed-emerald)',
    },
    {
      k: 'Aggregate risk',
      v: String(riskScore),
      prefix: '',
      delta: `${riskLevel} · steady`,
      deltaTone:
        riskScore < 30 ? 'var(--ed-emerald)' : riskScore < 60 ? 'var(--ed-amber)' : 'var(--ed-rose)',
      spark: [45, 42, 40, 38, 36, 38, 35, 33, 34, 32, 31, 30, 32, 33, Math.max(1, Math.min(100, riskScore))],
      color: 'var(--ed-rose)',
    },
  ];
  return (
    <div className="ed-card overflow-hidden mb-8" style={{ padding: 0, borderRadius: 20 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {items.map((m, i) => (
          <div
            key={i}
            style={{
              padding: 26,
              borderRight: i < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none',
              position: 'relative',
            }}
          >
            <div
              className="ed-mono mb-4"
              style={{ fontSize: 10, color: 'var(--ed-steel-500)', letterSpacing: '0.2em' }}
            >
              {m.k.toUpperCase()}
            </div>
            <BigNumeric value={m.v} prefix={m.prefix} />
            <div className="ed-mono mt-3.5 text-[11px] truncate" style={{ color: m.deltaTone }}>
              {m.delta}
            </div>
            <div className="mt-3.5">
              <AreaSpark data={m.spark} color={m.color} h={44} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Editorial execution tape — rolling event stream from orchestrator alerts.
// Falls back to a placeholder line when no alerts have arrived yet so the
// section still has a visible heartbeat during early testnet / demo state.
function ProtocolPulse({ alerts }) {
  const list = Array.isArray(alerts) ? alerts.slice(0, 6) : [];
  const formatTime = (ts) => {
    if (!ts) return '—:—:—';
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    if (Number.isNaN(d.getTime())) return '—:—:—';
    return d.toISOString().slice(11, 19);
  };
  const kindFor = (lvl) => {
    if (lvl === 'critical' || lvl === 'blocked') return { k: 'VETO', c: 'var(--ed-rose)' };
    if (lvl === 'warning') return { k: 'SIGNAL', c: 'var(--ed-amber)' };
    if (lvl === 'info' || lvl === 'executed') return { k: 'EXECUTE', c: 'var(--ed-emerald)' };
    return { k: 'EVENT', c: 'var(--ed-cyan)' };
  };
  return (
    <div className="ed-card p-6 mb-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="flex items-baseline gap-3.5 mb-2">
            <span className="ed-eyebrow">§ A.02</span>
            <span
              className="ed-mono text-[10.5px] tracking-[0.22em] uppercase"
              style={{ color: 'var(--ed-steel-400)' }}
            >
              Execution tape
            </span>
          </div>
          <h3
            className="ed-display"
            style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}
          >
            Protocol pulse{' '}
            <span className="ed-italic" style={{ color: 'var(--ed-steel-400)', fontWeight: 400 }}>
              — last six events
            </span>
          </h3>
        </div>
        <span
          className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full"
          style={{
            background: 'rgba(16,185,129,0.08)',
            boxShadow: 'inset 0 0 0 1px rgba(16,185,129,0.25)',
          }}
        >
          <span className="ed-live-dot" />
          <span
            className="ed-mono text-[10px] tracking-[0.18em]"
            style={{ color: '#8AE6C2' }}
          >
            STREAMING
          </span>
        </span>
      </div>

      {list.length === 0 ? (
        <div
          className="text-center py-8"
          style={{
            borderTop: '1px dashed rgba(255,255,255,0.06)',
            borderBottom: '1px dashed rgba(255,255,255,0.06)',
          }}
        >
          <div
            className="ed-italic mb-2"
            style={{ fontSize: 18, color: 'var(--ed-steel-300)' }}
          >
            Waiting for the first heartbeat…
          </div>
          <p className="text-[11px] text-steel/45">
            Start the orchestrator and trigger a cycle. Events will stream here as they're emitted on-chain.
          </p>
        </div>
      ) : (
        <div>
          {list.map((e, i) => {
            const kind = kindFor(e.level || e.kind);
            const vault = e.vault ? `${e.vault.slice(0, 8)}…${e.vault.slice(-4)}` : '';
            const desc = e.message || e.reason || e.action || 'Event emitted';
            return (
              <div
                key={e.id || i}
                className="grid items-center py-3.5"
                style={{
                  gridTemplateColumns: '78px 84px 1fr auto',
                  gap: 16,
                  borderTop: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <span
                  className="ed-mono text-[11px]"
                  style={{ color: 'var(--ed-steel-500)' }}
                >
                  {formatTime(e.timestamp || e.ts || e.time)}
                </span>
                <span
                  className="ed-mono text-[10px] tracking-[0.16em]"
                  style={{ color: kind.c, fontWeight: 600 }}
                >
                  ● {kind.k}
                </span>
                <div>
                  <div className="text-[13.5px]" style={{ color: 'var(--ed-steel-100)' }}>
                    {desc}
                  </div>
                  {vault && (
                    <div
                      className="ed-mono text-[10.5px] mt-0.5"
                      style={{ color: 'var(--ed-steel-500)' }}
                    >
                      vault {vault}
                    </div>
                  )}
                </div>
                <span className="text-steel/40">
                  <ExternalLink className="w-3.5 h-3.5" />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function computeRisk(signal, fallback) {
  if (!signal?.confidence) return fallback;

  let score = 5;
  const confidence = signal.confidence;
  score += confidence < 0.4 ? 20 : confidence < 0.6 ? 12 : confidence < 0.8 ? 5 : 0;

  const bounded = Math.min(100, Math.max(0, score));
  return {
    score: bounded,
    level: bounded < 30 ? 'Low' : bounded < 60 ? 'Moderate' : bounded < 80 ? 'Elevated' : 'Critical',
  };
}

function VaultCard({ vault, isOwned, demo = false }) {
  const shortAddr = `${vault.address?.slice(0, 6)}...${vault.address?.slice(-4)}`;
  const { data: vaultNav } = useMultiAssetNAV(demo ? null : vault.address);
  const rawBalance = demo
    ? Number(vault.nav || vault.balance || 0)
    : vault.loaded
      ? parseFloat(vault.balance)
      : 0;
  const balance = demo ? rawBalance : vaultNav?.totalNav || rawBalance;
  const balanceSource = demo ? 'Demo' : vaultNav ? 'Pyth' : 'USDC';
  const isPaused = demo ? !!vault.paused : vault.loaded ? vault.paused : false;
  const title = demo ? vault.name : shortAddr;

  return (
    <Link to={getVaultRoute(vault.address)}>
      <GlassPanel
        gold={isOwned}
        className={`p-5 group transition-all ${isOwned ? 'hover:border-gold/30' : 'hover:border-white/[0.1]'}`}
        hover
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-sm font-display font-semibold text-white">{title}</h3>
              <StatusPill label={isPaused ? 'Paused' : 'Active'} variant={isPaused ? 'paused' : 'active'} pulse={!isPaused} />
              {isOwned && (
                <span className="text-[8px] font-mono text-gold/60 px-1.5 py-0.5 rounded bg-gold/5 border border-gold/10">
                  {demo ? 'FEATURED' : 'YOURS'}
                </span>
              )}
              {demo && vault.sealedMode && (
                <span className="text-[8px] font-mono text-cyan/60 px-1.5 py-0.5 rounded bg-cyan/5 border border-cyan/10">
                  SEALED
                </span>
              )}
            </div>
            <span className="text-[10px] font-mono text-steel/30">{vault.address}</span>
            {demo && vault.subtitle && (
              <p className="text-[11px] text-steel/50 mt-2 max-w-xl">{vault.subtitle}</p>
            )}
          </div>
          <ArrowRight className={`w-4 h-4 mt-1 transition-colors ${isOwned ? 'text-steel/20 group-hover:text-gold/50' : 'text-steel/15 group-hover:text-steel/40'}`} />
        </div>

        {(demo || vault.loaded) ? (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/40 block mb-0.5">
                NAV ({balanceSource})
              </span>
              <span className="text-lg font-display font-bold text-white">
                ${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div>
              <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/40 block mb-0.5">
                Actions Today
              </span>
              <span className="text-sm font-display font-semibold text-cyan">{vault.dailyActions}</span>
            </div>
            <div>
              <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/40 block mb-0.5">
                {demo ? 'Mandate' : 'Owner'}
              </span>
              <span className="text-[10px] font-mono text-steel/50">
                {demo ? vault.mandate : `${vault.owner?.slice(0, 6)}...${vault.owner?.slice(-4)}`}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-2">
            <div className="w-4 h-4 border-2 border-steel/20 border-t-steel/50 rounded-full animate-spin" />
            <span className="text-xs text-steel/40">Loading vault data...</span>
          </div>
        )}
      </GlassPanel>
    </Link>
  );
}

function DemoSpotlight() {
  const steps = [
    {
      to: '/create',
      title: 'Create a sealed vault',
      body: 'Show the six-step wizard, risk presets, and the privacy toggle in under 30 seconds.',
      icon: Plus,
      accent: 'text-gold/70',
    },
    {
      to: '/app/actions',
      title: 'Open the AI execution trail',
      body: 'Walk judges through decisions, vetoes, and one executed trade with a real transaction hash.',
      icon: Activity,
      accent: 'text-cyan/70',
    },
    {
      to: '/marketplace',
      title: 'Close on trust + governance',
      body: 'Finish with operator selection, staking tiers, and the multi-sig proposals that gate sensitive actions.',
      icon: Vote,
      accent: 'text-emerald-soft/70',
    },
  ];

  return (
    <GlassPanel gold className="p-5 mb-8 overflow-hidden relative">
      <div className="absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_center,rgba(201,168,76,0.12),transparent_70%)] pointer-events-none" />
      <div className="relative z-10">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-gold/20 bg-gold/5 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.14em] text-gold/80">
                <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                Hackathon Demo Mode
              </span>
              <span className="text-[10px] font-mono text-cyan/50">Judge path preloaded</span>
            </div>
            <h2 className="text-xl lg:text-2xl font-display font-semibold text-white tracking-tight mb-2">
              One polished walkthrough, not a blank dashboard
            </h2>
            <p className="text-sm text-steel/55 leading-relaxed">
              The app now opens with a curated product story: featured vaults, live-looking market data,
              operator selection, and governance oversight. Connect a wallet anytime to switch from showcase
              mode into real interaction.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <WalletButton />
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-3">
          {steps.map((step) => (
            <Link key={step.title} to={step.to}>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 h-full transition-all hover:border-gold/20 hover:bg-gold/[0.03]">
                <div className="flex items-center gap-2 mb-2">
                  <step.icon className={`w-4 h-4 ${step.accent}`} />
                  <span className="text-sm font-display font-semibold text-white">{step.title}</span>
                </div>
                <p className="text-[11px] text-steel/50 leading-relaxed">{step.body}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </GlassPanel>
  );
}

function LiveReadinessPanel({
  chainId,
  deployments,
  displayStatus,
  displayTotalVaults,
  isConnected,
}) {
  const factoryHref = getExplorerAddressHref(chainId, deployments.aegisVaultFactory);
  const registryHref = getExplorerAddressHref(chainId, deployments.operatorRegistry);
  const governorHref = getExplorerAddressHref(chainId, deployments.aegisGovernor);
  const readinessCards = [
    {
      label: 'Vault Factory',
      value: isConfiguredAddress(deployments.aegisVaultFactory) ? 'Live on-chain' : 'Missing',
      tone: isConfiguredAddress(deployments.aegisVaultFactory) ? 'text-emerald-soft' : 'text-red-warn',
      detail: isConfiguredAddress(deployments.aegisVaultFactory)
        ? `${displayTotalVaults} vault${displayTotalVaults === 1 ? '' : 's'} discovered`
        : 'No factory address configured',
      href: factoryHref,
      address: deployments.aegisVaultFactory,
    },
    {
      label: 'Operator Registry',
      value: isConfiguredAddress(deployments.operatorRegistry) ? 'Verification live' : 'Missing',
      tone: isConfiguredAddress(deployments.operatorRegistry) ? 'text-cyan' : 'text-red-warn',
      detail: isConfiguredAddress(deployments.operatorRegistry)
        ? 'Browse or register operators on 0G mainnet'
        : 'Registry contract not configured',
      href: registryHref,
      address: deployments.operatorRegistry,
    },
    {
      label: 'Governance',
      value: isConfiguredAddress(deployments.aegisGovernor) ? 'Multi-sig ready' : 'Missing',
      tone: isConfiguredAddress(deployments.aegisGovernor) ? 'text-gold' : 'text-red-warn',
      detail: isConfiguredAddress(deployments.aegisGovernor)
        ? 'Treasury, insurance, and slashing controls'
        : 'Governor contract not configured',
      href: governorHref,
      address: deployments.aegisGovernor,
    },
  ];

  return (
    <GlassPanel className="p-5 mb-8 overflow-hidden relative">
      <div className="absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_center,rgba(76,201,240,0.08),transparent_70%)] pointer-events-none" />
      <div className="relative z-10">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="inline-flex items-center gap-2 rounded-full border border-cyan/20 bg-cyan/5 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.14em] text-cyan/80">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan" />
                Live Mainnet View
              </span>
              <span className="text-[10px] font-mono text-steel/40">{getNetworkLabel(chainId)}</span>
            </div>
            <h2 className="text-xl lg:text-2xl font-display font-semibold text-white tracking-tight mb-2">
              Real contracts first, guided empty states second
            </h2>
            <p className="text-sm text-steel/55 leading-relaxed">
              This screen is reading the live deployment. If telemetry is sparse, the app now explains what is missing
              instead of silently filling the page with mock activity.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!isConnected && <WalletButton />}
            <Link to="/app/actions">
              <ControlButton variant="secondary">
                <Activity className="w-3.5 h-3.5" /> Open Actions
              </ControlButton>
            </Link>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-3">
          {readinessCards.map((card) => (
            <div key={card.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-steel/40 mb-1">{card.label}</div>
              <div className={`text-sm font-display font-semibold ${card.tone} mb-1.5`}>{card.value}</div>
              <p className="text-[11px] text-steel/50 mb-2 leading-relaxed">{card.detail}</p>
              {card.href ? (
                <ExplorerAnchor
                  href={card.href}
                  label={shortHexLabel(card.address)}
                  className="text-[10px] font-mono text-cyan/60 hover:text-cyan transition-colors break-all"
                />
              ) : (
                <span className="text-[10px] font-mono text-white/60 break-all">{card.address || 'Not deployed'}</span>
              )}
            </div>
          ))}
        </div>

        {!displayStatus && (
          <div className="mt-4 rounded-lg border border-amber-warn/15 bg-amber-warn/[0.04] px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <Cpu className="w-4 h-4 text-amber-warn/70" />
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-amber-warn/80">Telemetry Pending</span>
            </div>
            <p className="text-[11px] text-steel/55 leading-relaxed">
              The on-chain layer is live, but the orchestrator has not published a fresh status payload yet.
              Point it at this deployment and expose <code className="text-cyan/50">{ORCHESTRATOR_URL || 'VITE_ORCHESTRATOR_URL'}</code> to light up AI signals, prices, and journal history.
            </p>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

export default function DashboardPage() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);

  const { vaults: myVaults, isLoading: myLoading, count: myCount } = useVaultList(
    deployments.aegisVaultFactory,
    address
  );
  const { vaults: allVaults, isLoading: allLoading, total: totalVaults } = useAllPlatformVaults(
    deployments.aegisVaultFactory
  );
  const { data: orchStatus } = useOrchestratorStatus();
  const { data: protocolAlerts } = useAlerts(6);
  const { operators: marketplaceOps } = useOperatorList(deployments.operatorRegistry);
  const activeMarketplaceOps = marketplaceOps.filter((op) => op.loaded && op.active);
  const marketplaceAddrs = activeMarketplaceOps.map((op) => op.wallet);
  const { tiersByAddress } = useOperatorTiers(deployments.operatorStaking, marketplaceAddrs);
  const { data: kvState } = useKVState();
  const { data: pythPrices } = usePythPrices();

  const myAddrsLower = new Set(myVaults.map((vault) => vault.address?.toLowerCase()));
  const otherVaults = allVaults.filter((vault) => !myAddrsLower.has(vault.address?.toLowerCase()));

  const allVaultAddrs = allVaults.map((vault) => vault.address).filter(Boolean);
  const { tvl: platformTVL, source: tvlSource } = usePlatformTVL(allVaultAddrs);
  const runningCount = allVaults.filter((vault) => vault.loaded && !vault.paused).length;

  const showDemoExperience = ENABLE_DEMO_FALLBACKS && (!isConnected || (!allLoading && totalVaults === 0));
  const displayMyVaults = showDemoExperience ? demoVaults.slice(0, 2) : myVaults;
  const displayOtherVaults = showDemoExperience ? demoVaults.slice(2) : otherVaults;
  const displayMyCount = showDemoExperience ? demoPlatformSnapshot.myVaults : myCount;
  const displayTotalVaults = showDemoExperience ? demoPlatformSnapshot.totalVaults : totalVaults;
  const displayRunningCount = showDemoExperience ? demoPlatformSnapshot.runningVaults : runningCount;
  const displayPlatformTVL = showDemoExperience ? demoPlatformSnapshot.platformTVL : platformTVL;
  const displayTVLSource = showDemoExperience ? 'Demo scenario' : tvlSource || 'Loading...';
  const displaySignal = kvState?.lastSignal || (showDemoExperience ? demoSignal : null);
  const displayStatus = orchStatus || (showDemoExperience ? demoStatus : null);
  const displayPrices = pythPrices || (showDemoExperience ? demoPythPrices : null);
  const risk = computeRisk(displaySignal, demoPlatformSnapshot.aggregateRisk);
  const primaryVaultAddress =
    displayMyVaults[0]?.address ||
    displayOtherVaults[0]?.address ||
    getDefaultVaultAddress(chainId);
  const hasVaultFactory = isConfiguredAddress(deployments.aegisVaultFactory);
  const allContractsDeployed =
    hasVaultFactory &&
    isConfiguredAddress(deployments.operatorRegistry) &&
    isConfiguredAddress(deployments.aegisGovernor);
  const factoryExplorerHref = getExplorerAddressHref(chainId, deployments.aegisVaultFactory);
  const signalTxHref = getExplorerTxHref(chainId, displaySignal?.txHash);
  const platformVaultMetricSubValue = showDemoExperience
    ? `${displayRunningCount} running · ${displayMyCount} featured`
    : isConnected
      ? `${displayRunningCount} running · ${displayMyCount} owned`
      : `${displayRunningCount} running · connect wallet for ownership`;

  return (
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-baseline gap-3.5 mb-2">
            <span className="ed-eyebrow">§ A.01</span>
            <span className="ed-mono text-[10.5px] tracking-[0.22em] uppercase" style={{ color: 'var(--ed-steel-400)' }}>
              {showDemoExperience ? 'Demo overview' : 'Platform overview'} · 2026
            </span>
          </div>
          <h1
            className="ed-display"
            style={{ fontSize: 44, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, margin: 0 }}
          >
            Every vault <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>on record,</span> in one ledger.
          </h1>
          <div className="flex items-center gap-3 flex-wrap mt-3.5">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-dim/30 border border-emerald-soft/20">
              <Radio className="w-3 h-3 text-emerald-soft animate-pulse" />
              <span className="text-[10px] font-mono tracking-[0.1em] uppercase text-emerald-soft/80">
                {showDemoExperience ? 'Demo-ready' : 'Live'} — {getNetworkLabel(chainId)}
              </span>
            </div>
            {isConnected ? (
              <span className="text-[10px] font-mono text-steel/40">{address?.slice(0, 8)}...{address?.slice(-6)}</span>
            ) : (
              <span className="text-[10px] font-mono text-cyan/60">
                Connect wallet to resolve vault ownership. Live protocol state stays visible without it.
              </span>
            )}
          </div>
        </div>
        <Link to="/create">
          <ControlButton variant="gold">
            <Plus className="w-3.5 h-3.5" /> Create Vault
          </ControlButton>
        </Link>
      </div>

      {showDemoExperience && <DemoSpotlight />}
      {!showDemoExperience && !allContractsDeployed && (
        <LiveReadinessPanel
          chainId={chainId}
          deployments={deployments}
          displayStatus={displayStatus}
          displayTotalVaults={displayTotalVaults}
          isConnected={isConnected}
        />
      )}

      <HeadlineMetrics
        tvl={displayPlatformTVL}
        tvlSource={displayTVLSource}
        totalVaults={displayTotalVaults}
        vaultSubValue={platformVaultMetricSubValue}
        cycleCount={displayStatus?.cycleCount || 0}
        riskScore={risk.score}
        riskLevel={risk.level}
      />

      <ProtocolPulse alerts={protocolAlerts} />

      <ProtocolHealthPanel displayStatus={displayStatus} />

      <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2 space-y-6">
          <SectionLabel color="text-gold/60">
            {showDemoExperience ? 'Featured Vaults' : 'Your Vaults'}
            <span className="ml-2 text-[10px] font-mono text-steel/30">({displayMyCount})</span>
          </SectionLabel>

          {myLoading && !showDemoExperience ? (
            <GlassPanel className="p-6 text-center">
              <div className="w-5 h-5 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-steel/40">Loading your vaults...</p>
            </GlassPanel>
          ) : displayMyVaults.length > 0 ? (
            <div className="space-y-3">
              {displayMyVaults.map((vault) => (
                <VaultCard key={vault.address} vault={vault} isOwned={true} demo={showDemoExperience} />
              ))}
            </div>
          ) : (
            <GlassPanel className="p-6 border-dashed">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="max-w-2xl">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-5 h-5 text-steel/30" />
                    <span className="text-sm font-display font-semibold text-white">
                      {isConnected ? 'This wallet does not own a vault yet' : 'Owned vaults are hidden until a wallet is connected'}
                    </span>
                  </div>
                  <p className="text-[11px] text-steel/50 leading-relaxed">
                    {isConnected
                      ? 'Your contracts are live on mainnet, but this wallet has not created or joined a vault yet. Create one now to seed on-chain activity and unlock richer telemetry.'
                      : 'Platform contracts are still visible in live mode, but ownership resolution requires a connected wallet. Connect first to see which vaults belong to you.'}
                  </p>
                  {hasVaultFactory && (
                    <div className="mt-2 text-[10px] font-mono text-steel/35">
                      Factory:{' '}
                      {factoryExplorerHref ? (
                        <a href={factoryExplorerHref} target="_blank" rel="noreferrer" className="text-cyan/60 hover:text-cyan transition-colors">
                          {deployments.aegisVaultFactory.slice(0, 8)}...{deployments.aegisVaultFactory.slice(-6)}
                        </a>
                      ) : (
                        deployments.aegisVaultFactory
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {!isConnected && <WalletButton />}
                  <Link to="/create">
                    <ControlButton variant="gold" size="sm">
                      <Plus className="w-3 h-3" /> Create Vault
                    </ControlButton>
                  </Link>
                </div>
              </div>
            </GlassPanel>
          )}

          <div className="mt-8">
            <SectionLabel color="text-steel/50">
              {showDemoExperience ? 'Platform Activity' : 'All Platform Vaults'}
              <span className="ml-2 text-[10px] font-mono text-steel/30">({displayOtherVaults.length})</span>
            </SectionLabel>

            {allLoading && !showDemoExperience ? (
              <GlassPanel className="p-6 text-center">
                <div className="w-5 h-5 border-2 border-steel/20 border-t-steel/50 rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs text-steel/40">Loading platform vaults...</p>
              </GlassPanel>
            ) : displayOtherVaults.length > 0 ? (
              <div className="space-y-3">
                {displayOtherVaults.map((vault) => (
                  <VaultCard key={vault.address} vault={vault} isOwned={false} demo={showDemoExperience} />
                ))}
              </div>
            ) : displayTotalVaults === 0 ? (
              <GlassPanel className="p-5 border-dashed">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="w-5 h-5 text-steel/30" />
                      <span className="text-sm font-display font-semibold text-white">No live vault clones found yet</span>
                    </div>
                    <p className="text-[11px] text-steel/50 leading-relaxed max-w-2xl">
                      The factory is {hasVaultFactory ? 'deployed and readable on-chain' : 'not configured on this network'}, but no vaults have been indexed from it yet.
                      Creating the first vault here is the cleanest way to make the live demo feel active without synthetic data.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {factoryExplorerHref && (
                      <a href={factoryExplorerHref} target="_blank" rel="noreferrer">
                        <ControlButton variant="secondary" size="sm">
                          <ExternalLink className="w-3 h-3" /> View Factory
                        </ControlButton>
                      </a>
                    )}
                  </div>
                </div>
              </GlassPanel>
            ) : (
              <GlassPanel className="p-5 text-center border-dashed">
                <p className="text-sm text-steel/40">No additional public vaults are visible beyond your own set.</p>
                <p className="text-[10px] text-steel/30 mt-1">That usually means this wallet currently accounts for the whole live footprint.</p>
              </GlassPanel>
            )}
          </div>

          <div className="mt-6">
            <SectionLabel color="text-cyan/50">Latest AI Signal</SectionLabel>
            <GlassPanel className="p-5">
              {displaySignal ? (
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-cyan/10 flex items-center justify-center flex-shrink-0">
                    <Zap className="w-5 h-5 text-cyan/60" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-display font-semibold text-white">
                        {displaySignal.action.toUpperCase()} {displaySignal.asset}
                      </span>
                      <StatusPill
                        label={displaySignal.action}
                        variant={displaySignal.action === 'hold' ? 'info' : 'executed'}
                      />
                      {displaySignal.approval_tier && displaySignal.approval_tier !== 'not_required' && (
                        <StatusPill
                          label={displaySignal.approval_tier.replace(/_/g, ' ')}
                          variant={displaySignal.approval_tier === 'auto_execute' ? 'active' : 'warning'}
                        />
                      )}
                      <span className="text-[10px] font-mono text-cyan/40">
                        Conf: {(displaySignal.confidence * 100).toFixed(0)}%
                      </span>
                      {showDemoExperience && !kvState?.lastSignal && (
                        <span className="text-[8px] font-mono text-gold/70 px-1.5 py-0.5 rounded bg-gold/5 border border-gold/10">
                          DEMO
                        </span>
                      )}
                    </div>

                    {displaySignal.regime && (
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${
                          displaySignal.regime?.includes('UP') ? 'text-emerald-soft/70 bg-emerald-soft/5 border-emerald-soft/10' :
                          displaySignal.regime?.includes('DOWN') || displaySignal.regime?.includes('PANIC') ? 'text-red-warn/60 bg-red-warn/5 border-red-warn/10' :
                          'text-steel/40 bg-white/[0.02] border-white/[0.05]'
                        }`}>
                          {displaySignal.regime?.replace(/_/g, ' ')}
                        </span>
                        {displaySignal.final_edge_score !== undefined && (
                          <span className="text-[9px] font-mono text-steel/35">Edge: {displaySignal.final_edge_score}</span>
                        )}
                        {displaySignal.trade_quality_score !== undefined && (
                          <span className="text-[9px] font-mono text-steel/35">Q: {displaySignal.trade_quality_score}</span>
                        )}
                        {displaySignal.hard_veto && (
                          <span className="text-[8px] font-mono text-red-warn/50 px-1 py-0.5 rounded bg-red-warn/5 border border-red-warn/10">
                            VETO
                          </span>
                        )}
                      </div>
                    )}

                    <p className="text-[11px] text-steel/50 leading-relaxed">{displaySignal.reason}</p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className={`text-[9px] font-mono ${
                        displaySignal.source?.includes('0g-compute') ? 'text-cyan/40' : 'text-steel/30'
                      }`}>
                        Source: {displaySignal.source || 'orchestrator'}
                      </span>
                      {signalTxHref && (
                        <ExplorerAnchor
                          href={signalTxHref}
                          label={`Tx ${shortHexLabel(displaySignal.txHash, 10, 6)}`}
                          className="text-[9px] font-mono text-cyan/60 hover:text-cyan transition-colors"
                        />
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-4 h-4 text-steel/35" />
                    <span className="text-sm font-display font-semibold text-white">No live AI signal recorded yet</span>
                  </div>
                  <p className="text-[11px] text-steel/50 leading-relaxed mb-3">
                    This is expected when the orchestrator has not run a cycle against your mainnet deployment,
                    or when no vault executor is linked to the active orchestrator wallet.
                  </p>
                  <div className="grid sm:grid-cols-3 gap-2 text-[10px] font-mono text-steel/40">
                    <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2">1. Set executor on a vault</div>
                    <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2">2. Start orchestrator</div>
                    <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2">3. Trigger first cycle</div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <Link to="/app/actions">
                      <ControlButton variant="secondary" size="sm">
                        <Activity className="w-3 h-3" /> Open Actions
                      </ControlButton>
                    </Link>
                    {primaryVaultAddress && (
                      <Link to={getVaultRoute(primaryVaultAddress)}>
                        <ControlButton variant="gold" size="sm">
                          <Shield className="w-3 h-3" /> Open Vault
                        </ControlButton>
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </GlassPanel>
          </div>

          {showDemoExperience && (
            <div className="grid xl:grid-cols-2 gap-6 mt-2">
              <PerformancePanel />
              <AllocationPanel />
              <div className="xl:col-span-2">
                <RiskEventsPanel />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="flex justify-center py-2">
            <DashboardShield size={200} riskScore={risk.score} riskLevel={risk.level} />
          </div>

          <div>
            <SectionLabel color="text-cyan/50">Market Prices</SectionLabel>
            <GlassPanel className="p-5">
              {displayPrices ? (
                <div className="space-y-3">
                  {Object.entries(displayPrices).map(([symbol, data]) => (
                    <div key={symbol} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TokenIcon symbol={symbol} size={16} />
                        <span className="text-xs font-display font-medium text-white">{symbol}/USD</span>
                      </div>
                      <span className="text-xs font-mono text-white/80">
                        ${data.price?.toLocaleString(undefined, { maximumFractionDigits: symbol === 'USDC' ? 4 : 2 })}
                      </span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-white/[0.04]">
                    <span className="text-[8px] font-mono text-steel/25 flex items-center gap-1">
                      <Globe className="w-2.5 h-2.5" /> {pythPrices ? 'Pyth Hermes · real-time' : 'Demo snapshot · judge-friendly'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-5 text-center">
                  <Globe className="w-5 h-5 text-steel/25 mx-auto mb-2" />
                  <p className="text-sm text-steel/40">No live market snapshot yet.</p>
                  <p className="text-[10px] text-steel/30 mt-1">
                    Pyth/Hermes prices appear here after the orchestrator fetches and publishes a fresh snapshot.
                  </p>
                </div>
              )}
            </GlassPanel>
          </div>

          {showDemoExperience && (
            <div>
              <SectionLabel color="text-gold/50">Why This Wins</SectionLabel>
              <GlassPanel className="p-5">
                <div className="space-y-3 text-[11px] text-steel/55">
                  <div className="flex gap-2">
                    <Shield className="w-4 h-4 text-emerald-soft/60 flex-shrink-0 mt-0.5" />
                    <p>AI proposes, smart contracts enforce. Every action is boxed inside policy limits.</p>
                  </div>
                  <div className="flex gap-2">
                    <Cpu className="w-4 h-4 text-cyan/60 flex-shrink-0 mt-0.5" />
                    <p>Sealed mode turns the trust model into a story judges can instantly grasp: private reasoning, public proof.</p>
                  </div>
                  <div className="flex gap-2">
                    <Vote className="w-4 h-4 text-gold/60 flex-shrink-0 mt-0.5" />
                    <p>Operator marketplace plus governance makes the product feel like a system, not a single smart contract demo.</p>
                  </div>
                </div>
              </GlassPanel>
            </div>
          )}

        </div>
      </div>

      <OperatorStrip operators={activeMarketplaceOps} tiersByAddress={tiersByAddress} />
    </div>
  );
}

// Editorial operator leaderboard — top 5 ranked by stake × reputation proxy.
// Takes the live operator list + tier/stake data the dashboard already has
// in scope. Hidden when the registry is empty so we don't show a bare shell.
function OperatorStrip({ operators = [], tiersByAddress = {} }) {
  if (!operators || operators.length === 0) return null;

  const ranked = operators
    .map((op) => {
      const tierData = tiersByAddress[op.wallet?.toLowerCase()] || {};
      const stake = Number(tierData.stakedAmount || 0);
      const tier = Number(tierData.tier || 0);
      // Use declared performance fee as a reputation proxy when no on-chain
      // reputation index is queried here. Lower fees rank higher.
      const feeInv = 10000 - (Number(op.performanceFeeBps) || 0);
      const score = stake * (1 + tier) + feeInv;
      return { op, tier, stake, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const tones = [
    'var(--ed-gold)',
    'var(--ed-cyan)',
    'var(--ed-emerald)',
    'var(--ed-steel-300)',
    'var(--ed-amber)',
  ];

  const cols = ranked.length;

  return (
    <div className="ed-card overflow-hidden mt-8">
      <div className="flex items-end justify-between px-6 pt-5 pb-4">
        <div>
          <div className="flex items-baseline gap-3.5 mb-2">
            <span className="ed-eyebrow">§ A.08</span>
            <span
              className="ed-mono text-[10.5px] tracking-[0.22em] uppercase"
              style={{ color: 'var(--ed-steel-400)' }}
            >
              Operator leaderboard
            </span>
          </div>
          <h3
            className="ed-display"
            style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}
          >
            Ranked by{' '}
            <span className="ed-italic" style={{ color: 'var(--ed-gold)', fontWeight: 400 }}>
              stake × reputation
            </span>
          </h3>
        </div>
        <Link to="/marketplace">
          <ControlButton variant="secondary" size="sm">
            View marketplace <ArrowRight className="w-3.5 h-3.5" />
          </ControlButton>
        </Link>
      </div>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {ranked.map(({ op, tier, stake }, i) => {
          const tone = tones[i] || 'var(--ed-steel-300)';
          const tierLabel = tier === 3 ? 'S' : tier === 2 ? 'A' : tier === 1 ? 'B' : '—';
          const stakeLabel = stake > 0 ? `${(stake / 1000).toFixed(1)}K A0G` : '— A0G';
          return (
            <Link
              key={op.wallet}
              to={`/operator/${op.wallet}`}
              style={{
                padding: '22px 24px',
                borderRight: i < cols - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                background: i === 0 ? 'rgba(201,168,76,0.02)' : 'transparent',
                display: 'block',
                transition: 'background 200ms var(--ed-ease-snappy)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  i === 0 ? 'rgba(201,168,76,0.02)' : 'transparent';
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className="ed-mono text-[10px]"
                  style={{ color: 'var(--ed-steel-500)', letterSpacing: '0.18em' }}
                >
                  #{i + 1}
                </span>
                {i === 0 ? (
                  <span className="ed-chip ed-chip-gold">top</span>
                ) : (
                  <span className="ed-chip ed-chip-steel">tier {tierLabel}</span>
                )}
              </div>
              <div className="flex items-center gap-2.5 mb-3">
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'var(--ed-surface-2)',
                    boxShadow: 'var(--ed-ghost-border)',
                    color: tone,
                  }}
                >
                  <Cpu className="w-3.5 h-3.5" />
                </div>
                <span
                  className="ed-display truncate"
                  style={{ fontSize: 14, fontWeight: 600, color: 'var(--ed-steel-50)' }}
                >
                  {op.name}
                </span>
              </div>
              <MonoKV k="Staked" v={stakeLabel} color="var(--ed-steel-100)" />
              <MonoKV k="Mandate" v={op.mandateLabel || '—'} color="var(--ed-cyan)" />
              <MonoKV
                k="Perf fee"
                v={`${((op.performanceFeeBps || 0) / 100).toFixed(1)}%`}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
