// SettingsPage — system info / settings view.
//
// Ported from `redesain dashboard aegis/Settings.html` to live React+wagmi
// with the codebase's editorial design tokens (`ed-*` classes from
// styles/editorial.css). Surfaces the post-V2 adapter deployment so the
// active venue is the multi-hop adapter (`jaineVenueAdapterV2`) when present
// and falls back to the single-hop V1 otherwise.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import {
  ArrowLeft, Layers, Shield, Zap, Clock, RefreshCw, Pause, ExternalLink,
  Copy, Check, AlertTriangle, Cpu, Database, Activity, TrendingDown, Target, Lock,
} from 'lucide-react';
import { useVaultPolicy, useAllowedAssets, useVaultList } from '../hooks/useVault';
import { useOGStorageStatus, useOrchestratorStatus } from '../hooks/useOrchestrator';
import {
  getDefaultVaultAddress,
  getDeployments,
  getExplorerAddressHref,
  getNetworkLabel,
  shortHexLabel,
} from '../lib/contracts';
import { formatOrchestratorExecutorSummary, getPrimaryOrchestratorExecutor } from '../lib/orchestratorStatus';

// ── Tone palette (matches editorial.css CSS vars) ─────────────────────
const TONE = {
  emerald: 'var(--ed-emerald, #10B981)',
  amber:   'var(--ed-amber, #F0B948)',
  info:    'var(--ed-cyan, #4CC9F0)',
  danger:  'var(--ed-rose, #E11D48)',
  gold:    'var(--ed-gold, #C9A84C)',
  steel:   'var(--ed-steel-300, #9A9AA6)',
};

// ── Atoms ─────────────────────────────────────────────────────────────

function Eyebrow({ children, tone = 'gold', className = '' }) {
  const color = tone === 'steel' ? 'var(--ed-steel-400)' : tone === 'cyan' ? 'var(--ed-cyan)' : 'var(--ed-gold)';
  return (
    <span
      className={`ed-mono uppercase ${className}`}
      style={{ fontSize: 10, letterSpacing: '0.22em', color }}
    >
      {children}
    </span>
  );
}

function Hairline({ className = '' }) {
  return <div className={`flex-1 h-px ${className}`} style={{ background: 'rgba(255,255,255,0.06)' }} />;
}

