import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { isAddress } from 'viem';
import { getDeployments } from '../lib/contracts';
import { useOperator, MandateLabel, useDeactivateOperator, useActivateOperator } from '../hooks/useOperatorRegistry';
import { useOrchestratorStatus } from '../hooks/useOrchestrator';
import { useVaultList, useSetExecutor, useTokenBalance } from '../hooks/useVault';
import { formatBps, estimateAnnualFees } from '../hooks/useVaultFees';
import {
  useOperatorStake, useStakingAllowance, useApproveStake, useStake,
  useRequestUnstake, useClaimUnstake,
  TIER_LABELS, TIER_COLORS, TIER_THRESHOLDS, tierGapUsd, formatVaultCap, nextTier,
} from '../hooks/useOperatorStaking';
import {
  useOperatorReputation, useHasRated, useSubmitRating, useReputationAdmin, useSetVerified,
  formatPnl, reputationScore,
} from '../hooks/useOperatorReputation';
import GlassPanel from '../components/ui/GlassPanel';
import StatusPill from '../components/ui/StatusPill';
import SectionLabel from '../components/ui/SectionLabel';
import ControlButton from '../components/ui/ControlButton';
import {
  ArrowLeft, Cpu, Globe, Tag, ShieldCheck, Activity, Settings, Power, Edit3, ExternalLink,
  TrendingUp, Percent, DollarSign, Sliders, Info,
  Lock, Unlock, AlertTriangle, Award, Hourglass, Star, BarChart3, BadgeCheck, MessageSquare,
} from 'lucide-react';

