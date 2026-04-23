import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { isAddress } from 'viem';
import {
  getDeployments,
  getExplorerAddressHref,
  getExplorerTxHref,
  shortHexLabel,
} from '../lib/contracts';
import { doesExecutorMatchOrchestrator } from '../lib/orchestratorStatus';
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
import ControlButton from '../components/ui/ControlButton';
import {
  EyebrowMono as Eyebrow,
  StatusDot,
  ToneChip as Chip,
  TokenAvatar,
  GhostNumeral,
  SectionHead,
} from '../components/editorial/atoms';
import { cx, ACCENTS } from '../components/editorial/tokens';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Award,
  BadgeCheck,
  BarChart3,
  Check,
  Copy,
  Cpu,
  DollarSign,
  Edit3,
  ExternalLink,
  FileText,
  Flame,
  Globe,
  Hourglass,
  Info,
  Layers,
  Lock,
  MessageSquare,
  Percent,
  Power,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Trophy,
  Unlock,
  Zap,
} from 'lucide-react';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const MANDATE_COPY = {
  Conservative: 'Capital preservation focus — lower turnover, tight caps.',
  Balanced: 'Balanced risk profile — policy-checked execution with moderate exposure.',
  Tactical: 'Higher-conviction sizing, richer approval tiers, stricter veto surface.',
};

const MANDATE_CHIP_TONE = {
  Conservative: 'cyan',
  Balanced: 'emerald',
  Tactical: 'gold',
};

/* ─────────────────── Stat tile (right side of hero, 2x2 grid) ─────────────────── */

function StatTile({ icon, label, value, unit, hint, tone = 'cyan' }) {
  const Icon = icon;
  const color = ACCENTS[tone] || ACCENTS.cyan;
  return (
    <div
      className="rounded-2xl p-4 relative overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'var(--ed-ghost-border)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="h-6 w-6 rounded-md flex items-center justify-center"
          style={{ background: `${color}1F`, color }}
        >
          <Icon className="w-3 h-3" />
        </span>
        <Eyebrow tone="muted" className="!text-[9px]">{label}</Eyebrow>
      </div>
      <div className="ed-italic text-[30px] sm:text-[34px] leading-none" style={{ color: 'var(--ed-steel-50)' }}>
        {value}
        {unit && (
          <span
            className="ed-mono not-italic text-[13px] ml-1"
            style={{ color: 'var(--ed-steel-500)' }}
          >
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <div className="ed-mono text-[10px] mt-2" style={{ color: 'var(--ed-steel-500)' }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function OutlineTile({ label, value, icon }) {
  const Icon = icon;
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'rgba(255,255,255,0.02)', boxShadow: 'var(--ed-ghost-border)' }}
    >
      <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--ed-steel-500)' }}>
        <Icon className="w-3 h-3" />
        <Eyebrow tone="muted">{label}</Eyebrow>
      </div>
      <div className="text-[13.5px] leading-[1.45]" style={{ color: 'var(--ed-steel-50)' }}>{value}</div>
    </div>
  );
}

function FootStat({ label, value, leading, href }) {
  const valueNode = href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="ed-mono text-[13px] inline-flex items-center gap-1 transition-colors"
      style={{ color: ACCENTS.cyan }}
    >
      {value}
      <ExternalLink className="w-3 h-3" />
    </a>
  ) : (
    <span
      className="ed-mono text-[13px] whitespace-nowrap"
      style={{ color: 'var(--ed-steel-50)' }}
    >
      {value}
    </span>
  );
  return (
    <div className="flex items-center gap-2 min-w-0">
      {leading}
      <div className="flex flex-col leading-tight min-w-0">
        <span
          className="ed-mono text-[9.5px] uppercase tracking-[0.22em] whitespace-nowrap"
          style={{ color: 'var(--ed-steel-500)' }}
        >
          {label}
        </span>
        {valueNode}
      </div>
    </div>
  );
}

/* ─────────────────── Hero card ─────────────────── */