function Chip({ children, tone = 'neutral', dense = false }) {
  const colors = {
    success: { c: TONE.emerald, bg: 'rgba(16,185,129,0.10)', ring: 'rgba(16,185,129,0.25)' },
    info:    { c: TONE.info,    bg: 'rgba(76,201,240,0.10)', ring: 'rgba(76,201,240,0.25)' },
    warning: { c: TONE.amber,   bg: 'rgba(240,185,72,0.10)', ring: 'rgba(240,185,72,0.30)' },
    danger:  { c: TONE.danger,  bg: 'rgba(225,29,72,0.10)',  ring: 'rgba(225,29,72,0.25)' },
    gold:    { c: TONE.gold,    bg: 'rgba(201,168,76,0.10)', ring: 'rgba(201,168,76,0.30)' },
    neutral: { c: 'var(--ed-steel-300)', bg: 'rgba(255,255,255,0.04)', ring: 'rgba(255,255,255,0.08)' },
  }[tone] || { c: 'var(--ed-steel-300)', bg: 'rgba(255,255,255,0.04)', ring: 'rgba(255,255,255,0.08)' };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md ed-mono ${dense ? 'px-2 py-0.5' : 'px-2.5 py-1'}`}
      style={{
        background: colors.bg,
        boxShadow: `inset 0 0 0 1px ${colors.ring}`,
        color: colors.c,
        fontSize: dense ? 10 : 11,
        letterSpacing: '0.06em',
      }}
    >
      {children}
    </span>
  );
}

function StatusDot({ tone = 'emerald', size = 6, pulse = false }) {
  const map = { emerald: TONE.emerald, amber: TONE.amber, blue: TONE.info, rose: TONE.danger, steel: TONE.steel };
  return (
    <span
      className={`inline-block rounded-full ${pulse ? 'animate-pulse' : ''}`}
      style={{ width: size, height: size, background: map[tone] || TONE.emerald }}
    />
  );
}

function Section({ n, title, subtitle, right, children }) {
  return (
    <section
      className="rounded-2xl ed-ghost p-6 relative overflow-hidden"
      style={{ background: '#0F0F13' }}
    >
      <div className="flex items-center gap-4 mb-5">
        <Eyebrow>§ {n} · {title}</Eyebrow>
        <Hairline />
        {subtitle ? (
          <span className="ed-mono whitespace-nowrap" style={{ fontSize: 10.5, color: 'var(--ed-steel-400)' }}>
            {subtitle}
          </span>
        ) : null}
        {right}
      </div>
      {children}
    </section>
  );
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(value).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })}
      className="text-[#52525B] hover:text-[#F1F5F9] flex-shrink-0 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3 h-3" style={{ color: TONE.emerald }} /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function KV({ Icon, label, value, address, explorerHref, tone, mono = true, note }) {
  const display = address ? shortHexLabel(address, 8, 6) : value;
  const color = tone ? TONE[tone] : '#F1F5F9';
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-white/[0.03] transition">
      {Icon ? (
        <span
          className="h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--ed-steel-400)' }}
        >
          <Icon className="w-2.5 h-2.5" />
        </span>
      ) : null}
      <span className="text-[13px] flex-shrink-0" style={{ color: 'var(--ed-steel-300)', minWidth: 150 }}>
        {label}
      </span>
      <Hairline className="mx-1" />
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`text-right truncate ${mono ? 'ed-mono' : ''}`}
          style={{ color, fontSize: mono ? 11.5 : 13 }}
        >
          {display || '—'}
        </span>
        {address ? <CopyButton value={address} /> : null}
        {address && explorerHref ? (
          <a
            href={explorerHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#52525B] hover:text-[#F1F5F9] flex-shrink-0 transition-colors"
            title="View on explorer"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : null}
      </div>
      {note ? <span className="ed-mono text-[10px]" style={{ color: 'var(--ed-steel-500)' }}>{note}</span> : null}
    </div>
  );
}

function OrcStat({ Icon, label, value, tone = 'info' }) {
  const c = TONE[tone] || TONE.info;
  return (
    <div className="rounded-lg ed-ghost p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="w-2.5 h-2.5" style={{ color: c }} />
        <span
          className="ed-mono uppercase"
          style={{ fontSize: 9.5, letterSpacing: '0.2em', color: 'var(--ed-steel-500)' }}
        >
          {label}
        </span>
      </div>
      <div className="ed-italic" style={{ fontSize: 26, lineHeight: 1, color: c }}>
        {value}
      </div>
    </div>
  );
}

function PolicyBar({ Icon, label, value, ratio, tone = 'info' }) {
  const c = TONE[tone] || TONE.info;
  const w = Math.min(1, Math.max(0, ratio || 0));
  return (
    <div className="py-2.5 px-1">
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="h-5 w-5 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--ed-steel-400)' }}
        >
          <Icon className="w-2.5 h-2.5" />
        </span>
        <span className="text-[12.5px] flex-1 truncate" style={{ color: 'var(--ed-steel-300)' }}>
          {label}
        </span>
        <span className="ed-mono" style={{ fontSize: 12, color: c }}>{value}</span>
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div className="h-full rounded-full" style={{ width: `${w * 100}%`, background: c }} />
      </div>
    </div>
  );
}

// ── Panels ────────────────────────────────────────────────────────────

function ContractsPanel({ vaultAddr, deployments, chainId }) {
  // Active venue prefers V2 (multi-hop) when available so this list reflects
  // what newly-created vaults will use. V1 is shown below as legacy when
  // both exist, since older vaults are pinned to it (`venue` is immutable).
  const factoryAddr = deployments.aegisVaultFactoryV2 || deployments.aegisVaultFactory;
  const registryAddr = deployments.executionRegistryV2 || deployments.executionRegistry;
  const adapterV2 = deployments.jaineVenueAdapterV2;
  const adapterV1 = deployments.jaineVenueAdapter;
  const operatorRegistry = deployments.operatorRegistryV2 || deployments.operatorRegistry;
  const operatorStaking = deployments.operatorStakingV2 || deployments.operatorStaking;

  const explorer = (addr) => getExplorerAddressHref(chainId, addr);

  const rows = [
    { Icon: Shield,    label: 'Vault',     addr: vaultAddr },
    { Icon: Layers,    label: 'Factory',   addr: factoryAddr },
    { Icon: Layers,    label: 'Registry',  addr: registryAddr },
    {
      Icon: Zap,
      label: adapterV2 ? 'Jaine adapter (V2)' : 'Jaine adapter',
      addr: adapterV2 || adapterV1,
    },
    ...(adapterV2 && adapterV1
      ? [{ Icon: Zap, label: 'Jaine adapter (V1, legacy)', addr: adapterV1, tone: 'steel' }]
      : []),
    { Icon: Cpu,       label: 'Operator registry', addr: operatorRegistry },
    { Icon: Cpu,       label: 'Operator staking',  addr: operatorStaking },
    { Icon: Database,  label: 'NAV calculator',    addr: deployments.vaultNAVCalculator },
    { Icon: Copy,      label: 'USDC.e',            addr: deployments.USDCe || deployments.mockUSDC },
    { Icon: Copy,      label: 'WETH',              addr: deployments.WETH || deployments.mockWETH },
    { Icon: Copy,      label: 'WBTC',              addr: deployments.WBTC || deployments.mockWBTC },
    { Icon: Copy,      label: 'W0G',               addr: deployments.W0G },
  ].filter((r) => r.addr);

  return (
    <Section
      n="S.02"
      title="Contract addresses"
      subtitle={`${getNetworkLabel(chainId)} · chain ${chainId || '—'}`}
      right={<Chip tone="info" dense><StatusDot tone="blue" size={5} /> Verified</Chip>}
    >
      <div className="divide-y divide-white/[0.04]">
        {rows.map((r) => (
          <KV
            key={`${r.label}-${r.addr}`}
            Icon={r.Icon}
            label={r.label}
            address={r.addr}
            explorerHref={explorer(r.addr)}
            tone={r.tone}
          />
        ))}
      </div>

      {adapterV2 ? (
        <div
          className="mt-4 pt-4 border-t flex items-start gap-3"
          style={{ borderColor: 'rgba(255,255,255,0.04)' }}
        >
          <div
            className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(76,201,240,0.15)', color: TONE.info }}
          >
            <Zap className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px]" style={{ color: '#F1F5F9' }}>Active venue</span>
              <Chip tone="info" dense>V2 multi-hop</Chip>
              <span className="ed-mono" style={{ fontSize: 11, color: 'var(--ed-steel-400)' }}>
                hub · W0G
              </span>
            </div>
            <div className="ed-mono mt-1" style={{ fontSize: 10.5, color: 'var(--ed-steel-500)' }}>
              New vaults auto-route USDC.e ↔ WBTC / WETH via the W0G hub when no direct pool exists.
            </div>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function PolicyPanel({ policy, assets }) {
  if (!policy) {
    return (
      <Section n="S.03" title="Vault Policy">
        <div className="py-8 text-center text-[13px]" style={{ color: 'var(--ed-steel-400)' }}>
          No policy loaded. Create or open a vault to view its policy.
        </div>
      </Section>
    );
  }

  const items = [
    {
      Icon: Layers,
      label: 'Max position',
      value: `${policy.maxPositionPct}%`,
      ratio: (policy.maxPositionPct || 0) / 100,
      tone: 'info',
    },
    {
      Icon: TrendingDown,
      label: 'Max daily loss',
      value: `${policy.maxDailyLossPct ?? '—'}%`,
      ratio: (policy.maxDailyLossPct || 0) / 50,
      tone: 'danger',
    },
    {
      Icon: AlertTriangle,
      label: 'Stop-loss',
      value: `${policy.stopLossPct}%`,
      ratio: (policy.stopLossPct || 0) / 50,
      tone: 'amber',
    },
    {
      Icon: Clock,
      label: 'Cooldown',
      value: `${policy.cooldownSeconds}s`,
      ratio: Math.min(1, (policy.cooldownSeconds || 0) / 1500),
      tone: 'info',
    },
    {
      Icon: Target,
      label: 'Confidence min',
      value: `${policy.confidenceThresholdPct}%`,
      ratio: (policy.confidenceThresholdPct || 0) / 100,
      tone: 'emerald',
    },
    {
      Icon: Zap,
      label: 'Max actions/day',
      value: String(policy.maxActionsPerDay ?? 0),
      ratio: Math.min(1, (policy.maxActionsPerDay || 0) / 50),
      tone: 'amber',
    },
  ];

  const mandate =
    policy.maxPositionPct <= 30 ? 'Defensive'
    : policy.maxPositionPct <= 50 ? 'Balanced'
    : 'Tactical';

  return (
    <Section
      n="S.03"
      title="Vault Policy"
      right={
        <Chip tone={policy.paused ? 'warning' : 'success'} dense>
          <StatusDot tone={policy.paused ? 'amber' : 'emerald'} size={5} pulse={!policy.paused} />
          {policy.paused ? 'Paused' : 'Active'}
        </Chip>
      }
    >
      <div
        className="flex items-start gap-3 mb-4 rounded-xl p-4 ed-ghost"
        style={{ background: 'linear-gradient(90deg, rgba(201,168,76,0.06), rgba(15,15,19,0.8))' }}
      >
        <div
          className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(201,168,76,0.15)', color: TONE.gold }}
        >
          <Shield className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-[14px]" style={{ color: '#F1F5F9' }}>{mandate} Mandate</span>
            <Chip tone="success" dense>Enforced on-chain</Chip>
          </div>
          <p className="text-[12px] leading-[1.55]" style={{ color: 'var(--ed-steel-400)' }}>
            Currently active policy. Every operator signal passes through these gates before it can
            become an on-chain action.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        {items.map((b) => <PolicyBar key={b.label} {...b} />)}
      </div>

      <div className="grid grid-cols-2 gap-x-6 mt-4 pt-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
        <KV Icon={Zap} label="Auto-execution" value={policy.autoExecution ? 'Enabled' : 'Disabled'} tone={policy.autoExecution ? 'emerald' : 'steel'} mono={false} />
        <KV Icon={Lock} label="Sealed mode" value={policy.sealedMode ? 'On' : 'Roadmap'} tone={policy.sealedMode ? 'gold' : 'amber'} mono={false} />
      </div>

      {assets && assets.length > 0 ? (
        <div className="mt-4">
          <Eyebrow tone="steel" className="block mb-2">Allowed assets ({assets.length})</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {assets.map((addr) => (
              <span
                key={addr}
                className="ed-mono px-2 py-1 rounded-md ed-ghost"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  color: 'var(--ed-steel-300)',
                  fontSize: 10.5,
                }}
              >
                {shortHexLabel(addr, 6, 4)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function OrchestratorPanel({ orchStatus, chainId }) {
  const status = orchStatus || {};
  const executor = getPrimaryOrchestratorExecutor(orchStatus);
  const summary = formatOrchestratorExecutorSummary(orchStatus);
  const lastSignal = status.lastSignal;

  return (
    <Section
      n="S.04"
      title="Orchestrator"
      right={
        <Chip tone={status.running ? 'success' : 'neutral'} dense>
          <StatusDot tone={status.running ? 'emerald' : 'steel'} size={5} pulse={status.running} />
          {status.running ? 'Running' : 'Idle'}
        </Chip>
      }
    >
      <div className="grid grid-cols-2 gap-3 mb-5">
        <OrcStat Icon={RefreshCw} label="Total cycles"        value={status.cycleCount || 0}              tone="info" />
        <OrcStat Icon={Zap}       label="Executions"          value={status.totalExecutions || 0}         tone="emerald" />
        <OrcStat Icon={Shield}    label="Blocked"             value={status.totalBlocked || 0}            tone="amber" />
        <OrcStat Icon={Pause}     label="Skipped · hold"      value={status.totalSkipped || 0}            tone="steel" />
        <OrcStat Icon={Clock}     label="Pending approvals"   value={status.pendingApprovalCount || 0}    tone="info" />
        <OrcStat Icon={Layers}    label="Managed vaults"      value={String(status.managedVaultCount || 0).padStart(2, '0')} tone="info" />
      </div>

      <div className="divide-y divide-white/[0.04]">
        <KV Icon={Copy} label="Executor wallet" address={executor} explorerHref={getExplorerAddressHref(chainId, executor)} />
        <KV Icon={Shield} label="Mutation auth" value={summary || 'Unknown'} tone="info" mono={false} />
      </div>

      {lastSignal ? (
        <div
          className="mt-4 rounded-xl ed-ghost p-4"
          style={{ background: 'linear-gradient(90deg, rgba(225,29,72,0.05), rgba(15,15,19,0.8))' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-3 h-3" style={{ color: TONE.danger }} />
            <Eyebrow className="block" tone="steel">
              <span style={{ color: TONE.danger }}>Last signal</span>
            </Eyebrow>
          </div>
          <p className="text-[13px] leading-[1.55]" style={{ color: '#F1F5F9' }}>
            <span className="ed-italic">{lastSignal.action || 'HOLD'} {lastSignal.symbol || ''}</span>
            {lastSignal.reason ? <span style={{ color: 'var(--ed-steel-400)' }}> — {lastSignal.reason}</span> : null}
          </p>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {lastSignal.regime ? (
              <span className="ed-mono" style={{ fontSize: 10.5, color: 'var(--ed-steel-400)' }}>
                Regime · <span style={{ color: '#F1F5F9' }}>{lastSignal.regime}</span>
              </span>
            ) : null}
            {lastSignal.confidence != null ? (
              <span className="ed-mono" style={{ fontSize: 10.5, color: 'var(--ed-steel-400)' }}>
                Confidence · <span style={{ color: '#F1F5F9' }}>{lastSignal.confidence}%</span>
              </span>
            ) : null}
            {status.cycleCount ? (
              <span className="ed-mono" style={{ fontSize: 10.5, color: 'var(--ed-steel-400)' }}>
                Cycle · <span style={{ color: '#F1F5F9' }}>C-{status.cycleCount}</span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function StoragePanel({ ogStatus }) {
  const connected = !!ogStatus?.available;
  return (
    <Section
      n="S.05"
      title="0G Storage"
      right={
        <Chip tone={connected ? 'success' : 'warning'} dense>
          <StatusDot tone={connected ? 'emerald' : 'amber'} size={5} pulse={connected} />
          {connected ? 'Connected' : 'Local fallback'}
        </Chip>
      }
    >
      <div className="divide-y divide-white/[0.04]">
        <KV Icon={Layers} label="Connected" value={connected ? 'Yes' : 'No'} tone={connected ? 'emerald' : 'amber'} mono={false} />
        <KV Icon={Activity} label="Indexer" value={ogStatus?.indexer || '—'} mono={false} />
        <KV Icon={Database} label="KV node" value={ogStatus?.kvNode || '—'} />
        <KV Icon={Shield} label="Attestation" value="TEE-bound · sealed mode" tone="amber" mono={false} />
      </div>

      {!connected ? (
        <div
          className="mt-4 rounded-xl ed-ghost p-4 flex items-start gap-3"
          style={{ background: 'rgba(240,185,72,0.04)' }}
        >
          <div
            className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(240,185,72,0.15)', color: TONE.amber }}
          >
            <Zap className="w-3.5 h-3.5" />
          </div>
          <p className="flex-1 text-[12.5px] leading-[1.55]" style={{ color: 'var(--ed-steel-400)' }}>
            Decision journal currently flushes to the local KV mirror.
            When the 0G Storage indexer is reachable, the orchestrator will mirror
            <span className="ed-italic" style={{ color: '#F1F5F9' }}> automatically</span> with no extra config.
          </p>
        </div>
      ) : null}
    </Section>
  );
}

function ByoOrchestratorPanel({ executor, vaultAddr }) {
  const steps = [
    {
      n: '01',
      title: 'Run it',
      body: 'Start your orchestrator with the wallet you want to trust as executor. Use the same key for sealed-mode attestations.',
      code: executor || '<your executor wallet>',
    },
    {
      n: '02',
      title: 'Point the vault',
      body: 'Set the vault executor to the same address from the vault detail page or at creation time.',
      code: vaultAddr ? `Current vault · ${shortHexLabel(vaultAddr, 8, 6)}` : 'No vault selected',
    },
    {
      n: '03',
      title: 'Verify sync',
      body: 'When the API executor and vault executor match, that orchestrator can manage the vault within its on-chain policy.',
      code: 'Auth mode · API key protected',
    },
  ];
  return (
    <section
      className="rounded-2xl ed-ghost p-6 relative overflow-hidden"
      style={{ background: 'linear-gradient(180deg, rgba(76,201,240,0.04), rgba(15,15,19,0.8))' }}
    >
      <div className="flex items-center gap-4 mb-6">
        <Eyebrow tone="cyan">§ S.06 · Bring your own orchestrator</Eyebrow>
        <Hairline />
        <Chip tone="info" dense>Advanced</Chip>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {steps.map((s) => (
          <div
            key={s.n}
            className="rounded-xl ed-ghost p-5"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="h-7 w-7 rounded-md flex items-center justify-center ed-mono"
                style={{
                  background: 'rgba(201,168,76,0.12)',
                  color: TONE.gold,
                  fontSize: 11,
                  boxShadow: 'inset 0 0 0 1px rgba(201,168,76,0.25)',
                }}
              >
                {s.n}
              </span>
              <span
                className="ed-mono uppercase"
                style={{ fontSize: 10.5, letterSpacing: '0.22em', color: TONE.gold }}
              >
                {s.title}
              </span>
            </div>
            <p className="text-[13px] mb-3 leading-[1.55]" style={{ color: 'var(--ed-steel-400)' }}>
              {s.body}
            </p>
            <div
              className="ed-mono rounded-md p-2 break-all ed-ghost"
              style={{ background: 'rgba(0,0,0,0.3)', color: 'var(--ed-steel-400)', fontSize: 10.5 }}
            >
              {s.code}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const { vaultAddress: routeVaultAddress } = useParams();
  const factoryAddr = deployments.aegisVaultFactoryV2 || deployments.aegisVaultFactory;
  const { vaults: myVaults } = useVaultList(factoryAddr, address);
  const vaultAddr = routeVaultAddress || myVaults[0]?.address || getDefaultVaultAddress(chainId);

  const { data: policy } = useVaultPolicy(vaultAddr);
  const { data: assets } = useAllowedAssets(vaultAddr);
  const { data: ogStatus } = useOGStorageStatus();
  const { data: orchStatus } = useOrchestratorStatus();
  const primaryExecutor = getPrimaryOrchestratorExecutor(orchStatus);

  return (
    <div className="min-h-screen relative" style={{ background: 'var(--ed-obsidian, #09090B)', color: 'var(--ed-steel-50)' }}>
      <div aria-hidden className="fixed inset-0 pointer-events-none">
        <div
          className="absolute -top-[400px] -right-[100px] h-[800px] w-[800px] rounded-full"
          style={{ background: 'radial-gradient(circle,#3B82F612 0%,transparent 55%)', filter: 'blur(40px)' }}
        />
        <div
          className="absolute -bottom-[400px] -left-[200px] h-[800px] w-[800px] rounded-full"
          style={{ background: 'radial-gradient(circle,#F0B94808 0%,transparent 55%)', filter: 'blur(40px)' }}
        />
      </div>

      <div className="relative max-w-[1540px] mx-auto px-5 pt-3 pb-16">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mt-6 mb-5">
          <Link
            to="/dashboard"
            className="ed-mono uppercase inline-flex items-center gap-1.5 transition-colors"
            style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--ed-steel-400)' }}
          >
            <ArrowLeft className="w-3 h-3" /> Back to Dashboard
          </Link>
          <span className="ed-mono" style={{ fontSize: 11, color: 'var(--ed-steel-700)' }}>/</span>
          <span className="ed-mono uppercase" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--ed-steel-400)' }}>Vault</span>
          <span className="ed-mono" style={{ fontSize: 11, color: 'var(--ed-steel-700)' }}>/</span>
          <span className="ed-mono uppercase" style={{ fontSize: 11, letterSpacing: '0.18em', color: '#F1F5F9' }}>Settings</span>
        </div>

        {/* Header */}
        <section
          className="relative rounded-[28px] ed-ghost p-9 overflow-hidden"
          style={{ background: 'linear-gradient(180deg,#0F0F13,#09090B)' }}
        >
          <div
            aria-hidden
            className="absolute -right-20 -top-20 h-[320px] w-[320px] rounded-full opacity-[0.1]"
            style={{ background: 'radial-gradient(circle,#4CC9F0 0%,transparent 60%)', filter: 'blur(10px)' }}
          />
          <div className="relative flex items-end justify-between gap-10 flex-wrap">
            <div className="flex flex-col gap-4 min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <Eyebrow>§ S.01 · System file</Eyebrow>
                <Hairline />
                <Chip tone="success" dense>
                  <StatusDot tone="emerald" size={5} pulse /> All systems healthy
                </Chip>
              </div>
              <h1
                className="ed-display"
                style={{ fontSize: 56, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1, margin: 0, color: '#F1F5F9' }}
              >
                Settings &amp; <span className="ed-italic" style={{ fontWeight: 400 }}>system info.</span>
              </h1>
              <p className="max-w-[640px] text-[14px] leading-[1.6]" style={{ color: 'var(--ed-steel-400)' }}>
                Contract addresses, policy configuration, and live system status — every dependency this vault touches,{' '}
                <span className="ed-italic" style={{ color: '#F1F5F9' }}>spelled out on one page.</span>
              </p>
            </div>

            <div className="flex flex-col gap-3 flex-shrink-0 items-end">
              <div className="flex items-center gap-2">
                <Chip tone="info" dense>
                  Vault · {vaultAddr ? shortHexLabel(vaultAddr, 4, 4) : 'none'}
                </Chip>
                <Chip tone="neutral" dense>Network · {getNetworkLabel(chainId)}</Chip>
              </div>
              <div className="flex gap-2">
                <a
                  href={getExplorerAddressHref(chainId, vaultAddr) || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ed-mono inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md ed-ghost hover:bg-white/[0.05] transition-colors"
                  style={{ fontSize: 11, color: 'var(--ed-steel-300)' }}
                >
                  <ExternalLink className="w-3 h-3" /> Explorer
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Top row: Contracts + Policy */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <ContractsPanel vaultAddr={vaultAddr} deployments={deployments} chainId={chainId} />
          <PolicyPanel policy={policy} assets={assets} />
        </div>

        {/* Second row: Orchestrator + Storage */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <OrchestratorPanel orchStatus={orchStatus} chainId={chainId} />
          <StoragePanel ogStatus={ogStatus} />
        </div>

        {/* BYO Orchestrator */}
        <div className="mt-6">
          <ByoOrchestratorPanel executor={primaryExecutor} vaultAddr={vaultAddr} />
        </div>

        {!isConnected ? (
          <div className="mt-8 text-center text-[12px]" style={{ color: 'var(--ed-steel-400)' }}>
            Connect your wallet to load policy + allowed assets for your vault.
          </div>
        ) : null}
      </div>
    </div>
  );
}
