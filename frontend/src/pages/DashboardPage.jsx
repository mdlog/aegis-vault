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
  getSettingsRoute,
  getVaultRoute,
} from '../lib/contracts';
import { useVaultList, useAllPlatformVaults } from '../hooks/useVault';
import {
  useOrchestratorStatus,
  useKVState,
  useMultiAssetNAV,
  usePythPrices,
  usePlatformTVL,
} from '../hooks/useOrchestrator';
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
import {
  Shield, Activity, Eye, Radio, Lock, Zap, Plus,
  ArrowRight, BarChart3, Target, Wallet, Globe, User, Cpu, Vote, ExternalLink,
} from 'lucide-react';

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
            <Link to="/create">
              <ControlButton variant="gold">
                <Plus className="w-3.5 h-3.5" /> Start Demo Flow
              </ControlButton>
            </Link>
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
            <Link to="/create">
              <ControlButton variant="gold">
                <Plus className="w-3.5 h-3.5" /> Create Vault
              </ControlButton>
            </Link>
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
  const factoryExplorerHref = getExplorerAddressHref(chainId, deployments.aegisVaultFactory);
  const signalTxHref = getExplorerTxHref(chainId, displaySignal?.txHash);
  const platformVaultMetricSubValue = showDemoExperience
    ? `${displayRunningCount} running · ${displayMyCount} featured`
    : isConnected
      ? `${displayRunningCount} running · ${displayMyCount} owned`
      : `${displayRunningCount} running · connect wallet for ownership`;
  const quickAccessItems = [
    {
      to: primaryVaultAddress ? getVaultRoute(primaryVaultAddress) : '/create',
      label: primaryVaultAddress ? 'Vault Detail' : 'Create Vault',
      desc: primaryVaultAddress ? 'Charts & analysis' : 'No vault selected yet',
      icon: BarChart3,
      color: 'text-cyan/50',
    },
    {
      to: '/app/actions',
      label: 'AI Actions',
      desc: 'Intelligence feed',
      icon: Activity,
      color: 'text-emerald-soft/50',
    },
    {
      to: '/marketplace',
      label: 'Marketplace',
      desc: showDemoExperience ? 'Featured operators' : 'Operator discovery',
      icon: Cpu,
      color: 'text-gold/50',
    },
    {
      to: primaryVaultAddress ? getSettingsRoute(primaryVaultAddress) : '/create',
      label: primaryVaultAddress ? 'Settings' : 'Setup',
      desc: primaryVaultAddress ? 'System config' : 'Create your first vault',
      icon: Eye,
      color: 'text-steel/50',
    },
  ];

  return (
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-semibold text-white tracking-tight mb-1">
            {showDemoExperience ? 'Demo Command Center' : 'Platform Overview'}
          </h1>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-dim/30 border border-emerald-soft/20">
              <Radio className="w-3 h-3 text-emerald-soft animate-pulse" />
              <span className="text-[10px] font-mono tracking-[0.1em] uppercase text-emerald-soft/80">
                {showDemoExperience ? 'Demo-ready' : 'Live'} — {getNetworkLabel(chainId)}
              </span>
            </div>
            {isConnected ? (
              <span className="text-[10px] font-mono text-steel/30">{address?.slice(0, 8)}...{address?.slice(-6)}</span>
            ) : (
              <span className="text-[10px] font-mono text-cyan/50">
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
      {!showDemoExperience && (
        <LiveReadinessPanel
          chainId={chainId}
          deployments={deployments}
          displayStatus={displayStatus}
          displayTotalVaults={displayTotalVaults}
          isConnected={isConnected}
        />
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <MetricCard
          label="Platform TVL"
          value={`$${displayPlatformTVL.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          subValue={displayTVLSource}
          accent="text-white"
          icon={<Wallet className="w-4 h-4" />}
          className="col-span-2 lg:col-span-1"
        />
        <MetricCard
          label="Total Vaults"
          value={displayTotalVaults}
          subValue={platformVaultMetricSubValue}
          accent="text-cyan"
          icon={<Shield className="w-4 h-4" />}
        />
        <MetricCard
          label="Aggregate Risk"
          value={risk.score}
          subValue={risk.level}
          accent={risk.score < 30 ? 'text-emerald-soft' : risk.score < 60 ? 'text-amber-warn' : 'text-red-warn'}
          icon={<Target className="w-4 h-4" />}
        />
        <MetricCard
          label="Total Executions"
          value={displayStatus?.totalExecutions || 0}
          subValue={`${displayStatus?.totalBlocked || 0} blocked`}
          accent="text-cyan"
          icon={<Activity className="w-4 h-4" />}
        />
        <MetricCard
          label="AI Cycles"
          value={displayStatus?.cycleCount || 0}
          subValue={`${displayStatus?.pendingApprovalCount || 0} approvals pending`}
          accent="text-steel"
          icon={<Zap className="w-4 h-4" />}
        />
      </div>

      <ProtocolHealthPanel />

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
                    <Link to="/create">
                      <ControlButton variant="gold" size="sm">
                        <Plus className="w-3 h-3" /> Create First Vault
                      </ControlButton>
                    </Link>
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
                    <Link to={primaryVaultAddress ? getVaultRoute(primaryVaultAddress) : '/create'}>
                      <ControlButton variant="gold" size="sm">
                        <Shield className="w-3 h-3" /> {primaryVaultAddress ? 'Open Vault' : 'Create Vault'}
                      </ControlButton>
                    </Link>
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

          <div>
            <SectionLabel color="text-steel/50">Orchestrator</SectionLabel>
            <GlassPanel className="p-5">
              {displayStatus ? (
                <div className="space-y-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-steel/50">Status</span>
                    <StatusPill
                      label={displayStatus.running ? 'Running' : 'Idle'}
                      variant={displayStatus.running ? 'active' : 'paused'}
                    />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-steel/50">Cycles</span>
                    <span className="font-mono text-white/60">{displayStatus.cycleCount || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-steel/50">Executions</span>
                    <span className="font-mono text-emerald-soft/70">{displayStatus.totalExecutions || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-steel/50">Blocked</span>
                    <span className="font-mono text-amber-warn/70">{displayStatus.totalBlocked || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-steel/50">Skipped (hold)</span>
                    <span className="font-mono text-steel/50">{displayStatus.totalSkipped || 0}</span>
                  </div>
                  {showDemoExperience && !orchStatus && (
                    <div className="rounded-md border border-gold/15 bg-gold/5 px-2.5 py-2 text-[10px] text-gold/70">
                      Demo status is preloaded so the product still feels alive before the backend is online.
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Cpu className="w-4 h-4 text-steel/35" />
                    <span className="text-sm font-display font-semibold text-white">Orchestrator offline</span>
                  </div>
                  <p className="text-[11px] text-steel/50 leading-relaxed mb-3">
                    The contracts are live, but backend telemetry is not currently connected. Once the orchestrator is online,
                    this card will expose cycle counts, signal health, and execution stats automatically.
                  </p>
                  <div className="grid gap-2 text-[10px] font-mono text-steel/40">
                    <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2">Endpoint: {ORCHESTRATOR_URL || 'VITE_ORCHESTRATOR_URL not set'}</div>
                    <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2">Expected: vault executor matches orchestrator wallet</div>
                  </div>
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

          <div>
            <SectionLabel color="text-steel/40">Quick Access</SectionLabel>
            <div className="space-y-1.5">
              {quickAccessItems.map((item) => (
                <Link key={item.label} to={item.to}>
                  <GlassPanel className="px-4 py-2.5 flex items-center gap-3 group" hover>
                    <item.icon className={`w-3.5 h-3.5 ${item.color}`} />
                    <div className="flex-1">
                      <span className="text-xs text-white/70 font-medium">{item.label}</span>
                      <span className="text-[10px] text-steel/30 ml-2">{item.desc}</span>
                    </div>
                    <ArrowRight className="w-3 h-3 text-steel/15 group-hover:text-steel/40 transition-colors" />
                  </GlassPanel>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
