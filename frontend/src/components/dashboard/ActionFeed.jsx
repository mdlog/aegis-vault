import { useJournal } from '../../hooks/useOrchestrator';
import StatusPill from '../ui/StatusPill';
import GlassPanel from '../ui/GlassPanel';
import SectionLabel from '../ui/SectionLabel';
import { Activity, ArrowUpRight, ArrowDownRight, Pause, ShieldOff, FileText } from 'lucide-react';

const typeIcons = {
  buy: <ArrowUpRight className="w-3.5 h-3.5 text-emerald-soft" />,
  sell: <ArrowDownRight className="w-3.5 h-3.5 text-red-warn" />,
  rebalance: <Activity className="w-3.5 h-3.5 text-cyan" />,
  hold: <Pause className="w-3.5 h-3.5 text-steel" />,
  blocked: <ShieldOff className="w-3.5 h-3.5 text-red-warn" />,
  decision: <Activity className="w-3.5 h-3.5 text-cyan" />,
  execution: <ArrowUpRight className="w-3.5 h-3.5 text-emerald-soft" />,
  policy_check: <ShieldOff className="w-3.5 h-3.5 text-gold" />,
  cycle: <Activity className="w-3.5 h-3.5 text-steel/40" />,
  system: <Activity className="w-3.5 h-3.5 text-steel/30" />,
};

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function ConfidenceBar({ value }) {
  if (value === undefined || value === null) return null;
  const pct = Math.round(value * 100);
  const color = value >= 0.7 ? 'bg-emerald-soft' : value >= 0.5 ? 'bg-amber-warn' : 'bg-red-warn';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-steel/60">{pct}%</span>
    </div>
  );
}

function getOutcome(entry) {
  if (entry.outcome) return entry.outcome;
  if (entry.type === 'execution') return entry.success ? 'executed' : 'failed';
  if (entry.type === 'policy_check') return entry.valid ? 'passed' : 'blocked';
  if (entry.type === 'decision') {
    if (entry.action === 'hold') return 'skipped';
    return 'executed';
  }
  return entry.type || 'info';
}

function getActionLabel(entry) {
  if (entry.action && entry.asset) return `${entry.action.toUpperCase()} ${entry.asset}`;
  if (entry.action) return entry.action.toUpperCase();
  if (entry.type === 'cycle') return 'AI Cycle';
  if (entry.type === 'policy_check') return 'Policy Check';
  if (entry.type === 'execution') return 'Execution';
  return entry.type || 'Event';
}

function getIcon(entry) {
  if (entry.action) {
    const a = entry.action.toLowerCase();
    if (a === 'buy') return typeIcons.buy;
    if (a === 'sell') return typeIcons.sell;
    if (a === 'hold') return typeIcons.hold;
  }
  return typeIcons[entry.type] || typeIcons.hold;
}