function OperatorHero({
  op,
  extended,
  operatorAddress,
  operatorExplorerHref,
  mandateLabel,
  repScore,
  repState,
  stakeState,
  tier,
  capacityLabel,
  feePreview,
  orchStatus,
  isLive,
  isOwn,
  disclosurePills,
}) {
  const name = op.name || 'Operator';
  const parts = name.trim().split(' ');
  const titleFirst = parts.slice(0, -1).join(' ');
  const titleTail = parts.slice(-1)[0];
  const tokenSymbol = parts.map((p) => p[0]).join('').slice(0, 3).toUpperCase() || 'OP';

  const snapshotCards = [
    {
      icon: Trophy,
      label: 'Reputation score',
      value: String(repScore || 0),
      unit: '/100',
      hint:
        (repState?.totalExecutions || 0) > 0
          ? `${(repState?.successRatePct || 0).toFixed(1)}% success · ${repState?.ratingCount || 0} review${repState?.ratingCount === 1 ? '' : 's'}`
          : 'No history yet',
      tone: repScore >= 80 ? 'emerald' : repScore >= 60 ? 'amber' : repScore >= 40 ? 'cyan' : 'steel',
    },
    {
      icon: Layers,
      label: 'Slashable stake',
      value: formatUsd(stakeState?.amount || 0),
      hint: stakeState?.frozen ? 'Frozen' : (stakeState?.amount || 0) > 0 ? `${TIER_LABELS[tier]} tier` : 'None yet',
      tone: stakeState?.frozen ? 'rose' : (stakeState?.amount || 0) > 0 ? 'gold' : 'steel',
    },
    {
      icon: ShieldCheck,
      label: 'Vault capacity',
      value: capacityLabel,
      hint: stakeState?.isUnlimited ? `${TIER_LABELS[tier]} unlimited` : `${TIER_LABELS[tier]} cap`,
      tone: tier >= 3 ? 'gold' : tier >= 1 ? 'cyan' : 'steel',
    },
    {
      icon: Flame,
      label: '$10k fee preview',
      value: formatUsd(feePreview.totalEstimated),
      hint: `${formatUsd(feePreview.managementCost)} mgmt · ${formatUsd(feePreview.performanceCost)} perf`,
      tone: 'emerald',
    },
  ];

  const overviewCards = [
    {
      icon: Target,
      label: 'Mandate fit',
      value: MANDATE_COPY[mandateLabel] || 'Operator mandate disclosed on-chain for allocator review.',
    },
    {
      icon: ShieldCheck,
      label: 'Accountability',
      value: getAccountabilityCopy(stakeState),
    },
    {
      icon: Globe,
      label: 'Public disclosure',
      value: getDisclosureCopy(op.endpoint, extended),
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
        className="absolute -right-20 -top-24 h-[360px] w-[360px] rounded-full"
        style={{
          background: `radial-gradient(circle, ${ACCENTS.gold} 0%, transparent 60%)`,
          opacity: 0.16,
          filter: 'blur(8px)',
        }}
      />
      <div aria-hidden className="absolute right-10 top-6 pointer-events-none select-none">
        <GhostNumeral n="01" style={{ fontSize: 160 }} />
      </div>

      <div className="relative grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-8 xl:gap-10 p-8 lg:p-10">
        {/* Left — identity */}
        <div className="flex flex-col gap-5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Chip tone="steel" leading={<ShieldCheck className="w-3 h-3" />}>Operator profile</Chip>
            <Chip tone={MANDATE_CHIP_TONE[mandateLabel] || 'cyan'} dense>{mandateLabel}</Chip>
            <Chip
              tone={op.active ? 'emerald' : 'amber'}
              dense
              leading={<StatusDot tone={op.active ? 'emerald' : 'amber'} size={5} />}
            >
              {op.active ? 'Active' : 'Inactive'}
            </Chip>
            {repState?.verified && <Chip tone="cyan" dense leading={<BadgeCheck className="w-3 h-3" />}>Verified</Chip>}
            {tier > 0 && <Chip tone="gold" dense leading={<Award className="w-3 h-3" />}>{TIER_LABELS[tier]}</Chip>}
            {stakeState?.frozen && <Chip tone="rose" dense leading={<AlertTriangle className="w-3 h-3" />}>Frozen</Chip>}
            {isOwn && <Chip tone="cyan" dense>You</Chip>}
          </div>

          <div className="flex items-center gap-4">
            <Eyebrow tone="gold">§ O.01 · Operator File · Mandate</Eyebrow>
            <div className="flex-1 ed-hairline" />
          </div>

          <div className="flex items-start gap-5">
            <TokenAvatar symbol={tokenSymbol} size={72} />
            <div className="flex flex-col gap-1 min-w-0">
              <h1
                className="ed-display leading-[1.02] tracking-[-0.02em] m-0"
                style={{ fontSize: 42, fontWeight: 600, color: 'var(--ed-steel-50)' }}
              >
                {titleFirst ? (
                  <>
                    {titleFirst}{' '}
                    <span className="ed-italic" style={{ fontWeight: 400 }}>{titleTail}</span>
                  </>
                ) : (
                  <span className="ed-italic" style={{ fontWeight: 400 }}>{titleTail}</span>
                )}
              </h1>
              <span
                className="ed-mono text-[12px] mt-2"
                style={{ color: 'var(--ed-steel-500)' }}
              >
                op.{tokenSymbol.toLowerCase()}.init · registered {formatDate(op.registeredAt)}
                {extended?.manifestBonded ? ' · bonded manifest' : ''}
              </span>
            </div>
          </div>

          <p className="max-w-[640px] text-[14px] leading-[1.65] m-0" style={{ color: 'var(--ed-steel-300)' }}>
            {op.description ? (
              <>
                <span className="ed-italic" style={{ color: 'var(--ed-steel-50)' }}>"{op.description.slice(0, 140)}</span>
                {op.description.length > 140 ? '…"' : '"'}
              </>
            ) : (
              <span style={{ color: 'var(--ed-steel-500)' }}>
                No description provided. Operator voice and strategy narrative appear here once the profile is updated.
              </span>
            )}
          </p>

          <div
            className="flex items-center gap-5 pt-4 mt-1 flex-wrap"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <FootStat label="Operator" value={shortHexLabel(operatorAddress, 6, 6)} />
            {operatorExplorerHref && (
              <FootStat
                label="Explorer"
                value="view ↗"
                leading={<ExternalLink className="w-3 h-3" style={{ color: ACCENTS.cyan }} />}
                href={operatorExplorerHref}
              />
            )}
            <FootStat label="Registered" value={formatDate(op.registeredAt)} />
            <FootStat label="Updated" value={formatDate(op.updatedAt || op.registeredAt)} />
            {isLive && (
              <FootStat
                label="Orchestrator"
                value={`${orchStatus?.cycleCount || 0} cycles · ${orchStatus?.totalExecutions || 0} exec`}
                leading={<StatusDot tone="emerald" size={5} />}
              />
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {disclosurePills.map((pill) => (
              <DisclosurePill key={pill.label} pill={pill} />
            ))}
            {disclosurePills.length === 0 && (
              <Chip tone="steel" leading={<Info className="w-3 h-3" />}>No public disclosures</Chip>
            )}
          </div>
        </div>

        {/* Right — 2x2 stat tiles */}
        <div className="grid grid-cols-2 gap-3 content-start">
          {snapshotCards.map((card) => (
            <StatTile
              key={card.label}
              icon={card.icon}
              label={card.label}
              value={card.value}
              unit={card.unit}
              hint={card.hint}
              tone={card.tone}
            />
          ))}
        </div>
      </div>

      {/* Bottom strip — 3 outline tiles */}
      <div
        className="relative grid grid-cols-1 lg:grid-cols-3 gap-4 px-8 lg:px-10 pb-8 lg:pb-10 pt-8"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
      >
        {overviewCards.map((card) => (
          <OutlineTile
            key={card.label}
            icon={card.icon}
            label={card.label}
            value={card.value}
          />
        ))}
      </div>
    </section>
  );
}

function DisclosurePill({ pill }) {
  const { icon: Icon, label, tone, href } = pill;
  const classes = {
    cyan: { bg: 'rgba(76,201,240,0.08)', ring: 'rgba(76,201,240,0.24)', fg: 'var(--ed-cyan-ink)' },
    gold: { bg: 'rgba(201,168,76,0.08)', ring: 'rgba(201,168,76,0.28)', fg: 'var(--ed-gold-ink)' },
    emerald: { bg: 'rgba(16,185,129,0.1)', ring: 'rgba(16,185,129,0.28)', fg: '#8AE6C2' },
    steel: { bg: 'rgba(255,255,255,0.04)', ring: 'rgba(255,255,255,0.08)', fg: 'var(--ed-steel-200)' },
  }[tone || 'steel'];
  const content = (
    <span
      className="inline-flex items-center gap-2 rounded-sm px-2 py-[5px] ed-mono text-[10.5px] uppercase tracking-[0.14em]"
      style={{ background: classes.bg, boxShadow: `inset 0 0 0 1px ${classes.ring}`, color: classes.fg }}
    >
      <Icon className="w-3 h-3" />
      <span className="truncate max-w-[220px]">{label}</span>
    </span>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="transition-opacity hover:opacity-85">
        {content}
      </a>
    );
  }
  return content;
}

/* ─────────────────── Commercial Terms ─────────────────── */

function CommercialTermsPanel({ op, feePreview }) {
  return (
    <SectionHead
      marker="O.02 · Commercial Terms"
      title={<span className="ed-italic text-[22px]">Commercial terms <span className="ed-sans text-[14px] not-italic" style={{ color: 'var(--ed-steel-400)' }}>— declared on-chain</span></span>}
    >
      <div className="rounded-2xl p-5 grid grid-cols-2 gap-4" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        <div className="rounded-xl p-5 relative" style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'var(--ed-ghost-border)' }}>
          <div className="flex items-center gap-1.5 mb-3">
            <Sparkles className="w-3 h-3" style={{ color: ACCENTS.emerald }} />
            <Eyebrow tone="emerald">Performance</Eyebrow>
          </div>
          <div className="ed-italic text-[36px] leading-none" style={{ color: 'var(--ed-steel-50)' }}>
            {formatBps(op.performanceFeeBps)}
          </div>
          <div className="ed-mono text-[11px] mt-2" style={{ color: 'var(--ed-steel-500)' }}>Above high-water mark</div>
          <div className="flex gap-3 mt-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
              Entry <span style={{ color: 'var(--ed-steel-50)' }}>{formatBps(op.entryFeeBps)}</span>
            </span>
            <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
              Exit <span style={{ color: 'var(--ed-steel-50)' }}>{formatBps(op.exitFeeBps)}</span>
            </span>
          </div>
        </div>
        <div className="rounded-xl p-5" style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'var(--ed-ghost-border)' }}>
          <div className="flex items-center gap-1.5 mb-3">
            <Layers className="w-3 h-3" style={{ color: ACCENTS.cyan }} />
            <Eyebrow tone="cyan">Management</Eyebrow>
          </div>
          <div className="ed-italic text-[36px] leading-none" style={{ color: 'var(--ed-steel-50)' }}>
            {formatBps(op.managementFeeBps)}
          </div>
          <div className="ed-mono text-[11px] mt-2" style={{ color: 'var(--ed-steel-500)' }}>Per year · streamed per cycle</div>
        </div>
        <div
          className="col-span-2 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: 'rgba(0,0,0,0.3)', boxShadow: 'var(--ed-ghost-border)' }}
        >
          <div className="flex items-center gap-2">
            <Info className="w-3 h-3" style={{ color: 'var(--ed-steel-500)' }} />
            <Eyebrow tone="muted">$10k fee preview · 10% annual return</Eyebrow>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-500)' }}>
              {formatUsd(feePreview.managementCost)} mgmt + {formatUsd(feePreview.performanceCost)} perf
            </span>
            <span className="ed-italic text-[28px] leading-none" style={{ color: ACCENTS.gold }}>
              {formatUsd(feePreview.totalEstimated)}
            </span>
          </div>
        </div>
      </div>
    </SectionHead>
  );
}

