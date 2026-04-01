import { useInView } from '../hooks/useInView';

export default function SectionWrapper({ children, id, className = '', dark = false }) {
  const [ref, isInView] = useInView();

  return (
    <section
      id={id}
      ref={ref}
      className={`relative overflow-hidden ${dark ? 'bg-charcoal' : 'bg-obsidian'} ${className}`}
    >
      <div
        className={`transition-all duration-1000 ease-out ${
          isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        {children}
      </div>
    </section>
  );
}
