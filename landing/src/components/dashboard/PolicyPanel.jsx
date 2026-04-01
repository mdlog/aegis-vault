import { policy } from '../../data/mockData';
import GlassPanel from '../ui/GlassPanel';
import SectionLabel from '../ui/SectionLabel';
import StatusPill from '../ui/StatusPill';
import PolicyChip from '../ui/PolicyChip';
import { Shield, TrendingDown, Layers, Clock, Lock, Zap, AlertTriangle, Target } from 'lucide-react';

export default function PolicyPanel() {
  return (
    <div>
      <SectionLabel color="text-gold/60">Policy & Guardrails</SectionLabel>
      <GlassPanel gold className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-gold/60" />
            <span className="text-xs font-display font-medium text-white/80">
              {policy.mandateType} Mandate
            </span>
          </div>
          <div className="flex items-center gap-2">
            {policy.sealedMode && <StatusPill label="Sealed" variant="sealed" />}
            {!policy.paused && <StatusPill label="Active" variant="active" pulse />}
            {policy.paused && <StatusPill label="Paused" variant="paused" />}
          </div>
        </div>

        {/* Policy rules */}
        <div className="space-y-0">
          <PolicyChip
            label="Max Drawdown"
            value={`${policy.maxDrawdownPct}%`}
            icon={<TrendingDown className="w-3.5 h-3.5" />}
          />
          <PolicyChip
            label="Max Position Size"
            value={`${policy.maxPositionPct}%`}
            icon={<Target className="w-3.5 h-3.5" />}
          />
          <PolicyChip
            label="Daily Loss Limit"
            value={`${policy.dailyLossLimitPct}%`}
            icon={<AlertTriangle className="w-3.5 h-3.5" />}
          />
          <PolicyChip
            label="Cooldown"
            value={`${policy.cooldownMinutes}min`}
            icon={<Clock className="w-3.5 h-3.5" />}
          />
          <PolicyChip
            label="Leverage Cap"
            value={`${policy.leverageCap}x`}
            icon={<Layers className="w-3.5 h-3.5" />}
          />
          <PolicyChip
            label="Global Stop-Loss"
            value={`${policy.globalStopLoss}%`}
            icon={<Shield className="w-3.5 h-3.5" />}
          />
          <PolicyChip
            label="Confidence Threshold"
            value={`${(policy.confidenceThreshold * 100).toFixed(0)}%`}
            icon={<Zap className="w-3.5 h-3.5" />}
          />
          <PolicyChip
            label="Auto-Execution"
            value={policy.autoExecution ? 'Enabled' : 'Disabled'}
            icon={<Zap className="w-3.5 h-3.5" />}
          />
          <PolicyChip
            label="Sealed Mode"
            value={policy.sealedMode ? 'Active' : 'Off'}
            icon={<Lock className="w-3.5 h-3.5" />}
          />
        </div>

        {/* Allowed assets */}
        <div className="mt-4 pt-3 border-t border-white/[0.04]">
          <span className="text-[10px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-2">
            Allowed Assets
          </span>
          <div className="flex flex-wrap gap-1.5">
            {policy.allowedAssets.map((a) => (
              <span key={a} className="px-2 py-0.5 rounded text-[10px] font-mono text-white/60 bg-white/[0.04] border border-white/[0.06]">
                {a}
              </span>
            ))}
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
