import SectionWrapper from './SectionWrapper';

const trustPillars = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
      </svg>
    ),
    title: 'User-Defined Guardrails',
    description: 'Risk parameters are set by the vault owner — not the protocol, not the AI. You define the boundaries. The system enforces them.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    title: 'Policy-Constrained Execution',
    description: 'Every AI proposal must pass through the on-chain policy engine. Size limits, cooldowns, asset whitelists, and loss thresholds are checked at the contract level.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z" />
      </svg>
    ),
    title: 'Capital Protection Mindset',
    description: 'Aegis Vault is risk-first. The system is designed to prevent catastrophic loss before optimizing for alpha. Drawdown limits, position caps, and consecutive-loss detection are built in.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
    title: 'Transparent Actions',
    description: 'Every execution emits on-chain events. AI reasoning summaries, trade outcomes, and policy check results are all logged to 0G Storage for permanent audit.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9v6m-4.5 0V9M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: 'Emergency Controls',
    description: 'One-click vault pause. Immediate halt of all AI-driven execution. Pending intents are rejected. Withdraw becomes available. You are always in command.',
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.384-3.073A1.5 1.5 0 004.5 13.5v5.438a1.5 1.5 0 001.536 1.392l5.384-.308a1.5 1.5 0 001.08-.765M11.42 15.17l5.384 3.073a1.5 1.5 0 001.536-.08l.145-.09A1.5 1.5 0 0019.5 16.5V11.062a1.5 1.5 0 00-1.015-1.392l-5.384-1.538a1.5 1.5 0 00-1.181.17M11.42 15.17V6.032a1.5 1.5 0 00-.746-1.297L6.454 2.386A1.5 1.5 0 004.5 3.648v7.994" />
      </svg>
    ),
    title: 'Operational Discipline',
    description: 'Structured intent lifecycle. Single-use hashes prevent replay. Expiry enforcement. Cooldown periods between executions. No rogue trades.',
  },
];

export default function TrustSection() {
  return (
    <SectionWrapper id="trust" className="py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        {/* Section header */}
        <div className="text-center max-w-3xl mx-auto mb-16 lg:mb-20">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-8 h-px bg-gold/40" />
            <span className="text-[11px] font-mono tracking-[0.2em] uppercase text-gold/70">
              Trust & Security
            </span>
            <div className="w-8 h-px bg-gold/40" />
          </div>
          <h2 className="text-3xl lg:text-4xl xl:text-[2.75rem] font-display font-semibold leading-[1.15] tracking-[-0.02em] text-white mb-5">
            Trust is not assumed.
            <br />
            <span className="text-gradient-gold">It is architecturally enforced.</span>
          </h2>
          <p className="text-base text-steel leading-relaxed max-w-2xl mx-auto">
            Aegis Vault is built on the principle that no single component — not the AI,
            not the executor, not the backend — should hold unilateral authority over user capital.
          </p>
        </div>

        {/* Trust pillars */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {trustPillars.map((pillar, i) => (
            <div
              key={i}
              className="group relative p-6 lg:p-7 rounded-lg glass-panel
                hover:border-gold/15 transition-all duration-500"
            >
              {/* Icon */}
              <div className="w-9 h-9 rounded flex items-center justify-center bg-gold/8 text-gold/70 mb-4">
                {pillar.icon}
              </div>

              <h3 className="text-base font-display font-semibold text-white mb-2.5 tracking-[-0.01em]">
                {pillar.title}
              </h3>

              <p className="text-sm text-steel leading-relaxed">
                {pillar.description}
              </p>
            </div>
          ))}
        </div>

        {/* Security summary bar */}
        <div className="mt-14 p-6 lg:p-8 rounded-lg glass-panel-gold">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { label: 'Policy Violations', value: '0', color: 'text-emerald-soft' },
              { label: 'Replay Attacks', value: 'Blocked', color: 'text-emerald-soft' },
              { label: 'Executor Overrides', value: 'None', color: 'text-emerald-soft' },
              { label: 'Emergency Pauses', value: 'Instant', color: 'text-gold' },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className={`text-xl lg:text-2xl font-display font-semibold ${stat.color}`}>
                  {stat.value}
                </div>
                <div className="text-[10px] font-mono tracking-[0.12em] uppercase text-steel/50 mt-1">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SectionWrapper>
  );
}
