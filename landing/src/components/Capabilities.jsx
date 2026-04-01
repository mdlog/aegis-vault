import SectionWrapper from './SectionWrapper';

const capabilities = [
  {
    tag: 'INTELLIGENCE',
    title: 'AI Risk Engine',
    description: 'Structured inference powered by 0G Compute. Market interpretation, decision generation, and confidence scoring — all producing verifiable JSON outputs.',
    metrics: ['Confidence: 0.82', 'Risk Score: 0.28', 'TTL: 180s'],
    accentColor: 'cyan',
  },
  {
    tag: 'POLICY',
    title: 'Vault Policy Guardrails',
    description: 'On-chain policy enforcement at the contract level. Max position sizes, daily loss limits, cooldowns, asset whitelists, and global stop-loss — all immutable and user-defined.',
    metrics: ['Max Position: 20%', 'Daily Loss Cap: 5%', 'Cooldown: 15min'],
    accentColor: 'gold',
  },
  {
    tag: 'PRIVACY',
    title: 'Sealed Strategy Mode',
    description: 'Optional privacy-preserving execution. Strategy parameters and inference inputs remain confidential, with only signed metadata visible to the network.',
    metrics: ['Inputs: Encrypted', 'Outputs: Signed', 'Mode: TEE-Ready'],
    accentColor: 'cyan',
  },
  {
    tag: 'AUDIT',
    title: 'Execution Journal',
    description: 'Every decision, every trade, every AI reasoning summary is recorded to 0G Storage. Complete, immutable, and queryable audit trail.',
    metrics: ['Entries: 1,247', 'Storage: 0G', 'Retention: Permanent'],
    accentColor: 'gold',
  },
  {
    tag: 'HEALTH',
    title: 'Portfolio Health Monitoring',
    description: 'Real-time vault health dashboard. NAV tracking, drawdown monitoring, risk meter, position overview, and execution status — all in one view.',
    metrics: ['NAV: $2.41M', 'Drawdown: 1.2%', 'Health: 98%'],
    accentColor: 'emerald-soft',
  },
  {
    tag: 'CONTROL',
    title: 'Emergency Pause Controls',
    description: 'Instant vault pause with a single transaction. All pending intents are rejected, execution halts, and withdraw becomes available. User retains full authority.',
    metrics: ['Latency: 1 block', 'Override: Owner', 'Recovery: Manual'],
    accentColor: 'gold',
  },
  {
    tag: 'TRANSPARENCY',
    title: 'On-chain Transparency',
    description: 'Every execution emits on-chain events. Intent hashes, trade results, policy violations, and state changes are all publicly verifiable.',
    metrics: ['Events: On-chain', 'Intents: Hashed', 'Replay: Protected'],
    accentColor: 'cyan',
  },
];

function getAccentClasses(color) {
  const map = {
    cyan: {
      tag: 'text-cyan/80 bg-cyan/10 border-cyan/20',
      metric: 'text-cyan/60',
      line: 'from-cyan/0 via-cyan/20 to-cyan/0',
    },
    gold: {
      tag: 'text-gold/80 bg-gold/10 border-gold/20',
      metric: 'text-gold/60',
      line: 'from-gold/0 via-gold/20 to-gold/0',
    },
    'emerald-soft': {
      tag: 'text-emerald-soft/80 bg-emerald-soft/10 border-emerald-soft/20',
      metric: 'text-emerald-soft/60',
      line: 'from-emerald-soft/0 via-emerald-soft/20 to-emerald-soft/0',
    },
  };
  return map[color] || map.cyan;
}

