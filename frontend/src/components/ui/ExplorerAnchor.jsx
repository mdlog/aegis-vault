import { ExternalLink } from 'lucide-react';

export default function ExplorerAnchor({
  href,
  label,
  children,
  className = '',
  iconClassName = 'w-3 h-3',
  title,
}) {
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title || label}
      className={`inline-flex items-center gap-1 ${className}`.trim()}
    >
      {children || <span>{label}</span>}
      <ExternalLink className={iconClassName} />
    </a>
  );
}
