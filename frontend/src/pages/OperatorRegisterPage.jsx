import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { getDeployments, getExplorerTxHref, shortHexLabel } from '../lib/contracts';
import {
  useIsRegistered, useOperator, useRegisterOperator, useUpdateOperator, Mandate,
  useOperatorExtended, usePublishManifest, useDeclareAIModel,
} from '../hooks/useOperatorRegistry';
import { useAvailableAIModels } from '../hooks/useOrchestrator';
import { keccak256, toBytes } from 'viem';
import GlassPanel from '../components/ui/GlassPanel';
import ControlButton from '../components/ui/ControlButton';
import StatusPill from '../components/ui/StatusPill';
import WalletButton from '../components/ui/WalletButton';
import ExplorerAnchor from '../components/ui/ExplorerAnchor';
import { ArrowLeft, Cpu, Globe, Tag, FileText, ShieldCheck, AlertTriangle } from 'lucide-react';

const DEFAULT_OPERATOR_FORM = {
  name: '',
  description: '',
  endpoint: '',
  mandate: Mandate.Balanced,
  performanceFeePct: 15,
  managementFeePct: 2,
  entryFeePct: 0,
  exitFeePct: 0.5,
  recMaxPositionPct: 50,
  recConfidenceMinPct: 60,
  recStopLossPct: 15,
  recCooldownMin: 15,
  recMaxActionsPerDay: 20,
};

function buildOperatorForm(existingOp, isRegistered) {
  if (!(existingOp && isRegistered)) {
    return DEFAULT_OPERATOR_FORM;
  }

  return {
    name: existingOp.name || '',
    description: existingOp.description || '',
    endpoint: existingOp.endpoint || '',
    mandate: Number(existingOp.mandate),
    performanceFeePct: Number(existingOp.performanceFeeBps || 0) / 100,
    managementFeePct: Number(existingOp.managementFeeBps || 0) / 100,
    entryFeePct: Number(existingOp.entryFeeBps || 0) / 100,
    exitFeePct: Number(existingOp.exitFeeBps || 0) / 100,
    recMaxPositionPct: Number(existingOp.recommendedMaxPositionBps || 5000) / 100,
    recConfidenceMinPct: Number(existingOp.recommendedConfidenceMinBps || 6000) / 100,
    recStopLossPct: Number(existingOp.recommendedStopLossBps || 1500) / 100,
    recCooldownMin: Math.round(Number(existingOp.recommendedCooldownSeconds || 900) / 60),
    recMaxActionsPerDay: Number(existingOp.recommendedMaxActionsPerDay || 20),
  };
}

const MANDATES = [
  {
    id: 'Conservative',
    value: Mandate.Conservative,
    description: 'Capital preservation. Strict drawdown limits, high confidence threshold.',
    color: 'text-emerald-soft',
    border: 'border-emerald-soft/30',
  },
  {
    id: 'Balanced',
    value: Mandate.Balanced,
    description: 'Risk-adjusted growth. Moderate positions, balanced guardrails.',
    color: 'text-cyan',
    border: 'border-cyan/30',
  },
  {
    id: 'Tactical',
    value: Mandate.Tactical,
    description: 'Active alpha pursuit. Larger positions, wider drawdown tolerance.',
    color: 'text-gold',
    border: 'border-gold/30',
  },
];

