import { useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { vaultOverview, allocation as mockAllocation, aiActions as mockAiActions, policy as mockPolicy, riskEvents } from '../data/mockData';
import { getDeployments } from '../lib/contracts';
import { useVaultSummary, useVaultPolicy, usePause, useUnpause, useWithdraw, useApprove, useDeposit, useUpdatePolicy, useTokenBalance, useVaultList, useTransferToken } from '../hooks/useVault';
import { useMultiAssetNAV, useOrchestratorStatus, useKVState, useDecisions, useJournal, useExecutions } from '../hooks/useOrchestrator';
import GlassPanel from '../components/ui/GlassPanel';
import StatusPill from '../components/ui/StatusPill';
import SectionLabel from '../components/ui/SectionLabel';
import MetricCard from '../components/ui/MetricCard';
import PolicyChip from '../components/ui/PolicyChip';
import ControlButton from '../components/ui/ControlButton';
import NavChart from '../components/charts/NavChart';
import DrawdownChart from '../components/charts/DrawdownChart';
import DashboardShield from '../components/dashboard/DashboardShield';
import TokenIcon from '../components/ui/TokenIcon';
import {
  Shield, TrendingUp, TrendingDown, Activity, Clock, Target,
  AlertTriangle, Lock, Zap, Layers, Eye,
  PauseCircle, PlayCircle, Settings, ArrowDownToLine, ArrowUpToLine, Download,
  CheckCircle, XCircle, Info
} from 'lucide-react';

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const typeIcons = {
  execution: <CheckCircle className="w-3.5 h-3.5 text-emerald-soft/60" />,
  blocked: <XCircle className="w-3.5 h-3.5 text-red-warn/60" />,
  skip: <Info className="w-3.5 h-3.5 text-steel/60" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-warn/60" />,
  policy_update: <Settings className="w-3.5 h-3.5 text-cyan/60" />,
  policy_check: <Shield className="w-3.5 h-3.5 text-gold/60" />,
  decision: <Zap className="w-3.5 h-3.5 text-cyan/60" />,
  cycle: <Activity className="w-3.5 h-3.5 text-steel/40" />,
  system: <Settings className="w-3.5 h-3.5 text-steel/40" />,
};

const ASSET_COLORS = { USDC: '#2775ca', WBTC: '#f7931a', WETH: '#627eea', BTC: '#f7931a', ETH: '#627eea' };

export default function VaultDetailPage() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);

  // Use the connected wallet's first vault, fallback to demo vault
  const { vaults: myVaults } = useVaultList(deployments.aegisVaultFactory, address);
  const vaultAddr = myVaults.length > 0 ? myVaults[0].address : deployments.demoVault;

  // ── Live data ──
  const { data: liveVault, refetch } = useVaultSummary(vaultAddr);
  const { data: livePolicy } = useVaultPolicy(vaultAddr);
  const { data: navData } = useMultiAssetNAV(vaultAddr);
  const { data: orchStatus } = useOrchestratorStatus();
  const { data: kvState } = useKVState();
  const { data: liveDecisions } = useDecisions(10);
  const { data: journalData } = useJournal(100);
  const { data: liveExecutions } = useExecutions(20);

  // ── Contract write hooks ──
  const { pause, isPending: pausePending } = usePause();
  const { unpause, isPending: unpausePending } = useUnpause();
  const { withdraw, isPending: withdrawPending, isSuccess: withdrawSuccess } = useWithdraw();
  const { approve, isPending: approvePending, isSuccess: approveSuccess } = useApprove();
  const { deposit, isPending: depositPending, isSuccess: depositSuccess } = useDeposit();
  const { transfer: transferToken, isPending: transferPending, isSuccess: transferSuccess } = useTransferToken();
  const { updatePolicy, isPending: policyPending, isSuccess: policySuccess } = useUpdatePolicy();

  // Wallet token balances
  const { address: walletAddress } = useAccount();
  const { balance: walletUsdcBalance } = useTokenBalance(deployments.mockUSDC, walletAddress, 6);
  const { balance: walletWbtcBalance } = useTokenBalance(deployments.mockWBTC, walletAddress, 8);
  const { balance: walletWethBalance } = useTokenBalance(deployments.mockWETH, walletAddress, 18);

  const depositTokens = [
    { symbol: 'USDC', address: deployments.mockUSDC, decimals: 6, balance: walletUsdcBalance, isBase: true },
    { symbol: 'WBTC', address: deployments.mockWBTC, decimals: 8, balance: walletWbtcBalance, isBase: false },
    { symbol: 'WETH', address: deployments.mockWETH, decimals: 18, balance: walletWethBalance, isBase: false },
  ];

  // ── UI state ──
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [selectedDepositToken, setSelectedDepositToken] = useState(depositTokens[0]);
  const [depositStep, setDepositStep] = useState('input'); // 'input' | 'approve' | 'deposit' | 'done'
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [policyForm, setPolicyForm] = useState(null);

  const hasLive = isConnected && !!liveVault;

  // ── Merge: real where available, mock fallback ──
  const nav = navData?.totalNav || (hasLive ? parseFloat(liveVault.balance) : vaultOverview.nav);
  const isPaused = hasLive ? liveVault.paused : false;
  const totalDeposited = hasLive ? parseFloat(liveVault.totalDeposited) : vaultOverview.deposited;
  const executions = orchStatus?.totalExecutions ?? vaultOverview.totalExecutions;
  const dailyActions = hasLive ? liveVault.dailyActions : 0;
  const lastExecTs = hasLive ? liveVault.lastExecution : vaultOverview.lastExecution;

  // ── All-Time Return (REAL if on-chain data available) ──
  const hasRealReturn = hasLive && totalDeposited > 0;
  const allTimeReturnPct = hasRealReturn
    ? ((nav - totalDeposited) / totalDeposited) * 100
    : vaultOverview.allTimeReturn;
  const allTimeReturnUsd = hasRealReturn
    ? nav - totalDeposited
    : vaultOverview.allTimeReturnUsd;
  const returnIsPositive = allTimeReturnPct >= 0;

  // ── PnL (REAL unrealized from NAV vs deposited, realized from executions) ──
  const realizedPnl = liveExecutions && liveExecutions.length > 0
    ? liveExecutions.reduce((sum, ex) => sum + (ex.pnl || 0), 0)
    : null;
  const pnlRealized = realizedPnl !== null ? realizedPnl : vaultOverview.pnlRealized;
  const pnlUnrealized = hasRealReturn
    ? nav - totalDeposited - (realizedPnl || 0)
    : vaultOverview.pnlUnrealized;

  // Risk score (real calc if navData available)
  let riskScore = vaultOverview.riskScore;
  let riskLevel = vaultOverview.riskLevel;
  if (navData?.breakdown) {
    let score = 0;
    const maxPct = Math.max(...navData.breakdown.map(a => a.pct || 0));
    score += maxPct > 80 ? 30 : maxPct > 60 ? 20 : maxPct > 40 ? 10 : 5;
    if (totalDeposited > 0 && nav < totalDeposited) {
      const ddPct = ((totalDeposited - nav) / totalDeposited) * 100;
      score += ddPct > 10 ? 30 : ddPct > 5 ? 20 : ddPct > 2 ? 10 : 5;
    }
    const lastConf = kvState?.lastSignal?.confidence;
    if (lastConf !== undefined) score += lastConf < 0.4 ? 20 : lastConf < 0.6 ? 12 : lastConf < 0.8 ? 5 : 0;
    riskScore = Math.min(100, Math.max(0, score));
    riskLevel = riskScore < 30 ? 'Low' : riskScore < 60 ? 'Moderate' : riskScore < 80 ? 'Elevated' : 'Critical';
  }

  // ── Sharpe / Max Drawdown (mock — needs historical time-series) ──
  const sharpeRatio = vaultOverview.sharpeRatio;
  const maxDrawdown = vaultOverview.maxDrawdown;

  // Policy (real or mock)
  const pol = livePolicy || {
    maxPositionPct: mockPolicy.maxPositionPct,
    maxDailyLossPct: mockPolicy.dailyLossLimitPct,
    stopLossPct: mockPolicy.globalStopLoss,
    cooldownSeconds: mockPolicy.cooldownMinutes * 60,
    confidenceThresholdPct: mockPolicy.confidenceThreshold * 100,
    maxActionsPerDay: mockPolicy.maxActionsPerDay,
    autoExecution: mockPolicy.autoExecution,
    paused: mockPolicy.paused,
  };
  const mandateType = pol.maxPositionPct <= 30 ? 'Defensive' : pol.maxPositionPct <= 50 ? 'Balanced' : 'Tactical';

  // Allocation (real from Pyth NAV or mock)
  const allocationData = navData?.breakdown
    ? navData.breakdown.map(a => ({
        asset: a.symbol, symbol: a.symbol, amount: a.balance,
        value: a.valueUsd, pct: a.pct,
        color: ASSET_COLORS[a.symbol] || '#8a8a9a',
      }))
    : mockAllocation;

  // AI Journal (real decisions from orchestrator or mock)
  const journalEntries = liveDecisions && liveDecisions.length > 0
    ? liveDecisions.map((d, i) => ({
        id: d.id || `live-${i}`, action: `${(d.action || '').toUpperCase()} ${d.asset || ''}`,
        outcome: d.action === 'hold' ? 'skipped' : 'executed',
        reason: d.reason || '', timestamp: d.timestamp,
        asset: d.asset, confidence: d.confidence || 0, riskScore: d.risk_score || 0,
        txHash: null, source: d.source || 'orchestrator',
      }))
    : mockAiActions.slice(0, 5);

  // ── Risk Timeline (REAL from journal or mock fallback) ──
  const hasRealTimeline = journalData && journalData.length > 0;
  const riskTimelineEntries = hasRealTimeline
    ? journalData.slice(0, 10).map((entry, i) => {
        let severity = 'normal';
        if (entry.type === 'policy_check' && !entry.valid) severity = 'warning';
        else if (entry.type === 'execution' && !entry.success) severity = 'elevated';
        else if (entry.type === 'decision' && entry.action === 'hold') severity = 'info';

        let message = '';
        if (entry.type === 'decision') {
          message = `AI decided: ${(entry.action || 'hold').toUpperCase()} ${entry.asset || ''}`;
        } else if (entry.type === 'execution') {
          message = entry.success
            ? `Execution success: ${(entry.action || '').toUpperCase()} ${entry.asset || ''}`
            : `Execution failed: ${entry.error || 'unknown error'}`;
        } else if (entry.type === 'policy_check') {
          message = entry.valid
            ? `Policy check passed for ${(entry.action || '').toUpperCase()} ${entry.asset || ''}`
            : `Policy blocked: ${entry.reason || 'constraint violated'}`;
        } else if (entry.type === 'cycle') {
          message = `AI cycle completed`;
        } else {
          message = entry.reason || entry.type || 'System event';
        }

        const details = [
          entry.confidence !== undefined ? `Conf: ${(entry.confidence * 100).toFixed(0)}%` : '',
          entry.risk_score !== undefined ? `Risk: ${(entry.risk_score * 100).toFixed(0)}%` : '',
          entry.duration_ms ? `${entry.duration_ms}ms` : '',
          entry.txHash || '',
        ].filter(Boolean).join(' · ') || 'Logged by orchestrator';

        return {
          id: entry.id || `rt-${i}`,
          timestamp: entry.timestamp,
          type: entry.type === 'policy_check' ? (entry.valid ? 'execution' : 'blocked')
              : entry.type === 'decision' ? (entry.action === 'hold' ? 'skip' : 'execution')
              : entry.type === 'execution' ? (entry.success ? 'execution' : 'blocked')
              : entry.type || 'execution',
          severity,
          message,
          details,
          isLive: true,
        };
      })
    : riskEvents;

  // Vault info (real or mock)
  const vaultAddress = hasLive ? vaultAddr : vaultOverview.address;
  const executorAddress = hasLive ? liveVault.executor : vaultOverview.executorAddress;
  const networkName = chainId === 16602 ? '0G Galileo Testnet' : chainId === 31337 ? 'Hardhat Local' : vaultOverview.network;

  const handlePause = () => {
    if (isPaused) { unpause(vaultAddr); } else { pause(vaultAddr); }
    setTimeout(() => refetch(), 3000);
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      {/* ── Header ── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-display font-semibold text-white tracking-tight">Aegis Primary Vault</h1>
            <StatusPill label={isPaused ? 'Paused' : 'Active'} variant={isPaused ? 'paused' : 'active'} pulse={!isPaused} />
            {navData && <StatusPill label="Pyth NAV" variant="gold" />}
          </div>
          <div className="flex items-center gap-4 text-[11px] font-mono text-steel/40">
            <span>{vaultAddress}</span>
            <span>{networkName}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ControlButton
            variant="primary"
            size="sm"
            disabled={!isConnected}
            onClick={() => { setDepositAmount(''); setDepositStep('input'); setShowDepositModal(true); }}
          >
            <ArrowUpToLine className="w-3.5 h-3.5" /> Deposit
          </ControlButton>
          <ControlButton
            variant="secondary"
            size="sm"
            disabled={!isConnected}
            onClick={() => { setWithdrawAmount(''); setShowWithdrawModal(true); }}
          >
            <ArrowDownToLine className="w-3.5 h-3.5" /> Withdraw
          </ControlButton>
          <ControlButton
            variant="secondary"
            size="sm"
            disabled={!isConnected}
            onClick={() => {
              if (livePolicy) {
                setPolicyForm({
                  maxPositionBps: livePolicy.maxPositionBps,
                  maxDailyLossBps: livePolicy.maxDailyLossBps,
                  stopLossBps: livePolicy.stopLossBps || 1500,
                  cooldownSeconds: livePolicy.cooldownSeconds,
                  confidenceThresholdBps: livePolicy.confidenceThresholdBps,
                  maxActionsPerDay: livePolicy.maxActionsPerDay,
                  autoExecution: livePolicy.autoExecution,
                  paused: livePolicy.paused,
                });
              }
              setShowPolicyModal(true);
            }}
          >
            <Settings className="w-3.5 h-3.5" /> Edit Policy
          </ControlButton>
          <ControlButton variant="danger" size="sm" disabled={!isConnected || pausePending || unpausePending} onClick={handlePause}>
            {isPaused
              ? <><PlayCircle className="w-3.5 h-3.5" /> {unpausePending ? 'Resuming...' : 'Resume'}</>
              : <><PauseCircle className="w-3.5 h-3.5" /> {pausePending ? 'Pausing...' : 'Pause'}</>
            }
          </ControlButton>
        </div>
      </div>

      {/* ── Vault Summary Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <MetricCard
          label="Net Asset Value"
          value={`$${nav.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          subValue={navData ? 'Pyth Oracle' : 'Base asset only'}
          accent="text-white"
          icon={<Eye className="w-4 h-4" />}
          className="col-span-2 lg:col-span-1"
        />
        <MetricCard
          label="All-Time Return"
          value={`${returnIsPositive ? '+' : ''}${allTimeReturnPct.toFixed(2)}%`}
          subValue={`${returnIsPositive ? '+' : ''}$${Math.abs(allTimeReturnUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          accent={returnIsPositive ? 'text-emerald-soft' : 'text-red-warn'}
          icon={returnIsPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
        />
        <MetricCard
          label="Risk Score"
          value={riskScore}
          subValue={riskLevel}
          accent={riskScore < 30 ? 'text-emerald-soft' : riskScore < 60 ? 'text-amber-warn' : 'text-red-warn'}
          icon={<Shield className="w-4 h-4" />}
        />
        <MetricCard
          label="Executions"
          value={executions}
          subValue={`${dailyActions} today`}
          accent="text-cyan"
          icon={<Activity className="w-4 h-4" />}
        />
        <MetricCard
          label="Sharpe Ratio"
          value={sharpeRatio}
          subValue={`Max DD: ${maxDrawdown}%`}
          accent="text-white"
          icon={<TrendingDown className="w-4 h-4" />}
        />
      </div>

      {/* ── Main Grid ── */}
      <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
        {/* Left 2/3 */}
        <div className="lg:col-span-2 space-y-6">
          {/* Performance chart (mock — needs historical data) */}
          <div>
            <SectionLabel color="text-cyan/60">Performance</SectionLabel>
            <GlassPanel className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/40 block">Realized PnL</span>
                    <span className={`text-sm font-display font-semibold ${pnlRealized >= 0 ? 'text-emerald-soft' : 'text-red-warn'}`}>
                      {pnlRealized >= 0 ? '+' : ''}${Math.abs(pnlRealized).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/40 block">Unrealized PnL</span>
                    <span className={`text-sm font-display font-semibold ${pnlUnrealized >= 0 ? 'text-cyan' : 'text-red-warn'}`}>
                      {pnlUnrealized >= 0 ? '+' : ''}${Math.abs(pnlUnrealized).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
                {!hasRealReturn && (
                  <span className="text-[8px] font-mono text-steel/25 px-1.5 py-0.5 rounded bg-white/[0.02] border border-white/[0.04]">MOCK CHART</span>
                )}
              </div>
              <NavChart height={220} />
              <div className="mt-4 pt-3 border-t border-white/[0.04]">
                <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-2">Drawdown</span>
                <DrawdownChart height={100} />
              </div>
            </GlassPanel>
          </div>

          {/* Allocation detail (REAL from Pyth or mock) */}
          <div>
            <SectionLabel color="text-steel/50">Allocation Detail</SectionLabel>
            <GlassPanel className="p-5">
              <div className="flex-1">
                <div className="space-y-3">
                  {allocationData.filter(a => a.value > 0 || a.pct > 0).map((a) => (
                    <div key={a.symbol} className="flex items-center gap-3 py-2 border-b border-white/[0.03] last:border-0">
                      <TokenIcon symbol={a.symbol} size={20} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-display font-medium text-white">{a.asset}</span>
                          <span className="text-sm font-mono text-white/80">${a.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-[10px] font-mono text-steel/40">{typeof a.amount === 'number' ? a.amount.toFixed(a.symbol === 'USDC' ? 0 : 6) : a.amount} {a.symbol}</span>
                          <span className="text-[10px] font-mono text-steel/50">{a.pct.toFixed(1)}%</span>
                        </div>
                        {/* Bar */}
                        <div className="mt-1 h-1 rounded-full bg-white/[0.04] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${a.pct}%`, backgroundColor: a.color, opacity: 0.7 }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {navData?.prices && (
                  <div className="mt-3 pt-2 border-t border-white/[0.04] flex gap-4 text-[9px] font-mono text-steel/30">
                    <span>BTC ${navData.prices.BTC?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span>ETH ${navData.prices.ETH?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    <span>Source: Pyth Hermes</span>
                  </div>
                )}
              </div>
            </GlassPanel>
          </div>

          {/* AI Reasoning Journal (REAL from orchestrator or mock) */}
          <div>
            <SectionLabel color="text-cyan/60">AI Reasoning Journal</SectionLabel>
            <div className="space-y-2">
              {journalEntries.map((action) => (
                <GlassPanel key={action.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-1">
                      <div className={`w-2 h-2 rounded-full ${
                        action.outcome === 'executed' ? 'bg-emerald-soft' :
                        action.outcome === 'blocked' ? 'bg-red-warn' : 'bg-steel'
                      }`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-display font-medium text-white">{action.action}</span>
                        <StatusPill label={action.outcome} variant={action.outcome} />
                        {action.source === 'orchestrator' && (
                          <span className="text-[8px] font-mono text-cyan/40 px-1 py-0.5 rounded bg-cyan/5 border border-cyan/10">LIVE</span>
                        )}
                      </div>
                      <p className="text-[11px] text-steel/60 leading-relaxed mb-2">{action.reason}</p>
                      <div className="flex items-center gap-4 text-[10px] font-mono text-steel/40">
                        {action.timestamp && <span>{formatTime(action.timestamp)}</span>}
                        {action.asset && <span>{action.asset}</span>}
                        <span>Conf: {((action.confidence || 0) * 100).toFixed(0)}%</span>
                        <span>Risk: {((action.riskScore || 0) * 100).toFixed(0)}%</span>
                        {action.txHash && <span className="text-cyan/40">{action.txHash}</span>}
                      </div>
                    </div>
                  </div>
                </GlassPanel>
              ))}
            </div>
          </div>

          {/* Risk Timeline (REAL from journal or mock fallback) */}
          <div>
            <SectionLabel color="text-amber-warn/60">
              Risk Timeline
              {hasRealTimeline && (
                <span className="ml-2 text-[8px] font-mono text-cyan/40 px-1 py-0.5 rounded bg-cyan/5 border border-cyan/10">LIVE</span>
              )}
            </SectionLabel>
            <GlassPanel className="p-5">
              <div className="relative">
                <div className="absolute left-[7px] top-0 bottom-0 w-px bg-white/[0.04]" />
                <div className="space-y-0">
                  {riskTimelineEntries.map((evt) => (
                    <div key={evt.id} className="flex items-start gap-4 py-3 relative">
                      <div className="flex-shrink-0 relative z-10 bg-obsidian">
                        {typeIcons[evt.type] || typeIcons.execution}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs text-white/80">{evt.message}</span>
                          <StatusPill label={evt.severity} variant={evt.severity} />
                          {evt.isLive && (
                            <span className="text-[8px] font-mono text-cyan/40 px-1 py-0.5 rounded bg-cyan/5 border border-cyan/10">LIVE</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-steel/40">{formatTime(evt.timestamp)}</span>
                          <span className="text-[10px] text-steel/30">{evt.details}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassPanel>
          </div>
        </div>

        {/* Right 1/3 */}
        <div className="space-y-6">
          {/* Mini Shield (REAL risk score) */}
          <div className="flex justify-center py-4">
            <DashboardShield size={200} riskScore={riskScore} riskLevel={riskLevel} />
          </div>

          {/* Current Policy (REAL from chain or mock) */}
          <div>
            <SectionLabel color="text-gold/60">Current Policy</SectionLabel>
            <GlassPanel gold className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-gold/60" />
                <span className="text-xs font-display font-medium text-white/80">{mandateType} Mandate</span>
                <StatusPill label={isPaused ? 'Paused' : 'Active'} variant={isPaused ? 'paused' : 'active'} pulse={!isPaused} />
              </div>
              <div className="space-y-0">
                <PolicyChip label="Max Position" value={`${pol.maxPositionPct}%`} icon={<Target className="w-3.5 h-3.5" />} />
                <PolicyChip label="Max Daily Loss" value={`${pol.maxDailyLossPct}%`} icon={<TrendingDown className="w-3.5 h-3.5" />} />
                <PolicyChip label="Stop-Loss" value={`${pol.stopLossPct}%`} icon={<AlertTriangle className="w-3.5 h-3.5" />} />
                <PolicyChip label="Cooldown" value={`${pol.cooldownSeconds}s`} icon={<Clock className="w-3.5 h-3.5" />} />
                <PolicyChip label="Confidence Min" value={`${pol.confidenceThresholdPct}%`} icon={<Zap className="w-3.5 h-3.5" />} />
                <PolicyChip label="Max Actions/Day" value={pol.maxActionsPerDay} icon={<Layers className="w-3.5 h-3.5" />} />
                <PolicyChip label="Auto-Execution" value={pol.autoExecution ? 'Enabled' : 'Off'} icon={<Zap className="w-3.5 h-3.5" />} />
                <PolicyChip label="Sealed Mode" value="Roadmap" icon={<Lock className="w-3.5 h-3.5" />} />
              </div>
            </GlassPanel>
          </div>

          {/* System Controls (ALL REAL) */}
          <div>
            <SectionLabel color="text-steel/50">System Controls</SectionLabel>
            <GlassPanel className="p-5">
              <div className="space-y-2">
                {/* Pause / Resume */}
                <ControlButton variant={isPaused ? 'gold' : 'danger'} className="w-full" disabled={!isConnected || pausePending || unpausePending} onClick={handlePause}>
                  {isPaused
                    ? <><PlayCircle className="w-3.5 h-3.5" /> {unpausePending ? 'Resuming...' : 'Resume Vault'}</>
                    : <><PauseCircle className="w-3.5 h-3.5" /> {pausePending ? 'Pausing...' : 'Emergency Pause'}</>
                  }
                </ControlButton>

                {/* Deposit */}
                <ControlButton variant="primary" className="w-full" disabled={!isConnected} onClick={() => { setDepositAmount(''); setDepositStep('input'); setShowDepositModal(true); }}>
                  <ArrowUpToLine className="w-3.5 h-3.5" /> Deposit
                </ControlButton>

                {/* Withdraw */}
                <ControlButton variant="secondary" className="w-full" disabled={!isConnected} onClick={() => { setWithdrawAmount(''); setShowWithdrawModal(true); }}>
                  <ArrowDownToLine className="w-3.5 h-3.5" /> Withdraw
                </ControlButton>

                {/* Edit Policy */}
                <ControlButton variant="secondary" className="w-full" disabled={!isConnected} onClick={() => {
                  if (livePolicy) {
                    setPolicyForm({
                      maxPositionBps: livePolicy.maxPositionBps,
                      maxDailyLossBps: livePolicy.maxDailyLossBps,
                      stopLossBps: livePolicy.stopLossBps || 1500,
                      cooldownSeconds: livePolicy.cooldownSeconds,
                      confidenceThresholdBps: livePolicy.confidenceThresholdBps,
                      maxActionsPerDay: livePolicy.maxActionsPerDay,
                      autoExecution: livePolicy.autoExecution,
                      paused: livePolicy.paused,
                    });
                  }
                  setShowPolicyModal(true);
                }}>
                  <Settings className="w-3.5 h-3.5" /> Edit Policy
                </ControlButton>

                {/* Export Journal */}
                <ControlButton variant="secondary" className="w-full" onClick={() => {
                  const data = journalData || liveDecisions || [];
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `aegis-vault-journal-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}>
                  <Download className="w-3.5 h-3.5" /> Export Journal
                </ControlButton>
              </div>

              {/* Status messages */}
              {withdrawSuccess && <p className="text-[10px] text-emerald-soft/70 text-center mt-2">Withdrawal submitted successfully</p>}
              {(depositSuccess || transferSuccess) && <p className="text-[10px] text-emerald-soft/70 text-center mt-2">Deposit submitted successfully</p>}
              {policySuccess && <p className="text-[10px] text-emerald-soft/70 text-center mt-2">Policy updated on-chain</p>}
            </GlassPanel>
          </div>

          {/* ── Deposit Modal ── */}
          {showDepositModal && (
            <GlassPanel gold className="p-5">
              <h4 className="text-sm font-display font-semibold text-white mb-3">Deposit to Vault</h4>
              <div className="space-y-3">
                {depositStep === 'input' && (
                  <>
                    {/* Token selector */}
                    <div>
                      <label className="text-[10px] font-mono text-steel/40 block mb-1.5">Select Token</label>
                      <div className="flex gap-2">
                        {depositTokens.map(t => (
                          <button
                            key={t.symbol}
                            onClick={() => { setSelectedDepositToken(t); setDepositAmount(''); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-mono transition-all
                              ${selectedDepositToken.symbol === t.symbol
                                ? 'bg-gold/15 text-gold border border-gold/30'
                                : 'bg-white/[0.03] text-steel/50 border border-white/[0.06] hover:border-white/[0.1]'
                              }`}
                          >
                            <TokenIcon symbol={t.symbol} size={14} />
                            {t.symbol}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Amount input */}
                    <div>
                      <label className="text-[10px] font-mono text-steel/40 block mb-1">
                        Amount ({selectedDepositToken.symbol})
                      </label>
                      <input
                        type="number"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md px-3 py-2
                          text-sm font-mono text-white
                          focus:outline-none focus:border-gold/30 transition-colors"
                      />
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-steel/40">
                          Wallet: {parseFloat(selectedDepositToken.balance).toLocaleString(undefined, {
                            maximumFractionDigits: selectedDepositToken.symbol === 'USDC' ? 2 : 6
                          })} {selectedDepositToken.symbol}
                        </span>
                        <button
                          onClick={() => setDepositAmount(selectedDepositToken.balance)}
                          className="text-[10px] text-gold/60 hover:text-gold transition-colors"
                        >Max</button>
                      </div>
                    </div>

                    {/* Info for non-base tokens */}
                    {!selectedDepositToken.isBase && (
                      <div className="text-[10px] text-amber-warn/60 bg-amber-warn/5 border border-amber-warn/10 rounded px-2.5 py-1.5">
                        {selectedDepositToken.symbol} will be transferred directly to vault. This does not update totalDeposited (base asset tracking).
                      </div>
                    )}

                    <div className="flex gap-2">
                      <ControlButton
                        variant="primary"
                        className="flex-1"
                        disabled={!depositAmount || parseFloat(depositAmount) <= 0}
                        onClick={() => setDepositStep('approve')}
                      >
                        Continue
                      </ControlButton>
                      <ControlButton variant="secondary" className="flex-1" onClick={() => setShowDepositModal(false)}>
                        Cancel
                      </ControlButton>
                    </div>
                  </>
                )}

                {depositStep === 'approve' && selectedDepositToken.isBase && (
                  <>
                    <div className="text-center py-2">
                      <div className="flex justify-center mb-2"><TokenIcon symbol={selectedDepositToken.symbol} size={24} /></div>
                      <p className="text-xs text-white/70 mb-1">Step 1/2: Approve {selectedDepositToken.symbol}</p>
                      <p className="text-[10px] text-steel/40">Allow the vault to use {depositAmount} {selectedDepositToken.symbol}</p>
                    </div>
                    <div className="flex gap-2">
                      <ControlButton
                        variant="gold"
                        className="flex-1"
                        disabled={approvePending}
                        onClick={() => {
                          approve(selectedDepositToken.address, vaultAddr, depositAmount, selectedDepositToken.decimals);
                        }}
                      >
                        {approvePending ? 'Approving...' : `Approve ${selectedDepositToken.symbol}`}
                      </ControlButton>
                      <ControlButton variant="secondary" className="flex-1" onClick={() => setDepositStep('input')}>
                        Back
                      </ControlButton>
                    </div>
                    {approveSuccess && (
                      <ControlButton
                        variant="primary"
                        className="w-full"
                        onClick={() => setDepositStep('deposit')}
                      >
                        Approved — Continue to Deposit
                      </ControlButton>
                    )}
                  </>
                )}

                {depositStep === 'approve' && !selectedDepositToken.isBase && (
                  <>
                    <div className="text-center py-2">
                      <div className="flex justify-center mb-2"><TokenIcon symbol={selectedDepositToken.symbol} size={24} /></div>
                      <p className="text-xs text-white/70 mb-1">Transfer {selectedDepositToken.symbol}</p>
                      <p className="text-[10px] text-steel/40">
                        Send {depositAmount} {selectedDepositToken.symbol} directly to vault
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <ControlButton
                        variant="primary"
                        className="flex-1"
                        disabled={transferPending}
                        onClick={() => {
                          transferToken(selectedDepositToken.address, vaultAddr, depositAmount, selectedDepositToken.decimals);
                          setTimeout(() => { setShowDepositModal(false); setDepositStep('input'); refetch(); }, 4000);
                        }}
                      >
                        {transferPending ? 'Sending...' : `Send ${selectedDepositToken.symbol}`}
                      </ControlButton>
                      <ControlButton variant="secondary" className="flex-1" onClick={() => setDepositStep('input')}>
                        Back
                      </ControlButton>
                    </div>
                  </>
                )}

                {depositStep === 'deposit' && (
                  <>
                    <div className="text-center py-2">
                      <div className="flex justify-center mb-2"><TokenIcon symbol={selectedDepositToken.symbol} size={24} /></div>
                      <p className="text-xs text-white/70 mb-1">Step 2/2: Deposit to Vault</p>
                      <p className="text-[10px] text-steel/40">Depositing {depositAmount} {selectedDepositToken.symbol} into vault</p>
                    </div>
                    <div className="flex gap-2">
                      <ControlButton
                        variant="primary"
                        className="flex-1"
                        disabled={depositPending}
                        onClick={() => {
                          deposit(vaultAddr, depositAmount, selectedDepositToken.decimals);
                          setTimeout(() => { setShowDepositModal(false); setDepositStep('input'); refetch(); }, 4000);
                        }}
                      >
                        {depositPending ? 'Depositing...' : 'Confirm Deposit'}
                      </ControlButton>
                      <ControlButton variant="secondary" className="flex-1" onClick={() => setDepositStep('approve')}>
                        Back
                      </ControlButton>
                    </div>
                  </>
                )}
              </div>
            </GlassPanel>
          )}

          {/* ── Withdraw Modal ── */}
          {showWithdrawModal && (
            <GlassPanel className="p-5">
              <h4 className="text-sm font-display font-semibold text-white mb-3">Withdraw USDC</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono text-steel/40 block mb-1">Amount (USDC)</label>
                  <input
                    type="number"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md px-3 py-2
                      text-sm font-mono text-white
                      focus:outline-none focus:border-gold/30 transition-colors"
                  />
                  {hasLive && (
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] text-steel/40">Available: ${parseFloat(liveVault.balance).toLocaleString()} USDC</span>
                      <button
                        onClick={() => setWithdrawAmount(liveVault.balance)}
                        className="text-[10px] text-gold/60 hover:text-gold transition-colors"
                      >Max</button>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <ControlButton
                    variant="primary"
                    className="flex-1"
                    disabled={!withdrawAmount || withdrawPending || parseFloat(withdrawAmount) <= 0}
                    onClick={() => {
                      withdraw(vaultAddr, withdrawAmount, 6);
                      setTimeout(() => { setShowWithdrawModal(false); refetch(); }, 3000);
                    }}
                  >
                    {withdrawPending ? 'Withdrawing...' : 'Confirm Withdraw'}
                  </ControlButton>
                  <ControlButton variant="secondary" className="flex-1" onClick={() => setShowWithdrawModal(false)}>
                    Cancel
                  </ControlButton>
                </div>
              </div>
            </GlassPanel>
          )}

          {/* ── Edit Policy Modal ── */}
          {showPolicyModal && policyForm && (
            <GlassPanel gold className="p-5">
              <h4 className="text-sm font-display font-semibold text-white mb-3">Edit Vault Policy</h4>
              <div className="space-y-3">
                {[
                  { key: 'maxPositionBps', label: 'Max Position (bps)', min: 100, max: 10000 },
                  { key: 'maxDailyLossBps', label: 'Max Daily Loss (bps)', min: 50, max: 5000 },
                  { key: 'stopLossBps', label: 'Stop-Loss (bps)', min: 100, max: 5000 },
                  { key: 'cooldownSeconds', label: 'Cooldown (seconds)', min: 10, max: 3600 },
                  { key: 'confidenceThresholdBps', label: 'Confidence Min (bps)', min: 1000, max: 9500 },
                  { key: 'maxActionsPerDay', label: 'Max Actions / Day', min: 1, max: 100 },
                ].map(param => (
                  <div key={param.key} className="flex items-center justify-between">
                    <span className="text-[11px] text-steel/60">{param.label}</span>
                    <input
                      type="number"
                      value={policyForm[param.key]}
                      onChange={(e) => setPolicyForm(prev => ({ ...prev, [param.key]: Number(e.target.value) }))}
                      min={param.min}
                      max={param.max}
                      className="w-24 bg-obsidian/60 border border-white/[0.08] rounded px-2 py-1
                        text-xs font-mono text-white text-right
                        focus:outline-none focus:border-gold/30 transition-colors"
                    />
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-steel/60">Auto-Execution</span>
                  <button
                    onClick={() => setPolicyForm(prev => ({ ...prev, autoExecution: !prev.autoExecution }))}
                    className={`px-3 py-1 rounded text-[10px] font-mono transition-all ${
                      policyForm.autoExecution
                        ? 'bg-emerald-soft/15 text-emerald-soft border border-emerald-soft/20'
                        : 'bg-white/[0.04] text-steel/50 border border-white/[0.06]'
                    }`}
                  >
                    {policyForm.autoExecution ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
                <div className="flex gap-2 pt-2">
                  <ControlButton
                    variant="primary"
                    className="flex-1"
                    disabled={policyPending}
                    onClick={() => {
                      updatePolicy(vaultAddr, policyForm);
                      setTimeout(() => { setShowPolicyModal(false); refetch(); }, 3000);
                    }}
                  >
                    {policyPending ? 'Updating...' : 'Update On-Chain'}
                  </ControlButton>
                  <ControlButton variant="secondary" className="flex-1" onClick={() => setShowPolicyModal(false)}>
                    Cancel
                  </ControlButton>
                </div>
              </div>
            </GlassPanel>
          )}

          {/* Vault Info (REAL addresses) */}
          <GlassPanel className="p-5">
            <SectionLabel color="text-steel/40">Vault Info</SectionLabel>
            <div className="space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-steel/50">Contract</span>
                <span className="font-mono text-cyan/50">{vaultAddress?.slice(0, 8)}...{vaultAddress?.slice(-6)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-steel/50">Executor</span>
                <span className="font-mono text-cyan/50">{executorAddress?.slice(0, 8)}...{executorAddress?.slice(-6)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-steel/50">Network</span>
                <span className="font-mono text-white/50">{networkName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-steel/50">Last Execution</span>
                <span className="font-mono text-white/50">{lastExecTs ? formatTime(lastExecTs) : 'Never'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-steel/50">Daily Actions</span>
                <span className="font-mono text-white/50">{dailyActions} / {pol.maxActionsPerDay}</span>
              </div>
            </div>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
