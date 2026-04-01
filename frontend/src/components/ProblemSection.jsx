import SectionWrapper from './SectionWrapper';

const problems = [
  {
    number: '01',
    title: 'Reckless Execution',
    description: 'Most AI trading agents operate without hard limits. They maximize returns with zero accountability — until catastrophic loss.',
    indicator: { label: 'RISK UNBOUND', color: 'text-red-warn', bg: 'bg-red-warn/10', border: 'border-red-warn/20' },
  },
  {
    number: '02',
    title: 'Black-Box Opacity',
    description: 'Users hand capital to bots they cannot audit. No reasoning transparency. No decision journal. No verifiable proof of constraint adherence.',
    indicator: { label: 'NO VISIBILITY', color: 'text-amber-warn', bg: 'bg-amber-warn/10', border: 'border-amber-warn/20' },
  },
  {
    number: '03',
    title: 'Weak Risk Controls',
    description: 'Risk management is often an afterthought — a config flag, not a first-class on-chain enforcement layer.',
    indicator: { label: 'UNGUARDED', color: 'text-amber-warn', bg: 'bg-amber-warn/10', border: 'border-amber-warn/20' },
  },
  {
    number: '04',
    title: 'No Emergency Authority',
    description: 'When markets crash, users cannot pause, override, or withdraw. The bot keeps executing into drawdown.',
    indicator: { label: 'NO CONTROL', color: 'text-red-warn', bg: 'bg-red-warn/10', border: 'border-red-warn/20' },
  },
];

export default function ProblemSection() {
  return (
    <SectionWrapper id="problem" dark className="py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        {/* Section header */}
        <div className="max-w-2xl mb-16 lg:mb-20">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-px bg-red-warn/40" />
            <span className="text-[11px] font-mono tracking-[0.2em] uppercase text-red-warn/70">
              The Problem
            </span>
          </div>
          <h2 className="text-3xl lg:text-4xl xl:text-[2.75rem] font-display font-semibold leading-[1.15] tracking-[-0.02em] text-white mb-5">
            Autonomous trading without discipline
            <span className="text-steel"> is not innovation — </span>
            it's a liability.
          </h2>
          <p className="text-base text-steel leading-relaxed">
            The current landscape of AI-driven DeFi is built on trust assumptions
            that serious capital cannot accept.
          </p>
        </div>

        {/* Problem cards */}
        <div className="grid md:grid-cols-2 gap-4 lg:gap-5">
          {problems.map((problem) => (
            <div
              key={problem.number}
              className="group relative p-6 lg:p-8 rounded-lg glass-panel
                hover:border-white/[0.08] transition-all duration-500"
            >
              {/* Number */}
              <div className="text-[11px] font-mono text-steel/40 tracking-wider mb-4">
                {problem.number}
              </div>

              {/* Title */}
              <h3 className="text-lg lg:text-xl font-display font-semibold text-white mb-3 tracking-[-0.01em]">
                {problem.title}
              </h3>

              {/* Description */}
              <p className="text-sm text-steel leading-relaxed mb-5">
                {problem.description}
              </p>

              {/* Status indicator */}
              <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded border ${problem.indicator.bg} ${problem.indicator.border}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${problem.indicator.color.replace('text-', 'bg-')} animate-pulse`} />
                <span className={`text-[10px] font-mono tracking-[0.15em] uppercase ${problem.indicator.color}`}>
                  {problem.indicator.label}
                </span>
              </div>

              {/* Hover accent line */}
              <div className="absolute bottom-0 left-6 right-6 h-px bg-gradient-to-r from-red-warn/0 via-red-warn/20 to-red-warn/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            </div>
          ))}
        </div>

        {/* Bottom statement */}
        <div className="mt-16 pt-10 border-t border-white/[0.04] text-center">
          <p className="text-lg lg:text-xl text-white/60 font-display italic max-w-2xl mx-auto">
            "Serious capital demands disciplined automation — not unaccountable algorithms."
          </p>
        </div>
      </div>
    </SectionWrapper>
  );
}