export default function OperatorRegisterPage() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const registryAddress = deployments.operatorRegistry;

  const { data: isRegistered } = useIsRegistered(registryAddress, address);
  const { data: existingOp } = useOperator(registryAddress, isRegistered ? address : undefined);
  const { register, hash: registerHash, isPending: registering, isSuccess: registerSuccess } = useRegisterOperator();
  const { update, hash: updateHash, isPending: updating, isSuccess: updateSuccess } = useUpdateOperator();

  // ── v2: Strategy Manifest + AI commitment ──
  const { data: extended } = useOperatorExtended(registryAddress, isRegistered ? address : undefined);
  const { publish: publishManifest, hash: manifestHash, isPending: publishingManifest, isSuccess: manifestSuccess } = usePublishManifest();
  const { declare: declareAI, hash: aiHash, isPending: declaringAI, isSuccess: aiSuccess } = useDeclareAIModel();
  const { data: availableModels } = useAvailableAIModels();
  const [aiModel, setAIModel] = useState('');
  const [aiProvider, setAIProvider] = useState('');
  const [aiEndpoint, setAIEndpoint] = useState('');
  const [manifestURI, setManifestURI] = useState('');
  const [manifestJSON, setManifestJSON] = useState('');
  const [manifestBonded, setManifestBonded] = useState(true);

  // Pre-fill AI/manifest fields from on-chain extended data (after register/refresh)
  useEffect(() => {
    if (extended && isRegistered) {
      if (extended.aiModel && !aiModel) setAIModel(extended.aiModel);
      if (extended.aiProvider && extended.aiProvider !== '0x0000000000000000000000000000000000000000' && !aiProvider) {
        setAIProvider(extended.aiProvider);
      }
      if (extended.aiEndpoint && !aiEndpoint) setAIEndpoint(extended.aiEndpoint);
      if (extended.manifestURI && !manifestURI) setManifestURI(extended.manifestURI);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extended, isRegistered]);

  const computedManifestHash = manifestJSON.trim() ? keccak256(toBytes(manifestJSON.trim())) : '0x0000000000000000000000000000000000000000000000000000000000000000';

  const [draft, setDraft] = useState(null);

  // Redirect after success
  useEffect(() => {
    if (registerSuccess || updateSuccess) {
      const t = setTimeout(() => navigate('/marketplace'), 2500);
      return () => clearTimeout(t);
    }
  }, [registerSuccess, updateSuccess, navigate]);

  const form = draft || buildOperatorForm(existingOp, isRegistered);
  const updateForm = (updates) => {
    const patch = typeof updates === 'function' ? updates(form) : updates;
    setDraft({ ...form, ...patch });
  };

  const isUpdating = isRegistered;
  const submitting = registering || updating;
  const success = registerSuccess || updateSuccess;
  const canSubmit = isConnected && registryAddress && form.name.trim().length > 0 && !submitting
    && form.performanceFeePct <= 30 && form.managementFeePct <= 5 && form.entryFeePct <= 2 && form.exitFeePct <= 2;
  const remainingChars = 500 - form.description.length;
  const latestRegistryHash = updateHash || registerHash;
  const latestRegistryTxHref = getExplorerTxHref(chainId, latestRegistryHash);

  const handleSubmit = () => {
    if (!canSubmit) return;
    const input = {
      name: form.name,
      description: form.description,
      endpoint: form.endpoint,
      mandate: form.mandate,
      performanceFeeBps: Math.round(form.performanceFeePct * 100),
      managementFeeBps: Math.round(form.managementFeePct * 100),
      entryFeeBps: Math.round(form.entryFeePct * 100),
      exitFeeBps: Math.round(form.exitFeePct * 100),
      recommendedMaxPositionBps: Math.round(form.recMaxPositionPct * 100),
      recommendedConfidenceMinBps: Math.round(form.recConfidenceMinPct * 100),
      recommendedStopLossBps: Math.round(form.recStopLossPct * 100),
      recommendedCooldownSeconds: Math.round(form.recCooldownMin * 60),
      recommendedMaxActionsPerDay: Math.round(form.recMaxActionsPerDay),
    };
    if (isUpdating) {
      update(registryAddress, input);
    } else {
      register(registryAddress, input);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 lg:px-6 py-6 lg:py-8">
      {/* Header */}
      <div className="mb-8">
        <Link to="/marketplace" className="text-xs text-steel/50 hover:text-white inline-flex items-center gap-1.5 mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Marketplace
        </Link>
        <h1 className="text-2xl font-display font-semibold text-white tracking-tight mb-2">
          {isUpdating ? 'Update Operator Profile' : 'Register as Operator'}
        </h1>
        <p className="text-sm text-steel/50">
          {isUpdating
            ? 'Update your public profile in the on-chain registry.'
            : 'Publish your AI agent service on-chain. Vault owners will be able to discover and pick you as their executor.'}
        </p>
      </div>

      {/* Wallet check */}
      {!isConnected && (
        <GlassPanel className="p-6 mb-6 text-center">
          <Cpu className="w-8 h-8 text-steel/30 mx-auto mb-3" />
          <p className="text-sm text-steel/60 mb-4">Connect your operator wallet to continue.</p>
          <WalletButton />
        </GlassPanel>
      )}

      {!registryAddress && (
        <GlassPanel className="p-5 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-warn flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-white/70 mb-1">OperatorRegistry not deployed on this network.</p>
              <p className="text-[11px] text-steel/45">
                Run <code className="text-cyan/50 font-mono">npx hardhat run scripts/deploy-operator-registry.js</code>
                {' '}to deploy the registry.
              </p>
            </div>
          </div>
        </GlassPanel>
      )}

      {/* Form */}
      <GlassPanel gold className="p-6 mb-6">
        <div className="space-y-5">
          {/* Wallet */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
              Operator Wallet (your connected address)
            </label>
            <div className="px-3 py-2 rounded-md bg-obsidian/60 border border-white/[0.08] text-[11px] font-mono text-white/60 break-all">
              {address || 'Not connected'}
            </div>
            <p className="text-[10px] text-steel/35 mt-1">
              This is the wallet you'll use to call <code className="text-cyan/40">executeIntent()</code> on vaults that pick you.
            </p>
          </div>

          {/* Name */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
              Display Name *
            </label>
            <div className="relative">
              <Tag className="w-3.5 h-3.5 text-steel/30 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateForm({ name: e.target.value.slice(0, 64) })}
                placeholder="e.g. Aegis Alpha Bot"
                className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-gold/30"
              />
            </div>
            <p className="text-[10px] text-steel/35 mt-1">{form.name.length}/64 characters</p>
          </div>

          {/* Description */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
              Strategy Description
            </label>
            <div className="relative">
              <FileText className="w-3.5 h-3.5 text-steel/30 absolute left-3 top-3" />
              <textarea
                value={form.description}
                onChange={(e) => updateForm({ description: e.target.value.slice(0, 500) })}
                placeholder="Describe your AI strategy, signals, and approach..."
                rows={4}
                className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-gold/30 resize-none"
              />
            </div>
            <p className={`text-[10px] mt-1 ${remainingChars < 50 ? 'text-amber-warn/60' : 'text-steel/35'}`}>
              {remainingChars} characters remaining
            </p>
          </div>

          {/* Endpoint */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
              Public API Endpoint (optional)
            </label>
            <div className="relative">
              <Globe className="w-3.5 h-3.5 text-steel/30 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                value={form.endpoint}
                onChange={(e) => updateForm({ endpoint: e.target.value.slice(0, 200) })}
                placeholder="https://my-orchestrator.example.com"
                className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-gold/30"
              />
            </div>
            <p className="text-[10px] text-steel/35 mt-1">
              Public URL of your orchestrator (for transparency / health checks). Leave blank if you don't expose one.
            </p>
          </div>

          {/* Mandate */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-2">
              Strategy Mandate
            </label>
            <div className="grid sm:grid-cols-3 gap-2">
              {MANDATES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => updateForm({ mandate: m.value })}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    form.mandate === m.value
                      ? `${m.border} bg-white/[0.04]`
                      : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1]'
                  }`}
                >
                  <span className={`text-xs font-display font-semibold ${m.color} block mb-1`}>{m.id}</span>
                  <p className="text-[10px] text-steel/45 leading-relaxed">{m.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </GlassPanel>

      {/* ── Phase 1: Fee Structure ── */}
      <GlassPanel className="p-6 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-display font-semibold text-white">Fee Structure</span>
          <span className="text-[8px] font-mono text-gold/70 px-1 py-0.5 rounded bg-gold/10 border border-gold/20">DECLARED</span>
        </div>
        <p className="text-[11px] text-steel/45 mb-5">
          The fees vault owners pay when picking your operator. Hard-capped on-chain — values above max will be rejected.
        </p>

        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40">Performance Fee</label>
              <span className="text-sm font-mono font-semibold text-gold">{form.performanceFeePct.toFixed(2)}%</span>
            </div>
            <input
              type="range"
              min="0" max="30" step="0.5"
              value={form.performanceFeePct}
              onChange={(e) => updateForm({ performanceFeePct: Number(e.target.value) })}
              className="w-full h-1 rounded-full appearance-none cursor-pointer bg-white/[0.06] accent-gold"
            />
            <p className="text-[10px] text-steel/35 mt-1">% of profit above HWM. Industry standard: 10-20%. Max 30%.</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40">Management Fee (annual)</label>
              <span className="text-sm font-mono font-semibold text-cyan">{form.managementFeePct.toFixed(2)}%</span>
            </div>
            <input
              type="range"
              min="0" max="5" step="0.25"
              value={form.managementFeePct}
              onChange={(e) => updateForm({ managementFeePct: Number(e.target.value) })}
              className="w-full h-1 rounded-full appearance-none cursor-pointer bg-white/[0.06] accent-cyan"
            />
            <p className="text-[10px] text-steel/35 mt-1">% of NAV per year, streamed continuously. Max 5%.</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40">Entry Fee</label>
              <span className="text-sm font-mono font-semibold text-white">{form.entryFeePct.toFixed(2)}%</span>
            </div>
            <input
              type="range"
              min="0" max="2" step="0.1"
              value={form.entryFeePct}
              onChange={(e) => updateForm({ entryFeePct: Number(e.target.value) })}
              className="w-full h-1 rounded-full appearance-none cursor-pointer bg-white/[0.06] accent-gold"
            />
            <p className="text-[10px] text-steel/35 mt-1">Charged on each deposit. Max 2%.</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40">Exit Fee</label>
              <span className="text-sm font-mono font-semibold text-white">{form.exitFeePct.toFixed(2)}%</span>
            </div>
            <input
              type="range"
              min="0" max="2" step="0.1"
              value={form.exitFeePct}
              onChange={(e) => updateForm({ exitFeePct: Number(e.target.value) })}
              className="w-full h-1 rounded-full appearance-none cursor-pointer bg-white/[0.06] accent-gold"
            />
            <p className="text-[10px] text-steel/35 mt-1">Charged on each withdrawal. Max 2%.</p>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-white/[0.04] text-[11px] text-steel/45">
          <p>
            Out of every fee you collect, <strong className="text-white/65">20% goes to the protocol treasury</strong> for
            audits, grants, and bug bounties. You receive the remaining 80%.
          </p>
        </div>
      </GlassPanel>

      {/* ── Phase 1: Recommended Vault Policy ── */}
      <GlassPanel className="p-6 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-display font-semibold text-white">Recommended Vault Policy</span>
          <span className="text-[8px] font-mono text-cyan/70 px-1 py-0.5 rounded bg-cyan/5 border border-cyan/15">SUGGESTED</span>
        </div>
        <p className="text-[11px] text-steel/45 mb-5">
          The on-chain policy you suggest for vaults using your strategy. Vault owners can override these — these are just defaults the
          Create Vault flow will pre-fill when users pick you.
        </p>

        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40">Max Position Size</label>
              <span className="text-sm font-mono text-white">{form.recMaxPositionPct}%</span>
            </div>
            <input
              type="range" min="5" max="80" step="1"
              value={form.recMaxPositionPct}
              onChange={(e) => updateForm({ recMaxPositionPct: Number(e.target.value) })}
              className="w-full h-1 rounded-full appearance-none cursor-pointer bg-white/[0.06] accent-gold"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40">Min Confidence</label>
              <span className="text-sm font-mono text-white">{form.recConfidenceMinPct}%</span>
            </div>
            <input
              type="range" min="30" max="95" step="1"
              value={form.recConfidenceMinPct}
              onChange={(e) => updateForm({ recConfidenceMinPct: Number(e.target.value) })}
              className="w-full h-1 rounded-full appearance-none cursor-pointer bg-white/[0.06] accent-gold"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40">Stop-Loss</label>
              <span className="text-sm font-mono text-white">{form.recStopLossPct}%</span>
            </div>
            <input
              type="range" min="2" max="30" step="1"
              value={form.recStopLossPct}
              onChange={(e) => updateForm({ recStopLossPct: Number(e.target.value) })}
              className="w-full h-1 rounded-full appearance-none cursor-pointer bg-white/[0.06] accent-gold"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40">Cooldown (min)</label>
              <span className="text-sm font-mono text-white">{form.recCooldownMin}m</span>
            </div>
            <input
              type="range" min="1" max="60" step="1"
              value={form.recCooldownMin}
              onChange={(e) => updateForm({ recCooldownMin: Number(e.target.value) })}
              className="w-full h-1 rounded-full appearance-none cursor-pointer bg-white/[0.06] accent-gold"
            />
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40">Max Trades / Day</label>
              <span className="text-sm font-mono text-white">{form.recMaxActionsPerDay}</span>
            </div>
            <input
              type="range" min="1" max="50" step="1"
              value={form.recMaxActionsPerDay}
              onChange={(e) => updateForm({ recMaxActionsPerDay: Number(e.target.value) })}
              className="w-full h-1 rounded-full appearance-none cursor-pointer bg-white/[0.06] accent-gold"
            />
          </div>
        </div>
      </GlassPanel>

      {/* Trust info */}
      <GlassPanel className="p-4 mb-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-soft/60 flex-shrink-0 mt-0.5" />
          <div className="text-[11px] text-steel/55 leading-relaxed">
            <p className="mb-1 text-white/70">No staking required. Free registration.</p>
            <p>
              You're publishing public metadata only — no funds are escrowed. Your reputation will grow organically based on
              the on-chain executions of vaults that choose you. You can update or deactivate your profile anytime.
            </p>
          </div>
        </div>
      </GlassPanel>

      {/* Submit */}
      <div className="flex gap-3">
        <Link to="/marketplace" className="flex-1">
          <ControlButton variant="ghost" className="w-full">Cancel</ControlButton>
        </Link>
        <ControlButton
          variant="primary"
          className="flex-1"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting
            ? (isUpdating ? 'Updating...' : 'Registering...')
            : success
              ? 'Success! Redirecting...'
              : (isUpdating ? 'Update Profile' : 'Register Operator')
          }
        </ControlButton>
      </div>

      {success && (
        <div className="mt-4 text-center">
          <StatusPill label="On-chain confirmed" variant="active" />
          {latestRegistryTxHref && (
            <div className="mt-2">
              <ExplorerAnchor
                href={latestRegistryTxHref}
                label={`Tx ${shortHexLabel(latestRegistryHash, 10, 6)}`}
                className="text-[10px] font-mono text-cyan/60 hover:text-cyan transition-colors"
              />
            </div>
          )}
        </div>
      )}

      {/* ── v2: Strategy Manifest + AI Commitment (only after register) ── */}
      {isRegistered && (
        <>
          <div className="mt-10 mb-4 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-gold" />
            <h2 className="text-base font-display font-semibold text-white">Strategy & AI Commitments</h2>
            <StatusPill label="v2" variant="info" />
          </div>
          <p className="text-[11px] text-steel/50 mb-4">
            Optional but recommended: publicly commit to which AI model you use and what your strategy rules are.
            Vault owners filter operators by this. Bonded manifests are slashable if execution deviates from the rules.
          </p>

          {/* AI Model Declaration */}
          <GlassPanel className="p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="w-4 h-4 text-cyan" />
              <h3 className="text-sm font-display font-semibold text-white">AI Model Commitment</h3>
              {extended?.aiModel && <StatusPill label="Declared" variant="active" />}
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                  Model (from 0G Compute network)
                </label>
                <select
                  value={aiModel}
                  onChange={(e) => {
                    setAIModel(e.target.value);
                    const m = availableModels?.models?.find(x => x.model === e.target.value);
                    if (m) {
                      setAIProvider(m.provider);
                      setAIEndpoint(m.url);
                    }
                  }}
                  className="w-full px-3 py-2 rounded-md bg-obsidian/60 border border-white/[0.08] text-xs font-mono text-white"
                >
                  <option value="">— Select a model —</option>
                  {availableModels?.models?.map((m) => (
                    <option key={`${m.model}-${m.provider}`} value={m.model}>
                      {m.model} ({m.provider.slice(0, 10)}...)
                    </option>
                  ))}
                </select>
                {!availableModels?.models?.length && (
                  <p className="mt-1.5 text-[10px] text-amber-warn/60">
                    Cannot fetch model list — orchestrator API unavailable. You can still type a model name manually below.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                    Provider Address
                  </label>
                  <input
                    type="text"
                    value={aiProvider}
                    onChange={(e) => setAIProvider(e.target.value.trim())}
                    placeholder="0x..."
                    className="w-full px-3 py-2 rounded-md bg-obsidian/60 border border-white/[0.08] text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                    Endpoint URL (optional)
                  </label>
                  <input
                    type="text"
                    value={aiEndpoint}
                    onChange={(e) => setAIEndpoint(e.target.value.trim())}
                    placeholder="https://..."
                    className="w-full px-3 py-2 rounded-md bg-obsidian/60 border border-white/[0.08] text-xs font-mono text-white"
                  />
                </div>
              </div>

              <ControlButton
                variant="gold"
                className="w-full"
                disabled={!aiModel || !aiProvider || declaringAI}
                onClick={() => declareAI(registryAddress, { aiModel, aiProvider, aiEndpoint })}
              >
                {declaringAI ? 'Declaring on-chain...' : aiSuccess ? 'Declared ✓' : 'Declare AI Model'}
              </ControlButton>
            </div>
          </GlassPanel>

          {/* Strategy Manifest */}
          <GlassPanel className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-gold" />
              <h3 className="text-sm font-display font-semibold text-white">Strategy Manifest</h3>
              {extended?.manifestURI && <StatusPill label={`v${Number(extended.manifestVersion || 0)}`} variant="active" />}
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                  Manifest URI (IPFS / 0G Storage / HTTPS)
                </label>
                <input
                  type="text"
                  value={manifestURI}
                  onChange={(e) => setManifestURI(e.target.value.trim())}
                  placeholder="ipfs://Qm... or https://your-domain.com/manifest.json"
                  className="w-full px-3 py-2 rounded-md bg-obsidian/60 border border-white/[0.08] text-xs font-mono text-white"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                  Manifest JSON content (paste full JSON — hash auto-computed)
                </label>
                <textarea
                  value={manifestJSON}
                  onChange={(e) => setManifestJSON(e.target.value)}
                  rows={6}
                  placeholder='{ "strategy": { "name": "Momentum Breakout", "type": "trend_following", ... } }'
                  className="w-full px-3 py-2 rounded-md bg-obsidian/60 border border-white/[0.08] text-[11px] font-mono text-white"
                />
                <p className="mt-1.5 text-[10px] text-steel/40">
                  Computed hash: <span className="font-mono text-cyan/60">{computedManifestHash.slice(0, 18)}...{computedManifestHash.slice(-8)}</span>
                </p>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-steel/60">
                <input
                  type="checkbox"
                  checked={manifestBonded}
                  onChange={(e) => setManifestBonded(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span><strong className="text-gold">Bonded:</strong> stake my reputation on this manifest. Governance can slash me if executions deviate.</span>
              </label>

              <ControlButton
                variant="gold"
                className="w-full"
                disabled={!manifestURI || !manifestJSON.trim() || publishingManifest}
                onClick={() => publishManifest(registryAddress, {
                  uri: manifestURI,
                  hash: computedManifestHash,
                  bonded: manifestBonded,
                })}
              >
                {publishingManifest ? 'Publishing on-chain...' : manifestSuccess ? 'Published ✓' : 'Publish Manifest'}
              </ControlButton>
            </div>
          </GlassPanel>
        </>
      )}
    </div>
  );
}
