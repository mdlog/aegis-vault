import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAccount, useBalance, useChainId } from 'wagmi';
import { formatUnits, isAddress } from 'viem';
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
import {
  doesExecutorMatchOrchestrator,
  formatOrchestratorExecutorSummary,
  getOrchestratorExecutorAddresses,
  getPrimaryOrchestratorExecutor,
} from '../lib/orchestratorStatus';
import {
  useVaultSummary, useVaultPolicy, usePause, useUnpause, useWithdraw, useApprove,
  useDeposit, useUpdatePolicy, useTokenBalance, useVaultList, useTransferToken,
  useSetExecutor, useTokenDecimals, useWrapNative,
  useVaultVersion, useWithdrawToken, useWithdrawAllNonBase, useVaultAssetBalances,
  vaultSupportsMultiAssetWithdraw,
} from '../hooks/useVault';
import { useOperatorList, useOperator, useIsRegistered } from '../hooks/useOperatorRegistry';
import {
  useMultiAssetNAV, useOrchestratorStatus, useDecisions, useJournal, useExecutions,
} from '../hooks/useOrchestrator';
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
  useVaultFeeState, useVaultNav, useClaimFees, useAccrueFees, formatBps,
} from '../hooks/useVaultFees';
import ControlButton from '../components/ui/ControlButton';
import CrossChainDepositCard from '../components/dashboard/CrossChainDepositCard';
import V4ManifestPanel from '../components/dashboard/V4ManifestPanel';
import TokenIcon from '../components/ui/TokenIcon';
import PerformanceChart from '../components/charts/PerformanceChart';
import {
  EyebrowMono as Eyebrow,
  StatusDot,
  ToneChip as Chip,
  TokenAvatar,
  GhostNumeral,
  RiskGauge,
  SectionHead,
} from '../components/editorial/atoms';
import { cx, ACCENTS } from '../components/editorial/tokens';
import {
  Shield, ShieldCheck, AlertTriangle, ArrowLeft, Check, CheckCircle, Copy,
  Cpu, Download, ExternalLink, Hourglass, Layers, PauseCircle, PlayCircle, Plus,
  RefreshCw, Settings, Sparkles, TrendingUp, Wallet, X, Zap,
} from 'lucide-react';

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Parse journal timestamp (accepts ISO string, ms, or seconds-since-epoch).
function parseTs(ts) {
  if (!ts) return null;
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Hour:minute in the viewer's local timezone with short tz abbreviation
// (e.g. "09:50 WIB"). We only ever display local time in the feed so users
// don't have to reconcile two clocks against the orchestrator log.
function formatLocalTime(ts) {
  const d = parseTs(ts);
  if (!d) return '—';
  const hhmm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const abbr = (() => {
    try {
      const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d);
      return parts.find((p) => p.type === 'timeZoneName')?.value || '';
    } catch {
      return '';
    }
  })();
  return abbr ? `${hhmm} ${abbr}` : hhmm;
}

const ASSET_COLORS = { USDC: '#2775ca', WBTC: '#f7931a', WETH: '#627eea', BTC: '#f7931a', ETH: '#627eea' };

