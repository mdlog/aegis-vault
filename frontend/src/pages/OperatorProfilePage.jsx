import { createElement, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { isAddress } from 'viem';
import {
  getDeployments,
  getExplorerAddressHref,
  getExplorerTxHref,
  shortHexLabel,
} from '../lib/contracts';
import {
  useOperator,
  useOperatorExtended,
  MandateLabel,
  useDeactivateOperator,
  useActivateOperator,
} from '../hooks/useOperatorRegistry';
import { useOrchestratorStatus } from '../hooks/useOrchestrator';
import { useVaultList, useSetExecutor, useTokenBalance } from '../hooks/useVault';
import { formatBps, estimateAnnualFees } from '../hooks/useVaultFees';
import {
  useOperatorStake,
  useStakingAllowance,
  useApproveStake,
  useStake,
  useRequestUnstake,
  useClaimUnstake,
  TIER_LABELS,
  TIER_COLORS,
  TIER_THRESHOLDS,
  tierGapUsd,
  formatVaultCap,
  nextTier,
} from '../hooks/useOperatorStaking';
import {
  useOperatorReputation,
  useHasRated,
  useSubmitRating,
  useReputationAdmin,
  useSetVerified,
  formatPnl,
  reputationScore,
} from '../hooks/useOperatorReputation';
import GlassPanel from '../components/ui/GlassPanel';
import StatusPill from '../components/ui/StatusPill';
import SectionLabel from '../components/ui/SectionLabel';
import ControlButton from '../components/ui/ControlButton';
import ExplorerAnchor from '../components/ui/ExplorerAnchor';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Award,
  BadgeCheck,
  BarChart3,
  Cpu,
  DollarSign,
  Edit3,
  FileText,
  Globe,
  Hourglass,
  Info,
  Lock,
  MessageSquare,
  Percent,
  Power,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Unlock,
} from 'lucide-react';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const MANDATE_COLORS = {
  Conservative: 'text-emerald-soft/80 bg-emerald-soft/5 border-emerald-soft/15',
  Balanced: 'text-cyan/80 bg-cyan/5 border-cyan/15',
  Tactical: 'text-gold/80 bg-gold/5 border-gold/15',
};

const MANDATE_COPY = {
  Conservative: 'Capital preservation focus.',
  Balanced: 'Balanced risk profile.',
  Tactical: 'Higher-conviction style.',
};

const SURFACE_TONES = {
  gold: {
    panel: 'border-gold/18 bg-gold/[0.06]',
    icon: 'text-gold/70',
    value: 'text-gold',
  },
  cyan: {
    panel: 'border-cyan/18 bg-cyan/[0.06]',
    icon: 'text-cyan/70',
    value: 'text-cyan',
  },
  emerald: {
    panel: 'border-emerald-soft/18 bg-emerald-soft/[0.06]',
    icon: 'text-emerald-soft/70',
    value: 'text-emerald-soft',
  },
  red: {
    panel: 'border-red-warn/18 bg-red-warn/[0.07]',
    icon: 'text-red-warn/75',
    value: 'text-red-warn',
  },
  steel: {
    panel: 'border-white/[0.08] bg-white/[0.03]',
    icon: 'text-steel/60',
    value: 'text-white',
  },
};

const PILL_TONES = {
  gold: 'border-gold/18 bg-gold/[0.08] text-gold/80',
  cyan: 'border-cyan/18 bg-cyan/[0.08] text-cyan/80',
  emerald: 'border-emerald-soft/18 bg-emerald-soft/[0.08] text-emerald-soft/80',
  red: 'border-red-warn/18 bg-red-warn/[0.1] text-red-warn/80',
  steel: 'border-white/[0.08] bg-white/[0.03] text-steel/65',
};