/* ─────────────────── Suggested Vault Policy ─────────────────── */

function PolicyPanel({ op }) {
  const rows = [
    {
      label: 'Max position',
      value: `${(Number(op.recommendedMaxPositionBps || 0) / 100).toFixed(1)}%`,
      bar: Math.min(100, Number(op.recommendedMaxPositionBps || 0) / 100),
    },
    {
      label: 'Min confidence',
      value: `${(Number(op.recommendedConfidenceMinBps || 0) / 100).toFixed(0)}%`,
      bar: Math.min(100, Number(op.recommendedConfidenceMinBps || 0) / 100),
    },
    {
      label: 'Stop-loss',
      value: `${(Number(op.recommendedStopLossBps || 0) / 100).toFixed(1)}%`,
      bar: Math.min(100, Number(op.recommendedStopLossBps || 0) / 100),
    },
    {
      label: 'Cooldown',
      value: `${Math.round(Number(op.recommendedCooldownSeconds || 0) / 60)} min`,
      bar: null,
    },
    {
      label: 'Max trades / day',
      value: `${Number(op.recommendedMaxActionsPerDay || 0)}`,
      bar: null,
    },
  ];
  return (
    <SectionHead
      marker="O.03 · Suggested Vault Policy"
      title={<span className="ed-italic text-[22px]">Suggested policy <span className="ed-sans text-[14px] not-italic" style={{ color: 'var(--ed-steel-400)' }}>— recommended caps</span></span>}
    >
      <div className="rounded-2xl p-5 divide-y" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)', borderColor: 'rgba(255,255,255,0.05)' }}>
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <span className="text-[13px] w-[180px] flex-shrink-0" style={{ color: 'var(--ed-steel-300)' }}>{r.label}</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
              {r.bar !== null && (
                <div
                  className="h-full rounded-full"
                  style={{ width: `${r.bar}%`, background: `linear-gradient(90deg, ${ACCENTS.cyan}, ${ACCENTS.emerald})` }}
                />
              )}
            </div>
            <span className="ed-mono text-[13px] w-[60px] text-right" style={{ color: 'var(--ed-steel-50)' }}>{r.value}</span>
          </div>
        ))}
      </div>
    </SectionHead>
  );
}

/* ─────────────────── Collateral panel ─────────────────── */

function CollateralTile({ icon, label, value, sub, tone, italic }) {
  const Icon = icon;
  const color = ACCENTS[tone] || ACCENTS.steel;
  return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="h-6 w-6 rounded-md flex items-center justify-center"
          style={{ background: `${color}1F`, color }}
        >
          <Icon className="w-3 h-3" />
        </span>
        <Eyebrow tone="muted">{label}</Eyebrow>
      </div>
      <div
        className={cx('ed-italic text-[28px] leading-none', italic ? 'opacity-60' : '')}
        style={{ color: italic ? 'var(--ed-steel-300)' : 'var(--ed-steel-50)' }}
      >
        {value}
      </div>
      {sub && <div className="ed-mono text-[10.5px] mt-2" style={{ color: 'var(--ed-steel-500)' }}>{sub}</div>}
    </div>
  );
}

