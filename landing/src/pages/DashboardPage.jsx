import { useAccount, useChainId } from 'wagmi';
import { getDeployments } from '../lib/contracts';
import { useVaultList, useAllPlatformVaults } from '../hooks/useVault';
import { useOrchestratorStatus, useKVState, useMultiAssetNAV, usePythPrices, usePlatformTVL } from '../hooks/useOrchestrator';
import MetricCard from '../components/ui/MetricCard';
import StatusPill from '../components/ui/StatusPill';
import GlassPanel from '../components/ui/GlassPanel';
import SectionLabel from '../components/ui/SectionLabel';
import WalletButton from '../components/ui/WalletButton';
import ControlButton from '../components/ui/ControlButton';
import DashboardShield from '../components/dashboard/DashboardShield';
import { Link } from 'react-router-dom';
import TokenIcon from '../components/ui/TokenIcon';
import {
  Shield, Activity, Eye, Radio, Lock, Zap, Plus,
  ArrowRight, BarChart3, Target, Wallet, Globe, TrendingUp, User
} from 'lucide-react';

// ── Vault Card Component ──
function VaultCard({ vault, isOwned }) {
  const shortAddr = `${vault.address?.slice(0, 6)}...${vault.address?.slice(-4)}`;
  const rawBalance = vault.loaded ? parseFloat(vault.balance) : 0;
  // Fetch NAV specific to this vault
  const { data: vaultNav } = useMultiAssetNAV(vault.address);
  const balance = vaultNav?.totalNav || rawBalance;
  const balanceSource = vaultNav ? 'Pyth' : 'USDC';
  const isPaused = vault.loaded ? vault.paused : false;

  return (
    <Link to="/app/vault">
      <GlassPanel
        gold={isOwned}
        className={`p-5 group transition-all ${isOwned ? 'hover:border-gold/30' : 'hover:border-white/[0.1]'}`}
        hover
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-display font-semibold text-white">{shortAddr}</h3>
              <StatusPill label={isPaused ? 'Paused' : 'Active'} variant={isPaused ? 'paused' : 'active'} pulse={!isPaused} />
              {isOwned && (
                <span className="text-[8px] font-mono text-gold/60 px-1.5 py-0.5 rounded bg-gold/5 border border-gold/10">YOURS</span>
              )}
            </div>
            <span className="text-[10px] font-mono text-steel/30">{vault.address}</span>
          </div>
          <ArrowRight className={`w-4 h-4 mt-1 transition-colors ${isOwned ? 'text-steel/20 group-hover:text-gold/50' : 'text-steel/15 group-hover:text-steel/40'}`} />
        </div>

        {vault.loaded ? (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/40 block mb-0.5">NAV ({balanceSource})</span>
              <span className="text-lg font-display font-bold text-white">
                ${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div>
              <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/40 block mb-0.5">Actions Today</span>
              <span className="text-sm font-display font-semibold text-cyan">{vault.dailyActions}</span>
            </div>
            <div>
              <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/40 block mb-0.5">Owner</span>
              <span className="text-[10px] font-mono text-steel/50">{vault.owner?.slice(0, 6)}...{vault.owner?.slice(-4)}</span>
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

export default function DashboardPage() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);

  // On-chain: owner's vaults + all platform vaults
  const { vaults: myVaults, isLoading: myLoading, count: myCount } = useVaultList(deployments.aegisVaultFactory, address);
  const { vaults: allVaults, isLoading: allLoading, total: totalVaults } = useAllPlatformVaults(deployments.aegisVaultFactory);

  // Orchestrator + Pyth
  const { data: orchStatus } = useOrchestratorStatus();
  const { data: kvState } = useKVState();
  const { data: pythPrices } = usePythPrices();

  // Separate: other people's vaults (not owned by connected wallet)
  const myAddrsLower = new Set(myVaults.map(v => v.address?.toLowerCase()));
  const otherVaults = allVaults.filter(v => !myAddrsLower.has(v.address?.toLowerCase()));

  // Platform TVL — sum Pyth NAV of all vaults
  const allVaultAddrs = allVaults.map(v => v.address).filter(Boolean);
  const { tvl: platformTVL, source: tvlSource } = usePlatformTVL(allVaultAddrs);
  const runningCount = allVaults.filter(v => v.loaded && !v.paused).length;

  // Risk score (from last AI signal confidence)
  const risk = { score: 0, level: 'Unknown' };
  {
    let s = 5; // base
    const c = kvState?.lastSignal?.confidence;
    if (c !== undefined) s += c < 0.4 ? 20 : c < 0.6 ? 12 : c < 0.8 ? 5 : 0;
    risk.score = Math.min(100, Math.max(0, s));
    risk.level = risk.score < 30 ? 'Low' : risk.score < 60 ? 'Moderate' : risk.score < 80 ? 'Elevated' : 'Critical';
  }

  // ── Not connected ──
  if (!isConnected) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="flex justify-center mb-6"><DashboardShield size={200} /></div>
            <h1 className="text-2xl font-display font-semibold text-white tracking-tight mb-3">Welcome to Aegis Vault</h1>
            <p className="text-sm text-steel/60 leading-relaxed mb-6">
              Connect your wallet to view your vaults, monitor AI agents,
              and manage your autonomous trading portfolio.
            </p>
            <div className="flex justify-center mb-4"><WalletButton /></div>
            <div className="flex items-center justify-center gap-4 mt-6">
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-steel/40"><Shield className="w-3 h-3" /><span>On-chain verified</span></div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-steel/40"><Lock className="w-3 h-3" /><span>Read-only until you sign</span></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Platform Overview ──
  return (
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-semibold text-white tracking-tight mb-1">Platform Overview</h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-dim/30 border border-emerald-soft/20">
              <Radio className="w-3 h-3 text-emerald-soft animate-pulse" />
              <span className="text-[10px] font-mono tracking-[0.1em] uppercase text-emerald-soft/80">
                Live — {chainId === 16602 ? '0G Galileo' : 'Local'}
              </span>
            </div>
            <span className="text-[10px] font-mono text-steel/30">{address?.slice(0, 8)}...{address?.slice(-6)}</span>
          </div>
        </div>
        <Link to="/create">
          <ControlButton variant="gold">
            <Plus className="w-3.5 h-3.5" /> Create Vault
          </ControlButton>
        </Link>
      </div>

      {/* ── Aggregated Stats Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <MetricCard
          label="Platform TVL"
          value={`$${platformTVL.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          subValue={tvlSource || 'Loading...'}
          accent="text-white"
          icon={<Wallet className="w-4 h-4" />}
          className="col-span-2 lg:col-span-1"
        />
        <MetricCard
          label="Total Vaults"
          value={totalVaults}
          subValue={`${runningCount} running · ${myCount} yours`}
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
          value={orchStatus?.totalExecutions || 0}
          subValue={`${orchStatus?.totalBlocked || 0} blocked`}
          accent="text-cyan"
          icon={<Activity className="w-4 h-4" />}
        />
        <MetricCard
          label="AI Cycles"
          value={orchStatus?.cycleCount || 0}
          subValue={`${orchStatus?.totalSkipped || 0} skipped`}
          accent="text-steel"
          icon={<Zap className="w-4 h-4" />}
        />
      </div>

      {/* ── Main grid: Vaults list + Market + AI status ── */}
      <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">

        {/* Left 2/3: Vault cards */}
        <div className="lg:col-span-2 space-y-6">

          {/* ── Your Vaults ── */}
          <SectionLabel color="text-gold/60">
            Your Vaults
            <span className="ml-2 text-[10px] font-mono text-steel/30">({myCount})</span>
          </SectionLabel>

          {myLoading ? (
            <GlassPanel className="p-6 text-center">
              <div className="w-5 h-5 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-steel/40">Loading your vaults...</p>
            </GlassPanel>
          ) : myVaults.length > 0 ? (
            <div className="space-y-3">
              {myVaults.map(v => (
                <VaultCard key={v.address} vault={v} isOwned={true} />
              ))}
            </div>
          ) : (
            <GlassPanel className="p-6 text-center border-dashed">
              <User className="w-6 h-6 text-steel/20 mx-auto mb-2" />
              <p className="text-sm text-steel/40">You don't have any vaults yet</p>
              <p className="text-[10px] text-steel/30 mt-1">Create your first vault to start AI-managed trading</p>
              <Link to="/create" className="inline-block mt-3">
                <ControlButton variant="gold" size="sm">
                  <Plus className="w-3 h-3" /> Create Vault
                </ControlButton>
              </Link>
            </GlassPanel>
          )}

          {/* ── All Platform Vaults ── */}
          <div className="mt-8">
            <SectionLabel color="text-steel/50">
              All Platform Vaults
              <span className="ml-2 text-[10px] font-mono text-steel/30">({totalVaults})</span>
            </SectionLabel>

            {allLoading ? (
              <GlassPanel className="p-6 text-center">
                <div className="w-5 h-5 border-2 border-steel/20 border-t-steel/50 rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs text-steel/40">Loading platform vaults...</p>
              </GlassPanel>
            ) : otherVaults.length > 0 ? (
              <div className="space-y-3">
                {otherVaults.map(v => (
                  <VaultCard key={v.address} vault={v} isOwned={false} />
                ))}
              </div>
            ) : myVaults.length > 0 && totalVaults <= myCount ? (
              <GlassPanel className="p-5 text-center">
                <p className="text-xs text-steel/40">All vaults on this platform belong to you</p>
              </GlassPanel>
            ) : totalVaults === 0 ? (
              <GlassPanel className="p-5 text-center">
                <p className="text-xs text-steel/40">No vaults created on the platform yet</p>
              </GlassPanel>
            ) : null}
          </div>

          {/* Latest AI Signal */}
          <div className="mt-6">
            <SectionLabel color="text-cyan/50">Latest AI Signal</SectionLabel>
            <GlassPanel className="p-5">
              {kvState?.lastSignal ? (
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-cyan/10 flex items-center justify-center flex-shrink-0">
                    <Zap className="w-5 h-5 text-cyan/60" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-display font-semibold text-white">
                        {kvState.lastSignal.action.toUpperCase()} {kvState.lastSignal.asset}
                      </span>
                      <StatusPill label={kvState.lastSignal.action} variant={kvState.lastSignal.action === 'hold' ? 'info' : 'executed'} />
                      <span className="text-[10px] font-mono text-cyan/40">Conf: {(kvState.lastSignal.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-[11px] text-steel/50 leading-relaxed">{kvState.lastSignal.reason}</p>
                    <span className="text-[9px] font-mono text-steel/30 mt-1 block">Source: {kvState.lastSignal.source || 'orchestrator'}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <Zap className="w-6 h-6 text-steel/20 mx-auto mb-2" />
                  <p className="text-xs text-steel/40">No AI signals yet. Start the orchestrator to begin.</p>
                  <p className="text-[10px] text-steel/30 mt-1 font-mono">cd orchestrator && npm start</p>
                </div>
              )}
            </GlassPanel>
          </div>
        </div>

        {/* Right 1/3: Market + System */}
        <div className="space-y-6">
          {/* Shield */}
          <div className="flex justify-center py-2">
            <DashboardShield size={200} riskScore={risk.score} riskLevel={risk.level} />
          </div>

          {/* Pyth Market Prices */}
          <div>
            <SectionLabel color="text-cyan/50">Market Prices</SectionLabel>
            <GlassPanel className="p-5">
              {pythPrices ? (
                <div className="space-y-3">
                  {Object.entries(pythPrices).map(([sym, data]) => (
                    <div key={sym} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TokenIcon symbol={sym} size={16} />
                        <span className="text-xs font-display font-medium text-white">{sym}/USD</span>
                      </div>
                      <span className="text-xs font-mono text-white/80">
                        ${data.price?.toLocaleString(undefined, { maximumFractionDigits: sym === 'USDC' ? 4 : 2 })}
                      </span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-white/[0.04]">
                    <span className="text-[8px] font-mono text-steel/25 flex items-center gap-1">
                      <Globe className="w-2.5 h-2.5" /> Pyth Hermes · real-time
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-steel/40">Start orchestrator for prices</p>
              )}
            </GlassPanel>
          </div>

          {/* Orchestrator Status */}
          <div>
            <SectionLabel color="text-steel/50">Orchestrator</SectionLabel>
            <GlassPanel className="p-5">
              {orchStatus ? (
                <div className="space-y-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-steel/50">Status</span>
                    <StatusPill label={orchStatus.running ? 'Running' : 'Idle'} variant={orchStatus.running ? 'active' : 'paused'} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-steel/50">Cycles</span>
                    <span className="font-mono text-white/60">{orchStatus.cycleCount || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-steel/50">Executions</span>
                    <span className="font-mono text-emerald-soft/70">{orchStatus.totalExecutions || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-steel/50">Blocked</span>
                    <span className="font-mono text-amber-warn/70">{orchStatus.totalBlocked || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-steel/50">Skipped (hold)</span>
                    <span className="font-mono text-steel/50">{orchStatus.totalSkipped || 0}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-2">
                  <p className="text-xs text-steel/40">Orchestrator offline</p>
                </div>
              )}
            </GlassPanel>
          </div>

          {/* Quick Navigation */}
          <div>
            <SectionLabel color="text-steel/40">Quick Access</SectionLabel>
            <div className="space-y-1.5">
              {[
                { to: '/app/vault', label: 'Vault Detail', desc: 'Charts & analysis', icon: BarChart3, color: 'text-cyan/50' },
                { to: '/app/actions', label: 'AI Actions', desc: 'Intelligence feed', icon: Activity, color: 'text-emerald-soft/50' },
                { to: '/app/journal', label: 'Journal', desc: 'Audit trail', icon: Target, color: 'text-gold/50' },
                { to: '/app/settings', label: 'Settings', desc: 'System config', icon: Eye, color: 'text-steel/50' },
              ].map(item => (
                <Link key={item.to} to={item.to}>
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
