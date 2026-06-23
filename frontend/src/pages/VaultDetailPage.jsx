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
} from '../components/editorial/atoms';
import { ACCENTS } from '../components/editorial/tokens';
import {
  Shield, AlertTriangle, ArrowLeft, Cpu, Plus, Wallet, X,
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
  const { withdraw, hash: withdrawHash, isPending: withdrawPending } = useWithdraw();
  // v2 rescue paths — only wired up in the modal when vault.version === 'v2'
  const { withdrawToken, isPending: withdrawTokenPending } = useWithdrawToken();
  const { withdrawAllNonBase, isPending: withdrawAllPending } = useWithdrawAllNonBase();
  const { approve, hash: approveHash, isPending: approvePending, isSuccess: approveSuccess } = useApprove();
  const { deposit, hash: depositHash, isPending: depositPending } = useDeposit();
  const { transfer: transferToken, hash: transferHash, isPending: transferPending } = useTransferToken();
  const { wrap: wrapNative, hash: wrapHash, isPending: wrapPending, isSuccess: wrapSuccess, reset: resetWrap } = useWrapNative();
  const { updatePolicy, hash: policyHash, isPending: policyPending } = useUpdatePolicy();
  const { setExecutor, hash: executorHash, isPending: executorPending } = useSetExecutor();

  // Fees
  const { state: feeState, refetch: refetchFees } = useVaultFeeState(vaultAddr, 6);
  const { navUsd: liveNavUsd, refetch: refetchNav } = useVaultNav(vaultAddr, 6);
  const { claim: claimFees, hash: claimHash, isPending: claimPending, isSuccess: claimSuccess } = useClaimFees();
  const { accrue: accrueFees, hash: accrueHash, isPending: accruePending, isSuccess: accrueSuccess, _unsupported: feesUnsupported } = useAccrueFees();

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
  const feeRecipientExplorerHref = getExplorerAddressHref(chainId, effectivePolicy?.feeRecipient);
  const showLiveTelemetryGuide = !showDemoVault && !latestSignal && !hasRealTimeline;

  const vaultTitle = showDemoVault
    ? demoVault.name
    : vaultAddress
    ? `${vaultAddress.slice(0, 6)}…${vaultAddress.slice(-4)}`
    : 'No Vault Selected';

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
  const hasFees = effectivePolicy && (
    effectivePolicy.performanceFeeBps ||
    effectivePolicy.managementFeeBps ||
    effectivePolicy.entryFeeBps ||
    effectivePolicy.exitFeeBps ||
    (feeState?.accruedTotal > 0)
  );

  // HONESTY: only show a Realized/Unrealized PnL split when executions actually
  // carry a numeric pnl. Otherwise the comp's "Realized P&L" stat collapses to
  // a fabricated 0, so we surface the single REAL all-time PnL instead.
  const hasRealizedPnl = executionData.some((ex) => typeof ex.pnl === 'number' && ex.pnl !== 0);

  return (
    <div className="relative min-h-screen" style={{ background: '#0a0b0e', color: '#eceef1', fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div className="relative max-w-[1540px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-5 flex-wrap" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '1px', textTransform: 'uppercase' }}>
          <Link to="/app" className="inline-flex items-center gap-1.5 transition-colors" style={{ color: M.muted, textDecoration: 'none' }}>
            <ArrowLeft className="w-3 h-3" /> Dashboard
          </Link>
          <span style={{ color: '#3a3e46' }}>/</span>
          <span style={{ color: M.muted }}>Vaults</span>
          <span style={{ color: '#3a3e46' }}>/</span>
          <span style={{ color: M.text }} className="whitespace-nowrap">{vaultTitle}</span>
        </div>

        {/* Header */}
        <VaultHero
          vaultTitle={vaultTitle}
          vaultAddress={vaultAddress}
          networkName={networkName}
          baseAssetSymbol={baseAssetSymbolResolved}
          isPaused={isPaused}
          showDemoVault={showDemoVault}
          mandateType={mandateType}
          executorIsInactive={executorIsInactive}
          sealedMode={!!effectivePolicy?.sealedMode}
          nav={nav}
          totalDeposited={totalDeposited}
          allTimeReturnPct={allTimeReturnPct}
          allTimeReturnUsd={allTimeReturnUsd}
          returnIsPositive={returnIsPositive}
          hasRealReturn={hasRealReturn}
          hasRealizedPnl={hasRealizedPnl}
          pnlRealized={pnlRealized}
          pnlUnrealized={pnlUnrealized}
          isConnected={isConnected}
          pausePending={pausePending}
          unpausePending={unpausePending}
          onDeposit={openDepositModal}
          onWithdraw={openWithdrawModal}
          onPause={handlePause}
        />

        {/* Operator rotation banner */}
        {executorIsInactive && !bannerDismissed && (
          <div className="mt-5 rounded-[14px] p-4 flex items-start gap-3" style={{ background: 'linear-gradient(90deg, rgba(245,158,11,0.10), #14161b)', border: '1px solid rgba(245,158,11,0.22)' }}>
            <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${G.amber}26`, color: G.amber }}>
              <AlertTriangle className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="whitespace-nowrap" style={{ ...monoLabel, color: M.text }}>Operator status changed</span>
                <span style={{ ...monoTag, color: G.amber, background: `${G.amber}1F` }}>{executorIsInactive.reason}</span>
              </div>
              <p className="text-[12.5px] leading-[1.55]" style={{ color: M.muted }}>
                {executorIsInactive.label} Rotate to a different executor below without moving funds.
              </p>
            </div>
            <button type="button" onClick={() => setBannerDismissed(true)} className="px-2 py-1 rounded" style={{ ...monoLabel, color: M.faint, background: 'transparent', border: 'none', cursor: 'pointer' }}>
              Dismiss
            </button>
          </div>
        )}

        {showLiveTelemetryGuide && (
          <div className="mt-5 rounded-[14px] p-4" style={card}>
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="w-3.5 h-3.5" style={{ color: G.violet }} />
              <span style={{ ...monoLabel, color: G.violet }}>Telemetry warming up</span>
            </div>
            <p className="text-[11.5px] leading-[1.55]" style={{ color: M.muted }}>
              The vault exists on-chain, but no fresh AI journal or NAV history has arrived yet. Connect the vault to your
              orchestrator executor and run a cycle to populate the analytics panels below.
            </p>
            <div className="mt-2" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: M.faint }}>
              Endpoint: {ORCHESTRATOR_URL || 'VITE_ORCHESTRATOR_URL not set'}
            </div>
          </div>
        )}

        {/* Main two-col grid */}
        <div className="mt-[22px] grid grid-cols-1 xl:grid-cols-[1fr_350px] gap-[22px] items-start">
          {/* LEFT */}
          <div className="flex flex-col gap-[22px] min-w-0">
            <PerformancePanel
              nav={nav}
              totalDeposited={totalDeposited}
              allTimeReturnPct={allTimeReturnPct}
              allTimeReturnUsd={allTimeReturnUsd}
              returnIsPositive={returnIsPositive}
              navHistoryData={navHistoryData}
              pnlHistoryData={pnlHistoryData}
              drawdownHistoryData={drawdownHistoryData}
              showDemoVault={showDemoVault}
            />

            {allocationData.length > 0 && (
              <AllocationPanel allocations={allocationData} prices={navData?.prices} />
            )}

            <AiActionsPanel
              entries={journalEntries}
              counts={decisionCounts}
              chainId={chainId}
              executions={executions}
              onExport={handleExportJournal}
            />

            <RecentActionsPanel actions={recentActions} chainId={chainId} />
          </div>

          {/* RIGHT RAIL */}
          <aside className="flex flex-col gap-[22px] min-w-0">
            <ManageCapitalPanel
              tab={ticketTab}
              setTab={setTicketTab}
              amount={ticketAmount}
              setAmount={setTicketAmount}
              walletBalance={ticketWalletBalance}
              tokens={depositTokens}
              selectedSymbol={ticketTokenSymbol}
              onSelectSymbol={(sym) => { setTicketTokenSymbol(sym); setTicketAmount(''); }}
              selectedWithdrawSymbol={ticketWithdrawSymbol}
              onSelectWithdrawSymbol={(sym) => { setTicketWithdrawSymbol(sym); setTicketAmount(''); }}
              vaultVersion={vaultVersion}
              vaultAssetRows={vaultAssetRows}
              liveVault={liveVault}
              isConnected={isConnected}
              onSubmit={handleTicketSubmit}
            />

            <CrossChainDepositCard vaultAddress={vaultAddr} baseAssetAddress={liveVault?.baseAsset} baseAssetSymbol={baseAssetSymbolResolved} baseAssetDecimals={baseAssetDecimalsResolved} />

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

            <RiskQualityPanel
              riskScore={riskScore}
              riskLevel={riskLevel}
              riskTone={riskTone}
              pol={pol}
              dailyActions={dailyActions}
              hasRealReturn={hasRealReturn}
              allTimeReturnPct={allTimeReturnPct}
              returnIsPositive={returnIsPositive}
            />

            <PolicyPanel pol={pol} mandateType={mandateType} isConnected={isConnected} onEdit={openPolicyModal} />

            <ExecutorPanel
              operator={executorOpData}
              executorAddress={executorAddress}
              executorRegistered={executorRegistered}
              executorSyncLabel={executorSyncLabel}
              executorSyncTone={executorSyncTone}
              executorMatches={executorMatchesActiveOrchestrator}
              isConnected={isConnected}
              onSwitch={openExecutorModal}
              networkName={networkName}
              lastExecTs={lastExecTs}
            />

            {hasFees && (
              <FeesPanel
                policy={effectivePolicy}
                feeState={feeState}
                liveNavUsd={liveNavUsd}
                feeRecipientExplorerHref={feeRecipientExplorerHref}
                walletAddress={walletAddress}
                isConnected={isConnected}
                feesUnsupported={feesUnsupported}
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
            )}

            {recentVaultTxs.length > 0 && (
              <SessionTxPanel recentTxs={recentVaultTxs} />
            )}
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

/* ─────────────────── Comp palette + shared style tokens ─────────────────── */
// Palette from the reference comp ("Aegis Vault Detail.dc.html"). GOLD is the
// primary accent. Kept local to this file so the redesign is self-contained.
const G = {
  gold: '#e3b34e',
  goldHi: '#edc05f',
  emerald: '#5cb88a',
  violet: '#6f7bdb',
  rose: '#df7373',
  amber: '#f59e0b',
  btc: '#f7931a',
  eth: '#627eea',
  usdc: '#2775ca',
  zerog: '#4cc9f0',
};
const M = {
  bg: '#0a0b0e',
  card: '#14161b',
  tile: '#1a1d23',
  inset: '#0e1014',
  text: '#eceef1',
  muted: '#9499a2',
  faint: '#6b7078',
  hair: 'rgba(255,255,255,0.07)',
  hairSoft: 'rgba(255,255,255,0.05)',
};
const card = { background: M.card, border: `1px solid ${M.hair}`, borderRadius: 14 };
const monoLabel = { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '1.2px', textTransform: 'uppercase' };
const monoTag = { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 6 };
const mono = { fontFamily: "'IBM Plex Mono', monospace" };

const ASSET_GLYPH_COLOR = { BTC: G.btc, WBTC: G.btc, ETH: G.eth, WETH: G.eth, USDC: G.usdc, '0G': G.zerog, W0G: G.zerog };

function usd0(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/* ─────────────────── Header ─────────────────── */

function VaultHero({
  vaultTitle, vaultAddress, networkName, baseAssetSymbol,
  isPaused, showDemoVault, mandateType, executorIsInactive, sealedMode,
  nav, totalDeposited, allTimeReturnPct, allTimeReturnUsd, returnIsPositive, hasRealReturn,
  hasRealizedPnl, pnlRealized, pnlUnrealized,
  isConnected, pausePending, unpausePending,
  onDeposit, onWithdraw, onPause,
}) {
  const addrShort = vaultAddress ? `${vaultAddress.slice(0, 6)}…${vaultAddress.slice(-4)}` : 'No vault';
  const returnTone = returnIsPositive ? G.emerald : G.rose;
  return (
    <section className="relative overflow-hidden" style={{ ...card, padding: 30 }}>
      <div aria-hidden style={{ position: 'absolute', top: -120, right: -60, width: 400, height: 400, background: 'radial-gradient(circle, rgba(227,179,78,0.09), transparent 65%)', pointerEvents: 'none' }} />

      <div className="relative flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-3.5">
            <span className="inline-flex items-center gap-1.5" style={{ ...monoTag, color: isPaused ? G.amber : G.emerald, background: isPaused ? `${G.amber}1F` : 'rgba(92,184,138,0.12)' }}>
              <span style={{ width: 5, height: 5, borderRadius: 999, background: isPaused ? G.amber : G.emerald }} />
              {isPaused ? 'PAUSED' : 'ACTIVE'}
            </span>
            {mandateType !== 'Unknown' && (
              <span style={{ ...monoTag, color: G.gold, background: 'rgba(227,179,78,0.12)' }}>{mandateType.toUpperCase()}</span>
            )}
            {sealedMode && (
              <span style={{ ...monoTag, color: G.violet, background: 'rgba(111,123,219,0.12)' }} title="Sealed mode — intent hashes signed by an attested key (ECDSA) + commit-reveal. Not a hardware enclave.">
                ⛉ SEALED MODE
              </span>
            )}
            {executorIsInactive && (
              <span className="inline-flex items-center gap-1.5" style={{ ...monoTag, color: G.rose, background: 'rgba(223,115,115,0.12)' }}>
                <AlertTriangle className="w-3 h-3" /> OPERATOR {executorIsInactive.reason.toUpperCase()}
              </span>
            )}
            {showDemoVault && (
              <span style={{ ...monoTag, color: G.gold, background: 'rgba(227,179,78,0.12)' }}>DEMO</span>
            )}
          </div>
          <h1 className="m-0 whitespace-nowrap" style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-1px' }}>{vaultTitle}</h1>
          <div className="mt-2" style={{ ...mono, fontSize: 11.5, color: M.faint }}>
            {addrShort} · {networkName} · base {baseAssetSymbol}
          </div>
        </div>
        <div className="flex gap-2.5 flex-wrap">
          <button type="button" onClick={onDeposit} disabled={!isConnected} style={{ ...mono, fontSize: 12, fontWeight: 600, color: M.bg, background: G.gold, border: 'none', borderRadius: 9, padding: '10px 18px', cursor: isConnected ? 'pointer' : 'not-allowed', opacity: isConnected ? 1 : 0.5 }}>
            Deposit
          </button>
          <button type="button" onClick={onWithdraw} disabled={!isConnected} style={{ ...mono, fontSize: 12, fontWeight: 500, color: M.text, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: '10px 18px', cursor: isConnected ? 'pointer' : 'not-allowed', opacity: isConnected ? 1 : 0.5 }}>
            Withdraw
          </button>
          <button type="button" onClick={onPause} disabled={!isConnected || pausePending || unpausePending} style={{ ...mono, fontSize: 12, fontWeight: 500, color: isPaused ? G.emerald : G.rose, background: 'transparent', border: `1px solid ${isPaused ? 'rgba(92,184,138,0.3)' : 'rgba(223,115,115,0.25)'}`, borderRadius: 9, padding: '10px 18px', cursor: (!isConnected || pausePending || unpausePending) ? 'not-allowed' : 'pointer', opacity: (!isConnected || pausePending || unpausePending) ? 0.6 : 1 }}>
            {isPaused ? `▶ ${unpausePending ? 'Resuming…' : 'Resume'}` : `⏸ ${pausePending ? 'Pausing…' : 'Pause'}`}
          </button>
        </div>
      </div>

      {/* headline stats */}
      <div className="relative mt-[26px] grid grid-cols-2 lg:grid-cols-4" style={{ gap: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ background: M.card, padding: 20 }}>
          <div style={{ ...monoLabel, letterSpacing: '1.4px', color: M.faint }}>Net Asset Value</div>
          <div className="flex items-baseline gap-2 mt-3">
            <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-1px' }}>{usd0(nav)}</span>
            {hasRealReturn && (
              <span style={{ ...mono, fontSize: 12, color: returnTone }}>
                {returnIsPositive ? '▲' : '▼'} {Math.abs(allTimeReturnPct).toFixed(2)}%
              </span>
            )}
          </div>
          <div className="mt-1" style={{ ...mono, fontSize: 11, color: nav > 0 ? M.faint : M.faint }}>
            {nav > 0 ? `${nav.toFixed(4)} ${baseAssetSymbol}` : 'Awaiting deposits'}
          </div>
        </div>
        <div style={{ background: M.card, padding: 20 }}>
          <div style={{ ...monoLabel, letterSpacing: '1.4px', color: M.faint }}>Deposited</div>
          <div className="mt-3" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-1px' }}>{usd0(totalDeposited)}</div>
          <div className="mt-1" style={{ ...mono, fontSize: 11, color: M.faint }}>principal in · cost basis</div>
        </div>
        {hasRealizedPnl ? (
          <div style={{ background: M.card, padding: 20 }}>
            <div style={{ ...monoLabel, letterSpacing: '1.4px', color: M.faint }}>Realized P&amp;L</div>
            <div className="mt-3" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-1px', color: pnlRealized >= 0 ? G.emerald : G.rose }}>
              {pnlRealized >= 0 ? '+' : '−'}{usd0(Math.abs(pnlRealized))}
            </div>
            <div className="mt-1" style={{ ...mono, fontSize: 11, color: M.faint }}>
              unrealized {pnlUnrealized >= 0 ? '+' : '−'}{usd0(Math.abs(pnlUnrealized))}
            </div>
          </div>
        ) : (
          <div style={{ background: M.card, padding: 20 }}>
            <div style={{ ...monoLabel, letterSpacing: '1.4px', color: M.faint }}>Net P&amp;L</div>
            <div className="mt-3" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-1px', color: hasRealReturn ? returnTone : M.text }}>
              {hasRealReturn ? `${returnIsPositive ? '+' : '−'}${usd0(Math.abs(allTimeReturnUsd)).slice(1)}` : '—'}
            </div>
            <div className="mt-1" style={{ ...mono, fontSize: 11, color: M.faint }}>NAV − deposited</div>
          </div>
        )}
        <div style={{ background: M.card, padding: 20 }}>
          <div style={{ ...monoLabel, letterSpacing: '1.4px', color: M.faint }}>All-time Return</div>
          <div className="mt-3" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-1px', color: hasRealReturn ? returnTone : M.text }}>
            {hasRealReturn ? `${returnIsPositive ? '+' : '−'}${Math.abs(allTimeReturnPct).toFixed(1)}%` : '—'}
          </div>
          <div className="mt-1" style={{ ...mono, fontSize: 11, color: M.faint }}>
            {hasRealReturn ? `${returnIsPositive ? '+' : '−'}${usd0(Math.abs(allTimeReturnUsd)).slice(1)}` : 'awaiting deposits'}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────── Performance ─────────────────── */

function PerformancePanel({
  nav, totalDeposited, allTimeReturnPct, allTimeReturnUsd, returnIsPositive,
  navHistoryData, pnlHistoryData, drawdownHistoryData, showDemoVault,
}) {
  const tone = returnIsPositive ? G.emerald : G.rose;
  return (
    <section style={{ ...card, padding: 24 }}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h2 className="m-0" style={{ fontSize: 16, fontWeight: 600 }}>Performance</h2>
          <div className="flex items-baseline gap-2.5 mt-2 flex-wrap">
            <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.5px', color: tone }}>{usd0(nav)}</span>
            <span style={{ ...mono, fontSize: 13, color: tone }}>
              {returnIsPositive ? '+' : '−'}{Math.abs(allTimeReturnPct).toFixed(2)}%
            </span>
            <span style={{ ...mono, fontSize: 11, color: M.faint }}>
              vs {usd0(totalDeposited)} cost basis · PnL {returnIsPositive ? '+' : '−'}{usd0(Math.abs(allTimeReturnUsd)).slice(1)}
            </span>
          </div>
        </div>
        <span style={{ ...mono, fontSize: 11, color: M.faint }}>{navHistoryData.length} snapshots</span>
      </div>

      {!showDemoVault && navHistoryData.length === 0 && (
        <div className="rounded-lg px-4 py-3 mb-4" style={{ background: M.tile, border: `1px solid ${M.hairSoft}` }}>
          <p className="text-[11.5px] leading-[1.55] m-0" style={{ color: M.muted }}>
            Historical snapshots populate as the orchestrator emits cycle updates. Switch between NAV, PnL, and drawdown once data lands.
          </p>
        </div>
      )}

      <PerformanceChart
        height={200}
        navData={navHistoryData}
        pnlData={pnlHistoryData}
        drawdownData={drawdownHistoryData}
        defaultMetric="nav"
      />
    </section>
  );
}

/* ─────────────────── Allocation ─────────────────── */

function AllocationPanel({ allocations, prices }) {
  const rows = allocations.filter((a) => a.value > 0 || a.pct > 0);
  const deployed = rows.filter((a) => a.symbol !== 'USDC').reduce((s, a) => s + (a.pct || 0), 0);
  const idle = Math.max(0, 100 - deployed);
  return (
    <section style={{ ...card, padding: 24 }}>
      <div className="flex items-center justify-between mb-[18px]">
        <h2 className="m-0" style={{ fontSize: 16, fontWeight: 600 }}>Allocation</h2>
        <span style={{ ...mono, fontSize: 10.5, color: M.faint }}>{deployed.toFixed(1)}% deployed · {idle.toFixed(1)}% idle</span>
      </div>
      <div className="flex mb-5" style={{ height: 12, borderRadius: 99, overflow: 'hidden', gap: 2 }}>
        {rows.map((a) => (
          <div key={a.symbol} style={{ width: `${a.pct}%`, background: ASSET_GLYPH_COLOR[a.symbol] || a.color || '#8a8a9a' }} />
        ))}
      </div>
      <div className="flex flex-col">
        {rows.map((a) => {
          const c = ASSET_GLYPH_COLOR[a.symbol] || a.color || '#8a8a9a';
          const amt = typeof a.amount === 'number' ? a.amount.toFixed(a.symbol === 'USDC' ? 0 : 6) : a.amount;
          return (
            <div key={a.symbol} className="grid items-center" style={{ gridTemplateColumns: '150px 1fr 90px 60px', gap: 14, padding: '11px 0', borderTop: `1px solid ${M.hairSoft}` }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <span style={{ width: 10, height: 10, borderRadius: 3, background: c, flex: 'none' }} />
                <span className="text-[13px] font-medium">{a.asset || a.symbol}</span>
                <span className="truncate" style={{ ...mono, fontSize: 10.5, color: M.faint }}>{amt}</span>
              </div>
              <div style={{ height: 5, borderRadius: 99, background: '#2a2e36', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${a.pct}%`, background: c, borderRadius: 99 }} />
              </div>
              <span className="text-right" style={{ ...mono, fontSize: 12.5, color: M.text }}>{usd0(a.value)}</span>
              <span className="text-right" style={{ ...mono, fontSize: 12.5, color: M.muted }}>{(a.pct || 0).toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
      {prices && (
        <div className="mt-3 pt-3 flex gap-4" style={{ ...mono, fontSize: 9.5, color: M.faint, borderTop: `1px solid ${M.hairSoft}` }}>
          {prices.BTC != null && <span>BTC ${prices.BTC.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
          {prices.ETH != null && <span>ETH ${prices.ETH.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
          <span>Source: Pyth Hermes</span>
        </div>
      )}
    </section>
  );
}

/* ─────────────────── AI Actions ─────────────────── */

const ACTION_CFG = {
  buy: { glyph: '↥', fg: G.emerald, bg: 'rgba(92,184,138,0.1)', ring: 'rgba(92,184,138,0.3)' },
  sell: { glyph: '↧', fg: G.rose, bg: 'rgba(223,115,115,0.1)', ring: 'rgba(223,115,115,0.3)' },
  hold: { glyph: '◆', fg: G.violet, bg: 'rgba(111,123,219,0.1)', ring: 'rgba(111,123,219,0.3)' },
  blocked: { glyph: '▣', fg: G.gold, bg: 'rgba(227,179,78,0.1)', ring: 'rgba(227,179,78,0.3)' },
};

function AiActionsPanel({ entries, counts, chainId, executions, onExport }) {
  return (
    <section style={{ ...card, padding: 24 }}>
      <div className="flex items-center justify-between mb-[18px] gap-3 flex-wrap">
        <div>
          <h2 className="m-0" style={{ fontSize: 16, fontWeight: 600 }}>AI Actions</h2>
          <div className="mt-1" style={{ ...mono, fontSize: 11, color: M.faint }}>
            {executions} on-chain · {counts.hold} hold · {counts.buy + counts.sell} filled
          </div>
        </div>
        <button type="button" onClick={onExport} style={{ ...mono, fontSize: 11, color: G.gold, background: 'transparent', border: 'none', cursor: 'pointer' }}>
          Full journal →
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-8 px-4" style={{ background: M.tile, borderRadius: 11 }}>
          <div className="mb-1.5" style={{ fontSize: 14, fontWeight: 600 }}>No AI decisions yet.</div>
          <p className="m-0" style={{ ...mono, fontSize: 11, color: M.faint }}>
            Set the executor, start the orchestrator, and run a cycle to populate the decision feed.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {entries.map((e) => (
            <AiActionRow key={e.id} e={e} chainId={chainId} />
          ))}
        </div>
      )}
    </section>
  );
}

function AiActionRow({ e, chainId }) {
  const kind = e.hardVeto ? 'blocked' : (e.rawAction === 'buy' ? 'buy' : e.rawAction === 'sell' ? 'sell' : 'hold');
  const c = ACTION_CFG[kind];
  const outcome = e.hardVeto ? 'BLOCKED' : (e.outcome || '').toUpperCase() || 'PENDING';
  const confPct = (e.confidence || 0).toFixed(2);
  const txHref = e.txHash ? getExplorerTxHref(chainId, e.txHash) : null;
  const actionLabel = e.action || `${(e.rawAction || '').toUpperCase()} ${e.asset || ''}`.trim();
  return (
    <div className="grid items-start" style={{ background: M.tile, borderRadius: 11, padding: 16, gridTemplateColumns: '36px 1fr auto', gap: 14 }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: c.bg, border: `1px solid ${c.ring}`, color: c.fg, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
        {c.glyph}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span style={{ fontSize: 13, fontWeight: 600 }}>{actionLabel}</span>
          <span style={{ ...mono, fontSize: 9.5, fontWeight: 600, color: c.fg, background: c.bg, padding: '2px 8px', borderRadius: 5 }}>{outcome}</span>
          <span style={{ ...mono, fontSize: 10.5, color: G.violet }}>conf {confPct}</span>
          {e.fill && <span style={{ ...mono, fontSize: 10.5, color: M.muted }}>${e.fill}</span>}
          {e.pnl !== null && e.pnl !== undefined && (
            <span style={{ ...mono, fontSize: 10.5, color: e.pnl >= 0 ? G.emerald : G.rose }}>
              {e.pnl >= 0 ? '+' : '−'}${Math.abs(e.pnl).toFixed(2)}
            </span>
          )}
          {e.regime && (
            <span style={{ ...mono, fontSize: 10, color: M.muted, background: 'rgba(255,255,255,0.04)', padding: '2px 6px', borderRadius: 5 }}>
              {e.regime.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        {e.reason && (
          <p className="m-0" style={{ fontSize: 12, color: M.muted, lineHeight: 1.5, maxWidth: 560 }}>{e.reason}</p>
        )}
        {e.hardVeto && e.hardVetoReasons?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {e.hardVetoReasons.map((r) => (
              <span key={r} style={{ ...mono, fontSize: 10, color: G.gold, background: 'rgba(227,179,78,0.12)', padding: '2px 6px', borderRadius: 5 }}>
                {r.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5" style={{ flex: 'none' }}>
        <span className="whitespace-nowrap" style={{ ...mono, fontSize: 10, color: M.faint }}>{formatLocalTime(e.timestamp)}</span>
        {txHref ? (
          <a href={txHref} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 9.5, letterSpacing: '1px', textTransform: 'uppercase', color: G.violet, textDecoration: 'none' }}>
            Receipt →
          </a>
        ) : e.rawAction === 'hold' ? (
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: '1px', textTransform: 'uppercase', color: M.faint }}>No execution</span>
        ) : (
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: '1px', textTransform: 'uppercase', color: G.gold }}>Pending</span>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── Recent actions (vault journal) ─────────────────── */

function RecentActionsPanel({ actions, chainId }) {
  return (
    <section style={{ ...card, padding: 24 }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="m-0" style={{ fontSize: 16, fontWeight: 600 }}>Vault journal</h2>
        <span style={{ ...mono, fontSize: 10.5, color: M.faint }}>signed intents · rotations · policy checks</span>
      </div>
      {actions.length === 0 ? (
        <div className="text-center py-6 px-4" style={{ background: M.tile, borderRadius: 11 }}>
          <p className="m-0 text-[13px]">No actions recorded yet.</p>
          <p className="mt-1 m-0" style={{ ...mono, fontSize: 11, color: M.faint }}>
            Signed intents, rotations, and policy checks appear here once the orchestrator emits them.
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {actions.map((a) => {
            const txHref = a.txHash ? getExplorerTxHref(chainId, a.txHash) : null;
            const tone = a.kind === 'SIGNED' ? G.emerald : a.kind === 'ROTATED' ? G.amber : M.muted;
            return (
              <div key={a.id} className="grid items-center" style={{ gridTemplateColumns: 'auto 1fr auto auto', gap: 12, padding: '10px 0', borderTop: `1px solid ${M.hairSoft}` }}>
                <span style={{ ...mono, fontSize: 9.5, fontWeight: 600, color: tone, background: `${tone}1F`, padding: '2px 7px', borderRadius: 5 }}>{a.kind}</span>
                {a.txHash ? (
                  <span className="truncate" style={{ ...mono, fontSize: 11, color: M.muted }}>
                    tx <span style={{ color: M.text }}>{shortHexLabel(a.txHash, 8, 4)}</span>
                  </span>
                ) : (
                  <span style={{ ...mono, fontSize: 11, color: M.faint }}>off-chain event</span>
                )}
                <span style={{ ...mono, fontSize: 10.5, color: M.muted }}>{formatLocalTime(a.timestamp)}</span>
                {txHref ? (
                  <a href={txHref} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 9.5, letterSpacing: '1px', textTransform: 'uppercase', color: G.violet, textDecoration: 'none' }}>View →</a>
                ) : (
                  <span style={{ ...mono, fontSize: 9.5, color: M.faint }}>—</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ─────────────────── Manage capital (rail) ─────────────────── */

function ManageCapitalPanel({
  tab, setTab, amount, setAmount, walletBalance, tokens = [], selectedSymbol, onSelectSymbol,
  selectedWithdrawSymbol, onSelectWithdrawSymbol, vaultVersion = 'v1', vaultAssetRows = [], liveVault,
  isConnected, onSubmit,
}) {
  const isDep = tab === 'deposit';
  const baseToken = tokens.find((t) => t.isBase) || tokens[0];
  const supportsMultiAsset = vaultSupportsMultiAssetWithdraw(vaultVersion);

  const withdrawableTokens = (() => {
    if (!supportsMultiAsset) return baseToken ? [baseToken] : [];
    const rows = vaultAssetRows
      .map((row) => {
        const meta = tokens.find((t) => t.address?.toLowerCase() === row.address?.toLowerCase());
        if (!meta) return null;
        let vaultBal = 0;
        try { vaultBal = parseFloat(formatUnits(row.balance ?? 0n, meta.decimals ?? 18)); } catch { vaultBal = 0; }
        const isBaseRow = !!meta.isBase || row.address?.toLowerCase() === liveVault?.baseAsset?.toLowerCase();
        return { ...meta, isBase: isBaseRow, vaultBalance: vaultBal };
      })
      .filter(Boolean);
    if (!rows.some((r) => r.isBase) && baseToken) {
      rows.unshift({ ...baseToken, isBase: true, vaultBalance: parseFloat(liveVault?.balance || '0') });
    }
    return rows;
  })();

  const withdrawSelectedSymbol = selectedWithdrawSymbol || withdrawableTokens.find((t) => t.isBase)?.symbol || baseToken?.symbol;
  const withdrawActiveToken = withdrawableTokens.find((t) => t.symbol === withdrawSelectedSymbol) || withdrawableTokens[0] || baseToken;
  const activeToken = isDep ? (tokens.find((t) => t.symbol === selectedSymbol) || baseToken) : withdrawActiveToken;
  const activeSymbol = activeToken?.symbol || 'USDC';
  const displayBalance = Number.isFinite(walletBalance) ? walletBalance : 0;
  const balanceDecimals = activeSymbol === 'USDC' ? 2 : 6;
  const nonBaseDeposit = isDep && !activeToken?.isBase;

  const showDepositPicker = isDep && tokens.length > 1;
  const showWithdrawPicker = !isDep && supportsMultiAsset && withdrawableTokens.length > 0;

  const tokenPill = (t, active, onClick, sub) => (
    <button
      key={t.symbol}
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5"
      style={{ ...mono, fontSize: 10.5, padding: '6px 10px', borderRadius: 7, cursor: 'pointer', border: 'none',
        background: active ? 'rgba(227,179,78,0.14)' : 'rgba(255,255,255,0.03)', color: active ? G.gold : M.muted,
        boxShadow: active ? `inset 0 0 0 1px rgba(227,179,78,0.4)` : 'none' }}
    >
      <TokenIcon symbol={t.symbol} size={13} />
      {t.symbol}
      {sub && <span style={{ fontSize: 8.5, color: M.faint }}>· {sub}</span>}
    </button>
  );

  return (
    <section style={{ background: M.card, border: '1px solid rgba(227,179,78,0.2)', borderRadius: 14, padding: 22 }}>
      <h3 className="m-0 mb-4" style={{ fontSize: 14, fontWeight: 600 }}>Manage capital</h3>

      <div className="flex gap-1 mb-3.5" style={{ background: M.inset, borderRadius: 9, padding: 4 }}>
        {['deposit', 'withdraw'].map((t) => {
          const active = tab === t;
          return (
            <button key={t} type="button" onClick={() => setTab(t)} style={{ flex: 1, ...mono, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.5px', padding: '9px 0', borderRadius: 7, border: 'none', cursor: 'pointer', textTransform: 'capitalize', background: active ? '#22262e' : 'transparent', color: active ? M.text : M.faint }}>
              {t}
            </button>
          );
        })}
      </div>

      {showDepositPicker && (
        <div className="mb-3">
          <div className="mb-1.5" style={{ ...monoLabel, fontSize: 9.5, color: M.faint }}>Token</div>
          <div className="flex gap-1.5 flex-wrap">
            {tokens.map((t) => tokenPill(t, t.symbol === activeSymbol, () => onSelectSymbol?.(t.symbol)))}
          </div>
        </div>
      )}

      {showWithdrawPicker && (
        <div className="mb-3">
          <div className="mb-1.5" style={{ ...monoLabel, fontSize: 9.5, color: M.faint }}>Withdraw token</div>
          <div className="flex gap-1.5 flex-wrap">
            {withdrawableTokens.map((t) => tokenPill(t, t.symbol === withdrawSelectedSymbol, () => onSelectWithdrawSymbol?.(t.symbol), t.isBase ? 'base' : ((t.vaultBalance ?? 0) > 0 ? null : 'empty')))}
          </div>
        </div>
      )}

      {!isDep && !supportsMultiAsset && (
        <p className="mb-3" style={{ ...mono, fontSize: 9.5, color: M.faint, lineHeight: 1.5 }}>
          V1 vault settles withdrawals in {baseToken?.symbol || 'base asset'} only. Non-base holdings auto-convert back when the AI closes positions.
        </p>
      )}

      <div className="flex items-center gap-2 mb-2" style={{ background: M.inset, border: `1px solid ${M.hair}`, borderRadius: 9, padding: '0 13px', height: 44 }}>
        <TokenIcon symbol={activeSymbol} size={15} />
        <input
          className="av-in"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          style={{ flex: 1, background: 'transparent', border: 'none', color: M.text, ...mono, fontSize: 16, outline: 'none' }}
        />
        <button type="button" onClick={() => setAmount(String(displayBalance))} style={{ ...mono, fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', color: G.gold, background: 'transparent', border: 'none', cursor: 'pointer' }}>Max</button>
      </div>

      <div className="mb-3.5" style={{ ...mono, fontSize: 10.5, color: M.faint }}>
        {isDep ? 'Wallet balance' : 'Available to withdraw'} · {displayBalance.toLocaleString(undefined, { maximumFractionDigits: balanceDecimals })} {isDep ? activeSymbol : (activeToken?.symbol || 'USDC')}
      </div>

      {nonBaseDeposit && (
        <div className="mb-3.5 rounded-lg px-2.5 py-1.5" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.22)', ...mono, fontSize: 10, lineHeight: 1.5, color: '#f5c97e' }}>
          {activeSymbol} goes via plain transfer() — it does not update totalDeposited or mint shares.
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!isConnected || !amount || Number(amount) <= 0}
        style={{ width: '100%', ...mono, fontSize: 12, fontWeight: 600, color: M.bg, background: G.gold, border: 'none', borderRadius: 9, padding: 11, cursor: (!isConnected || !amount || Number(amount) <= 0) ? 'not-allowed' : 'pointer', opacity: (!isConnected || !amount || Number(amount) <= 0) ? 0.5 : 1 }}
      >
        {isDep ? `Deposit ${activeSymbol}` : 'Request withdrawal'}
      </button>

      <div className="flex items-center justify-center gap-1.5 mt-3">
        <Shield className="w-2.5 h-2.5" style={{ color: M.faint }} />
        <span style={{ ...mono, fontSize: 10, color: M.faint }}>On-chain settlement · signed intent · 24h unstake cooldown</span>
      </div>
    </section>
  );
}

/* ─────────────────── Risk & quality (rail) ─────────────────── */

function RiskQualityPanel({ riskScore, riskLevel, riskTone, pol, dailyActions, hasRealReturn, allTimeReturnPct, returnIsPositive }) {
  const levelColor = riskTone === 'rose' ? G.rose : riskTone === 'amber' ? G.amber : riskTone === 'cyan' ? G.zerog : G.emerald;
  return (
    <section style={{ ...card, padding: 22 }}>
      <h3 className="m-0 mb-4" style={{ fontSize: 14, fontWeight: 600 }}>Risk &amp; quality</h3>
      <div className="grid grid-cols-2 gap-3.5">
        <div>
          <div style={{ ...monoLabel, fontSize: 10, color: M.faint }}>Risk score</div>
          <div className="flex items-baseline gap-1.5 mt-1.5">
            <span style={{ fontSize: 22, fontWeight: 600 }}>{riskScore || '—'}</span>
            <span style={{ ...mono, fontSize: 11, color: levelColor }}>{riskScore ? riskLevel : 'n/a'}</span>
          </div>
          <div className="mt-0.5" style={{ ...mono, fontSize: 9, color: M.faint }}>heuristic</div>
        </div>
        <div>
          <div style={{ ...monoLabel, fontSize: 10, color: M.faint }}>All-time return</div>
          <div className="mt-1.5" style={{ fontSize: 22, fontWeight: 600, color: hasRealReturn ? (returnIsPositive ? G.emerald : G.rose) : M.text }}>
            {hasRealReturn ? `${returnIsPositive ? '+' : '−'}${Math.abs(allTimeReturnPct).toFixed(1)}%` : '—'}
          </div>
        </div>
        <div>
          <div style={{ ...monoLabel, fontSize: 10, color: M.faint }}>Max position</div>
          <div className="mt-1.5" style={{ fontSize: 22, fontWeight: 600 }}>{(pol.maxPositionPct || 0).toFixed(0)}%</div>
        </div>
        <div>
          <div style={{ ...monoLabel, fontSize: 10, color: M.faint }}>Daily trades</div>
          <div className="mt-1.5" style={{ fontSize: 22, fontWeight: 600 }}>{dailyActions} / {pol.maxActionsPerDay || 0}</div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────── Policy & guardrails (rail) ─────────────────── */

function PolicyPanel({ pol, mandateType, isConnected, onEdit }) {
  // On-chain hard gates: max position / confidence floor / cooldown / max actions per day.
  // Off-chain risk-vetos: daily loss limit, stop-loss (orchestrator-enforced, NOT on-chain).
  const rows = [
    { k: 'Mandate', v: mandateType },
    { k: 'Max position', v: `${(pol.maxPositionPct || 0).toFixed(0)}%`, gate: 'on-chain' },
    { k: 'Confidence floor', v: `${(pol.confidenceThresholdPct || 0).toFixed(0)}%`, gate: 'on-chain' },
    { k: 'Cooldown', v: `${Math.round((pol.cooldownSeconds || 0) / 60)} min`, gate: 'on-chain' },
    { k: 'Max actions / day', v: `${pol.maxActionsPerDay || 0}`, gate: 'on-chain' },
    { k: 'Daily loss limit', v: `${(pol.maxDailyLossPct || 0).toFixed(1)}%`, gate: 'off-chain' },
    { k: 'Stop-loss', v: `${(pol.stopLossPct || 0).toFixed(1)}%`, gate: 'off-chain' },
  ];
  return (
    <section style={{ ...card, padding: 22 }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="m-0" style={{ fontSize: 14, fontWeight: 600 }}>Policy &amp; guardrails</h3>
        <button type="button" onClick={onEdit} disabled={!isConnected} style={{ ...mono, fontSize: 10.5, color: G.gold, background: 'transparent', border: 'none', cursor: isConnected ? 'pointer' : 'not-allowed', opacity: isConnected ? 1 : 0.5 }}>
          Edit →
        </button>
      </div>
      <div className="flex flex-col">
        {rows.map((p) => (
          <div key={p.k} className="flex items-center justify-between" style={{ padding: '9px 0', borderTop: `1px solid ${M.hairSoft}` }}>
            <span className="inline-flex items-center gap-1.5" style={{ ...mono, fontSize: 10.5, letterSpacing: '0.5px', textTransform: 'uppercase', color: M.faint }}>
              {p.k}
              {p.gate && (
                <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 4, color: p.gate === 'on-chain' ? G.emerald : M.faint, background: p.gate === 'on-chain' ? 'rgba(92,184,138,0.12)' : 'rgba(255,255,255,0.04)' }}>
                  {p.gate}
                </span>
              )}
            </span>
            <span style={{ ...mono, fontSize: 12, color: M.text }}>{p.v}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 m-0" style={{ ...mono, fontSize: 9, color: M.faint, lineHeight: 1.5 }}>
        On-chain gates are enforced by the vault contract. Daily-loss and stop-loss are off-chain risk vetos applied by the orchestrator.
      </p>
    </section>
  );
}

/* ─────────────────── Executor (rail) ─────────────────── */

function ExecutorPanel({ operator, executorAddress, executorRegistered, executorSyncLabel, executorSyncTone, executorMatches, isConnected, onSwitch, networkName, lastExecTs }) {
  const name = operator?.name || (executorRegistered === false ? 'Unregistered wallet' : 'Operator loading…');
  const avatarChar = (operator?.name || 'A').slice(0, 1).toUpperCase();
  const syncColor = executorSyncTone === 'emerald' ? G.emerald : executorSyncTone === 'amber' ? G.amber : M.muted;
  return (
    <section style={{ ...card, padding: 22 }}>
      <h3 className="m-0 mb-3.5" style={{ fontSize: 14, fontWeight: 600 }}>Executor</h3>
      <div className="flex items-center gap-3">
        <div style={{ width: 42, height: 42, borderRadius: 11, background: 'rgba(227,179,78,0.1)', border: '1px solid rgba(227,179,78,0.25)', color: G.gold, fontSize: 18, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          {avatarChar}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{name}</span>
            {executorMatches && (
              <span style={{ ...mono, fontSize: 9, fontWeight: 600, color: G.violet, background: 'rgba(111,123,219,0.12)', padding: '2px 6px', borderRadius: 5 }}>✓</span>
            )}
          </div>
          <div className="mt-0.5 truncate" style={{ ...mono, fontSize: 10.5, color: M.faint }}>
            {executorAddress ? shortHexLabel(executorAddress, 8, 6) : 'Unset'} · <span style={{ color: syncColor }}>{executorSyncLabel}</span>
          </div>
        </div>
      </div>
      <div className="mt-3.5 flex flex-col gap-2">
        <div className="flex items-center justify-between" style={{ padding: '7px 0', borderTop: `1px solid ${M.hairSoft}` }}>
          <span style={{ ...monoLabel, fontSize: 9.5, color: M.faint }}>Network</span>
          <span style={{ ...mono, fontSize: 11, color: M.text }}>{networkName}</span>
        </div>
        <div className="flex items-center justify-between" style={{ padding: '7px 0', borderTop: `1px solid ${M.hairSoft}` }}>
          <span style={{ ...monoLabel, fontSize: 9.5, color: M.faint }}>Last action</span>
          <span style={{ ...mono, fontSize: 11, color: M.text }}>{lastExecTs ? formatTime(lastExecTs) : 'Never'}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onSwitch}
        disabled={!isConnected}
        style={{ width: '100%', marginTop: 16, ...mono, fontSize: 11.5, fontWeight: 500, color: M.text, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: 10, cursor: isConnected ? 'pointer' : 'not-allowed', opacity: isConnected ? 1 : 0.5 }}
      >
        Switch operator →
      </button>
    </section>
  );
}

/* ─────────────────── Session transactions (rail) ─────────────────── */

function SessionTxPanel({ recentTxs }) {
  return (
    <section style={{ ...card, padding: 22 }}>
      <h3 className="m-0 mb-3.5" style={{ fontSize: 14, fontWeight: 600 }}>This session</h3>
      <div className="flex flex-col gap-2">
        {recentTxs.slice(0, 6).map((tx) => (
          <a key={tx.href} href={tx.href} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 10.5, color: G.violet, textDecoration: 'none' }}>
            {tx.label} · {shortHexLabel(tx.hash, 8, 4)} →
          </a>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────── Fees panel (rail) ─────────────────── */

function FeesPanel({
  policy, feeState, liveNavUsd, feeRecipientExplorerHref, walletAddress, isConnected,
  feesUnsupported, accruePending, claimPending, claimSuccess, accrueSuccess, onAccrue, onClaim,
}) {
  const canClaim = walletAddress && walletAddress.toLowerCase() === (policy?.feeRecipient || '').toLowerCase();
  const feeRows = [
    { k: 'Performance', v: formatBps(policy.performanceFeeBps) },
    { k: 'Management', v: formatBps(policy.managementFeeBps) },
    { k: 'Entry', v: formatBps(policy.entryFeeBps) },
    { k: 'Exit', v: formatBps(policy.exitFeeBps) },
  ];
  return (
    <section style={{ ...card, padding: 22 }}>
      <h3 className="m-0 mb-4" style={{ fontSize: 14, fontWeight: 600 }}>Operator fees</h3>
      <div className="flex flex-col mb-3">
        {feeRows.map((r) => (
          <div key={r.k} className="flex items-center justify-between" style={{ padding: '8px 0', borderTop: `1px solid ${M.hairSoft}` }}>
            <span style={{ ...mono, fontSize: 10.5, letterSpacing: '0.5px', textTransform: 'uppercase', color: M.faint }}>{r.k}</span>
            <span style={{ ...mono, fontSize: 12, color: M.text }}>{r.v}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div style={{ background: M.tile, borderRadius: 9, padding: '10px 12px' }}>
          <div style={{ ...monoLabel, fontSize: 9, color: M.faint }}>Live NAV</div>
          <div className="mt-1" style={{ fontSize: 16, fontWeight: 600 }}>${(liveNavUsd || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
        </div>
        <div style={{ background: M.tile, borderRadius: 9, padding: '10px 12px' }}>
          <div style={{ ...monoLabel, fontSize: 9, color: M.faint }}>Accrued total</div>
          <div className="mt-1" style={{ fontSize: 16, fontWeight: 600, color: G.gold }}>${(feeState?.accruedTotal || 0).toFixed(2)}</div>
        </div>
      </div>

      {policy.feeRecipient && policy.feeRecipient !== '0x0000000000000000000000000000000000000000' && (
        <div className="flex items-center justify-between mb-3" style={{ ...mono, fontSize: 10, background: M.tile, borderRadius: 7, padding: '6px 12px' }}>
          <span style={{ color: M.faint }}>Fee recipient</span>
          {feeRecipientExplorerHref ? (
            <a href={feeRecipientExplorerHref} target="_blank" rel="noreferrer" style={{ color: G.violet, textDecoration: 'none' }}>{shortHexLabel(policy.feeRecipient)}</a>
          ) : (
            <span style={{ color: M.text }}>{shortHexLabel(policy.feeRecipient)}</span>
          )}
        </div>
      )}

      {feesUnsupported ? (
        <div className="rounded-md px-3 py-2 text-center" style={{ background: M.tile }}>
          <p className="m-0" style={{ ...mono, fontSize: 10, color: M.text, lineHeight: 1.5 }}>
            Accrue / claim not available on this build — the slim 0G mainnet vault charges entry/exit fees inline (80% operator · 20% treasury). No performance/management-fee accrual to claim here.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onAccrue} disabled={!isConnected || accruePending} style={{ ...mono, fontSize: 11.5, fontWeight: 500, color: M.text, background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9, padding: 10, cursor: (!isConnected || accruePending) ? 'not-allowed' : 'pointer', opacity: (!isConnected || accruePending) ? 0.6 : 1 }}>
              {accruePending ? 'Accruing…' : 'Accrue'}
            </button>
            <button type="button" onClick={onClaim} disabled={!isConnected || claimPending || !(feeState?.accruedTotal > 0) || !canClaim} style={{ ...mono, fontSize: 11.5, fontWeight: 600, color: M.bg, background: G.gold, border: 'none', borderRadius: 9, padding: 10, cursor: (!isConnected || claimPending || !(feeState?.accruedTotal > 0) || !canClaim) ? 'not-allowed' : 'pointer', opacity: (!isConnected || claimPending || !(feeState?.accruedTotal > 0) || !canClaim) ? 0.5 : 1 }}>
              {claimPending ? 'Claiming…' : 'Claim'}
            </button>
          </div>
          {claimSuccess && <p className="text-center mt-2 m-0" style={{ ...mono, fontSize: 10, color: G.emerald }}>Fees claimed · 80% operator · 20% treasury</p>}
          {accrueSuccess && <p className="text-center mt-2 m-0" style={{ ...mono, fontSize: 10, color: G.violet }}>Fees accrued on-chain</p>}
        </>
      )}
    </section>
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
