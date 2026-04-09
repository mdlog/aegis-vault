import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { drawdownHistory } from '../../data/mockData';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-panel rounded-lg px-3 py-2">
      <div className="text-[10px] font-mono text-steel/60 mb-1">{label}</div>
      <div className="text-sm font-display font-semibold text-red-warn">
        {payload[0].value}%
      </div>
    </div>
  );
}

export default function DrawdownChart({ height = 140, data = drawdownHistory, emptyLabel = 'No drawdown history yet' }) {
  if (!data || data.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] flex items-center justify-center text-xs text-steel/40"
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.15} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 9, fill: '#8a8a9a', fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[-5, 0.5]}
          tick={{ fontSize: 9, fill: '#8a8a9a', fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}%`}
          width={36}
        />
        <ReferenceLine y={-10} stroke="rgba(239,68,68,0.3)" strokeDasharray="4 4" label="" />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="dd"
          stroke="#ef4444"
          strokeWidth={1}
          fill="url(#ddGrad)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
