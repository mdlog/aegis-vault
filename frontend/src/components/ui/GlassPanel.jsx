export default function GlassPanel({ children, className = '', gold = false, hover = false, onClick }) {
  const base = gold ? 'glass-panel-gold' : 'glass-panel';
  const hoverCls = hover ? 'hover:border-white/[0.12] cursor-pointer' : '';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`${base} rounded-lg ${hoverCls} transition-all duration-300 ${className}`} onClick={onClick}>
      {children}
    </Tag>
  );
}
