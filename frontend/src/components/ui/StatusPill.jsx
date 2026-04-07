const variants = {
  active: { dot: 'bg-emerald-soft', text: 'text-emerald-soft', bg: 'bg-emerald-soft/10', border: 'border-emerald-soft/20' },
  healthy: { dot: 'bg-emerald-soft', text: 'text-emerald-soft', bg: 'bg-emerald-soft/10', border: 'border-emerald-soft/20' },
  low: { dot: 'bg-emerald-soft', text: 'text-emerald-soft', bg: 'bg-emerald-soft/10', border: 'border-emerald-soft/20' },
  normal: { dot: 'bg-emerald-soft', text: 'text-emerald-soft', bg: 'bg-emerald-soft/10', border: 'border-emerald-soft/20' },
  info: { dot: 'bg-cyan', text: 'text-cyan', bg: 'bg-cyan/10', border: 'border-cyan/20' },
  elevated: { dot: 'bg-amber-warn', text: 'text-amber-warn', bg: 'bg-amber-warn/10', border: 'border-amber-warn/20' },
  warning: { dot: 'bg-amber-warn', text: 'text-amber-warn', bg: 'bg-amber-warn/10', border: 'border-amber-warn/20' },
  critical: { dot: 'bg-red-warn', text: 'text-red-warn', bg: 'bg-red-warn/10', border: 'border-red-warn/20' },
  paused: { dot: 'bg-steel', text: 'text-steel', bg: 'bg-steel/10', border: 'border-steel/20' },
  blocked: { dot: 'bg-red-warn', text: 'text-red-warn', bg: 'bg-red-warn/10', border: 'border-red-warn/20' },
  review_required: { dot: 'bg-amber-warn', text: 'text-amber-warn', bg: 'bg-amber-warn/10', border: 'border-amber-warn/20' },
  owner_confirmation: { dot: 'bg-red-warn', text: 'text-red-warn', bg: 'bg-red-warn/10', border: 'border-red-warn/20' },
  auto_execute: { dot: 'bg-emerald-soft', text: 'text-emerald-soft', bg: 'bg-emerald-soft/10', border: 'border-emerald-soft/20' },
  gold: { dot: 'bg-gold', text: 'text-gold', bg: 'bg-gold/10', border: 'border-gold/20' },
  sealed: { dot: 'bg-gold', text: 'text-gold', bg: 'bg-gold/10', border: 'border-gold/20' },
  executed: { dot: 'bg-emerald-soft', text: 'text-emerald-soft', bg: 'bg-emerald-soft/10', border: 'border-emerald-soft/20' },
  skipped: { dot: 'bg-steel', text: 'text-steel', bg: 'bg-steel/10', border: 'border-steel/20' },
  passed: { dot: 'bg-emerald-soft', text: 'text-emerald-soft', bg: 'bg-emerald-soft/10', border: 'border-emerald-soft/20' },
  failed: { dot: 'bg-red-warn', text: 'text-red-warn', bg: 'bg-red-warn/10', border: 'border-red-warn/20' },
};

export default function StatusPill({ label, variant = 'active', pulse = false, className = '' }) {
  const v = variants[variant] || variants.active;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${v.bg} ${v.border} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${v.dot} ${pulse ? 'animate-pulse' : ''}`} />
      <span className={`text-[10px] font-mono tracking-[0.12em] uppercase ${v.text}`}>
        {label}
      </span>
    </span>
  );
}
