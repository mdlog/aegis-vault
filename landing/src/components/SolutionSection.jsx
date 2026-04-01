import SectionWrapper from './SectionWrapper';

const pillars = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    ),
    label: 'AI-Managed',
    title: 'Intelligent Execution',
    description: 'An AI inference engine evaluates market conditions, generates structured decisions with confidence scores, and proposes actions — never acting without validation.',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    label: 'Policy-Constrained',
    title: 'On-chain Guardrails',
    description: 'Every trade must pass through an immutable policy engine. Position limits, loss thresholds, cooldowns, and asset whitelists are enforced at the contract level.',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    label: 'Verifiable',
    title: 'Full Transparency',
    description: 'Every execution, every decision, every reasoning summary is recorded. On-chain events and storage-backed journals create a complete, auditable trail.',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    label: 'Privacy-Preserving',
    title: 'Sealed Strategy Mode',
    description: 'Optional privacy-preserving execution ensures proprietary strategies stay sealed. Parameters and inference inputs remain confidential — even from the network.',
  },
];

export default function SolutionSection() {
  return (
    <SectionWrapper id="solution" className="py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        {/* Section header */}
        <div className="text-center max-w-3xl mx-auto mb-16 lg:mb-20">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-8 h-px bg-gold/40" />
            <span className="text-[11px] font-mono tracking-[0.2em] uppercase text-gold/70">
              The Solution
            </span>
            <div className="w-8 h-px bg-gold/40" />
          </div>
          <h2 className="text-3xl lg:text-4xl xl:text-[2.75rem] font-display font-semibold leading-[1.15] tracking-[-0.02em] text-white mb-5">
            Intelligence with discipline.
            <br />
            <span className="text-gradient-gold">Autonomy under control.</span>
          </h2>
          <p className="text-base text-steel leading-relaxed max-w-2xl mx-auto">
            Aegis Vault transforms autonomous trading into a verifiable, policy-governed system.
            The AI proposes. The contract enforces. Every action is accountable.
          </p>
        </div>

        {/* Pillar cards */}
        <div className="grid md:grid-cols-2 gap-5">
          {pillars.map((pillar, i) => (
            <div
              key={i}
              className="group relative p-8 lg:p-10 rounded-lg glass-panel-gold
                hover:border-gold/30 transition-all duration-500"
            >
              {/* Icon + label */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded flex items-center justify-center bg-gold/10 text-gold/80">
                  {pillar.icon}
                </div>
                <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-gold/60">
                  {pillar.label}
                </span>
              </div>

              {/* Title */}
              <h3 className="text-xl font-display font-semibold text-white mb-3 tracking-[-0.01em]">
                {pillar.title}
              </h3>

              {/* Description */}
              <p className="text-sm text-steel leading-relaxed">
                {pillar.description}
              </p>

              {/* Corner accent */}
              <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden rounded-tr-lg">
                <div className="absolute top-3 right-3 w-px h-6 bg-gradient-to-b from-gold/20 to-transparent" />
                <div className="absolute top-3 right-3 w-6 h-px bg-gradient-to-l from-gold/20 to-transparent" />
              </div>
            </div>
          ))}
        </div>

        {/* Center statement */}
        <div className="mt-16 text-center">
          <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-full border border-emerald-soft/20 bg-emerald-dim/30">
            <span className="w-2 h-2 rounded-full bg-emerald-soft animate-pulse" />
            <span className="text-xs font-mono tracking-[0.1em] uppercase text-emerald-soft/90">
              Vault Status: All Systems Operational
            </span>
          </div>
        </div>
      </div>
    </SectionWrapper>
  );
}
