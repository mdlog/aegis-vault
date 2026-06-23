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
import {
  ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Star, Zap, RefreshCw,
  Unlock, Power, Edit3, BadgeCheck, AlertTriangle, ShieldCheck, Activity,
} from 'lucide-react';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/* ─────────────────────────────────────────────────────────────────────────
   "Ledger" palette — ported 1:1 from Aegis Operator Detail.dc.html (shares the
   Dashboard/Marketplace system: IBM Plex, brighter gold). Scoped to this page
   via inline styles so the editorial pages keep their own palette.
   ──────────────────────────────────────────────────────────────────────── */
const P = {
  bg: '#0a0b0e',
  card: '#14161b',
  inner: '#1a1d23',
  inset: '#0e1014',
  tag: '#22262e',
  line: 'rgba(255,255,255,0.07)',
  lineSoft: 'rgba(255,255,255,0.05)',
  gold: '#e3b34e',
  goldHover: '#edc05f',
  emerald: '#5cb88a',
  violet: '#6f7bdb',
  rose: '#df7373',
  amber: '#f5c97e',
  ink: '#eceef1',
  body: '#c4c8cf',
  sub: '#9499a2',
  muted: '#8a8f98',
  faint: '#6b7078',
  track: '#2a2e36',
};
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

const MANDATE_COPY = {
  Conservative: 'Capital preservation focus — lower turnover, tight caps.',
  Balanced: 'Balanced risk profile — policy-checked execution with moderate exposure.',
  Tactical: 'Higher-conviction sizing, richer approval tiers, stricter veto surface.',
};

function mandateTone(label) {
  switch (label) {
    case 'Balanced':     return { fg: P.gold,    chip: 'rgba(227,179,78,0.12)', icon: 'rgba(227,179,78,0.10)' };
    case 'Conservative': return { fg: P.emerald, chip: 'rgba(92,184,138,0.12)', icon: 'rgba(92,184,138,0.10)' };
    case 'Tactical':     return { fg: P.violet,  chip: 'rgba(111,123,219,0.12)', icon: 'rgba(111,123,219,0.10)' };
    default:             return { fg: P.sub,     chip: P.tag,                    icon: P.tag };
  }
}
const initialOf = (name) => (name || '?').trim().charAt(0).toUpperCase() || '?';

/* ─────────────── Styled atoms (Ledger palette) ─────────────── */

function Btn({ variant = 'gold', size = 'md', full, disabled, onClick, children, style }) {
  const base = {
    fontFamily: MONO, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none', borderRadius: 9, display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', gap: 7, whiteSpace: 'nowrap',
    fontSize: size === 'sm' ? 11 : 12,
    padding: size === 'sm' ? '8px 14px' : '10px 16px',
    width: full ? '100%' : undefined, opacity: disabled ? 0.5 : 1,
  };
  const variants = {
    gold:      { background: P.gold, color: P.bg },
    primary:   { background: P.violet, color: '#0a0b0e' },
    secondary: { background: 'transparent', color: P.ink, border: '1px solid rgba(255,255,255,0.14)' },
    danger:    { background: 'transparent', color: P.rose, border: '1px solid rgba(223,115,115,0.35)' },
  };
  const hover = {
    gold: P.goldHover, primary: '#8b95e6', secondary: 'rgba(255,255,255,0.04)', danger: 'rgba(223,115,115,0.1)',
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = hover[variant]; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = variants[variant].background; }}
    >
      {children}
    </button>
  );
}

// Section card with a "Title — note" header (matches the mockup section style).
function SectionCard({ title, note, trailing, accent, children, style }) {
  return (
    <section style={{ background: P.card, border: `1px solid ${accent || P.line}`, borderRadius: 14, padding: 24, ...style }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: P.ink }}>{title}</h2>
          {note && <span style={{ fontFamily: MONO, fontSize: 11, color: P.faint }}>{note}</span>}
          {trailing && <div style={{ marginLeft: 'auto' }}>{trailing}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

function Bar({ pct, track = P.track }) {
  return (
    <div style={{ height: 6, borderRadius: 99, background: track, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: `linear-gradient(90deg,${P.violet},${P.emerald})`, borderRadius: 99 }} />
    </div>
  );
}

function Eye({ children, color = P.faint, style }) {
  return <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '1.6px', textTransform: 'uppercase', color, ...style }}>{children}</span>;
}

/* ─────────────── Hero ─────────────── */

