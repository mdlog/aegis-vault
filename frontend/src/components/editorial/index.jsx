// Editorial design system primitives — "Minitia discipline × Aegis palette".
// Use these as-is across pages to keep the fortress/vault mood consistent.

import { createElement } from 'react';

// ─────────────── Eyebrow (§ section marker) ───────────────
export function Eyebrow({ section, title, tone = 'gold' }) {
  const toneClass = tone === 'steel' ? 'ed-eyebrow-steel' : tone === 'cyan' ? 'ed-eyebrow-cyan' : '';
  return (
    <div className="flex items-baseline gap-3.5 mb-2.5">
      <span className={`ed-eyebrow ${toneClass}`}>§ {section}</span>
      {title && (
        <span className="ed-mono text-[10.5px] text-[var(--ed-steel-400)] tracking-[0.22em] uppercase">
          {title}
        </span>
      )}
    </div>
  );
}

// ─────────────── Chip (status tag) ───────────────
export function Chip({ children, tone = 'steel' }) {
  return <span className={`ed-chip ed-chip-${tone}`}>{children}</span>;
}

// ─────────────── LiveBadge (streaming / live indicator) ───────────────
export function LiveBadge({ label = 'Live', subLabel = '0G Mainnet' }) {
  return (
    <span
      className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full"
      style={{
        background: 'rgba(16,185,129,0.08)',
        boxShadow: 'inset 0 0 0 1px rgba(16,185,129,0.25)',
      }}
    >
      <span className="ed-live-dot" />
      <span className="ed-mono text-[10px] tracking-[0.18em]" style={{ color: '#8AE6C2' }}>
        {label.toUpperCase()}
      </span>
      {subLabel && (
        <>
          <span style={{ width: 1, height: 10, background: 'rgba(16,185,129,0.25)' }} />
          <span
            className="ed-mono text-[10px] tracking-[0.14em] opacity-70"
            style={{ color: '#8AE6C2' }}
          >
            {subLabel}
          </span>
        </>
      )}
    </span>
  );
}

// ─────────────── MonoKV (key/value mono row) ───────────────
export function MonoKV({ k, v, color = 'var(--ed-steel-50)' }) {
  return (
    <div className="flex justify-between items-baseline py-1.5">
      <span className="ed-mono text-[10.5px] text-[var(--ed-steel-400)] tracking-[0.14em] uppercase">{k}</span>
      <span className="ed-mono text-[12px]" style={{ color }}>{v}</span>
    </div>
  );
}

// ─────────────── BigNumeric (hero-scale stat) ───────────────
export function BigNumeric({ value, prefix = '$', tone = 'var(--ed-steel-50)' }) {
  return (
    <div
      className="ed-display"
      style={{
        fontSize: 56,
        fontWeight: 700,
        color: tone,
        letterSpacing: '-0.04em',
        lineHeight: 1,
      }}
    >
      {prefix && (
        <span style={{ fontSize: 28, color: 'var(--ed-steel-400)', marginRight: 4, fontWeight: 400 }}>
          {prefix}
        </span>
      )}
      <span className="ed-mono" style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
        {value}
      </span>
    </div>
  );
}

// ─────────────── StatBlock (ordinary stat with label/value/sub) ───────────────
export function StatBlock({ label, value, sub, tone = 'var(--ed-steel-50)', big = false }) {
  return (
    <div>
      <div className="ed-mono text-[10px] text-[var(--ed-steel-400)] tracking-[0.16em] uppercase mb-2">
        {label}
      </div>
      <div
        className="ed-display"
        style={{ fontSize: big ? 42 : 28, fontWeight: 600, color: tone, letterSpacing: '-0.03em', lineHeight: 1 }}
      >
        {value}
      </div>
      {sub && <div className="ed-mono text-[11px] text-[var(--ed-steel-500)] mt-1.5">{sub}</div>}
    </div>
  );
}

