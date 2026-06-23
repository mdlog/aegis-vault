import { createElement, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { toast } from 'sonner';
import { getDeployments, getExplorerTxHref, shortHexLabel, findDeploymentChainId } from '../lib/contracts';
import {
  useIsRegistered, useOperator, useRegisterOperator, useUpdateOperator, Mandate,
  useOperatorExtended, usePublishManifest, useDeclareAIModel,
} from '../hooks/useOperatorRegistry';
import { useAvailableAIModels } from '../hooks/useOrchestrator';
import { estimateAnnualFees } from '../hooks/useVaultFees';
import { keccak256, toBytes } from 'viem';
import { canonicalizeJson } from '../hooks/useOperatorStrategy';
import GlassPanel from '../components/ui/GlassPanel';
import ControlButton from '../components/ui/ControlButton';
import StatusPill from '../components/ui/StatusPill';
import WalletButton from '../components/ui/WalletButton';
import ExplorerAnchor from '../components/ui/ExplorerAnchor';
import NetworkWarning from '../components/ui/NetworkWarning';
import ConfirmModal from '../components/ui/ConfirmModal';
import { useDraftState } from '../lib/useDraftState';
import { parseTxError } from '../lib/txErrors';
import { deriveTxPhase, TX_PHASE_LABELS } from '../lib/txPhase';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Cpu,
  FileText,
  Globe,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Tag,
} from 'lucide-react';