export default function OperatorProfilePage() {
  const navigate = useNavigate();
  const { operatorAddress } = useParams();
  const { address: walletAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const registryAddress = deployments.operatorRegistry;

  const validAddress = operatorAddress && isAddress(operatorAddress);
  const { data: op, refetch: refetchOp } = useOperator(registryAddress, validAddress ? operatorAddress : undefined);
  const { data: extended } = useOperatorExtended(registryAddress, validAddress ? operatorAddress : undefined);
  const { data: orchStatus } = useOrchestratorStatus();
  const { vaults: myVaults } = useVaultList(deployments.aegisVaultFactory, walletAddress);

  const { setExecutor, hash: setExecHash, isPending: setExecPending, isSuccess: setExecSuccess } = useSetExecutor();
  const { deactivate, hash: deactivateHash, isPending: deactivating } = useDeactivateOperator();
  const { activate, hash: activateHash, isPending: activating } = useActivateOperator();

  const stakingAddress = deployments.operatorStaking;
  // Stake token resolution: on 0G mainnet (chain 16661) OperatorStaking is
  // configured with oUSDT (Hyperlane-bridged USDT) as its stakeToken, NOT
  // mockUSDC. Approving mockUSDC there leaves oUSDT allowance at 0 and the
  // stake() call reverts with InsufficientAllowance. On other chains the
  // stake token is the mock USDC deployed alongside the staking contract.
  const usdcAddress = deployments.oUSDT || deployments.mockUSDC;
  const { state: stakeState, refetch: refetchStake } = useOperatorStake(
    stakingAddress,
    validAddress ? operatorAddress : undefined
  );
  const { data: usdcAllowance, refetch: refetchAllowance } = useStakingAllowance(
    usdcAddress,
    walletAddress,
    stakingAddress
  );
  const { balance: walletUsdcBalance } = useTokenBalance(usdcAddress, walletAddress, 6);
  // Label the stake token based on which address we resolved so mainnet users
  // see "oUSDT" (what they actually need to have) instead of "USDC".
  const stakeTokenLabel = deployments.oUSDT ? 'oUSDT' : 'USDC';
  const { approve: approveUsdc, hash: approveStakeHash, isPending: approvingStake } = useApproveStake();
  const { stake, hash: stakeHash, isPending: staking, isSuccess: stakeSuccess } = useStake();
  const {
    requestUnstake,
    hash: requestUnstakeHash,
    isPending: requesting,
    isSuccess: requestSuccess,
  } = useRequestUnstake();
  const { claimUnstake, hash: claimUnstakeHash, isPending: claiming, isSuccess: claimSuccess } = useClaimUnstake();

  const reputationAddress = deployments.operatorReputation;
  const { state: repState, refetch: refetchRep } = useOperatorReputation(
    reputationAddress,
    validAddress ? operatorAddress : undefined
  );
  const { data: alreadyRated, refetch: refetchHasRated } = useHasRated(
    reputationAddress,
    validAddress ? operatorAddress : undefined,
    walletAddress
  );
  const {
    submitRating,
    hash: submitRatingHash,
    isPending: ratingPending,
    isSuccess: ratingSuccess,
  } = useSubmitRating();
  const { data: repAdmin } = useReputationAdmin(reputationAddress);
  const {
    setVerified,
    hash: verifyHash,
    isPending: verifyPending,
    isSuccess: verifySuccess,
  } = useSetVerified();
  const isReputationAdmin = walletAddress && repAdmin && walletAddress.toLowerCase() === repAdmin.toLowerCase();

  const [selectedVault, setSelectedVault] = useState('');
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!validAddress) {
    return (
      <div className="max-w-3xl mx-auto px-4 lg:px-6 py-12 text-center">
        <p className="text-sm text-steel/50">Invalid operator address.</p>
        <Link to="/marketplace" className="text-cyan/60 text-xs mt-3 inline-block">Back to Marketplace</Link>
      </div>
    );
  }

  if (!op) {
    return (
      <div className="max-w-3xl mx-auto px-4 lg:px-6 py-12 text-center">
        <div className="w-6 h-6 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-3" />
        <p className="text-xs text-steel/40">Loading operator from chain...</p>
      </div>
    );
  }

  const mandateLabel = MandateLabel[Number(op.mandate)];
  const isOwn = walletAddress?.toLowerCase() === operatorAddress.toLowerCase();
  const isLive =
    orchStatus?.executorAddress &&
    orchStatus.executorAddress.toLowerCase() === operatorAddress.toLowerCase();
  const operatorExplorerHref = getExplorerAddressHref(chainId, operatorAddress);
  const unstakeClaimable =
    (stakeState?.pendingUnstake || 0) > 0 &&
    (stakeState?.unstakeAvailableAt || 0) <= nowSeconds;
  const recentOperatorTxs = [
    { label: 'Approve stake', hash: approveStakeHash },
    { label: 'Stake capital', hash: stakeHash },
    { label: 'Request unstake', hash: requestUnstakeHash },
    { label: 'Claim unstake', hash: claimUnstakeHash },
    { label: 'Submit rating', hash: submitRatingHash },
    { label: 'Set verified badge', hash: verifyHash },
    { label: 'Assign executor', hash: setExecHash },
    { label: 'Deactivate operator', hash: deactivateHash },
    { label: 'Reactivate operator', hash: activateHash },
  ]
    .map((item) => ({
      ...item,
      href: getExplorerTxHref(chainId, item.hash),
    }))
    .filter((item) => item.href);

  const repScore = reputationScore(repState);
  const feePreview = estimateAnnualFees(10_000, op.performanceFeeBps, op.managementFeeBps, 10);
  const tier = stakeState?.tier || 0;
  const capacityLabel = formatVaultCap(stakeState?.maxVaultSize || 5_000, stakeState?.isUnlimited);
  const hasAiProvider = Boolean(extended?.aiProvider && extended.aiProvider !== ZERO_ADDRESS);
  const disclosurePills = buildDisclosurePills({
    extended,
    endpoint: op.endpoint,
    isLive,
    orchStatus,
  });
  const overviewCards = [
    {
      title: 'Mandate fit',
      body: MANDATE_COPY[mandateLabel] || 'Operator mandate disclosed on-chain for allocator review.',
      tone: mandateLabel === 'Conservative' ? 'emerald' : mandateLabel === 'Tactical' ? 'gold' : 'cyan',
    },
    {
      title: 'Accountability',
      body: getAccountabilityCopy(stakeState),
      tone: stakeState?.frozen ? 'red' : (stakeState?.amount || 0) > 0 ? 'gold' : 'steel',
    },
    {
      title: 'Public disclosures',
      body: getDisclosureCopy(op.endpoint, extended),
      tone: extended?.manifestURI || extended?.aiModel || op.endpoint ? 'cyan' : 'steel',
    },
  ];
  const snapshotCards = [
    {
      icon: ShieldCheck,
      label: 'Reputation score',
      value: `${repScore}/100`,
      hint:
        (repState?.totalExecutions || 0) > 0
          ? `${(repState?.successRatePct || 0).toFixed(1)}% success · ${repState?.ratingCount || 0} review${repState?.ratingCount === 1 ? '' : 's'}`
          : 'No history yet',
      tone: getScoreTone(repScore),
    },
    {
      icon: Lock,
      label: 'Slashable stake',
      value: formatUsd(stakeState?.amount || 0),
      hint: stakeState?.frozen
        ? 'Frozen'
        : (stakeState?.amount || 0) > 0
          ? `${TIER_LABELS[tier]} tier`
          : 'No stake',
      tone: stakeState?.frozen ? 'red' : (stakeState?.amount || 0) > 0 ? 'gold' : 'steel',
    },
    {
      icon: Award,
      label: 'Vault capacity',
      value: capacityLabel,
      hint: stakeState?.isUnlimited
        ? `${TIER_LABELS[tier]} tier`
        : `${TIER_LABELS[tier]} cap`,
      tone: tier >= 3 ? 'gold' : tier >= 1 ? 'cyan' : 'steel',
    },
    {
      icon: DollarSign,
      label: '$10k fee preview',
      value: formatUsd(feePreview.totalEstimated),
      hint: `${formatUsd(feePreview.managementCost)} mgmt + ${formatUsd(feePreview.performanceCost)} perf`,
      tone: 'cyan',
    },
  ];

  const handleAssign = () => {
    if (!selectedVault) return;
    setExecutor(selectedVault, operatorAddress);
    setTimeout(() => navigate(`/app/vault/${selectedVault}`), 4000);
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      <Link to="/marketplace" className="text-xs text-steel/50 hover:text-white inline-flex items-center gap-1.5 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Marketplace
      </Link>

      <GlassPanel gold className="relative overflow-hidden p-6 lg:p-7 mb-6">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 right-0 h-72 w-72 rounded-full bg-gold/10 blur-3xl" />
          <div className="absolute bottom-0 left-10 h-56 w-56 rounded-full bg-cyan/10 blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" />
        </div>

        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_360px]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[10px] font-mono uppercase tracking-[0.2em] text-steel/55">
              <Sparkles className="w-3 h-3 text-gold/70" />
              Operator Profile
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span
                className={`text-[10px] font-mono px-2.5 py-1 rounded-full border ${
                  MANDATE_COLORS[mandateLabel] || 'text-steel/50 bg-white/[0.02] border-white/[0.06]'
                }`}
              >
                {mandateLabel}
              </span>
              <StatusPill label={op.active ? 'Active' : 'Inactive'} variant={op.active ? 'active' : 'paused'} pulse={op.active} />
              {repState?.verified && (
                <span className="text-[10px] font-mono text-cyan/80 px-2.5 py-1 rounded-full bg-cyan/10 border border-cyan/20 inline-flex items-center gap-1">
                  <BadgeCheck className="w-3 h-3" />
                  Verified
                </span>
              )}
              {tier > 0 && (
                <span className={`text-[10px] font-mono px-2.5 py-1 rounded-full border bg-white/[0.02] border-white/[0.06] inline-flex items-center gap-1 ${TIER_COLORS[tier]}`}>
                  <Award className="w-3 h-3" />
                  {TIER_LABELS[tier]}
                </span>
              )}
              {stakeState?.frozen && (
                <span className="text-[10px] font-mono text-red-warn/80 px-2.5 py-1 rounded-full bg-red-warn/10 border border-red-warn/20">
                  Frozen
                </span>
              )}
              {isOwn && <span className="text-[10px] font-mono text-cyan/50 px-2.5 py-1 rounded-full bg-cyan/5 border border-cyan/10">You</span>}
            </div>

            <div className="mt-4">
              <div className="flex items-baseline gap-3.5 mb-2">
                <span className="ed-eyebrow">§ O.01</span>
                <span
                  className="ed-mono text-[10.5px] tracking-[0.22em] uppercase"
                  style={{ color: 'var(--ed-steel-400)' }}
                >
                  Operator file · {op.mandateLabel || 'Mandate'}
                </span>
              </div>
              <h1
                className="ed-display"
                style={{
                  fontSize: 40,
                  fontWeight: 500,
                  letterSpacing: '-0.035em',
                  lineHeight: 1,
                  margin: 0,
                }}
              >
                {op.name}
              </h1>
              <p
                className="ed-italic mt-4 max-w-3xl"
                style={{ fontSize: 16, color: 'var(--ed-steel-200)', lineHeight: 1.55 }}
              >
                {op.description ? (
                  <>"{op.description}"</>
                ) : (
                  <span style={{ color: 'var(--ed-steel-500)' }}>No description provided.</span>
                )}
              </p>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-mono text-steel/45">
              <span title={operatorAddress}>{shortHexLabel(operatorAddress, 10, 6)}</span>
              {operatorExplorerHref && (
                <ExplorerAnchor
                  href={operatorExplorerHref}
                  label="Explorer"
                  className="text-cyan/55 hover:text-cyan"
                  iconClassName="w-3 h-3"
                />
              )}
              <span>Registered {formatDate(op.registeredAt)}</span>
              <span>Updated {formatDate(op.updatedAt || op.registeredAt)}</span>
              {isLive && (
                <span className="inline-flex items-center gap-1 text-emerald-soft/70">
                  <Activity className="w-3 h-3" />
                  Live API · {orchStatus?.cycleCount || 0} cycles · {orchStatus?.totalExecutions || 0} exec
                </span>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {disclosurePills.length > 0 ? disclosurePills.map((item) => (
                <InfoPill
                  key={item.label}
                  icon={item.icon}
                  label={item.label}
                  tone={item.tone}
                  href={item.href}
                />
              )) : (
                <InfoPill icon={Info} label="No public disclosures" tone="steel" />
              )}
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {overviewCards.map((card) => (
                <OverviewCard
                  key={card.title}
                  title={card.title}
                  body={card.body}
                  tone={card.tone}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2 content-start">
            {snapshotCards.map((card) => (
              <SnapshotCard
                key={card.label}
                icon={card.icon}
                label={card.label}
                value={card.value}
                hint={card.hint}
                tone={card.tone}
              />
            ))}
          </div>
        </div>
      </GlassPanel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <div>
              <SectionLabel color="text-gold/60">Commercial Terms</SectionLabel>
              <GlassPanel className="p-5">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="rounded-xl bg-gold/[0.04] border border-gold/15 p-4">
                    <div className="flex items-center gap-1.5 mb-1">
                      <TrendingUp className="w-3 h-3 text-gold/60" />
                      <span className="text-[9px] font-mono uppercase tracking-wider text-steel/45">Performance</span>
                    </div>
                    <div className="text-2xl font-display font-semibold text-gold tabular-nums">
                      {formatBps(op.performanceFeeBps)}
                    </div>
                    <div className="text-[10px] text-steel/40 mt-1">Above HWM</div>
                  </div>
                  <div className="rounded-xl bg-cyan/[0.04] border border-cyan/15 p-4">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Percent className="w-3 h-3 text-cyan/60" />
                      <span className="text-[9px] font-mono uppercase tracking-wider text-steel/45">Management</span>
                    </div>
                    <div className="text-2xl font-display font-semibold text-cyan tabular-nums">
                      {formatBps(op.managementFeeBps)}
                    </div>
                    <div className="text-[10px] text-steel/40 mt-1">Per year</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-4 text-[10px] font-mono">
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-steel/45">
                    Entry <span className="text-white/75 tabular-nums">{formatBps(op.entryFeeBps)}</span>
                  </span>
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-steel/45">
                    Exit <span className="text-white/75 tabular-nums">{formatBps(op.exitFeeBps)}</span>
                  </span>
                </div>

                <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] px-4 py-3">
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-steel/45 mb-2">
                    <Info className="w-3 h-3" />
                    Fee Preview
                  </div>
                  <div className="flex items-end justify-between gap-4">
                    <div className="text-[11px] text-steel/48 leading-relaxed">$10k vault · 10% annual return</div>
                    <div className="text-right font-mono tabular-nums">
                      <div className="text-lg font-display font-semibold text-white">{formatUsd(feePreview.totalEstimated)}</div>
                      <div className="text-[10px] text-steel/40">
                        {formatUsd(feePreview.managementCost)} mgmt + {formatUsd(feePreview.performanceCost)} perf
                      </div>
                    </div>
                  </div>
                </div>
              </GlassPanel>
            </div>

            <div>
              <SectionLabel color="text-emerald-soft/60">Suggested Vault Policy</SectionLabel>
              <GlassPanel className="p-5">
                <div className="divide-y divide-white/[0.04] text-[11px]">
                  <PolicyRow
                    label="Max position"
                    value={`${(Number(op.recommendedMaxPositionBps || 0) / 100).toFixed(1)}%`}
                  />
                  <PolicyRow
                    label="Min confidence"
                    value={`${(Number(op.recommendedConfidenceMinBps || 0) / 100).toFixed(0)}%`}
                  />
                  <PolicyRow
                    label="Stop-loss"
                    value={`${(Number(op.recommendedStopLossBps || 0) / 100).toFixed(1)}%`}
                  />
                  <PolicyRow
                    label="Cooldown"
                    value={`${Math.round(Number(op.recommendedCooldownSeconds || 0) / 60)} min`}
                  />
                  <PolicyRow
                    label="Max trades / day"
                    value={`${Number(op.recommendedMaxActionsPerDay || 0)}`}
                  />
                </div>
              </GlassPanel>
            </div>
          </div>

          {stakingAddress && !isOwn && (stakeState?.amount || 0) === 0 && !stakeState?.frozen ? (
            <div>
              <SectionLabel color="text-gold/60">Operator Collateral</SectionLabel>
              <EmptyBanner icon={Lock}>
                No stake posted yet.
              </EmptyBanner>
            </div>
          ) : stakingAddress && (
            <div>
              <SectionLabel color="text-gold/60">
                Operator Collateral
                {stakeState?.frozen && (
                  <span className="ml-2 text-[9px] font-mono text-red-warn/80 px-1.5 py-0.5 rounded bg-red-warn/10 border border-red-warn/20">
                    FROZEN
                  </span>
                )}
              </SectionLabel>
              <GlassPanel gold className="p-5 lg:p-6">
                <div className="grid lg:grid-cols-3 gap-4 mb-4">
                  <div className="rounded-xl bg-gradient-to-br from-gold/[0.08] to-gold/[0.02] border border-gold/15 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Award className="w-3.5 h-3.5 text-gold/70" />
                      <span className="text-[10px] font-mono uppercase tracking-wider text-steel/45">Tier</span>
                    </div>
                    <div className={`text-2xl font-display font-semibold ${TIER_COLORS[tier]}`}>
                      {TIER_LABELS[tier]}
                    </div>
                    <div className="text-[10px] text-steel/45 mt-1">
                      Vault cap: <span className="text-white/70">{capacityLabel}</span>
                    </div>
                  </div>

                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Lock className="w-3.5 h-3.5 text-cyan/60" />
                      <span className="text-[10px] font-mono uppercase tracking-wider text-steel/45">Active Stake</span>
                    </div>
                    <div className="text-2xl font-display font-semibold text-white tabular-nums">
                      {formatUsd(stakeState?.amount || 0)}
                    </div>
                    <div className="text-[10px] text-steel/45 mt-1">Locked {stakeTokenLabel}</div>
                  </div>

                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Hourglass className="w-3.5 h-3.5 text-amber-warn/60" />
                      <span className="text-[10px] font-mono uppercase tracking-wider text-steel/45">Pending Unstake</span>
                    </div>
                    <div className="text-2xl font-display font-semibold text-amber-warn tabular-nums">
                      {formatUsd(stakeState?.pendingUnstake || 0)}
                    </div>
                    <div className="text-[10px] text-steel/45 mt-1">
                      {stakeState?.unstakeAvailableAt
                        ? `Claimable ${formatDate(stakeState.unstakeAvailableAt)}`
                        : '14-day cooldown begins on request'}
                    </div>
                  </div>
                </div>

                {stakeState && !stakeState.isUnlimited && (
                  <div className="mb-4">
                    {(() => {
                      const next = nextTier(stakeState.tier);
                      if (next === null) return null;
                      const gap = tierGapUsd(stakeState.amount, stakeState.tier);
                      const nextThreshold = TIER_THRESHOLDS[next];
                      const progressPct = Math.min(100, (stakeState.amount / nextThreshold) * 100);

                      return (
                        <>
                          <div className="flex items-center justify-between mb-1.5 text-[10px] font-mono">
                            <span className="text-steel/50">Progress to {TIER_LABELS[next]}</span>
                            <span className="text-white/60 tabular-nums">
                              {formatUsd(stakeState.amount)} / {formatUsd(nextThreshold)}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-gold/60 to-gold transition-all"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          {gap > 0 && (
                            <div className="text-[10px] text-steel/40 mt-1">
                              {formatUsd(gap)} more to unlock{' '}
                              {formatVaultCap(
                                next === 1 ? 50_000 : next === 2 ? 500_000 : next === 3 ? 5_000_000 : Infinity,
                                next === 4
                              )}{' '}
                              vault capacity.
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 mb-4 text-[10px]">
                  <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2">
                    <span className="text-steel/40">Lifetime staked </span>
                    <span className="text-white/70 font-mono tabular-nums">{formatUsd(stakeState?.lifetimeStaked || 0)}</span>
                  </div>
                  <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2">
                    <span className="text-steel/40">Lifetime slashed </span>
                    <span className={`font-mono tabular-nums ${(stakeState?.lifetimeSlashed || 0) > 0 ? 'text-red-warn' : 'text-white/70'}`}>
                      {formatUsd(stakeState?.lifetimeSlashed || 0)}
                    </span>
                  </div>
                </div>

                {isOwn && isConnected && (
                  <div className="border-t border-white/[0.06] pt-4">
                    <div className="grid lg:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-2">
                          Add stake ({stakeTokenLabel})
                        </label>
                        <input
                          type="number"
                          value={stakeAmount}
                          onChange={(event) => setStakeAmount(event.target.value)}
                          placeholder="0.00"
                          disabled={stakeState?.frozen}
                          className="w-full bg-obsidian/60 border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-gold/30 transition-colors disabled:opacity-50"
                        />
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] text-steel/40">
                            Wallet balance {parseFloat(walletUsdcBalance || '0').toLocaleString(undefined, { maximumFractionDigits: 2 })} {stakeTokenLabel}
                          </span>
                          <button
                            onClick={() => setStakeAmount(walletUsdcBalance || '0')}
                            className="text-[10px] text-gold/60 hover:text-gold transition-colors"
                          >
                            Max
                          </button>
                        </div>
                        {(() => {
                          const needsApproval =
                            !!stakeAmount &&
                            Number(stakeAmount) > 0 &&
                            (!usdcAllowance || Number(usdcAllowance) / 1e6 < Number(stakeAmount));

                          return (
                            <div className="flex gap-2 mt-2">
                              {needsApproval ? (
                                <ControlButton
                                  variant="gold"
                                  size="sm"
                                  className="flex-1"
                                  disabled={!stakeAmount || Number(stakeAmount) <= 0 || approvingStake || stakeState?.frozen}
                                  onClick={() => {
                                    approveUsdc(usdcAddress, stakingAddress, stakeAmount, 6);
                                    setTimeout(() => refetchAllowance(), 4000);
                                  }}
                                >
                                  {approvingStake ? 'Approving...' : `Approve ${stakeTokenLabel}`}
                                </ControlButton>
                              ) : (
                                <ControlButton
                                  variant="primary"
                                  size="sm"
                                  className="flex-1"
                                  disabled={!stakeAmount || Number(stakeAmount) <= 0 || staking || stakeState?.frozen}
                                  onClick={() => {
                                    stake(stakingAddress, stakeAmount, 6);
                                    setTimeout(() => {
                                      refetchStake();
                                      setStakeAmount('');
                                    }, 4000);
                                  }}
                                >
                                  {staking ? 'Staking...' : 'Stake'}
                                </ControlButton>
                              )}
                            </div>
                          );
                        })()}
                        {stakeSuccess && (
                          <p className="text-[10px] text-emerald-soft/70 mt-2">Stake confirmed on-chain.</p>
                        )}
                      </div>

                      <div>
                        <label className="text-[10px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-2">
                          Request unstake ({stakeTokenLabel})
                        </label>
                        <input
                          type="number"
                          value={unstakeAmount}
                          onChange={(event) => setUnstakeAmount(event.target.value)}
                          placeholder="0.00"
                          disabled={stakeState?.frozen || (stakeState?.pendingUnstake || 0) > 0}
                          className="w-full bg-obsidian/60 border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-gold/30 transition-colors disabled:opacity-50"
                        />
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] text-steel/40">
                            Active collateral {formatUsd(stakeState?.amount || 0, 2)}
                          </span>
                          <button
                            onClick={() => setUnstakeAmount(String(stakeState?.amount || 0))}
                            className="text-[10px] text-gold/60 hover:text-gold transition-colors"
                          >
                            Max
                          </button>
                        </div>
                        <div className="flex gap-2 mt-2">
                          <ControlButton
                            variant="secondary"
                            size="sm"
                            className="flex-1"
                            disabled={
                              !unstakeAmount ||
                              Number(unstakeAmount) <= 0 ||
                              requesting ||
                              stakeState?.frozen ||
                              (stakeState?.pendingUnstake || 0) > 0
                            }
                            onClick={() => {
                              requestUnstake(stakingAddress, unstakeAmount, 6);
                              setTimeout(() => {
                                refetchStake();
                                setUnstakeAmount('');
                              }, 4000);
                            }}
                          >
                            <Hourglass className="w-3 h-3" />
                            {requesting ? 'Requesting...' : 'Request Unstake'}
                          </ControlButton>
                          {unstakeClaimable && (
                            <ControlButton
                              variant="gold"
                              size="sm"
                              className="flex-1"
                              disabled={claiming || stakeState?.frozen}
                              onClick={() => {
                                claimUnstake(stakingAddress);
                                setTimeout(() => refetchStake(), 4000);
                              }}
                            >
                              <Unlock className="w-3 h-3" />
                              {claiming ? 'Claiming...' : 'Claim Unstake'}
                            </ControlButton>
                          )}
                        </div>
                        {(stakeState?.pendingUnstake || 0) > 0 && (
                          <p className="text-[10px] text-amber-warn/70 mt-2">
                            Existing unstake pending. Another request cannot be opened yet.
                          </p>
                        )}
                        {requestSuccess && (
                          <p className="text-[10px] text-emerald-soft/70 mt-2">14-day cooldown started.</p>
                        )}
                        {claimSuccess && (
                          <p className="text-[10px] text-emerald-soft/70 mt-2">Stake withdrawn back to wallet.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {!isOwn && (
                  <div className="border-t border-white/[0.06] pt-4">
                    <div className="flex items-start gap-2 text-[11px] text-steel/55">
                      <Info className="w-3.5 h-3.5 text-cyan/60 flex-shrink-0 mt-0.5" />
                      <p>
                        Slashable collateral backing this operator.
                      </p>
                    </div>
                  </div>
                )}

                {stakeState?.frozen && (
                  <div className="border-t border-white/[0.06] pt-4 mt-4">
                    <div className="rounded-lg bg-red-warn/5 border border-red-warn/15 px-3 py-3 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-warn/70 flex-shrink-0 mt-0.5" />
                      <div className="text-[11px] text-red-warn/70">
                        <strong>Stake frozen.</strong> Stake actions are disabled.
                      </div>
                    </div>
                  </div>
                )}
              </GlassPanel>
            </div>
          )}

          {reputationAddress && (repState?.totalExecutions || 0) === 0 && !isReputationAdmin && !(isConnected && !isOwn && !alreadyRated) ? (
            <div>
              <SectionLabel color="text-cyan/60">On-chain Track Record</SectionLabel>
              <EmptyBanner icon={BarChart3}>
                No execution history yet.
              </EmptyBanner>
            </div>
          ) : reputationAddress && (
            <div>
              <SectionLabel color="text-cyan/60">
                On-chain Track Record
                {repState?.verified && (
                  <span className="ml-2 text-[9px] font-mono text-cyan/80 px-1.5 py-0.5 rounded bg-cyan/10 border border-cyan/20 inline-flex items-center gap-1">
                    <BadgeCheck className="w-2.5 h-2.5" />
                    VERIFIED
                  </span>
                )}
              </SectionLabel>
              <GlassPanel className="p-5 lg:p-6">
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <BarChart3 className="w-3 h-3 text-cyan/60" />
                      <span className="text-[9px] font-mono uppercase text-steel/45">Executions</span>
                    </div>
                    <div className="text-xl font-display font-semibold text-white tabular-nums">
                      {(repState?.totalExecutions || 0).toLocaleString()}
                    </div>
                    <div className="text-[9px] text-steel/40 mt-0.5">
                      {repState?.successfulExecutions || 0} successful
                    </div>
                  </div>

                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Percent className="w-3 h-3 text-emerald-soft/60" />
                      <span className="text-[9px] font-mono uppercase text-steel/45">Success</span>
                    </div>
                    <div className="text-xl font-display font-semibold text-emerald-soft tabular-nums">
                      {(repState?.successRatePct || 0).toFixed(1)}%
                    </div>
                    <div className="text-[9px] text-steel/40 mt-0.5">
                      {(repState?.totalExecutions || 0) > 0 ? 'On-chain' : 'No executions'}
                    </div>
                  </div>

                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <DollarSign className="w-3 h-3 text-gold/60" />
                      <span className="text-[9px] font-mono uppercase text-steel/45">Volume</span>
                    </div>
                    <div className="text-xl font-display font-semibold text-gold tabular-nums">
                      {formatUsd(repState?.totalVolumeUsd || 0)}
                    </div>
                    <div className="text-[9px] text-steel/40 mt-0.5">Cumulative notional</div>
                  </div>

                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <TrendingUp className={`w-3 h-3 ${(repState?.cumulativePnlUsd || 0) >= 0 ? 'text-emerald-soft/60' : 'text-red-warn/60'}`} />
                      <span className="text-[9px] font-mono uppercase text-steel/45">Cum. PnL</span>
                    </div>
                    <div className={`text-xl font-display font-semibold tabular-nums ${(repState?.cumulativePnlUsd || 0) >= 0 ? 'text-emerald-soft' : 'text-red-warn'}`}>
                      {formatPnl(repState?.cumulativePnlUsd || 0)}
                    </div>
                    <div className="text-[9px] text-steel/40 mt-0.5">Realized only</div>
                  </div>

                  <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Star className="w-3 h-3 text-amber-warn/60" />
                      <span className="text-[9px] font-mono uppercase text-steel/45">Rating</span>
                    </div>
                    <div className="text-xl font-display font-semibold text-amber-warn tabular-nums">
                      {(repState?.averageRating || 0).toFixed(2)}
                    </div>
                    <div className="text-[9px] text-steel/40 mt-0.5">
                      {repState?.ratingCount || 0} review{repState?.ratingCount === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1.5 text-[10px] font-mono">
                    <span className="text-steel/50">Composite reputation score</span>
                    <span className={toneValueClass(getScoreTone(repScore))}>{repScore}/100</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        repScore >= 80
                          ? 'bg-emerald-soft/60'
                          : repScore >= 60
                            ? 'bg-amber-warn/60'
                            : repScore >= 40
                              ? 'bg-cyan/40'
                              : 'bg-steel/40'
                      }`}
                      style={{ width: `${repScore}%` }}
                    />
                  </div>
                  <div className="text-[9px] text-steel/35 mt-1">
                    Success, rating, verified.
                  </div>
                </div>

                {(repState?.firstExecutionAt || 0) > 0 && (
                  <div className="grid grid-cols-2 gap-2 mb-4 text-[10px] font-mono">
                    <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2">
                      <span className="text-steel/40">First execution </span>
                      <span className="text-white/65">{formatDate(repState.firstExecutionAt)}</span>
                    </div>
                    <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2">
                      <span className="text-steel/40">Last execution </span>
                      <span className="text-white/65">{formatDate(repState.lastExecutionAt)}</span>
                    </div>
                  </div>
                )}

                {isReputationAdmin && (
                  <div className="border-t border-white/[0.06] pt-4 mb-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <BadgeCheck className="w-3.5 h-3.5 text-cyan/60" />
                        <span className="text-[11px] font-mono uppercase tracking-wider text-steel/55">
                          Admin verified badge
                        </span>
                      </div>
                      <ControlButton
                        variant={repState?.verified ? 'danger' : 'gold'}
                        size="sm"
                        disabled={verifyPending}
                        onClick={() => {
                          setVerified(reputationAddress, operatorAddress, !repState?.verified);
                          setTimeout(() => refetchRep(), 4000);
                        }}
                      >
                        <BadgeCheck className="w-3 h-3" />
                        {verifyPending
                          ? 'Updating...'
                          : repState?.verified
                            ? 'Revoke verified'
                            : 'Grant verified'}
                      </ControlButton>
                    </div>
                    {verifySuccess && (
                      <p className="text-[10px] text-emerald-soft/70 mt-2">Badge updated on-chain.</p>
                    )}
                  </div>
                )}

                {isConnected && !isOwn && !alreadyRated && (
                  <div className="border-t border-white/[0.06] pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <MessageSquare className="w-3.5 h-3.5 text-cyan/60" />
                      <span className="text-[11px] font-mono uppercase tracking-wider text-steel/55">Rate this operator</span>
                    </div>
                    <div className="flex items-center gap-1 mb-2">
                      {[1, 2, 3, 4, 5].map((starValue) => (
                        <button
                          key={starValue}
                          onClick={() => setRatingStars(starValue)}
                          className={`transition-all ${starValue <= ratingStars ? 'text-amber-warn' : 'text-steel/25 hover:text-steel/50'}`}
                        >
                          <Star className="w-5 h-5" fill={starValue <= ratingStars ? 'currentColor' : 'none'} />
                        </button>
                      ))}
                      <span className="ml-2 text-[11px] font-mono text-white/60 tabular-nums">{ratingStars}/5</span>
                    </div>
                    <textarea
                      value={ratingComment}
                      onChange={(event) => setRatingComment(event.target.value)}
                      placeholder="Optional comment (256 char max)"
                      maxLength={256}
                      rows={2}
                      className="w-full bg-obsidian/60 border border-white/[0.08] rounded-lg px-3 py-2 text-[11px] text-white/80 placeholder:text-steel/30 focus:outline-none focus:border-cyan/30 transition-colors mb-2"
                    />
                    <ControlButton
                      variant="primary"
                      size="sm"
                      disabled={ratingPending}
                      onClick={() => {
                        submitRating(reputationAddress, operatorAddress, ratingStars, ratingComment);
                        setTimeout(() => {
                          refetchRep();
                          refetchHasRated();
                        }, 4000);
                      }}
                    >
                      <Star className="w-3 h-3" />
                      {ratingPending ? 'Submitting...' : 'Submit rating'}
                    </ControlButton>
                    {ratingSuccess && (
                      <p className="text-[10px] text-emerald-soft/70 mt-2">Rating recorded on-chain.</p>
                    )}
                  </div>
                )}

                {alreadyRated && (
                  <div className="border-t border-white/[0.06] pt-3 mt-2">
                    <p className="text-[10px] text-cyan/60 text-center">
                      You&apos;ve already rated this operator.
                    </p>
                  </div>
                )}
              </GlassPanel>
            </div>
          )}
        </div>

        <div className="space-y-6 xl:sticky xl:top-24 self-start">
          <div>
            <SectionLabel color="text-cyan/60">Operator Briefing</SectionLabel>
            <GlassPanel className="p-5">
              <div className="space-y-1">
                <BriefingRow
                  label="Address"
                  value={
                    operatorExplorerHref ? (
                      <a
                        href={operatorExplorerHref}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-mono text-cyan/65 hover:text-cyan break-all transition-colors"
                        title={operatorAddress}
                      >
                        {operatorAddress}
                      </a>
                    ) : (
                      <span className="text-sm font-mono text-white/75 break-all">{operatorAddress}</span>
                    )
                  }
                />
                <BriefingRow label="Status" value={op.active ? 'Active listing' : 'Inactive listing'} />
                <BriefingRow label="Registered" value={formatDate(op.registeredAt)} />
                <BriefingRow label="Updated" value={formatDate(op.updatedAt || op.registeredAt)} />
                <BriefingRow
                  label="AI model"
                  value={
                    extended?.aiModel ? (
                      <span className="text-sm font-mono text-cyan/70 break-all">{extended.aiModel}</span>
                    ) : (
                      <span className="text-sm text-steel/45">Undeclared</span>
                    )
                  }
                />
                {hasAiProvider && (
                  <BriefingRow
                    label="AI provider"
                    value={<span className="text-sm font-mono text-white/75">{shortHexLabel(extended.aiProvider, 10, 6)}</span>}
                  />
                )}
                <BriefingRow
                  label="Manifest"
                  value={
                    extended?.manifestURI ? (
                      <a
                        href={extended.manifestURI}
                        target="_blank"
                        rel="noreferrer"
                        className={`${extended.manifestBonded ? 'text-gold/70' : 'text-cyan/65'} text-sm hover:text-white transition-colors break-all`}
                        title={extended.manifestURI}
                      >
                        v{Number(extended.manifestVersion || 0)}{extended.manifestBonded ? ' bonded manifest' : ' published manifest'}
                      </a>
                    ) : (
                      <span className="text-sm text-steel/45">Not published</span>
                    )
                  }
                />
                <BriefingRow
                  label="Endpoint"
                  value={
                    op.endpoint ? (
                      <a
                        href={op.endpoint}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-cyan/65 hover:text-cyan transition-colors break-all"
                        title={op.endpoint}
                      >
                        {formatEndpoint(op.endpoint)}
                      </a>
                    ) : (
                      <span className="text-sm text-steel/45">Not shared</span>
                    )
                  }
                />
              </div>
            </GlassPanel>
          </div>

          {!isOwn && (
            <div>
              <SectionLabel color="text-gold/60">Allocator Actions</SectionLabel>
              <GlassPanel className="p-5">
                {!isConnected ? (
                  <div className="space-y-3">
                    <p className="text-[12px] text-steel/55 leading-relaxed">Connect wallet to assign this operator.</p>
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-[11px] text-steel/45">
                      Funds stay in your vault.
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-[11px] text-steel/55 mb-4 leading-relaxed">Choose a vault below.</p>

                    {myVaults.length === 0 ? (
                      <div className="text-center py-3">
                        <p className="text-xs text-steel/45 mb-3">No vault yet.</p>
                        <Link to="/create">
                          <ControlButton variant="gold" size="sm">Create a Vault</ControlButton>
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {myVaults.map((vault) => {
                          const selected = selectedVault === vault.address;
                          return (
                            <button
                              key={vault.address}
                              onClick={() => setSelectedVault(vault.address)}
                              className={`w-full text-left px-3 py-3 rounded-lg border transition-all ${
                                selected
                                  ? 'border-gold/30 bg-gold/5'
                                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-xs font-mono text-white/75">{shortHexLabel(vault.address, 8, 6)}</span>
                                <span className="text-[10px] font-mono text-steel/40">
                                  {vault.loaded ? formatUsd(Number(vault.balance) || 0) : 'Loading'}
                                </span>
                              </div>
                              {vault.loaded && (
                                <div className="mt-1 text-[10px] text-steel/40">
                                  {vault.paused ? 'Paused' : vault.autoExecution ? 'Auto execution on' : 'Manual execution'} ·{' '}
                                  {vault.executor?.toLowerCase() === operatorAddress.toLowerCase() ? 'Already assigned' : 'Executor change available'}
                                </div>
                              )}
                            </button>
                          );
                        })}

                        <ControlButton
                          variant="primary"
                          className="w-full mt-3"
                          disabled={!selectedVault || setExecPending || !op.active}
                          onClick={handleAssign}
                        >
                          {setExecPending ? 'Updating executor...' : 'Assign to Vault'}
                        </ControlButton>
                        {setExecSuccess && (
                          <p className="text-[10px] text-emerald-soft/70 text-center">Executor updated on-chain.</p>
                        )}
                        {!op.active && (
                          <p className="text-[10px] text-amber-warn/70 text-center">This operator is currently inactive.</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </GlassPanel>
            </div>
          )}

          {isOwn && (
            <div>
              <SectionLabel color="text-cyan/60">Operator Controls</SectionLabel>
              <GlassPanel className="p-5 space-y-2">
                <Link to="/operator/register">
                  <ControlButton variant="secondary" className="w-full">
                    <Edit3 className="w-3.5 h-3.5" /> Update Profile
                  </ControlButton>
                </Link>
                {op.active ? (
                  <ControlButton
                    variant="danger"
                    className="w-full"
                    disabled={deactivating}
                    onClick={() => {
                      deactivate(registryAddress);
                      setTimeout(() => refetchOp(), 4000);
                    }}
                  >
                    <Power className="w-3.5 h-3.5" /> {deactivating ? 'Deactivating...' : 'Deactivate Listing'}
                  </ControlButton>
                ) : (
                  <ControlButton
                    variant="gold"
                    className="w-full"
                    disabled={activating}
                    onClick={() => {
                      activate(registryAddress);
                      setTimeout(() => refetchOp(), 4000);
                    }}
                  >
                    <Power className="w-3.5 h-3.5" /> {activating ? 'Activating...' : 'Reactivate Listing'}
                  </ControlButton>
                )}
              </GlassPanel>
            </div>
          )}

          <div>
            <SectionLabel color="text-steel/60">Session Transactions</SectionLabel>
            <GlassPanel className="p-4">
              {recentOperatorTxs.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {recentOperatorTxs.map((tx) => (
                    <ExplorerAnchor
                      key={tx.href}
                      href={tx.href}
                      label={`${tx.label} · ${shortHexLabel(tx.hash, 10, 6)}`}
                      className="rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[10px] font-mono text-cyan/60 hover:text-cyan hover:border-cyan/20 transition-colors"
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-steel/45 leading-relaxed">
                  No recent actions.
                </p>
              )}
            </GlassPanel>
          </div>

          <GlassPanel className="p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-4 h-4 text-emerald-soft/60 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-emerald-soft/70 mb-1">
                  Trust Model
                </div>
                <p className="text-[12px] text-steel/55 leading-relaxed">
                  Operators only execute policy-checked actions. Custody stays in the vault.
                </p>
              </div>
            </div>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}

function SnapshotCard({ icon: Icon, label, value, hint, tone = 'steel' }) {
  const toneStyle = SURFACE_TONES[tone] || SURFACE_TONES.steel;
  const iconNode = createElement(Icon, { className: `w-4 h-4 ${toneStyle.icon}` });

  return (
    <div className={`rounded-2xl border p-4 ${toneStyle.panel}`}>
      <div className="flex items-center gap-2 mb-2">
        {iconNode}
        <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-steel/45">{label}</span>
      </div>
      <div className={`text-2xl font-display font-semibold tabular-nums ${toneStyle.value}`}>{value}</div>
      <p className="mt-1 text-[11px] leading-relaxed text-steel/48">{hint}</p>
    </div>
  );
}

function OverviewCard({ title, body, tone = 'steel' }) {
  const toneStyle = SURFACE_TONES[tone] || SURFACE_TONES.steel;

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneStyle.panel}`}>
      <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-steel/45 mb-1">{title}</div>
      <p className="text-[12px] text-steel/58 leading-relaxed">{body}</p>
    </div>
  );
}

function InfoPill({ icon: Icon, label, tone = 'steel', href }) {
  const toneClass = PILL_TONES[tone] || PILL_TONES.steel;
  const className = `inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-mono ${toneClass} transition-colors`;
  const iconNode = createElement(Icon, { className: 'w-3.5 h-3.5 flex-shrink-0' });
  const content = (
    <>
      {iconNode}
      <span className="truncate">{label}</span>
    </>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`${className} hover:border-white/[0.14] hover:text-white/85`}>
        {content}
      </a>
    );
  }

  return <span className={className}>{content}</span>;
}

function BriefingRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-white/[0.05] last:border-b-0">
      <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-steel/40">{label}</span>
      <div className="min-w-0 text-right">{value}</div>
    </div>
  );
}

function EmptyBanner({ icon: Icon, children }) {
  const iconNode = createElement(Icon, { className: 'w-4 h-4 text-steel/35 flex-shrink-0 mt-0.5' });

  return (
    <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-4 flex items-start gap-3 text-[12px] text-steel/55">
      {iconNode}
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}

function PolicyRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-steel/55">{label}</span>
      <span className="font-display font-semibold text-emerald-soft tabular-nums">{value}</span>
    </div>
  );
}

function buildDisclosurePills({ extended, endpoint, isLive, orchStatus }) {
  const pills = [];

  if (extended?.aiModel) {
    pills.push({
      icon: Cpu,
      label: `AI ${formatModelLabel(extended.aiModel)}`,
      tone: 'cyan',
    });
  }

  if (extended?.manifestURI) {
    pills.push({
      icon: FileText,
      label: extended?.manifestBonded
        ? `Bonded manifest v${Number(extended.manifestVersion || 0)}`
        : `Manifest v${Number(extended.manifestVersion || 0)}`,
      tone: extended?.manifestBonded ? 'gold' : 'steel',
      href: extended.manifestURI,
    });
  }

  if (endpoint) {
    pills.push({
      icon: Globe,
      label: formatEndpoint(endpoint),
      tone: 'steel',
      href: endpoint,
    });
  }

  if (isLive) {
    pills.push({
      icon: Activity,
      label: `Live API · ${orchStatus?.cycleCount || 0} cycles`,
      tone: 'emerald',
    });
  }

  return pills;
}

function getAccountabilityCopy(stakeState) {
  if (stakeState?.frozen) {
    return `${formatUsd(stakeState.amount || 0)} frozen.`;
  }

  if ((stakeState?.amount || 0) > 0) {
    return `${formatUsd(stakeState.amount || 0)} staked · cap ${formatVaultCap(
      stakeState.maxVaultSize || 5_000,
      stakeState.isUnlimited
    )}`;
  }

  return 'No stake posted.';
}

function getDisclosureCopy(endpoint, extended) {
  const parts = [];

  if (extended?.aiModel) parts.push(`${formatModelLabel(extended.aiModel)} declared`);
  if (extended?.manifestURI) parts.push(extended.manifestBonded ? 'bonded manifest published' : 'strategy manifest published');
  if (endpoint) parts.push('endpoint shared');

  if (parts.length === 0) {
    return 'No public disclosures.';
  }

  return capitalize(parts.join(' · '));
}

function getScoreTone(score) {
  if (score >= 80) return 'emerald';
  if (score >= 60) return 'gold';
  if (score >= 40) return 'cyan';
  return 'steel';
}

function toneValueClass(tone) {
  return (SURFACE_TONES[tone] || SURFACE_TONES.steel).value;
}

function formatUsd(value, maximumFractionDigits = 0) {
  return `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits })}`;
}

function formatDate(timestamp) {
  if (!Number(timestamp)) return '—';
  return new Date(Number(timestamp) * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatEndpoint(endpoint) {
  if (!endpoint) return '—';
  const cleaned = endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return cleaned.length > 34 ? `${cleaned.slice(0, 31)}...` : cleaned;
}

function formatModelLabel(model) {
  if (!model) return 'AI';
  const tail = model.split('/').pop() || model;
  return tail.length > 22 ? `${tail.slice(0, 19)}...` : tail;
}

function capitalize(value) {
  if (!value) return value;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
