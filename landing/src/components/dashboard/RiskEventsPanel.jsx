import { riskEvents } from '../../data/mockData';
import GlassPanel from '../ui/GlassPanel';
import SectionLabel from '../ui/SectionLabel';
import StatusPill from '../ui/StatusPill';
import { CheckCircle, XCircle, Info, AlertTriangle, Settings } from 'lucide-react';

const typeIcons = {
  execution: <CheckCircle className="w-3.5 h-3.5 text-emerald-soft/60" />,
  blocked: <XCircle className="w-3.5 h-3.5 text-red-warn/60" />,
  skip: <Info className="w-3.5 h-3.5 text-steel/60" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-warn/60" />,
  policy_update: <Settings className="w-3.5 h-3.5 text-cyan/60" />,
};

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function RiskEventsPanel() {
  return (
    <div>
      <SectionLabel color="text-amber-warn/60">Risk Events & History</SectionLabel>
      <GlassPanel className="p-5">
        <div className="space-y-0">
          {riskEvents.map((evt, i) => (
            <div
              key={evt.id}
              className={`flex items-start gap-3 py-3 ${i < riskEvents.length - 1 ? 'border-b border-white/[0.03]' : ''}`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {typeIcons[evt.type] || typeIcons.execution}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs text-white/80 truncate">{evt.message}</span>
                  <StatusPill label={evt.severity} variant={evt.severity} />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-steel/40">{formatTime(evt.timestamp)}</span>
                  <span className="text-[10px] text-steel/40">{evt.details}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