// Fallback model roster — known-good chatbot services on 0G Compute mainnet.
// Used when the orchestrator API is unreachable so operators can still pick a
// real model. Live discovery via broker.inference.listService() supersedes
// this list whenever the orchestrator is online (see useAvailableAIModels).
//
// Captured 2026-05-08 from broker.inference.listService() on chain ID 16661.
// All entries had teeSignerAcknowledged === true on capture; verifiability
// is the on-chain `verifiability` field (TeeML / TeeTLS) and teeVerifier
// comes from the additionalInfo JSON. Speech-to-text (whisper) and
// text-to-image (z-image) are intentionally excluded — vault inference
// pipeline is chatbot-only. Refresh by running:
//   orchestrator/scripts/router-spike/04-direct-list-services.mjs
const FALLBACK_OG_COMPUTE_MODELS = [
  {
    model: 'zai-org/GLM-5.1-FP8',
    provider: '0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D',
    url: 'https://compute-network-19.integratenetwork.work',
    verifiability: 'TeeML',
    teeAcknowledged: true,
    teeVerifier: 'dstack',
  },
  {
    model: 'zai-org/GLM-5-FP8',
    provider: '0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C',
    url: 'https://compute-network-1.integratenetwork.work',
    verifiability: 'TeeML',
    teeAcknowledged: true,
    teeVerifier: 'dstack',
  },
  {
    model: 'deepseek/deepseek-chat-v3-0324',
    provider: '0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0',
    url: 'https://compute-network-4.integratenetwork.work',
    verifiability: 'TeeML',
    teeAcknowledged: true,
    teeVerifier: 'dstack',
  },
  {
    model: 'qwen/qwen3-vl-30b-a3b-instruct',
    provider: '0x4415ef5CBb415347bb18493af7cE01f225Fc0868',
    url: 'https://compute-network-3.integratenetwork.work',
    verifiability: 'TeeML',
    teeAcknowledged: true,
    teeVerifier: 'dstack',
  },
  {
    model: 'qwen3.6-plus',
    provider: '0x992e6396157Dc4f22E74F2231235D7DE62696db5',
    url: 'https://compute-network-18.integratenetwork.work',
    verifiability: 'TeeML',
    teeAcknowledged: true,
    teeVerifier: 'dstack',
  },
  {
    model: 'openai/gpt-5.4-mini',
    provider: '0x25F8f01cA76060ea40895472b1b79f76613Ca497',
    url: 'https://5259ae0f38365b27c0bab6301b73691206e32dce-80.dstack-pha-prod5.phala.network',
    verifiability: 'TeeML',
    teeAcknowledged: true,
    teeVerifier: 'dstack',
  },
];

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
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const registryAddress = deployments.operatorRegistryV2 || deployments.operatorRegistry;
  const registryChainId = findDeploymentChainId('operatorRegistryV2')
    || findDeploymentChainId('operatorRegistry');

  const { data: isRegistered } = useIsRegistered(registryAddress, address);
  const { data: existingOp } = useOperator(registryAddress, isRegistered ? address : undefined);
  const {
    register,
    hash: registerHash,
    isPending: registering,
    isConfirming: registerConfirming,
    isSuccess: registerSuccess,
    error: registerError,
  } = useRegisterOperator();
  const {
    update,
    hash: updateHash,
    isPending: updating,
    isConfirming: updateConfirming,
    isSuccess: updateSuccess,
    error: updateError,
  } = useUpdateOperator();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ── v2: Strategy Manifest + AI commitment ──
  const { data: extended } = useOperatorExtended(registryAddress, isRegistered ? address : undefined);
  const {
    publish: publishManifest,
    isPending: publishingManifest,
    isSuccess: manifestSuccess,
    error: manifestError,
  } = usePublishManifest();
  const {
    declare: declareAI,
    isPending: declaringAI,
    isSuccess: aiSuccess,
    error: aiError,
  } = useDeclareAIModel();
  const { data: availableModels } = useAvailableAIModels();
  const [aiModel, setAIModel] = useState('');
  const [aiProvider, setAIProvider] = useState('');
  const [aiEndpoint, setAIEndpoint] = useState('');
  const [manifestURI, setManifestURI] = useState('');
  const [manifestJSON, setManifestJSON] = useState('');
  const [manifestBonded, setManifestBonded] = useState(true);

  // Real-time manifest JSON validation: parse on every keystroke and surface
  // a friendly error so users don't waste a chain call on invalid JSON.
  const manifestValidation = useMemo(() => {
    const trimmed = manifestJSON.trim();
    if (!trimmed) return { valid: false, empty: true, error: null };
    try {
      JSON.parse(trimmed);
      return { valid: true, empty: false, error: null };
    } catch (err) {
      return { valid: false, empty: false, error: err.message };
    }
  }, [manifestJSON]);

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

  // The on-chain hash MUST be computed from the canonical-JSON form of the
  // parsed manifest, not the raw user-typed text. The verifier (orchestrator
  // loader, SDK, useOperatorStrategy) recomputes via canonicalizeJson before
  // comparing — hashing the raw text means any whitespace or key reordering
  // makes the manifest unverifiable forever after publish.
  const computedManifestHash = useMemo(() => {
    const trimmed = manifestJSON.trim();
    if (!trimmed) return '0x0000000000000000000000000000000000000000000000000000000000000000';
    try {
      const parsed = JSON.parse(trimmed);
      const canonical = canonicalizeJson(parsed);
      return keccak256(toBytes(canonical));
    } catch {
      return '0x0000000000000000000000000000000000000000000000000000000000000000';
    }
  }, [manifestJSON]);

  // Per-wallet draft so different operators can keep their own work-in-progress.
  const draftKey = `draft:operator-register:v1:${address || 'anon'}`;
  const [draft, setDraft, { clearDraft, hasDraft }] = useDraftState(
    draftKey,
    DEFAULT_OPERATOR_FORM,
  );
  // Once on-chain data arrives for an existing operator, hydrate the form
  // (only on first load — subsequent edits live in the draft).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!hydrated && existingOp && isRegistered && !hasDraft) {
      setDraft(buildOperatorForm(existingOp, isRegistered));
      setHydrated(true);
    } else if (!hydrated && !isRegistered) {
      setHydrated(true);
    }
  }, [existingOp, isRegistered, hasDraft, hydrated, setDraft]);

  const form = draft;
  const updateForm = (updates) => {
    const patch = typeof updates === 'function' ? updates(draft) : updates;
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const isUpdating = isRegistered;
  const submitting = registering || updating;
  const success = registerSuccess || updateSuccess;
  const feeCapsValid =
    form.performanceFeePct <= 30 &&
    form.managementFeePct <= 5 &&
    form.entryFeePct <= 2 &&
    form.exitFeePct <= 2;
  const canSubmit = isConnected && registryAddress && form.name.trim().length > 0
    && !submitting && feeCapsValid;
  const remainingChars = 500 - form.description.length;
  const latestRegistryHash = updateHash || registerHash;
  const latestRegistryTxHref = getExplorerTxHref(chainId, latestRegistryHash);
  const selectedMandate = MANDATES.find((item) => item.value === form.mandate) || MANDATES[1];
  const feePreview = estimateAnnualFees(10_000, form.performanceFeePct * 100, form.managementFeePct * 100, 10);
  const checklist = [
    { label: 'Connected wallet', done: isConnected },
    { label: 'Registry available', done: !!registryAddress },
    { label: 'Display name', done: form.name.trim().length > 0 },
    { label: 'Fee caps valid', done: feeCapsValid },
  ];
  const checklistDone = checklist.filter((item) => item.done).length;

  // Per-fee cap flags drive inline warnings on the slider rows.
  const feeFlags = {
    performance: form.performanceFeePct > 30,
    management: form.managementFeePct > 5,
    entry: form.entryFeePct > 2,
    exit: form.exitFeePct > 2,
  };

  // Granular tx phase for the active write (register vs update).
  const activeWrite = isUpdating
    ? { isPending: updating, isConfirming: updateConfirming, isSuccess: updateSuccess, hash: updateHash, error: updateError }
    : { isPending: registering, isConfirming: registerConfirming, isSuccess: registerSuccess, hash: registerHash, error: registerError };
  const txPhase = deriveTxPhase(activeWrite);

  // Error toasts: surface viem reverts in human language, once per error.
  useEffect(() => {
    if (!registerError && !updateError) return;
    const parsed = parseTxError(registerError || updateError);
    if (!parsed) return;
    if (parsed.isUserReject) {
      toast.info(parsed.title, { description: parsed.message });
    } else {
      toast.error(parsed.title, { description: parsed.message, duration: 8000 });
    }
  }, [registerError, updateError]);

  useEffect(() => {
    if (!manifestError) return;
    const parsed = parseTxError(manifestError);
    if (parsed) toast.error(`Manifest: ${parsed.title}`, { description: parsed.message });
  }, [manifestError]);

  useEffect(() => {
    if (!aiError) return;
    const parsed = parseTxError(aiError);
    if (parsed) toast.error(`AI model: ${parsed.title}`, { description: parsed.message });
  }, [aiError]);

  // Success toasts (one shot per confirm).
  useEffect(() => {
    if (registerSuccess) toast.success('Operator registered on-chain');
  }, [registerSuccess]);
  useEffect(() => {
    if (updateSuccess) toast.success('Operator profile updated');
  }, [updateSuccess]);
  useEffect(() => {
    if (manifestSuccess) toast.success('Manifest published on-chain');
  }, [manifestSuccess]);
  useEffect(() => {
    if (aiSuccess) toast.success('AI model commitment declared');
  }, [aiSuccess]);

  // Clear draft once the on-chain write confirms — keeps the next session clean.
  useEffect(() => {
    if (registerSuccess || updateSuccess) clearDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerSuccess, updateSuccess]);

  const buildInput = () => ({
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
  });

  const handleSubmit = () => {
    if (!canSubmit) return;
    setConfirmOpen(true);
  };

  const executeSubmit = () => {
    setConfirmOpen(false);
    const input = buildInput();
    if (isUpdating) {
      update(registryAddress, input);
    } else {
      register(registryAddress, input);
    }
  };

  return (
    <div className="max-w-[1540px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      <Link to="/marketplace" className="text-xs text-steel/50 hover:text-white inline-flex items-center gap-1.5 mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Marketplace
      </Link>

      <GlassPanel gold className="relative overflow-hidden p-6 lg:p-7 mb-6">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 right-0 h-64 w-64 rounded-full bg-gold/12 blur-3xl" />
          <div className="absolute bottom-0 left-10 h-48 w-48 rounded-full bg-cyan/10 blur-3xl" />
        </div>

        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[10px] font-mono uppercase tracking-[0.2em] text-steel/55">
              <Sparkles className="w-3 h-3 text-gold/70" />
              Operator Onboarding
            </div>

            <h1 className="mt-4 text-3xl lg:text-[2.1rem] font-display font-semibold text-white tracking-tight">
              {isUpdating ? 'Update Operator Profile' : 'Register as Operator'}
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-steel/58 leading-relaxed">
              {isUpdating
                ? 'Edit your public profile, fee schedule, and default vault settings.'
                : 'Save your core marketplace profile first. After it is live, you can optionally add AI and strategy commitments.'}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill label="1 Profile" variant="gold" />
              <StatusPill label="2 Fees" variant="info" />
              <StatusPill label="3 Defaults" variant="active" />
              <StatusPill label="4 Commitments Later" variant="paused" />
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-steel/45 mb-3">
              This Save Publishes
            </div>
            <div className="space-y-3 text-[12px] text-steel/58">
              <HeroRow
                icon={Tag}
                title="Public profile"
                description="Name, strategy summary, endpoint, and mandate."
              />
              <HeroRow
                icon={ShieldCheck}
                title="Fee schedule"
                description="Performance, management, entry, and exit fees."
              />
              <HeroRow
                icon={FileText}
                title="Vault defaults"
                description="The starting policy users see in Create Vault."
              />
            </div>
            <div className="mt-4 rounded-xl border border-emerald-soft/12 bg-emerald-soft/[0.06] px-3 py-3 text-[11px] text-emerald-soft/80">
              No stake required to register.
            </div>
          </div>
        </div>
      </GlassPanel>

      {!isConnected && (
        <GlassPanel className="p-6 mb-6 text-center">
          <Cpu className="w-8 h-8 text-steel/30 mx-auto mb-3" />
          <p className="text-sm text-steel/60 mb-4">Connect your operator wallet to continue.</p>
          <div className="flex justify-center">
            <WalletButton />
          </div>
        </GlassPanel>
      )}

      {isConnected && (
        <NetworkWarning
          requiredAddress={registryAddress}
          expectedChainId={registryChainId}
          contractName="Operator Registry"
        />
      )}

      {hasDraft && !isRegistered && !success && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-cyan/20 bg-cyan/[0.04] px-4 py-2.5">
          <div className="flex items-center gap-2 text-[11px] text-cyan/80">
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Draft auto-saved. You can leave and come back.</span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Discard saved draft and reset the form?')) clearDraft();
            }}
            className="text-[10px] font-mono uppercase tracking-wide text-steel/55 hover:text-white transition-colors"
          >
            Reset draft
          </button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <StepSection
            step="1"
            title="Profile Basics"
            description="Required fields shown in the marketplace."
          >
            <div className="grid gap-5">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                  Operator Wallet
                </label>
                <div className="px-3 py-2 rounded-md bg-obsidian/60 border border-white/[0.08] text-[11px] font-mono text-white/60 break-all">
                  {address || 'Not connected'}
                </div>
                <p className="text-[10px] text-steel/35 mt-1">
                  This connected address becomes your operator identity.
                </p>
              </div>

              <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-5">
                <div className="space-y-5">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                      Display Name *
                    </label>
                    <div className="relative">
                      <Tag className="w-3.5 h-3.5 text-steel/30 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={form.name}
                        onChange={(event) => updateForm({ name: event.target.value.slice(0, 64) })}
                        placeholder="e.g. Aegis Alpha Bot"
                        className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-gold/30"
                      />
                    </div>
                    <p className="text-[10px] text-steel/35 mt-1">{form.name.length}/64 characters</p>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                      Strategy Description
                    </label>
                    <div className="relative">
                      <FileText className="w-3.5 h-3.5 text-steel/30 absolute left-3 top-3" />
                      <textarea
                        value={form.description}
                        onChange={(event) => updateForm({ description: event.target.value.slice(0, 500) })}
                        placeholder="Briefly describe your strategy and edge."
                        rows={4}
                        className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-gold/30 resize-none"
                      />
                    </div>
                    <p className={`text-[10px] mt-1 ${remainingChars < 50 ? 'text-amber-warn/60' : 'text-steel/35'}`}>
                      {remainingChars} characters remaining
                    </p>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                      Public API Endpoint
                    </label>
                    <div className="relative">
                      <Globe className="w-3.5 h-3.5 text-steel/30 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="url"
                        value={form.endpoint}
                        onChange={(event) => updateForm({ endpoint: event.target.value.slice(0, 200) })}
                        placeholder="https://my-orchestrator.example.com"
                        className="w-full bg-obsidian/60 border border-white/[0.08] rounded-md pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-gold/30"
                      />
                    </div>
                    <p className="text-[10px] text-steel/35 mt-1">Optional, but useful for transparency.</p>
                  </div>
                </div>

                <div>
                  <fieldset>
                    <legend className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-2">
                      Strategy Mandate
                    </legend>
                    <div className="space-y-2" role="radiogroup" aria-label="Strategy mandate">
                      {MANDATES.map((item) => {
                        const checked = form.mandate === item.value;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            onClick={() => updateForm({ mandate: item.value })}
                            className={`w-full text-left p-3 rounded-lg border transition-all ${
                              checked
                                ? `${item.border} bg-white/[0.04]`
                                : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1]'
                            }`}
                          >
                            <span className={`text-xs font-display font-semibold ${item.color} block mb-1`}>{item.id}</span>
                            <p className="text-[10px] text-steel/45 leading-relaxed">{item.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                  <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3">
                    <div className={`text-[11px] font-display font-semibold ${selectedMandate.color}`}>{selectedMandate.id}</div>
                    <p className="text-[10px] text-steel/45 mt-1">This badge is shown on your marketplace card.</p>
                  </div>
                </div>
              </div>
            </div>
          </StepSection>

          <StepSection
            step="2"
            title="Fee Structure"
            description="Declared on-chain. Hard caps apply."
          >
            <div className="grid sm:grid-cols-2 gap-5">
              <SliderField
                label="Performance Fee"
                value={form.performanceFeePct}
                valueLabel={`${form.performanceFeePct.toFixed(2)}%`}
                onChange={(value) => updateForm({ performanceFeePct: value })}
                min={0}
                max={30}
                step={0.5}
                accent="accent-gold"
                valueClassName="text-gold"
                hint="On profit above HWM. Max 30%."
                warning={feeFlags.performance}
                warningMessage="Above 30% protocol cap"
              />
              <SliderField
                label="Management Fee"
                value={form.managementFeePct}
                valueLabel={`${form.managementFeePct.toFixed(2)}%`}
                onChange={(value) => updateForm({ managementFeePct: value })}
                min={0}
                max={5}
                step={0.25}
                accent="accent-cyan"
                valueClassName="text-cyan"
                hint="Annualized. Max 5%."
                warning={feeFlags.management}
                warningMessage="Above 5% protocol cap"
              />
              <SliderField
                label="Entry Fee"
                value={form.entryFeePct}
                valueLabel={`${form.entryFeePct.toFixed(2)}%`}
                onChange={(value) => updateForm({ entryFeePct: value })}
                min={0}
                max={2}
                step={0.1}
                accent="accent-gold"
                hint="Per deposit. Max 2%."
                warning={feeFlags.entry}
                warningMessage="Above 2% protocol cap"
              />
              <SliderField
                label="Exit Fee"
                value={form.exitFeePct}
                valueLabel={`${form.exitFeePct.toFixed(2)}%`}
                onChange={(value) => updateForm({ exitFeePct: value })}
                min={0}
                max={2}
                step={0.1}
                accent="accent-gold"
                hint="Per withdrawal. Max 2%."
                warning={feeFlags.exit}
                warningMessage="Above 2% protocol cap"
              />
            </div>

            <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[11px] text-steel/50">
              Protocol treasury keeps <strong className="text-white/70">20%</strong> of fees. You receive the other <strong className="text-white/70">80%</strong>.
            </div>
          </StepSection>

          <StepSection
            step="3"
            title="Suggested Vault Defaults"
            description="Pre-fills the Create Vault form when a user picks you as their operator. Most of these values become hard on-chain caps once the user confirms — see badges per field."
          >
            <div className="mb-4 p-3.5 rounded-md border border-amber-400/20 bg-amber-400/[0.04]">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-300/90 mt-0.5 flex-shrink-0" />
                <div className="text-[11.5px] text-steel/70 leading-relaxed">
                  <strong className="text-amber-200/95">These are pre-fills, but most are also hard caps.</strong> When a vault owner accepts your defaults (or sets their own values), Max Position, Min Confidence, Cooldown, and Max Trades are sealed into the vault's on-chain policy and enforced by the contract on every execution. Stop-Loss is the only field below that stays off-chain (enforced by your orchestrator risk veto). Existing vaults are NOT migrated when you update these values — your edits only affect future vault creations.
                </div>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-5">
              <SliderField
                label={(<span>Max Position Size <HardCapBadge title="Sealed into vault.policy.maxPositionBps and enforced on-chain — every executeIntent / acceptCrossChainFill must satisfy intent.amountIn ≤ totalDeposited × this %." /></span>)}
                value={form.recMaxPositionPct}
                valueLabel={`${form.recMaxPositionPct}%`}
                onChange={(value) => updateForm({ recMaxPositionPct: value })}
                min={5}
                max={80}
                step={1}
                accent="accent-gold"
              />
              <SliderField
                label={(<span>Min Confidence <HardCapBadge title="Sealed into vault.policy.confidenceThresholdBps. Both the contract gate and the orchestrator engine derive thresholds from this single knob — strict vault → strict engine." /></span>)}
                value={form.recConfidenceMinPct}
                valueLabel={`${form.recConfidenceMinPct}%`}
                onChange={(value) => updateForm({ recConfidenceMinPct: value })}
                min={30}
                max={95}
                step={1}
                accent="accent-gold"
              />
              <SliderField
                label={(<span>Stop-Loss <SoftBadge title="Off-chain only: enforced by the orchestrator's risk veto, not the vault contract. Your value is advisory — vault owners get a pre-fill but the on-chain policy does not act on it." /></span>)}
                value={form.recStopLossPct}
                valueLabel={`${form.recStopLossPct}%`}
                onChange={(value) => updateForm({ recStopLossPct: value })}
                min={2}
                max={30}
                step={1}
                accent="accent-gold"
              />
              <SliderField
                label={(<span>Cooldown <HardCapBadge title="Sealed into vault.policy.cooldownSeconds and enforced on-chain — execution reverts until block.timestamp ≥ lastExecutionTime + this value." /></span>)}
                value={form.recCooldownMin}
                valueLabel={`${form.recCooldownMin}m`}
                onChange={(value) => updateForm({ recCooldownMin: value })}
                min={1}
                max={60}
                step={1}
                accent="accent-gold"
              />
              <div className="sm:col-span-2">
                <SliderField
                  label={(<span>Max Trades / Day <HardCapBadge title="Sealed into vault.policy.maxActionsPerDay and enforced on-chain over a rolling 24-hour window — execution reverts past this count." /></span>)}
                  value={form.recMaxActionsPerDay}
                  valueLabel={`${form.recMaxActionsPerDay}`}
                  onChange={(value) => updateForm({ recMaxActionsPerDay: value })}
                  min={1}
                  max={50}
                  step={1}
                  accent="accent-gold"
                />
              </div>
            </div>
          </StepSection>

          {!isRegistered ? (
            <GlassPanel className="p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-gold/70 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-gold/70 mb-1">
                    Step 4 Unlocks After Save
                  </div>
                  <p className="text-[12px] text-steel/55 leading-relaxed">
                    After the first save, you can optionally declare an AI model and publish a strategy manifest.
                  </p>
                </div>
              </div>
            </GlassPanel>
          ) : (
            <StepSection
              step="4"
              title="Optional Commitments"
              description="Add extra trust signals after your profile is live."
            >
              <div className="grid xl:grid-cols-2 gap-4">
                <GlassPanel className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Cpu className="w-4 h-4 text-cyan" />
                    <h3 className="text-sm font-display font-semibold text-white">AI Model</h3>
                    {extended?.aiModel && <StatusPill label="Declared" variant="active" />}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                        Model
                      </label>
                      {(() => {
                        const liveModels = availableModels?.models || [];
                        const isLive = liveModels.length > 0;
                        const modelList = isLive ? liveModels : FALLBACK_OG_COMPUTE_MODELS;
                        const isCustom =
                          aiModel && !modelList.some((m) => m.model === aiModel);
                        return (
                          <>
                            <select
                              value={isCustom ? '__custom__' : aiModel}
                              onChange={(event) => {
                                const value = event.target.value;
                                if (value === '__custom__') {
                                  setAIModel('');
                                  setAIProvider('');
                                  setAIEndpoint('');
                                  return;
                                }
                                setAIModel(value);
                                const match = modelList.find((m) => m.model === value);
                                if (match) {
                                  setAIProvider(match.provider || '');
                                  setAIEndpoint(match.url || '');
                                }
                              }}
                              className="w-full px-3 py-2 rounded-md bg-obsidian/60 border border-white/[0.08] text-xs font-mono text-white cursor-pointer"
                            >
                              <option value="">— Select a 0G Compute model —</option>
                              {modelList.map((m) => {
                                // Inline TEE flavor cue so operators can see
                                // the attestation kind without leaving the
                                // dropdown. Falls back to "manual provider"
                                // marker only when both are missing.
                                const v = m.verifiability ? ` · ${m.verifiability}` : '';
                                const ack = m.teeAcknowledged === false ? ' · TEE!ack' : '';
                                const noProv = !m.provider ? ' (manual provider)' : '';
                                return (
                                  <option key={`${m.model}-${m.provider || 'no-prov'}`} value={m.model}>
                                    {m.model}{v}{ack}{noProv}
                                  </option>
                                );
                              })}
                              <option value="__custom__">✎ Custom model…</option>
                            </select>

                            {isCustom && (
                              <input
                                type="text"
                                value={aiModel}
                                onChange={(event) => setAIModel(event.target.value)}
                                placeholder="org/model-name"
                                className="mt-2 w-full px-3 py-2 rounded-md bg-obsidian/60 border border-white/[0.08] text-xs font-mono text-white"
                              />
                            )}

                            {(() => {
                              // TEE provenance card for the currently selected
                              // model. Only renders when we have metadata for
                              // it (live API entries always do; custom entries
                              // skip the card).
                              const selected = modelList.find((m) => m.model === aiModel);
                              if (!selected || !selected.verifiability) return null;
                              const ackOk = selected.teeAcknowledged !== false;
                              return (
                                <div
                                  className={`mt-2 rounded-md border px-3 py-2 text-[10px] font-mono ${
                                    ackOk
                                      ? 'border-emerald-soft/30 bg-emerald-soft/5 text-emerald-soft'
                                      : 'border-amber-400/40 bg-amber-400/5 text-amber-300'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="uppercase tracking-wider opacity-80">
                                      TEE provenance
                                    </span>
                                    <span>
                                      {ackOk ? 'On-chain ack ✓' : 'Unacknowledged ✗'}
                                    </span>
                                  </div>
                                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 opacity-90">
                                    <span>Verifiability:</span>
                                    <span className="text-right">{selected.verifiability}</span>
                                    {selected.teeVerifier && (
                                      <>
                                        <span>Verifier:</span>
                                        <span className="text-right">{selected.teeVerifier}</span>
                                      </>
                                    )}
                                    {selected.teeSignerAddress && (
                                      <>
                                        <span>Signer:</span>
                                        <span className="text-right truncate">
                                          {selected.teeSignerAddress.slice(0, 10)}…{selected.teeSignerAddress.slice(-4)}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                            <p className="mt-1.5 text-[10px] text-steel/50">
                              {isLive
                                ? `${liveModels.length} live TEE-acknowledged model${liveModels.length === 1 ? '' : 's'} from 0G Compute mainnet.`
                                : 'Showing known 0G Compute mainnet roster (orchestrator offline — provider addresses may need manual entry).'}
                            </p>
                          </>
                        );
                      })()}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                          Provider
                        </label>
                        <input
                          type="text"
                          value={aiProvider}
                          onChange={(event) => setAIProvider(event.target.value.trim())}
                          placeholder="0x..."
                          className="w-full px-3 py-2 rounded-md bg-obsidian/60 border border-white/[0.08] text-xs font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                          Endpoint
                        </label>
                        <input
                          type="text"
                          value={aiEndpoint}
                          onChange={(event) => setAIEndpoint(event.target.value.trim())}
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
                      {declaringAI ? 'Declaring...' : aiSuccess ? 'Declared' : 'Declare AI Model'}
                    </ControlButton>
                  </div>
                </GlassPanel>

                <GlassPanel className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="w-4 h-4 text-gold" />
                    <h3 className="text-sm font-display font-semibold text-white">Strategy Manifest</h3>
                    {extended?.manifestURI && <StatusPill label={`v${Number(extended.manifestVersion || 0)}`} variant="active" />}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                        Manifest URI
                      </label>
                      <input
                        type="text"
                        value={manifestURI}
                        onChange={(event) => setManifestURI(event.target.value.trim())}
                        placeholder="ipfs://... or https://..."
                        className="w-full px-3 py-2 rounded-md bg-obsidian/60 border border-white/[0.08] text-xs font-mono text-white"
                      />
                    </div>

                    <div>
                      <label htmlFor="manifest-json" className="text-[10px] font-mono uppercase tracking-wider text-steel/40 block mb-1.5">
                        Manifest JSON
                      </label>
                      <textarea
                        id="manifest-json"
                        value={manifestJSON}
                        onChange={(event) => setManifestJSON(event.target.value)}
                        rows={6}
                        spellCheck={false}
                        aria-invalid={manifestJSON.length > 0 && !manifestValidation.valid}
                        placeholder='{ "strategy": { "name": "Momentum Breakout" } }'
                        className={`w-full px-3 py-2 rounded-md bg-obsidian/60 border text-[11px] font-mono text-white focus:outline-none ${
                          manifestJSON.length > 0 && !manifestValidation.valid
                            ? 'border-red-warn/40 focus:border-red-warn/60'
                            : manifestValidation.valid
                              ? 'border-emerald-soft/30 focus:border-emerald-soft/50'
                              : 'border-white/[0.08] focus:border-gold/30'
                        }`}
                      />
                      {manifestJSON.length > 0 && !manifestValidation.valid && (
                        <p className="mt-1.5 text-[10px] text-red-warn flex items-center gap-1">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          Invalid JSON — {manifestValidation.error}
                        </p>
                      )}
                      {manifestValidation.valid && (
                        <p className="mt-1.5 text-[10px] text-emerald-soft/70 flex items-center gap-1">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          Valid JSON
                        </p>
                      )}
                      <p className="mt-1.5 text-[10px] text-steel/40">
                        Hash <span className="font-mono text-cyan/60">{computedManifestHash.slice(0, 18)}...{computedManifestHash.slice(-8)}</span>
                      </p>
                    </div>

                    <label className="flex items-center gap-2 text-[11px] text-steel/60">
                      <input
                        type="checkbox"
                        checked={manifestBonded}
                        onChange={(event) => setManifestBonded(event.target.checked)}
                        className="w-4 h-4 rounded"
                      />
                      <span>Bonded manifest</span>
                    </label>

                    <ControlButton
                      variant="gold"
                      className="w-full"
                      disabled={!manifestURI || !manifestValidation.valid || publishingManifest}
                      onClick={() => publishManifest(registryAddress, {
                        uri: manifestURI,
                        hash: computedManifestHash,
                        bonded: manifestBonded,
                      })}
                    >
                      {publishingManifest ? 'Publishing...' : manifestSuccess ? 'Published' : 'Publish Manifest'}
                    </ControlButton>
                  </div>
                </GlassPanel>
              </div>
            </StepSection>
          )}
        </div>

        <div className="space-y-6 xl:sticky xl:top-24 self-start">
          <GlassPanel className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-display font-semibold text-white">Publishing Checklist</div>
                <p className="text-[11px] text-steel/45 mt-1">Complete these before saving.</p>
              </div>
              <StatusPill
                label={`${checklistDone}/${checklist.length}`}
                variant={canSubmit ? 'active' : 'paused'}
              />
            </div>

            <div className="space-y-2">
              {checklist.map((item) => (
                <ChecklistItem key={item.label} label={item.label} done={item.done} />
              ))}
            </div>
          </GlassPanel>

          <GlassPanel className="p-5">
            <div className="text-sm font-display font-semibold text-white mb-4">Live Preview</div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-9 h-9 rounded-xl bg-gold/10 flex items-center justify-center">
                  <Cpu className="w-4 h-4 text-gold/70" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-display font-semibold text-white truncate">
                    {form.name.trim() || 'Unnamed operator'}
                  </div>
                  <div className={`text-[11px] ${selectedMandate.color}`}>{selectedMandate.id}</div>
                </div>
              </div>

              <p className="text-[11px] text-steel/50 leading-relaxed min-h-[48px]">
                {form.description.trim() || 'Your short strategy summary will appear here.'}
              </p>

              <div className="flex flex-wrap gap-2 mt-3">
                <PreviewChip label="Perf" value={`${form.performanceFeePct.toFixed(2)}%`} tone="gold" />
                <PreviewChip label="Mgmt" value={`${form.managementFeePct.toFixed(2)}%`} tone="cyan" />
                <PreviewChip label="Entry" value={`${form.entryFeePct.toFixed(2)}%`} />
                <PreviewChip label="Exit" value={`${form.exitFeePct.toFixed(2)}%`} />
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3">
                <PreviewMetric label="Max position" value={`${form.recMaxPositionPct}%`} />
                <PreviewMetric label="Min confidence" value={`${form.recConfidenceMinPct}%`} />
                <PreviewMetric label="Stop-loss" value={`${form.recStopLossPct}%`} />
                <PreviewMetric label="Cooldown" value={`${form.recCooldownMin}m`} />
              </div>

              <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-steel/40 mb-1">
                  Fee Preview
                </div>
                <div className="text-[11px] text-steel/55">
                  $10k vault @ 10% gross return
                </div>
                <div className="mt-1 text-sm font-display font-semibold text-white">
                  ${feePreview.totalEstimated.toFixed(0)} / year
                </div>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel gold className="p-5">
            <div className="text-sm font-display font-semibold text-white">Save Profile</div>
            <p className="text-[11px] text-steel/50 mt-1 leading-relaxed">
              {isUpdating
                ? 'Update your existing profile on-chain.'
                : 'Publish your operator profile on-chain.'}
            </p>

            <div className="mt-4 flex gap-3">
              <Link to="/marketplace" className="flex-1">
                <ControlButton variant="ghost" className="w-full">Cancel</ControlButton>
              </Link>
              <ControlButton
                variant="primary"
                className="flex-1"
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                {txPhase === 'waiting-signature'
                  ? 'Sign in wallet…'
                  : txPhase === 'pending'
                    ? 'Confirming…'
                    : success
                      ? 'Confirmed'
                      : (isUpdating ? 'Update Profile' : 'Register Operator')}
              </ControlButton>
            </div>

            {(txPhase === 'waiting-signature' || txPhase === 'pending') && (
              <div className="mt-3 text-[11px] text-steel/55 flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
                {TX_PHASE_LABELS[txPhase]}
              </div>
            )}

            {success && (
              <div className="mt-4 rounded-xl border border-emerald-soft/25 bg-emerald-soft/[0.05] px-3 py-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <StatusPill label="On-chain confirmed" variant="active" />
                  {latestRegistryTxHref && (
                    <ExplorerAnchor
                      href={latestRegistryTxHref}
                      label={shortHexLabel(latestRegistryHash, 8, 6)}
                      className="text-[10px] font-mono text-cyan/70 hover:text-cyan"
                    />
                  )}
                </div>
                <div className="flex gap-2">
                  <Link to="/marketplace" className="flex-1">
                    <ControlButton variant="primary" size="sm" className="w-full">
                      Go to marketplace
                    </ControlButton>
                  </Link>
                </div>
                {!isUpdating && (
                  <p className="text-[10px] text-steel/55 mt-2 leading-relaxed">
                    Step 4 (AI + manifest commitments) unlocks shortly once the registry indexes your record.
                  </p>
                )}
              </div>
            )}

            {!isRegistered && !success && (
              <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-[11px] text-steel/55">
                After the first save, Step 4 unlocks for AI and manifest commitments.
              </div>
            )}
          </GlassPanel>

          {isRegistered && (
            <GlassPanel className="p-5">
              <div className="text-sm font-display font-semibold text-white mb-4">Commitment Status</div>
              <div className="space-y-2">
                <ChecklistItem label="AI model declared" done={!!extended?.aiModel} />
                <ChecklistItem label="Manifest published" done={!!extended?.manifestURI} />
              </div>
            </GlassPanel>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={executeSubmit}
        title={isUpdating ? 'Update operator profile?' : 'Register as operator?'}
        description={isUpdating
          ? 'These values will overwrite your on-chain profile. Vault creators see them immediately.'
          : 'This publishes your operator profile on-chain. You can update fields later.'}
        confirmLabel={isUpdating ? 'Update on-chain' : 'Register on-chain'}
      >
        <div className="space-y-3 text-[12px]">
          <ConfirmRow label="Display name" value={form.name.trim() || '—'} />
          <ConfirmRow label="Mandate" value={selectedMandate.id} valueClass={selectedMandate.color} />
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <ConfirmRow compact label="Performance" value={`${form.performanceFeePct.toFixed(2)}%`} />
            <ConfirmRow compact label="Management" value={`${form.managementFeePct.toFixed(2)}%`} />
            <ConfirmRow compact label="Entry" value={`${form.entryFeePct.toFixed(2)}%`} />
            <ConfirmRow compact label="Exit" value={`${form.exitFeePct.toFixed(2)}%`} />
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <ConfirmRow compact label="Max position" value={`${form.recMaxPositionPct}%`} />
            <ConfirmRow compact label="Min confidence" value={`${form.recConfidenceMinPct}%`} />
            <ConfirmRow compact label="Stop-loss" value={`${form.recStopLossPct}%`} />
            <ConfirmRow compact label="Cooldown" value={`${form.recCooldownMin}m`} />
          </div>
          <p className="text-[11px] text-steel/50 leading-relaxed">
            Your wallet will prompt for a signature next. Gas is paid in the network's native token.
          </p>
        </div>
      </ConfirmModal>
    </div>
  );
}

function ConfirmRow({ label, value, valueClass = 'text-white/85', compact = false }) {
  if (compact) {
    return (
      <div>
        <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-steel/40">{label}</div>
        <div className={`text-[12px] font-mono ${valueClass}`}>{value}</div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <span className="text-[11px] text-steel/55">{label}</span>
      <span className={`text-[12px] font-mono ${valueClass}`}>{value}</span>
    </div>
  );
}

function StepSection({ step, title, description, children }) {
  return (
    <section>
      <div className="flex items-start gap-3.5 mb-4">
        <div
          className="ed-italic flex-shrink-0"
          style={{
            fontSize: 40,
            color: 'var(--ed-gold)',
            lineHeight: 1,
            width: 48,
          }}
        >
          0{step}
        </div>
        <div>
          <div className="flex items-baseline gap-3.5 mb-1">
            <span className="ed-eyebrow">§ R.0{step}</span>
            <span
              className="ed-mono text-[10.5px] tracking-[0.22em] uppercase"
              style={{ color: 'var(--ed-steel-400)' }}
            >
              Operator onboarding
            </span>
          </div>
          <h2
            className="ed-display"
            style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, color: 'var(--ed-steel-50)' }}
          >
            {title}
          </h2>
          {description && (
            <p
              className="ed-italic mt-1.5"
              style={{ fontSize: 13, color: 'var(--ed-steel-300)' }}
            >
              {description}
            </p>
          )}
        </div>
      </div>
      <GlassPanel className="p-6">{children}</GlassPanel>
    </section>
  );
}

function HeroRow({ icon: Icon, title, description }) {
  const iconNode = createElement(Icon, { className: 'w-4 h-4 text-white/70' });

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
        {iconNode}
      </div>
      <div>
        <div className="text-white/80 text-sm">{title}</div>
        <div className="text-steel/50 text-[11px] leading-relaxed">{description}</div>
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  valueLabel,
  onChange,
  min,
  max,
  step,
  accent = 'accent-gold',
  valueClassName = 'text-white',
  hint,
  warning,
  warningMessage,
}) {
  const inputId = `slider-${String(label).toLowerCase().replace(/\s+/g, '-')}`;
  const valueClass = warning ? 'text-red-warn' : valueClassName;
  const trackClass = warning ? 'bg-red-warn/[0.12]' : 'bg-white/[0.06]';
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={inputId} className="text-[10px] font-mono uppercase tracking-wider text-steel/40">
          {label}
        </label>
        <span className={`text-sm font-mono font-semibold ${valueClass}`}>{valueLabel}</span>
      </div>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        className={`w-full h-1 rounded-full appearance-none cursor-pointer ${trackClass} ${accent}`}
      />
      {warning && warningMessage ? (
        <p className="text-[10px] text-red-warn mt-1 flex items-center gap-1">
          <AlertTriangle className="w-2.5 h-2.5" />
          {warningMessage}
        </p>
      ) : hint ? (
        <p className="text-[10px] text-steel/35 mt-1">{hint}</p>
      ) : null}
    </div>
  );
}

function ChecklistItem({ label, done }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      {done ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-soft flex-shrink-0" />
      ) : (
        <Circle className="w-4 h-4 text-steel/40 flex-shrink-0" />
      )}
      <span className={`text-[11px] ${done ? 'text-white/75' : 'text-steel/50'}`}>{label}</span>
    </div>
  );
}

function PreviewMetric({ label, value }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-steel/35">{label}</div>
      <div className="text-[12px] font-mono text-white/75 mt-1">{value}</div>
    </div>
  );
}

function PreviewChip({ label, value, tone = 'default' }) {
  const toneClass =
    tone === 'gold'
      ? 'border-gold/20 bg-gold/10 text-gold/80'
      : tone === 'cyan'
        ? 'border-cyan/20 bg-cyan/10 text-cyan/80'
        : 'border-white/[0.08] bg-white/[0.03] text-white/70';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-mono ${toneClass}`}>
      <span className="text-steel/50">{label}</span>
      <span>{value}</span>
    </span>
  );
}

// Compact badge marking a recommendation field that, once accepted by a vault
// owner, becomes a hard cap enforced by the AegisVault contract on every
// execution. Used on Max Position, Min Confidence, Cooldown, Max Trades.
function HardCapBadge({ title }) {
  return (
    <span
      title={title}
      className="ml-1.5 inline-flex items-center rounded-full border border-amber-400/35 bg-amber-400/10 px-1.5 py-px align-middle text-[8.5px] font-mono uppercase tracking-[0.08em] text-amber-200/90"
    >
      hard cap
    </span>
  );
}

// Compact badge marking a recommendation field that stays advisory — the
// orchestrator's off-chain risk veto enforces it, but the vault contract
// does not. Used on Stop-Loss.
function SoftBadge({ title }) {
  return (
    <span
      title={title}
      className="ml-1.5 inline-flex items-center rounded-full border border-cyan/30 bg-cyan/10 px-1.5 py-px align-middle text-[8.5px] font-mono uppercase tracking-[0.08em] text-cyan/85"
    >
      off-chain
    </span>
  );
}
