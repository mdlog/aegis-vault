import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid } from 'recharts';

// Tooltip uses `fullLabel` from the data point (full date + time) so hover
// still surfaces precise context even when the x-axis tick is compact.
function PnLTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  // Recharts renders two <Area> series (pnlPos + pnlNeg); we want the signed
  // `pnl` from the underlying data point, not whichever zero-clamped segment
  // happened to be picked up first.
  const point = payload[0].payload || {};
  const pnl = point.pnl != null ? point.pnl : payload[0].value;
  const label = point.fullLabel || point.date || '';
  const positive = pnl >= 0;
  return (
    <div className="glass-panel rounded-lg px-3 py-2 border border-white/[0.08]">
      <div className="text-[10px] font-mono text-steel/60 mb-1">{label}</div>
      <div className={`text-sm font-display font-semibold ${positive ? 'text-emerald-soft' : 'text-red-warn'}`}>
        {positive ? '+' : ''}${pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </div>
      <div className="text-[9px] font-mono text-steel/45 mt-0.5">
        {positive ? 'in profit' : 'in drawdown'} vs cost basis
      </div>
    </div>
  );
}

export default function PnLChart({ height = 180, data = [], emptyLabel = 'PnL history will appear after journal snapshots accumulate.' }) {
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

  // Split into positive/negative segments for two-tone fill
  const minPnL = Math.min(0, ...data.map((d) => d.pnl));
  const maxPnL = Math.max(0, ...data.map((d) => d.pnl));
  const range = Math.max(Math.abs(maxPnL), Math.abs(minPnL)) || 1;
  const pad = range * 0.15;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
        <defs>
          <linearGradient id="pnlPosGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="pnlNegGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: '#8a8a9a', fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          minTickGap={64}
          tickMargin={10}
          height={30}
        />
        <YAxis
          domain={[minPnL - pad, maxPnL + pad]}
          tick={{ fontSize: 10, fill: '#8a8a9a', fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => {
            const abs = Math.abs(v);
            const prefix = v > 0 ? '+' : v < 0 ? '-' : '';
            if (abs >= 1000) return `${prefix}$${(abs / 1000).toFixed(1)}k`;
            return `${prefix}$${abs.toFixed(0)}`;
          }}
          width={56}
        />
        <Tooltip content={<PnLTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.18)', strokeDasharray: '3 3' }} />
        <ReferenceLine y={0} stroke="#ffffff" strokeOpacity={0.15} strokeDasharray="2 2" />
        <Area
          type="monotone"
          dataKey="pnlPos"
          stroke="#34d399"
          strokeWidth={1.5}
          fill="url(#pnlPosGrad)"
          dot={false}
          activeDot={{ r: 3, fill: '#34d399', stroke: '#0a0a0f', strokeWidth: 2 }}
          connectNulls
        />
        <Area
          type="monotone"
          dataKey="pnlNeg"
          stroke="#ef4444"
          strokeWidth={1.5}
          fill="url(#pnlNegGrad)"
          dot={false}
          activeDot={{ r: 3, fill: '#ef4444', stroke: '#0a0a0f', strokeWidth: 2 }}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