function OperatorHero({
  op, extended, operatorAddress, operatorExplorerHref, mandateLabel,
  repScore, repState, stakeState, tier, capacityLabel, feePreview,
  orchStatus, isLive, isOwn,
}) {
  const tone = mandateTone(mandateLabel);
  const handle = `op.${(op.name || 'op').toLowerCase().replace(/[^a-z]/g, '').slice(0, 3) || 'op'}.init`;
  const repColor = repScore >= 80 ? P.emerald : repScore >= 60 ? P.gold : repScore >= 40 ? P.violet : P.faint;
  const stakeAmt = stakeState?.amount || 0;

  const snap = [
    {
      label: 'Reputation', value: String(repScore || 0), unit: '/100', color: repColor,
      sub: (repState?.totalExecutions || 0) > 0
        ? `${(repState?.successRatePct || 0).toFixed(1)}% success · ${repState?.ratingCount || 0} review${repState?.ratingCount === 1 ? '' : 's'}`
        : 'No history yet',
    },
    {
      label: 'Slashable stake', value: formatUsd(stakeAmt), color: stakeState?.frozen ? P.rose : stakeAmt > 0 ? P.gold : P.ink,
      sub: stakeState?.frozen ? 'Frozen' : stakeAmt > 0 ? `${TIER_LABELS[tier]} tier` : 'None yet',
    },
    { label: 'Vault capacity', value: capacityLabel, color: P.ink, sub: `${TIER_LABELS[tier]} ${stakeState?.isUnlimited ? 'unlimited' : 'cap'}` },
    {
      label: '$10k fee preview', value: `est. ${formatUsd(feePreview.totalEstimated)}`, color: P.body,
      sub: `${formatUsd(feePreview.managementCost)} mgmt · ${formatUsd(feePreview.performanceCost)} perf · assumes 10%`,
    },
  ];

  return (
    <section style={{ position: 'relative', overflow: 'hidden', background: P.card, border: `1px solid ${P.line}`, borderRadius: 16 }}>
      <div aria-hidden style={{ position: 'absolute', top: -120, right: -60, width: 400, height: 400, background: 'radial-gradient(circle,rgba(227,179,78,0.09),transparent 65%)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 400px', gap: 36, padding: 34 }} className="op-hero-grid">
        {/* identity */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            {mandateLabel && <Chip color={tone.fg} bg={tone.chip}>{mandateLabel.toUpperCase()}</Chip>}
            <Chip color={op.active ? P.emerald : P.amber} bg={op.active ? 'rgba(92,184,138,0.12)' : 'rgba(245,201,126,0.12)'} dot>{op.active ? 'ACTIVE' : 'INACTIVE'}</Chip>
            {repState?.verified && <Chip color={P.violet} bg="rgba(111,123,219,0.12)">✓ VERIFIED</Chip>}
            {tier > 0 && <Chip color={P.sub} bg={P.tag}>★ {TIER_LABELS[tier].toUpperCase()} TIER</Chip>}
            {stakeState?.frozen && <Chip color={P.rose} bg="rgba(223,115,115,0.12)">FROZEN</Chip>}
            {isOwn && <Chip color={P.violet} bg="rgba(111,123,219,0.12)">YOU</Chip>}
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18 }}>
            <div style={{ width: 72, height: 72, borderRadius: 16, background: P.tag, border: '1px solid rgba(227,179,78,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: P.gold, fontSize: 30, fontWeight: 600, flex: 'none' }}>
              {initialOf(op.name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-1.2px', margin: 0 }}>{op.name || 'Operator'}</h1>
              <div style={{ fontFamily: MONO, fontSize: 11.5, color: P.faint, marginTop: 8 }}>
                {handle} · registered {formatDate(op.registeredAt)}{extended?.manifestBonded ? ' · bonded manifest' : ''}
              </div>
            </div>
          </div>

          <p style={{ fontSize: 14, lineHeight: 1.65, color: P.body, maxWidth: 560, margin: '18px 0 0' }}>
            {op.description || 'No description provided. Operator voice and strategy narrative appear here once the profile is updated.'}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap', paddingTop: 18, marginTop: 20, borderTop: `1px solid ${P.line}` }}>
            <HeroFoot label="Operator" value={shortHexLabel(operatorAddress, 6, 6)} href={operatorExplorerHref} />
            <HeroFoot label="Updated" value={formatDate(op.updatedAt || op.registeredAt)} />
            {isLive && <HeroFoot label="Orchestrator" value={`${orchStatus?.cycleCount || 0} cycles · ${orchStatus?.totalExecutions || 0} exec`} dot />}
          </div>
        </div>

        {/* 2x2 snapshot */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignContent: 'start' }}>
          {snap.map((s) => (
            <div key={s.label} style={{ background: P.inner, borderRadius: 13, padding: 16 }}>
              <Eye color={P.faint}>{s.label}</Eye>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 10 }}>
                <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-1px', color: s.color }}>{s.value}</span>
                {s.unit && <span style={{ fontFamily: MONO, fontSize: 12, color: P.faint }}>{s.unit}</span>}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: P.muted, marginTop: 6 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* bottom strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, padding: '24px 34px', borderTop: `1px solid ${P.lineSoft}` }} className="op-hero-strip">
        {[
          { label: 'Mandate fit', value: MANDATE_COPY[mandateLabel] || 'Operator mandate disclosed on-chain for allocator review.' },
          { label: 'Accountability', value: getAccountabilityCopy(stakeState) },
          { label: 'Public disclosure', value: getDisclosureCopy(op.endpoint, extended) },
        ].map((c) => (
          <div key={c.label}>
            <Eye style={{ display: 'block', marginBottom: 7 }}>{c.label}</Eye>
            <div style={{ fontSize: 13, lineHeight: 1.45, color: P.body }}>{c.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Chip({ color, bg, dot, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 10, fontWeight: 600, color, background: bg, padding: '4px 10px', borderRadius: 6, letterSpacing: '0.4px' }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: 999, background: color }} />}
      {children}
    </span>
  );
}

function HeroFoot({ label, value, href, dot }) {
  return (
    <div>
      <Eye style={{ fontSize: 9.5, letterSpacing: '1.8px' }}>{label}</Eye>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        {dot && <span style={{ width: 5, height: 5, borderRadius: 999, background: P.emerald }} />}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 13, color: P.violet, textDecoration: 'none' }}>{value} ↗</a>
        ) : (
          <span style={{ fontFamily: MONO, fontSize: 13, color: P.ink }}>{value}</span>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Commercial terms ─────────────── */

function CommercialTermsPanel({ op, feePreview }) {
  return (
    <SectionCard title="Commercial terms" note="— declared on-chain">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: P.inner, borderRadius: 12, padding: 18 }}>
          <Eye color={P.emerald} style={{ letterSpacing: '1.4px', display: 'block', marginBottom: 10 }}>Performance</Eye>
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-1px' }}>{formatBps(op.performanceFeeBps)}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: P.faint, marginTop: 6 }}>Above high-water mark</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${P.lineSoft}` }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: P.faint }}>Entry <span style={{ color: P.ink }}>{formatBps(op.entryFeeBps)}</span></span>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: P.faint }}>Exit <span style={{ color: P.ink }}>{formatBps(op.exitFeeBps)}</span></span>
          </div>
        </div>
        <div style={{ background: P.inner, borderRadius: 12, padding: 18 }}>
          <Eye color={P.violet} style={{ letterSpacing: '1.4px', display: 'block', marginBottom: 10 }}>Management</Eye>
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-1px' }}>{formatBps(op.managementFeeBps)}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: P.faint, marginTop: 6 }}>Per year · streamed per cycle</div>
        </div>
        <div style={{ gridColumn: 'span 2', background: P.inset, borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <Eye style={{ letterSpacing: '1.4px' }}>$10k fee preview · 10% annual return</Eye>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: P.faint }}>{formatUsd(feePreview.managementCost)} mgmt + {formatUsd(feePreview.performanceCost)} perf</span>
            <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.5px', color: P.gold }}>est. {formatUsd(feePreview.totalEstimated)}</span>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

/* ─────────────── Suggested vault policy ─────────────── */

function PolicyPanel({ op }) {
  const rows = [
    { label: 'Max position', value: `${(Number(op.recommendedMaxPositionBps || 0) / 100).toFixed(1)}%`, bar: Math.min(100, Number(op.recommendedMaxPositionBps || 0) / 100) },
    { label: 'Min confidence', value: `${(Number(op.recommendedConfidenceMinBps || 0) / 100).toFixed(0)}%`, bar: Math.min(100, Number(op.recommendedConfidenceMinBps || 0) / 100) },
    { label: 'Stop-loss', value: `${(Number(op.recommendedStopLossBps || 0) / 100).toFixed(1)}%`, bar: Math.min(100, Number(op.recommendedStopLossBps || 0) / 100) },
    { label: 'Cooldown', value: `${Math.round(Number(op.recommendedCooldownSeconds || 0) / 60)} min`, bar: null },
    { label: 'Max trades / day', value: `${Number(op.recommendedMaxActionsPerDay || 0)}`, bar: null },
  ];
  return (
    <SectionCard title="Suggested vault policy" note="— recommended caps">
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 64px', gap: 16, alignItems: 'center', padding: '13px 0', borderTop: i ? `1px solid ${P.lineSoft}` : 'none' }}>
            <span style={{ fontSize: 13, color: P.body }}>{r.label}</span>
            {r.bar !== null ? <Bar pct={r.bar} /> : <div />}
            <span style={{ fontFamily: MONO, fontSize: 13, color: P.ink, textAlign: 'right' }}>{r.value}</span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/* ─────────────── Track record (+ composite, admin verify, rating) ─────────────── */

function TrackRecordPanel({
  repState, repScore, isOwn, isConnected, alreadyRated, ratingStars, setRatingStars,
  ratingComment, setRatingComment, submitRating, reputationAddress, operatorAddress,
  ratingPending, ratingSuccess, refetchRep, refetchHasRated, isReputationAdmin,
  verifyPending, verifySuccess, setVerified,
}) {
  const record = [
    { label: 'Actions', value: String((repState?.totalExecutions || 0).toLocaleString()), sub: `${repState?.successfulExecutions || 0} successful`, col: P.ink },
    { label: 'Success', value: `${(repState?.successRatePct || 0).toFixed(1)}%`, sub: (repState?.totalExecutions || 0) > 0 ? 'On-chain' : 'No baseline', col: P.emerald },
    { label: 'Volume', value: formatUsd(repState?.totalVolumeUsd || 0), sub: 'Cumulative', col: P.ink },
    { label: 'Cum · P&L', value: formatPnl(repState?.cumulativePnlUsd || 0), sub: 'Realized', col: (repState?.cumulativePnlUsd || 0) >= 0 ? P.emerald : P.rose },
    { label: 'Rating', value: (repState?.averageRating || 0).toFixed(2), sub: `${repState?.ratingCount || 0} review${repState?.ratingCount === 1 ? '' : 's'}`, col: P.gold },
  ];
  return (
    <SectionCard title="On-chain track record" note="— reputation registry">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12 }} className="op-record-grid">
        {record.map((r) => (
          <div key={r.label} style={{ background: P.inner, borderRadius: 11, padding: 15 }}>
            <Eye style={{ fontSize: 9, letterSpacing: '1.2px' }}>{r.label}</Eye>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.5px', marginTop: 9, color: r.col }}>{r.value}</div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: P.muted, marginTop: 4 }}>{r.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${P.lineSoft}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Eye style={{ letterSpacing: '1.4px' }}>Composite reputation score</Eye>
          <span style={{ fontFamily: MONO, fontSize: 12, color: P.ink }}>{repScore} <span style={{ color: P.faint }}>/ 100</span></span>
        </div>
        <Bar pct={repScore} track={P.track} />
        <div style={{ fontFamily: MONO, fontSize: 11, color: P.faint, marginTop: 8 }}>Earned via success rate, ratings, and verification.</div>
      </div>

      {(repState?.firstExecutionAt || 0) > 0 && (
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${P.lineSoft}`, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: P.inset, borderRadius: 10, padding: '8px 12px' }}>
            <Eye>First execution</Eye>
            <div style={{ fontFamily: MONO, fontSize: 12, marginTop: 2, color: P.ink }}>{formatDate(repState.firstExecutionAt)}</div>
          </div>
          <div style={{ background: P.inset, borderRadius: 10, padding: '8px 12px' }}>
            <Eye>Last execution</Eye>
            <div style={{ fontFamily: MONO, fontSize: 12, marginTop: 2, color: P.ink }}>{formatDate(repState.lastExecutionAt)}</div>
          </div>
        </div>
      )}

      {isReputationAdmin && (
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${P.lineSoft}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <Eye color={P.gold} style={{ letterSpacing: '1.4px' }}>Admin verified badge</Eye>
          <Btn
            variant={repState?.verified ? 'danger' : 'gold'}
            size="sm"
            disabled={verifyPending}
            onClick={() => { setVerified(reputationAddress, operatorAddress, !repState?.verified); setTimeout(() => refetchRep(), 4000); }}
          >
            <BadgeCheck style={{ width: 13, height: 13 }} />
            {verifyPending ? 'Updating…' : repState?.verified ? 'Revoke verified' : 'Grant verified'}
          </Btn>
        </div>
      )}
      {verifySuccess && <p style={{ fontFamily: MONO, fontSize: 10, marginTop: 8, textAlign: 'right', color: P.emerald }}>Badge updated on-chain.</p>}

      {isConnected && !isOwn && !alreadyRated && (
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${P.lineSoft}` }}>
          <Eye color={P.violet} style={{ letterSpacing: '1.4px', display: 'block', marginBottom: 12 }}>Rate this operator</Eye>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} type="button" onClick={() => setRatingStars(star)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: star <= ratingStars ? P.gold : '#3a3e46' }}>
                <Star style={{ width: 22, height: 22 }} fill={star <= ratingStars ? 'currentColor' : 'none'} />
              </button>
            ))}
            <span style={{ fontFamily: MONO, fontSize: 11, color: P.sub, marginLeft: 8 }}>{ratingStars}/5</span>
          </div>
          <textarea
            value={ratingComment}
            onChange={(e) => setRatingComment(e.target.value)}
            placeholder="Optional comment (256 char max)"
            maxLength={256}
            rows={2}
            className="op-ta"
            style={{ width: '100%', background: P.inset, border: `1px solid ${P.line}`, borderRadius: 9, padding: '10px 12px', color: P.ink, fontFamily: SANS, fontSize: 12, resize: 'none', marginBottom: 12 }}
          />
          <Btn variant="gold" size="sm" disabled={ratingPending} onClick={() => { submitRating(reputationAddress, operatorAddress, ratingStars, ratingComment); setTimeout(() => { refetchRep(); refetchHasRated(); }, 4000); }}>
            <Star style={{ width: 13, height: 13 }} /> {ratingPending ? 'Submitting…' : 'Submit rating'}
          </Btn>
          {ratingSuccess && <p style={{ fontFamily: MONO, fontSize: 10, marginTop: 8, color: P.emerald }}>Rating recorded on-chain.</p>}
        </div>
      )}
      {alreadyRated && (
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${P.lineSoft}`, textAlign: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: P.violet }}>You&rsquo;ve already rated this operator.</span>
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────────── Allocator / owner actions (right rail top) ─────────────── */

function AllocatorActionsPanel({ isConnected, myVaults, operatorAddress, selectedVault, setSelectedVault, handleAssign, setExecPending, setExecSuccess, opActive }) {
  return (
    <SectionCard title="Assign to a vault" accent="rgba(227,179,78,0.2)">
      {!isConnected ? (
        <>
          <p style={{ fontSize: 12.5, lineHeight: 1.55, color: P.sub, margin: '0 0 14px' }}>Connect a wallet to assign this operator to one of your vaults.</p>
          <div style={{ background: P.inset, border: `1px solid ${P.lineSoft}`, borderRadius: 10, padding: 13, fontSize: 11.5, lineHeight: 1.5, color: P.sub }}>
            Funds stay in your vault — operators only receive the right to submit signed intents.
          </div>
        </>
      ) : myVaults.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '6px 0' }}>
          <p style={{ fontSize: 12.5, color: P.sub, margin: '0 0 12px' }}>No vault yet.</p>
          <Link to={`/create?operator=${operatorAddress}`}><Btn variant="gold" size="sm"><Edit3 style={{ width: 13, height: 13 }} /> Create a vault</Btn></Link>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, lineHeight: 1.55, color: P.sub, margin: '0 0 12px' }}>Set this operator as your vault executor. You stay owner — switch anytime.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myVaults.map((vault) => {
              const selected = selectedVault === vault.address;
              return (
                <button
                  key={vault.address}
                  type="button"
                  onClick={() => setSelectedVault(vault.address)}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer', background: selected ? 'rgba(227,179,78,0.06)' : P.inset, border: `1px solid ${selected ? 'rgba(227,179,78,0.28)' : P.lineSoft}` }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontFamily: MONO, fontSize: 12, color: P.ink }}>{shortHexLabel(vault.address, 8, 6)}</span>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: P.faint }}>{vault.loaded ? formatUsd(Number(vault.balance) || 0) : 'Loading'}</span>
                  </div>
                  {vault.loaded && (
                    <div style={{ marginTop: 3, fontFamily: MONO, fontSize: 10, color: P.faint }}>
                      {vault.paused ? 'Paused' : vault.autoExecution ? 'Auto execution on' : 'Manual execution'} · {vault.executor?.toLowerCase() === operatorAddress.toLowerCase() ? 'Already assigned' : 'Executor change available'}
                    </div>
                  )}
                </button>
              );
            })}
            <Btn variant="gold" full disabled={!selectedVault || setExecPending || !opActive} onClick={handleAssign} style={{ marginTop: 4 }}>
              Assign to vault <ArrowRight style={{ width: 13, height: 13 }} />
            </Btn>
            <Link to="/create"><Btn variant="secondary" full>Create new vault</Btn></Link>
            {setExecSuccess && <p style={{ fontFamily: MONO, fontSize: 10, textAlign: 'center', color: P.emerald, margin: 0 }}>Executor updated on-chain.</p>}
            {!opActive && <p style={{ fontFamily: MONO, fontSize: 10, textAlign: 'center', color: P.amber, margin: 0 }}>This operator is currently inactive.</p>}
          </div>
        </>
      )}
    </SectionCard>
  );
}

function OwnerControlsPanel({ op, deactivating, activating, onDeactivate, onActivate }) {
  return (
    <SectionCard title="Operator controls" accent="rgba(227,179,78,0.2)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Link to="/operator/register"><Btn variant="secondary" full><Edit3 style={{ width: 13, height: 13 }} /> Update profile</Btn></Link>
        {op.active ? (
          <Btn variant="danger" full disabled={deactivating} onClick={onDeactivate}><Power style={{ width: 13, height: 13 }} /> {deactivating ? 'Deactivating…' : 'Deactivate listing'}</Btn>
        ) : (
          <Btn variant="gold" full disabled={activating} onClick={onActivate}><Power style={{ width: 13, height: 13 }} /> {activating ? 'Activating…' : 'Reactivate listing'}</Btn>
        )}
      </div>
      <div style={{ marginTop: 16, background: P.inset, border: `1px solid ${P.lineSoft}`, borderRadius: 10, padding: 13, display: 'flex', gap: 10 }}>
        <ShieldCheck style={{ width: 15, height: 15, color: P.gold, flex: 'none', marginTop: 1 }} />
        <p style={{ fontSize: 11.5, lineHeight: 1.55, color: P.sub, margin: 0 }}>Operators only execute policy-checked actions. Custody stays in the vault — signed intents, on-chain receipts.</p>
      </div>
    </SectionCard>
  );
}

/* ─────────────── Briefing ─────────────── */

function BriefingPanel({ op, extended, operatorAddress, operatorExplorerHref, hasAiProvider, onCopyAddress, addressCopied }) {
  const rows = [
    {
      label: 'Address',
      value: <a href={operatorExplorerHref || '#'} target={operatorExplorerHref ? '_blank' : undefined} rel={operatorExplorerHref ? 'noreferrer' : undefined} style={{ fontFamily: MONO, fontSize: 12, color: operatorExplorerHref ? P.violet : P.body, textDecoration: 'none' }} onClick={(e) => { if (!operatorExplorerHref) e.preventDefault(); }}>{shortHexLabel(operatorAddress, 8, 6)}</a>,
      trailing: <button type="button" onClick={onCopyAddress} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: addressCopied ? P.emerald : P.faint, padding: 0 }}>{addressCopied ? <Check style={{ width: 13, height: 13 }} /> : <Copy style={{ width: 13, height: 13 }} />}</button>,
    },
    { label: 'Status', value: <Chip color={op.active ? P.emerald : P.amber} bg={op.active ? 'rgba(92,184,138,0.12)' : 'rgba(245,201,126,0.12)'} dot>{op.active ? 'Active listing' : 'Inactive listing'}</Chip> },
    { label: 'Registered', value: <span style={{ fontFamily: MONO, fontSize: 12, color: P.ink }}>{formatDate(op.registeredAt)}</span> },
    { label: 'AI model', value: extended?.aiModel ? <span style={{ fontFamily: MONO, fontSize: 12, color: P.violet }}>{extended.aiModel}</span> : <span style={{ fontFamily: MONO, fontSize: 12, fontStyle: 'italic', color: P.faint }}>Undeclared</span> },
  ];
  if (hasAiProvider) rows.push({ label: 'AI provider', value: <span style={{ fontFamily: MONO, fontSize: 12, color: P.ink }}>{shortHexLabel(extended.aiProvider, 8, 6)}</span> });
  rows.push({
    label: 'Manifest',
    value: extended?.manifestURI
      ? <a href={extended.manifestURI} target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 12, color: extended.manifestBonded ? P.gold : P.violet, textDecoration: 'none' }}>v{Number(extended.manifestVersion || 0)}{extended.manifestBonded ? ' bonded' : ' published'}</a>
      : <span style={{ fontFamily: MONO, fontSize: 12, fontStyle: 'italic', color: P.faint }}>Not published</span>,
  });
  rows.push({
    label: 'Endpoint',
    value: op.endpoint
      ? <a href={op.endpoint} target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 12, color: P.violet, textDecoration: 'none' }}>{formatEndpoint(op.endpoint)}</a>
      : <span style={{ fontFamily: MONO, fontSize: 12, fontStyle: 'italic', color: P.faint }}>Not shared</span>,
  });
  return (
    <SectionCard title="Operator briefing">
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderTop: i ? `1px solid ${P.lineSoft}` : 'none' }}>
            <Eye style={{ letterSpacing: '1px', flex: 'none' }}>{row.label}</Eye>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.value}</div>
              {row.trailing}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/* ─────────────── Collateral (+ stake management) ─────────────── */

function CollateralPanel({
  stakeState, tier, capacityLabel, stakeTokenLabel, walletUsdcBalance, usdcAllowance,
  usdcAddress, stakingAddress, stakeAmount, setStakeAmount, unstakeAmount, setUnstakeAmount,
  approveUsdc, approvingStake, stake, staking, stakeSuccess, requestUnstake, requesting,
  requestSuccess, claimUnstake, claiming, claimSuccess, unstakeClaimable, refetchStake,
  refetchAllowance, isOwn, isConnected,
}) {
  const next = stakeState && !stakeState.isUnlimited ? nextTier(stakeState.tier) : null;
  const showProgress = next !== null;
  const progressPct = showProgress ? Math.min(100, (stakeState.amount / TIER_THRESHOLDS[next]) * 100) : 0;
  const gap = showProgress ? tierGapUsd(stakeState.amount, stakeState.tier) : 0;
  const tierChipColor = tier >= 3 ? P.gold : tier >= 1 ? P.violet : P.sub;

  const needsApproval = !!stakeAmount && Number(stakeAmount) > 0 && (!usdcAllowance || Number(usdcAllowance) / 1e6 < Number(stakeAmount));

  return (
    <SectionCard
      title="Collateral"
      trailing={<Chip color={tierChipColor} bg={tier >= 3 ? 'rgba(227,179,78,0.12)' : P.tag}>★ {TIER_LABELS[tier].toUpperCase()} · {capacityLabel} CAP</Chip>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <KV label="Active stake" value={formatUsd(stakeState?.amount || 0)} />
        <KV label="Pending unstake" value={formatUsd(stakeState?.pendingUnstake || 0)} color={(stakeState?.pendingUnstake || 0) > 0 ? P.amber : P.emerald} />
        <KV label="Lifetime staked" value={formatUsd(stakeState?.lifetimeStaked || 0)} />
        <KV label="Lifetime slashed" value={formatUsd(stakeState?.lifetimeSlashed || 0)} color={(stakeState?.lifetimeSlashed || 0) > 0 ? P.rose : P.ink} />
      </div>

      {showProgress && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Eye>Progress to {TIER_LABELS[next]}</Eye>
            <span style={{ fontFamily: MONO, fontSize: 11, color: P.ink }}>{formatUsd(stakeState.amount)} <span style={{ color: P.faint }}>/ {formatUsd(TIER_THRESHOLDS[next])}</span></span>
          </div>
          <Bar pct={progressPct} />
          {gap > 0 && <div style={{ fontFamily: MONO, fontSize: 10.5, color: P.faint, marginTop: 6 }}>{formatUsd(gap)} more to unlock {formatVaultCap(next === 1 ? 50_000 : next === 2 ? 500_000 : next === 3 ? 5_000_000 : Infinity, next === 4)} cap</div>}
        </div>
      )}

      {isOwn && isConnected && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${P.lineSoft}`, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <StakeForm
            label={`Add stake (${stakeTokenLabel})`}
            amount={stakeAmount}
            setAmount={setStakeAmount}
            hintLabel="Wallet"
            hintValue={`${Number(walletUsdcBalance || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${stakeTokenLabel}`}
            maxValue={walletUsdcBalance || '0'}
            disabled={stakeState?.frozen}
            action={needsApproval ? (
              <Btn variant="gold" size="sm" full disabled={!stakeAmount || Number(stakeAmount) <= 0 || approvingStake || stakeState?.frozen} onClick={() => { approveUsdc(usdcAddress, stakingAddress, stakeAmount, 6); setTimeout(() => refetchAllowance(), 4000); }}>
                <Check style={{ width: 13, height: 13 }} /> {approvingStake ? 'Approving…' : `Approve ${stakeTokenLabel}`}
              </Btn>
            ) : (
              <Btn variant="primary" size="sm" full disabled={!stakeAmount || Number(stakeAmount) <= 0 || staking || stakeState?.frozen} onClick={() => { stake(stakingAddress, stakeAmount, 6); setTimeout(() => { refetchStake(); setStakeAmount(''); }, 4000); }}>
                <Zap style={{ width: 13, height: 13 }} /> {staking ? 'Staking…' : 'Stake'}
              </Btn>
            )}
            footer={stakeSuccess && <p style={{ fontFamily: MONO, fontSize: 10, marginTop: 8, color: P.emerald }}>Stake confirmed on-chain.</p>}
          />
          <StakeForm
            label={`Request unstake (${stakeTokenLabel})`}
            amount={unstakeAmount}
            setAmount={setUnstakeAmount}
            hintLabel="Active"
            hintValue={formatUsd(stakeState?.amount || 0, 2)}
            maxValue={String(stakeState?.amount || 0)}
            disabled={stakeState?.frozen || (stakeState?.pendingUnstake || 0) > 0}
            action={
              <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                <Btn variant="secondary" size="sm" full disabled={!unstakeAmount || Number(unstakeAmount) <= 0 || requesting || stakeState?.frozen || (stakeState?.pendingUnstake || 0) > 0} onClick={() => { requestUnstake(stakingAddress, unstakeAmount, 6); setTimeout(() => { refetchStake(); setUnstakeAmount(''); }, 4000); }}>
                  <RefreshCw style={{ width: 13, height: 13 }} /> {requesting ? 'Requesting…' : 'Request'}
                </Btn>
                {unstakeClaimable && (
                  <Btn variant="gold" size="sm" full disabled={claiming || stakeState?.frozen} onClick={() => { claimUnstake(stakingAddress); setTimeout(() => refetchStake(), 4000); }}>
                    <Unlock style={{ width: 13, height: 13 }} /> {claiming ? 'Claiming…' : 'Claim'}
                  </Btn>
                )}
              </div>
            }
            footer={
              <>
                {(stakeState?.pendingUnstake || 0) > 0 && <p style={{ fontFamily: MONO, fontSize: 10, marginTop: 8, color: P.amber }}>Existing unstake pending — another cannot be opened yet.</p>}
                {requestSuccess && <p style={{ fontFamily: MONO, fontSize: 10, marginTop: 8, color: P.emerald }}>14-day cooldown started.</p>}
                {claimSuccess && <p style={{ fontFamily: MONO, fontSize: 10, marginTop: 8, color: P.emerald }}>Stake withdrawn back to wallet.</p>}
              </>
            }
          />
        </div>
      )}

      {stakeState?.frozen && (
        <div style={{ marginTop: 16, background: 'rgba(223,115,115,0.05)', border: '1px solid rgba(223,115,115,0.25)', borderRadius: 10, padding: 12, display: 'flex', gap: 8 }}>
          <AlertTriangle style={{ width: 14, height: 14, color: P.rose, flex: 'none', marginTop: 1 }} />
          <div style={{ fontSize: 11.5, lineHeight: 1.5, color: '#f0a8a8' }}><strong>Stake frozen.</strong> Stake actions are disabled pending governance review.</div>
        </div>
      )}

      {!isOwn && (
        <div style={{ marginTop: 16, background: P.inset, border: `1px solid ${P.lineSoft}`, borderRadius: 10, padding: 13 }}>
          <p style={{ fontSize: 11.5, lineHeight: 1.5, color: P.sub, margin: 0 }}>Slashable collateral backing this operator. Governance can penalise misbehavior by burning from this pool.</p>
        </div>
      )}
    </SectionCard>
  );
}

