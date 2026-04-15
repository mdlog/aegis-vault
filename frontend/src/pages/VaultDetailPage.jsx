import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { isAddress } from 'viem';
import {
  ENABLE_DEMO_FALLBACKS,
  getDefaultVaultAddress,
  getDeployments,
  getExplorerAddressHref,
  getExplorerTxHref,
  getNetworkLabel,
  ORCHESTRATOR_URL,
  shortHexLabel,
} from '../lib/contracts';
import { Link } from 'react-router-dom';
import { useVaultSummary, useVaultPolicy, usePause, useUnpause, useWithdraw, useApprove, useDeposit, useUpdatePolicy, useTokenBalance, useVaultList, useTransferToken, useSetExecutor } from '../hooks/useVault';
import { useOperatorList } from '../hooks/useOperatorRegistry';
import { useMultiAssetNAV, useOrchestratorStatus, useDecisions, useJournal, useExecutions } from '../hooks/useOrchestrator';
import { drawdownHistory as demoDrawdownHistory, navHistory as demoNavHistory } from '../data/mockData';
import {
  demoRiskTimelineEntries,
  demoSignal,
  demoVaultDecisions,
  demoVaultExecutions,
  demoVaultNavData,
  getDemoVaultByAddress,
} from '../data/demoContent';
import {
  useVaultFeeState, useVaultNav, useClaimFees, useAccrueFees,
  formatBps,
} from '../hooks/useVaultFees';
import GlassPanel from '../components/ui/GlassPanel';
import StatusPill from '../components/ui/StatusPill';
import SectionLabel from '../components/ui/SectionLabel';
import MetricCard from '../components/ui/MetricCard';
import PolicyChip from '../components/ui/PolicyChip';
import ControlButton from '../components/ui/ControlButton';
import ExplorerAnchor from '../components/ui/ExplorerAnchor';
import NavChart from '../components/charts/NavChart';
import DrawdownChart from '../components/charts/DrawdownChart';
import DashboardShield from '../components/dashboard/DashboardShield';
import TokenIcon from '../components/ui/TokenIcon';
import {
  Shield, TrendingUp, TrendingDown, Activity, Clock, Target,
  AlertTriangle, Lock, Zap, Layers, Eye, Cpu,
  PauseCircle, PlayCircle, Settings, ArrowDownToLine, ArrowUpToLine, Download,
  CheckCircle, XCircle, Info, DollarSign, Percent, Wallet, Hourglass
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
  const { vaultAddress: routeVaultAddress } = useParams();

  const { vaults: myVaults } = useVaultList(deployments.aegisVaultFactory, address);
  const vaultAddr = routeVaultAddress || myVaults[0]?.address || getDefaultVaultAddress(chainId);
  const { operators: marketplaceOps } = useOperatorList(deployments.operatorRegistry);
  const activeMarketplaceOps = marketplaceOps.filter((op) => op.loaded && op.active);

  // ── Live data ──
  const { data: liveVault, refetch } = useVaultSummary(vaultAddr);
  const { data: livePolicy } = useVaultPolicy(vaultAddr);
  const { data: navData } = useMultiAssetNAV(vaultAddr);
  const { data: orchStatus } = useOrchestratorStatus();
  const { data: liveDecisions } = useDecisions(10, { vaultAddress: vaultAddr });
  const { data: journalData } = useJournal(100, { vaultAddress: vaultAddr });
  const { data: liveExecutions } = useExecutions(20, { vaultAddress: vaultAddr });
  const demoVault = ENABLE_DEMO_FALLBACKS ? getDemoVaultByAddress(vaultAddr) : null;
  const showDemoVault = ENABLE_DEMO_FALLBACKS && !liveVault && !!demoVault;

  // ── Contract write hooks ──
  const { pause, hash: pauseHash, isPending: pausePending } = usePause();
  const { unpause, hash: unpauseHash, isPending: unpausePending } = useUnpause();
  const { withdraw, hash: withdrawHash, isPending: withdrawPending, isSuccess: withdrawSuccess } = useWithdraw();
  const { approve, hash: approveHash, isPending: approvePending, isSuccess: approveSuccess } = useApprove();
  const { deposit, hash: depositHash, isPending: depositPending, isSuccess: depositSuccess } = useDeposit();
  const { transfer: transferToken, hash: transferHash, isPending: transferPending, isSuccess: transferSuccess } = useTransferToken();
  const { updatePolicy, hash: policyHash, isPending: policyPending, isSuccess: policySuccess } = useUpdatePolicy();
  const { setExecutor, hash: executorHash, isPending: executorPending, isSuccess: executorSuccess } = useSetExecutor();

  // ── Fee state + write hooks ──
  const { state: feeState, refetch: refetchFees } = useVaultFeeState(vaultAddr, 6);
  const { navUsd: liveNavUsd, refetch: refetchNav } = useVaultNav(vaultAddr, 6);
  const { claim: claimFees, hash: claimHash, isPending: claimPending, isSuccess: claimSuccess } = useClaimFees();
  const { accrue: accrueFees, hash: accrueHash, isPending: accruePending, isSuccess: accrueSuccess } = useAccrueFees();

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
  const [showExecutorModal, setShowExecutorModal] = useState(false);
  const [executorForm, setExecutorForm] = useState('');
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [policyForm, setPolicyForm] = useState(null);

  const hasLive = !!liveVault;
  const effectivePolicy = livePolicy || (showDemoVault ? demoVault.policy : null);
  const navSnapshot = navData || (showDemoVault ? demoVaultNavData : null);
  const decisionData = liveDecisions?.length ? liveDecisions : showDemoVault ? demoVaultDecisions : [];
  const executionData = liveExecutions?.length ? liveExecutions : showDemoVault ? demoVaultExecutions : [];
  const latestSignal = decisionData[0] || (showDemoVault ? demoSignal : null);

  const nav = navSnapshot?.totalNav || (hasLive ? parseFloat(liveVault.balance) : showDemoVault ? demoVault.nav : 0);
  const isPaused = hasLive ? liveVault.paused : showDemoVault ? demoVault.paused : false;
  const totalDeposited = hasLive ? parseFloat(liveVault.totalDeposited) : showDemoVault ? demoVault.deposited : 0;
  const executions = executionData.length;
  const dailyActions = hasLive ? liveVault.dailyActions : showDemoVault ? demoVault.dailyActions : 0;
  const lastExecTs = hasLive ? liveVault.lastExecution : showDemoVault ? Math.floor(new Date(demoVault.lastExecution).getTime() / 1000) : 0;

  // ── All-Time Return ──
  const hasRealReturn = (hasLive || showDemoVault) && totalDeposited > 0;
  const allTimeReturnPct = hasRealReturn ? ((nav - totalDeposited) / totalDeposited) * 100 : 0;
  const allTimeReturnUsd = hasRealReturn ? nav - totalDeposited : 0;
  const returnIsPositive = allTimeReturnPct >= 0;

  // ── PnL ──
  const realizedPnl = executionData.length > 0
    ? executionData.reduce((sum, ex) => sum + (ex.pnl || 0), 0)
    : 0;
  const pnlRealized = realizedPnl;
  const pnlUnrealized = hasRealReturn ? nav - totalDeposited - realizedPnl : 0;

  // Risk score (real calc only when navData available)
  let riskScore = 0;
  let riskLevel = 'Unknown';
  if (navSnapshot?.breakdown) {
    let score = 0;
    const maxPct = Math.max(...navSnapshot.breakdown.map(a => a.pct || 0));
    score += maxPct > 80 ? 30 : maxPct > 60 ? 20 : maxPct > 40 ? 10 : 5;
    if (totalDeposited > 0 && nav < totalDeposited) {
      const ddPct = ((totalDeposited - nav) / totalDeposited) * 100;
      score += ddPct > 10 ? 30 : ddPct > 5 ? 20 : ddPct > 2 ? 10 : 5;
    }
    const lastConf = latestSignal?.confidence;
    if (lastConf !== undefined) score += lastConf < 0.4 ? 20 : lastConf < 0.6 ? 12 : lastConf < 0.8 ? 5 : 0;
    riskScore = Math.min(100, Math.max(0, score));
    riskLevel = riskScore < 30 ? 'Low' : riskScore < 60 ? 'Moderate' : riskScore < 80 ? 'Elevated' : 'Critical';
  }

  // ── Sharpe / Max Drawdown ──
  // Requires historical NAV time-series. Display "—" until 0G Storage backend lands.
  const sharpeRatio = null;
  const maxDrawdown = null;

  // Policy — must be live; show neutral defaults that render as "—" if missing
  const pol = effectivePolicy || {
    maxPositionPct: 0,
    maxDailyLossPct: 0,
    stopLossPct: 0,
    cooldownSeconds: 0,
    confidenceThresholdPct: 0,
    maxActionsPerDay: 0,
    autoExecution: false,
    paused: false,
  };
  const mandateType = showDemoVault
    ? demoVault.mandate
    : !effectivePolicy
      ? 'Unknown'
      : pol.maxPositionPct <= 30 ? 'Defensive'
      : pol.maxPositionPct <= 50 ? 'Balanced'
      : 'Tactical';
  // Derive NAV history from cycle journal entries (each cycle records vault NAV)
  const derivedNavHistory = (journalData || [])
    .filter(e => e.type === 'cycle' && Array.isArray(e.vaultResults))
    .flatMap(e => {
      const r = e.vaultResults.find(v => v.vault?.toLowerCase() === vaultAddr?.toLowerCase());
      if (!r || !r.vaultState?.nav) return [];
      return [{
        timestamp: e.timestamp,
        nav: parseFloat(r.vaultState.nav) || 0,
      }];
    })
    .reverse(); // journal is newest-first; chart wants oldest-first
  const navHistoryData = showDemoVault ? demoNavHistory : derivedNavHistory;
  const drawdownHistoryData = showDemoVault ? demoDrawdownHistory : [];

  // Allocation — empty array when no NAV data
  const allocationData = navSnapshot?.breakdown
    ? navSnapshot.breakdown.map(a => ({
        asset: a.symbol, symbol: a.symbol, amount: a.balance,
        value: a.valueUsd, pct: a.pct,
        color: ASSET_COLORS[a.symbol] || '#8a8a9a',
      }))
    : [];

  const journalEntries = decisionData.length > 0
    ? decisionData.map((d, i) => ({
        id: d.id || `live-${i}`, action: `${(d.action || '').toUpperCase()} ${d.asset || ''}`,
        outcome: d.action === 'hold' ? 'skipped' : 'executed',
        reason: d.reason || '', timestamp: d.timestamp,
        asset: d.asset, confidence: d.confidence || 0, riskScore: d.risk_score || 0,
        txHash: null, source: d.source || 'orchestrator',
        // v1 fields
        regime: d.regime, v1Action: d.v1_action,
        finalEdgeScore: d.final_edge_score, tradeQualityScore: d.trade_quality_score,
        hardVeto: d.hard_veto, hardVetoReasons: d.hard_veto_reasons,
        entryTrigger: d.entry_trigger,
      }))
    : [];

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
          txHash: entry.txHash || null,
          isLive: true,
        };
      })
    : showDemoVault ? demoRiskTimelineEntries : [];

  const vaultAddress = hasLive ? vaultAddr : showDemoVault ? demoVault.address : (vaultAddr || '');
  const executorAddress = hasLive ? liveVault.executor : showDemoVault ? demoVault.executor : '';
  const activeOrchestratorExecutor = orchStatus?.executorAddress || '';
  const executorMatchesActiveOrchestrator = Boolean(activeOrchestratorExecutor) &&
    Boolean(executorAddress) &&
    activeOrchestratorExecutor.toLowerCase() === executorAddress.toLowerCase();
  const networkName = showDemoVault
    ? demoVault.network
    : chainId === 16661 ? '0G Aristotle Mainnet'
    : getNetworkLabel(chainId);
  const vaultTitle = showDemoVault
    ? demoVault.name
    : vaultAddress
    ? `Vault ${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)}`
    : 'No Vault Selected';
  const showLiveTelemetryGuide = !showDemoVault && !latestSignal && !hasRealTimeline;
  const vaultExplorerHref = getExplorerAddressHref(chainId, vaultAddress);
  const executorExplorerHref = getExplorerAddressHref(chainId, executorAddress);
  const feeRecipientExplorerHref = getExplorerAddressHref(chainId, effectivePolicy?.feeRecipient);
  const recentVaultTxs = [
    { label: isPaused ? 'Resume vault' : 'Pause vault', hash: pauseHash || unpauseHash },
    { label: 'Approve deposit', hash: approveHash },
    { label: 'Deposit base asset', hash: depositHash },
    { label: 'Transfer vault asset', hash: transferHash },
    { label: 'Withdraw', hash: withdrawHash },
    { label: 'Update policy', hash: policyHash },
    { label: 'Set executor', hash: executorHash },
    { label: 'Accrue fees', hash: accrueHash },
    { label: 'Claim fees', hash: claimHash },
  ].map((item) => ({
    ...item,
    href: getExplorerTxHref(chainId, item.hash),
  })).filter((item) => item.href);

  if (!vaultAddr) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-12">
        <GlassPanel className="p-8 text-center">
          <Shield className="w-8 h-8 text-steel/20 mx-auto mb-3" />
          <h1 className="text-xl font-display font-semibold text-white mb-2">No Vault Selected</h1>
          <p className="text-sm text-steel/50 max-w-md mx-auto">
            Create a vault first or open one from the dashboard. This page no longer falls back to demo data.
          </p>
          <Link to="/create" className="inline-block mt-4">
            <ControlButton variant="gold">
              <ArrowUpToLine className="w-3.5 h-3.5" /> Create Vault
            </ControlButton>
          </Link>
        </GlassPanel>
      </div>
    );
  }

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
            <h1 className="text-2xl font-display font-semibold text-white tracking-tight">{vaultTitle}</h1>
            <StatusPill label={isPaused ? 'Paused' : 'Active'} variant={isPaused ? 'paused' : 'active'} pulse={!isPaused} />
            {navData && <StatusPill label="Pyth NAV" variant="gold" />}
            {showDemoVault && <StatusPill label="Demo Data" variant="gold" />}
          </div>
          <div className="flex items-center gap-4 text-[11px] font-mono text-steel/40">
            <span>{vaultAddress}</span>
            {vaultExplorerHref && (
              <ExplorerAnchor
                href={vaultExplorerHref}
                label="Explorer"
                className="text-cyan/60 hover:text-cyan transition-colors"
              />
            )}
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
              setExecutorForm(executorAddress || '');
              setShowExecutorModal(true);
            }}
          >
            <Shield className="w-3.5 h-3.5" /> Set Executor
          </ControlButton>
          <ControlButton
            variant="secondary"
            size="sm"
            disabled={!isConnected}
            onClick={() => {
              if (effectivePolicy) {
                setPolicyForm({
                  maxPositionBps: effectivePolicy.maxPositionBps,
                  maxDailyLossBps: effectivePolicy.maxDailyLossBps,
                  stopLossBps: effectivePolicy.stopLossBps || 1500,
                  cooldownSeconds: effectivePolicy.cooldownSeconds,
                  confidenceThresholdBps: effectivePolicy.confidenceThresholdBps,
                  maxActionsPerDay: effectivePolicy.maxActionsPerDay,
                  autoExecution: effectivePolicy.autoExecution,
                  paused: effectivePolicy.paused,
                  // Phase 1: preserve fees + recipient (use queueFeeChange to modify)
                  performanceFeeBps: effectivePolicy.performanceFeeBps || 0,
                  managementFeeBps: effectivePolicy.managementFeeBps || 0,
                  entryFeeBps: effectivePolicy.entryFeeBps || 0,
                  exitFeeBps: effectivePolicy.exitFeeBps || 0,
                  feeRecipient: effectivePolicy.feeRecipient || '0x0000000000000000000000000000000000000000',
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

      {showLiveTelemetryGuide && (
        <GlassPanel className="p-4 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 mb-2">
                <Cpu className="w-4 h-4 text-cyan/50" />
                <span className="text-sm font-display font-semibold text-white">Live vault detected, telemetry still warming up</span>
              </div>
              <p className="text-[11px] text-steel/50 leading-relaxed">
                The vault exists on-chain, but this page has not received fresh AI journal entries or stored NAV history yet.
                Connect the vault to your orchestrator executor and run a cycle to populate the live analytics panels below.
              </p>
              {vaultExplorerHref && (
                <ExplorerAnchor
                  href={vaultExplorerHref}
                  label={`Vault ${shortHexLabel(vaultAddress)}`}
                  className="mt-2 text-[10px] font-mono text-cyan/60 hover:text-cyan transition-colors"
                />
              )}
            </div>
            <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[10px] font-mono text-steel/40">
              Endpoint: {ORCHESTRATOR_URL || 'VITE_ORCHESTRATOR_URL not set'}
            </div>
          </div>
        </GlassPanel>
      )}

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
          value={sharpeRatio !== null ? sharpeRatio : '—'}
          subValue={maxDrawdown !== null ? `Max DD: ${maxDrawdown}%` : 'Awaiting history'}
          accent="text-white"
          icon={<TrendingDown className="w-4 h-4" />}
        />
      </div>

      {/* ── Main Grid ── */}
      <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
        {/* Left 2/3 */}
        <div className="lg:col-span-2 space-y-6">
          {/* Performance chart */}
          <div>
            <SectionLabel color="text-cyan/60">Performance</SectionLabel>
            <GlassPanel className="p-5">
              {!showDemoVault && navHistoryData.length === 0 && (
                <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-3 mb-4">
                  <p className="text-[11px] text-steel/50 leading-relaxed">
                    Historical NAV snapshots will appear here after the orchestrator stores recurring state updates for this vault.
                  </p>
                </div>
              )}
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
              </div>
              <NavChart height={220} data={navHistoryData} emptyLabel="NAV history will appear after journal snapshots accumulate." />
              <div className="mt-4 pt-3 border-t border-white/[0.04]">
                <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-2">Drawdown</span>
                <DrawdownChart height={100} data={drawdownHistoryData} emptyLabel="Drawdown history requires stored NAV snapshots." />
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
                {allocationData.length === 0 && (
                  <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center text-xs text-steel/40">
                    Allocation data is not available yet. Start the orchestrator and wait for a fresh NAV snapshot.
                  </div>
                )}
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
                        {action.source?.includes('0g-compute') && (
                          <span className="text-[8px] font-mono text-cyan/40 px-1 py-0.5 rounded bg-cyan/5 border border-cyan/10">0G Compute</span>
                        )}
                        {action.source?.includes('engine-v1') && (
                          <span className="text-[8px] font-mono text-gold/40 px-1 py-0.5 rounded bg-gold/5 border border-gold/10">Engine v1</span>
                        )}
                      </div>

                      {/* v1: Regime + scores */}
                      {action.regime && (
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${
                            action.regime?.includes('UP') ? 'text-emerald-soft/70 bg-emerald-soft/5 border-emerald-soft/10' :
                            action.regime?.includes('DOWN') || action.regime?.includes('PANIC') ? 'text-red-warn/60 bg-red-warn/5 border-red-warn/10' :
                            'text-steel/40 bg-white/[0.02] border-white/[0.05]'
                          }`}>{action.regime?.replace(/_/g, ' ')}</span>
                          {action.finalEdgeScore !== undefined && (
                            <span className="text-[9px] font-mono text-steel/35">Edge: {action.finalEdgeScore}</span>
                          )}
                          {action.tradeQualityScore !== undefined && (
                            <span className="text-[9px] font-mono text-steel/35">Q: {action.tradeQualityScore}</span>
                          )}
                        </div>
                      )}

                      {/* v1: Veto */}
                      {action.hardVeto && action.hardVetoReasons?.length > 0 && (
                        <div className="flex items-center gap-1 mb-1 flex-wrap">
                          {action.hardVetoReasons.map((r, ri) => (
                            <span key={ri} className="text-[8px] font-mono text-red-warn/40 px-1 py-0.5 rounded bg-red-warn/5 border border-red-warn/10">
                              {r.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      )}

                      <p className="text-[11px] text-steel/60 leading-relaxed mb-2">{action.reason}</p>
                      <div className="flex items-center gap-4 text-[10px] font-mono text-steel/40">
                        {action.timestamp && <span>{formatTime(action.timestamp)}</span>}
                        {action.asset && <span>{action.asset}</span>}
                        <span>Conf: {((action.confidence || 0) * 100).toFixed(0)}%</span>
                        <span>Risk: {((action.riskScore || 0) * 100).toFixed(0)}%</span>
                        {action.txHash && (
                          getExplorerTxHref(chainId, action.txHash) ? (
                            <ExplorerAnchor
                              href={getExplorerTxHref(chainId, action.txHash)}
                              label={shortHexLabel(action.txHash, 10, 6)}
                              className="text-cyan/50 hover:text-cyan transition-colors"
                            />
                          ) : (
                            <span className="text-cyan/40">{shortHexLabel(action.txHash, 10, 6)}</span>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </GlassPanel>
              ))}
              {journalEntries.length === 0 && (
                <GlassPanel className="p-6 border-dashed">
                  <div className="flex items-center gap-2 mb-2">
                    <Cpu className="w-5 h-5 text-steel/25" />
                    <span className="text-sm font-display font-semibold text-white">No AI journal entries yet</span>
                  </div>
                  <p className="text-[11px] text-steel/50 leading-relaxed">
                    This vault has not emitted a live decision or execution report since the current orchestrator session began.
                    Set the executor, start the backend, and run a cycle to populate this journal.
                  </p>
                </GlassPanel>
              )}
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
                          {evt.txHash && getExplorerTxHref(chainId, evt.txHash) && (
                            <ExplorerAnchor
                              href={getExplorerTxHref(chainId, evt.txHash)}
                              label={shortHexLabel(evt.txHash, 10, 6)}
                              className="text-[10px] font-mono text-cyan/50 hover:text-cyan transition-colors"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {riskTimelineEntries.length === 0 && (
                    <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-5 text-center">
                      <p className="text-sm text-steel/40">No risk timeline entries yet.</p>
                      <p className="text-[10px] text-steel/30 mt-1">
                        This timeline fills automatically once the orchestrator records policy checks, vetoes, and execution outcomes.
                      </p>
                    </div>
                  )}
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

          {/* Current Regime + AI Status (from orchestrator) */}
          {latestSignal ? (
            <div>
              <SectionLabel color="text-cyan/60">AI Agent Status</SectionLabel>
              <GlassPanel className="p-5">
                <div className="space-y-3">
                  {/* Regime */}
                  {latestSignal.regime && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-steel/50">Regime</span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                        latestSignal.regime?.includes('UP_STRONG') ? 'text-emerald-soft bg-emerald-soft/10 border-emerald-soft/20' :
                        latestSignal.regime?.includes('UP_WEAK') ? 'text-emerald-soft/70 bg-emerald-soft/5 border-emerald-soft/10' :
                        latestSignal.regime?.includes('DOWN') ? 'text-red-warn/80 bg-red-warn/10 border-red-warn/20' :
                        latestSignal.regime?.includes('PANIC') ? 'text-red-warn bg-red-warn/10 border-red-warn/30' :
                        'text-steel/60 bg-white/[0.03] border-white/[0.06]'
                      }`}>
                        {latestSignal.regime?.replace(/_/g, ' ')}
                      </span>
                    </div>
                  )}

                  {/* Edge Score */}
                  {latestSignal.final_edge_score !== undefined && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-steel/50">Edge Score</span>
                        <span className={`text-xs font-mono font-semibold ${
                          latestSignal.final_edge_score >= 72 ? 'text-emerald-soft' :
                          latestSignal.final_edge_score >= 58 ? 'text-amber-warn' : 'text-steel/60'
                        }`}>{latestSignal.final_edge_score}/100</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${
                          latestSignal.final_edge_score >= 72 ? 'bg-emerald-soft/60' :
                          latestSignal.final_edge_score >= 58 ? 'bg-amber-warn/60' : 'bg-steel/30'
                        }`} style={{ width: `${latestSignal.final_edge_score}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Trade Quality */}
                  {latestSignal.trade_quality_score !== undefined && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-steel/50">Trade Quality</span>
                        <span className={`text-xs font-mono font-semibold ${
                          latestSignal.trade_quality_score >= 78 ? 'text-emerald-soft' :
                          latestSignal.trade_quality_score >= 60 ? 'text-amber-warn' : 'text-steel/60'
                        }`}>{latestSignal.trade_quality_score}/100</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${
                          latestSignal.trade_quality_score >= 78 ? 'bg-emerald-soft/60' :
                          latestSignal.trade_quality_score >= 60 ? 'bg-amber-warn/60' : 'bg-steel/30'
                        }`} style={{ width: `${latestSignal.trade_quality_score}%` }} />
                      </div>
                    </div>
                  )}

                  {/* V1 Action */}
                  {latestSignal.v1_action && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-steel/50">Last Action</span>
                      <span className="text-[10px] font-mono text-white/60">{latestSignal.v1_action}</span>
                    </div>
                  )}

                  {latestSignal.approval_tier && latestSignal.approval_tier !== 'not_required' && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-steel/50">Approval Tier</span>
                      <StatusPill
                        label={latestSignal.approval_tier.replace(/_/g, ' ')}
                        variant={latestSignal.approval_tier === 'auto_execute' ? 'active' : 'warning'}
                      />
                    </div>
                  )}

                  {/* Hard Veto */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-steel/50">Hard Veto</span>
                    <StatusPill
                      label={latestSignal.hard_veto ? 'Active' : 'Clear'}
                      variant={latestSignal.hard_veto ? 'blocked' : 'active'}
                    />
                  </div>

                  {/* Veto Reasons */}
                  {latestSignal.hard_veto_reasons?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {latestSignal.hard_veto_reasons.map((r, i) => (
                        <span key={i} className="text-[8px] font-mono text-red-warn/40 px-1.5 py-0.5 rounded bg-red-warn/5 border border-red-warn/10">
                          {r.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}

                  {latestSignal.approval_reasons?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {latestSignal.approval_reasons.map((reason, i) => (
                        <span key={i} className="text-[8px] font-mono text-amber-warn/50 px-1.5 py-0.5 rounded bg-amber-warn/5 border border-amber-warn/10">
                          {reason.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Source */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                    <span className="text-[10px] text-steel/50">Source</span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                      latestSignal.source?.includes('0g-compute') ? 'text-cyan/60 bg-cyan/5 border border-cyan/10' : 'text-steel/40'
                    }`}>{latestSignal.source || 'unknown'}</span>
                  </div>
                </div>
              </GlassPanel>
            </div>
          ) : (
            <div>
              <SectionLabel color="text-cyan/60">AI Agent Status</SectionLabel>
              <GlassPanel className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Cpu className="w-4 h-4 text-steel/30" />
                  <span className="text-sm font-display font-semibold text-white">No live agent state yet</span>
                </div>
                <p className="text-[11px] text-steel/50 leading-relaxed mb-3">
                  Once the orchestrator completes its first successful cycle for this vault, the current regime, edge score,
                  veto status, and approval tier will appear here.
                </p>
                <div className="grid gap-2 text-[10px] font-mono text-steel/40">
                  <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                    <span className="mr-1">Executor set:</span>
                    {executorExplorerHref ? (
                      <ExplorerAnchor
                        href={executorExplorerHref}
                        label={shortHexLabel(executorAddress)}
                        className="text-cyan/60 hover:text-cyan transition-colors"
                      />
                    ) : (
                      <span>{executorAddress ? shortHexLabel(executorAddress) : 'missing'}</span>
                    )}
                  </div>
                  <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2">Orchestrator status: {orchStatus?.running ? 'running' : 'offline or not detected'}</div>
                </div>
              </GlassPanel>
            </div>
          )}

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
                <PolicyChip label="Sealed Mode" value={pol.sealedMode ? 'Enabled' : 'Off'} icon={<Lock className="w-3.5 h-3.5" />} />
              </div>
            </GlassPanel>
          </div>

          {/* ── Operator Fees ── */}
          {effectivePolicy && (effectivePolicy.performanceFeeBps || effectivePolicy.managementFeeBps || effectivePolicy.entryFeeBps || effectivePolicy.exitFeeBps || feeState?.accruedTotal > 0) && (
            <div>
              <SectionLabel color="text-gold/60">Operator Fees</SectionLabel>
              <GlassPanel className="p-5">
                {/* Fee schedule (read from policy) */}
                <div className="grid grid-cols-4 gap-1.5 mb-4">
                  <div className="rounded-md bg-gold/[0.04] border border-gold/15 px-2 py-1.5">
                    <div className="flex items-center gap-1 mb-0.5">
                      <TrendingUp className="w-2.5 h-2.5 text-gold/60" />
                      <span className="text-[8px] font-mono uppercase text-steel/45">Perf</span>
                    </div>
                    <div className="text-[11px] font-mono text-gold tabular-nums">
                      {formatBps(effectivePolicy.performanceFeeBps)}
                    </div>
                  </div>
                  <div className="rounded-md bg-cyan/[0.04] border border-cyan/15 px-2 py-1.5">
                    <div className="flex items-center gap-1 mb-0.5">
                      <Percent className="w-2.5 h-2.5 text-cyan/60" />
                      <span className="text-[8px] font-mono uppercase text-steel/45">Mgmt</span>
                    </div>
                    <div className="text-[11px] font-mono text-cyan tabular-nums">
                      {formatBps(effectivePolicy.managementFeeBps)}
                    </div>
                  </div>
                  <div className="rounded-md bg-white/[0.02] border border-white/[0.06] px-2 py-1.5">
                    <div className="flex items-center gap-1 mb-0.5">
                      <DollarSign className="w-2.5 h-2.5 text-steel/45" />
                      <span className="text-[8px] font-mono uppercase text-steel/45">Entry</span>
                    </div>
                    <div className="text-[11px] font-mono text-white/80 tabular-nums">
                      {formatBps(effectivePolicy.entryFeeBps)}
                    </div>
                  </div>
                  <div className="rounded-md bg-white/[0.02] border border-white/[0.06] px-2 py-1.5">
                    <div className="flex items-center gap-1 mb-0.5">
                      <DollarSign className="w-2.5 h-2.5 text-steel/45" />
                      <span className="text-[8px] font-mono uppercase text-steel/45">Exit</span>
                    </div>
                    <div className="text-[11px] font-mono text-white/80 tabular-nums">
                      {formatBps(effectivePolicy.exitFeeBps)}
                    </div>
                  </div>
                </div>

                {/* Live NAV + High Water Mark */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="rounded-md bg-white/[0.02] border border-white/[0.05] px-3 py-2">
                    <div className="text-[9px] font-mono uppercase text-steel/40 mb-0.5">Live NAV</div>
                    <div className="text-sm font-display font-semibold text-white tabular-nums">
                      ${liveNavUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="rounded-md bg-white/[0.02] border border-white/[0.05] px-3 py-2">
                    <div className="text-[9px] font-mono uppercase text-steel/40 mb-0.5">High Water Mark</div>
                    <div className="text-sm font-display font-semibold text-emerald-soft tabular-nums">
                      ${(feeState?.highWaterMark || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                {/* Accrued fees */}
                <div className="rounded-lg bg-gradient-to-br from-gold/[0.06] to-gold/[0.02] border border-gold/15 p-3 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-gold/70">Accrued Fees</span>
                    {feeState?.lastFeeAccrual ? (
                      <span className="text-[9px] font-mono text-steel/40">
                        Last: {new Date(feeState.lastFeeAccrual * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-[9px] font-mono uppercase text-steel/40">Mgmt</div>
                      <div className="text-[13px] font-display font-semibold text-cyan tabular-nums">
                        ${(feeState?.accruedManagement || 0).toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] font-mono uppercase text-steel/40">Perf</div>
                      <div className="text-[13px] font-display font-semibold text-gold tabular-nums">
                        ${(feeState?.accruedPerformance || 0).toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] font-mono uppercase text-steel/40">Total</div>
                      <div className="text-[13px] font-display font-semibold text-white tabular-nums">
                        ${(feeState?.accruedTotal || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Fee recipient */}
                {effectivePolicy.feeRecipient && effectivePolicy.feeRecipient !== '0x0000000000000000000000000000000000000000' && (
                  <div className="flex items-center justify-between text-[10px] font-mono mb-3 px-3 py-1.5 rounded bg-white/[0.02] border border-white/[0.04]">
                    <span className="text-steel/40">Fee Recipient</span>
                    {feeRecipientExplorerHref ? (
                      <ExplorerAnchor
                        href={feeRecipientExplorerHref}
                        label={shortHexLabel(effectivePolicy.feeRecipient)}
                        className="text-cyan/60 hover:text-cyan transition-colors"
                      />
                    ) : (
                      <span className="text-white/60">
                        {effectivePolicy.feeRecipient.slice(0, 8)}...{effectivePolicy.feeRecipient.slice(-6)}
                      </span>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <ControlButton
                    variant="secondary"
                    size="sm"
                    disabled={!isConnected || accruePending}
                    onClick={() => {
                      accrueFees(vaultAddr);
                      setTimeout(() => { refetchFees(); refetchNav(); }, 4000);
                    }}
                  >
                    <Hourglass className="w-3 h-3" />
                    {accruePending ? 'Accruing...' : 'Accrue Fees'}
                  </ControlButton>
                  <ControlButton
                    variant="gold"
                    size="sm"
                    disabled={
                      !isConnected ||
                      claimPending ||
                      !(feeState?.accruedTotal > 0) ||
                      !walletAddress ||
                      walletAddress.toLowerCase() !== (effectivePolicy.feeRecipient || '').toLowerCase()
                    }
                    onClick={() => {
                      claimFees(vaultAddr);
                      setTimeout(() => { refetchFees(); refetch(); }, 4000);
                    }}
                  >
                    <Wallet className="w-3 h-3" />
                    {claimPending ? 'Claiming...' : 'Claim Fees'}
                  </ControlButton>
                </div>

                {claimSuccess && (
                  <p className="text-[10px] text-emerald-soft/70 text-center mt-2">
                    Fees claimed · 80% to operator · 20% to protocol treasury
                  </p>
                )}
                {accrueSuccess && (
                  <p className="text-[10px] text-cyan/70 text-center mt-2">Fees accrued on-chain</p>
                )}

                {/* Pending fee change banner */}
                {feeState?.pendingFeeChange?.pending && (
                  <div className="mt-3 rounded-md bg-amber-warn/5 border border-amber-warn/15 px-3 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="w-3 h-3 text-amber-warn/70" />
                      <span className="text-[10px] font-mono text-amber-warn/80">Pending Fee Change</span>
                    </div>
                    <div className="text-[10px] text-steel/55 leading-relaxed">
                      New fees: Perf {formatBps(feeState.pendingFeeChange.newPerformanceFeeBps)} ·
                      Mgmt {formatBps(feeState.pendingFeeChange.newManagementFeeBps)} ·
                      Entry {formatBps(feeState.pendingFeeChange.newEntryFeeBps)} ·
                      Exit {formatBps(feeState.pendingFeeChange.newExitFeeBps)}
                    </div>
                    <div className="text-[9px] font-mono text-steel/40 mt-1">
                      Effective: {new Date(feeState.pendingFeeChange.effectiveAt * 1000).toLocaleString()}
                    </div>
                  </div>
                )}

                <p className="text-[9px] text-steel/35 mt-3 leading-relaxed">
                  Performance fees only charged on net new profit (above HWM). Management fee streams continuously.
                  All claimed fees split <strong className="text-white/55">80% operator · 20% treasury</strong>.
                </p>
              </GlassPanel>
            </div>
          )}

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
                  if (effectivePolicy) {
                    setPolicyForm({
                      maxPositionBps: effectivePolicy.maxPositionBps,
                      maxDailyLossBps: effectivePolicy.maxDailyLossBps,
                      stopLossBps: effectivePolicy.stopLossBps || 1500,
                      cooldownSeconds: effectivePolicy.cooldownSeconds,
                      confidenceThresholdBps: effectivePolicy.confidenceThresholdBps,
                      maxActionsPerDay: effectivePolicy.maxActionsPerDay,
                      autoExecution: effectivePolicy.autoExecution,
                      paused: effectivePolicy.paused,
                      // Phase 1: preserve fees + recipient (use queueFeeChange to modify)
                      performanceFeeBps: effectivePolicy.performanceFeeBps || 0,
                      managementFeeBps: effectivePolicy.managementFeeBps || 0,
                      entryFeeBps: effectivePolicy.entryFeeBps || 0,
                      exitFeeBps: effectivePolicy.exitFeeBps || 0,
                      feeRecipient: effectivePolicy.feeRecipient || '0x0000000000000000000000000000000000000000',
                    });
                  }
                  setShowPolicyModal(true);
                }}>
                  <Settings className="w-3.5 h-3.5" /> Edit Policy
                </ControlButton>

                {/* Set Executor */}
                <ControlButton
                  variant={executorMatchesActiveOrchestrator ? 'secondary' : 'gold'}
                  className="w-full"
                  disabled={!isConnected}
                  onClick={() => {
                    setExecutorForm(activeOrchestratorExecutor || executorAddress || '');
                    setShowExecutorModal(true);
                  }}
                >
                  <Cpu className="w-3.5 h-3.5" />
                  {executorMatchesActiveOrchestrator ? 'Executor Linked' : 'Set Executor'}
                </ControlButton>

                {/* Export Journal */}
                <ControlButton variant="secondary" className="w-full" onClick={() => {
                  const data = journalData || decisionData || [];
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
              {executorSuccess && <p className="text-[10px] text-emerald-soft/70 text-center mt-2">Executor updated on-chain</p>}
              {recentVaultTxs.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/[0.05]">
                  <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-cyan/70 mb-2">
                    Latest Wallet Transactions
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {recentVaultTxs.map((tx) => (
                      <ExplorerAnchor
                        key={tx.href}
                        href={tx.href}
                        label={`${tx.label} · ${shortHexLabel(tx.hash, 10, 6)}`}
                        className="text-[10px] font-mono text-cyan/60 hover:text-cyan transition-colors"
                      />
                    ))}
                  </div>
                </div>
              )}
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

          {/* ── Set Executor Modal ── */}
          {showExecutorModal && (
            <GlassPanel className="p-5">
              <h4 className="text-sm font-display font-semibold text-white mb-2">Set Vault Executor</h4>
              <p className="text-[11px] text-steel/45 mb-4">
                Point this vault to the wallet used by your orchestrator. The owner keeps custody, while the executor only submits intents that still pass on-chain policy checks.
              </p>
              <div className="space-y-3">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3 space-y-2">
                  <div className="flex justify-between gap-3">
                    <span className="text-[11px] text-steel/50">Current Executor</span>
                    <span className="text-[11px] font-mono text-white/70">{executorAddress}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[11px] text-steel/50">Active API Executor</span>
                    <span className="text-[11px] font-mono text-cyan/60">{activeOrchestratorExecutor || 'Not detected'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[11px] text-steel/50">Sync Status</span>
                    <StatusPill
                      label={executorMatchesActiveOrchestrator ? 'Matched' : activeOrchestratorExecutor ? 'Different' : 'Offline'}
                      variant={executorMatchesActiveOrchestrator ? 'active' : activeOrchestratorExecutor ? 'warning' : 'paused'}
                    />
                  </div>
                </div>

                {activeOrchestratorExecutor && (
                  <ControlButton
                    variant="gold"
                    className="w-full"
                    onClick={() => setExecutorForm(activeOrchestratorExecutor)}
                  >
                    Use Active Orchestrator Wallet
                  </ControlButton>
                )}

                {/* Marketplace operators */}
                {activeMarketplaceOps.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-mono text-steel/40">Pick from Marketplace ({activeMarketplaceOps.length})</label>
                      <Link to="/marketplace" className="text-[10px] text-cyan/50 hover:text-cyan">Browse all →</Link>
                    </div>
                    <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                      {activeMarketplaceOps.map((op) => {
                        const selected = executorForm.toLowerCase() === op.wallet.toLowerCase();
                        return (
                          <button
                            key={op.wallet}
                            type="button"
                            onClick={() => setExecutorForm(op.wallet)}
                            className={`w-full text-left px-2.5 py-2 rounded-md border transition-all ${
                              selected
                                ? 'border-gold/30 bg-gold/5'
                                : 'border-white/[0.05] bg-white/[0.02] hover:border-white/[0.1]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <Cpu className="w-3 h-3 text-gold/50 flex-shrink-0" />
                                <span className="text-[11px] font-display font-medium text-white truncate">{op.name}</span>
                                <span className="text-[8px] font-mono text-steel/45 px-1 py-0.5 rounded bg-white/[0.03] border border-white/[0.06]">
                                  {op.mandateLabel}
                                </span>
                              </div>
                            </div>
                            <div className="text-[9px] font-mono text-steel/35 mt-0.5 truncate">{op.wallet}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-mono text-steel/40 block mb-1">Executor Address</label>
                  <input
                    type="text"
                    value={executorForm}
                    onChange={(e) => setExecutorForm(e.target.value.trim())}
                    placeholder="0x..."
                    spellCheck="false"
                    className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md px-3 py-2
                      text-sm font-mono text-white
                      focus:outline-none focus:border-gold/30 transition-colors"
                  />
                  <p className="mt-2 text-[11px] text-steel/45">
                    Run your self-hosted orchestrator with the matching `PRIVATE_KEY`, then update the vault executor to the same public address.
                  </p>
                </div>

                {!isAddress(executorForm || '') && executorForm && (
                  <p className="text-[11px] text-red-warn/70">Enter a valid EVM address.</p>
                )}

                <div className="flex gap-2 pt-2">
                  <ControlButton
                    variant="primary"
                    className="flex-1"
                    disabled={!hasLive || !isAddress(executorForm || '') || executorForm.toLowerCase() === liveVault.executor.toLowerCase() || executorPending}
                    onClick={() => {
                      setExecutor(vaultAddr, executorForm);
                      setTimeout(() => { setShowExecutorModal(false); refetch(); }, 3000);
                    }}
                  >
                    {executorPending ? 'Updating...' : 'Update Executor'}
                  </ControlButton>
                  <ControlButton variant="secondary" className="flex-1" onClick={() => setShowExecutorModal(false)}>
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
                      // Build full policy struct preserving fee fields (fees changed via queueFeeChange)
                      const fullPolicy = {
                        maxPositionBps: BigInt(policyForm.maxPositionBps || 0),
                        maxDailyLossBps: BigInt(policyForm.maxDailyLossBps || 0),
                        stopLossBps: BigInt(policyForm.stopLossBps || 0),
                        cooldownSeconds: BigInt(policyForm.cooldownSeconds || 0),
                        confidenceThresholdBps: BigInt(policyForm.confidenceThresholdBps || 0),
                        maxActionsPerDay: BigInt(policyForm.maxActionsPerDay || 0),
                        autoExecution: !!policyForm.autoExecution,
                        paused: !!policyForm.paused,
                        performanceFeeBps: BigInt(policyForm.performanceFeeBps || 0),
                        managementFeeBps: BigInt(policyForm.managementFeeBps || 0),
                        entryFeeBps: BigInt(policyForm.entryFeeBps || 0),
                        exitFeeBps: BigInt(policyForm.exitFeeBps || 0),
                        feeRecipient: policyForm.feeRecipient || '0x0000000000000000000000000000000000000000',
                      };
                      updatePolicy(vaultAddr, fullPolicy);
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
                <span className="text-steel/50">API Executor</span>
                <span className="font-mono text-white/50">
                  {activeOrchestratorExecutor
                    ? `${activeOrchestratorExecutor.slice(0, 8)}...${activeOrchestratorExecutor.slice(-6)}`
                    : 'Not detected'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-steel/50">Executor Sync</span>
                <span className={`font-mono ${executorMatchesActiveOrchestrator ? 'text-emerald-soft/70' : 'text-amber-warn/70'}`}>
                  {executorMatchesActiveOrchestrator ? 'Matched' : activeOrchestratorExecutor ? 'Different' : 'Offline'}
                </span>
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
