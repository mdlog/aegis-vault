export default function PolicyChip({ label, value, icon }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="flex items-center gap-2.5">
        {icon && <span className="text-steel/40">{icon}</span>}
        <span className="text-xs text-steel/70">{label}</span>
      </div>
      <span className="text-xs font-mono text-white/80">{value}</span>
    </div>
  );
}
