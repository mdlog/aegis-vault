import { useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { isAddress } from 'viem';
import { getDeployments } from '../lib/contracts';
import {
  useGovernorConfig, useProposals, useSubmitProposal,
  useConfirmProposal, useExecuteProposal, useRevokeConfirmation,
  useCancelProposal, useHasConfirmed,
  ProposalBuilders, decodeProposalAction, shortHex,
} from '../hooks/useGovernor';
import { useTokenBalance } from '../hooks/useVault';
import { useStakingStats, useInsurancePoolStats } from '../hooks/useOperatorStaking';
import GlassPanel from '../components/ui/GlassPanel';
import StatusPill from '../components/ui/StatusPill';
import SectionLabel from '../components/ui/SectionLabel';
import ControlButton from '../components/ui/ControlButton';
import {
  Vote, Users, Shield, AlertTriangle, CheckCircle, XCircle, Clock,
  DollarSign, ShieldCheck, Lock, BadgeCheck, Plus, FileText, ExternalLink,
} from 'lucide-react';

const ACTION_TYPES = [
  { key: 'slash', label: 'Slash Operator', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  { key: 'freeze', label: 'Freeze Stake', icon: <Lock className="w-3.5 h-3.5" /> },
  { key: 'unfreeze', label: 'Unfreeze Stake', icon: <Lock className="w-3.5 h-3.5" /> },
  { key: 'payout', label: 'Pay Insurance Claim', icon: <DollarSign className="w-3.5 h-3.5" /> },
  { key: 'spend', label: 'Treasury Spend', icon: <DollarSign className="w-3.5 h-3.5" /> },
  { key: 'verify', label: 'Set Verified Badge', icon: <BadgeCheck className="w-3.5 h-3.5" /> },
  { key: 'addOwner', label: 'Add Governor Owner', icon: <Plus className="w-3.5 h-3.5" /> },
  { key: 'removeOwner', label: 'Remove Governor Owner', icon: <XCircle className="w-3.5 h-3.5" /> },
  { key: 'changeThreshold', label: 'Change Threshold', icon: <Vote className="w-3.5 h-3.5" /> },
];

export default function GovernancePage() {
  const { address: walletAddress } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const governorAddress = deployments.aegisGovernor;

  const { owners, threshold, totalProposals } = useGovernorConfig(governorAddress);
  const { proposals, refetch: refetchProposals } = useProposals(governorAddress, totalProposals);

  const isGovernorOwner = walletAddress && owners.some(
    (o) => o.toLowerCase() === walletAddress.toLowerCase()
  );

  // Stats for sidebar
  const { balance: treasuryUsdc } = useTokenBalance(deployments.mockUSDC, deployments.protocolTreasury, 6);
  const { totalStakers, totalStakedUsd } = useStakingStats(deployments.operatorStaking);
  const { balance: insuranceBalance, claimCount } = useInsurancePoolStats(deployments.insurancePool, deployments.mockUSDC);

  const { submit, isPending: submitting, isSuccess: submitSuccess } = useSubmitProposal();
  const { confirm, isPending: confirming } = useConfirmProposal();
  const { execute, isPending: executing } = useExecuteProposal();
  const { revoke } = useRevokeConfirmation();
  const { cancel } = useCancelProposal();

  // Compose form state
  const [actionType, setActionType] = useState('slash');
  const [showCompose, setShowCompose] = useState(false);
  const [form, setForm] = useState({
    operator: '', amount: '', reason: '', recipient: '', purpose: '',
    claimId: '', verified: true, newOwner: '', oldOwner: '', newThreshold: 2,
  });

  const handleSubmit = () => {
    let built;
    switch (actionType) {
      case 'slash':
        if (!isAddress(form.operator) || !form.amount) return;
        built = ProposalBuilders.slash(deployments.operatorStaking, form.operator, form.amount, form.reason || 'arbitration');
        break;
      case 'freeze':
        if (!isAddress(form.operator)) return;
        built = ProposalBuilders.freeze(deployments.operatorStaking, form.operator);
        break;
      case 'unfreeze':
        if (!isAddress(form.operator)) return;
        built = ProposalBuilders.unfreeze(deployments.operatorStaking, form.operator);
        break;
      case 'payout':
        if (!form.claimId || !form.amount) return;
        built = ProposalBuilders.payoutClaim(deployments.insurancePool, form.claimId, form.amount);
        break;
      case 'spend':
        if (!isAddress(form.recipient) || !form.amount) return;
        built = ProposalBuilders.treasurySpend(
          deployments.protocolTreasury, deployments.mockUSDC, form.recipient, form.amount, form.purpose || ''
        );
        break;
      case 'verify':
        if (!isAddress(form.operator)) return;
        built = ProposalBuilders.setVerified(deployments.operatorReputation, form.operator, form.verified);
        break;
      case 'addOwner':
        if (!isAddress(form.newOwner)) return;
        built = ProposalBuilders.addOwner(governorAddress, form.newOwner);
        break;
      case 'removeOwner':
        if (!isAddress(form.oldOwner)) return;
        built = ProposalBuilders.removeOwner(governorAddress, form.oldOwner);
        break;
      case 'changeThreshold':
        if (!form.newThreshold) return;
        built = ProposalBuilders.changeThreshold(governorAddress, Number(form.newThreshold));
        break;
      default:
        return;
    }
    if (!built) return;
    const description = buildDescription(actionType, form);
    submit(governorAddress, built.target, built.value, built.data, description);
    setTimeout(() => { refetchProposals(); setShowCompose(false); }, 4000);
  };

  if (!governorAddress) {
    return (
      <div className="max-w-3xl mx-auto px-4 lg:px-6 py-12 text-center">
        <Vote className="w-10 h-10 text-steel/20 mx-auto mb-3" />
        <p className="text-sm text-steel/50">Governance contract not deployed on this network yet.</p>
        <p className="text-[11px] text-steel/30 mt-1">Run <code className="text-cyan/60">deploy-phase4.js</code> to enable governance.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-display font-semibold text-white tracking-tight mb-1">
            Governance
          </h1>
          <p className="text-xs text-steel/50 max-w-2xl">
            {threshold}-of-{owners.length} multi-sig controlling slashing, treasury, verified badges,
            and owner rotation. All sensitive actions flow through here.
          </p>
        </div>
        {isGovernorOwner && (
          <ControlButton variant="gold" onClick={() => setShowCompose(true)}>
            <Plus className="w-3.5 h-3.5" /> New Proposal
          </ControlButton>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-3.5 h-3.5 text-cyan/60" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-steel/50">Owners</span>
          </div>
          <div className="text-2xl font-display font-semibold text-white tabular-nums">
            {threshold}/{owners.length}
          </div>
          <div className="text-[10px] text-steel/40 mt-0.5">multi-sig threshold</div>
        </GlassPanel>

        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-3.5 h-3.5 text-gold/60" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-steel/50">Proposals</span>
          </div>
          <div className="text-2xl font-display font-semibold text-gold tabular-nums">
            {totalProposals}
          </div>
          <div className="text-[10px] text-steel/40 mt-0.5">total submitted</div>
        </GlassPanel>

        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-3.5 h-3.5 text-emerald-soft/60" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-steel/50">Treasury</span>
          </div>
          <div className="text-2xl font-display font-semibold text-emerald-soft tabular-nums">
            ${parseFloat(treasuryUsdc || '0').toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] text-steel/40 mt-0.5">USDC balance</div>
        </GlassPanel>

        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-3.5 h-3.5 text-amber-warn/60" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-steel/50">Total Staked</span>
          </div>
          <div className="text-2xl font-display font-semibold text-amber-warn tabular-nums">
            ${(totalStakedUsd || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] text-steel/40 mt-0.5">{totalStakers} operator{totalStakers === 1 ? '' : 's'}</div>
        </GlassPanel>

        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan/60" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-steel/50">Insurance</span>
          </div>
          <div className="text-2xl font-display font-semibold text-cyan tabular-nums">
            ${(insuranceBalance || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] text-steel/40 mt-0.5">{claimCount} claim{claimCount === 1 ? '' : 's'}</div>
        </GlassPanel>
      </div>

      {/* Owners list */}
      <div className="mb-6">
        <SectionLabel color="text-cyan/60">Multi-sig Owners</SectionLabel>
        <GlassPanel className="p-4">
          <div className="grid gap-2">
            {owners.map((owner, i) => {
              const isMe = walletAddress && owner.toLowerCase() === walletAddress.toLowerCase();
              return (
                <div key={owner} className="flex items-center justify-between px-3 py-2 rounded-md bg-white/[0.02] border border-white/[0.04]">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-steel/40 w-6">#{i + 1}</span>
                    <span className="text-xs font-mono text-white/70">{owner}</span>
                    {isMe && (
                      <span className="text-[8px] font-mono text-cyan/60 px-1 py-0.5 rounded bg-cyan/5 border border-cyan/10">YOU</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </GlassPanel>
      </div>

      {/* Compose proposal */}
      {showCompose && isGovernorOwner && (
        <GlassPanel gold className="p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-display font-semibold text-white">New Proposal</h3>
            <button
              onClick={() => setShowCompose(false)}
              className="text-[11px] text-steel/45 hover:text-white"
            >Close</button>
          </div>

          {/* Action type selector */}
          <div className="mb-4">
            <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-2">Action Type</label>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
              {ACTION_TYPES.map((a) => (
                <button
                  key={a.key}
                  onClick={() => setActionType(a.key)}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md text-[11px] font-mono transition-all ${
                    actionType === a.key
                      ? 'bg-gold/15 text-gold border border-gold/30'
                      : 'bg-white/[0.03] text-steel/55 border border-white/[0.06] hover:border-white/[0.1]'
                  }`}
                >
                  {a.icon}
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic form fields */}
          <div className="grid lg:grid-cols-2 gap-3 mb-4">
            {(['slash', 'freeze', 'unfreeze', 'verify'].includes(actionType)) && (
              <FormField
                label="Operator Address"
                value={form.operator}
                onChange={(v) => setForm({ ...form, operator: v })}
                placeholder="0x..."
              />
            )}
            {actionType === 'slash' && (
              <>
                <FormField
                  label="Slash Amount (USDC)"
                  type="number"
                  value={form.amount}
                  onChange={(v) => setForm({ ...form, amount: v })}
                  placeholder="20000"
                />
                <FormField
                  label="Reason"
                  value={form.reason}
                  onChange={(v) => setForm({ ...form, reason: v })}
                  placeholder="policy_violation_42"
                  className="lg:col-span-2"
                />
              </>
            )}
            {actionType === 'verify' && (
              <FormField
                label="Verified?"
                value={form.verified ? 'true' : 'false'}
                onChange={(v) => setForm({ ...form, verified: v === 'true' })}
                placeholder="true"
              />
            )}
            {actionType === 'payout' && (
              <>
                <FormField
                  label="Claim ID"
                  type="number"
                  value={form.claimId}
                  onChange={(v) => setForm({ ...form, claimId: v })}
                  placeholder="1"
                />
                <FormField
                  label="Payout (USDC)"
                  type="number"
                  value={form.amount}
                  onChange={(v) => setForm({ ...form, amount: v })}
                  placeholder="15000"
                />
              </>
            )}
            {actionType === 'spend' && (
              <>
                <FormField
                  label="Recipient"
                  value={form.recipient}
                  onChange={(v) => setForm({ ...form, recipient: v })}
                  placeholder="0x..."
                />
                <FormField
                  label="Amount (USDC)"
                  type="number"
                  value={form.amount}
                  onChange={(v) => setForm({ ...form, amount: v })}
                  placeholder="5000"
                />
                <FormField
                  label="Purpose"
                  value={form.purpose}
                  onChange={(v) => setForm({ ...form, purpose: v })}
                  placeholder="grant_audit_2026"
                  className="lg:col-span-2"
                />
              </>
            )}
            {actionType === 'addOwner' && (
              <FormField
                label="New Owner Address"
                value={form.newOwner}
                onChange={(v) => setForm({ ...form, newOwner: v })}
                placeholder="0x..."
                className="lg:col-span-2"
              />
            )}
            {actionType === 'removeOwner' && (
              <FormField
                label="Owner to Remove"
                value={form.oldOwner}
                onChange={(v) => setForm({ ...form, oldOwner: v })}
                placeholder="0x..."
                className="lg:col-span-2"
              />
            )}
            {actionType === 'changeThreshold' && (
              <FormField
                label="New Threshold"
                type="number"
                value={form.newThreshold}
                onChange={(v) => setForm({ ...form, newThreshold: v })}
                placeholder="2"
              />
            )}
          </div>

          <ControlButton
            variant="primary"
            disabled={submitting}
            onClick={handleSubmit}
          >
            <Vote className="w-3.5 h-3.5" />
            {submitting ? 'Submitting...' : 'Submit Proposal'}
          </ControlButton>
          {submitSuccess && (
            <p className="text-[11px] text-emerald-soft/70 mt-2">Proposal submitted on-chain</p>
          )}
        </GlassPanel>
      )}

      {/* Proposal list */}
      <SectionLabel color="text-gold/60">Proposals ({proposals.length})</SectionLabel>
      {proposals.length === 0 ? (
        <GlassPanel className="p-12 text-center border-dashed">
          <Vote className="w-10 h-10 text-steel/20 mx-auto mb-3" />
          <p className="text-sm text-steel/50">No proposals yet.</p>
          {isGovernorOwner && (
            <p className="text-[11px] text-steel/30 mt-1">Owners can submit proposals via the button above.</p>
          )}
        </GlassPanel>
      ) : (
        <div className="space-y-3">
          {[...proposals].reverse().map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              threshold={threshold}
              governorAddress={governorAddress}
              walletAddress={walletAddress}
              isOwner={isGovernorOwner}
              deployments={deployments}
              onConfirm={() => { confirm(governorAddress, p.id); setTimeout(refetchProposals, 4000); }}
              onExecute={() => { execute(governorAddress, p.id); setTimeout(refetchProposals, 4000); }}
              onRevoke={() => { revoke(governorAddress, p.id); setTimeout(refetchProposals, 4000); }}
              onCancel={() => { cancel(governorAddress, p.id); setTimeout(refetchProposals, 4000); }}
              executing={executing}
              confirming={confirming}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function buildDescription(actionType, form) {
  switch (actionType) {
    case 'slash': return `Slash ${form.operator?.slice(0, 8)}... by $${form.amount} — ${form.reason || 'arbitration'}`;
    case 'freeze': return `Freeze ${form.operator?.slice(0, 8)}... pending arbitration`;
    case 'unfreeze': return `Unfreeze ${form.operator?.slice(0, 8)}...`;
    case 'payout': return `Pay claim #${form.claimId} for $${form.amount}`;
    case 'spend': return `Treasury spend $${form.amount} → ${form.recipient?.slice(0, 8)}... · ${form.purpose}`;
    case 'verify': return `${form.verified ? 'Grant' : 'Revoke'} verified badge to ${form.operator?.slice(0, 8)}...`;
    case 'addOwner': return `Add governor owner ${form.newOwner?.slice(0, 8)}...`;
    case 'removeOwner': return `Remove governor owner ${form.oldOwner?.slice(0, 8)}...`;
    case 'changeThreshold': return `Change threshold to ${form.newThreshold}`;
    default: return 'Proposal';
  }
}

function FormField({ label, value, onChange, placeholder, type = 'text', className = '' }) {
  return (
    <div className={className}>
      <label className="text-[10px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck="false"
        className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md px-3 py-2 text-sm font-mono text-white placeholder:text-steel/30 focus:outline-none focus:border-gold/30 transition-colors"
      />
    </div>
  );
}

function ProposalCard({
  proposal, threshold, governorAddress, walletAddress, isOwner, deployments,
  onConfirm, onExecute, onRevoke, onCancel, executing, confirming,
}) {
  const { data: hasConfirmed, refetch: refetchConfirmed } = useHasConfirmed(governorAddress, proposal.id, walletAddress);

  const reached = proposal.confirmations >= threshold;
  const status = proposal.executed ? 'executed' : proposal.canceled ? 'canceled' : reached ? 'ready' : 'pending';
  const statusVariant = {
    executed: 'active',
    canceled: 'paused',
    ready: 'gold',
    pending: 'warning',
  }[status];
  const statusLabel = {
    executed: 'Executed',
    canceled: 'Canceled',
    ready: 'Ready to execute',
    pending: 'Awaiting confirmations',
  }[status];

  const actionTarget = decodeProposalAction(proposal, deployments);

  return (
    <GlassPanel className="p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[10px] font-mono text-steel/40">#{proposal.id}</span>
            <h4 className="text-sm font-display font-medium text-white truncate">{proposal.description || '(no description)'}</h4>
            <StatusPill label={statusLabel} variant={statusVariant} pulse={status === 'ready'} />
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono text-steel/40 flex-wrap">
            <span>Target: {actionTarget}</span>
            <span>•</span>
            <span>Proposer: {shortHex(proposal.proposer)}</span>
            <span>•</span>
            <span>{new Date(proposal.createdAt * 1000).toLocaleString()}</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-xs font-mono text-white/65 tabular-nums">
            {proposal.confirmations}/{threshold}
          </div>
          <div className="w-20 h-1 bg-white/[0.04] rounded-full mt-1 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                reached ? 'bg-gold' : 'bg-cyan/60'
              }`}
              style={{ width: `${threshold > 0 ? Math.min(100, (proposal.confirmations / threshold) * 100) : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Action buttons */}
      {!proposal.executed && !proposal.canceled && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.04]">
          {isOwner && !hasConfirmed && (
            <ControlButton
              variant="primary"
              size="sm"
              disabled={confirming}
              onClick={() => { onConfirm(); setTimeout(refetchConfirmed, 4000); }}
            >
              <CheckCircle className="w-3 h-3" />
              {confirming ? 'Confirming...' : 'Confirm'}
            </ControlButton>
          )}
          {isOwner && hasConfirmed && !proposal.executed && (
            <ControlButton
              variant="secondary"
              size="sm"
              onClick={() => { onRevoke(); setTimeout(refetchConfirmed, 4000); }}
            >
              <XCircle className="w-3 h-3" />
              Revoke
            </ControlButton>
          )}
          {reached && (
            <ControlButton
              variant="gold"
              size="sm"
              disabled={executing}
              onClick={onExecute}
            >
              <CheckCircle className="w-3 h-3" />
              {executing ? 'Executing...' : 'Execute'}
            </ControlButton>
          )}
          {isOwner && (
            <ControlButton
              variant="danger"
              size="sm"
              onClick={onCancel}
            >
              Cancel
            </ControlButton>
          )}
        </div>
      )}

      {proposal.executed && (
        <div className="pt-2 border-t border-white/[0.04] text-[10px] font-mono text-emerald-soft/70">
          Executed at {new Date(proposal.executedAt * 1000).toLocaleString()}
        </div>
      )}
    </GlassPanel>
  );
}