export default function VaultDetailPage() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const { vaultAddress: routeVaultAddress } = useParams();
  const navigate = useNavigate();

  const { vaults: myVaults, isLoading: myVaultsLoading } = useVaultList(deployments.aegisVaultFactory, address);

  // Guard: a connected wallet must not view a vault it does not own. If the
  // URL was carried over from a previous wallet session, redirect to this
  // wallet's first vault (or back to the dashboard if it owns none).
  useEffect(() => {
    if (!isConnected || myVaultsLoading || !routeVaultAddress) return;
    const owned = myVaults.some(
      (v) => v.address?.toLowerCase() === routeVaultAddress.toLowerCase()
    );
    if (owned) return;
    const first = myVaults[0]?.address;
    navigate(first ? `/app/vault/${first}` : '/app', { replace: true });
  }, [isConnected, myVaultsLoading, routeVaultAddress, myVaults, navigate]);

  const vaultAddr = routeVaultAddress || myVaults[0]?.address || getDefaultVaultAddress(chainId);
  const { operators: marketplaceOps } = useOperatorList(deployments.operatorRegistryV2 || deployments.operatorRegistry);
  const activeMarketplaceOps = marketplaceOps.filter((op) => op.loaded && op.active);

  // Two-step decimals resolution so balance/totalDeposited format correctly for non-USDC assets.
  const { data: vaultProbe } = useVaultSummary(vaultAddr, 6);
  const { decimals: baseDecimals } = useTokenDecimals(vaultProbe?.baseAsset);
  const resolvedDecimals = baseDecimals ?? 6;
  const { data: liveVault, refetch } = useVaultSummary(vaultAddr, resolvedDecimals);
  const { data: livePolicy } = useVaultPolicy(vaultAddr);
  // v2 detection + per-asset balances inside the vault (used by the multi-
  // asset withdraw UI on v2 vaults; no-op on v1 vaults since the rescue
  // functions don't exist there).
  const { version: vaultVersion } = useVaultVersion(vaultAddr);
  const { assets: vaultAssetRows } = useVaultAssetBalances(vaultAddr);

  const executorAddr = liveVault?.executor;
  const { data: executorRegistered } = useIsRegistered((deployments.operatorRegistryV2 || deployments.operatorRegistry), executorAddr);
  const { data: executorOpData } = useOperator((deployments.operatorRegistryV2 || deployments.operatorRegistry), executorRegistered ? executorAddr : undefined);
  const executorIsInactive = executorAddr && executorRegistered === false
    ? { reason: 'unregistered', label: 'Vault executor is not (or no longer) registered as an operator.' }
    : executorAddr && executorOpData && executorOpData.active === false
      ? { reason: 'inactive', label: `Operator "${executorOpData.name}" is currently INACTIVE — trades will not execute until reactivated.` }
      : null;

  const { data: navData } = useMultiAssetNAV(vaultAddr);
  const { data: orchStatus } = useOrchestratorStatus();
  const { data: liveDecisions } = useDecisions(10, { vaultAddress: vaultAddr });
  const { data: journalData } = useJournal(100, { vaultAddress: vaultAddr });
  const { data: liveExecutions } = useExecutions(20, { vaultAddress: vaultAddr });
  const demoVault = ENABLE_DEMO_FALLBACKS ? getDemoVaultByAddress(vaultAddr) : null;
  const showDemoVault = ENABLE_DEMO_FALLBACKS && !liveVault && !!demoVault;

  // Contract write hooks
  const { pause, hash: pauseHash, isPending: pausePending } = usePause();
  const { unpause, hash: unpauseHash, isPending: unpausePending } = useUnpause();
  const { withdraw, hash: withdrawHash, isPending: withdrawPending, isSuccess: withdrawSuccess } = useWithdraw();
  // v2 rescue paths — only wired up in the modal when vault.version === 'v2'
  const { withdrawToken, isPending: withdrawTokenPending } = useWithdrawToken();
  const { withdrawAllNonBase, isPending: withdrawAllPending } = useWithdrawAllNonBase();
  const { approve, hash: approveHash, isPending: approvePending, isSuccess: approveSuccess } = useApprove();
  const { deposit, hash: depositHash, isPending: depositPending, isSuccess: depositSuccess } = useDeposit();
  const { transfer: transferToken, hash: transferHash, isPending: transferPending, isSuccess: transferSuccess } = useTransferToken();
  const { wrap: wrapNative, hash: wrapHash, isPending: wrapPending, isSuccess: wrapSuccess, reset: resetWrap } = useWrapNative();
  const { updatePolicy, hash: policyHash, isPending: policyPending, isSuccess: policySuccess } = useUpdatePolicy();
  const { setExecutor, hash: executorHash, isPending: executorPending, isSuccess: executorSuccess } = useSetExecutor();

  // Fees
  const { state: feeState, refetch: refetchFees } = useVaultFeeState(vaultAddr, 6);
  const { navUsd: liveNavUsd, refetch: refetchNav } = useVaultNav(vaultAddr, 6);
  const { claim: claimFees, hash: claimHash, isPending: claimPending, isSuccess: claimSuccess } = useClaimFees();
  const { accrue: accrueFees, hash: accrueHash, isPending: accruePending, isSuccess: accrueSuccess } = useAccrueFees();

  // Wallet balances — reuse the `address` already destructured above from
  // useAccount (line 97) instead of re-calling the hook, so both the UI
  // guards and the balance queries see the same reference.
  const walletAddress = address;
  const { balance: walletUsdcBalance } = useTokenBalance(deployments.mockUSDC, walletAddress, 6);
  const { balance: walletWbtcBalance } = useTokenBalance(deployments.mockWBTC, walletAddress, 8);
  const { balance: walletWethBalance } = useTokenBalance(deployments.mockWETH, walletAddress, 18);
  const { balance: walletW0gBalance, refetch: refetchW0g } = useTokenBalance(deployments.W0G, walletAddress, 18);
  // Native 0G (non-ERC20). W0G.deposit() wraps native → W0G 1:1 so we surface
  // both balances for the 0G tab and auto-wrap when the user's W0G is short.
  // Pass chainId explicitly so wagmi doesn't silently bind the query to the
  // wrong chain right after a network switch (which caused stale/zero reads
  // even though the native balance was visible in the wallet dropdown).
  const { data: nativeBalance, refetch: refetchNative } = useBalance({
    address: walletAddress,
    chainId,
    query: { enabled: !!walletAddress, refetchInterval: 10000 },
  });
  // Prefer .formatted; fall back to formatting the raw value ourselves if
  // wagmi hasn't populated formatted yet (seen during the first render after
  // the query resolves on slower RPCs).
  const walletNativeFormatted = nativeBalance?.formatted
    ?? (nativeBalance?.value != null
        ? formatUnits(nativeBalance.value, nativeBalance.decimals ?? 18)
        : '0');

  // 0G is only on chain 16661 (0G mainnet). On other chains (hardhat, Arbitrum)
  // `deployments.W0G` is empty, so filter it out to avoid a non-functional tab.
  //
  // `isBase` is derived dynamically by comparing each token's address to the
  // vault's actual baseAsset. This lets non-USDC vaults (W0G-base, WBTC-base,
  // etc.) route through the proper approve → deposit flow instead of falling
  // back to bare transfer (which skips totalDeposited / entry fee accounting).
  const baseAssetAddrLc = liveVault?.baseAsset?.toLowerCase();
  const isBaseToken = (addr) => !!addr && !!baseAssetAddrLc && addr.toLowerCase() === baseAssetAddrLc;
  const depositTokens = [
    { symbol: 'USDC', address: deployments.mockUSDC, decimals: 6, balance: walletUsdcBalance, isBase: isBaseToken(deployments.mockUSDC) },
    { symbol: 'WBTC', address: deployments.mockWBTC, decimals: 8, balance: walletWbtcBalance, isBase: isBaseToken(deployments.mockWBTC) },
    { symbol: 'WETH', address: deployments.mockWETH, decimals: 18, balance: walletWethBalance, isBase: isBaseToken(deployments.mockWETH) },
    ...(deployments.W0G
      ? [{
          symbol: '0G',
          address: deployments.W0G,
          decimals: 18,
          // Effective spendable balance = W0G + native (auto-wrap covers the gap).
          balance: String(parseFloat(walletW0gBalance || '0') + parseFloat(walletNativeFormatted || '0')),
          wrappedBalance: walletW0gBalance,
          nativeBalance: walletNativeFormatted,
          isBase: isBaseToken(deployments.W0G),
          needsWrap: true,
        }]
      : []),
  ];

  // UI state (preserved 1:1 with prior behaviour)
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [selectedDepositToken, setSelectedDepositToken] = useState(depositTokens[0]);
  const [depositStep, setDepositStep] = useState('input');
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [showExecutorModal, setShowExecutorModal] = useState(false);
  const [executorForm, setExecutorForm] = useState('');
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [policyForm, setPolicyForm] = useState(null);

  // Inline rail ticket
  const [ticketTab, setTicketTab] = useState('deposit');
  // Selected token for withdraw tab (separate from deposit — v2 vaults allow
  // withdrawing any token the vault holds, base or rescue).
  const [ticketWithdrawSymbol, setTicketWithdrawSymbol] = useState(null);
  const [ticketAmount, setTicketAmount] = useState('');
  const [ticketTokenSymbol, setTicketTokenSymbol] = useState('USDC');
  const [addressCopied, setAddressCopied] = useState(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

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
  const cycleCount = orchStatus?.cycleCount || 0;

  const hasRealReturn = (hasLive || showDemoVault) && totalDeposited > 0;
  const allTimeReturnPct = hasRealReturn ? ((nav - totalDeposited) / totalDeposited) * 100 : 0;
  const allTimeReturnUsd = hasRealReturn ? nav - totalDeposited : 0;
  const returnIsPositive = allTimeReturnPct >= 0;

  const realizedPnl = executionData.length > 0
    ? executionData.reduce((sum, ex) => sum + (ex.pnl || 0), 0)
    : 0;
  const pnlRealized = realizedPnl;
  const pnlUnrealized = hasRealReturn ? nav - totalDeposited - realizedPnl : 0;

  let riskScore = 0;
  let riskLevel = 'Unknown';
  if (navSnapshot?.breakdown) {
    let score = 0;
    const maxPct = Math.max(...navSnapshot.breakdown.map((a) => a.pct || 0));
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
  const riskTone = riskScore === 0 ? 'cyan' : riskScore < 30 ? 'emerald' : riskScore < 60 ? 'amber' : 'rose';

  const pol = effectivePolicy || {
    maxPositionPct: 0, maxDailyLossPct: 0, stopLossPct: 0, cooldownSeconds: 0,
    confidenceThresholdPct: 0, maxActionsPerDay: 0, autoExecution: false, paused: false,
  };
  const mandateType = showDemoVault
    ? demoVault.mandate
    : !effectivePolicy
      ? 'Unknown'
      : pol.maxPositionPct <= 30 ? 'Defensive'
      : pol.maxPositionPct <= 50 ? 'Balanced'
      : 'Tactical';
  const mandateChipTone =
    mandateType === 'Defensive' ? 'cyan' :
    mandateType === 'Tactical'  ? 'rose' :
    mandateType === 'Balanced'  ? 'emerald' :
                                  'steel';

  // NAV history (journal-derived). `cycle` = scheduled orchestrator snapshot
  // every N minutes. `balance_change` = deposit/withdraw listener snapshot on
  // the backend (same vaultResults shape) — fills the gap between cycles so
  // the chart reflects a deposit the moment the tx lands on-chain.
  const derivedNavHistory = (journalData || [])
    .filter((e) => (e.type === 'cycle' || e.type === 'balance_change') && Array.isArray(e.vaultResults))
    .flatMap((e) => {
      const r = e.vaultResults.find((v) => v.vault?.toLowerCase() === vaultAddr?.toLowerCase());
      if (!r || !r.vaultState?.nav) return [];
      const t = new Date(e.timestamp);
      let date; let fullLabel;
      if (Number.isNaN(t.getTime())) { date = String(e.timestamp); fullLabel = String(e.timestamp); }
      else {
        date = t.toLocaleString(undefined, { month: 'short', day: 'numeric' });
        fullLabel = t.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      }
      return [{ date, fullLabel, timestamp: e.timestamp, nav: parseFloat(r.vaultState.nav) || 0 }];
    })
    .reverse();
  const navHistoryData = showDemoVault ? demoNavHistory : derivedNavHistory;

  const derivedDrawdownHistory = (() => {
    if (!derivedNavHistory.length) return [];
    const MIN_MEANINGFUL_NAV = 0.01;
    let peak = Number.isFinite(derivedNavHistory[0].nav) ? derivedNavHistory[0].nav : 0;
    return derivedNavHistory.map((p) => {
      const n = Number.isFinite(p.nav) ? p.nav : 0;
      if (n > peak) peak = n;
      let dd = 0;
      if (peak > MIN_MEANINGFUL_NAV) dd = ((n - peak) / peak) * 100;
      dd = Math.max(-100, Math.min(0, dd));
      return { date: p.date, fullLabel: p.fullLabel, dd };
    });
  })();
  const drawdownHistoryData = showDemoVault ? demoDrawdownHistory : derivedDrawdownHistory;

  const derivedPnLHistory = derivedNavHistory.map((p) => {
    const pnl = p.nav - totalDeposited;
    return {
      date: p.date, fullLabel: p.fullLabel, pnl,
      pnlPos: pnl >= 0 ? pnl : 0, pnlNeg: pnl < 0 ? pnl : 0,
    };
  });
  const demoPnLHistory = showDemoVault
    ? demoNavHistory.map((p) => {
        const pnl = p.nav - demoVault.deposited;
        return { date: p.date, fullLabel: p.fullLabel || p.date, pnl, pnlPos: pnl >= 0 ? pnl : 0, pnlNeg: pnl < 0 ? pnl : 0 };
      })
    : [];
  const pnlHistoryData = showDemoVault ? demoPnLHistory : derivedPnLHistory;

  const allocationData = navSnapshot?.breakdown
    ? navSnapshot.breakdown.map((a) => ({
        asset: a.symbol, symbol: a.symbol, amount: a.balance,
        value: a.valueUsd, pct: a.pct,
        color: ASSET_COLORS[a.symbol] || '#8a8a9a',
      }))
    : [];

  // Decisions feed. Orchestrator writes decision and execution as two separate
  // journal entries in the same cycle (decision first, execution a few seconds
  // later after the tx mines). Decisions don't carry `txHash` directly — join
  // to the nearest matching execution by (vault, action, asset) within a short
  // window so the row can link out to the explorer instead of saying
  // "On-chain pending" forever.
  const findMatchingExecution = (decision) => {
    if (!decision || decision.action === 'hold') return null;
    const rawAction = (decision.action || '').toLowerCase();
    const asset = decision.asset;
    const tDecision = new Date(decision.timestamp || 0).getTime();
    if (!tDecision) return null;
    return executionData.find((ex) => {
      if ((ex.action || '').toLowerCase() !== rawAction) return false;
      if (ex.asset && asset && ex.asset !== asset) return false;
      const tExec = new Date(ex.timestamp || 0).getTime();
      if (!tExec) return false;
      // Execution lands after decision within 5 min (generous for slow mining).
      return tExec >= tDecision - 2_000 && tExec <= tDecision + 5 * 60_000;
    }) || null;
  };

  const journalEntries = decisionData.length > 0
    ? decisionData.map((d, i) => {
        const match = findMatchingExecution(d);
        return {
          id: d.id || `live-${i}`,
          action: `${(d.action || '').toUpperCase()} ${d.asset || ''}`,
          rawAction: (d.action || '').toLowerCase(),
          asset: d.asset,
          outcome: d.action === 'hold' ? 'skipped' : (match?.success === false ? 'failed' : match ? 'executed' : 'pending'),
          reason: d.reason || '',
          timestamp: d.timestamp,
          confidence: d.confidence || 0,
          riskScore: d.risk_score || 0,
          txHash: match?.txHash || null,
          source: d.source || 'orchestrator',
          regime: d.regime,
          v1Action: d.v1_action,
          finalEdgeScore: d.final_edge_score,
          tradeQualityScore: d.trade_quality_score,
          hardVeto: d.hard_veto,
          hardVetoReasons: d.hard_veto_reasons,
          entryTrigger: d.entry_trigger,
          fill: d.fill || null,
          pnl: d.pnl ?? null,
        };
      })
    : [];

  const decisionCounts = journalEntries.reduce(
    (acc, e) => {
      const a = e.rawAction;
      if (a === 'hold') acc.hold += 1;
      else if (a === 'buy') acc.buy += 1;
      else if (a === 'sell') acc.sell += 1;
      else acc.other += 1;
      return acc;
    },
    { hold: 0, buy: 0, sell: 0, other: 0 },
  );

  // Recent actions journal
  const hasRealTimeline = journalData && journalData.length > 0;
  const recentActions = hasRealTimeline
    ? journalData.slice(0, 8).map((entry, i) => {
        const kind = entry.type === 'policy_check'
          ? (entry.valid ? 'SIGNED' : 'CHECKED')
          : entry.type === 'execution'
            ? (entry.success ? 'SIGNED' : 'ROTATED')
            : entry.type === 'decision'
              ? (entry.action === 'hold' ? 'CHECKED' : 'SIGNED')
              : entry.type === 'cycle' ? 'SIGNED' : 'CHECKED';
        return {
          id: entry.id || `act-${i}`,
          kind,
          timestamp: entry.timestamp,
          txHash: entry.txHash || null,
        };
      })
    : showDemoVault ? demoRiskTimelineEntries.slice(0, 8).map((entry, i) => ({
        id: entry.id || `demo-${i}`,
        kind: entry.type === 'blocked' ? 'ROTATED' : entry.type === 'skip' ? 'CHECKED' : 'SIGNED',
        timestamp: entry.timestamp,
        txHash: entry.txHash || null,
      })) : [];

  const vaultAddress = hasLive ? vaultAddr : showDemoVault ? demoVault.address : (vaultAddr || '');
  const executorAddress = hasLive ? liveVault.executor : showDemoVault ? demoVault.executor : '';
  const activeOrchestratorExecutors = getOrchestratorExecutorAddresses(orchStatus);
  const activeOrchestratorExecutor = getPrimaryOrchestratorExecutor(orchStatus);
  const activeOrchestratorExecutorSummary = formatOrchestratorExecutorSummary(orchStatus);
  const executorMatchesActiveOrchestrator = doesExecutorMatchOrchestrator(orchStatus, executorAddress);
  const executorSyncLabel = executorMatchesActiveOrchestrator
    ? 'Matched'
    : activeOrchestratorExecutors.length > 0 ? 'Different' : 'Offline';
  const executorSyncTone = executorMatchesActiveOrchestrator
    ? 'emerald' : activeOrchestratorExecutors.length > 0 ? 'amber' : 'steel';

  const networkName = showDemoVault
    ? demoVault.network
    : chainId === 16661 ? '0G Aristotle Mainnet' : getNetworkLabel(chainId);
  const vaultExplorerHref = getExplorerAddressHref(chainId, vaultAddress);
  const executorExplorerHref = getExplorerAddressHref(chainId, executorAddress);
  const feeRecipientExplorerHref = getExplorerAddressHref(chainId, effectivePolicy?.feeRecipient);
  const showLiveTelemetryGuide = !showDemoVault && !latestSignal && !hasRealTimeline;

  const vaultTitle = showDemoVault
    ? demoVault.name
    : vaultAddress
    ? `${vaultAddress.slice(0, 6)}…${vaultAddress.slice(-4)}`
    : 'No Vault Selected';
  const vaultAvatarSymbol = vaultAddress ? vaultAddress.slice(2, 4).toUpperCase() : 'VT';

  const recentVaultTxs = [
    { label: isPaused ? 'Resume vault' : 'Pause vault', hash: pauseHash || unpauseHash },
    { label: 'Approve deposit', hash: approveHash },
    { label: 'Deposit base asset', hash: depositHash },
    { label: 'Wrap native 0G', hash: wrapHash },
    { label: 'Transfer vault asset', hash: transferHash },
    { label: 'Withdraw', hash: withdrawHash },
    { label: 'Update policy', hash: policyHash },
    { label: 'Set executor', hash: executorHash },
    { label: 'Accrue fees', hash: accrueHash },
    { label: 'Claim fees', hash: claimHash },
  ].map((item) => ({ ...item, href: getExplorerTxHref(chainId, item.hash) }))
   .filter((item) => item.href);

  if (!vaultAddr) {
    return (
      <div className="max-w-3xl mx-auto px-4 lg:px-6 py-12">
        <div className="rounded-2xl p-8 text-center" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
          <Shield className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--ed-steel-500)' }} />
          <h1 className="ed-display text-[22px] mb-2" style={{ color: 'var(--ed-steel-50)' }}>No Vault Selected</h1>
          <p className="text-sm" style={{ color: 'var(--ed-steel-400)' }}>
            Create a vault first or open one from the dashboard. This page no longer falls back to demo data.
          </p>
          <Link to="/create" className="inline-block mt-4">
            <ControlButton variant="gold">
              <Plus className="w-3.5 h-3.5" /> Create Vault
            </ControlButton>
          </Link>
        </div>
      </div>
    );
  }

  // Handlers
  const handlePause = () => {
    if (isPaused) { unpause(vaultAddr); } else { pause(vaultAddr); }
    setTimeout(() => refetch(), 3000);
  };

  const handleCopy = (key, value) => {
    navigator.clipboard?.writeText?.(value || '');
    setAddressCopied(key);
    setTimeout(() => setAddressCopied(null), 1500);
  };

  const openPolicyModal = () => {
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
        performanceFeeBps: effectivePolicy.performanceFeeBps || 0,
        managementFeeBps: effectivePolicy.managementFeeBps || 0,
        entryFeeBps: effectivePolicy.entryFeeBps || 0,
        exitFeeBps: effectivePolicy.exitFeeBps || 0,
        feeRecipient: effectivePolicy.feeRecipient || '0x0000000000000000000000000000000000000000',
      });
    }
    setShowPolicyModal(true);
  };

  const openDepositModal = () => {
    setDepositAmount('');
    setDepositStep('input');
    setShowDepositModal(true);
  };

  const openWithdrawModal = () => {
    setWithdrawAmount('');
    setShowWithdrawModal(true);
  };

  const openExecutorModal = () => {
    setExecutorForm(
      executorMatchesActiveOrchestrator
        ? executorAddress
        : activeOrchestratorExecutor || executorAddress || '',
    );
    setShowExecutorModal(true);
  };

  const ticketToken = depositTokens.find((t) => t.symbol === ticketTokenSymbol) || depositTokens[0];

  const handleTicketSubmit = () => {
    const amount = ticketAmount.trim();
    if (!amount || Number(amount) <= 0) return;
    if (ticketTab === 'deposit') {
      setDepositAmount(amount);
      setSelectedDepositToken(ticketToken);
      setDepositStep('approve');
      setShowDepositModal(true);
    } else {
      setWithdrawAmount(amount);
      // For v2 non-base withdraw, WithdrawModal reads `initialWithdrawSymbol`
      // prop to pre-select the same token the user chose in the ticket.
      setShowWithdrawModal(true);
    }
  };

  const handleExportJournal = () => {
    const data = journalData || decisionData || [];
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aegis-vault-journal-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Withdraw tab: per-token balance inside the vault (v2/v3) or base asset
  // balance (v1). Reads from vaultAssetRows when a non-base token is picked.
  const selectedWithdrawRow = vaultSupportsMultiAssetWithdraw(vaultVersion) && ticketWithdrawSymbol
    ? vaultAssetRows.find((row) => {
        const meta = depositTokens.find((t) => t.address?.toLowerCase() === row.address?.toLowerCase());
        return meta?.symbol === ticketWithdrawSymbol;
      })
    : null;
  const selectedWithdrawMeta = depositTokens.find((t) => t.symbol === ticketWithdrawSymbol);
  const withdrawTokenBalance = (() => {
    if (ticketTab !== 'withdraw') return 0;
    // v1 or base-selected → use liveVault.balance (base asset formatted)
    if (!selectedWithdrawRow || selectedWithdrawMeta?.isBase) {
      return parseFloat(liveVault?.balance || '0');
    }
    // v2 non-base rescue → format raw vault balance with token's own decimals
    try {
      return parseFloat(formatUnits(selectedWithdrawRow.balance ?? 0n, selectedWithdrawMeta.decimals ?? 18));
    } catch {
      return 0;
    }
  })();
  const ticketWalletBalance = ticketTab === 'deposit'
    ? parseFloat(ticketToken?.balance || '0')
    : withdrawTokenBalance;
  // Resolved base-asset metadata for the withdraw path. Falls back to USDC
  // when the on-chain baseAsset hasn't loaded yet (first paint).
  const baseTokenForVault = depositTokens.find((t) => t.isBase);
  const baseAssetSymbolResolved = baseTokenForVault?.symbol || 'USDC';
  const baseAssetDecimalsResolved = baseTokenForVault?.decimals ?? resolvedDecimals;
  const ticketSharePriceLabel = navSnapshot?.sharePrice
    ? String(navSnapshot.sharePrice)
    : nav > 0 && totalDeposited > 0
      ? (nav / Math.max(1, totalDeposited)).toFixed(4)
      : '1.0000';
  // Share accounting only applies to base-asset deposits — non-base tokens are
  // bare `transfer()` calls that don't mint shares.
  const estShares = ticketTab === 'deposit' && ticketAmount && ticketToken?.isBase
    ? (Number(ticketAmount) / Math.max(0.0001, Number(ticketSharePriceLabel))).toFixed(2)
    : null;

  const hasFees = effectivePolicy && (
    effectivePolicy.performanceFeeBps ||
    effectivePolicy.managementFeeBps ||
    effectivePolicy.entryFeeBps ||
    effectivePolicy.exitFeeBps ||
    (feeState?.accruedTotal > 0)
  );

  return (
    <div className="relative min-h-screen">
      {/* Ambient backdrop */}
      <div aria-hidden className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 ed-dotgrid opacity-25" />
        <div
          className="absolute -top-[400px] -left-[200px] h-[800px] w-[800px] rounded-full"
          style={{ background: `radial-gradient(circle, ${ACCENTS.emerald}14 0%, transparent 55%)`, filter: 'blur(40px)' }}
        />
        <div
          className="absolute -bottom-[400px] -right-[200px] h-[800px] w-[800px] rounded-full"
          style={{ background: `radial-gradient(circle, ${ACCENTS.cyan}10 0%, transparent 55%)`, filter: 'blur(40px)' }}
        />
      </div>

      <div className="relative max-w-[1540px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <Link
            to="/app"
            className="ed-mono text-[11px] uppercase tracking-[0.18em] inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
            style={{ color: 'var(--ed-steel-400)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-steel-50)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ed-steel-400)')}
          >
            <ArrowLeft className="w-3 h-3" /> Back to Dashboard
          </Link>
          <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-600)' }}>/</span>
          <span className="ed-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--ed-steel-400)' }}>Vaults</span>
          <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-600)' }}>/</span>
          <span className="ed-mono text-[11px] uppercase tracking-[0.18em] whitespace-nowrap" style={{ color: 'var(--ed-steel-50)' }}>
            {vaultTitle}
          </span>
        </div>

        {/* Header */}
        <div className="ed-rise" style={{ '--ed-rise-d': '0ms' }}>
          <VaultHero
            vaultAvatarSymbol={vaultAvatarSymbol}
            vaultTitle={vaultTitle}
            vaultExplorerHref={vaultExplorerHref}
            isPaused={isPaused}
            showDemoVault={showDemoVault}
            mandateType={mandateType}
            mandateChipTone={mandateChipTone}
            executorIsInactive={executorIsInactive}
            cycleCount={cycleCount}
            nav={nav}
            lastExecTs={lastExecTs}
            baseAssetSymbol={baseAssetSymbolResolved}
            executions={executions}
            decisionCounts={decisionCounts}
            orchStatus={orchStatus}
            isConnected={isConnected}
            sealedMode={!!effectivePolicy?.sealedMode}
            attestedSigner={effectivePolicy?.attestedSigner || ''}
            onDeposit={openDepositModal}
            onWithdraw={openWithdrawModal}
            onEditPolicy={openPolicyModal}
            onPause={handlePause}
            pausePending={pausePending}
            unpausePending={unpausePending}
          />
        </div>

        {/* Operator rotation banner */}
        {executorIsInactive && !bannerDismissed && (
          <div className="mt-6 ed-rise" style={{ '--ed-rise-d': '80ms' }}>
            <div
              className="rounded-2xl p-4 flex items-start gap-3 relative overflow-hidden"
              style={{
                background: `linear-gradient(90deg, ${ACCENTS.amber}10, rgba(15,15,19,0.8))`,
                boxShadow: 'var(--ed-ghost-border)',
              }}
            >
              <div
                className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: `${ACCENTS.amber}26`, color: ACCENTS.amber }}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="ed-mono text-[11px] uppercase tracking-[0.2em] whitespace-nowrap" style={{ color: 'var(--ed-steel-50)' }}>
                    Operator status changed
                  </span>
                  <Chip tone="amber" dense>{executorIsInactive.reason}</Chip>
                </div>
                <p className="text-[12.5px] leading-[1.55]" style={{ color: 'var(--ed-steel-300)' }}>
                  {executorIsInactive.label} Rotate to a different executor below without moving funds.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                className="ed-mono text-[10.5px] uppercase tracking-[0.2em] transition-colors px-2 py-1 rounded"
                style={{ color: 'var(--ed-steel-400)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-steel-50)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ed-steel-400)')}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {showLiveTelemetryGuide && (
          <div className="mt-6 ed-rise" style={{ '--ed-rise-d': '80ms' }}>
            <div className="rounded-2xl p-4" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Cpu className="w-3.5 h-3.5" style={{ color: ACCENTS.cyan }} />
                <Eyebrow tone="cyan">Telemetry warming up</Eyebrow>
              </div>
              <p className="text-[11.5px] leading-[1.55]" style={{ color: 'var(--ed-steel-400)' }}>
                The vault exists on-chain, but no fresh AI journal or NAV history has arrived yet. Connect the vault to your
                orchestrator executor and run a cycle to populate the analytics panels below.
              </p>
              <div className="mt-2 ed-mono text-[10px]" style={{ color: 'var(--ed-steel-500)' }}>
                Endpoint: {ORCHESTRATOR_URL || 'VITE_ORCHESTRATOR_URL not set'}
              </div>
            </div>
          </div>
        )}

        {/* Main two-col grid */}
        <div className="mt-8 lg:mt-10 grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-8 lg:gap-10">
          {/* Main */}
          <div className="flex flex-col gap-10 min-w-0">
            <div className="ed-rise" style={{ '--ed-rise-d': '120ms' }}>
              <PerformancePanel
                nav={nav}
                totalDeposited={totalDeposited}
                allTimeReturnPct={allTimeReturnPct}
                allTimeReturnUsd={allTimeReturnUsd}
                returnIsPositive={returnIsPositive}
                pnlRealized={pnlRealized}
                pnlUnrealized={pnlUnrealized}
                navHistoryData={navHistoryData}
                pnlHistoryData={pnlHistoryData}
                drawdownHistoryData={drawdownHistoryData}
                showDemoVault={showDemoVault}
              />
            </div>

            {allocationData.length > 0 && (
              <div className="ed-rise" style={{ '--ed-rise-d': '180ms' }}>
                <AllocationPanel allocations={allocationData} prices={navData?.prices} />
              </div>
            )}

            <div className="ed-rise" style={{ '--ed-rise-d': '240ms' }}>
              <StrategyPanel
                mandateType={mandateType}
                mandateChipTone={mandateChipTone}
                pol={pol}
                isPaused={isPaused}
                operator={executorOpData}
                executorAddress={executorAddress}
                executorRegistered={executorRegistered}
                executorSyncLabel={executorSyncLabel}
                executorSyncTone={executorSyncTone}
                isConnected={isConnected}
                onEditPolicy={openPolicyModal}
                onSetExecutor={openExecutorModal}
              />
            </div>

            <div className="ed-rise" style={{ '--ed-rise-d': '300ms' }}>
              <DecisionsPanel
                entries={journalEntries}
                counts={decisionCounts}
                chainId={chainId}
                onExport={handleExportJournal}
              />
            </div>

            <div className="ed-rise" style={{ '--ed-rise-d': '360ms' }}>
              <RecentActionsPanel actions={recentActions} chainId={chainId} />
            </div>
          </div>

          {/* Rail */}
          <aside className="flex flex-col gap-8">
            <div className="ed-rise" style={{ '--ed-rise-d': '120ms' }}>
              <RiskPanel
                riskScore={riskScore}
                riskLevel={riskLevel}
                riskTone={riskTone}
                pol={pol}
                dailyActions={dailyActions}
              />
            </div>

            {/* V4 strategy manifest binding — drift detection + 24h-timelocked
                upgrade flow. Renders a no-op for V3/V2/V1 vaults. */}
            <V4ManifestPanel
              vaultAddress={vaultAddr}
              operatorAddress={executorAddr}
              vaultVersion={vaultVersion}
              isOwner={
                isConnected &&
                liveVault?.owner &&
                address &&
                liveVault.owner.toLowerCase() === address.toLowerCase()
              }
            />

            <div className="ed-rise" style={{ '--ed-rise-d': '180ms' }}>
              <CapitalTicket
                tab={ticketTab}
                setTab={setTicketTab}
                amount={ticketAmount}
                setAmount={setTicketAmount}
                walletBalance={ticketWalletBalance}
                tokens={depositTokens}
                selectedSymbol={ticketTokenSymbol}
                onSelectSymbol={(sym) => {
                  setTicketTokenSymbol(sym);
                  setTicketAmount('');
                }}
                sharePrice={ticketSharePriceLabel}
                estShares={estShares}
                entryFeeBps={effectivePolicy?.entryFeeBps || 0}
                exitFeeBps={effectivePolicy?.exitFeeBps || 0}
                isConnected={isConnected}
                onSubmit={handleTicketSubmit}
                vaultVersion={vaultVersion}
                vaultAssetRows={vaultAssetRows}
                liveVault={liveVault}
                selectedWithdrawSymbol={ticketWithdrawSymbol}
                onSelectWithdrawSymbol={(sym) => {
                  setTicketWithdrawSymbol(sym);
                  setTicketAmount('');
                }}
              />
              <CrossChainDepositCard vaultAddress={vaultAddr} baseAssetAddress={liveVault?.baseAsset} baseAssetSymbol={baseAssetSymbolResolved} baseAssetDecimals={baseAssetDecimalsResolved} />
            </div>

            {hasFees && (
              <div className="ed-rise" style={{ '--ed-rise-d': '240ms' }}>
                <FeesPanel
                  policy={effectivePolicy}
                  feeState={feeState}
                  liveNavUsd={liveNavUsd}
                  feeRecipientExplorerHref={feeRecipientExplorerHref}
                  walletAddress={walletAddress}
                  isConnected={isConnected}
                  accruePending={accruePending}
                  claimPending={claimPending}
                  claimSuccess={claimSuccess}
                  accrueSuccess={accrueSuccess}
                  onAccrue={() => {
                    accrueFees(vaultAddr);
                    setTimeout(() => { refetchFees(); refetchNav(); }, 4000);
                  }}
                  onClaim={() => {
                    claimFees(vaultAddr);
                    setTimeout(() => { refetchFees(); refetch(); }, 4000);
                  }}
                />
              </div>
            )}

            <div className="ed-rise" style={{ '--ed-rise-d': '300ms' }}>
              <BriefingPanel
                vaultAddress={vaultAddress}
                executorAddress={executorAddress}
                operator={executorOpData}
                executorRegistered={executorRegistered}
                networkName={networkName}
                mandateType={mandateType}
                baseAssetSymbol={baseAssetSymbolResolved}
                resolvedDecimals={resolvedDecimals}
                lastExecTs={lastExecTs}
                dailyActions={dailyActions}
                maxActionsPerDay={pol.maxActionsPerDay}
                executorSyncLabel={executorSyncLabel}
                executorSyncTone={executorSyncTone}
                onCopy={handleCopy}
                addressCopied={addressCopied}
                vaultExplorerHref={vaultExplorerHref}
                executorExplorerHref={executorExplorerHref}
              />
            </div>

            <div className="ed-rise" style={{ '--ed-rise-d': '360ms' }}>
              <SystemControlsPanel
                isConnected={isConnected}
                isPaused={isPaused}
                pausePending={pausePending}
                unpausePending={unpausePending}
                onPause={handlePause}
                onExecutor={openExecutorModal}
                onEditPolicy={openPolicyModal}
                onExport={handleExportJournal}
                executorMatches={executorMatchesActiveOrchestrator}
                recentTxs={recentVaultTxs}
                withdrawSuccess={withdrawSuccess}
                depositSuccess={depositSuccess || transferSuccess}
                policySuccess={policySuccess}
                executorSuccess={executorSuccess}
              />
            </div>
          </aside>
        </div>

        {/* Modals */}
        {showDepositModal && (
          <DepositModal
            onClose={() => {
              setShowDepositModal(false);
              resetWrap?.();
            }}
            depositStep={depositStep}
            setDepositStep={setDepositStep}
            depositTokens={depositTokens}
            selectedDepositToken={selectedDepositToken}
            setSelectedDepositToken={setSelectedDepositToken}
            depositAmount={depositAmount}
            setDepositAmount={setDepositAmount}
            approve={approve}
            approvePending={approvePending}
            approveSuccess={approveSuccess}
            transferToken={transferToken}
            transferPending={transferPending}
            deposit={deposit}
            depositPending={depositPending}
            wrapNative={wrapNative}
            wrapPending={wrapPending}
            wrapSuccess={wrapSuccess}
            refetchW0g={refetchW0g}
            refetchNative={refetchNative}
            vaultAddr={vaultAddr}
            refetch={refetch}
          />
        )}

        {showWithdrawModal && (
          <WithdrawModal
            onClose={() => setShowWithdrawModal(false)}
            withdrawAmount={withdrawAmount}
            setWithdrawAmount={setWithdrawAmount}
            withdraw={withdraw}
            withdrawPending={withdrawPending}
            vaultAddr={vaultAddr}
            refetch={refetch}
            liveVault={liveVault}
            hasLive={hasLive}
            baseAssetSymbol={baseAssetSymbolResolved}
            baseAssetDecimals={baseAssetDecimalsResolved}
            vaultVersion={vaultVersion}
            vaultAssetRows={vaultAssetRows}
            depositTokens={depositTokens}
            withdrawToken={withdrawToken}
            withdrawTokenPending={withdrawTokenPending}
            withdrawAllNonBase={withdrawAllNonBase}
            withdrawAllPending={withdrawAllPending}
            initialWithdrawSymbol={ticketWithdrawSymbol}
          />
        )}

        {showExecutorModal && (
          <ExecutorModal
            onClose={() => setShowExecutorModal(false)}
            executorForm={executorForm}
            setExecutorForm={setExecutorForm}
            executorAddress={executorAddress}
            executorSyncLabel={executorSyncLabel}
            executorSyncTone={executorSyncTone}
            activeOrchestratorExecutor={activeOrchestratorExecutor}
            activeOrchestratorExecutors={activeOrchestratorExecutors}
            activeOrchestratorExecutorSummary={activeOrchestratorExecutorSummary}
            activeMarketplaceOps={activeMarketplaceOps}
            setExecutor={setExecutor}
            executorPending={executorPending}
            vaultAddr={vaultAddr}
            refetch={refetch}
            liveVault={liveVault}
            hasLive={hasLive}
          />
        )}

        {showPolicyModal && policyForm && (
          <PolicyModal
            onClose={() => setShowPolicyModal(false)}
            policyForm={policyForm}
            setPolicyForm={setPolicyForm}
            updatePolicy={updatePolicy}
            policyPending={policyPending}
            vaultAddr={vaultAddr}
            refetch={refetch}
          />
        )}

      </div>
    </div>
  );
}