function CollateralPanel({
  stakeState,
  tier,
  capacityLabel,
  stakeTokenLabel,
  walletUsdcBalance,
  usdcAllowance,
  usdcAddress,
  stakingAddress,
  stakeAmount,
  setStakeAmount,
  unstakeAmount,
  setUnstakeAmount,
  approveUsdc,
  approvingStake,
  stake,
  staking,
  stakeSuccess,
  requestUnstake,
  requesting,
  requestSuccess,
  claimUnstake,
  claiming,
  claimSuccess,
  unstakeClaimable,
  refetchStake,
  refetchAllowance,
  isOwn,
  isConnected,
}) {
  const next = stakeState && !stakeState.isUnlimited ? nextTier(stakeState.tier) : null;
  const showProgress = next !== null;
  const progressPct = showProgress
    ? Math.min(100, (stakeState.amount / TIER_THRESHOLDS[next]) * 100)
    : 0;
  const gap = showProgress ? tierGapUsd(stakeState.amount, stakeState.tier) : 0;

  return (
    <SectionHead
      marker="O.05 · Operator Collateral"
      title={
        <span className="ed-italic text-[22px]">
          Operator collateral{' '}
          {stakeState?.frozen && (
            <span className="ed-sans text-[14px] not-italic" style={{ color: '#F4A0B3' }}>— frozen</span>
          )}
        </span>
      }
      trailing={
        <Chip
          tone={tier >= 3 ? 'gold' : tier >= 1 ? 'cyan' : 'steel'}
          dense
          leading={<Award className="w-3 h-3" />}
        >
          {TIER_LABELS[tier]} tier · {capacityLabel}
        </Chip>
      }
    >
      <div className="rounded-2xl overflow-hidden" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
          <CollateralTile
            icon={Award}
            label="Tier"
            value={TIER_LABELS[tier]}
            sub={`Vault cap · ${capacityLabel}`}
            tone={tier >= 3 ? 'gold' : tier >= 1 ? 'cyan' : 'steel'}
            italic={tier === 0}
          />
          <CollateralTile
            icon={Lock}
            label="Active stake"
            value={formatUsd(stakeState?.amount || 0)}
            sub={`Bonded · ${stakeTokenLabel}`}
            tone="cyan"
          />
          <CollateralTile
            icon={Hourglass}
            label="Pending unstake"
            value={formatUsd(stakeState?.pendingUnstake || 0)}
            sub={
              stakeState?.unstakeAvailableAt
                ? `Claimable ${formatDate(stakeState.unstakeAvailableAt)}`
                : '14-day cooldown begins on request'
            }
            tone={(stakeState?.pendingUnstake || 0) > 0 ? 'amber' : 'emerald'}
          />
        </div>

        {showProgress && (
          <div className="p-5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center justify-between mb-2">
              <Eyebrow tone="muted">Progress to {TIER_LABELS[next]}</Eyebrow>
              <span className="ed-mono text-[11.5px]" style={{ color: 'var(--ed-steel-50)' }}>
                {formatUsd(stakeState.amount)}{' '}
                <span style={{ color: 'var(--ed-steel-500)' }}>/ {formatUsd(TIER_THRESHOLDS[next])}</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${progressPct}%`, background: `linear-gradient(90deg, ${ACCENTS.cyan}, ${ACCENTS.emerald})` }}
              />
            </div>
            {gap > 0 && (
              <div className="ed-mono text-[11px] mt-2" style={{ color: 'var(--ed-steel-500)' }}>
                {formatUsd(gap)} more to unlock {formatVaultCap(
                  next === 1 ? 50_000 : next === 2 ? 500_000 : next === 3 ? 5_000_000 : Infinity,
                  next === 4,
                )} vault capacity
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)' }}>
          <div className="flex items-center gap-2">
            <Eyebrow tone="muted">Lifetime staked</Eyebrow>
            <span className="ed-mono text-[12px]" style={{ color: 'var(--ed-steel-50)' }}>
              {formatUsd(stakeState?.lifetimeStaked || 0)}
            </span>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Eyebrow tone="muted">Lifetime slashed</Eyebrow>
            <span
              className="ed-mono text-[12px]"
              style={{ color: (stakeState?.lifetimeSlashed || 0) > 0 ? ACCENTS.rose : 'var(--ed-steel-50)' }}
            >
              {formatUsd(stakeState?.lifetimeSlashed || 0)}
            </span>
          </div>
        </div>

        {isOwn && isConnected && (
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x" style={{ borderColor: 'rgba(255,255,255,0.05)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <StakeForm
              label={`Add stake (${stakeTokenLabel})`}
              amount={stakeAmount}
              setAmount={setStakeAmount}
              hintLabel="Wallet balance"
              hintValue={`${Number(walletUsdcBalance || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${stakeTokenLabel}`}
              maxValue={walletUsdcBalance || '0'}
              disabled={stakeState?.frozen}
              action={(() => {
                const needsApproval =
                  !!stakeAmount &&
                  Number(stakeAmount) > 0 &&
                  (!usdcAllowance || Number(usdcAllowance) / 1e6 < Number(stakeAmount));
                if (needsApproval) {
                  return (
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
                      <Check className="w-3 h-3" />
                      {approvingStake ? 'Approving...' : `Approve ${stakeTokenLabel}`}
                    </ControlButton>
                  );
                }
                return (
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
                    <Zap className="w-3 h-3" />
                    {staking ? 'Staking...' : 'Stake'}
                  </ControlButton>
                );
              })()}
              footer={stakeSuccess && (
                <p className="ed-mono text-[10px] mt-2" style={{ color: '#8AE6C2' }}>Stake confirmed on-chain.</p>
              )}
            />

            <StakeForm
              label={`Request unstake (${stakeTokenLabel})`}
              amount={unstakeAmount}
              setAmount={setUnstakeAmount}
              hintLabel="Active collateral"
              hintValue={formatUsd(stakeState?.amount || 0, 2)}
              maxValue={String(stakeState?.amount || 0)}
              disabled={stakeState?.frozen || (stakeState?.pendingUnstake || 0) > 0}
              action={
                <div className="flex gap-2 flex-1">
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
                    <RefreshCw className="w-3 h-3" />
                    {requesting ? 'Requesting...' : 'Request unstake'}
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
                      {claiming ? 'Claiming...' : 'Claim'}
                    </ControlButton>
                  )}
                </div>
              }
              footer={
                <>
                  {(stakeState?.pendingUnstake || 0) > 0 && (
                    <p className="ed-mono text-[10px] mt-2" style={{ color: '#F5C97E' }}>
                      Existing unstake pending. Another request cannot be opened yet.
                    </p>
                  )}
                  {requestSuccess && (
                    <p className="ed-mono text-[10px] mt-2" style={{ color: '#8AE6C2' }}>14-day cooldown started.</p>
                  )}
                  {claimSuccess && (
                    <p className="ed-mono text-[10px] mt-2" style={{ color: '#8AE6C2' }}>Stake withdrawn back to wallet.</p>
                  )}
                </>
              }
            />
          </div>
        )}

        {stakeState?.frozen && (
          <div className="p-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div
              className="rounded-lg px-3 py-3 flex items-start gap-2"
              style={{ background: 'rgba(225,29,72,0.05)', boxShadow: 'inset 0 0 0 1px rgba(225,29,72,0.25)' }}
            >
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: ACCENTS.rose }} />
              <div className="text-[11.5px] leading-[1.5]" style={{ color: '#F4A0B3' }}>
                <strong>Stake frozen.</strong> Stake actions are disabled pending governance review.
              </div>
            </div>
          </div>
        )}

        {!isOwn && (
          <div className="p-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-start gap-2">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: ACCENTS.cyan }} />
              <p className="text-[11.5px] leading-[1.55]" style={{ color: 'var(--ed-steel-400)' }}>
                Slashable collateral backing this operator. Governance can penalise misbehaviour by burning from this pool.
              </p>
            </div>
          </div>
        )}
      </div>
    </SectionHead>
  );
}

function StakeForm({ label, amount, setAmount, hintLabel, hintValue, maxValue, disabled, action, footer }) {
  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-2">
        <Eyebrow tone="muted">{label}</Eyebrow>
        <span className="ed-mono text-[10.5px]" style={{ color: 'var(--ed-steel-500)' }}>
          {hintLabel} <span style={{ color: 'var(--ed-steel-50)' }}>{hintValue}</span>
        </span>
      </div>
      <div
        className="flex items-center gap-2 rounded-xl px-3 h-11"
        style={{ background: 'rgba(0,0,0,0.3)', boxShadow: 'var(--ed-ghost-border)' }}
      >
        <span className="ed-mono text-[12px]" style={{ color: 'var(--ed-steel-500)' }}>$</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          placeholder="0.00"
          disabled={disabled}
          className="flex-1 bg-transparent outline-none ed-mono text-[16px] disabled:opacity-50"
          style={{ color: 'var(--ed-steel-50)' }}
        />
        <button
          type="button"
          onClick={() => setAmount(String(maxValue))}
          className="ed-mono text-[10px] uppercase tracking-[0.2em] transition-colors"
          style={{ color: ACCENTS.cyan }}
        >
          Max
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">{action}</div>
      {footer}
    </div>
  );
}

/* ─────────────────── Track Record ─────────────────── */

function TrackRecordPanel({
  repState,
  repScore,
  isOwn,
  isConnected,
  alreadyRated,
  ratingStars,
  setRatingStars,
  ratingComment,
  setRatingComment,
  submitRating,
  reputationAddress,
  operatorAddress,
  ratingPending,
  ratingSuccess,
  refetchRep,
  refetchHasRated,
  isReputationAdmin,
  verifyPending,
  verifySuccess,
  setVerified,
}) {
  const stats = [
    {
      label: 'Actions',
      value: String((repState?.totalExecutions || 0).toLocaleString()),
      sub: `${repState?.successfulExecutions || 0} successful`,
      icon: Zap,
      tone: 'cyan',
    },
    {
      label: 'Success',
      value: `${(repState?.successRatePct || 0).toFixed(1)}%`,
      sub: (repState?.totalExecutions || 0) > 0 ? 'On-chain' : 'No baseline',
      icon: Check,
      tone: 'emerald',
    },
    {
      label: 'Volume',
      value: formatUsd(repState?.totalVolumeUsd || 0),
      sub: 'Cumulative notional',
      icon: Layers,
      tone: 'cyan',
    },
    {
      label: 'Cum · P&L',
      value: formatPnl(repState?.cumulativePnlUsd || 0),
      sub: 'Realized only',
      icon: Sparkles,
      tone: (repState?.cumulativePnlUsd || 0) >= 0 ? 'emerald' : 'rose',
    },
    {
      label: 'Rating',
      value: (repState?.averageRating || 0).toFixed(2),
      sub: `${repState?.ratingCount || 0} review${repState?.ratingCount === 1 ? '' : 's'}`,
      icon: Trophy,
      tone: 'amber',
    },
  ];

  return (
    <SectionHead
      marker="O.07 · On-chain Track Record"
      title={
        <span className="ed-italic text-[22px]">
          Track record{' '}
          <span className="ed-sans text-[14px] not-italic" style={{ color: 'var(--ed-steel-400)' }}>
            — settled via reputation registry
          </span>
        </span>
      }
      trailing={repState?.verified && <Chip tone="cyan" leading={<BadgeCheck className="w-3 h-3" />}>Verified</Chip>}
    >
      <div className="rounded-2xl p-5" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {stats.map((s) => {
            const color = ACCENTS[s.tone] || ACCENTS.cyan;
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className="rounded-xl p-4 relative"
                style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'var(--ed-ghost-border)' }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="h-6 w-6 rounded-md flex items-center justify-center"
                    style={{ background: `${color}1F`, color }}
                  >
                    <Icon className="w-3 h-3" />
                  </span>
                  <Eyebrow tone="muted" className="!text-[9px]">{s.label}</Eyebrow>
                </div>
                <div className="ed-italic text-[26px] leading-none" style={{ color: 'var(--ed-steel-50)' }}>{s.value}</div>
                <div className="ed-mono text-[10px] mt-2" style={{ color: 'var(--ed-steel-500)' }}>{s.sub}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center justify-between mb-2">
            <Eyebrow tone="muted">Composite reputation score</Eyebrow>
            <span className="ed-mono text-[11.5px]" style={{ color: 'var(--ed-steel-50)' }}>
              {repScore} <span style={{ color: 'var(--ed-steel-500)' }}>/ 100</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${repScore}%`,
                background:
                  repScore >= 80 ? `linear-gradient(90deg, ${ACCENTS.cyan}, ${ACCENTS.emerald})` :
                  repScore >= 60 ? `linear-gradient(90deg, ${ACCENTS.cyan}, ${ACCENTS.amber})` :
                  `linear-gradient(90deg, ${ACCENTS.steel}, ${ACCENTS.cyan})`,
              }}
            />
          </div>
          <div className="ed-mono text-[11px] mt-2" style={{ color: 'var(--ed-steel-500)' }}>
            Earned via safety, uptime, and performance.
          </div>
        </div>

        {(repState?.firstExecutionAt || 0) > 0 && (
          <div className="mt-5 pt-5 grid grid-cols-2 gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.02)', boxShadow: 'var(--ed-ghost-border)' }}>
              <Eyebrow tone="muted">First execution</Eyebrow>
              <div className="ed-mono text-[12px] mt-1" style={{ color: 'var(--ed-steel-50)' }}>
                {formatDate(repState.firstExecutionAt)}
              </div>
            </div>
            <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.02)', boxShadow: 'var(--ed-ghost-border)' }}>
              <Eyebrow tone="muted">Last execution</Eyebrow>
              <div className="ed-mono text-[12px] mt-1" style={{ color: 'var(--ed-steel-50)' }}>
                {formatDate(repState.lastExecutionAt)}
              </div>
            </div>
          </div>
        )}

        {isReputationAdmin && (
          <div className="mt-5 pt-5 flex items-center justify-between gap-3 flex-wrap" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2">
              <span
                className="h-6 w-6 rounded-md flex items-center justify-center"
                style={{ background: 'rgba(201,168,76,0.15)', color: ACCENTS.gold }}
              >
                <BadgeCheck className="w-3 h-3" />
              </span>
              <Eyebrow tone="muted">Admin verified badge</Eyebrow>
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
        )}
        {verifySuccess && (
          <p className="ed-mono text-[10px] mt-2 text-right" style={{ color: '#8AE6C2' }}>Badge updated on-chain.</p>
        )}

        {isConnected && !isOwn && !alreadyRated && (
          <div className="mt-5 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-3.5 h-3.5" style={{ color: ACCENTS.cyan }} />
              <Eyebrow tone="cyan">Rate this operator</Eyebrow>
            </div>
            <div className="flex items-center gap-1 mb-3">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRatingStars(star)}
                  className="transition-colors"
                  style={{ color: star <= ratingStars ? ACCENTS.amber : 'rgba(255,255,255,0.15)' }}
                >
                  <Star className="w-5 h-5" fill={star <= ratingStars ? 'currentColor' : 'none'} />
                </button>
              ))}
              <span className="ml-2 ed-mono text-[11px]" style={{ color: 'var(--ed-steel-300)' }}>{ratingStars}/5</span>
            </div>
            <textarea
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
              placeholder="Optional comment (256 char max)"
              maxLength={256}
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-[11.5px] outline-none transition-colors mb-3"
              style={{
                background: 'rgba(0,0,0,0.3)',
                boxShadow: 'var(--ed-ghost-border)',
                color: 'var(--ed-steel-50)',
              }}
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
              <p className="ed-mono text-[10px] mt-2" style={{ color: '#8AE6C2' }}>Rating recorded on-chain.</p>
            )}
          </div>
        )}

        {alreadyRated && (
          <div className="mt-5 pt-5 text-center" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <span className="ed-mono text-[10.5px]" style={{ color: ACCENTS.cyan }}>
              You've already rated this operator.
            </span>
          </div>
        )}
      </div>
    </SectionHead>
  );
}

