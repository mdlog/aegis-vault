import { Link } from 'react-router-dom';
import { useChainId } from 'wagmi';
import { useJournal } from '../../hooks/useOrchestrator';
import { getExplorerTxHref, ORCHESTRATOR_URL, shortHexLabel } from '../../lib/contracts';
import StatusPill from '../ui/StatusPill';
import GlassPanel from '../ui/GlassPanel';
import SectionLabel from '../ui/SectionLabel';
import ExplorerAnchor from '../ui/ExplorerAnchor';
import { Activity, ArrowUpRight, ArrowDownRight, Pause, ShieldOff, FileText, Cpu, Plus } from 'lucide-react';

const typeIcons = {
  buy: <ArrowUpRight className="w-3.5 h-3.5 text-emerald-soft" />,
  sell: <ArrowDownRight className="w-3.5 h-3.5 text-red-warn" />,
  rebalance: <Activity className="w-3.5 h-3.5 text-cyan" />,
  hold: <Pause className="w-3.5 h-3.5 text-steel" />,
  blocked: <ShieldOff className="w-3.5 h-3.5 text-red-warn" />,
  alert: <ShieldOff className="w-3.5 h-3.5 text-amber-warn" />,
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
  if (entry.type === 'alert') return entry.level || 'info';
  if (entry.type === 'execution') return entry.success ? 'executed' : 'failed';
  if (entry.type === 'policy_check') return entry.valid ? 'passed' : 'blocked';
  if (entry.type === 'decision') {
    if (entry.action === 'hold') return 'skipped';
    return 'executed';
  }
  return entry.type || 'info';
}

function getActionLabel(entry) {
  if (entry.type === 'alert') return entry.code?.replace(/_/g, ' ') || 'Alert';
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

export default function ActionFeed({ limit = 20, fallbackEntries = [] }) {
  const chainId = useChainId();
  const { data: entries, loading } = useJournal(limit);
  const usingFallback = (!entries || entries.length === 0) && fallbackEntries.length > 0;
  const actions = entries && entries.length > 0
    ? entries.slice(0, limit)
    : fallbackEntries.slice(0, limit);

  if (loading && !usingFallback) {
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
        <GlassPanel className="p-8">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-5 h-5 text-steel/25" />
            <span className="text-sm font-display font-semibold text-white">No live AI actions recorded yet</span>
          </div>
          <p className="text-[11px] text-steel/50 leading-relaxed mb-4">
            This feed stays empty until the orchestrator runs at least one cycle against a vault whose executor matches
            the active backend wallet. No synthetic entries are being injected here.
          </p>
          <div className="grid sm:grid-cols-3 gap-2 text-[10px] font-mono text-steel/40 mb-4">
            <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2">1. Create or open a vault</div>
            <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2">2. Set the executor wallet</div>
            <div className="rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2">3. Run the first AI cycle</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link to="/create">
              <GlassPanel className="px-3 py-2 flex items-center gap-2 text-[11px] text-gold/70 hover:border-gold/20" hover>
                <Plus className="w-3 h-3" />
                Create Vault
              </GlassPanel>
            </Link>
            <Link to="/marketplace">
              <GlassPanel className="px-3 py-2 flex items-center gap-2 text-[11px] text-cyan/60 hover:border-cyan/20" hover>
                <Cpu className="w-3 h-3" />
                Review Operators
              </GlassPanel>
            </Link>
          </div>
          <div className="mt-4 text-[10px] font-mono text-steel/35">
            Orchestrator endpoint: {ORCHESTRATOR_URL || 'not configured'}
          </div>
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
          const txHref = getExplorerTxHref(chainId, entry.txHash);

          return (
            <GlassPanel key={entry.id || i} className="p-4 group hover:border-white/[0.08]" hover>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-md bg-white/[0.03] flex items-center justify-center mt-0.5">
                  {icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-display font-medium text-white truncate">
                      {entry.type === 'alert' ? entry.message : label}
                    </span>
                    <StatusPill label={outcome} variant={outcome} />
                    {entry.approval_tier && entry.approval_tier !== 'not_required' && (
                      <StatusPill
                        label={entry.approval_tier.replace(/_/g, ' ')}
                        variant={entry.approval_tier === 'auto_execute' ? 'active' : 'warning'}
                      />
                    )}
                    <span className={`text-[8px] font-mono px-1 py-0.5 rounded border ${
                      usingFallback
                        ? 'text-gold/70 bg-gold/5 border-gold/10'
                        : 'text-cyan/40 bg-cyan/5 border-cyan/10'
                    }`}>
                      {usingFallback ? 'DEMO' : 'LIVE'}
                    </span>
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
                      txHref ? (
                        <ExplorerAnchor
                          href={txHref}
                          label={shortHexLabel(entry.txHash, 10, 6)}
                          className="text-[10px] font-mono text-cyan/40 group-hover:text-cyan/60 transition-colors"
                        />
                      ) : (
                        <span className="text-[10px] font-mono text-cyan/40 group-hover:text-cyan/60 transition-colors">
                          {shortHexLabel(entry.txHash, 10, 6)}
                        </span>
                      )
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
