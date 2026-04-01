export default function DashboardShield({ size = 320, riskScore: propRiskScore, riskLevel: propRiskLevel }) {
  const r = size / 2;
  const riskScore = propRiskScore ?? 0;

  // Risk score determines the shield's visual state
  const riskColor = riskScore < 40 ? '#34d399' : riskScore < 65 ? '#f59e0b' : '#ef4444';
  const riskGlow = riskScore < 40 ? 'rgba(52,211,153,0.15)' : riskScore < 65 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)';

  // Confidence arc (risk score inverted = health)
  const health = 100 - riskScore;
  const arcR = r * 0.88;
  const arcCircumference = 2 * Math.PI * arcR;
  const arcLength = (health / 100) * arcCircumference * 0.75; // 270 degree arc

  const rings = [
    { radius: r * 0.95, stroke: 'rgba(138,138,154,0.06)', width: 0.5, dash: '2 6' },
    { radius: r * 0.88, stroke: 'rgba(201,168,76,0.12)', width: 1, dash: '0' },
    { radius: r * 0.72, stroke: 'rgba(76,201,240,0.08)', width: 0.5, dash: '4 8' },
    { radius: r * 0.58, stroke: 'rgba(201,168,76,0.15)', width: 1, dash: '0' },
    { radius: r * 0.42, stroke: 'rgba(76,201,240,0.1)', width: 0.5, dash: '3 6' },
    { radius: r * 0.30, stroke: 'rgba(201,168,76,0.2)', width: 1.5, dash: '0' },
  ];

  // Tick marks for outer ring
  const tickCount = 60;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const angle = (i / tickCount) * Math.PI * 2 - Math.PI / 2;
    const inner = r * 0.90;
    const outer = r * 0.94;
    const isMajor = i % 5 === 0;
    return {
      x1: r + Math.cos(angle) * inner,
      y1: r + Math.sin(angle) * inner,
      x2: r + Math.cos(angle) * (isMajor ? outer + 2 : outer),
      y2: r + Math.sin(angle) * (isMajor ? outer + 2 : outer),
      opacity: isMajor ? 0.35 : 0.1,
      width: isMajor ? 1 : 0.5,
    };
  });

  // Data points on the risk ring (simulated positions)
  const dataPoints = [
    { angle: 30, r: r * 0.65, size: 4, color: '#f7931a', label: 'BTC' },
    { angle: 120, r: r * 0.55, size: 3, color: '#627eea', label: 'ETH' },
    { angle: 210, r: r * 0.48, size: 2.5, color: '#4cc9f0', label: '0G' },
    { angle: 300, r: r * 0.60, size: 3.5, color: '#2775ca', label: 'USDC' },
  ];

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <defs>
          <radialGradient id="shield-core">
            <stop offset="0%" stopColor={riskGlow} />
            <stop offset="50%" stopColor="rgba(201,168,76,0.05)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <radialGradient id="shield-outer">
            <stop offset="60%" stopColor="transparent" />
            <stop offset="85%" stopColor="rgba(76,201,240,0.02)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        {/* Outer ambient glow */}
        <circle cx={r} cy={r} r={r} fill="url(#shield-outer)" />

        {/* Concentric rings */}
        {rings.map((ring, i) => (
          <circle
            key={i} cx={r} cy={r} r={ring.radius}
            fill="none" stroke={ring.stroke} strokeWidth={ring.width}
            strokeDasharray={ring.dash}
            className={ring.dash !== '0' ? 'animate-rotate-slow' : ''}
            style={{
              transformOrigin: 'center',
              animationDuration: `${50 + i * 12}s`,
              animationDirection: i % 2 === 0 ? 'normal' : 'reverse',
            }}
          />
        ))}

        {/* Tick marks */}
        {ticks.map((tick, i) => (
          <line key={i} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2}
            stroke="rgba(201,168,76,0.5)" strokeWidth={tick.width} opacity={tick.opacity}
          />
        ))}

        {/* Health arc (the main indicator) */}
        <circle
          cx={r} cy={r} r={arcR}
          fill="none" stroke={riskColor} strokeWidth={3}
          strokeDasharray={`${arcLength} ${arcCircumference}`}
          strokeLinecap="round"
          transform={`rotate(-225 ${r} ${r})`}
          opacity={0.6}
          className="animate-glow-pulse"
        />

        {/* Radar sweep */}
        <g className="animate-rotate-slow" style={{ transformOrigin: 'center', animationDuration: '10s' }}>
          <line x1={r} y1={r} x2={r + r * 0.7} y2={r}
            stroke="rgba(76,201,240,0.15)" strokeWidth={0.5}
          />
          <circle cx={r + r * 0.7} cy={r} r={2} fill="rgba(76,201,240,0.3)" />
        </g>

        {/* Crosshairs */}
        {[0, 90, 180, 270].map((angle) => {
          const rad = (angle * Math.PI) / 180;
          return (
            <line key={angle}
              x1={r + Math.cos(rad) * r * 0.32} y1={r + Math.sin(rad) * r * 0.32}
              x2={r + Math.cos(rad) * r * 0.38} y2={r + Math.sin(rad) * r * 0.38}
              stroke="rgba(76,201,240,0.2)" strokeWidth={0.8}
            />
          );
        })}

        {/* Asset data points */}
        {dataPoints.map((pt) => {
          const rad = (pt.angle * Math.PI) / 180;
          const cx = r + Math.cos(rad) * pt.r;
          const cy = r + Math.sin(rad) * pt.r;
          return (
            <g key={pt.label}>
              <circle cx={cx} cy={cy} r={pt.size + 4} fill={pt.color} opacity={0.08} />
              <circle cx={cx} cy={cy} r={pt.size} fill={pt.color} opacity={0.7} />
            </g>
          );
        })}

        {/* Core glow */}
        <circle cx={r} cy={r} r={r * 0.22} fill="url(#shield-core)" className="animate-pulse-ring" />
        <circle cx={r} cy={r} r={3} fill="#c9a84c" opacity={0.9} />
        <circle cx={r} cy={r} r={8} fill="none" stroke="rgba(201,168,76,0.3)" strokeWidth={0.8} />
      </svg>

      {/* Center overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-steel/40 mb-1">Risk Score</span>
        <span className={`text-3xl font-display font-bold tracking-tight`} style={{ color: riskColor }}>
          {riskScore}
        </span>
        <span className="text-[10px] font-mono tracking-[0.15em] uppercase mt-0.5" style={{ color: riskColor, opacity: 0.7 }}>
          {propRiskLevel || (riskScore < 30 ? 'Low' : riskScore < 60 ? 'Moderate' : riskScore < 80 ? 'Elevated' : 'Critical')}
        </span>
      </div>
    </div>
  );
}
