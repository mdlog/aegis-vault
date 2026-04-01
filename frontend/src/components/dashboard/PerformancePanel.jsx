import { useState } from 'react';
import { vaultOverview, performanceSnapshots } from '../../data/mockData';
import GlassPanel from '../ui/GlassPanel';
import SectionLabel from '../ui/SectionLabel';
import NavChart from '../charts/NavChart';
import DrawdownChart from '../charts/DrawdownChart';

const periods = ['24h', '7d', '30d', 'all'];

export default function PerformancePanel() {
  const [period, setPeriod] = useState('30d');
  const snap = performanceSnapshots[period];

  return (
    <div>
      <SectionLabel color="text-cyan/60">Performance</SectionLabel>
      <GlassPanel className="p-5">
        {/* Period tabs */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1">
            {periods.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-all duration-200
                  ${p === period
                    ? 'bg-white/[0.08] text-white border border-white/[0.08]'
                    : 'text-steel/50 hover:text-steel/80'
                  }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="text-right">
            <span className={`text-lg font-display font-semibold ${snap.returnPct >= 0 ? 'text-emerald-soft' : 'text-red-warn'}`}>
              {snap.returnPct >= 0 ? '+' : ''}{snap.returnPct}%
            </span>
            <span className="text-[10px] font-mono text-steel/40 ml-2">
              ${snap.returnUsd.toLocaleString()}
            </span>
          </div>
        </div>

        {/* NAV Chart */}
        <div className="mb-4">
          <NavChart height={180} />
        </div>

        {/* Summary metrics row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-white/[0.04]">
          <div>
            <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/40 block mb-0.5">Realized PnL</span>
            <span className="text-sm font-display font-semibold text-emerald-soft">
              +${vaultOverview.pnlRealized.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/40 block mb-0.5">Unrealized PnL</span>
            <span className="text-sm font-display font-semibold text-cyan">
              +${vaultOverview.pnlUnrealized.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/40 block mb-0.5">Max Drawdown</span>
            <span className="text-sm font-display font-semibold text-red-warn">
              -{vaultOverview.maxDrawdown}%
            </span>
          </div>
          <div>
            <span className="text-[9px] font-mono tracking-[0.1em] uppercase text-steel/40 block mb-0.5">Sharpe Ratio</span>
            <span className="text-sm font-display font-semibold text-white">
              {vaultOverview.sharpeRatio}
            </span>
          </div>
        </div>

        {/* Drawdown chart */}
        <div className="mt-4 pt-3 border-t border-white/[0.04]">
          <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-2">Drawdown</span>
          <DrawdownChart height={100} />
        </div>
      </GlassPanel>
    </div>
  );
}