/* ─────────────────── Right rail ─────────────────── */

function BriefingPanel({ op, extended, operatorAddress, operatorExplorerHref, hasAiProvider, onCopyAddress, addressCopied }) {
  const rows = [
    {
      label: 'Address',
      value: (
        <a
          href={operatorExplorerHref || '#'}
          target={operatorExplorerHref ? '_blank' : undefined}
          rel={operatorExplorerHref ? 'noreferrer' : undefined}
          className="ed-mono text-[12.5px] break-all transition-colors"
          style={{ color: operatorExplorerHref ? ACCENTS.cyan : 'var(--ed-steel-200)' }}
          title={operatorAddress}
          onClick={(e) => { if (!operatorExplorerHref) e.preventDefault(); }}
        >
          {shortHexLabel(operatorAddress, 10, 6)}
        </a>
      ),
      trailing: (
        <button
          type="button"
          onClick={onCopyAddress}
          className="transition-colors"
          style={{ color: addressCopied ? ACCENTS.emerald : 'var(--ed-steel-500)' }}
          title={addressCopied ? 'Copied' : 'Copy'}
        >
          {addressCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      ),
    },
    {
      label: 'Status',
      value: (
        <Chip
          tone={op.active ? 'emerald' : 'amber'}
          dense
          leading={<StatusDot tone={op.active ? 'emerald' : 'amber'} size={5} />}
        >
          {op.active ? 'Active listing' : 'Inactive listing'}
        </Chip>
      ),
    },
    {
      label: 'Registered',
      value: <span className="ed-mono text-[12.5px]" style={{ color: 'var(--ed-steel-50)' }}>{formatDate(op.registeredAt)}</span>,
    },
    {
      label: 'Updated',
      value: <span className="ed-mono text-[12.5px]" style={{ color: 'var(--ed-steel-50)' }}>{formatDate(op.updatedAt || op.registeredAt)}</span>,
    },
    {
      label: 'AI model',
      value: extended?.aiModel ? (
        <span className="ed-mono text-[12.5px] break-all" style={{ color: ACCENTS.cyan }}>{extended.aiModel}</span>
      ) : (
        <span className="ed-mono text-[12.5px] italic" style={{ color: 'var(--ed-steel-500)' }}>Undeclared</span>
      ),
    },
  ];

  if (hasAiProvider) {
    rows.push({
      label: 'AI provider',
      value: <span className="ed-mono text-[12.5px]" style={{ color: 'var(--ed-steel-50)' }}>{shortHexLabel(extended.aiProvider, 10, 6)}</span>,
    });
  }

  rows.push({
    label: 'Manifest',
    value: extended?.manifestURI ? (
      <a
        href={extended.manifestURI}
        target="_blank"
        rel="noreferrer"
        className="ed-mono text-[12.5px] break-all transition-colors"
        style={{ color: extended.manifestBonded ? ACCENTS.gold : ACCENTS.cyan }}
        title={extended.manifestURI}
      >
        v{Number(extended.manifestVersion || 0)}{extended.manifestBonded ? ' bonded' : ' published'}
      </a>
    ) : (
      <span className="ed-mono text-[12.5px] italic" style={{ color: 'var(--ed-steel-500)' }}>Not published</span>
    ),
  });

  rows.push({
    label: 'Endpoint',
    value: op.endpoint ? (
      <a
        href={op.endpoint}
        target="_blank"
        rel="noreferrer"
        className="ed-mono text-[12.5px] break-all transition-colors"
        style={{ color: ACCENTS.cyan }}
        title={op.endpoint}
      >
        {formatEndpoint(op.endpoint)}
      </a>
    ) : (
      <span className="ed-mono text-[12.5px] italic" style={{ color: 'var(--ed-steel-500)' }}>Not shared</span>
    ),
  });

  return (
    <SectionHead marker="O.04 · Operator Briefing">
      <div className="rounded-2xl p-5 space-y-3" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-1">
            <Eyebrow tone="muted">{row.label}</Eyebrow>
            <div className="flex items-center gap-2 min-w-0">
              <div className="truncate">{row.value}</div>
              {row.trailing}
            </div>
          </div>
        ))}
      </div>
    </SectionHead>
  );
}

