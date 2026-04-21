import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { navHistory } from '../../data/mockData';

// Tooltip pulls `fullLabel` from the data point (which includes time) when
// available — the axis only shows a compact date so it doesn't crowd, but the
// tooltip still gives precise timestamp context on hover.
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload || {};
  const label = point.fullLabel || point.date || '';
  return (
    <div className="glass-panel rounded-lg px-3 py-2 border border-white/[0.08]">
      <div className="text-[10px] font-mono text-steel/60 mb-1">{label}</div>
      <div className="text-sm font-display font-semibold text-white">
        ${payload[0].value.toLocaleString()}
      </div>
    </div>
  );
}

export default function NavChart({ height = 200, data = navHistory, emptyLabel = 'No NAV history yet' }) {
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
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
        <defs>
          <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4cc9f0" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#4cc9f0" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: '#8a8a9a', fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          // minTickGap thins labels automatically based on pixel distance —
          // 60px keeps roughly 4–6 labels on a standard width without overlap.
          minTickGap={64}
          tickMargin={10}
          height={30}
        />
        <YAxis
          domain={([min, max]) => {
            const range = max - min;
            const pad = Math.max(range * 0.1, Math.max(max * 0.005, 1));
            return [min - pad, max + pad];
          }}
          tick={{ fontSize: 10, fill: '#8a8a9a', fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`)}
          width={52}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(76,201,240,0.3)', strokeDasharray: '3 3' }} />
        <Area
          type="monotone"
          dataKey="nav"
          stroke="#4cc9f0"
          strokeWidth={1.5}
          fill="url(#navGrad)"
          dot={false}
          activeDot={{ r: 3, fill: '#4cc9f0', stroke: '#0a0a0f', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