export default function ActionFeed({ limit = 20 }) {
  const { data: entries, loading } = useJournal(limit);

  const actions = entries && entries.length > 0 ? entries.slice(0, limit) : [];

  if (loading) {
    return (
      <div>
        <SectionLabel color="text-cyan/60">AI Intelligence Feed</SectionLabel>
        <GlassPanel className="p-8 text-center">
          <div className="w-5 h-5 border-2 border-cyan/30 border-t-cyan rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-steel/40">Loading actions from orchestrator...</p>
        </GlassPanel>
      </div>
    );
  }

  if (actions.length === 0) {
    return (
      <div>
        <SectionLabel color="text-cyan/60">AI Intelligence Feed</SectionLabel>
        <GlassPanel className="p-8 text-center">
          <FileText className="w-8 h-8 text-steel/20 mx-auto mb-3" />
          <p className="text-sm text-steel/40">No AI actions yet.</p>
          <p className="text-xs text-steel/30 mt-1">Run an AI cycle or start the orchestrator to generate actions.</p>
          <p className="text-[10px] text-steel/25 mt-2 font-mono">cd orchestrator && npm start</p>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div>
      <SectionLabel color="text-cyan/60">AI Intelligence Feed</SectionLabel>
      <div className="space-y-2">
        {actions.map((entry, i) => {
          const outcome = getOutcome(entry);
          const label = getActionLabel(entry);
          const icon = getIcon(entry);

          return (
            <GlassPanel key={entry.id || i} className="p-4 group hover:border-white/[0.08]" hover>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-md bg-white/[0.03] flex items-center justify-center mt-0.5">
                  {icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-display font-medium text-white truncate">
                      {label}
                    </span>
                    <StatusPill label={outcome} variant={outcome} />
                    <span className="text-[8px] font-mono text-cyan/40 px-1 py-0.5 rounded bg-cyan/5 border border-cyan/10">LIVE</span>
                  </div>

                  {/* v1: Regime + Scores bar */}
                  {entry.regime && (
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                        entry.regime?.includes('UP_STRONG') ? 'text-emerald-soft/80 bg-emerald-soft/5 border-emerald-soft/15' :
                        entry.regime?.includes('UP_WEAK') ? 'text-emerald-soft/50 bg-emerald-soft/5 border-emerald-soft/10' :
                        entry.regime?.includes('DOWN') ? 'text-red-warn/70 bg-red-warn/5 border-red-warn/15' :
                        entry.regime?.includes('PANIC') ? 'text-red-warn/90 bg-red-warn/10 border-red-warn/20' :
                        'text-steel/50 bg-white/[0.02] border-white/[0.06]'
                      }`}>
                        {entry.regime?.replace(/_/g, ' ')}
                      </span>
                      {entry.final_edge_score !== undefined && (
                        <span className="text-[9px] font-mono text-steel/40">
                          Edge: <span className={entry.final_edge_score >= 72 ? 'text-emerald-soft/70' : entry.final_edge_score >= 58 ? 'text-amber-warn/70' : 'text-steel/50'}>{entry.final_edge_score}</span>/100
                        </span>
                      )}
                      {entry.trade_quality_score !== undefined && (
                        <span className="text-[9px] font-mono text-steel/40">
                          Quality: <span className={entry.trade_quality_score >= 78 ? 'text-emerald-soft/70' : entry.trade_quality_score >= 60 ? 'text-amber-warn/70' : 'text-steel/50'}>{entry.trade_quality_score}</span>
                        </span>
                      )}
                      {entry.v1_action && entry.v1_action !== entry.action?.toUpperCase() && (
                        <span className="text-[8px] font-mono text-steel/30">{entry.v1_action}</span>
                      )}
                    </div>
                  )}

                  {/* v1: Hard veto reasons */}
                  {entry.hard_veto && entry.hard_veto_reasons?.length > 0 && (
                    <div className="flex items-center gap-1 mb-1.5 flex-wrap">
                      <span className="text-[8px] font-mono text-red-warn/50">VETO:</span>
                      {entry.hard_veto_reasons.map((r, ri) => (
                        <span key={ri} className="text-[8px] font-mono text-red-warn/40 px-1 py-0.5 rounded bg-red-warn/5 border border-red-warn/10">
                          {r.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}

                  {entry.reason && (
                    <p className="text-[11px] text-steel/60 leading-relaxed mb-2 line-clamp-2">
                      {entry.reason}
                    </p>
                  )}

                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-[10px] font-mono text-steel/40">
                      {formatTime(entry.timestamp)}
                    </span>
                    {entry.asset && (
                      <span className="text-[10px] font-mono text-white/50">
                        {entry.asset}
                      </span>
                    )}
                    {entry.confidence !== undefined && (
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-mono text-steel/40">CONF</span>
                        <ConfidenceBar value={entry.confidence} />
                      </div>
                    )}
                    {entry.risk_score !== undefined && (
                      <span className="text-[10px] font-mono text-steel/40">
                        Risk: {(entry.risk_score * 100).toFixed(0)}%
                      </span>
                    )}
                    {entry.source && (
                      <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${
                        entry.source?.includes('0g-compute') ? 'text-cyan/50 bg-cyan/5 border border-cyan/10' : 'text-steel/30 bg-white/[0.02] border border-white/[0.04]'
                      }`}>
                        {entry.source?.includes('0g-compute') ? '0G Compute' : 'Local'}
                      </span>
                    )}
                    {entry.txHash && (
                      <span className="text-[10px] font-mono text-cyan/40 group-hover:text-cyan/60 transition-colors">
                        {entry.txHash}
                      </span>
                    )}
                    {entry.duration_ms && (
                      <span className="text-[10px] font-mono text-steel/30">
                        {entry.duration_ms}ms
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </GlassPanel>
          );
        })}
      </div>
    </div>
  );
}