function KV({ label, value, color = P.ink }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontFamily: MONO, fontSize: 11, color: P.sub }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 14, color }}>{value}</span>
    </div>
  );
}

function StakeForm({ label, amount, setAmount, hintLabel, hintValue, maxValue, disabled, action, footer }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Eye>{label}</Eye>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: P.faint }}>{hintLabel} <span style={{ color: P.ink }}>{hintValue}</span></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: P.inset, border: `1px solid ${P.line}`, borderRadius: 10, padding: '0 12px', height: 44 }}>
        <span style={{ fontFamily: MONO, fontSize: 12, color: P.faint }}>$</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="0.00" disabled={disabled} className="op-ta" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontFamily: MONO, fontSize: 16, color: P.ink, opacity: disabled ? 0.5 : 1 }} />
        <button type="button" onClick={() => setAmount(String(maxValue))} style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '1.4px', textTransform: 'uppercase', color: P.violet, background: 'transparent', border: 'none', cursor: 'pointer' }}>Max</button>
      </div>
      <div style={{ marginTop: 10 }}>{action}</div>
      {footer}
    </div>
  );
}

/* ─────────────── Sessions ─────────────── */

function SessionsPanel({ recentOperatorTxs }) {
  return (
    <SectionCard title="Session transactions">
      {recentOperatorTxs.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recentOperatorTxs.map((tx) => (
            <a key={tx.href} href={tx.href} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 12px', borderRadius: 10, background: P.inset, border: `1px solid ${P.lineSoft}`, textDecoration: 'none' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ width: 5, height: 5, borderRadius: 999, background: P.violet }} />
                <span style={{ fontSize: 12, color: P.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.label}</span>
              </span>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: P.violet, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{shortHexLabel(tx.hash, 6, 4)} <ExternalLink style={{ width: 11, height: 11 }} /></span>
            </a>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(111,123,219,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', color: P.violet }}>
            <Activity style={{ width: 16, height: 16 }} />
          </div>
          <div>
            <div style={{ fontSize: 14, color: P.ink }}>No recent actions.</div>
            <p style={{ fontFamily: MONO, fontSize: 10.5, marginTop: 4, color: P.faint }}>Session txns stream here once the operator picks up its first signed intent.</p>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────────── Page ─────────────── */

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

  const stakingAddress = deployments.operatorStakingV2 || deployments.operatorStaking;
  const usdcAddress = deployments.oUSDT || deployments.mockUSDC;
  const { state: stakeState, refetch: refetchStake } = useOperatorStake(stakingAddress, validAddress ? operatorAddress : undefined);
  const { data: usdcAllowance, refetch: refetchAllowance } = useStakingAllowance(usdcAddress, walletAddress, stakingAddress);
  const { balance: walletUsdcBalance } = useTokenBalance(usdcAddress, walletAddress, 6);
  const stakeTokenLabel = deployments.oUSDT ? 'oUSDT' : 'USDC';
  const { approve: approveUsdc, hash: approveStakeHash, isPending: approvingStake } = useApproveStake();
  const { stake, hash: stakeHash, isPending: staking, isSuccess: stakeSuccess } = useStake();
  const { requestUnstake, hash: requestUnstakeHash, isPending: requesting, isSuccess: requestSuccess } = useRequestUnstake();
  const { claimUnstake, hash: claimUnstakeHash, isPending: claiming, isSuccess: claimSuccess } = useClaimUnstake();

  const reputationAddress = deployments.operatorReputation;
  const { state: repState, refetch: refetchRep } = useOperatorReputation(reputationAddress, validAddress ? operatorAddress : undefined);
  const { data: alreadyRated, refetch: refetchHasRated } = useHasRated(reputationAddress, validAddress ? operatorAddress : undefined, walletAddress);
  const { submitRating, hash: submitRatingHash, isPending: ratingPending, isSuccess: ratingSuccess } = useSubmitRating();
  const { data: repAdmin } = useReputationAdmin(reputationAddress);
  const { setVerified, hash: verifyHash, isPending: verifyPending, isSuccess: verifySuccess } = useSetVerified();
  const isReputationAdmin = walletAddress && repAdmin && walletAddress.toLowerCase() === repAdmin.toLowerCase();

  const [selectedVault, setSelectedVault] = useState('');
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [addressCopied, setAddressCopied] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!validAddress) {
    return (
      <div style={{ background: P.bg, minHeight: '100vh', fontFamily: SANS }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: P.sub }}>Invalid operator address.</p>
          <Link to="/marketplace" style={{ fontFamily: MONO, fontSize: 11, color: P.violet, marginTop: 12, display: 'inline-block' }}>← Back to Marketplace</Link>
        </div>
      </div>
    );
  }

  if (!op) {
    return (
      <div style={{ background: P.bg, minHeight: '100vh', fontFamily: SANS }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px', textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: `2px solid rgba(227,179,78,0.3)`, borderTopColor: P.gold, borderRadius: '50%', margin: '0 auto 12px', animation: 'spin 1s linear infinite' }} />
          <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase', color: P.sub }}>Loading operator from chain…</p>
        </div>
      </div>
    );
  }

  const mandateLabel = MandateLabel[Number(op.mandate)];
  const isOwn = walletAddress?.toLowerCase() === operatorAddress.toLowerCase();
  const isLive = doesExecutorMatchOrchestrator(orchStatus, operatorAddress);
  const operatorExplorerHref = getExplorerAddressHref(chainId, operatorAddress);
  const unstakeClaimable = (stakeState?.pendingUnstake || 0) > 0 && (stakeState?.unstakeAvailableAt || 0) <= nowSeconds;

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
  // Honesty fix: only render a capacity when the staking read actually returned.
  // A null stakeState (read failed / contract absent) shows '—' instead of the
  // CAP_NONE "$5k" default, so a real tier-None cap is never visually identical
  // to a missing read.
  const capacityLabel = stakeState ? formatVaultCap(stakeState.maxVaultSize || 5_000, stakeState.isUnlimited) : '—';
  const hasAiProvider = Boolean(extended?.aiProvider && extended.aiProvider !== ZERO_ADDRESS);

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
    <div style={{ fontFamily: SANS, color: P.ink, background: P.bg }}>
      <style>{`
        .op-ta::placeholder{color:${P.faint}}
        .op-ta:focus{outline:none}
        @keyframes spin{to{transform:rotate(360deg)}}
        @media(max-width:1000px){.op-hero-grid{grid-template-columns:1fr!important}.op-page-grid{grid-template-columns:1fr!important}.op-hero-strip{grid-template-columns:1fr!important}.op-record-grid{grid-template-columns:repeat(2,1fr)!important}}
      `}</style>
      <div className="max-w-[1540px] mx-auto px-4 lg:px-6" style={{ paddingTop: 20, paddingBottom: 48, display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* breadcrumb */}
        <Link to="/marketplace" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: MONO, fontSize: 11.5, color: P.sub, textDecoration: 'none', width: 'fit-content' }}>
          <ArrowLeft style={{ width: 13, height: 13 }} /> Marketplace · Operator file
        </Link>

        <OperatorHero
          op={op} extended={extended} operatorAddress={operatorAddress} operatorExplorerHref={operatorExplorerHref}
          mandateLabel={mandateLabel} repScore={repScore} repState={repState} stakeState={stakeState}
          tier={tier} capacityLabel={capacityLabel} feePreview={feePreview} orchStatus={orchStatus} isLive={isLive} isOwn={isOwn}
        />

        <div className="op-page-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: 22, alignItems: 'start' }}>
          {/* LEFT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
            <CommercialTermsPanel op={op} feePreview={feePreview} />
            <PolicyPanel op={op} />
            {showTrackRecord && (
              <TrackRecordPanel
                repState={repState} repScore={repScore} isOwn={isOwn} isConnected={isConnected} alreadyRated={alreadyRated}
                ratingStars={ratingStars} setRatingStars={setRatingStars} ratingComment={ratingComment} setRatingComment={setRatingComment}
                submitRating={submitRating} reputationAddress={reputationAddress} operatorAddress={operatorAddress}
                ratingPending={ratingPending} ratingSuccess={ratingSuccess} refetchRep={refetchRep} refetchHasRated={refetchHasRated}
                isReputationAdmin={isReputationAdmin} verifyPending={verifyPending} verifySuccess={verifySuccess} setVerified={setVerified}
              />
            )}
          </div>

          {/* RIGHT rail */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {isOwn ? (
              <OwnerControlsPanel
                op={op} deactivating={deactivating} activating={activating}
                onDeactivate={() => { deactivate(registryAddress); setTimeout(() => refetchOp(), 4000); }}
                onActivate={() => { activate(registryAddress); setTimeout(() => refetchOp(), 4000); }}
              />
            ) : (
              <AllocatorActionsPanel
                isConnected={isConnected} myVaults={myVaults} operatorAddress={operatorAddress}
                selectedVault={selectedVault} setSelectedVault={setSelectedVault} handleAssign={handleAssign}
                setExecPending={setExecPending} setExecSuccess={setExecSuccess} opActive={op.active}
              />
            )}

            <BriefingPanel
              op={op} extended={extended} operatorAddress={operatorAddress} operatorExplorerHref={operatorExplorerHref}
              hasAiProvider={hasAiProvider} onCopyAddress={handleCopyAddress} addressCopied={addressCopied}
            />

            {showCollateral && (
              <CollateralPanel
                stakeState={stakeState} tier={tier} capacityLabel={capacityLabel} stakeTokenLabel={stakeTokenLabel}
                walletUsdcBalance={walletUsdcBalance} usdcAllowance={usdcAllowance} usdcAddress={usdcAddress} stakingAddress={stakingAddress}
                stakeAmount={stakeAmount} setStakeAmount={setStakeAmount} unstakeAmount={unstakeAmount} setUnstakeAmount={setUnstakeAmount}
                approveUsdc={approveUsdc} approvingStake={approvingStake} stake={stake} staking={staking} stakeSuccess={stakeSuccess}
                requestUnstake={requestUnstake} requesting={requesting} requestSuccess={requestSuccess}
                claimUnstake={claimUnstake} claiming={claiming} claimSuccess={claimSuccess} unstakeClaimable={unstakeClaimable}
                refetchStake={refetchStake} refetchAllowance={refetchAllowance} isOwn={isOwn} isConnected={isConnected}
              />
            )}

            <SessionsPanel recentOperatorTxs={recentOperatorTxs} />
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── helpers ─────────────── */

function getAccountabilityCopy(stakeState) {
  if (stakeState?.frozen) return `${formatUsd(stakeState.amount || 0)} frozen — governance review in progress.`;
  if ((stakeState?.amount || 0) > 0) return `${formatUsd(stakeState.amount || 0)} staked · cap ${formatVaultCap(stakeState.maxVaultSize || 5_000, stakeState.isUnlimited)}`;
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
  return new Date(Number(timestamp) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatEndpoint(endpoint) {
  if (!endpoint) return '—';
  const cleaned = endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return cleaned.length > 28 ? `${cleaned.slice(0, 25)}...` : cleaned;
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
