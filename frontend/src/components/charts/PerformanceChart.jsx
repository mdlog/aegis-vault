import { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';

// Unified performance chart — one canvas, 3 metrics via tab toggle.
// Replaces the previous 3 stacked sections (NAV + PnL + Drawdown) to save
// vertical space on vault detail. Each metric reuses the same x-axis data so
// the switch is instant and preserves scroll position.

const METRICS = [
  { key: 'nav', label: 'NAV', color: '#4cc9f0', axis: 'usd' },
  { key: 'pnl', label: 'PnL', color: '#34d399', axis: 'usd-signed' },
  { key: 'dd', label: 'Drawdown', color: '#ef4444', axis: 'pct' },
];

function formatUsd(v) {
  const abs = Math.abs(v);
  return abs >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
}

function formatUsdSigned(v) {
  const prefix = v > 0 ? '+' : v < 0 ? '-' : '';
  const abs = Math.abs(v);
  return abs >= 1000 ? `${prefix}$${(abs / 1000).toFixed(1)}k` : `${prefix}$${abs.toFixed(0)}`;
}

function formatPct(v) {
  return `${v}%`;
}

function PerformanceTooltip({ active, payload, activeMetric }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload || {};
  const label = point.fullLabel || point.date || '';
  const value = payload[0].value;
  const meta = METRICS.find((m) => m.key === activeMetric) || METRICS[0];
  let display;
  if (meta.axis === 'pct') display = `${value.toFixed(2)}%`;
  else if (meta.axis === 'usd-signed') display = formatUsdSigned(value);
  else display = `$${value.toLocaleString()}`;
  const tone =
    meta.key === 'pnl'
      ? value >= 0
        ? 'text-emerald-soft'
        : 'text-red-warn'
      : meta.key === 'dd'
        ? 'text-red-warn'
        : 'text-white';
  return (
    <div className="glass-panel rounded-lg px-3 py-2 border border-white/[0.08]">
      <div className="text-[10px] font-mono text-steel/60 mb-1">{label}</div>
      <div className={`text-sm font-display font-semibold ${tone}`}>{display}</div>
      <div className="text-[9px] font-mono text-steel/45 mt-0.5 uppercase tracking-wider">
        {meta.label}
      </div>
    </div>
  );
}

export default function PerformanceChart({
  height = 260,
  navData = [],
  pnlData = [],
  drawdownData = [],
  defaultMetric = 'nav',
  emptyLabel = 'No history yet. Charts populate as the orchestrator emits cycle snapshots.',
}) {
  const [active, setActive] = useState(defaultMetric);
  const metric = METRICS.find((m) => m.key === active) || METRICS[0];

  const dataMap = { nav: navData, pnl: pnlData, dd: drawdownData };
  const data = dataMap[active] || [];
  const hasData = data.length > 0;

  // Which field of each row we plot
  const dataKey = active;

  // Y-axis config derived from metric type
  const yFormatter = metric.axis === 'pct' ? formatPct : metric.axis === 'usd-signed' ? formatUsdSigned : formatUsd;
  const yDomain =
    metric.axis === 'pct'
      ? ([min, max]) => [Math.min(-1, min - 1), Math.max(0.5, max + 0.5)]
      : metric.axis === 'usd-signed'
        ? ([min, max]) => {
            const pad = Math.max(Math.abs(max), Math.abs(min)) * 0.15 || 1;
            return [Math.min(0, min) - pad, Math.max(0, max) + pad];
          }
        : ([min, max]) => {
            const pad = Math.max(1, (max - min) * 0.1);
            return [min - pad, max + pad];
          };

  const gradId = `perfGrad-${active}`;

  return (
    <div>
      {/* Metric toggle tabs */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div
          role="tablist"
          aria-label="Performance metric"
          className="inline-flex items-center p-1 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'var(--ed-ghost-border)' }}
        >
          {METRICS.map((m) => {
            const isActive = active === m.key;
            const count = (dataMap[m.key] || []).length;
            return (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(m.key)}
                className="px-3 py-1.5 text-[11px] font-mono tracking-wide uppercase rounded-md transition-all"
                style={{
                  background: isActive ? 'rgba(201,168,76,0.12)' : 'transparent',
                  color: isActive ? 'var(--ed-gold-ink)' : 'var(--ed-steel-400)',
                  boxShadow: isActive ? 'var(--ed-ghost-border-gold)' : 'none',
                  cursor: 'pointer',
                }}
              >
                {m.label}
                <span
                  className="ml-1.5 opacity-60"
                  style={{ fontSize: 9 }}
                  aria-hidden="true"
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {!hasData ? (
        <div
          className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] flex items-center justify-center text-xs text-steel/40 px-4 text-center"
          style={{ height }}
        >
          {emptyLabel}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={metric.color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={metric.color} stopOpacity={0} />
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
              domain={yDomain}
              tick={{ fontSize: 10, fill: '#8a8a9a', fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={yFormatter}
              width={56}
            />
            {(metric.axis === 'usd-signed' || metric.axis === 'pct') && (
              <ReferenceLine y={0} stroke="#ffffff" strokeOpacity={0.15} strokeDasharray="2 2" />
            )}
            <Tooltip
              content={<PerformanceTooltip activeMetric={active} />}
              cursor={{ stroke: 'rgba(255,255,255,0.18)', strokeDasharray: '3 3' }}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={metric.color}
              strokeWidth={1.6}
              fill={`url(#${gradId})`}
              dot={false}
              activeDot={{ r: 3.5, fill: metric.color, stroke: '#0a0a0f', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
