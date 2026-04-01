import GlassPanel from './GlassPanel';

export default function MetricCard({ label, value, subValue, accent = 'text-white', icon, className = '' }) {
  return (
    <GlassPanel className={`p-5 ${className}`}>
      <div className="flex items-start justify-between mb-3">
        <span className="text-[10px] font-mono tracking-[0.15em] uppercase text-steel/60">{label}</span>
        {icon && <span className="text-steel/30">{icon}</span>}
      </div>
      <div className={`text-2xl lg:text-3xl font-display font-semibold tracking-tight ${accent}`}>
        {value}
      </div>
      {subValue && (
        <div className="text-xs font-mono text-steel/50 mt-1">{subValue}</div>
      )}
    </GlassPanel>
  );
}
