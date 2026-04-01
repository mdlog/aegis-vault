import { useState } from 'react';
import { useJournal } from '../hooks/useOrchestrator';
import GlassPanel from '../components/ui/GlassPanel';
import StatusPill from '../components/ui/StatusPill';
import SectionLabel from '../components/ui/SectionLabel';
import { FileText, Activity, Shield, AlertTriangle, Settings, Clock } from 'lucide-react';

const typeConfig = {
  decision: { icon: Activity, color: 'text-cyan/60', label: 'Decision' },
  execution: { icon: Shield, color: 'text-emerald-soft/60', label: 'Execution' },
  policy_check: { icon: AlertTriangle, color: 'text-gold/60', label: 'Policy' },
  cycle: { icon: Clock, color: 'text-steel/40', label: 'Cycle' },
  system: { icon: Settings, color: 'text-steel/40', label: 'System' },
};

const filters = ['all', 'decision', 'execution', 'policy_check', 'cycle'];

export default function JournalPage() {
  const [filter, setFilter] = useState('all');
  const { data: entries, loading } = useJournal(100);

  const filtered = entries
    ? (filter === 'all' ? entries : entries.filter(e => e.type === filter))
    : [];

  return (
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-display font-semibold text-white tracking-tight mb-1">Execution Journal</h1>
          <p className="text-xs text-steel/50">Complete audit trail — decisions, policy checks, executions, and system events.</p>
        </div>
        <div className="flex items-center gap-1">
          {filters.map(f => (
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

      {loading && <p className="text-xs text-steel/40">Loading journal...</p>}

      {!loading && filtered.length === 0 && (
        <GlassPanel className="p-8 text-center">
          <FileText className="w-8 h-8 text-steel/20 mx-auto mb-3" />
          <p className="text-sm text-steel/40">No journal entries yet.</p>
          <p className="text-xs text-steel/30 mt-1">Run an AI cycle to generate entries.</p>
        </GlassPanel>
      )}

      <div className="space-y-1.5">
        {filtered.map((entry, i) => {
          const cfg = typeConfig[entry.type] || typeConfig.system;
          const Icon = cfg.icon;
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
                  </div>
                  {entry.reason && (
                    <p className="text-[11px] text-steel/50 truncate">{entry.reason}</p>
                  )}
                  {entry.confidence !== undefined && (
                    <span className="text-[10px] font-mono text-cyan/40">
                      Conf: {(entry.confidence * 100).toFixed(0)}% | Risk: {((entry.risk_score || 0) * 100).toFixed(0)}%
                    </span>
                  )}
                  {entry.txHash && (
                    <span className="text-[10px] font-mono text-cyan/30 block">{entry.txHash}</span>
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