export default function Capabilities() {
  return (
    <SectionWrapper id="capabilities" className="py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        {/* Section header */}
        <div className="max-w-2xl mb-16 lg:mb-20">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-px bg-gold/40" />
            <span className="text-[11px] font-mono tracking-[0.2em] uppercase text-gold/70">
              Capabilities
            </span>
          </div>
          <h2 className="text-3xl lg:text-4xl xl:text-[2.75rem] font-display font-semibold leading-[1.15] tracking-[-0.02em] text-white mb-5">
            Engineered for serious
            <br />
            <span className="text-gradient-gold">capital management.</span>
          </h2>
          <p className="text-base text-steel leading-relaxed">
            Every capability exists to solve a specific operational challenge
            in autonomous on-chain execution.
          </p>
        </div>

        {/* Editorial layout — large first, grid rest */}
        <div className="space-y-5">
          {/* Featured capability */}
          <div className="group relative p-8 lg:p-12 rounded-lg glass-panel-gold hover:border-gold/30 transition-all duration-500">
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div>
                <span className={`inline-block text-[10px] font-mono tracking-[0.2em] uppercase px-2 py-1 rounded border mb-5 ${getAccentClasses(capabilities[0].accentColor).tag}`}>
                  {capabilities[0].tag}
                </span>
                <h3 className="text-2xl lg:text-3xl font-display font-semibold text-white mb-4 tracking-[-0.02em]">
                  {capabilities[0].title}
                </h3>
                <p className="text-sm lg:text-base text-steel leading-relaxed">
                  {capabilities[0].description}
                </p>
              </div>
              <div className="lg:pl-8">
                {/* Mock JSON output */}
                <div className="rounded-lg bg-obsidian/80 border border-white/[0.06] p-5 font-mono text-xs leading-relaxed">
                  <div className="text-steel/40 mb-2">// AI inference output</div>
                  <div className="text-white/40">{'{'}</div>
                  <div className="pl-4">
                    <span className="text-cyan/70">"action"</span>: <span className="text-emerald-soft/80">"buy"</span>,
                  </div>
                  <div className="pl-4">
                    <span className="text-cyan/70">"asset"</span>: <span className="text-emerald-soft/80">"ETH"</span>,
                  </div>
                  <div className="pl-4">
                    <span className="text-cyan/70">"size_bps"</span>: <span className="text-gold/80">1200</span>,
                  </div>
                  <div className="pl-4">
                    <span className="text-cyan/70">"confidence"</span>: <span className="text-gold/80">0.82</span>,
                  </div>
                  <div className="pl-4">
                    <span className="text-cyan/70">"risk_score"</span>: <span className="text-gold/80">0.28</span>,
                  </div>
                  <div className="pl-4">
                    <span className="text-cyan/70">"reason"</span>: <span className="text-emerald-soft/80">"momentum continuation<br className="hidden" /> with acceptable volatility"</span>
                  </div>
                  <div className="text-white/40">{'}'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Grid of remaining capabilities */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {capabilities.slice(1).map((cap, i) => {
              const accent = getAccentClasses(cap.accentColor);
              return (
                <div
                  key={i}
                  className="group relative p-6 lg:p-7 rounded-lg glass-panel hover:border-white/[0.08] transition-all duration-500"
                >
                  <span className={`inline-block text-[10px] font-mono tracking-[0.2em] uppercase px-2 py-1 rounded border mb-4 ${accent.tag}`}>
                    {cap.tag}
                  </span>
                  <h3 className="text-lg font-display font-semibold text-white mb-2.5 tracking-[-0.01em]">
                    {cap.title}
                  </h3>
                  <p className="text-sm text-steel leading-relaxed mb-4">
                    {cap.description}
                  </p>
                  {/* Metrics */}
                  <div className="flex flex-wrap gap-2">
                    {cap.metrics.map((m, j) => (
                      <span key={j} className={`text-[10px] font-mono tracking-wide ${accent.metric}`}>
                        {m}{j < cap.metrics.length - 1 ? ' ·' : ''}
                      </span>
                    ))}
                  </div>
                  {/* Bottom accent */}
                  <div className={`absolute bottom-0 left-6 right-6 h-px bg-gradient-to-r ${accent.line} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </SectionWrapper>
  );
}
