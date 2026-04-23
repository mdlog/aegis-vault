// Shared editorial primitives for the Aegis dashboard / operator redesign.
// Companion to editorial/index.jsx (which holds the older Eyebrow/Chip/MonoKV
// variants still used by other pages). These atoms mirror the mockup's voice:
// obsidian surfaces, ghost hairlines, italic serif numerals, mono eyebrows.
// Constants and helpers live in editorial/tokens.js so Fast Refresh can treat
// this file as "components-only".

import { cx, ACCENTS } from './tokens';

/* ─────────────── Eyebrow ─────────────── */

export function EyebrowMono({ tone = 'gold', className = '', children }) {
  const tones = {
    gold:    'text-[var(--ed-gold)]',
    cyan:    'text-[var(--ed-cyan)]',
    emerald: 'text-[#8AE6C2]',
    muted:   'text-[var(--ed-steel-400)]',
    amber:   'text-[#F5C97E]',
    rose:    'text-[#F4A0B3]',
  };
  return (
    <span className={cx('ed-mono text-[10.5px] uppercase tracking-[0.28em]', tones[tone], className)}>
      {children}
    </span>
  );
}

/* ─────────────── Status dot (breathing halo) ─────────────── */

export function StatusDot({ tone = 'emerald', size = 7, pulse = true }) {
  const color = ACCENTS[tone] || ACCENTS.steel;
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size + 4, height: size + 4 }}>
      {pulse && (
        <span
          aria-hidden
          className="ed-breathe absolute inset-0 rounded-full"
          style={{ background: color, opacity: 0.35, filter: 'blur(3px)' }}
        />
      )}
      <span
        className="relative rounded-full"
        style={{ width: size, height: size, background: color, boxShadow: '0 0 0 2px rgba(10,10,12,0.85)' }}
      />
    </span>
  );
}

/* ─────────────── Tone chip (richer than editorial/index.jsx Chip) ─────────────── */

export function ToneChip({ tone = 'steel', leading, dense = false, className = '', children }) {
  const tones = {
    steel:   'bg-white/[0.05] text-[var(--ed-steel-200)] ring-1 ring-inset ring-white/10',
    gold:    'bg-[rgba(201,168,76,0.08)] text-[var(--ed-gold-ink)] ring-1 ring-inset ring-[rgba(201,168,76,0.28)]',
    cyan:    'bg-[rgba(76,201,240,0.08)] text-[var(--ed-cyan-ink)] ring-1 ring-inset ring-[rgba(76,201,240,0.24)]',
    emerald: 'bg-[rgba(16,185,129,0.12)] text-[#8AE6C2] ring-1 ring-inset ring-[rgba(16,185,129,0.28)]',
    amber:   'bg-[rgba(245,158,11,0.12)] text-[#F5C97E] ring-1 ring-inset ring-[rgba(245,158,11,0.28)]',
    rose:    'bg-[rgba(225,29,72,0.12)] text-[#F4A0B3] ring-1 ring-inset ring-[rgba(225,29,72,0.32)]',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-sm ed-mono uppercase tracking-[0.14em]',
        dense ? 'px-1.5 py-[3px] text-[10px]' : 'px-2 py-[5px] text-[10.5px]',
        tones[tone],
        className,
      )}
    >
      {leading}{children}
    </span>
  );
}

/* ─────────────── Ghost numeral (editorial backdrop) ─────────────── */

export function GhostNumeral({ n, className = '', style }) {
  const text = typeof n === 'number' ? String(n).padStart(2, '0') : n;
  return (
    <span aria-hidden className={cx('ed-hero-ghost-numeral', className)} style={style}>{text}</span>
  );
}

/* ─────────────── Token avatar (conic moonlight) ─────────────── */

