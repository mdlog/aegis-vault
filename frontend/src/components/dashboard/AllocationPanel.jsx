import { allocation, exposureSummary } from '../../data/mockData';
import GlassPanel from '../ui/GlassPanel';
import SectionLabel from '../ui/SectionLabel';
import AllocationRing from '../charts/AllocationRing';
import TokenIcon from '../ui/TokenIcon';

export default function AllocationPanel() {
  return (
    <div>
      <SectionLabel color="text-steel/50">Allocation & Exposure</SectionLabel>
      <GlassPanel className="p-5">
        <div className="flex flex-col lg:flex-row items-center gap-6">
          {/* Ring chart */}
          <div className="flex-shrink-0">
            <AllocationRing size={160} />
          </div>

          {/* Asset breakdown */}
          <div className="flex-1 w-full space-y-2.5">
            {allocation.map((a) => (
              <div key={a.symbol} className="flex items-center gap-3">
                {/* Token logo */}
                <TokenIcon symbol={a.symbol} size={16} />
                {/* Name */}
                <span className="text-xs font-mono text-white/70 w-10">{a.symbol}</span>
                {/* Bar */}
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${a.pct}%`, backgroundColor: a.color, opacity: 0.7 }}
                  />
                </div>
                {/* Pct */}
                <span className="text-[11px] font-mono text-steel/60 w-10 text-right">{a.pct}%</span>
                {/* Value */}
                <span className="text-[11px] font-mono text-white/50 w-20 text-right">
                  ${a.value.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Exposure summary */}
        <div className="mt-5 pt-4 border-t border-white/[0.04] grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-0.5">Deployed</span>
            <span className="text-sm font-display font-semibold text-white">{exposureSummary.deployedPct}%</span>
          </div>
          <div>
            <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-0.5">Idle</span>
            <span className="text-sm font-display font-semibold text-white">{exposureSummary.idlePct}%</span>
          </div>
          <div>
            <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-0.5">Concentration</span>
            <span className="text-sm font-display font-semibold text-amber-warn">{exposureSummary.concentrationRisk}</span>
          </div>
          <div>
            <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-0.5">Posture</span>
            <span className="text-sm font-display font-semibold text-cyan">{exposureSummary.posture}</span>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
