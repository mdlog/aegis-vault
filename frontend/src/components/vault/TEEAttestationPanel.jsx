import { Lock, Shield, Cpu, Check, ExternalLink, Copy } from 'lucide-react';
import { useState } from 'react';
import GlassPanel from '../ui/GlassPanel';
import StatusPill from '../ui/StatusPill';
import SectionLabel from '../ui/SectionLabel';
import { useExecutions } from '../../hooks/useOrchestrator';
import { useAvailableAIModels } from '../../hooks/useOrchestrator';

function CopyAddr({ value, className = '' }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-steel/40">—</span>;
  const short = `${value.slice(0, 8)}…${value.slice(-6)}`;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={`inline-flex items-center gap-1.5 font-mono text-[11px] hover:text-white transition-colors ${className}`}
      title={value}
    >
      <span>{short}</span>
      {copied ? <Check className="w-3 h-3 text-emerald-soft" /> : <Copy className="w-3 h-3 opacity-60" />}
    </button>
  );
}

export default function TEEAttestationPanel({ vaultAddress, policy, explorerHref }) {
  const sealed = !!policy?.sealedMode;
  const attestedSigner = policy?.attestedSigner;
  const { data: executions } = useExecutions(50, { vaultAddress });
  const { data: aiModels } = useAvailableAIModels();

  // Find the last sealed execution (executor.js surfaces sealed metadata when available)
  const lastSealedExec = Array.isArray(executions)
    ? executions.find((e) => e?.sealed || e?.attestationReportHash || e?.attestedSigner)
    : null;

  // Most recent execution with a REAL hardware-TEE verification (DCAP) this cycle.
  const lastTeeVerified = Array.isArray(executions)
    ? executions.find((e) => e?.teeVerified === true)
    : null;

  // Count sealed executions in recent journal
  const sealedExecCount = Array.isArray(executions)
    ? executions.filter((e) => e?.sealed || e?.attestationReportHash).length
    : 0;

  const activeProvider = Array.isArray(aiModels) && aiModels.length > 0 ? aiModels[0] : null;

  if (!sealed) {
    return (
      <div>
        <SectionLabel color="text-steel/40">TEE Attestation</SectionLabel>
        <GlassPanel className="p-5 border-dashed">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/[0.04] flex items-center justify-center">
              <Lock className="w-5 h-5 text-steel/40" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-display font-semibold text-white/80">Sealed mode disabled</span>
                <StatusPill label="Open" variant="paused" />
              </div>
              <p className="text-[11px] text-steel/50 leading-relaxed">
                This vault runs in open strategy mode. AI inference output is visible in the mempool;
                re-enable sealed mode in Settings to route execution through TEE-attested 0G Compute with commit-reveal anti-MEV.
              </p>
            </div>
          </div>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div>
      <SectionLabel color="text-gold/70">TEE Attestation</SectionLabel>
      <GlassPanel gold className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-gold" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-display font-semibold text-white">Sealed Strategy Mode</span>
                <StatusPill label="Attested" variant="sealed" />
              </div>
              <p className="text-[11px] text-steel/55 leading-relaxed max-w-md">
                Inference output is hashed into an on-chain intent; the vault verifies an ECDSA signature
                from the attested signer before executing. Commit-reveal hides swap parameters from public
                mempool front-runners.
              </p>
              {lastTeeVerified ? (
                <p className="mt-2 text-[11px] text-emerald-soft/80 flex items-center gap-1.5">
                  <Check className="w-3 h-3 shrink-0" />
                  <span>
                    Intel-TDX quote DCAP-verified
                    {lastTeeVerified.verifierContract ? ` via ${lastTeeVerified.verifierContract.slice(0, 10)}…` : ''}
                    {lastTeeVerified.attestedEnclaveSigner ? ` · enclave signer ${lastTeeVerified.attestedEnclaveSigner.slice(0, 10)}…` : ''}
                  </span>
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-steel/45 leading-relaxed">
                  Hardware TEE quote not verified for the latest execution (signed intent + commit-reveal only).
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-steel/40 mb-1.5">
              <Shield className="w-3 h-3" /> Attested Signer
            </div>
            <CopyAddr value={attestedSigner} className="text-gold/90" />
            <div className="text-[10px] text-steel/45 mt-1">on-chain policy.attestedSigner</div>
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-steel/40 mb-1.5">
              <Cpu className="w-3 h-3" /> 0G Compute Provider
            </div>
            {activeProvider ? (
              <>
                <div className="text-[11px] font-mono text-cyan/90 truncate" title={activeProvider.model}>{activeProvider.model || 'Unknown model'}</div>
                <div className="text-[10px] text-steel/45 mt-1 truncate" title={activeProvider.provider}>
                  {activeProvider.provider ? `${activeProvider.provider.slice(0, 8)}…${activeProvider.provider.slice(-6)}` : 'Provider not advertised'}
                </div>
              </>
            ) : (
              <>
                <div className="text-[11px] font-mono text-steel/50">Provider list unavailable</div>
                <div className="text-[10px] text-steel/35 mt-1">orchestrator not reporting 0G Compute models</div>
              </>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-steel/40">
              Last Sealed Execution
            </div>
            {sealedExecCount > 0 && (
              <span className="text-[10px] font-mono text-emerald-soft/70">
                {sealedExecCount} attested execution{sealedExecCount !== 1 ? 's' : ''} in recent journal
              </span>
            )}
          </div>
          {lastSealedExec ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-steel/50 w-28 shrink-0">Intent hash</span>
                <CopyAddr value={lastSealedExec.intentHash || lastSealedExec.txHash} className="text-white/80" />
              </div>
              {lastSealedExec.attestationReportHash && (
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-steel/50 w-28 shrink-0">Attestation report</span>
                  <CopyAddr value={lastSealedExec.attestationReportHash} className="text-white/80" />
                </div>
              )}
              {lastSealedExec.teeVerified && (
                <>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="text-steel/50 w-28 shrink-0">DCAP verifier</span>
                    <CopyAddr value={lastSealedExec.verifierContract} className="text-emerald-soft/90" />
                  </div>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="text-steel/50 w-28 shrink-0">Enclave signer</span>
                    <CopyAddr value={lastSealedExec.attestedEnclaveSigner} className="text-emerald-soft/90" />
                  </div>
                </>
              )}
              {lastSealedExec.executedAt && (
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-steel/50 w-28 shrink-0">Executed at</span>
                  <span className="text-steel/70 font-mono">
                    {new Date(lastSealedExec.executedAt).toLocaleString()}
                  </span>
                </div>
              )}
              {lastSealedExec.txHash && explorerHref && (
                <a
                  href={`${explorerHref.replace(/\/address\/.*$/, '')}/tx/${lastSealedExec.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan/70 hover:text-cyan mt-1"
                >
                  view on explorer <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-steel/45 leading-relaxed">
              No sealed executions in the recent journal yet. Once the orchestrator runs a cycle, the attestation
              report hash and signer verification will appear here.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-steel/40 mb-2">Trust Assumptions</div>
          <ul className="text-[11px] text-steel/55 space-y-1.5 list-disc list-inside leading-relaxed">
            <li>Inference runs on the 0G Compute provider above; content digest is hashed into the on-chain intent.</li>
            <li>Before executing, the vault checks ECDSA(attestedSigner) on the intent hash.</li>
            <li>Commit → 1-block delay → reveal hides swap parameters from public mempool observers.</li>
            <li>For vaults with <span className="font-mono text-steel/70">requireTeeAttestation</span>, the provider's Intel-TDX quote is DCAP-verified off-chain each cycle (Automata); otherwise hardware confidentiality depends on the selected compute provider.</li>
          </ul>
        </div>
      </GlassPanel>
    </div>
  );
}
