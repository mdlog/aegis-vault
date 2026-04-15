import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useChainId } from 'wagmi';
import ActionFeed from '../components/dashboard/ActionFeed';
import { useTriggerCycle, useOrchestratorStatus, useJournal } from '../hooks/useOrchestrator';
import { ENABLE_DEMO_FALLBACKS, getExplorerTxHref, ORCHESTRATOR_URL, shortHexLabel } from '../lib/contracts';
import { demoJournalEntries, demoStatus } from '../data/demoContent';
import ControlButton from '../components/ui/ControlButton';
import GlassPanel from '../components/ui/GlassPanel';
import StatusPill from '../components/ui/StatusPill';
import ExplorerAnchor from '../components/ui/ExplorerAnchor';
import { Zap, Radio, FileText, Activity, Shield, AlertTriangle, Settings, Clock, Cpu, Plus } from 'lucide-react';

const typeConfig = {
  decision: { icon: Activity, color: 'text-cyan/60', label: 'Decision' },
  execution: { icon: Shield, color: 'text-emerald-soft/60', label: 'Execution' },
  policy_check: { icon: AlertTriangle, color: 'text-gold/60', label: 'Policy' },
  alert: { icon: AlertTriangle, color: 'text-amber-warn/60', label: 'Alert' },
  cycle: { icon: Clock, color: 'text-steel/40', label: 'Cycle' },
  system: { icon: Settings, color: 'text-steel/40', label: 'System' },
};

const journalFilters = ['all', 'decision', 'execution', 'policy_check', 'alert', 'cycle'];

