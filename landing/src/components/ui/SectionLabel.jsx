export default function SectionLabel({ children, color = 'text-steel/50' }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-6 h-px bg-current opacity-30" />
      <span className={`text-[10px] font-mono tracking-[0.2em] uppercase ${color}`}>
        {children}
      </span>
    </div>
  );
}
