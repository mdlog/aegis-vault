import ActionFeed from '../components/dashboard/ActionFeed';
import { useTriggerCycle, useOrchestratorStatus } from '../hooks/useOrchestrator';
import ControlButton from '../components/ui/ControlButton';
import GlassPanel from '../components/ui/GlassPanel';
import SectionLabel from '../components/ui/SectionLabel';
import { Zap, Radio } from 'lucide-react';

export default function ActionsPage() {
  const { trigger, loading } = useTriggerCycle();
  const { data: status } = useOrchestratorStatus();

  return (
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-display font-semibold text-white tracking-tight mb-1">AI Intelligence Feed</h1>
          <p className="text-xs text-steel/50">Every AI decision, execution, and blocked action logged here.</p>
        </div>
        <div className="flex items-center gap-3">
          {status && (
            <GlassPanel className="px-3 py-1.5 flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-cyan animate-pulse" />
                <span className="text-[10px] font-mono text-steel/50">Cycles: {status.cycleCount || 0}</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-soft/60">Exec: {status.totalExecutions || 0}</span>
              <span className="text-[10px] font-mono text-amber-warn/60">Blocked: {status.totalBlocked || 0}</span>
              <span className="text-[10px] font-mono text-steel/40">Skipped: {status.totalSkipped || 0}</span>
            </GlassPanel>
          )}
          <ControlButton variant="gold" onClick={trigger} disabled={loading}>
            <Zap className="w-3.5 h-3.5" /> {loading ? 'Running...' : 'Trigger Cycle'}
          </ControlButton>
        </div>
      </div>

      <ActionFeed limit={20} />
    </div>
  );
}
