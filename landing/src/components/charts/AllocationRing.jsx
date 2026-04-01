import { allocation } from '../../data/mockData';

export default function AllocationRing({ size = 180 }) {
  const r = size / 2;
  const innerR = r * 0.65;
  const strokeW = r * 0.2;
  const circumference = 2 * Math.PI * (r - strokeW / 2);

  let accumulated = 0;
  const segments = allocation.map((a) => {
    const offset = accumulated;
    accumulated += a.pct;
    return { ...a, offset };
  });

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {/* Background ring */}
        <circle
          cx={r} cy={r} r={r - strokeW / 2}
          fill="none" stroke="rgba(138,138,154,0.06)" strokeWidth={strokeW}
        />
        {/* Segments */}
        {segments.map((seg) => (
          <circle
            key={seg.symbol}
            cx={r} cy={r} r={r - strokeW / 2}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeW}
            strokeDasharray={`${(seg.pct / 100) * circumference} ${circumference}`}
            strokeDashoffset={-(seg.offset / 100) * circumference}
            strokeLinecap="butt"
            transform={`rotate(-90 ${r} ${r})`}
            opacity={0.8}
            className="transition-all duration-500"
          />
        ))}
        {/* Inner circle */}
        <circle cx={r} cy={r} r={innerR} fill="#0a0a0f" />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] font-mono tracking-[0.15em] uppercase text-steel/50">Deployed</span>
        <span className="text-lg font-display font-semibold text-white">74.9%</span>
      </div>
    </div>
  );
}
