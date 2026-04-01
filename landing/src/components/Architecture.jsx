import SectionWrapper from './SectionWrapper';

const layers = [
  {
    id: 'user',
    label: 'User Capital',
    sublabel: 'Deposit & Withdraw',
    color: 'emerald-soft',
    borderColor: 'border-emerald-soft/30',
    bgColor: 'bg-emerald-soft/5',
    textColor: 'text-emerald-soft',
  },
  {
    id: 'vault',
    label: 'Vault Contract',
    sublabel: '0G Chain — Policy, Custody, Events',
    color: 'gold',
    borderColor: 'border-gold/30',
    bgColor: 'bg-gold/5',
    textColor: 'text-gold',
  },
  {
    id: 'orchestrator',
    label: 'Strategy Orchestrator',
    sublabel: 'Market Data → Prompt → Dispatch',
    color: 'cyan',
    borderColor: 'border-cyan/30',
    bgColor: 'bg-cyan/5',
    textColor: 'text-cyan',
  },
  {
    id: 'inference',
    label: 'AI Inference',
    sublabel: '0G Compute — Decision Engine',
    color: 'cyan',
    borderColor: 'border-cyan/30',
    bgColor: 'bg-cyan/5',
    textColor: 'text-cyan',
  },
  {
    id: 'policy',
    label: 'Risk Policy Engine',
    sublabel: 'On-chain Validation Layer',
    color: 'gold',
    borderColor: 'border-gold/30',
    bgColor: 'bg-gold/5',
    textColor: 'text-gold',
  },
  {
    id: 'execution',
    label: 'Execution Layer',
    sublabel: 'Whitelisted Executor → DEX Route',
    color: 'gold',
    borderColor: 'border-gold/30',
    bgColor: 'bg-gold/5',
    textColor: 'text-gold',
  },
  {
    id: 'storage',
    label: 'Audit & Storage',
    sublabel: '0G Storage — Journal, Logs, State',
    color: 'steel',
    borderColor: 'border-steel/20',
    bgColor: 'bg-steel/5',
    textColor: 'text-steel',
  },
];

export default function Architecture() {
  return (
    <SectionWrapper id="architecture" dark className="py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        {/* Section header */}
        <div className="text-center max-w-3xl mx-auto mb-16 lg:mb-20">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-8 h-px bg-cyan/40" />
            <span className="text-[11px] font-mono tracking-[0.2em] uppercase text-cyan/70">
              System Architecture
            </span>
            <div className="w-8 h-px bg-cyan/40" />
          </div>
          <h2 className="text-3xl lg:text-4xl xl:text-[2.75rem] font-display font-semibold leading-[1.15] tracking-[-0.02em] text-white mb-5">
            A verifiable intelligence system,
            <br />
            <span className="text-gradient-cyan">not a trading bot.</span>
          </h2>
          <p className="text-base text-steel leading-relaxed max-w-2xl mx-auto">
            Every layer of Aegis Vault has a defined responsibility.
            Capital never moves without policy validation, and every action leaves a permanent audit trail.
          </p>
        </div>

        <div className="grid lg:grid-cols-[1fr_auto_1fr] gap-8 lg:gap-12 items-start">
          {/* Left: Architecture diagram */}
          <div className="space-y-3">
            {layers.map((layer, i) => (
              <div key={layer.id}>
                <div
                  className={`relative p-4 lg:p-5 rounded-lg border ${layer.borderColor} ${layer.bgColor}
                    transition-all duration-300 hover:scale-[1.01]`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className={`text-sm font-display font-semibold ${layer.textColor} tracking-[-0.01em]`}>
                        {layer.label}
                      </h4>
                      <p className="text-[11px] font-mono text-steel/60 tracking-wide mt-0.5">
                        {layer.sublabel}
                      </p>
                    </div>
                    <div className={`w-2 h-2 rounded-full ${layer.textColor.replace('text-', 'bg-')} opacity-60`} />
                  </div>
                </div>
                {/* Arrow connector */}
                {i < layers.length - 1 && (
                  <div className="flex justify-center py-1">
                    <svg width="12" height="16" viewBox="0 0 12 16" className="text-white/10">
                      <path d="M6 0 L6 12 M2 8 L6 12 L10 8" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Center: Divider */}
          <div className="hidden lg:flex flex-col items-center py-8">
            <div className="w-px h-full bg-gradient-to-b from-transparent via-white/10 to-transparent" />
          </div>

          {/* Right: Component details */}
          <div className="space-y-6">
            {/* 0G Stack integration */}
            <div className="p-6 rounded-lg glass-panel-gold">
              <h4 className="text-xs font-mono tracking-[0.2em] uppercase text-gold/70 mb-4">
                0G Stack Integration
              </h4>
              <div className="space-y-4">
                {[
                  {
                    name: '0G Chain',
                    role: 'Smart contract custody, policy storage, event emission, executor authorization',
                    status: 'ACTIVE',
                  },
                  {
                    name: '0G Compute',
                    role: 'AI inference engine for market evaluation and structured decision generation',
                    status: 'ACTIVE',
                  },
                  {
                    name: '0G Storage',
                    role: 'Decision journal, reasoning archive, KV state snapshots, audit logs',
                    status: 'ACTIVE',
                  },
                ].map((item) => (
                  <div key={item.name} className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-soft animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-display font-semibold text-white">{item.name}</span>
                        <span className="text-[9px] font-mono tracking-[0.15em] uppercase text-emerald-soft/70">
                          {item.status}
                        </span>
                      </div>
                      <p className="text-xs text-steel/70 mt-0.5 leading-relaxed">{item.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Security model */}
            <div className="p-6 rounded-lg glass-panel">
              <h4 className="text-xs font-mono tracking-[0.2em] uppercase text-cyan/70 mb-4">
                Security Model
              </h4>
              <div className="space-y-3">
                {[
                  'AI proposes → contract enforces',
                  'Single-use intent hashes prevent replay',
                  'Whitelisted executor with expiry checks',
                  'User retains emergency pause authority',
                  'Policy violations are on-chain rejected',
                ].map((rule, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <svg className="w-3.5 h-3.5 text-gold/60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    <span className="text-xs text-steel/80">{rule}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Data flow summary */}
            <div className="p-6 rounded-lg glass-panel">
              <h4 className="text-xs font-mono tracking-[0.2em] uppercase text-steel/50 mb-4">
                Execution Pipeline
              </h4>
              <div className="font-mono text-[11px] text-steel/60 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-soft/60">1.</span>
                  <span>Market data → Orchestrator</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-cyan/60">2.</span>
                  <span>Structured prompt → 0G Compute</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-cyan/60">3.</span>
                  <span>JSON decision → Policy pre-check</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gold/60">4.</span>
                  <span>Valid intent → On-chain validation</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gold/60">5.</span>
                  <span>Approved → Executor → DEX swap</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-steel/40">6.</span>
                  <span>Result → Storage + Event log</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SectionWrapper>
  );
}