/* ─────────────────── Hero ─────────────────── */

function VaultHero({
  vaultAvatarSymbol, vaultTitle, vaultExplorerHref,
  isPaused, showDemoVault, mandateType, mandateChipTone, executorIsInactive,
  cycleCount, nav, lastExecTs, baseAssetSymbol, executions, decisionCounts,
  orchStatus, isConnected, sealedMode = false, attestedSigner = '',
  onDeposit, onWithdraw, onEditPolicy, onPause, pausePending, unpausePending,
}) {
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
  const hasAttestedSigner = sealedMode
    && attestedSigner
    && attestedSigner.toLowerCase() !== ZERO_ADDR;
  const kpis = [
    {
      icon: Layers, label: 'NAV · TVL',
      value: `$${nav.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      sub: nav > 0 ? `${nav.toFixed(4)} ${baseAssetSymbol}` : 'Awaiting deposits',
      tone: 'cyan',
    },
    {
      icon: Zap, label: 'Actions',
      value: String(executions),
      sub: 'All cycles',
      tone: 'emerald',
    },
    {
      icon: CheckCircle, label: 'Filled',
      value: String(decisionCounts.buy + decisionCounts.sell),
      sub: `${decisionCounts.hold} hold · ${decisionCounts.buy + decisionCounts.sell} filled`,
      tone: 'cyan',
    },
    {
      icon: Sparkles, label: 'Signals',
      value: String(decisionCounts.hold + decisionCounts.buy + decisionCounts.sell + decisionCounts.other),
      sub: decisionCounts.hold > 0 ? `${decisionCounts.hold} vetoed` : 'Zero veto',
      tone: 'amber',
    },
    {
      icon: RefreshCw, label: 'Cycle',
      value: cycleCount > 0 ? `#${cycleCount}` : '—',
      sub: orchStatus?.running ? 'Orchestrator streaming' : 'Orchestrator idle',
      tone: 'steel',
    },
  ];

  return (
    <section
      className="relative overflow-hidden"
      style={{
        borderRadius: 28,
        background: 'linear-gradient(180deg,#0F0F13 0%,#0A0A0C 100%)',
        boxShadow: 'var(--ed-ghost-border)',
      }}
    >
      <div aria-hidden className="absolute inset-0 ed-dotgrid opacity-40" />
      <div aria-hidden className="absolute inset-0 pointer-events-none ed-grain-light" />
      <div
        aria-hidden
        className="absolute -right-24 -top-24 h-[380px] w-[380px] rounded-full"
        style={{
          background: `radial-gradient(circle, ${ACCENTS.emerald} 0%, transparent 60%)`,
          opacity: 0.14,
          filter: 'blur(10px)',
        }}
      />
      <div aria-hidden className="absolute right-10 top-4 pointer-events-none select-none">
        <GhostNumeral n="01" style={{ fontSize: 160 }} />
      </div>

      <div className="relative flex flex-col xl:flex-row items-start justify-between gap-8 p-8 lg:p-10">
        {/* Identity */}
        <div className="flex flex-col gap-4 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Chip tone="steel" leading={<Shield className="w-3 h-3" />}>Vault file</Chip>
            <Chip
              tone={isPaused ? 'amber' : 'emerald'}
              dense
              leading={<StatusDot tone={isPaused ? 'amber' : 'emerald'} size={5} />}
            >
              {isPaused ? 'Paused' : 'Active'}
            </Chip>
            {mandateType !== 'Unknown' && <Chip tone={mandateChipTone} dense>{mandateType}</Chip>}
            {sealedMode && (
              <Chip
                tone="emerald"
                dense
                leading={<ShieldCheck className="w-3 h-3" />}
                title={hasAttestedSigner
                  ? `Sealed strategy mode\nIntent hashes signed by TEE-attested key:\n${attestedSigner}\nVerified on-chain by SealedLib.ecrecover()`
                  : 'Sealed strategy mode — commit-reveal with TEE attestation'}
              >
                Sealed · TEE
              </Chip>
            )}
            {executorIsInactive && <Chip tone="rose" dense leading={<AlertTriangle className="w-3 h-3" />}>Operator {executorIsInactive.reason}</Chip>}
            {showDemoVault && <Chip tone="gold" dense>Demo</Chip>}
          </div>

          <div className="flex items-center gap-4">
            <Eyebrow tone="gold">§ V.01 · Vault File</Eyebrow>
            <div className="flex-1 ed-hairline" />
          </div>

          <div className="flex items-start gap-5">
            <TokenAvatar symbol={vaultAvatarSymbol} size={72} />
            <div className="flex flex-col gap-1 min-w-0">
              <Eyebrow tone="muted" className="!text-[10.5px] !tracking-[0.24em]">Vault</Eyebrow>
              <h1
                className="ed-italic m-0 whitespace-nowrap"
                style={{ fontSize: 42, fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 1, color: 'var(--ed-steel-50)' }}
              >
                {vaultTitle}
              </h1>
              <span className="ed-mono text-[12px] mt-2" style={{ color: 'var(--ed-steel-500)' }}>
                {cycleCount > 0 ? `cycle ${cycleCount}` : 'cycle pending'} · base asset {baseAssetSymbol}
              </span>
            </div>
          </div>

          <p className="max-w-[640px] text-[14px] leading-[1.65] m-0" style={{ color: 'var(--ed-steel-300)' }}>
            {executorIsInactive ? (
              <>
                Operator status <span className="ed-italic" style={{ color: 'var(--ed-steel-50)' }}>changed.</span>{' '}
                Signatures rotated automatically — vault is safe and continuing to stream policy-checked actions.
              </>
            ) : orchStatus?.running ? (
              <>
                Operator streaming policy-checked actions —{' '}
                <span className="ed-italic" style={{ color: 'var(--ed-steel-50)' }}>custody stays in the vault,</span>{' '}
                receipts anchored on-chain per cycle.
              </>
            ) : (
              <>
                Deposits only · withdrawals gated by a short cooldown.{' '}
                <span className="ed-italic" style={{ color: 'var(--ed-steel-50)' }}>Policy caps every trade</span>{' '}
                before settlement.
              </>
            )}
          </p>

          <div
            className="flex items-center gap-5 pt-4 mt-2 flex-wrap"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <FootStat label="Asset" value={baseAssetSymbol} />
            <FootStat label="NAV" value={`$${nav.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} mono />
            <FootStat label="Last action" value={lastExecTs ? formatTime(lastExecTs) : 'Never'} mono />
            <FootStat label="Policy" value={`${mandateType} · v1`} />
            {vaultExplorerHref && (
              <FootStat
                label="Explorer"
                value="view ↗"
                leading={<ExternalLink className="w-3 h-3" style={{ color: ACCENTS.cyan }} />}
                href={vaultExplorerHref}
              />
            )}
          </div>
        </div>

        {/* CTA cluster */}
        <div className="flex flex-col gap-3 w-full xl:w-[320px] flex-shrink-0">
          <div className="flex gap-2">
            <ControlButton variant="primary" className="flex-1" disabled={!isConnected} onClick={onDeposit}>
              <Plus className="w-3.5 h-3.5" /> Deposit
            </ControlButton>
            <ControlButton variant="secondary" className="flex-1" disabled={!isConnected} onClick={onWithdraw}>
              <RefreshCw className="w-3.5 h-3.5" /> Withdraw
            </ControlButton>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ControlButton variant="secondary" size="sm" disabled={!isConnected} onClick={onEditPolicy}>
              <Shield className="w-3 h-3" /> Set policy
            </ControlButton>
            {vaultExplorerHref ? (
              <a href={vaultExplorerHref} target="_blank" rel="noreferrer">
                <ControlButton variant="ghost" size="sm" className="w-full">
                  <ExternalLink className="w-3 h-3" /> Explorer
                </ControlButton>
              </a>
            ) : (
              <ControlButton variant="ghost" size="sm" disabled>
                <ExternalLink className="w-3 h-3" /> Explorer
              </ControlButton>
            )}
          </div>
          <ControlButton
            variant={isPaused ? 'gold' : 'danger'}
            size="sm"
            disabled={!isConnected || pausePending || unpausePending}
            onClick={onPause}
          >
            {isPaused ? (
              <><PlayCircle className="w-3.5 h-3.5" /> {unpausePending ? 'Resuming…' : 'Resume vault'}</>
            ) : (
              <><PauseCircle className="w-3.5 h-3.5" /> {pausePending ? 'Pausing…' : 'Emergency pause'}</>
            )}
          </ControlButton>
        </div>
      </div>

      {/* KPI strip */}
      <div
        className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 px-8 lg:px-10 pb-8 lg:pb-10 pt-8"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
      >
        {kpis.map((k) => {
          const color = ACCENTS[k.tone] || ACCENTS.steel;
          const Icon = k.icon;
          return (
            <div
              key={k.label}
              className="rounded-xl p-4"
              style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'var(--ed-ghost-border)' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="h-6 w-6 rounded-md flex items-center justify-center"
                  style={{ background: `${color}1F`, color }}
                >
                  <Icon className="w-3 h-3" />
                </span>
                <Eyebrow tone="muted" className="!text-[9px]">{k.label}</Eyebrow>
              </div>
              <div className="ed-italic text-[30px] sm:text-[34px] leading-none" style={{ color: 'var(--ed-steel-50)' }}>
                {k.value}
              </div>
              <div className="ed-mono text-[10.5px] mt-2" style={{ color: 'var(--ed-steel-500)' }}>{k.sub}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FootStat({ label, value, mono, leading, href }) {
  const valueNode = href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cx(mono ? 'ed-mono' : 'ed-italic', 'text-[13px] inline-flex items-center gap-1 transition-colors')}
      style={{ color: ACCENTS.cyan }}
    >
      {value}
    </a>
  ) : (
    <span
      className={cx(mono ? 'ed-mono' : 'ed-italic', 'text-[13px] whitespace-nowrap')}
      style={{ color: 'var(--ed-steel-50)' }}
    >
      {value}
    </span>
  );
  return (
    <div className="flex items-center gap-2 min-w-0">
      {leading}
      <div className="flex flex-col leading-tight min-w-0">
        <span className="ed-mono text-[9.5px] uppercase tracking-[0.22em] whitespace-nowrap" style={{ color: 'var(--ed-steel-500)' }}>
          {label}
        </span>
        {valueNode}
      </div>
    </div>
  );
}

/* ─────────────────── Performance ─────────────────── */

function PerformancePanel({
  nav, totalDeposited, allTimeReturnPct, allTimeReturnUsd, returnIsPositive,
  pnlRealized, pnlUnrealized, navHistoryData, pnlHistoryData, drawdownHistoryData,
  showDemoVault,
}) {
  return (
    <SectionHead
      marker="V.02 · Performance"
      title={<span className="ed-italic text-[22px]">NAV <span className="ed-sans text-[14px] not-italic" style={{ color: 'var(--ed-steel-400)' }}>— policy-checked cycles</span></span>}
    >
      <div className="rounded-2xl p-6" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        {!showDemoVault && navHistoryData.length === 0 && (
          <div
            className="rounded-lg px-4 py-3 mb-4"
            style={{ background: 'rgba(255,255,255,0.02)', boxShadow: 'var(--ed-ghost-border)' }}
          >
            <p className="text-[11.5px] leading-[1.55]" style={{ color: 'var(--ed-steel-400)' }}>
              Historical snapshots populate as the orchestrator emits cycle updates. Switch between NAV, PnL, and drawdown
              once data lands.
            </p>
          </div>
        )}

        <div className="flex items-end justify-between mb-5 flex-wrap gap-4">
          <div>
            <Eyebrow tone="muted" className="!text-[9px]">NAV · vault share price</Eyebrow>
            <div className="flex items-baseline gap-3 mt-1.5 flex-wrap">
              <span className="ed-italic leading-none" style={{ fontSize: 52, color: 'var(--ed-steel-50)' }}>
                ${nav.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <Chip
                tone={returnIsPositive ? 'emerald' : 'rose'}
                dense
                leading={<TrendingUp className={cx('w-3 h-3', !returnIsPositive && '-scale-y-100')} />}
              >
                {returnIsPositive ? '+' : ''}{allTimeReturnPct.toFixed(2)}%
              </Chip>
              <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-500)' }}>
                vs. ${totalDeposited.toLocaleString(undefined, { maximumFractionDigits: 0 })} cost basis
              </span>
            </div>
          </div>
          <div className="text-right">
            <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-500)' }}>
              {navHistoryData.length} snapshots
            </span>
            <div className="ed-mono text-[11px] mt-1" style={{ color: ACCENTS.emerald }}>
              PnL {returnIsPositive ? '+' : ''}${Math.abs(allTimeReturnUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>

        <PerformanceChart
          height={240}
          navData={navHistoryData}
          pnlData={pnlHistoryData}
          drawdownData={drawdownHistoryData}
          defaultMetric="nav"
        />

        <div
          className="mt-5 pt-5 grid grid-cols-2 sm:grid-cols-4 gap-6"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          <MiniStat label="Realized PnL" value={`${pnlRealized >= 0 ? '+' : ''}$${Math.abs(pnlRealized).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} tone={pnlRealized >= 0 ? 'emerald' : 'rose'} />
          <MiniStat label="Unrealized PnL" value={`${pnlUnrealized >= 0 ? '+' : ''}$${Math.abs(pnlUnrealized).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} tone={pnlUnrealized >= 0 ? 'cyan' : 'rose'} />
          <MiniStat label="Cumulative" value={`${(pnlRealized + pnlUnrealized) >= 0 ? '+' : ''}$${Math.abs(pnlRealized + pnlUnrealized).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} tone={(pnlRealized + pnlUnrealized) >= 0 ? 'emerald' : 'rose'} />
          <MiniStat label="Cost basis" value={`$${totalDeposited.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        </div>
      </div>
    </SectionHead>
  );
}

function MiniStat({ label, value, tone = 'default' }) {
  const color =
    tone === 'emerald' ? ACCENTS.emerald :
    tone === 'cyan'    ? ACCENTS.cyan    :
    tone === 'rose'    ? ACCENTS.rose    :
                         'var(--ed-steel-50)';
  return (
    <div>
      <Eyebrow tone="muted" className="!text-[9px]">{label}</Eyebrow>
      <div className="ed-mono text-[14px] mt-1.5" style={{ color }}>{value}</div>
    </div>
  );
}

/* ─────────────────── Strategy (Socket alert) ─────────────────── */

function StrategyPanel({
  mandateType, mandateChipTone, pol, isPaused, operator, executorAddress, executorRegistered,
  executorSyncLabel, executorSyncTone, isConnected, onEditPolicy, onSetExecutor,
}) {
  const operatorName = operator?.name || (executorRegistered === false ? 'Unregistered wallet' : 'Operator loading…');
  return (
    <div
      className="rounded-2xl p-5 relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${ACCENTS.gold}0D 0%, #0F0F13 55%)`,
        boxShadow: 'var(--ed-ghost-border)',
      }}
    >
      <div aria-hidden className="absolute inset-0 ed-dotgrid opacity-20" />
      <div className="relative flex items-start gap-4 flex-wrap">
        <div
          className="h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${ACCENTS.gold}26`, boxShadow: `inset 0 0 0 1px ${ACCENTS.gold}4A` }}
        >
          <Shield className="w-4 h-4" style={{ color: ACCENTS.gold }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="ed-mono text-[11px] uppercase tracking-[0.2em]" style={{ color: 'var(--ed-steel-50)' }}>
              Socket strategy rule
            </span>
            <Chip tone={isPaused ? 'amber' : 'emerald'} dense leading={<StatusDot tone={isPaused ? 'amber' : 'emerald'} size={5} />}>
              {isPaused ? 'Paused' : 'Active'}
            </Chip>
            <Chip tone={mandateChipTone} dense>{mandateType} · v1</Chip>
            {pol.autoExecution && <Chip tone="cyan" dense>Auto-execute</Chip>}
            <Chip tone={executorSyncTone} dense leading={<StatusDot tone={executorSyncTone} size={5} pulse={executorSyncTone === 'emerald'} />}>
              Executor · {executorSyncLabel}
            </Chip>
          </div>
          <p className="text-[13.5px] leading-[1.6] max-w-[680px]" style={{ color: 'var(--ed-steel-300)' }}>
            <span className="ed-italic" style={{ color: 'var(--ed-steel-50)' }}>
              {mandateType} mandate trading rule
            </span>{' '}
            — requires min {(pol.confidenceThresholdPct || 0).toFixed(0)}% AI confidence, capped at{' '}
            <span className="ed-mono" style={{ color: 'var(--ed-steel-50)' }}>
              {(pol.maxPositionPct || 0).toFixed(0)}%
            </span>{' '}
            single-position exposure. Vault-side stop-loss enforced on-chain at{' '}
            <span className="ed-mono" style={{ color: 'var(--ed-steel-50)' }}>
              {(pol.stopLossPct || 0).toFixed(1)}%
            </span>
            .
          </p>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
              Operator <span style={{ color: 'var(--ed-steel-50)' }}>{operatorName}</span>
            </span>
            {executorAddress && (
              <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
                {shortHexLabel(executorAddress, 8, 6)}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <ControlButton variant="secondary" size="sm" disabled={!isConnected} onClick={onSetExecutor}>
            <Cpu className="w-3 h-3" /> Rotate
          </ControlButton>
          <ControlButton variant="gold" size="sm" disabled={!isConnected} onClick={onEditPolicy}>
            <Settings className="w-3 h-3" /> Tune
          </ControlButton>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Decisions feed ─────────────────── */

function DecisionsPanel({ entries, counts, chainId, onExport }) {
  return (
    <SectionHead
      marker="V.03 · AI Decisions"
      title={
        <span className="ed-italic text-[22px]">
          Decision feed{' '}
          <span className="ed-sans text-[14px] not-italic" style={{ color: 'var(--ed-steel-400)' }}>— policy-checked</span>
        </span>
      }
      trailing={
        <>
          <Chip tone="steel" dense>All · {entries.length}</Chip>
          <Chip tone="amber" dense>Hold · {counts.hold}</Chip>
          <Chip tone="emerald" dense>Filled · {counts.buy + counts.sell}</Chip>
          <button
            type="button"
            onClick={onExport}
            className="ed-mono text-[10.5px] uppercase tracking-[0.18em] transition-colors ml-1"
            style={{ color: 'var(--ed-steel-400)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-steel-50)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ed-steel-400)')}
          >
            Export →
          </button>
        </>
      }
    >
      <div className="rounded-2xl overflow-hidden" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        {entries.length === 0 ? (
          <div className="text-center py-8 px-5">
            <div className="ed-italic mb-2" style={{ fontSize: 18, color: 'var(--ed-steel-300)' }}>
              No AI decisions yet.
            </div>
            <p className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-500)' }}>
              Set the executor, start the orchestrator, and run a cycle to populate the decision feed.
            </p>
          </div>
        ) : (
          entries.map((e) => <DecisionRow key={e.id} e={e} chainId={chainId} />)
        )}
      </div>
    </SectionHead>
  );
}

function DecisionRow({ e, chainId }) {
  const isBuy = e.rawAction === 'buy';
  const isSell = e.rawAction === 'sell';
  const isHold = e.rawAction === 'hold';
  const accentColor = isBuy ? ACCENTS.emerald : isSell ? ACCENTS.rose : ACCENTS.amber;
  const chipTone = isBuy ? 'emerald' : isSell ? 'rose' : 'amber';
  const kind = isHold ? 'Hold' : isBuy ? 'Filled' : 'Exit';
  const actionLabel = isHold ? 'HOLD' : isBuy ? 'BUY' : isSell ? 'SELL' : (e.rawAction || '').toUpperCase();
  const confPct = Math.round((e.confidence || 0) * 100);
  const txHref = e.txHash ? getExplorerTxHref(chainId, e.txHash) : null;

  return (
    <div
      className="ed-row-hover grid items-start gap-4 py-4 px-5"
      style={{
        gridTemplateColumns: 'minmax(88px,88px) 1fr minmax(180px,200px)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="ed-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: 'var(--ed-steel-500)' }}>
          {shortHexLabel(e.id, 5, 3)}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: accentColor }} />
          <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>{kind}</span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="ed-mono text-[12.5px] whitespace-nowrap" style={{ color: 'var(--ed-steel-50)' }}>
            {actionLabel} {e.asset || ''}
          </span>
          <Chip tone={chipTone} dense>{kind}</Chip>
          <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
            Conf <span style={{ color: 'var(--ed-steel-50)' }}>{confPct}%</span>
          </span>
          {e.fill && (
            <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
              Fill <span style={{ color: 'var(--ed-steel-50)' }}>${e.fill}</span>
            </span>
          )}
          {e.pnl !== null && e.pnl !== undefined && (
            <span className="ed-mono text-[10.5px]" style={{ color: e.pnl >= 0 ? ACCENTS.emerald : ACCENTS.rose }}>
              {e.pnl >= 0 ? '+' : ''}${Math.abs(e.pnl).toFixed(2)}
            </span>
          )}
          {e.regime && (
            <span className="ed-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--ed-steel-300)' }}>
              {e.regime.replace(/_/g, ' ')}
            </span>
          )}
          {e.source?.includes('0g-compute') && (
            <span className="ed-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${ACCENTS.cyan}12`, color: ACCENTS.cyan }}>
              0G Compute
            </span>
          )}
        </div>
        {e.reason && (
          <p className="text-[12.5px] leading-[1.55]" style={{ color: 'var(--ed-steel-300)' }}>
            {e.reason}
          </p>
        )}
        {e.hardVeto && e.hardVetoReasons?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {e.hardVetoReasons.map((r) => (
              <span
                key={r}
                className="ed-mono text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: `${ACCENTS.amber}14`, color: ACCENTS.amber, boxShadow: 'var(--ed-ghost-border)' }}
              >
                {r.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="text-right flex flex-col items-end justify-between gap-1.5">
        <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-300)' }}>
          {formatLocalTime(e.timestamp)}
        </span>
        {isHold ? (
          <span className="ed-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--ed-steel-500)' }}>
            No execution
          </span>
        ) : txHref ? (
          <a
            href={txHref}
            target="_blank"
            rel="noreferrer"
            className="ed-mono text-[10px] uppercase tracking-[0.18em] whitespace-nowrap transition-colors"
            style={{ color: ACCENTS.cyan }}
          >
            Details ↗
          </a>
        ) : (
          <span className="ed-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: '#F5C97E' }}>
            On-chain pending
          </span>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── Recent actions ─────────────────── */

function RecentActionsPanel({ actions, chainId }) {
  return (
    <SectionHead
      marker="V.04 · Recent Actions"
      title={
        <span className="ed-italic text-[22px]">
          Recent actions{' '}
          <span className="ed-sans text-[14px] not-italic" style={{ color: 'var(--ed-steel-400)' }}>— vault journal</span>
        </span>
      }
    >
      {actions.length === 0 ? (
        <div className="rounded-2xl p-5 text-center" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
          <p className="text-[13px]" style={{ color: 'var(--ed-steel-300)' }}>No actions recorded yet.</p>
          <p className="ed-mono text-[11px] mt-1" style={{ color: 'var(--ed-steel-500)' }}>
            Signed intents, rotations, and policy checks appear here once the orchestrator emits them.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl p-1 divide-y" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)', borderColor: 'rgba(255,255,255,0.04)' }}>
          {actions.map((a) => {
            const txHref = a.txHash ? getExplorerTxHref(chainId, a.txHash) : null;
            const kindTone = a.kind === 'SIGNED' ? 'emerald' : a.kind === 'ROTATED' ? 'amber' : 'steel';
            return (
              <div
                key={a.id}
                className="grid items-center gap-3 px-4 py-2.5"
                style={{ gridTemplateColumns: 'auto 1fr auto auto', borderTop: '1px solid rgba(255,255,255,0.04)' }}
              >
                <span className="ed-mono text-[9.5px] uppercase tracking-[0.22em]" style={{ color: 'var(--ed-steel-500)' }}>
                  {shortHexLabel(a.id, 5, 3)}
                </span>
                <div className="flex items-center gap-2 min-w-0">
                  <Chip tone={kindTone} dense>{a.kind}</Chip>
                  {a.txHash ? (
                    <span className="ed-mono text-[11px] truncate" style={{ color: 'var(--ed-steel-500)' }}>
                      tx <span style={{ color: 'var(--ed-steel-50)' }}>{shortHexLabel(a.txHash, 8, 4)}</span>
                    </span>
                  ) : (
                    <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-500)' }}>off-chain event</span>
                  )}
                </div>
                <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-300)' }}>
                  {formatLocalTime(a.timestamp)}
                </span>
                {txHref ? (
                  <a
                    href={txHref}
                    target="_blank"
                    rel="noreferrer"
                    className="ed-mono text-[10px] uppercase tracking-[0.18em] transition-colors"
                    style={{ color: ACCENTS.cyan }}
                  >
                    View ↗
                  </a>
                ) : (
                  <span className="ed-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--ed-steel-600)' }}>
                    —
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionHead>
  );
}

/* ─────────────────── Allocation ─────────────────── */

function AllocationPanel({ allocations, prices }) {
  return (
    <SectionHead
      marker="V.06 · Allocation"
      title={<span className="ed-italic text-[22px]">Allocation <span className="ed-sans text-[14px] not-italic" style={{ color: 'var(--ed-steel-400)' }}>— Pyth priced</span></span>}
    >
      <div className="rounded-2xl p-5" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        <div className="space-y-3">
          {allocations.filter((a) => a.value > 0 || a.pct > 0).map((a) => (
            <div key={a.symbol} className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <TokenIcon symbol={a.symbol} size={22} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium" style={{ color: 'var(--ed-steel-50)' }}>{a.asset}</span>
                  <span className="ed-mono text-[12.5px]" style={{ color: 'var(--ed-steel-50)' }}>
                    ${a.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="ed-mono text-[10px]" style={{ color: 'var(--ed-steel-500)' }}>
                    {typeof a.amount === 'number' ? a.amount.toFixed(a.symbol === 'USDC' ? 0 : 6) : a.amount} {a.symbol}
                  </span>
                  <span className="ed-mono text-[10px]" style={{ color: 'var(--ed-steel-400)' }}>{a.pct.toFixed(1)}%</span>
                </div>
                <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <div className="h-full rounded-full" style={{ width: `${a.pct}%`, backgroundColor: a.color, opacity: 0.7 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
        {prices && (
          <div className="mt-3 pt-2 flex gap-4 ed-mono text-[9.5px]" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: 'var(--ed-steel-500)' }}>
            <span>BTC ${prices.BTC?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            <span>ETH ${prices.ETH?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            <span>Source: Pyth Hermes</span>
          </div>
        )}
      </div>
    </SectionHead>
  );
}

/* ─────────────────── Risk (rail) ─────────────────── */

function RiskPanel({ riskScore, riskLevel, riskTone, pol, dailyActions }) {
  const gaugeTone = riskTone === 'rose' ? 'rose' : riskTone === 'amber' ? 'amber' : riskTone === 'cyan' ? 'cyan' : 'emerald';
  const rows = [
    { l: 'Max position',   v: `${(pol.maxPositionPct || 0).toFixed(0)} / 100%`, bar: Math.min(100, pol.maxPositionPct || 0), tone: 'amber' },
    { l: 'Min confidence', v: `${(pol.confidenceThresholdPct || 0).toFixed(0)}%`, bar: Math.min(100, pol.confidenceThresholdPct || 0), tone: 'cyan' },
    { l: 'Stop-loss',      v: `${(pol.stopLossPct || 0).toFixed(1)}%`, bar: Math.min(100, (pol.stopLossPct || 0) * 3), tone: 'emerald' },
    { l: 'Cooldown',       v: `${Math.round((pol.cooldownSeconds || 0) / 60)} min`, bar: Math.min(100, ((pol.cooldownSeconds || 0) / 3600) * 100), tone: 'cyan' },
    { l: 'Daily trades',   v: `${dailyActions} / ${pol.maxActionsPerDay || 0}`, bar: pol.maxActionsPerDay > 0 ? Math.min(100, (dailyActions / pol.maxActionsPerDay) * 100) : 0, tone: 'emerald' },
  ];
  return (
    <SectionHead marker="Risk · policy breach">
      <div className="rounded-2xl p-5" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        <div className="flex items-center justify-center py-2">
          <RiskGauge value={riskScore} label={(riskLevel || 'LOW').toUpperCase()} tone={gaugeTone} />
        </div>
        <div className="mt-2 divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
          {rows.map((r) => (
            <div key={r.l} className="flex items-center gap-3 py-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <span className="text-[12.5px] w-[120px]" style={{ color: 'var(--ed-steel-300)' }}>{r.l}</span>
              <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${r.bar}%`,
                    background: r.tone === 'amber' ? ACCENTS.amber : r.tone === 'emerald' ? ACCENTS.emerald : ACCENTS.cyan,
                  }}
                />
              </div>
              <span className="ed-mono text-[11.5px] w-[72px] text-right" style={{ color: 'var(--ed-steel-50)' }}>{r.v}</span>
            </div>
          ))}
        </div>
      </div>
    </SectionHead>
  );
}

/* ─────────────────── Capital ticket ─────────────────── */

function CapitalTicket({
  tab, setTab, amount, setAmount, walletBalance,
  tokens = [], selectedSymbol, onSelectSymbol,
  sharePrice, estShares, entryFeeBps, exitFeeBps, isConnected, onSubmit,
  // v2 withdraw additions
  vaultVersion = 'v1', vaultAssetRows = [], liveVault,
  selectedWithdrawSymbol, onSelectWithdrawSymbol,
}) {
  const presets = [25, 100, 500];
  const displayBalance = Number.isFinite(walletBalance) ? walletBalance : 0;
  const feeBps = tab === 'deposit' ? entryFeeBps : exitFeeBps;
  // Withdraw settles in the vault's actual base asset (the token whose
  // `isBase` flag is true — set dynamically from liveVault.baseAsset).
  // Falling back to tokens[0] keeps the UI responsive while the on-chain
  // baseAsset lookup is still loading.
  const baseToken = tokens.find((t) => t.isBase) || tokens[0];

  // V2 + V3 withdraw: show EVERY allowed asset the vault can hold. Tokens
  // with zero current balance are still visible so the user sees the full
  // menu — only the on-chain balance distinguishes "has funds" from "empty".
  // V1 vaults don't support non-base withdraw so the selector collapses to
  // base.
  const supportsMultiAsset = vaultSupportsMultiAssetWithdraw(vaultVersion);
  const withdrawableTokens = (() => {
    if (!supportsMultiAsset) return baseToken ? [baseToken] : [];
    const rows = vaultAssetRows
      .map((row) => {
        const meta = tokens.find((t) => t.address?.toLowerCase() === row.address?.toLowerCase());
        if (!meta) return null;
        const dec = meta.decimals ?? 18;
        let vaultBal = 0;
        try {
          vaultBal = parseFloat(formatUnits(row.balance ?? 0n, dec));
        } catch { vaultBal = 0; }
        const isBaseRow = !!meta.isBase
          || row.address?.toLowerCase() === liveVault?.baseAsset?.toLowerCase();
        return { ...meta, isBase: isBaseRow, vaultBalance: vaultBal };
      })
      .filter(Boolean);
    // Ensure base is present even if the factory pre-populated allowedAssets
    // without an explicit base entry.
    if (!rows.some((r) => r.isBase) && baseToken) {
      rows.unshift({ ...baseToken, isBase: true, vaultBalance: parseFloat(liveVault?.balance || '0') });
    }
    return rows;
  })();

  const withdrawSelectedSymbol = selectedWithdrawSymbol
    || withdrawableTokens.find((t) => t.isBase)?.symbol
    || baseToken?.symbol;
  const withdrawActiveToken = withdrawableTokens.find((t) => t.symbol === withdrawSelectedSymbol)
    || withdrawableTokens[0]
    || baseToken;

  const activeToken = tab === 'deposit'
    ? tokens.find((t) => t.symbol === selectedSymbol) || baseToken
    : withdrawActiveToken;
  const activeSymbol = activeToken?.symbol || 'USDC';
  const balanceDecimals = activeToken?.symbol === 'USDC' ? 2 : 6;
  const withdrawIsRescue = tab === 'withdraw' && !activeToken?.isBase;
  // For 0G we surface the W0G / native split in the balance line so the user
  // can see that native balance is spendable too (auto-wrap covers the gap).
  const is0GActive = activeSymbol === '0G';
  const wrappedBalNum = is0GActive ? parseFloat(activeToken?.wrappedBalance || '0') : 0;
  const nativeBalNum = is0GActive ? parseFloat(activeToken?.nativeBalance || '0') : 0;

  return (
    <SectionHead marker="Capital · ticket">
      <div className="rounded-2xl p-1" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        <div className="grid grid-cols-2 rounded-xl p-0.5 mb-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
          {['deposit', 'withdraw'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="ed-mono text-[11px] uppercase tracking-[0.18em] py-2.5 rounded-lg transition-colors"
              style={{
                background: tab === t ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: tab === t ? 'var(--ed-steel-50)' : 'var(--ed-steel-400)',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'deposit' && tokens.length > 1 && (
          <div className="px-3 pt-1 pb-2">
            <Eyebrow tone="muted" className="!block mb-1.5">Token</Eyebrow>
            <div className="flex gap-1.5 flex-wrap">
              {tokens.map((t) => {
                const active = t.symbol === activeSymbol;
                return (
                  <button
                    key={t.symbol}
                    type="button"
                    onClick={() => onSelectSymbol?.(t.symbol)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md ed-mono text-[10.5px] transition-colors"
                    style={{
                      background: active ? `${ACCENTS.gold}22` : 'rgba(255,255,255,0.02)',
                      color: active ? ACCENTS.gold : 'var(--ed-steel-400)',
                      boxShadow: active
                        ? `inset 0 0 0 1px ${ACCENTS.gold}4A`
                        : 'var(--ed-ghost-border)',
                    }}
                  >
                    <TokenIcon symbol={t.symbol} size={13} />
                    {t.symbol}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* V1 vault — single base asset, no rescue path */}
        {tab === 'withdraw' && !supportsMultiAsset && tokens.length > 1 && (
          <div className="px-3 pt-1 pb-2">
            <Eyebrow tone="muted" className="!block mb-1.5">Settlement token</Eyebrow>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md ed-mono text-[10.5px]"
                style={{
                  background: `${ACCENTS.gold}22`,
                  color: ACCENTS.gold,
                  boxShadow: `inset 0 0 0 1px ${ACCENTS.gold}4A`,
                }}
              >
                <TokenIcon symbol={baseToken?.symbol || 'USDC'} size={13} />
                {baseToken?.symbol || 'USDC'}
              </span>
              <span className="ed-mono text-[9.5px]" style={{ color: 'var(--ed-steel-500)' }}>
                base asset · locked by contract
              </span>
            </div>
            <p className="ed-mono text-[9.5px] mt-2 leading-[1.5]" style={{ color: 'var(--ed-steel-500)' }}>
              V1 vault settles withdrawals in {baseToken?.symbol || 'base asset'} only. Non-base holdings
              auto-convert back when the AI closes positions.
            </p>
          </div>
        )}

        {/* V2 + V3 vault — full multi-asset withdraw via withdrawToken / withdraw */}
        {tab === 'withdraw' && supportsMultiAsset && withdrawableTokens.length > 0 && (
          <div className="px-3 pt-1 pb-2">
            <Eyebrow tone="muted" className="!block mb-1.5">Withdraw token</Eyebrow>
            <div className="flex gap-1.5 flex-wrap">
              {withdrawableTokens.map((t) => {
                const active = t.symbol === withdrawSelectedSymbol;
                const hasBalance = (t.vaultBalance ?? 0) > 0;
                return (
                  <button
                    key={t.symbol}
                    type="button"
                    onClick={() => onSelectWithdrawSymbol?.(t.symbol)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md ed-mono text-[10.5px] transition-colors"
                    style={{
                      background: active ? `${ACCENTS.gold}22` : 'rgba(255,255,255,0.02)',
                      color: active ? ACCENTS.gold : 'var(--ed-steel-400)',
                      boxShadow: active
                        ? `inset 0 0 0 1px ${ACCENTS.gold}4A`
                        : 'var(--ed-ghost-border)',
                      // Dim non-selected tokens that currently hold zero NAV
                      // balance. Still clickable — user can verify emptiness.
                      opacity: active || hasBalance ? 1 : 0.45,
                    }}
                  >
                    <TokenIcon symbol={t.symbol} size={13} />
                    {t.symbol}
                    {t.isBase && (
                      <span className="ml-0.5 text-[8.5px]" style={{ color: 'var(--ed-steel-500)' }}>
                        · base
                      </span>
                    )}
                    {!hasBalance && !t.isBase && (
                      <span className="ml-0.5 text-[8.5px]" style={{ color: 'var(--ed-steel-600)' }}>
                        · empty
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {withdrawIsRescue && (
              <p className="ed-mono text-[9.5px] mt-2 leading-[1.5]" style={{ color: 'var(--ed-steel-500)' }}>
                Non-base assets withdraw with no exit fee. Base asset withdrawals still carry
                the standard exit fee set by the vault policy.
              </p>
            )}
          </div>
        )}

        <div className="p-4 pt-1">
          <div className="flex items-center justify-between mb-2">
            <Eyebrow tone="muted">
              Amount · {activeSymbol}
              {!activeToken?.isBase && tab === 'deposit' && (
                <span className="ml-1.5 ed-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: ACCENTS.amber }}>
                  · transfer
                </span>
              )}
            </Eyebrow>
            <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
              {tab === 'deposit' && is0GActive ? (
                <>
                  W0G{' '}
                  <span style={{ color: 'var(--ed-steel-50)' }}>
                    {wrappedBalNum.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                  {' · '}
                  Native{' '}
                  <span style={{ color: 'var(--ed-steel-50)' }}>
                    {nativeBalNum.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                </>
              ) : (
                <>
                  {tab === 'deposit' ? 'Wallet' : 'NAV'}{' '}
                  <span style={{ color: 'var(--ed-steel-50)' }}>
                    {displayBalance.toLocaleString(undefined, { maximumFractionDigits: balanceDecimals })}{' '}
                    {tab === 'deposit' ? activeSymbol : 'USDC'}
                  </span>
                </>
              )}
            </span>
          </div>
          <div
            className="flex items-center gap-2 rounded-xl px-3 h-12 mb-2"
            style={{ background: 'rgba(0,0,0,0.3)', boxShadow: 'var(--ed-ghost-border)' }}
          >
            <TokenIcon symbol={activeSymbol} size={16} />
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 bg-transparent outline-none ed-mono text-[18px]"
              style={{ color: 'var(--ed-steel-50)' }}
            />
            <button
              type="button"
              onClick={() => setAmount(String(displayBalance))}
              className="ed-mono text-[10px] uppercase tracking-[0.2em] transition-colors"
              style={{ color: ACCENTS.cyan }}
            >
              Max
            </button>
          </div>
          {tab === 'deposit' && !activeToken?.isBase && (
            <div
              className="rounded-lg px-2.5 py-1.5 mb-3 ed-mono text-[10px] leading-[1.5]"
              style={{ background: `${ACCENTS.amber}0D`, boxShadow: `inset 0 0 0 1px ${ACCENTS.amber}22`, color: '#F5C97E' }}
            >
              {activeSymbol} goes via plain transfer() — it does not update totalDeposited or mint shares.
            </div>
          )}
          <div className="grid grid-cols-3 gap-1.5 mb-4">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(String(p))}
                className="rounded-lg py-2 ed-mono text-[11px] transition-colors"
                style={{
                  background: Number(amount) === p ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
                  color: Number(amount) === p ? 'var(--ed-steel-50)' : 'var(--ed-steel-400)',
                  boxShadow: 'var(--ed-ghost-border)',
                }}
              >
                {p} {activeSymbol}
              </button>
            ))}
          </div>
          <div
            className="space-y-2 rounded-xl p-3 mb-3"
            style={{ background: 'rgba(0,0,0,0.2)', boxShadow: 'var(--ed-ghost-border)' }}
          >
            <TicketRow label={tab === 'deposit' ? 'Entry NAV' : 'Exit NAV'} value={`${sharePrice} / share`} />
            {tab === 'deposit' && estShares && <TicketRow label="Est. shares" value={estShares} />}
            <TicketRow
              label={tab === 'deposit' ? 'Entry fee' : 'Exit fee'}
              value={
                tab === 'deposit'
                  ? (activeToken?.isBase ? `${(feeBps / 100).toFixed(2)}%` : '—')
                  : withdrawIsRescue
                    ? '0% · non-base'
                    : `${(feeBps / 100).toFixed(2)}%`
              }
            />
            <TicketRow label="Cooldown" value="24 h · unstake" tone="amber" />
          </div>
          <ControlButton
            variant="primary"
            className="w-full"
            disabled={!isConnected || !amount || Number(amount) <= 0}
            onClick={onSubmit}
          >
            {tab === 'deposit' ? <Plus className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
            {tab === 'deposit'
              ? `Deposit ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: balanceDecimals })} ${activeSymbol}`
              : 'Request withdrawal'}
          </ControlButton>
          <div className="flex items-center justify-center mt-3 gap-1.5">
            <Shield className="w-2.5 h-2.5" style={{ color: 'var(--ed-steel-500)' }} />
            <span className="ed-mono text-[10px]" style={{ color: 'var(--ed-steel-500)' }}>
              On-chain settlement · signed intent
            </span>
          </div>
        </div>
      </div>
    </SectionHead>
  );
}

function TicketRow({ label, value, tone = 'default' }) {
  const color = tone === 'amber' ? ACCENTS.amber : 'var(--ed-steel-50)';
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11.5px]" style={{ color: 'var(--ed-steel-500)' }}>{label}</span>
      <span className="ed-mono text-[12px]" style={{ color }}>{value}</span>
    </div>
  );
}

/* ─────────────────── Fees panel ─────────────────── */

function FeesPanel({
  policy, feeState, liveNavUsd, feeRecipientExplorerHref, walletAddress, isConnected,
  accruePending, claimPending, claimSuccess, accrueSuccess, onAccrue, onClaim,
}) {
  const canClaim = walletAddress && walletAddress.toLowerCase() === (policy?.feeRecipient || '').toLowerCase();
  return (
    <SectionHead marker="Operator · fees">
      <div className="rounded-2xl p-5" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        <div className="grid grid-cols-4 gap-1.5 mb-4">
          <FeeChip label="Perf" value={formatBps(policy.performanceFeeBps)} tone="gold" />
          <FeeChip label="Mgmt" value={formatBps(policy.managementFeeBps)} tone="cyan" />
          <FeeChip label="Entry" value={formatBps(policy.entryFeeBps)} tone="steel" />
          <FeeChip label="Exit" value={formatBps(policy.exitFeeBps)} tone="steel" />
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="rounded-md px-3 py-2" style={{ background: 'rgba(255,255,255,0.02)', boxShadow: 'var(--ed-ghost-border)' }}>
            <Eyebrow tone="muted" className="!text-[9px]">Live NAV</Eyebrow>
            <div className="ed-italic text-[18px] mt-1" style={{ color: 'var(--ed-steel-50)' }}>
              ${liveNavUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="rounded-md px-3 py-2" style={{ background: 'rgba(255,255,255,0.02)', boxShadow: 'var(--ed-ghost-border)' }}>
            <Eyebrow tone="muted" className="!text-[9px]">High water</Eyebrow>
            <div className="ed-italic text-[18px] mt-1" style={{ color: ACCENTS.emerald }}>
              ${(feeState?.highWaterMark || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <div
          className="rounded-lg p-3 mb-3"
          style={{
            background: `linear-gradient(135deg, ${ACCENTS.gold}12, ${ACCENTS.gold}03)`,
            boxShadow: `inset 0 0 0 1px ${ACCENTS.gold}28`,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <Eyebrow tone="gold">Accrued fees</Eyebrow>
            {feeState?.lastFeeAccrual && (
              <span className="ed-mono text-[9.5px]" style={{ color: 'var(--ed-steel-500)' }}>
                Last: {new Date(feeState.lastFeeAccrual * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <FeeStatTile label="Mgmt" value={`$${(feeState?.accruedManagement || 0).toFixed(2)}`} color={ACCENTS.cyan} />
            <FeeStatTile label="Perf" value={`$${(feeState?.accruedPerformance || 0).toFixed(2)}`} color={ACCENTS.gold} />
            <FeeStatTile label="Total" value={`$${(feeState?.accruedTotal || 0).toFixed(2)}`} color="var(--ed-steel-50)" />
          </div>
        </div>

        {policy.feeRecipient && policy.feeRecipient !== '0x0000000000000000000000000000000000000000' && (
          <div
            className="flex items-center justify-between ed-mono text-[10px] px-3 py-1.5 rounded mb-3"
            style={{ background: 'rgba(255,255,255,0.02)', boxShadow: 'var(--ed-ghost-border)' }}
          >
            <span style={{ color: 'var(--ed-steel-500)' }}>Fee recipient</span>
            {feeRecipientExplorerHref ? (
              <a
                href={feeRecipientExplorerHref}
                target="_blank"
                rel="noreferrer"
                className="transition-colors"
                style={{ color: ACCENTS.cyan }}
              >
                {shortHexLabel(policy.feeRecipient)}
              </a>
            ) : (
              <span style={{ color: 'var(--ed-steel-50)' }}>{shortHexLabel(policy.feeRecipient)}</span>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <ControlButton variant="secondary" size="sm" disabled={!isConnected || accruePending} onClick={onAccrue}>
            <Hourglass className="w-3 h-3" />
            {accruePending ? 'Accruing…' : 'Accrue'}
          </ControlButton>
          <ControlButton
            variant="gold"
            size="sm"
            disabled={!isConnected || claimPending || !(feeState?.accruedTotal > 0) || !canClaim}
            onClick={onClaim}
          >
            <Wallet className="w-3 h-3" />
            {claimPending ? 'Claiming…' : 'Claim'}
          </ControlButton>
        </div>

        {claimSuccess && (
          <p className="ed-mono text-[10px] text-center mt-2" style={{ color: '#8AE6C2' }}>
            Fees claimed · 80% to operator · 20% to treasury
          </p>
        )}
        {accrueSuccess && (
          <p className="ed-mono text-[10px] text-center mt-2" style={{ color: ACCENTS.cyan }}>Fees accrued on-chain</p>
        )}

        {feeState?.pendingFeeChange?.pending && (
          <div
            className="mt-3 rounded-md px-3 py-2"
            style={{ background: `${ACCENTS.amber}0D`, boxShadow: `inset 0 0 0 1px ${ACCENTS.amber}26` }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="w-3 h-3" style={{ color: ACCENTS.amber }} />
              <Eyebrow tone="amber">Pending fee change</Eyebrow>
            </div>
            <div className="text-[10.5px] leading-[1.55]" style={{ color: 'var(--ed-steel-400)' }}>
              New: Perf {formatBps(feeState.pendingFeeChange.newPerformanceFeeBps)} · Mgmt {formatBps(feeState.pendingFeeChange.newManagementFeeBps)} · Entry {formatBps(feeState.pendingFeeChange.newEntryFeeBps)} · Exit {formatBps(feeState.pendingFeeChange.newExitFeeBps)}
            </div>
            <div className="ed-mono text-[9.5px] mt-1" style={{ color: 'var(--ed-steel-500)' }}>
              Effective {new Date(feeState.pendingFeeChange.effectiveAt * 1000).toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </SectionHead>
  );
}

function FeeChip({ label, value, tone }) {
  const color = ACCENTS[tone] || ACCENTS.steel;
  return (
    <div
      className="rounded-md px-2 py-1.5"
      style={{ background: `${color}0A`, boxShadow: `inset 0 0 0 1px ${color}26` }}
    >
      <div className="flex items-center gap-1 mb-0.5">
        <Eyebrow tone="muted" className="!text-[8px]">{label}</Eyebrow>
      </div>
      <div className="ed-mono text-[11px]" style={{ color }}>{value}</div>
    </div>
  );
}

function FeeStatTile({ label, value, color }) {
  return (
    <div>
      <Eyebrow tone="muted" className="!text-[9px]">{label}</Eyebrow>
      <div className="ed-italic text-[14px] mt-0.5" style={{ color }}>{value}</div>
    </div>
  );
}

/* ─────────────────── Briefing ─────────────────── */

function BriefingPanel({
  vaultAddress, executorAddress, operator, executorRegistered, networkName,
  mandateType, baseAssetSymbol, resolvedDecimals, lastExecTs, dailyActions,
  maxActionsPerDay, executorSyncLabel, executorSyncTone, onCopy, addressCopied,
  vaultExplorerHref, executorExplorerHref,
}) {
  const rows = [
    {
      label: 'Address',
      value: (
        <a
          href={vaultExplorerHref || '#'}
          target={vaultExplorerHref ? '_blank' : undefined}
          rel={vaultExplorerHref ? 'noreferrer' : undefined}
          className="ed-mono text-[12px] transition-colors"
          style={{ color: vaultExplorerHref ? ACCENTS.cyan : 'var(--ed-steel-50)' }}
          onClick={(e) => { if (!vaultExplorerHref) e.preventDefault(); }}
        >
          {shortHexLabel(vaultAddress, 8, 6)}
        </a>
      ),
      copyValue: vaultAddress,
      copyKey: 'vault',
    },
    {
      label: 'Executor',
      value: (
        <a
          href={executorExplorerHref || '#'}
          target={executorExplorerHref ? '_blank' : undefined}
          rel={executorExplorerHref ? 'noreferrer' : undefined}
          className="ed-mono text-[12px] transition-colors"
          style={{ color: executorExplorerHref ? ACCENTS.cyan : 'var(--ed-steel-50)' }}
          onClick={(e) => { if (!executorExplorerHref) e.preventDefault(); }}
        >
          {executorAddress ? shortHexLabel(executorAddress, 8, 6) : 'Unset'}
        </a>
      ),
      copyValue: executorAddress,
      copyKey: 'executor',
    },
    {
      label: 'Operator',
      value: operator?.name ? (
        <span className="ed-mono text-[12px]" style={{ color: ACCENTS.cyan }}>{operator.name}</span>
      ) : (
        <span className="ed-mono text-[12px] italic" style={{ color: 'var(--ed-steel-500)' }}>
          {executorRegistered === false ? 'Unregistered' : 'Loading…'}
        </span>
      ),
    },
    {
      label: 'Sync',
      value: (
        <Chip tone={executorSyncTone} dense leading={<StatusDot tone={executorSyncTone} size={5} pulse={executorSyncTone === 'emerald'} />}>
          {executorSyncLabel}
        </Chip>
      ),
    },
    { label: 'Network', value: <span className="ed-mono text-[12px]" style={{ color: 'var(--ed-steel-50)' }}>{networkName}</span> },
    { label: 'Asset', value: <span className="ed-mono text-[12px]" style={{ color: 'var(--ed-steel-50)' }}>{baseAssetSymbol} · {resolvedDecimals} decimals</span> },
    { label: 'Policy', value: <span className="ed-mono text-[12px]" style={{ color: 'var(--ed-steel-50)' }}>{mandateType} · v1</span> },
    { label: 'Last action', value: <span className="ed-mono text-[12px]" style={{ color: 'var(--ed-steel-50)' }}>{lastExecTs ? formatTime(lastExecTs) : 'Never'}</span> },
    { label: 'Actions today', value: <span className="ed-mono text-[12px]" style={{ color: 'var(--ed-steel-50)' }}>{dailyActions} / {maxActionsPerDay || 0}</span> },
  ];

  return (
    <SectionHead marker="Vault · briefing">
      <div className="rounded-2xl p-5 space-y-2.5" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-1">
            <Eyebrow tone="muted">{row.label}</Eyebrow>
            <div className="flex items-center gap-2 min-w-0">
              <div className="truncate">{row.value}</div>
              {row.copyKey && row.copyValue && (
                <button
                  type="button"
                  onClick={() => onCopy(row.copyKey, row.copyValue)}
                  className="transition-colors"
                  style={{ color: addressCopied === row.copyKey ? ACCENTS.emerald : 'var(--ed-steel-500)' }}
                  title={addressCopied === row.copyKey ? 'Copied' : 'Copy'}
                >
                  {addressCopied === row.copyKey ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </SectionHead>
  );
}

/* ─────────────────── System controls ─────────────────── */

function SystemControlsPanel({
  isConnected, isPaused, pausePending, unpausePending, onPause, onExecutor, onEditPolicy, onExport,
  executorMatches, recentTxs, withdrawSuccess, depositSuccess, policySuccess, executorSuccess,
}) {
  return (
    <SectionHead marker="System · controls">
      <div className="rounded-2xl p-4 space-y-2" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        <ControlButton
          variant={isPaused ? 'gold' : 'danger'}
          className="w-full"
          disabled={!isConnected || pausePending || unpausePending}
          onClick={onPause}
        >
          {isPaused ? (
            <><PlayCircle className="w-3.5 h-3.5" /> {unpausePending ? 'Resuming…' : 'Resume vault'}</>
          ) : (
            <><PauseCircle className="w-3.5 h-3.5" /> {pausePending ? 'Pausing…' : 'Emergency pause'}</>
          )}
        </ControlButton>
        <ControlButton
          variant={executorMatches ? 'secondary' : 'gold'}
          className="w-full"
          disabled={!isConnected}
          onClick={onExecutor}
        >
          <Cpu className="w-3 h-3" /> {executorMatches ? 'Executor linked' : 'Set executor'}
        </ControlButton>
        <ControlButton variant="secondary" className="w-full" disabled={!isConnected} onClick={onEditPolicy}>
          <Settings className="w-3 h-3" /> Edit policy
        </ControlButton>
        <ControlButton variant="secondary" className="w-full" onClick={onExport}>
          <Download className="w-3 h-3" /> Export journal
        </ControlButton>

        {withdrawSuccess && <p className="ed-mono text-[10px] text-center mt-1" style={{ color: '#8AE6C2' }}>Withdrawal submitted</p>}
        {depositSuccess && <p className="ed-mono text-[10px] text-center mt-1" style={{ color: '#8AE6C2' }}>Deposit submitted</p>}
        {policySuccess && <p className="ed-mono text-[10px] text-center mt-1" style={{ color: '#8AE6C2' }}>Policy updated on-chain</p>}
        {executorSuccess && <p className="ed-mono text-[10px] text-center mt-1" style={{ color: '#8AE6C2' }}>Executor updated on-chain</p>}

        {recentTxs.length > 0 && (
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <Eyebrow tone="cyan" className="!text-[10px] mb-2 block">Latest wallet transactions</Eyebrow>
            <div className="flex flex-col gap-1.5">
              {recentTxs.slice(0, 6).map((tx) => (
                <a
                  key={tx.href}
                  href={tx.href}
                  target="_blank"
                  rel="noreferrer"
                  className="ed-mono text-[10px] transition-colors"
                  style={{ color: ACCENTS.cyan }}
                >
                  {tx.label} · {shortHexLabel(tx.hash, 8, 4)} ↗
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionHead>
  );
}

/* ─────────────────── Modal shell ─────────────────── */

function ModalShell({ title, onClose, children, tone = 'default' }) {
  const borderColor = tone === 'gold' ? 'rgba(201,168,76,0.28)' : 'rgba(255,255,255,0.08)';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
      <div className="absolute inset-0" style={{ background: 'rgba(5,5,7,0.8)', backdropFilter: 'blur(8px)' }} onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-2xl p-6"
        style={{
          background: '#0F0F13',
          boxShadow: `inset 0 0 0 1px ${borderColor}, 0 24px 60px rgba(0,0,0,0.55)`,
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h4 className="ed-display text-[16px] m-0" style={{ color: 'var(--ed-steel-50)' }}>{title}</h4>
          <button
            type="button"
            onClick={onClose}
            className="transition-colors"
            style={{ color: 'var(--ed-steel-500)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─────────────────── Deposit modal ─────────────────── */

function DepositModal({
  onClose, depositStep, setDepositStep, depositTokens, selectedDepositToken, setSelectedDepositToken,
  depositAmount, setDepositAmount, approve, approvePending, approveSuccess,
  transferToken, transferPending, deposit, depositPending,
  wrapNative, wrapPending, wrapSuccess, refetchW0g, refetchNative,
  vaultAddr, refetch,
}) {
  // 0G special case: we auto-wrap native → W0G when the user's W0G balance is
  // short of the deposit amount, then transfer W0G to the vault. Wrap amount is
  // only the gap (keeps gas minimal and preserves any existing W0G balance).
  const is0G = selectedDepositToken.symbol === '0G';
  const wrappedBal = parseFloat(selectedDepositToken.wrappedBalance || '0');
  const nativeBal = parseFloat(selectedDepositToken.nativeBalance || '0');
  const targetAmount = parseFloat(depositAmount || '0');
  const wrapGap = Math.max(0, targetAmount - wrappedBal);
  const needsWrap = is0G && wrapGap > 0;
  const canCoverWithWrap = is0G && nativeBal >= wrapGap;
  const balanceDecimals = selectedDepositToken.symbol === 'USDC' ? 2 : 6;

  return (
    <ModalShell title="Deposit to vault" onClose={onClose} tone="gold">
      <div className="space-y-4">
        {depositStep === 'input' && (
          <>
            <div>
              <Eyebrow tone="muted" className="!block mb-2">Select token</Eyebrow>
              <div className="flex gap-2 flex-wrap">
                {depositTokens.map((t) => (
                  <button
                    key={t.symbol}
                    type="button"
                    onClick={() => { setSelectedDepositToken(t); setDepositAmount(''); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md ed-mono text-[11px] transition-all"
                    style={{
                      background: selectedDepositToken.symbol === t.symbol ? `${ACCENTS.gold}26` : 'rgba(255,255,255,0.03)',
                      color: selectedDepositToken.symbol === t.symbol ? ACCENTS.gold : 'var(--ed-steel-400)',
                      boxShadow: selectedDepositToken.symbol === t.symbol
                        ? `inset 0 0 0 1px ${ACCENTS.gold}4A`
                        : 'var(--ed-ghost-border)',
                    }}
                  >
                    <TokenIcon symbol={t.symbol} size={14} />
                    {t.symbol}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Eyebrow tone="muted">Amount ({selectedDepositToken.symbol})</Eyebrow>
                <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
                  {is0G ? (
                    <>
                      W0G <span style={{ color: 'var(--ed-steel-50)' }}>
                        {wrappedBal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                      {' · '}
                      Native <span style={{ color: 'var(--ed-steel-50)' }}>
                        {nativeBal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                    </>
                  ) : (
                    <>
                      Wallet <span style={{ color: 'var(--ed-steel-50)' }}>
                        {parseFloat(selectedDepositToken.balance).toLocaleString(undefined, { maximumFractionDigits: balanceDecimals })}
                      </span>
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-xl px-3 h-11" style={{ background: 'rgba(0,0,0,0.3)', boxShadow: 'var(--ed-ghost-border)' }}>
                <TokenIcon symbol={selectedDepositToken.symbol} size={16} />
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-transparent outline-none ed-mono text-[16px]"
                  style={{ color: 'var(--ed-steel-50)' }}
                />
                <button
                  type="button"
                  onClick={() => setDepositAmount(selectedDepositToken.balance)}
                  className="ed-mono text-[10px] uppercase tracking-[0.2em] transition-colors"
                  style={{ color: ACCENTS.cyan }}
                >
                  Max
                </button>
              </div>
            </div>

            {is0G && needsWrap && (
              <div
                className="rounded-lg px-3 py-2 ed-mono text-[10px] leading-[1.5]"
                style={{ background: `${ACCENTS.cyan}0D`, boxShadow: `inset 0 0 0 1px ${ACCENTS.cyan}22`, color: 'var(--ed-cyan-ink)' }}
              >
                Auto-wrap: {wrapGap.toLocaleString(undefined, { maximumFractionDigits: 4 })} native 0G → W0G before
                {selectedDepositToken.isBase ? ' deposit.' : ' transfer.'}
                {' '}Requires {selectedDepositToken.isBase ? '3 signatures (wrap + approve + deposit)' : '2 signatures (wrap + transfer)'}.
              </div>
            )}

            {!selectedDepositToken.isBase && !is0G && (
              <div
                className="rounded-lg px-3 py-2 ed-mono text-[10px]"
                style={{ background: `${ACCENTS.amber}0D`, boxShadow: `inset 0 0 0 1px ${ACCENTS.amber}22`, color: '#F5C97E' }}
              >
                {selectedDepositToken.symbol} transfers go directly to the vault contract. This does not update totalDeposited (base asset tracking).
              </div>
            )}

            <div className="flex gap-2">
              <ControlButton
                variant="primary"
                className="flex-1"
                disabled={
                  !depositAmount ||
                  parseFloat(depositAmount) <= 0 ||
                  (is0G && !canCoverWithWrap)
                }
                onClick={() => setDepositStep('approve')}
              >
                Continue
              </ControlButton>
              <ControlButton variant="secondary" className="flex-1" onClick={onClose}>Cancel</ControlButton>
            </div>
            {is0G && !canCoverWithWrap && targetAmount > 0 && (
              <p className="ed-mono text-[10px] text-center" style={{ color: '#F4A0B3' }}>
                Insufficient 0G. You have {(wrappedBal + nativeBal).toLocaleString(undefined, { maximumFractionDigits: 4 })} combined.
              </p>
            )}
          </>
        )}

        {/* Base-asset approve+deposit step. Fires for:
              - Any non-0G base asset (USDC / WBTC / WETH vault)
              - 0G when W0G balance already covers (no wrap needed). The
                wrap block below takes precedence when needsWrap=true. */}
        {depositStep === 'approve' && selectedDepositToken.isBase && (!is0G || !needsWrap) && (
          <>
            <div className="text-center py-2">
              <div className="flex justify-center mb-2"><TokenIcon symbol={selectedDepositToken.symbol} size={28} /></div>
              <p className="ed-mono text-[11.5px] uppercase tracking-[0.2em]" style={{ color: 'var(--ed-steel-50)' }}>
                Step 1 / 2 · Approve {selectedDepositToken.symbol}
              </p>
              <p className="ed-mono text-[10.5px] mt-1" style={{ color: 'var(--ed-steel-500)' }}>
                Allow the vault to use {depositAmount} {selectedDepositToken.symbol}
              </p>
            </div>
            <div className="flex gap-2">
              <ControlButton
                variant="gold"
                className="flex-1"
                disabled={approvePending}
                onClick={() => approve(selectedDepositToken.address, vaultAddr, depositAmount, selectedDepositToken.decimals)}
              >
                {approvePending ? 'Approving…' : `Approve ${selectedDepositToken.symbol}`}
              </ControlButton>
              <ControlButton variant="secondary" className="flex-1" onClick={() => setDepositStep('input')}>Back</ControlButton>
            </div>
            {approveSuccess && (
              <ControlButton variant="primary" className="w-full" onClick={() => setDepositStep('deposit')}>
                Approved · continue to deposit
              </ControlButton>
            )}
          </>
        )}

        {depositStep === 'approve' && is0G && needsWrap && (
          <>
            <div className="text-center py-2">
              <div className="flex justify-center mb-2"><TokenIcon symbol="0G" size={28} /></div>
              <p className="ed-mono text-[11.5px] uppercase tracking-[0.2em]" style={{ color: 'var(--ed-steel-50)' }}>
                Step 1 / {selectedDepositToken.isBase ? '3' : '2'} · Wrap native 0G
              </p>
              <p className="ed-mono text-[10.5px] mt-1" style={{ color: 'var(--ed-steel-500)' }}>
                Convert {wrapGap.toLocaleString(undefined, { maximumFractionDigits: 4 })} native 0G → W0G
              </p>
            </div>
            <div className="flex gap-2">
              <ControlButton
                variant="gold"
                className="flex-1"
                disabled={wrapPending || wrapSuccess}
                onClick={() => wrapNative(selectedDepositToken.address, wrapGap.toString(), selectedDepositToken.decimals)}
              >
                {wrapPending ? 'Wrapping…' : wrapSuccess ? 'Wrapped ✓' : `Wrap ${wrapGap.toFixed(4)} 0G`}
              </ControlButton>
              <ControlButton variant="secondary" className="flex-1" onClick={() => setDepositStep('input')}>Back</ControlButton>
            </div>
            {wrapSuccess && (
              <ControlButton
                variant="primary"
                className="w-full"
                onClick={() => {
                  refetchW0g?.();
                  refetchNative?.();
                  // For a W0G-base vault we continue with the proper
                  // approve → deposit path; for non-base vaults we fall back
                  // to the bare transfer flow (no accounting update).
                  setDepositStep(selectedDepositToken.isBase ? 'approveW0g' : 'transfer0g');
                }}
              >
                {selectedDepositToken.isBase ? 'Wrapped · continue to approve' : 'Wrapped · continue to transfer'}
              </ControlButton>
            )}
          </>
        )}

        {/* Intermediate approve step for W0G-base vaults after wrap, before
            vault.deposit() is called. Kept separate from the base approve
            block so we don't have to re-run the needsWrap check on stale
            balance state. */}
        {depositStep === 'approveW0g' && is0G && selectedDepositToken.isBase && (
          <>
            <div className="text-center py-2">
              <div className="flex justify-center mb-2"><TokenIcon symbol="0G" size={28} /></div>
              <p className="ed-mono text-[11.5px] uppercase tracking-[0.2em]" style={{ color: 'var(--ed-steel-50)' }}>
                Step 2 / 3 · Approve W0G
              </p>
              <p className="ed-mono text-[10.5px] mt-1" style={{ color: 'var(--ed-steel-500)' }}>
                Allow the vault to use {depositAmount} W0G
              </p>
            </div>
            <div className="flex gap-2">
              <ControlButton
                variant="gold"
                className="flex-1"
                disabled={approvePending}
                onClick={() => approve(selectedDepositToken.address, vaultAddr, depositAmount, selectedDepositToken.decimals)}
              >
                {approvePending ? 'Approving…' : 'Approve W0G'}
              </ControlButton>
              <ControlButton variant="secondary" className="flex-1" onClick={() => setDepositStep('approve')}>Back</ControlButton>
            </div>
            {approveSuccess && (
              <ControlButton variant="primary" className="w-full" onClick={() => setDepositStep('deposit')}>
                Approved · continue to deposit
              </ControlButton>
            )}
          </>
        )}

        {depositStep === 'approve' && is0G && !needsWrap && !selectedDepositToken.isBase && (
          <TransferNonBaseStep
            token={selectedDepositToken}
            amount={depositAmount}
            transferToken={transferToken}
            transferPending={transferPending}
            vaultAddr={vaultAddr}
            refetch={refetch}
            onClose={onClose}
            setDepositStep={setDepositStep}
          />
        )}

        {depositStep === 'approve' && !selectedDepositToken.isBase && !is0G && (
          <TransferNonBaseStep
            token={selectedDepositToken}
            amount={depositAmount}
            transferToken={transferToken}
            transferPending={transferPending}
            vaultAddr={vaultAddr}
            refetch={refetch}
            onClose={onClose}
            setDepositStep={setDepositStep}
          />
        )}

        {depositStep === 'transfer0g' && (
          <>
            <div className="text-center py-2">
              <div className="flex justify-center mb-2"><TokenIcon symbol="0G" size={28} /></div>
              <p className="ed-mono text-[11.5px] uppercase tracking-[0.2em]" style={{ color: 'var(--ed-steel-50)' }}>
                Step 2 / 2 · Transfer W0G
              </p>
              <p className="ed-mono text-[10.5px] mt-1" style={{ color: 'var(--ed-steel-500)' }}>
                Send {depositAmount} W0G directly to vault
              </p>
            </div>
            <div className="flex gap-2">
              <ControlButton
                variant="primary"
                className="flex-1"
                disabled={transferPending}
                onClick={() => {
                  transferToken(selectedDepositToken.address, vaultAddr, depositAmount, selectedDepositToken.decimals);
                  setTimeout(() => { onClose(); setDepositStep('input'); refetch(); }, 4000);
                }}
              >
                {transferPending ? 'Sending…' : 'Send W0G'}
              </ControlButton>
              <ControlButton variant="secondary" className="flex-1" onClick={() => setDepositStep('approve')}>Back</ControlButton>
            </div>
          </>
        )}

        {depositStep === 'deposit' && (
          <>
            <div className="text-center py-2">
              <div className="flex justify-center mb-2"><TokenIcon symbol={selectedDepositToken.symbol} size={28} /></div>
              <p className="ed-mono text-[11.5px] uppercase tracking-[0.2em]" style={{ color: 'var(--ed-steel-50)' }}>
                {is0G && needsWrap ? 'Step 3 / 3' : 'Step 2 / 2'} · Deposit to vault
              </p>
              <p className="ed-mono text-[10.5px] mt-1" style={{ color: 'var(--ed-steel-500)' }}>
                Depositing {depositAmount} {selectedDepositToken.symbol}
              </p>
            </div>
            <div className="flex gap-2">
              <ControlButton
                variant="primary"
                className="flex-1"
                disabled={depositPending}
                onClick={() => {
                  deposit(vaultAddr, depositAmount, selectedDepositToken.decimals);
                  setTimeout(() => { onClose(); setDepositStep('input'); refetch(); }, 4000);
                }}
              >
                {depositPending ? 'Depositing…' : 'Confirm deposit'}
              </ControlButton>
              <ControlButton variant="secondary" className="flex-1" onClick={() => setDepositStep('approve')}>Back</ControlButton>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

function TransferNonBaseStep({
  token, amount, transferToken, transferPending, vaultAddr, refetch, onClose, setDepositStep,
}) {
  const isW0g = token.symbol === '0G';
  return (
    <>
      <div className="text-center py-2">
        <div className="flex justify-center mb-2"><TokenIcon symbol={token.symbol} size={28} /></div>
        <p className="ed-mono text-[11.5px] uppercase tracking-[0.2em]" style={{ color: 'var(--ed-steel-50)' }}>
          Transfer {isW0g ? 'W0G' : token.symbol}
        </p>
        <p className="ed-mono text-[10.5px] mt-1" style={{ color: 'var(--ed-steel-500)' }}>
          Send {amount} {isW0g ? 'W0G' : token.symbol} directly to vault
        </p>
      </div>
      <div className="flex gap-2">
        <ControlButton
          variant="primary"
          className="flex-1"
          disabled={transferPending}
          onClick={() => {
            transferToken(token.address, vaultAddr, amount, token.decimals);
            setTimeout(() => { onClose(); setDepositStep('input'); refetch(); }, 4000);
          }}
        >
          {transferPending ? 'Sending…' : `Send ${isW0g ? 'W0G' : token.symbol}`}
        </ControlButton>
        <ControlButton variant="secondary" className="flex-1" onClick={() => setDepositStep('input')}>Back</ControlButton>
      </div>
    </>
  );
}

/* ─────────────────── Withdraw modal ─────────────────── */

function WithdrawModal({
  onClose, withdrawAmount, setWithdrawAmount, withdraw, withdrawPending, vaultAddr, refetch, liveVault, hasLive,
  baseAssetSymbol = 'USDC', baseAssetDecimals = 6,
  // v2 additions — silently ignored on v1 vaults
  vaultVersion = 'v1', vaultAssetRows = [], depositTokens = [],
  withdrawToken, withdrawTokenPending, withdrawAllNonBase, withdrawAllPending,
  // Pre-selected token from the CapitalTicket withdraw picker (optional).
  initialWithdrawSymbol = null,
}) {
  const isV2 = vaultSupportsMultiAssetWithdraw(vaultVersion);

  // For v2: build a display row per allowed asset that has a positive vault
  // balance, picking symbol/decimals from the depositTokens registry so
  // labels are consistent with the deposit UI.
  const tokenMeta = (addr) => depositTokens.find(
    (t) => t.address?.toLowerCase() === addr?.toLowerCase()
  );
  const withdrawableRows = isV2
    ? vaultAssetRows
        .map((row) => {
          const meta = tokenMeta(row.address);
          const dec = meta?.decimals ?? 18;
          const raw = row.balance ?? 0n;
          const formatted = (() => {
            try { return formatUnits(raw, dec); } catch { return '0'; }
          })();
          const isBase = !!meta?.isBase
            || row.address?.toLowerCase() === liveVault?.baseAsset?.toLowerCase();
          return {
            address: row.address,
            symbol: meta?.symbol || (isBase ? baseAssetSymbol : 'Unknown'),
            decimals: dec,
            balance: parseFloat(formatted),
            isBase,
          };
        })
        // Keep every allowed asset visible — zero balance is signalled by the
        // balance column, not by hiding the pill. User can still see what
        // tokens the vault is capable of holding.
    : [];

  // Selected token in v2 mode. Seeded from the CapitalTicket picker when
  // provided, otherwise defaults to base asset.
  const seededRow = isV2 && initialWithdrawSymbol
    ? withdrawableRows.find((r) => r.symbol === initialWithdrawSymbol)
    : null;
  const [v2Selected, setV2Selected] = useState(seededRow || null);
  const activeRow = isV2
    ? (v2Selected || withdrawableRows.find((r) => r.isBase) || withdrawableRows[0])
    : null;
  const activeIsBase = isV2 ? !!activeRow?.isBase : true;
  const activeSymbol = isV2 ? (activeRow?.symbol || baseAssetSymbol) : baseAssetSymbol;
  const activeDecimals = isV2 ? (activeRow?.decimals ?? baseAssetDecimals) : baseAssetDecimals;
  const activeBalance = isV2
    ? (activeRow?.balance ?? 0)
    : (hasLive ? parseFloat(liveVault.balance) : 0);

  const isStable = activeSymbol === 'USDC' || activeSymbol === 'USDCe';
  const availablePrefix = isStable ? '$' : '';

  const nonBaseCount = withdrawableRows.filter((r) => !r.isBase).length;
  const pending = withdrawPending || withdrawTokenPending;

  const handleConfirm = () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) return;
    if (!isV2 || activeIsBase) {
      // v1 or v2 base asset — goes through vault.withdraw() (fee applies)
      withdraw(vaultAddr, withdrawAmount, activeDecimals);
    } else {
      // v2 non-base rescue — no fee
      withdrawToken(vaultAddr, activeRow.address, withdrawAmount, activeDecimals);
    }
    setTimeout(() => { onClose(); refetch?.(); }, 3000);
  };

  const handleDrainAllNonBase = () => {
    withdrawAllNonBase(vaultAddr);
    setTimeout(() => { onClose(); refetch?.(); }, 3000);
  };

  return (
    <ModalShell title={`Withdraw ${isV2 ? 'from vault' : baseAssetSymbol}`} onClose={onClose}>
      <div className="space-y-4">
        {/* v2-only: multi-asset token selector */}
        {isV2 && withdrawableRows.length > 0 && (
          <div>
            <Eyebrow tone="muted" className="!block mb-2">Token</Eyebrow>
            <div className="flex gap-1.5 flex-wrap">
              {withdrawableRows.map((r) => {
                const active = (activeRow?.address || '').toLowerCase() === r.address.toLowerCase();
                const hasBalance = (r.balance ?? 0) > 0;
                return (
                  <button
                    key={r.address}
                    type="button"
                    onClick={() => { setV2Selected(r); setWithdrawAmount(''); }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md ed-mono text-[10.5px] transition-colors"
                    style={{
                      background: active ? `${ACCENTS.gold}22` : 'rgba(255,255,255,0.02)',
                      color: active ? ACCENTS.gold : 'var(--ed-steel-400)',
                      boxShadow: active ? `inset 0 0 0 1px ${ACCENTS.gold}4A` : 'var(--ed-ghost-border)',
                      opacity: active || hasBalance ? 1 : 0.45,
                    }}
                  >
                    <TokenIcon symbol={r.symbol} size={13} />
                    {r.symbol}
                    {r.isBase && <span className="ml-0.5 text-[8.5px]" style={{ color: 'var(--ed-steel-500)' }}>· base</span>}
                    {!hasBalance && !r.isBase && (
                      <span className="ml-0.5 text-[8.5px]" style={{ color: 'var(--ed-steel-600)' }}>· empty</span>
                    )}
                  </button>
                );
              })}
            </div>
            {!activeIsBase && (
              <p className="mt-2 ed-mono text-[10px] leading-[1.5]" style={{ color: 'var(--ed-steel-500)' }}>
                No exit fee for non-base assets. Base asset withdrawal still uses the
                standard fee path.
              </p>
            )}
          </div>
        )}

        <div>
          <Eyebrow tone="muted" className="!block mb-2">Amount ({activeSymbol})</Eyebrow>
          <div className="flex items-center gap-2 rounded-xl px-3 h-11" style={{ background: 'rgba(0,0,0,0.3)', boxShadow: 'var(--ed-ghost-border)' }}>
            <input
              type="number"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 bg-transparent outline-none ed-mono text-[16px]"
              style={{ color: 'var(--ed-steel-50)' }}
            />
            {activeBalance > 0 && (
              <button
                type="button"
                onClick={() => setWithdrawAmount(String(activeBalance))}
                className="ed-mono text-[10px] uppercase tracking-[0.2em] transition-colors"
                style={{ color: ACCENTS.cyan }}
              >
                Max
              </button>
            )}
          </div>
          {activeBalance > 0 && (
            <div className="mt-2 ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
              Available <span style={{ color: 'var(--ed-steel-50)' }}>{availablePrefix}{activeBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span> {activeSymbol}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <ControlButton
            variant="primary"
            className="flex-1"
            disabled={!withdrawAmount || pending || parseFloat(withdrawAmount) <= 0}
            onClick={handleConfirm}
          >
            {pending
              ? 'Withdrawing…'
              : (activeIsBase ? 'Confirm withdraw' : `Withdraw ${activeSymbol}`)}
          </ControlButton>
          <ControlButton variant="secondary" className="flex-1" onClick={onClose}>Cancel</ControlButton>
        </div>

        {/* v2-only: drain-all-non-base shortcut. Only show when at least one
            non-base asset is sitting in the vault. */}
        {isV2 && nonBaseCount > 0 && (
          <div className="pt-3 border-t border-white/[0.05]">
            <p className="ed-mono text-[10px] mb-2" style={{ color: 'var(--ed-steel-500)' }}>
              Vault currently holds {nonBaseCount} non-base asset{nonBaseCount === 1 ? '' : 's'}.
              One-tap drain sends them all back to you (no fee).
            </p>
            <ControlButton
              variant="secondary"
              className="w-full"
              disabled={withdrawAllPending}
              onClick={handleDrainAllNonBase}
            >
              {withdrawAllPending ? 'Draining…' : `Withdraw all non-base (${nonBaseCount})`}
            </ControlButton>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

/* ─────────────────── Executor modal ─────────────────── */

function ExecutorModal({
  onClose, executorForm, setExecutorForm, executorAddress, executorSyncLabel, executorSyncTone,
  activeOrchestratorExecutor, activeOrchestratorExecutors, activeOrchestratorExecutorSummary,
  activeMarketplaceOps, setExecutor, executorPending, vaultAddr, refetch, liveVault, hasLive,
}) {
  return (
    <ModalShell title="Set vault executor" onClose={onClose}>
      <p className="text-[11.5px] leading-[1.55] mb-4" style={{ color: 'var(--ed-steel-400)' }}>
        Point this vault to the wallet used by your orchestrator. The owner keeps custody, while the executor only submits
        intents that still pass on-chain policy checks.
      </p>

      <div className="rounded-lg px-3 py-3 space-y-2 mb-3" style={{ background: 'rgba(255,255,255,0.02)', boxShadow: 'var(--ed-ghost-border)' }}>
        <div className="flex justify-between gap-3">
          <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-500)' }}>Current executor</span>
          <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-50)' }}>{executorAddress ? shortHexLabel(executorAddress, 8, 6) : '—'}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-500)' }}>Active API executor</span>
          <span className="ed-mono text-[11px]" style={{ color: ACCENTS.cyan }}>{activeOrchestratorExecutorSummary || 'Not detected'}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-500)' }}>Sync status</span>
          <Chip tone={executorSyncTone} dense leading={<StatusDot tone={executorSyncTone} size={5} pulse={executorSyncTone === 'emerald'} />}>
            {executorSyncLabel}
          </Chip>
        </div>
      </div>

      {activeOrchestratorExecutor && (
        <ControlButton variant="gold" className="w-full mb-3" onClick={() => setExecutorForm(activeOrchestratorExecutor)}>
          <Cpu className="w-3 h-3" />
          {activeOrchestratorExecutors.length > 1 ? 'Use primary orchestrator wallet' : 'Use active orchestrator wallet'}
        </ControlButton>
      )}

      {activeMarketplaceOps.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <Eyebrow tone="muted">Pick from marketplace ({activeMarketplaceOps.length})</Eyebrow>
            <Link to="/marketplace" className="ed-mono text-[10px] transition-colors" style={{ color: ACCENTS.cyan }}>Browse →</Link>
          </div>
          <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
            {activeMarketplaceOps.map((op) => {
              const selected = executorForm.toLowerCase() === op.wallet.toLowerCase();
              return (
                <button
                  key={op.wallet}
                  type="button"
                  onClick={() => setExecutorForm(op.wallet)}
                  className="w-full text-left px-3 py-2 rounded-md transition-colors"
                  style={{
                    background: selected ? `${ACCENTS.gold}0D` : 'rgba(255,255,255,0.02)',
                    boxShadow: selected ? `inset 0 0 0 1px ${ACCENTS.gold}4A` : 'var(--ed-ghost-border)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Cpu className="w-3 h-3" style={{ color: ACCENTS.gold, opacity: 0.6 }} />
                    <span className="text-[11.5px] font-medium truncate" style={{ color: 'var(--ed-steel-50)' }}>{op.name}</span>
                    <Chip tone="steel" dense>{op.mandateLabel}</Chip>
                  </div>
                  <div className="ed-mono text-[9.5px] mt-0.5 truncate" style={{ color: 'var(--ed-steel-500)' }}>{op.wallet}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-3">
        <Eyebrow tone="muted" className="!block mb-2">Executor address</Eyebrow>
        <input
          type="text"
          value={executorForm}
          onChange={(e) => setExecutorForm(e.target.value.trim())}
          placeholder="0x…"
          spellCheck="false"
          className="w-full rounded-xl px-3 py-2 ed-mono text-[13px] outline-none"
          style={{ background: 'rgba(0,0,0,0.3)', boxShadow: 'var(--ed-ghost-border)', color: 'var(--ed-steel-50)' }}
        />
        {!isAddress(executorForm || '') && executorForm && (
          <p className="ed-mono text-[10.5px] mt-2" style={{ color: ACCENTS.rose }}>Enter a valid EVM address.</p>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <ControlButton
          variant="primary"
          className="flex-1"
          disabled={
            !hasLive ||
            !isAddress(executorForm || '') ||
            executorForm.toLowerCase() === (liveVault?.executor || '').toLowerCase() ||
            executorPending
          }
          onClick={() => {
            setExecutor(vaultAddr, executorForm);
            setTimeout(() => { onClose(); refetch(); }, 3000);
          }}
        >
          {executorPending ? 'Updating…' : 'Update executor'}
        </ControlButton>
        <ControlButton variant="secondary" className="flex-1" onClick={onClose}>Cancel</ControlButton>
      </div>
    </ModalShell>
  );
}

/* ─────────────────── Policy modal ─────────────────── */

function PolicyModal({ onClose, policyForm, setPolicyForm, updatePolicy, policyPending, vaultAddr, refetch }) {
  const params = [
    { key: 'maxPositionBps', label: 'Max Position (bps)', min: 100, max: 10000 },
    { key: 'maxDailyLossBps', label: 'Max Daily Loss (bps)', min: 50, max: 5000 },
    { key: 'stopLossBps', label: 'Stop-Loss (bps)', min: 100, max: 5000 },
    { key: 'cooldownSeconds', label: 'Cooldown (seconds)', min: 10, max: 3600 },
    { key: 'confidenceThresholdBps', label: 'Confidence Min (bps)', min: 1000, max: 9500 },
    { key: 'maxActionsPerDay', label: 'Max Actions / Day', min: 1, max: 100 },
  ];
  return (
    <ModalShell title="Edit vault policy" onClose={onClose} tone="gold">
      <div className="space-y-3">
        {params.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-3">
            <span className="text-[11.5px]" style={{ color: 'var(--ed-steel-300)' }}>{p.label}</span>
            <input
              type="number"
              value={policyForm[p.key]}
              onChange={(e) => setPolicyForm((prev) => ({ ...prev, [p.key]: Number(e.target.value) }))}
              min={p.min}
              max={p.max}
              className="w-24 rounded-lg px-2 py-1 ed-mono text-[12px] text-right outline-none"
              style={{ background: 'rgba(0,0,0,0.3)', boxShadow: 'var(--ed-ghost-border)', color: 'var(--ed-steel-50)' }}
            />
          </div>
        ))}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11.5px]" style={{ color: 'var(--ed-steel-300)' }}>Auto-execution</span>
          <button
            type="button"
            onClick={() => setPolicyForm((prev) => ({ ...prev, autoExecution: !prev.autoExecution }))}
            className="px-3 py-1 rounded ed-mono text-[10.5px] transition-colors"
            style={{
              background: policyForm.autoExecution ? `${ACCENTS.emerald}26` : 'rgba(255,255,255,0.04)',
              color: policyForm.autoExecution ? '#8AE6C2' : 'var(--ed-steel-400)',
              boxShadow: policyForm.autoExecution
                ? `inset 0 0 0 1px ${ACCENTS.emerald}4A`
                : 'var(--ed-ghost-border)',
            }}
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
              setTimeout(() => { onClose(); refetch(); }, 3000);
            }}
          >
            {policyPending ? 'Updating…' : 'Update on-chain'}
          </ControlButton>
          <ControlButton variant="secondary" className="flex-1" onClick={onClose}>Cancel</ControlButton>
        </div>
      </div>
    </ModalShell>
  );
}