export function TokenAvatar({ symbol = 'A', size = 32 }) {
  const grads = [
    'conic-gradient(from 120deg,#BA9EFF,#FF59E3,#00EEFC,#BA9EFF)',
    'conic-gradient(from   0deg,#FF59E3,#8455EF,#00EEFC,#FF59E3)',
    'conic-gradient(from 240deg,#00EEFC,#BA9EFF,#FF59E3,#00EEFC)',
  ];
  let h = 0;
  for (let i = 0; i < symbol.length; i += 1) h = (h << 5) - h + symbol.charCodeAt(i);
  const g = grads[Math.abs(h) % 3];
  return (
    <div
      className="relative flex items-center justify-center rounded-full ed-mono font-bold text-[#09090B] flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: g,
        boxShadow: '0 6px 14px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(255,255,255,0.12)',
      }}
    >
      <span
        aria-hidden
        className="absolute inset-[1px] rounded-full"
        style={{ background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.28), transparent 45%)' }}
      />
      <span className="relative z-10" style={{ fontSize: size * 0.38 }}>{symbol.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

/* ─────────────── Sparkline (SVG area) ─────────────── */

export function Sparkline({ data, color = ACCENTS.gold, fill = true, height = 44, className = '' }) {
  if (!data || data.length < 2) return null;
  const w = 200;
  const h = height;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [i * (w / (data.length - 1)), h - ((v - min) / span) * (h - 6) - 3]);
  const d = 'M' + pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' L');
  const area = d + ` L${w},${h} L0,${h} Z`;
  const gradId = 'ed-spark-' + Math.abs(color.split('').reduce((a, c) => a * 33 + c.charCodeAt(0), 0));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cx('w-full', className)} style={{ height }}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gradId})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ─────────────── Bar series (intensity ramp) ─────────────── */

export function BarSeries({ data, color = ACCENTS.cyan, height = 36, className = '' }) {
  const max = Math.max(...data) || 1;
  return (
    <div className={cx('flex items-end gap-[3px]', className)} style={{ height }}>
      {data.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${Math.max(6, (v / max) * 100)}%`,
            background: color,
            opacity: 0.35 + 0.65 * (i / data.length),
          }}
        />
      ))}
    </div>
  );
}

/* ─────────────── Risk gauge (tick-ringed radial) ─────────────── */

export function RiskGauge({ value = 25, max = 100, label = 'LOW', tone = 'emerald' }) {
  const r = 62;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, value / max);
  const dash = c * pct;
  const color = ACCENTS[tone] || ACCENTS.cyan;
  return (
    <div className="relative w-full aspect-square max-w-[180px]">
      <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
        <circle cx="80" cy="80" r={r} fill="none" className="ed-gauge-track" strokeWidth="2" />
        <circle
          cx="80" cy="80" r={r}
          fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
        {Array.from({ length: 32 }).map((_, i) => {
          const a = (i / 32) * Math.PI * 2;
          const x1 = 80 + Math.cos(a) * (r + 6);
          const y1 = 80 + Math.sin(a) * (r + 6);
          const x2 = 80 + Math.cos(a) * (r + (i % 4 === 0 ? 11 : 8));
          const y2 = 80 + Math.sin(a) * (r + (i % 4 === 0 ? 11 : 8));
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <EyebrowMono tone="muted">risk score</EyebrowMono>
        <div className="ed-italic text-[52px] leading-none" style={{ color: 'var(--ed-steel-50)' }}>{value}</div>
        <ToneChip
          tone={tone === 'emerald' ? 'emerald' : tone === 'amber' ? 'amber' : 'rose'}
          dense
          leading={<StatusDot tone={tone} size={5} pulse={false} />}
        >
          {label}
        </ToneChip>
      </div>
    </div>
  );
}

/* ─────────────── Section head (marker + title + trailing slot) ─────────────── */

export function SectionHead({ marker, title, trailing, ghostNum, className = '', children }) {
  return (
    <section className={cx('relative', className)}>
      {ghostNum && (
        <div aria-hidden className="absolute -top-8 right-0 pointer-events-none select-none opacity-60">
          <GhostNumeral n={ghostNum} style={{ fontSize: 84 }} />
        </div>
      )}
      <div className="flex items-start gap-4 mb-5">
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          {marker && (
            <div className="flex items-center gap-3">
              <EyebrowMono tone="gold">§ {marker}</EyebrowMono>
              <div className="flex-1 ed-hairline" />
            </div>
          )}
          {title && (
            <h3
              className="ed-display leading-[1.2] m-0"
              style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ed-steel-50)' }}
            >
              {title}
            </h3>
          )}
        </div>
        {trailing && <div className="flex items-center gap-2 pt-1 flex-shrink-0">{trailing}</div>}
      </div>
      {children}
    </section>
  );
}
