const variants = {
  primary: 'bg-gold text-obsidian hover:bg-gold-light shadow-[0_0_20px_rgba(201,168,76,0.15)] hover:shadow-[0_0_30px_rgba(201,168,76,0.25)]',
  secondary: 'bg-white/[0.04] text-white/70 border border-white/10 hover:border-white/20 hover:text-white',
  danger: 'bg-red-warn/10 text-red-warn border border-red-warn/20 hover:bg-red-warn/20 hover:border-red-warn/40',
  ghost: 'text-steel hover:text-white/80',
  gold: 'bg-gold/10 text-gold border border-gold/20 hover:bg-gold/20 hover:border-gold/40',
};

export default function ControlButton({ children, variant = 'secondary', size = 'md', className = '', ...props }) {
  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-[11px]' : size === 'lg' ? 'px-7 py-3.5 text-sm' : 'px-5 py-2.5 text-xs';
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-medium tracking-[0.08em] uppercase rounded transition-all duration-300 ${sizeClass} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