function OwnerControlsPanel({ op, deactivating, activating, onDeactivate, onActivate }) {
  return (
    <SectionHead marker="Operator Controls">
      <div className="rounded-2xl p-4 space-y-2.5" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        <Link to="/operator/register">
          <ControlButton variant="secondary" className="w-full">
            <Edit3 className="w-3 h-3" /> Update profile
          </ControlButton>
        </Link>
        {op.active ? (
          <ControlButton variant="danger" className="w-full" disabled={deactivating} onClick={onDeactivate}>
            <Power className="w-3 h-3" /> {deactivating ? 'Deactivating...' : 'Deactivate listing'}
          </ControlButton>
        ) : (
          <ControlButton variant="gold" className="w-full" disabled={activating} onClick={onActivate}>
            <Power className="w-3 h-3" /> {activating ? 'Activating...' : 'Reactivate listing'}
          </ControlButton>
        )}
      </div>
      <div className="mt-4 rounded-2xl p-4 flex items-start gap-3" style={{ background: 'rgba(255,255,255,0.02)', boxShadow: 'var(--ed-ghost-border)' }}>
        <div
          className="h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(201,168,76,0.15)', color: ACCENTS.gold }}
        >
          <ShieldCheck className="w-3 h-3" />
        </div>
        <div>
          <Eyebrow tone="muted" className="!block mb-1.5">Trust model</Eyebrow>
          <p className="text-[12px] leading-[1.55]" style={{ color: 'var(--ed-steel-300)' }}>
            Operators only execute policy-checked actions. Custody stays in the vault — signed intents, on-chain receipts.
          </p>
        </div>
      </div>
    </SectionHead>
  );
}