function JournalTab({ fallbackEntries = [] }) {
  const chainId = useChainId();
  const [filter, setFilter] = useState('all');
  const { data: entries, loading } = useJournal(100);
  const sourceEntries = entries && entries.length > 0 ? entries : fallbackEntries;
  const usingFallback = (!entries || entries.length === 0) && fallbackEntries.length > 0;

  const filtered = sourceEntries
    ? (filter === 'all' ? sourceEntries : sourceEntries.filter(e => e.type === filter))
    : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-steel/50">Complete audit trail — decisions, policy checks, executions, and system events.</p>
        <div className="flex items-center gap-1">
          {journalFilters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-all
                ${f === filter
                  ? 'bg-white/[0.08] text-white border border-white/[0.08]'
                  : 'text-steel/40 hover:text-steel/70'
                }`}
            >
              {f === 'all' ? 'All' : f.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {loading && !usingFallback && <p className="text-xs text-steel/40">Loading journal...</p>}

      {!loading && filtered.length === 0 && (
        <GlassPanel className="p-8">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-5 h-5 text-steel/25" />
            <span className="text-sm font-display font-semibold text-white">Journal has not received a live cycle yet</span>
          </div>
          <p className="text-[11px] text-steel/50 leading-relaxed mb-4">
            When the orchestrator publishes its first decision, policy check, or execution result, the full audit trail
            will appear here. Until then this page stays intentionally empty in live mode.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            <Link to="/create">
              <GlassPanel className="px-3 py-2 flex items-center gap-2 text-[11px] text-gold/70 hover:border-gold/20" hover>
                <Plus className="w-3 h-3" />
                Create or fund a vault
              </GlassPanel>
            </Link>
            <Link to="/marketplace">
              <GlassPanel className="px-3 py-2 flex items-center gap-2 text-[11px] text-cyan/60 hover:border-cyan/20" hover>
                <Cpu className="w-3 h-3" />
                Wire an operator
              </GlassPanel>
            </Link>
          </div>
        </GlassPanel>
      )}

      <div className="space-y-1.5">
        {filtered.map((entry, i) => {
          const cfg = typeConfig[entry.type] || typeConfig.system;
          const Icon = cfg.icon;
          const txHref = getExplorerTxHref(chainId, entry.txHash);
          return (
            <GlassPanel key={entry.id || i} className="p-3.5 hover:border-white/[0.08]" hover>
              <div className="flex items-start gap-3">
                <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono text-steel/30 uppercase">{cfg.label}</span>
                    {entry.action && (
                      <span className="text-xs text-white/70 font-medium">
                        {entry.action.toUpperCase()} {entry.asset || ''}
                      </span>
                    )}
                    {entry.valid !== undefined && (
                      <StatusPill label={entry.valid ? 'Passed' : 'Blocked'} variant={entry.valid ? 'passed' : 'blocked'} />
                    )}
                    {entry.success !== undefined && (
                      <StatusPill label={entry.success ? 'Success' : 'Failed'} variant={entry.success ? 'executed' : 'failed'} />
                    )}
                    {entry.level && (
                      <StatusPill label={entry.level} variant={entry.level === 'critical' ? 'critical' : entry.level === 'warning' ? 'warning' : 'info'} />
                    )}
                    {entry.approval_tier && entry.approval_tier !== 'not_required' && (
                      <StatusPill
                        label={entry.approval_tier.replace(/_/g, ' ')}
                        variant={entry.approval_tier === 'auto_execute' ? 'active' : 'warning'}
                      />
                    )}
                    {usingFallback && (
                      <span className="text-[8px] font-mono text-gold/70 px-1 py-0.5 rounded bg-gold/5 border border-gold/10">
                        DEMO
                      </span>
                    )}
                  </div>
                  {entry.message && (
                    <p className="text-[11px] text-white/65 truncate">{entry.message}</p>
                  )}
                  {entry.reason && (
                    <p className="text-[11px] text-steel/50 truncate">{entry.reason}</p>
                  )}
                  {entry.confidence !== undefined && (
                    <span className="text-[10px] font-mono text-cyan/40">
                      Conf: {(entry.confidence * 100).toFixed(0)}% | Risk: {((entry.risk_score || 0) * 100).toFixed(0)}%
                    </span>
                  )}
                  {entry.txHash && (
                    txHref ? (
                      <ExplorerAnchor
                        href={txHref}
                        label={shortHexLabel(entry.txHash, 10, 6)}
                        className="text-[10px] font-mono text-cyan/40 block w-fit hover:text-cyan"
                      />
                    ) : (
                      <span className="text-[10px] font-mono text-cyan/30 block">{shortHexLabel(entry.txHash, 10, 6)}</span>
                    )
                  )}
                  {entry.duration_ms && (
                    <span className="text-[10px] font-mono text-steel/30">{entry.duration_ms}ms</span>
                  )}
                </div>
                <span className="text-[9px] font-mono text-steel/25 flex-shrink-0 whitespace-nowrap">
                  {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''}
                </span>
              </div>
            </GlassPanel>
          );
        })}
      </div>
    </div>
  );
}

export default function ActionsPage() {
  const { trigger, loading } = useTriggerCycle();
  const { data: status } = useOrchestratorStatus();
  const fallbackEntries = ENABLE_DEMO_FALLBACKS ? demoJournalEntries : [];
  const displayStatus = status || (ENABLE_DEMO_FALLBACKS ? demoStatus : null);
  const [tab, setTab] = useState('feed');

  return (
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-display font-semibold text-white tracking-tight mb-1">AI Actions</h1>
          <p className="text-xs text-steel/50">Every AI decision, execution, and blocked action logged here.</p>
        </div>
        <div className="flex items-center gap-3">
          {displayStatus && (
            <GlassPanel className="px-3 py-1.5 flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-cyan animate-pulse" />
                <span className="text-[10px] font-mono text-steel/50">Cycles: {displayStatus.cycleCount || 0}</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-soft/60">Exec: {displayStatus.totalExecutions || 0}</span>
              <span className="text-[10px] font-mono text-amber-warn/60">Blocked: {displayStatus.totalBlocked || 0}</span>
              <span className="text-[10px] font-mono text-steel/40">Skipped: {displayStatus.totalSkipped || 0}</span>
              {!status && (
                <span className="text-[9px] font-mono text-gold/60">DEMO</span>
              )}
            </GlassPanel>
          )}
          <ControlButton variant="gold" onClick={trigger} disabled={loading}>
            <Zap className="w-3.5 h-3.5" /> {loading ? 'Running...' : 'Trigger Cycle'}
          </ControlButton>
        </div>
      </div>

      {!displayStatus && !ENABLE_DEMO_FALLBACKS && (
        <GlassPanel className="p-4 mb-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 mb-2">
                <Cpu className="w-4 h-4 text-steel/35" />
                <span className="text-sm font-display font-semibold text-white">Live telemetry is waiting for its first backend heartbeat</span>
              </div>
              <p className="text-[11px] text-steel/50 leading-relaxed">
                This route is showing the real action feed. Start the orchestrator, make sure one vault points to the same executor wallet,
                then run a cycle to populate decisions, policy checks, and execution logs here.
              </p>
            </div>
            <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[10px] font-mono text-steel/40">
              Endpoint: {ORCHESTRATOR_URL || 'VITE_ORCHESTRATOR_URL not set'}
            </div>
          </div>
        </GlassPanel>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-white/[0.06]">
        {[
          { id: 'feed', label: 'Intelligence Feed' },
          { id: 'journal', label: 'Execution Journal' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-[11px] font-medium tracking-wide transition-all border-b-2 -mb-px
              ${tab === t.id
                ? 'text-white border-gold'
                : 'text-steel/50 border-transparent hover:text-steel/80'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'feed' && <ActionFeed limit={20} fallbackEntries={fallbackEntries} />}
      {tab === 'journal' && <JournalTab fallbackEntries={fallbackEntries} />}
    </div>
  );
}