// ─────────────── AreaSpark (inline SVG sparkline with gradient fill) ───────────────
// Gradient id is derived deterministically from the data + color (pure) so
// it's stable across re-renders. Callers with matching data happily share.
function sparkGradId(data, color, w, h) {
  const tag = `${data.length}-${data[0] ?? 0}-${data[data.length - 1] ?? 0}-${w}-${h}-${color}`;
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  return `ed-af-${(hash >>> 0).toString(36)}`;
}

export function AreaSpark({ data, color = 'var(--ed-cyan)', w = 320, h = 80 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - ((v - min) / rng) * (h - 8) - 4,
  ]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const fillD = d + ` L${w},${h} L0,${h} Z`;
  const gradId = sparkGradId(data, color, w, h);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#${gradId})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill={color} />
    </svg>
  );
}

// ─────────────── RiskDial (dial with tick marks + big numeral) ───────────────
export function RiskDial({ score = 32, level = 'Low', size = 180 }) {
  const R = size / 2 - 14;
  const C = 2 * Math.PI * R;
  const pct = Math.min(100, Math.max(0, score)) / 100;
  const color =
    score < 30 ? 'var(--ed-emerald)'
    : score < 60 ? 'var(--ed-amber)'
    : score < 80 ? '#F59E0B'
    : 'var(--ed-rose)';
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={`${C * pct} ${C}`}
          strokeLinecap="butt"
        />
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i / 24) * 2 * Math.PI;
          const x1 = size / 2 + Math.cos(a) * (R + 10);
          const y1 = size / 2 + Math.sin(a) * (R + 10);
          const x2 = size / 2 + Math.cos(a) * (R + 14);
          const y2 = size / 2 + Math.sin(a) * (R + 14);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(201,168,76,0.3)" strokeWidth="1" />;
        })}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span className="ed-mono text-[9px] tracking-[0.24em]" style={{ color: 'var(--ed-steel-500)' }}>
          RISK SCORE
        </span>
        <span
          className="ed-display"
          style={{ fontSize: 52, color, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1 }}
        >
          {score}
        </span>
        <span className="ed-italic text-[16px] text-[var(--ed-steel-200)] mt-0.5">{level}</span>
      </div>
    </div>
  );
}