function AllocatorActionsPanel({
  isConnected,
  myVaults,
  operatorAddress,
  selectedVault,
  setSelectedVault,
  handleAssign,
  setExecPending,
  setExecSuccess,
  opActive,
}) {
  return (
    <SectionHead marker="Allocator Actions">
      <div className="rounded-2xl p-5 space-y-3" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
        {!isConnected ? (
          <>
            <p className="text-[12px] leading-[1.55]" style={{ color: 'var(--ed-steel-300)' }}>
              Connect a wallet to assign this operator to one of your vaults.
            </p>
            <div
              className="rounded-lg px-3 py-3 ed-mono text-[11px]"
              style={{ background: 'rgba(255,255,255,0.02)', boxShadow: 'var(--ed-ghost-border)', color: 'var(--ed-steel-400)' }}
            >
              Funds stay in your vault — operators only receive the right to submit signed intents.
            </div>
          </>
        ) : myVaults.length === 0 ? (
          <div className="text-center py-2">
            <p className="text-[12px] mb-3" style={{ color: 'var(--ed-steel-300)' }}>No vault yet.</p>
            <Link to={`/create?operator=${operatorAddress}`}>
              <ControlButton variant="gold" size="sm">
                <Edit3 className="w-3 h-3" /> Create a vault
              </ControlButton>
            </Link>
          </div>
        ) : (
          <>
            <p className="text-[11px] leading-[1.55]" style={{ color: 'var(--ed-steel-300)' }}>Choose a vault below.</p>
            <div className="space-y-2">
              {myVaults.map((vault) => {
                const selected = selectedVault === vault.address;
                return (
                  <button
                    key={vault.address}
                    type="button"
                    onClick={() => setSelectedVault(vault.address)}
                    className="w-full text-left px-3 py-3 rounded-lg transition-colors"
                    style={{
                      background: selected ? 'rgba(201,168,76,0.05)' : 'rgba(255,255,255,0.02)',
                      boxShadow: selected
                        ? 'inset 0 0 0 1px rgba(201,168,76,0.28)'
                        : 'var(--ed-ghost-border)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="ed-mono text-[12px]" style={{ color: 'var(--ed-steel-50)' }}>
                        {shortHexLabel(vault.address, 8, 6)}
                      </span>
                      <span className="ed-mono text-[10px]" style={{ color: 'var(--ed-steel-500)' }}>
                        {vault.loaded ? formatUsd(Number(vault.balance) || 0) : 'Loading'}
                      </span>
                    </div>
                    {vault.loaded && (
                      <div className="mt-1 ed-mono text-[10px]" style={{ color: 'var(--ed-steel-500)' }}>
                        {vault.paused ? 'Paused' : vault.autoExecution ? 'Auto execution on' : 'Manual execution'} ·{' '}
                        {vault.executor?.toLowerCase() === operatorAddress.toLowerCase()
                          ? 'Already assigned'
                          : 'Executor change available'}
                      </div>
                    )}
                  </button>
                );
              })}
              <ControlButton
                variant="primary"
                className="w-full mt-2"
                disabled={!selectedVault || setExecPending || !opActive}
                onClick={handleAssign}
              >
                <ArrowUpRight className="w-3 h-3" /> {setExecPending ? 'Updating executor...' : 'Assign to vault'}
              </ControlButton>
              {setExecSuccess && (
                <p className="ed-mono text-[10px] text-center" style={{ color: '#8AE6C2' }}>Executor updated on-chain.</p>
              )}
              {!opActive && (
                <p className="ed-mono text-[10px] text-center" style={{ color: '#F5C97E' }}>This operator is currently inactive.</p>
              )}
            </div>
          </>
        )}
      </div>
    </SectionHead>
  );
}

function SessionsPanel({ recentOperatorTxs }) {
  return (
    <SectionHead marker="O.06 · Session Transactions">
      {recentOperatorTxs.length > 0 ? (
        <div className="rounded-2xl p-4 space-y-2" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
          {recentOperatorTxs.map((tx) => (
            <a
              key={tx.href}
              href={tx.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg transition-colors"
              style={{ background: 'rgba(255,255,255,0.02)', boxShadow: 'var(--ed-ghost-border)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <StatusDot tone="cyan" size={5} pulse={false} />
                <span className="text-[12px] truncate" style={{ color: 'var(--ed-steel-50)' }}>{tx.label}</span>
              </div>
              <span className="ed-mono text-[10.5px] flex items-center gap-1" style={{ color: ACCENTS.cyan }}>
                {shortHexLabel(tx.hash, 8, 6)}
                <ExternalLink className="w-3 h-3" />
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl p-8 flex items-center gap-5" style={{ background: '#0F0F13', boxShadow: 'var(--ed-ghost-border)' }}>
          <div
            className="h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: `linear-gradient(135deg, ${ACCENTS.cyan}2D, ${ACCENTS.emerald}2D)`,
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
            }}
          >
            <Activity className="w-4 h-4" style={{ color: 'var(--ed-steel-50)' }} />
          </div>
          <div>
            <div className="ed-italic text-[18px]" style={{ color: 'var(--ed-steel-50)' }}>No recent actions.</div>
            <p className="ed-mono text-[11px] mt-1" style={{ color: 'var(--ed-steel-500)' }}>
              Session txns stream here once the operator picks up its first signed intent.
            </p>
          </div>
        </div>
      )}
    </SectionHead>
  );
}

/* ─────────────────── Page ─────────────────── */

export default function OperatorProfilePage() {
  const navigate = useNavigate();
  const { operatorAddress } = useParams();
  const { address: walletAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const registryAddress = deployments.operatorRegistryV2 || deployments.operatorRegistry;

  const validAddress = operatorAddress && isAddress(operatorAddress);
  const { data: op, refetch: refetchOp } = useOperator(registryAddress, validAddress ? operatorAddress : undefined);
  const { data: extended } = useOperatorExtended(registryAddress, validAddress ? operatorAddress : undefined);
  const { data: orchStatus } = useOrchestratorStatus();
  const { vaults: myVaults } = useVaultList(deployments.aegisVaultFactory, walletAddress);

  const { setExecutor, hash: setExecHash, isPending: setExecPending, isSuccess: setExecSuccess } = useSetExecutor();
  const { deactivate, hash: deactivateHash, isPending: deactivating } = useDeactivateOperator();
  const { activate, hash: activateHash, isPending: activating } = useActivateOperator();

  // Full-v2 policy: prefer v2 staking where deployed (0G mainnet), fall back
  // to v1 on chains without v2. Operators who staked at v1 can still claim
  // their stake by calling claimUnstake() directly on the v1 contract.
  const stakingAddress = deployments.operatorStakingV2 || deployments.operatorStaking;
  const usdcAddress = deployments.oUSDT || deployments.mockUSDC;
  const { state: stakeState, refetch: refetchStake } = useOperatorStake(
    stakingAddress,
    validAddress ? operatorAddress : undefined,
  );
  const { data: usdcAllowance, refetch: refetchAllowance } = useStakingAllowance(
    usdcAddress,
    walletAddress,
    stakingAddress,
  );
  const { balance: walletUsdcBalance } = useTokenBalance(usdcAddress, walletAddress, 6);
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
    validAddress ? operatorAddress : undefined,
  );
  const { data: alreadyRated, refetch: refetchHasRated } = useHasRated(
    reputationAddress,
    validAddress ? operatorAddress : undefined,
    walletAddress,
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
  const [addressCopied, setAddressCopied] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!validAddress) {
    return (
      <div className="max-w-3xl mx-auto px-4 lg:px-6 py-12 text-center">
        <p className="text-sm" style={{ color: 'var(--ed-steel-300)' }}>Invalid operator address.</p>
        <Link to="/marketplace" className="ed-mono text-[11px] uppercase tracking-[0.18em] mt-3 inline-block" style={{ color: ACCENTS.cyan }}>
          ← Back to Marketplace
        </Link>
      </div>
    );
  }

  if (!op) {
    return (
      <div className="max-w-3xl mx-auto px-4 lg:px-6 py-12 text-center">
        <div className="w-6 h-6 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'rgba(201,168,76,0.3)', borderTopColor: ACCENTS.gold }} />
        <p className="ed-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--ed-steel-400)' }}>Loading operator from chain…</p>
      </div>
    );
  }

  const mandateLabel = MandateLabel[Number(op.mandate)];
  const isOwn = walletAddress?.toLowerCase() === operatorAddress.toLowerCase();
  const isLive = doesExecutorMatchOrchestrator(orchStatus, operatorAddress);
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
    .map((item) => ({ ...item, href: getExplorerTxHref(chainId, item.hash) }))
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

  const handleAssign = () => {
    if (!selectedVault) return;
    setExecutor(selectedVault, operatorAddress);
    setTimeout(() => navigate(`/app/vault/${selectedVault}`), 4000);
  };

  const handleCopyAddress = () => {
    navigator.clipboard?.writeText?.(operatorAddress || '');
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 1500);
  };

  const showCollateral = Boolean(stakingAddress);
  const showTrackRecord = Boolean(reputationAddress);

  return (
    <div className="relative min-h-screen">
      {/* Ambient backdrop — matches Dashboard for visual continuity */}
      <div aria-hidden className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 ed-dotgrid opacity-25" />
        <div
          className="absolute -top-[400px] -left-[200px] h-[800px] w-[800px] rounded-full"
          style={{ background: `radial-gradient(circle, ${ACCENTS.gold}18 0%, transparent 55%)`, filter: 'blur(40px)' }}
        />
        <div
          className="absolute -bottom-[400px] -right-[200px] h-[800px] w-[800px] rounded-full"
          style={{ background: `radial-gradient(circle, ${ACCENTS.emerald}10 0%, transparent 55%)`, filter: 'blur(40px)' }}
        />
      </div>

      <div className="relative max-w-[1540px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <Link
            to="/marketplace"
            className="ed-mono text-[11px] uppercase tracking-[0.18em] inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
            style={{ color: 'var(--ed-steel-400)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-steel-50)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ed-steel-400)')}
          >
            <ArrowLeft className="w-3 h-3" /> Back to Marketplace
          </Link>
          <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-600)' }}>/</span>
          <span className="ed-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--ed-steel-400)' }}>Operators</span>
          <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-600)' }}>/</span>
          <span className="ed-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--ed-steel-50)' }}>
            {op.name || shortHexLabel(operatorAddress, 6, 4)}
          </span>
        </div>

        {/* Hero */}
        <div className="ed-rise" style={{ '--ed-rise-d': '0ms' }}>
          <OperatorHero
            op={op}
            extended={extended}
            operatorAddress={operatorAddress}
            operatorExplorerHref={operatorExplorerHref}
            mandateLabel={mandateLabel}
            repScore={repScore}
            repState={repState}
            stakeState={stakeState}
            tier={tier}
            capacityLabel={capacityLabel}
            feePreview={feePreview}
            orchStatus={orchStatus}
            isLive={isLive}
            isOwn={isOwn}
            disclosurePills={disclosurePills}
          />
        </div>

        {/* Main + rail */}
        <div className="mt-8 lg:mt-10 grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-8 lg:gap-10">
          {/* Main column */}
          <div className="flex flex-col gap-10 min-w-0">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-6">
              <div className="ed-rise" style={{ '--ed-rise-d': '80ms' }}>
                <CommercialTermsPanel op={op} feePreview={feePreview} />
              </div>
              <div className="ed-rise" style={{ '--ed-rise-d': '140ms' }}>
                <PolicyPanel op={op} />
              </div>
            </div>

            {showCollateral && (
              <div className="ed-rise" style={{ '--ed-rise-d': '200ms' }}>
                <CollateralPanel
                  stakeState={stakeState}
                  tier={tier}
                  capacityLabel={capacityLabel}
                  stakeTokenLabel={stakeTokenLabel}
                  walletUsdcBalance={walletUsdcBalance}
                  usdcAllowance={usdcAllowance}
                  usdcAddress={usdcAddress}
                  stakingAddress={stakingAddress}
                  stakeAmount={stakeAmount}
                  setStakeAmount={setStakeAmount}
                  unstakeAmount={unstakeAmount}
                  setUnstakeAmount={setUnstakeAmount}
                  approveUsdc={approveUsdc}
                  approvingStake={approvingStake}
                  stake={stake}
                  staking={staking}
                  stakeSuccess={stakeSuccess}
                  requestUnstake={requestUnstake}
                  requesting={requesting}
                  requestSuccess={requestSuccess}
                  claimUnstake={claimUnstake}
                  claiming={claiming}
                  claimSuccess={claimSuccess}
                  unstakeClaimable={unstakeClaimable}
                  refetchStake={refetchStake}
                  refetchAllowance={refetchAllowance}
                  isOwn={isOwn}
                  isConnected={isConnected}
                />
              </div>
            )}

            {showTrackRecord && (
              <div className="ed-rise" style={{ '--ed-rise-d': '260ms' }}>
                <TrackRecordPanel
                  repState={repState}
                  repScore={repScore}
                  isOwn={isOwn}
                  isConnected={isConnected}
                  alreadyRated={alreadyRated}
                  ratingStars={ratingStars}
                  setRatingStars={setRatingStars}
                  ratingComment={ratingComment}
                  setRatingComment={setRatingComment}
                  submitRating={submitRating}
                  reputationAddress={reputationAddress}
                  operatorAddress={operatorAddress}
                  ratingPending={ratingPending}
                  ratingSuccess={ratingSuccess}
                  refetchRep={refetchRep}
                  refetchHasRated={refetchHasRated}
                  isReputationAdmin={isReputationAdmin}
                  verifyPending={verifyPending}
                  verifySuccess={verifySuccess}
                  setVerified={setVerified}
                />
              </div>
            )}
          </div>

          {/* Right rail */}
          <aside className="flex flex-col gap-8 xl:sticky xl:top-[108px] self-start">
            <div className="ed-rise" style={{ '--ed-rise-d': '120ms' }}>
              <BriefingPanel
                op={op}
                extended={extended}
                operatorAddress={operatorAddress}
                operatorExplorerHref={operatorExplorerHref}
                hasAiProvider={hasAiProvider}
                onCopyAddress={handleCopyAddress}
                addressCopied={addressCopied}
              />
            </div>

            <div className="ed-rise" style={{ '--ed-rise-d': '200ms' }}>
              {isOwn ? (
                <OwnerControlsPanel
                  op={op}
                  deactivating={deactivating}
                  activating={activating}
                  onDeactivate={() => {
                    deactivate(registryAddress);
                    setTimeout(() => refetchOp(), 4000);
                  }}
                  onActivate={() => {
                    activate(registryAddress);
                    setTimeout(() => refetchOp(), 4000);
                  }}
                />
              ) : (
                <AllocatorActionsPanel
                  isConnected={isConnected}
                  myVaults={myVaults}
                  operatorAddress={operatorAddress}
                  selectedVault={selectedVault}
                  setSelectedVault={setSelectedVault}
                  handleAssign={handleAssign}
                  setExecPending={setExecPending}
                  setExecSuccess={setExecSuccess}
                  opActive={op.active}
                />
              )}
            </div>

            <div className="ed-rise" style={{ '--ed-rise-d': '280ms' }}>
              <SessionsPanel recentOperatorTxs={recentOperatorTxs} />
            </div>
          </aside>
        </div>

        {/* Footer */}
        <footer
          className="mt-12 pt-6 flex items-center justify-between flex-wrap gap-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5" style={{ color: ACCENTS.emerald }} />
            <span className="ed-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: 'var(--ed-steel-500)' }}>
              Aegis · Vault
            </span>
          </div>
          <div className="flex items-center gap-6 ed-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: 'var(--ed-steel-500)' }}>
            <Link to="/whitepaper" className="transition-colors" onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-steel-50)')} onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ed-steel-500)')}>
              Whitepaper
            </Link>
            <Link to="/docs" className="transition-colors" onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-steel-50)')} onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ed-steel-500)')}>
              Docs
            </Link>
            <Link to="/marketplace" className="transition-colors" onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ed-steel-50)')} onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ed-steel-500)')}>
              Marketplace
            </Link>
          </div>
          <span className="ed-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: 'var(--ed-steel-500)' }}>
            Built on 0G · 2026
          </span>
        </footer>
      </div>
    </div>
  );
}

