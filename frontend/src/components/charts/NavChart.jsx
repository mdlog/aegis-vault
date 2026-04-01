import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { navHistory } from '../../data/mockData';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-panel rounded-lg px-3 py-2">
      <div className="text-[10px] font-mono text-steel/60 mb-1">{label}</div>
      <div className="text-sm font-display font-semibold text-white">
        ${payload[0].value.toLocaleString()}
      </div>
    </div>
  );
}

export default function NavChart({ height = 200 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={navHistory} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4cc9f0" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#4cc9f0" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: '#8a8a9a', fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={['dataMin - 2000', 'dataMax + 2000']}
          tick={{ fontSize: 10, fill: '#8a8a9a', fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          width={44}
        />
        <Tooltip content={<CustomTooltip />} />
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