const MANDATE_COLORS = {
  Conservative: 'text-emerald-soft/80 bg-emerald-soft/5 border-emerald-soft/15',
  Balanced: 'text-cyan/80 bg-cyan/5 border-cyan/15',
  Tactical: 'text-gold/80 bg-gold/5 border-gold/15',
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
  const { data: orchStatus } = useOrchestratorStatus();
  const { vaults: myVaults } = useVaultList(deployments.aegisVaultFactory, walletAddress);

  const { setExecutor, isPending: setExecPending, isSuccess: setExecSuccess } = useSetExecutor();
  const { deactivate, isPending: deactivating } = useDeactivateOperator();
  const { activate, isPending: activating } = useActivateOperator();

  // Phase 2: Stake state + writes
  const stakingAddress = deployments.operatorStaking;
  const usdcAddress = deployments.mockUSDC;
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
  const { approve: approveUsdc, isPending: approvingStake, isSuccess: approveSuccess } = useApproveStake();
  const { stake, isPending: staking, isSuccess: stakeSuccess } = useStake();
  const { requestUnstake, isPending: requesting, isSuccess: requestSuccess } = useRequestUnstake();
  const { claimUnstake, isPending: claiming, isSuccess: claimSuccess } = useClaimUnstake();

  // Phase 3: Reputation
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
  const { submitRating, isPending: ratingPending, isSuccess: ratingSuccess } = useSubmitRating();
  const { data: repAdmin } = useReputationAdmin(reputationAddress);
  const { setVerified, isPending: verifyPending, isSuccess: verifySuccess } = useSetVerified();
  const isReputationAdmin = walletAddress && repAdmin &&
    walletAddress.toLowerCase() === repAdmin.toLowerCase();

  const [selectedVault, setSelectedVault] = useState('');
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingComment, setRatingComment] = useState('');

  if (!validAddress) {
    return (
      <div className="max-w-3xl mx-auto px-4 lg:px-6 py-12 text-center">
        <p className="text-sm text-steel/50">Invalid operator address.</p>
        <Link to="/marketplace" className="text-cyan/60 text-xs mt-3 inline-block">← Back to Marketplace</Link>
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
  const explorer = chainId === 16602 ? 'https://chainscan-galileo.0g.ai' : null;

  const handleAssign = () => {
    if (!selectedVault) return;
    setExecutor(selectedVault, operatorAddress);
    setTimeout(() => navigate(`/app/vault/${selectedVault}`), 4000);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-6 py-6 lg:py-8">
      {/* Header */}
      <Link to="/marketplace" className="text-xs text-steel/50 hover:text-white inline-flex items-center gap-1.5 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Marketplace
      </Link>

      <GlassPanel gold className="p-6 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
          <div className="w-16 h-16 rounded-xl bg-gold/10 flex items-center justify-center flex-shrink-0">
            <Cpu className="w-8 h-8 text-gold/70" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-2xl font-display font-semibold text-white tracking-tight">{op.name}</h1>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  MANDATE_COLORS[mandateLabel] || 'text-steel/50 bg-white/[0.02] border-white/[0.06]'
                }`}
              >
                {mandateLabel}
              </span>
              <StatusPill label={op.active ? 'Active' : 'Inactive'} variant={op.active ? 'active' : 'paused'} pulse={op.active} />
              {isLive && <StatusPill label="Live API" variant="executed" pulse />}
              {repState?.verified && (
                <span className="text-[9px] font-mono text-cyan/80 px-1.5 py-0.5 rounded bg-cyan/10 border border-cyan/20 flex items-center gap-1">
                  <BadgeCheck className="w-2.5 h-2.5" />
                  VERIFIED
                </span>
              )}
              {stakeState && stakeState.tier > 0 && (
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border bg-white/[0.02] border-white/[0.06] flex items-center gap-1 ${TIER_COLORS[stakeState.tier]}`}>
                  <Award className="w-2.5 h-2.5" />
                  {TIER_LABELS[stakeState.tier]}
                </span>
              )}
              {stakeState?.frozen && (
                <span className="text-[9px] font-mono text-red-warn/80 px-1.5 py-0.5 rounded bg-red-warn/10 border border-red-warn/20">FROZEN</span>
              )}
              {isOwn && <span className="text-[9px] font-mono text-cyan/50 px-1.5 py-0.5 rounded bg-cyan/5 border border-cyan/10">YOU</span>}
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono text-steel/45 mb-3">
              <span>{operatorAddress}</span>
              {explorer && (
                <a
                  href={`${explorer}/address/${operatorAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan/40 hover:text-cyan inline-flex items-center gap-1"
                >
                  Explorer <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
            <p className="text-sm text-steel/65 leading-relaxed mb-4">
              {op.description || 'No description provided.'}
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
              <div>
                <span className="text-steel/40 block">Mandate</span>
                <span className={`font-display font-semibold ${MANDATE_COLORS[mandateLabel]?.split(' ')[0] || 'text-white'}`}>
                  {mandateLabel}
                </span>
              </div>
              <div>
                <span className="text-steel/40 block">Registered</span>
                <span className="font-mono text-white/65">
                  {new Date(Number(op.registeredAt) * 1000).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
              <div>
                <span className="text-steel/40 block">Last Update</span>
                <span className="font-mono text-white/65">
                  {new Date(Number(op.updatedAt) * 1000).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
              <div>
                <span className="text-steel/40 block">API Endpoint</span>
                {op.endpoint ? (
                  <a
                    href={op.endpoint}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-cyan/60 hover:text-cyan truncate flex items-center gap-1"
                    title={op.endpoint}
                  >
                    <Globe className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{op.endpoint.replace(/^https?:\/\//, '')}</span>
                  </a>
                ) : (
                  <span className="text-steel/35">Not provided</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </GlassPanel>

      {/* Fee Structure + Recommended Policy */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div>
          <SectionLabel color="text-gold/60">Fee Structure</SectionLabel>
          <GlassPanel className="p-5">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-lg bg-gold/[0.04] border border-gold/15 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="w-3 h-3 text-gold/60" />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-steel/45">Performance</span>
                </div>
                <div className="text-xl font-display font-semibold text-gold tabular-nums">
                  {formatBps(op.performanceFeeBps)}
                </div>
                <div className="text-[10px] text-steel/40 mt-0.5">on profits above HWM</div>
              </div>
              <div className="rounded-lg bg-cyan/[0.04] border border-cyan/15 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Percent className="w-3 h-3 text-cyan/60" />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-steel/45">Management</span>
                </div>
                <div className="text-xl font-display font-semibold text-cyan tabular-nums">
                  {formatBps(op.managementFeeBps)}
                </div>
                <div className="text-[10px] text-steel/40 mt-0.5">streaming, per year</div>
              </div>
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign className="w-3 h-3 text-steel/45" />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-steel/45">Entry</span>
                </div>
                <div className="text-xl font-display font-semibold text-white/80 tabular-nums">
                  {formatBps(op.entryFeeBps)}
                </div>
                <div className="text-[10px] text-steel/40 mt-0.5">on every deposit</div>
              </div>
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign className="w-3 h-3 text-steel/45" />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-steel/45">Exit</span>
                </div>
                <div className="text-xl font-display font-semibold text-white/80 tabular-nums">
                  {formatBps(op.exitFeeBps)}
                </div>
                <div className="text-[10px] text-steel/40 mt-0.5">on every withdrawal</div>
              </div>
            </div>

            {/* Annual cost estimate (on $10k notional, 10% expected return) */}
            {(() => {
              const est = estimateAnnualFees(10000, op.performanceFeeBps, op.managementFeeBps, 10);
              return (
                <div className="rounded-md bg-white/[0.02] border border-white/[0.05] p-3 text-[11px]">
                  <div className="flex items-center gap-1.5 mb-2 text-steel/55">
                    <Info className="w-3 h-3" />
                    <span>Estimated yearly cost on a $10k vault @ 10% return</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono">
                    <div>
                      <div className="text-[9px] uppercase text-steel/40">Mgmt</div>
                      <div className="text-cyan/70 tabular-nums">${est.managementCost.toFixed(0)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-steel/40">Perf</div>
                      <div className="text-gold/70 tabular-nums">${est.performanceCost.toFixed(0)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-steel/40">Total</div>
                      <div className="text-white/80 tabular-nums">${est.totalEstimated.toFixed(0)}</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <p className="text-[10px] text-steel/40 mt-3 leading-relaxed">
              All fees split <strong className="text-white/60">80% to operator, 20% to protocol treasury</strong>.
              Performance fee uses high-water-mark — only charged on net new profit.
            </p>
          </GlassPanel>
        </div>

        <div>
          <SectionLabel color="text-emerald-soft/60">Recommended Vault Policy</SectionLabel>
          <GlassPanel className="p-5">
            <p className="text-[11px] text-steel/50 mb-4">
              These are the operator's suggested risk parameters. You can override them when creating a vault — your
              vault, your rules.
            </p>
            <div className="space-y-2.5 text-[11px]">
              <PolicyRow
                label="Max Position Size"
                value={`${(Number(op.recommendedMaxPositionBps || 0) / 100).toFixed(1)}%`}
                hint="of vault NAV per single trade"
              />
              <PolicyRow
                label="Min Confidence"
                value={`${(Number(op.recommendedConfidenceMinBps || 0) / 100).toFixed(0)}%`}
                hint="AI confidence threshold to act"
              />
              <PolicyRow
                label="Stop-Loss"
                value={`${(Number(op.recommendedStopLossBps || 0) / 100).toFixed(1)}%`}
                hint="auto-exit on drawdown"
              />
              <PolicyRow
                label="Cooldown"
                value={`${Math.round(Number(op.recommendedCooldownSeconds || 0) / 60)} min`}
                hint="minimum gap between actions"
              />
              <PolicyRow
                label="Max Trades / Day"
                value={`${Number(op.recommendedMaxActionsPerDay || 0)}`}
                hint="hard cap on daily activity"
              />
            </div>
          </GlassPanel>
        </div>
      </div>

      {/* ── Stake & Slashing (Phase 2) ── */}
      {stakingAddress && (
        <div className="mb-6">
          <SectionLabel color="text-gold/60">
            Skin in the Game · Stake
            {stakeState?.frozen && (
              <span className="ml-2 text-[9px] font-mono text-red-warn/80 px-1.5 py-0.5 rounded bg-red-warn/10 border border-red-warn/20">
                FROZEN — ARBITRATION ACTIVE
              </span>
            )}
          </SectionLabel>
          <GlassPanel gold className="p-5">
            <div className="grid lg:grid-cols-3 gap-4 mb-4">
              {/* Tier badge */}
              <div className="rounded-lg bg-gradient-to-br from-gold/[0.08] to-gold/[0.02] border border-gold/15 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Award className="w-3.5 h-3.5 text-gold/70" />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-steel/45">Tier</span>
                </div>
                <div className={`text-2xl font-display font-semibold ${TIER_COLORS[stakeState?.tier || 0]}`}>
                  {TIER_LABELS[stakeState?.tier || 0]}
                </div>
                <div className="text-[10px] text-steel/45 mt-1">
                  Vault cap: <span className="text-white/70">{formatVaultCap(stakeState?.maxVaultSize || 5000, stakeState?.isUnlimited)}</span>
                </div>
              </div>

              {/* Active stake */}
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Lock className="w-3.5 h-3.5 text-cyan/60" />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-steel/45">Active Stake</span>
                </div>
                <div className="text-2xl font-display font-semibold text-white tabular-nums">
                  ${(stakeState?.amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] text-steel/45 mt-1">USDC locked, slashable</div>
              </div>

              {/* Pending unstake */}
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Hourglass className="w-3.5 h-3.5 text-amber-warn/60" />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-steel/45">Pending Unstake</span>
                </div>
                <div className="text-2xl font-display font-semibold text-amber-warn tabular-nums">
                  ${(stakeState?.pendingUnstake || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] text-steel/45 mt-1">
                  {stakeState?.unstakeAvailableAt
                    ? `Claim ${new Date(stakeState.unstakeAvailableAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    : '14-day cooldown when requested'}
                </div>
              </div>
            </div>

            {/* Tier progress bar */}
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
                          ${stakeState.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          {' / '}
                          ${nextThreshold.toLocaleString()}
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
                          ${gap.toLocaleString()} more to unlock {formatVaultCap(
                            next === 1 ? 50_000 : next === 2 ? 500_000 : next === 3 ? 5_000_000 : Infinity,
                            next === 4
                          )} vault cap
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Lifetime stats */}
            <div className="grid grid-cols-2 gap-2 mb-4 text-[10px]">
              <div className="rounded bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
                <span className="text-steel/40">Lifetime staked: </span>
                <span className="text-white/70 font-mono tabular-nums">
                  ${(stakeState?.lifetimeStaked || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="rounded bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
                <span className="text-steel/40">Lifetime slashed: </span>
                <span className={`font-mono tabular-nums ${(stakeState?.lifetimeSlashed || 0) > 0 ? 'text-red-warn' : 'text-white/70'}`}>
                  ${(stakeState?.lifetimeSlashed || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>

            {/* Stake actions — only operator self */}
            {isOwn && isConnected && (
              <div className="border-t border-white/[0.06] pt-4">
                <div className="grid lg:grid-cols-2 gap-4">
                  {/* Stake form */}
                  <div>
                    <label className="text-[10px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-2">
                      Add Stake (USDC)
                    </label>
                    <input
                      type="number"
                      value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value)}
                      placeholder="0.00"
                      disabled={stakeState?.frozen}
                      className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-gold/30 transition-colors disabled:opacity-50"
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] text-steel/40">
                        Wallet: {parseFloat(walletUsdcBalance || '0').toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                      </span>
                      <button
                        onClick={() => setStakeAmount(walletUsdcBalance || '0')}
                        className="text-[10px] text-gold/60 hover:text-gold transition-colors"
                      >Max</button>
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
                              {approvingStake ? 'Approving...' : 'Approve USDC'}
                            </ControlButton>
                          ) : (
                            <ControlButton
                              variant="primary"
                              size="sm"
                              className="flex-1"
                              disabled={!stakeAmount || Number(stakeAmount) <= 0 || staking || stakeState?.frozen}
                              onClick={() => {
                                stake(stakingAddress, stakeAmount, 6);
                                setTimeout(() => { refetchStake(); setStakeAmount(''); }, 4000);
                              }}
                            >
                              {staking ? 'Staking...' : 'Stake'}
                            </ControlButton>
                          )}
                        </div>
                      );
                    })()}
                    {stakeSuccess && (
                      <p className="text-[10px] text-emerald-soft/70 mt-2">Stake confirmed on-chain</p>
                    )}
                  </div>

                  {/* Unstake form */}
                  <div>
                    <label className="text-[10px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-2">
                      Request Unstake (USDC)
                    </label>
                    <input
                      type="number"
                      value={unstakeAmount}
                      onChange={(e) => setUnstakeAmount(e.target.value)}
                      placeholder="0.00"
                      disabled={stakeState?.frozen || (stakeState?.pendingUnstake || 0) > 0}
                      className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-gold/30 transition-colors disabled:opacity-50"
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] text-steel/40">
                        Active: ${(stakeState?.amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                      <button
                        onClick={() => setUnstakeAmount(String(stakeState?.amount || 0))}
                        className="text-[10px] text-gold/60 hover:text-gold transition-colors"
                      >Max</button>
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
                          setTimeout(() => { refetchStake(); setUnstakeAmount(''); }, 4000);
                        }}
                      >
                        <Hourglass className="w-3 h-3" />
                        {requesting ? 'Requesting...' : 'Request Unstake'}
                      </ControlButton>
                      {stakeState?.pendingUnstake > 0 && stakeState?.unstakeAvailableAt < Date.now() / 1000 && (
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
                        Existing unstake pending — cannot request another.
                      </p>
                    )}
                    {requestSuccess && (
                      <p className="text-[10px] text-emerald-soft/70 mt-2">14-day cooldown started</p>
                    )}
                    {claimSuccess && (
                      <p className="text-[10px] text-emerald-soft/70 mt-2">Stake withdrawn to wallet</p>
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
                    This stake is the operator's <strong className="text-white/70">skin in the game</strong>.
                    If they misbehave, governance can slash up to 50% per action — proceeds flow to the insurance pool
                    that compensates damaged users. Higher tiers unlock larger vault caps.
                  </p>
                </div>
              </div>
            )}

            {stakeState?.frozen && (
              <div className="border-t border-white/[0.06] pt-4 mt-4">
                <div className="rounded-md bg-red-warn/5 border border-red-warn/15 px-3 py-2 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-warn/70 flex-shrink-0 mt-0.5" />
                  <div className="text-[11px] text-red-warn/70">
                    <strong>Stake frozen.</strong> Arbitration is in progress. Stake/unstake actions are disabled
                    until governance resolves the case.
                  </div>
                </div>
              </div>
            )}
          </GlassPanel>
        </div>
      )}

      {/* ── Reputation (Phase 3) ── */}
      {reputationAddress && (
        <div className="mb-6">
          <SectionLabel color="text-cyan/60">
            Reputation & Track Record
            {repState?.verified && (
              <span className="ml-2 text-[9px] font-mono text-cyan/80 px-1.5 py-0.5 rounded bg-cyan/10 border border-cyan/20 inline-flex items-center gap-1">
                <BadgeCheck className="w-2.5 h-2.5" />
                VERIFIED OPERATOR
              </span>
            )}
          </SectionLabel>
          <GlassPanel className="p-5">
            {/* Stats grid */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.05] p-3">
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

              <div className="rounded-lg bg-white/[0.02] border border-white/[0.05] p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Percent className="w-3 h-3 text-emerald-soft/60" />
                  <span className="text-[9px] font-mono uppercase text-steel/45">Success</span>
                </div>
                <div className="text-xl font-display font-semibold text-emerald-soft tabular-nums">
                  {(repState?.successRatePct || 0).toFixed(1)}%
                </div>
                <div className="text-[9px] text-steel/40 mt-0.5">
                  {(repState?.totalExecutions || 0) > 0 ? 'on-chain verified' : 'no executions yet'}
                </div>
              </div>

              <div className="rounded-lg bg-white/[0.02] border border-white/[0.05] p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign className="w-3 h-3 text-gold/60" />
                  <span className="text-[9px] font-mono uppercase text-steel/45">Volume</span>
                </div>
                <div className="text-xl font-display font-semibold text-gold tabular-nums">
                  ${(repState?.totalVolumeUsd || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[9px] text-steel/40 mt-0.5">cumulative notional</div>
              </div>

              <div className="rounded-lg bg-white/[0.02] border border-white/[0.05] p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className={`w-3 h-3 ${(repState?.cumulativePnlUsd || 0) >= 0 ? 'text-emerald-soft/60' : 'text-red-warn/60'}`} />
                  <span className="text-[9px] font-mono uppercase text-steel/45">Cum. PnL</span>
                </div>
                <div className={`text-xl font-display font-semibold tabular-nums ${(repState?.cumulativePnlUsd || 0) >= 0 ? 'text-emerald-soft' : 'text-red-warn'}`}>
                  {formatPnl(repState?.cumulativePnlUsd || 0)}
                </div>
                <div className="text-[9px] text-steel/40 mt-0.5">realized only</div>
              </div>

              <div className="rounded-lg bg-white/[0.02] border border-white/[0.05] p-3">
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

            {/* Composite reputation score bar */}
            <div className="mb-4">
              {(() => {
                const score = reputationScore(repState);
                return (
                  <>
                    <div className="flex items-center justify-between mb-1.5 text-[10px] font-mono">
                      <span className="text-steel/50">Composite Reputation Score</span>
                      <span className={`tabular-nums ${
                        score >= 80 ? 'text-emerald-soft' :
                        score >= 60 ? 'text-amber-warn' :
                        score >= 40 ? 'text-steel/70' : 'text-red-warn/70'
                      }`}>{score}/100</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          score >= 80 ? 'bg-emerald-soft/60' :
                          score >= 60 ? 'bg-amber-warn/60' :
                          score >= 40 ? 'bg-steel/40' : 'bg-red-warn/40'
                        }`}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                    <div className="text-[9px] text-steel/35 mt-1">
                      Composite of: success rate (50%), avg rating (30%), verified bonus (20%).
                    </div>
                  </>
                );
              })()}
            </div>

            {/* First/last execution */}
            {(repState?.firstExecutionAt || 0) > 0 && (
              <div className="grid grid-cols-2 gap-2 mb-4 text-[10px] font-mono">
                <div className="rounded bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
                  <span className="text-steel/40">First execution: </span>
                  <span className="text-white/65">
                    {new Date(repState.firstExecutionAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div className="rounded bg-white/[0.02] border border-white/[0.04] px-3 py-1.5">
                  <span className="text-steel/40">Last execution: </span>
                  <span className="text-white/65">
                    {new Date(repState.lastExecutionAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              </div>
            )}

            {/* Admin: grant/revoke verified badge */}
            {isReputationAdmin && (
              <div className="border-t border-white/[0.06] pt-4 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BadgeCheck className="w-3.5 h-3.5 text-cyan/60" />
                    <span className="text-[11px] font-mono uppercase tracking-wider text-steel/55">
                      Admin · Verified Badge
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
                      ? 'Revoke Verified'
                      : 'Grant Verified'}
                  </ControlButton>
                </div>
                {verifySuccess && (
                  <p className="text-[10px] text-emerald-soft/70 mt-2">Badge updated on-chain</p>
                )}
              </div>
            )}

            {/* Rating submission form (only for connected wallets that haven't rated yet, and not the operator self) */}
            {isConnected && !isOwn && !alreadyRated && (
              <div className="border-t border-white/[0.06] pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="w-3.5 h-3.5 text-cyan/60" />
                  <span className="text-[11px] font-mono uppercase tracking-wider text-steel/55">Rate this operator</span>
                </div>
                <div className="flex items-center gap-1 mb-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setRatingStars(n)}
                      className={`transition-all ${n <= ratingStars ? 'text-amber-warn' : 'text-steel/25 hover:text-steel/50'}`}
                    >
                      <Star className="w-5 h-5" fill={n <= ratingStars ? 'currentColor' : 'none'} />
                    </button>
                  ))}
                  <span className="ml-2 text-[11px] font-mono text-white/60 tabular-nums">{ratingStars}/5</span>
                </div>
                <textarea
                  value={ratingComment}
                  onChange={(e) => setRatingComment(e.target.value)}
                  placeholder="Optional comment (256 char max)"
                  maxLength={256}
                  rows={2}
                  className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md px-3 py-2 text-[11px] text-white/80 placeholder:text-steel/30 focus:outline-none focus:border-cyan/30 transition-colors mb-2"
                />
                <ControlButton
                  variant="primary"
                  size="sm"
                  disabled={ratingPending}
                  onClick={() => {
                    submitRating(reputationAddress, operatorAddress, ratingStars, ratingComment);
                    setTimeout(() => { refetchRep(); refetchHasRated(); }, 4000);
                  }}
                >
                  <Star className="w-3 h-3" />
                  {ratingPending ? 'Submitting...' : 'Submit Rating'}
                </ControlButton>
                {ratingSuccess && (
                  <p className="text-[10px] text-emerald-soft/70 mt-2">Rating recorded on-chain</p>
                )}
              </div>
            )}

            {alreadyRated && (
              <div className="border-t border-white/[0.06] pt-3 mt-2">
                <p className="text-[10px] text-cyan/60 text-center">
                  ✓ You've already rated this operator
                </p>
              </div>
            )}
          </GlassPanel>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Action Card */}
        <div className="space-y-6">
          {!isOwn && isConnected && (
            <div>
              <SectionLabel color="text-gold/60">Use this Operator</SectionLabel>
              <GlassPanel className="p-5">
                <p className="text-[11px] text-steel/55 mb-4">
                  Pick one of your vaults below — you'll be prompted to confirm a transaction that calls
                  {' '}<code className="text-cyan/50 font-mono">vault.setExecutor()</code> on-chain.
                </p>

                {myVaults.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-xs text-steel/45 mb-3">You don't have any vaults yet.</p>
                    <Link to="/create">
                      <ControlButton variant="gold" size="sm">Create a Vault</ControlButton>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {myVaults.map((v) => {
                      const shortAddr = `${v.address.slice(0, 8)}...${v.address.slice(-6)}`;
                      const selected = selectedVault === v.address;
                      return (
                        <button
                          key={v.address}
                          onClick={() => setSelectedVault(v.address)}
                          className={`w-full text-left px-3 py-2.5 rounded-md border transition-all ${
                            selected
                              ? 'border-gold/30 bg-gold/5'
                              : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono text-white/70">{shortAddr}</span>
                            {v.loaded && (
                              <span className="text-[10px] font-mono text-steel/40">
                                ${parseFloat(v.balance).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}

                    <ControlButton
                      variant="primary"
                      className="w-full mt-3"
                      disabled={!selectedVault || setExecPending || !op.active}
                      onClick={handleAssign}
                    >
                      {setExecPending ? 'Updating Executor...' : `Assign to Vault`}
                    </ControlButton>
                    {setExecSuccess && (
                      <p className="text-[10px] text-emerald-soft/70 text-center">Executor updated on-chain!</p>
                    )}
                    {!op.active && (
                      <p className="text-[10px] text-amber-warn/70 text-center">This operator is currently inactive.</p>
                    )}
                  </div>
                )}
              </GlassPanel>
            </div>
          )}

          {/* Owner controls */}
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
                    <Power className="w-3.5 h-3.5" /> {deactivating ? 'Deactivating...' : 'Deactivate'}
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
                    <Power className="w-3.5 h-3.5" /> {activating ? 'Activating...' : 'Reactivate'}
                  </ControlButton>
                )}
              </GlassPanel>
            </div>
          )}
        </div>

        {/* Trust + Live Status */}
        <div className="space-y-6">
          <div>
            <SectionLabel color="text-emerald-soft/60">Trust Model</SectionLabel>
            <GlassPanel className="p-5 space-y-3">
              <div className="flex items-start gap-2 text-[11px] text-steel/55">
                <ShieldCheck className="w-4 h-4 text-emerald-soft/60 flex-shrink-0 mt-0.5" />
                <p>
                  This operator <strong className="text-white/70">cannot withdraw or move funds</strong>. They can only call
                  <code className="text-cyan/50 font-mono"> executeIntent()</code> on vaults that pick them.
                </p>
              </div>
              <div className="flex items-start gap-2 text-[11px] text-steel/55">
                <ShieldCheck className="w-4 h-4 text-emerald-soft/60 flex-shrink-0 mt-0.5" />
                <p>
                  Every trade must pass on-chain policy checks (max position, cooldown, confidence threshold, daily loss).
                </p>
              </div>
              <div className="flex items-start gap-2 text-[11px] text-steel/55">
                <ShieldCheck className="w-4 h-4 text-emerald-soft/60 flex-shrink-0 mt-0.5" />
                <p>
                  You can <strong className="text-white/70">switch executor anytime</strong> from the vault detail page.
                </p>
              </div>
            </GlassPanel>
          </div>

          {isLive && (
            <div>
              <SectionLabel color="text-cyan/60">Live API Detected</SectionLabel>
              <GlassPanel className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-cyan/60" />
                  <span className="text-xs text-white/70">Currently active on local orchestrator</span>
                </div>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-steel/45">Cycles</span>
                    <span className="font-mono text-white/65">{orchStatus.cycleCount || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-steel/45">Executions</span>
                    <span className="font-mono text-emerald-soft/70">{orchStatus.totalExecutions || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-steel/45">Blocked</span>
                    <span className="font-mono text-amber-warn/70">{orchStatus.totalBlocked || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-steel/45">Managed Vaults</span>
                    <span className="font-mono text-white/65">{orchStatus.managedVaultCount || 0}</span>
                  </div>
                </div>
              </GlassPanel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PolicyRow({ label, value, hint }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-white/[0.02] border border-white/[0.05] px-3 py-2">
      <div>
        <div className="text-white/70">{label}</div>
        <div className="text-[10px] text-steel/40">{hint}</div>
      </div>
      <div className="text-base font-display font-semibold text-emerald-soft tabular-nums">{value}</div>
    </div>
  );
}