/* ─────────────────── Helpers (kept inline, mirroring prior file) ─────────────────── */

function buildDisclosurePills({ extended, endpoint, isLive, orchStatus }) {
  const pills = [];

  if (extended?.aiModel) {
    pills.push({ icon: Cpu, label: `AI · ${formatModelLabel(extended.aiModel)}`, tone: 'cyan' });
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
    pills.push({ icon: Globe, label: formatEndpoint(endpoint), tone: 'steel', href: endpoint });
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
    return `${formatUsd(stakeState.amount || 0)} frozen — governance review in progress.`;
  }
  if ((stakeState?.amount || 0) > 0) {
    return `${formatUsd(stakeState.amount || 0)} staked · cap ${formatVaultCap(
      stakeState.maxVaultSize || 5_000,
      stakeState.isUnlimited,
    )}`;
  }
  return 'No stake posted yet — allocators should expect additional diligence.';
}

function getDisclosureCopy(endpoint, extended) {
  const parts = [];
  if (extended?.aiModel) parts.push(`${formatModelLabel(extended.aiModel)} declared`);
  if (extended?.manifestURI) parts.push(extended.manifestBonded ? 'bonded manifest published' : 'strategy manifest published');
  if (endpoint) parts.push('endpoint shared');
  if (parts.length === 0) return 'No public disclosures on-chain yet.';
  return capitalize(parts.join(' · '));
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
