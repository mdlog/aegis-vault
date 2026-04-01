import SectionWrapper from './SectionWrapper';

const steps = [
  {
    number: '01',
    title: 'Deposit into Vault',
    description: 'Connect your wallet and deposit assets into a dedicated on-chain vault contract. Your capital remains under smart contract custody at all times.',
    status: 'READY',
    statusColor: 'text-emerald-soft',
    dotColor: 'bg-emerald-soft',
    accent: 'border-emerald-soft/20',
  },
  {
    number: '02',
    title: 'Define Risk Mandate',
    description: 'Set your risk parameters: maximum position size, daily loss limits, allowed assets, cooldown periods, and global stop-loss thresholds.',
    status: 'CONFIGURED',
    statusColor: 'text-cyan',
    dotColor: 'bg-cyan',
    accent: 'border-cyan/20',
  },
  {
    number: '03',
    title: 'AI Evaluates Markets',
    description: 'The inference engine processes market signals — price action, volatility, momentum — and generates a structured decision with a confidence score.',
    status: 'ANALYZING',
    statusColor: 'text-cyan',
    dotColor: 'bg-cyan',
    accent: 'border-cyan/20',
  },
  {
    number: '04',
    title: 'Policy Engine Validates',
    description: 'Every AI proposal passes through the on-chain policy engine. Size limits, asset whitelist, cooldown, and drawdown rules must all clear.',
    status: 'VALIDATING',
    statusColor: 'text-gold',
    dotColor: 'bg-gold',
    accent: 'border-gold/20',
  },
  {
    number: '05',
    title: 'Controlled Execution',
    description: 'Approved intents are executed by a whitelisted executor against verified DEX routes. Single-use intent hashes prevent replay attacks.',
    status: 'EXECUTING',
    statusColor: 'text-gold',
    dotColor: 'bg-gold',
    accent: 'border-gold/20',
  },
  {
    number: '06',
    title: 'Monitor & Control',
    description: 'Track vault health, review the execution journal, inspect AI reasoning summaries, and emergency-pause at any time. Full visibility. Full authority.',
    status: 'MONITORING',
    statusColor: 'text-emerald-soft',
    dotColor: 'bg-emerald-soft',
    accent: 'border-emerald-soft/20',
  },
];

export default function HowItWorks() {
  return (
    <SectionWrapper id="how-it-works" dark className="py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        {/* Section header */}
        <div className="text-center max-w-3xl mx-auto mb-16 lg:mb-20">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-8 h-px bg-cyan/40" />
            <span className="text-[11px] font-mono tracking-[0.2em] uppercase text-cyan/70">
              How It Works
            </span>
            <div className="w-8 h-px bg-cyan/40" />
          </div>
          <h2 className="text-3xl lg:text-4xl xl:text-[2.75rem] font-display font-semibold leading-[1.15] tracking-[-0.02em] text-white mb-5">
            Six steps from deposit
            <br />
            <span className="text-gradient-cyan">to disciplined execution.</span>
          </h2>
        </div>

        {/* Steps timeline */}
        <div className="relative">
          {/* Vertical connector line (desktop) */}
          <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2">
            <div className="w-full h-full bg-gradient-to-b from-emerald-soft/20 via-cyan/20 to-gold/20" />
          </div>

          <div className="space-y-6 lg:space-y-0">
            {steps.map((step, i) => {
              const isEven = i % 2 === 0;
              return (
                <div
                  key={step.number}
                  className={`relative lg:flex lg:items-center lg:min-h-[140px] ${
                    isEven ? 'lg:flex-row' : 'lg:flex-row-reverse'
                  }`}
                >
                  {/* Card */}
                  <div className={`lg:w-[calc(50%-32px)] ${isEven ? 'lg:pr-0' : 'lg:pl-0'}`}>
                    <div className={`group relative p-6 lg:p-7 rounded-lg glass-panel border-l-2 ${step.accent}
                      hover:border-white/[0.08] transition-all duration-500`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] font-mono text-steel/40 tracking-wider">{step.number}</span>
                          <h3 className="text-base lg:text-lg font-display font-semibold text-white tracking-[-0.01em]">
                            {step.title}
                          </h3>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${step.dotColor} animate-pulse`} />
                          <span className={`text-[9px] font-mono tracking-[0.15em] uppercase ${step.statusColor}`}>
                            {step.status}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-steel leading-relaxed">
                        {step.description}
                      </p>
                    </div>
                  </div>

                  {/* Center node (desktop) */}
                  <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 w-8 h-8 rounded-full items-center justify-center bg-graphite border border-white/10">
                    <span className="text-[10px] font-mono text-gold">{step.number}</span>
                  </div>

                  {/* Spacer for opposite side */}
                  <div className="hidden lg:block lg:w-[calc(50%-32px)]" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </SectionWrapper>
  );
}