// ─────────────── Allocation (stacked bar + legend) ───────────────
export function Allocation({ slices = [] }) {
  if (!slices.length) return null;
  const total = slices.reduce((s, x) => s + x.pct, 0);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex rounded-[2px] overflow-hidden" style={{ height: 10, background: 'rgba(255,255,255,0.04)' }}>
        {slices.map((s, i) => (
          <div key={i} style={{ width: `${(s.pct / total) * 100}%`, background: s.color }} title={s.label} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-[18px] gap-y-1.5">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span style={{ width: 8, height: 8, background: s.color, borderRadius: 2 }} />
              <span className="text-[12px]" style={{ color: 'var(--ed-steel-200)' }}>{s.label}</span>
            </div>
            <span className="ed-mono text-[11px]" style={{ color: 'var(--ed-steel-400)' }}>
              {s.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────── AegisShield (logo glyph) ───────────────
export function AegisShield({ size = 28, tone = 'gold' }) {
  const c = tone === 'gold' ? 'var(--ed-gold)' : 'var(--ed-steel-100)';
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} fill="none" aria-label="Aegis shield">
      <defs>
        <linearGradient id={`aegisGrad-${size}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E8CD74" />
          <stop offset="0.5" stopColor={c} />
          <stop offset="1" stopColor="#8A6F2E" />
        </linearGradient>
      </defs>
      <path
        d="M20 2 L34 7 V18 C34 27 28 34 20 38 C12 34 6 27 6 18 V7 Z"
        fill="none"
        stroke={`url(#aegisGrad-${size})`}
        strokeWidth="1.6"
      />
      <path
        d="M13 28 L20 12 L27 28 M16 22 H24"
        stroke={`url(#aegisGrad-${size})`}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="6" r="1" fill={c} />
      <circle cx="8" cy="10" r="0.8" fill={c} />
      <circle cx="32" cy="10" r="0.8" fill={c} />
    </svg>
  );
}

// ─────────────── AegisLogo (glyph + wordmark) ───────────────
export function AegisLogo({ size = 26, showWord = true }) {
  return (
    <div className="flex items-center gap-2.5">
      <AegisShield size={size} tone="gold" />
      {showWord && (
        <div className="flex flex-col leading-none">
          <span
            className="ed-display"
            style={{ fontSize: 17, fontWeight: 700, color: 'var(--ed-steel-50)', letterSpacing: '-0.02em' }}
          >
            Aegis <span style={{ color: 'var(--ed-gold)' }}>Vaults</span>
          </span>
          <span
            className="ed-mono mt-1"
            style={{ fontSize: 9, color: 'var(--ed-steel-500)', letterSpacing: '0.28em' }}
          >
            PROVABLE · AI · TREASURY
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────── HeroShield (large decorative landing hero) ───────────────
export function HeroShield({ size = 340 }) {
  return (
    <svg viewBox="0 0 400 460" width={size} height={size * 1.15} aria-hidden="true">
      <defs>
        <linearGradient id="heroShieldG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E8CD74" />
          <stop offset="0.45" stopColor="#C9A84C" />
          <stop offset="1" stopColor="#6B5320" />
        </linearGradient>
        <linearGradient id="heroShieldFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(201,168,76,0.08)" />
          <stop offset="1" stopColor="rgba(201,168,76,0)" />
        </linearGradient>
        <pattern id="heroHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(201,168,76,0.14)" strokeWidth="0.6" />
        </pattern>
      </defs>
      {[150, 175, 200, 225].map((r, i) => (
        <circle
          key={i}
          cx="200"
          cy="220"
          r={r}
          fill="none"
          stroke="rgba(201,168,76,0.10)"
          strokeWidth="0.6"
          strokeDasharray={i % 2 ? '2 4' : '1 6'}
        />
      ))}
      <path
        d="M200 20 L360 60 V220 C360 320 290 400 200 440 C110 400 40 320 40 220 V60 Z"
        fill="url(#heroShieldFill)"
        stroke="url(#heroShieldG)"
        strokeWidth="2"
      />
      <path
        d="M200 50 L330 80 V220 C330 305 275 375 200 410 C125 375 70 305 70 220 V80 Z"
        fill="url(#heroHatch)"
        stroke="rgba(201,168,76,0.3)"
        strokeWidth="1"
      />
      <path
        d="M200 85 L295 108 V220 C295 285 255 345 200 375 C145 345 105 285 105 220 V108 Z"
        fill="none"
        stroke="rgba(76,201,240,0.22)"
        strokeWidth="0.8"
      />
      {[[200, 30], [80, 65], [320, 65], [55, 180], [345, 180], [60, 300], [340, 300]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="3" fill="rgba(201,168,76,0.5)" />
          <circle cx={x} cy={y} r="1.2" fill="#C9A84C" />
        </g>
      ))}
      <path
        d="M140 290 L200 140 L260 290 M160 245 H240"
        stroke="url(#heroShieldG)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fontFamily="JetBrains Mono, monospace" fontSize="9" fill="rgba(201,168,76,0.55)" letterSpacing="2">
        <text x="200" y="16" textAnchor="middle">SEAL · N</text>
        <text x="200" y="456" textAnchor="middle">SEAL · S</text>
      </g>
    </svg>
  );
}

// ─────────────── EditorialCard (convenience wrapper) ───────────────
export function EditorialCard({ children, tone, className = '', style = {}, ...rest }) {
  const toneClass = tone === 'gold' ? 'ed-ghost-gold' : tone === 'cyan' ? 'ed-ghost-cyan' : '';
  return createElement(
    'div',
    {
      className: `ed-card ${toneClass} ${className}`.trim(),
      style,
      ...rest,
    },
    children,
  );
}
