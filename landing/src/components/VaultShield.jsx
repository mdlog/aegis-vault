export default function VaultShield({ size = 400, className = '' }) {
  const r = size / 2;
  const rings = [
    { radius: r * 0.92, stroke: 'rgba(201,168,76,0.15)', width: 1, dash: '4 8' },
    { radius: r * 0.82, stroke: 'rgba(201,168,76,0.25)', width: 1.5, dash: '0' },
    { radius: r * 0.68, stroke: 'rgba(76,201,240,0.12)', width: 1, dash: '6 12' },
    { radius: r * 0.55, stroke: 'rgba(76,201,240,0.2)', width: 1.5, dash: '0' },
    { radius: r * 0.38, stroke: 'rgba(201,168,76,0.3)', width: 2, dash: '0' },
  ];

  const tickCount = 72;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const angle = (i / tickCount) * Math.PI * 2 - Math.PI / 2;
    const inner = r * 0.85;
    const outer = r * 0.89;
    const isMajor = i % 6 === 0;
    return {
      x1: r + Math.cos(angle) * inner,
      y1: r + Math.sin(angle) * inner,
      x2: r + Math.cos(angle) * (isMajor ? outer + 4 : outer),
      y2: r + Math.sin(angle) * (isMajor ? outer + 4 : outer),
      opacity: isMajor ? 0.4 : 0.15,
      width: isMajor ? 1.5 : 0.5,
    };
  });

  // Radar sweep
  const sweepAngle = 45;
  const sweepGradientId = `sweep-${size}`;

  return (
    <div className={`relative ${className}`} style={{ width: size, height: size, maxWidth: '100%', aspectRatio: '1/1' }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        height="100%"
        className="absolute inset-0"
      >
        <defs>
          {/* Radar sweep gradient */}
          <linearGradient id={sweepGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(76,201,240,0)" />
            <stop offset="100%" stopColor="rgba(76,201,240,0.08)" />
          </linearGradient>
          {/* Core glow */}
          <radialGradient id="core-glow">
            <stop offset="0%" stopColor="rgba(201,168,76,0.3)" />
            <stop offset="40%" stopColor="rgba(201,168,76,0.08)" />
            <stop offset="100%" stopColor="rgba(201,168,76,0)" />
          </radialGradient>
          {/* Outer glow */}
          <radialGradient id="outer-glow">
            <stop offset="60%" stopColor="rgba(76,201,240,0)" />
            <stop offset="80%" stopColor="rgba(76,201,240,0.03)" />
            <stop offset="100%" stopColor="rgba(76,201,240,0)" />
          </radialGradient>
        </defs>

        {/* Background glow */}
        <circle cx={r} cy={r} r={r} fill="url(#outer-glow)" />

        {/* Concentric rings */}
        {rings.map((ring, i) => (
          <circle
            key={i}
            cx={r}
            cy={r}
            r={ring.radius}
            fill="none"
            stroke={ring.stroke}
            strokeWidth={ring.width}
            strokeDasharray={ring.dash}
            className={ring.dash !== '0' ? 'animate-rotate-slow' : ''}
            style={{
              transformOrigin: 'center',
              animationDuration: `${40 + i * 15}s`,
              animationDirection: i % 2 === 0 ? 'normal' : 'reverse',
            }}
          />
        ))}

        {/* Tick marks */}
        {ticks.map((tick, i) => (
          <line
            key={i}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke="rgba(201,168,76,0.5)"
            strokeWidth={tick.width}
            opacity={tick.opacity}
          />
        ))}

        {/* Radar sweep */}
        <g className="animate-rotate-slow" style={{ transformOrigin: 'center', animationDuration: '8s' }}>
          <path
            d={`M ${r} ${r} L ${r + r * 0.82} ${r} A ${r * 0.82} ${r * 0.82} 0 0 0 ${r + r * 0.82 * Math.cos(-sweepAngle * Math.PI / 180)} ${r + r * 0.82 * Math.sin(-sweepAngle * Math.PI / 180)} Z`}
            fill="url(#core-glow)"
            opacity={0.4}
          />
        </g>

        {/* Cross-hairs */}
        <line x1={r} y1={r - r * 0.42} x2={r} y2={r - r * 0.32} stroke="rgba(76,201,240,0.3)" strokeWidth={1} />
        <line x1={r} y1={r + r * 0.32} x2={r} y2={r + r * 0.42} stroke="rgba(76,201,240,0.3)" strokeWidth={1} />
        <line x1={r - r * 0.42} y1={r} x2={r - r * 0.32} y2={r} stroke="rgba(76,201,240,0.3)" strokeWidth={1} />
        <line x1={r + r * 0.32} y1={r} x2={r + r * 0.42} y2={r} stroke="rgba(76,201,240,0.3)" strokeWidth={1} />

        {/* Core glow */}
        <circle cx={r} cy={r} r={r * 0.25} fill="url(#core-glow)" className="animate-pulse-ring" />

        {/* Center dot */}
        <circle cx={r} cy={r} r={3} fill="#c9a84c" opacity={0.9} />
        <circle cx={r} cy={r} r={8} fill="none" stroke="rgba(201,168,76,0.4)" strokeWidth={1} />
      </svg>

      {/* Center label */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="text-gold font-mono text-xs tracking-[0.3em] uppercase opacity-70">Aegis</div>
          <div className="text-gold-light font-mono text-[10px] tracking-[0.2em] uppercase opacity-40 mt-0.5">Vault Core</div>
        </div>
      </div>
    </div>
  );
}
