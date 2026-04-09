import SectionWrapper from './SectionWrapper';
import { TrendingUp, Lock, Star, Vote, CheckCircle, DollarSign, Award, Shield } from 'lucide-react';

const pillars = [
  {
    number: '01',
    tag: 'ECONOMICS',
    title: 'Fee-aware vault model',
    headline: 'High-water mark performance fees. 80/20 operator/treasury split. Hard-coded caps.',
    description:
      'Every vault declares its fees upfront. Performance fees only charge on net-new profit above the high-water mark — you never pay twice on volatility. Management fees stream continuously. All fees split 80% to the operator, 20% to the protocol treasury that funds audits and insurance.',
    stats: [
      { label: 'Max performance fee', value: '30%' },
      { label: 'Max management fee', value: '5% / yr' },
      { label: 'Fee change cooldown', value: '7 days' },
      { label: 'Protocol treasury cut', value: '20%' },
    ],
    accent: 'gold',
    icon: TrendingUp,
  },
  {
    number: '02',
    tag: 'SKIN IN THE GAME',
    title: 'Tiered operator staking',
    headline: '5 tiers. Vault-size caps. 14-day cooldown. Slashable.',
    description:
      'Operators must stake USDC to manage vaults. Bigger stake → bigger vault cap. The entire stake is slashable by governance up to 50% per action — skin in the game is real, not marketing. Slashed funds flow to the insurance pool, not the treasury.',
    stats: [
      { label: 'Bronze tier', value: '$1k → $50k cap' },
      { label: 'Silver tier', value: '$10k → $500k cap' },
      { label: 'Gold tier', value: '$100k → $5M cap' },
      { label: 'Platinum tier', value: '$1M → unlimited' },
    ],
    accent: 'cyan',
    icon: Lock,
  },
  {
    number: '03',
    tag: 'REPUTATION',
    title: 'On-chain track record',
    headline: 'Every execution logged. User ratings. Verified badge.',
    description:
      'Vaults automatically record each execution on the OperatorReputation contract — volume, success rate, timestamps. Users rate their operator after experience. Governance grants a verified badge to trusted bots. Reputation is a public, tamper-proof credential.',
    stats: [
      { label: 'Stats source', value: 'vault.executeIntent' },
      { label: 'Rating limit', value: '1 per wallet' },
      { label: 'Verified badge', value: 'Governance-gated' },
      { label: 'Data location', value: 'On-chain' },
    ],
    accent: 'emerald-soft',
    icon: Star,
  },
  {
    number: '04',
    tag: 'GOVERNANCE',
    title: 'Multi-sig protocol governance',
    headline: 'M-of-N approval for slashing, treasury, verified badges.',
    description:
      'Every sensitive protocol action — slashing an operator, spending treasury funds, granting verified badges, rotating owners — requires M-of-N multi-sig approval. No single admin can rug. Owner rotation is self-call only, meaning current owners must collectively agree before anyone joins or leaves.',
    stats: [
      { label: 'Multi-sig type', value: 'M-of-N' },
      { label: 'Proposal lifecycle', value: 'submit → confirm → execute' },
      { label: 'Owner rotation', value: 'Self-call only' },
      { label: 'Actions gated', value: '9 kinds' },
    ],
    accent: 'gold',
    icon: Vote,
  },
];

const accentMap = {
  gold: {
    border: 'border-gold/20',
    tag: 'text-gold/80 bg-gold/10 border-gold/20',
    number: 'text-gold/40',
    iconBg: 'bg-gold/10',
    iconColor: 'text-gold',
    divider: 'via-gold/20',
    statValue: 'text-gold/80',
  },
  cyan: {
    border: 'border-cyan/20',
    tag: 'text-cyan/80 bg-cyan/10 border-cyan/20',
    number: 'text-cyan/40',
    iconBg: 'bg-cyan/10',
    iconColor: 'text-cyan',
    divider: 'via-cyan/20',
    statValue: 'text-cyan/80',
  },
  'emerald-soft': {
    border: 'border-emerald-soft/20',
    tag: 'text-emerald-soft/80 bg-emerald-soft/10 border-emerald-soft/20',
    number: 'text-emerald-soft/40',
    iconBg: 'bg-emerald-soft/10',
    iconColor: 'text-emerald-soft',
    divider: 'via-emerald-soft/20',
    statValue: 'text-emerald-soft/80',
  },
};

export default function ProductionStackSection() {
  return (
    <SectionWrapper id="production-stack" className="py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        {/* Section header */}
        <div className="max-w-3xl mb-16 lg:mb-20">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-px bg-cyan/40" />
            <span className="text-[11px] font-mono tracking-[0.2em] uppercase text-cyan/70">
              Production Stack
            </span>
          </div>
          <h2 className="text-3xl lg:text-4xl xl:text-[2.75rem] font-display font-semibold leading-[1.15] tracking-[-0.02em] text-white mb-5">
            Not a demo.
            <br />
            <span className="text-gradient-gold">A full protocol.</span>
          </h2>
          <p className="text-base text-steel leading-relaxed max-w-2xl">
            Aegis Vault shipped in five phases, from MVP to production-grade protocol — every
            piece covered by on-chain tests. Fee economics, skin-in-the-game staking, on-chain
            reputation, and multi-sig governance. The kind of foundation you'd expect from a
            protocol custodying real capital.
          </p>
        </div>

        {/* Pillars */}
        <div className="space-y-5">
          {pillars.map((p) => {
            const a = accentMap[p.accent];
            const Icon = p.icon;
            return (
              <div
                key={p.number}
                className={`group relative p-8 lg:p-10 rounded-lg glass-panel hover:${a.border} transition-all duration-500`}
              >
                <div className="grid lg:grid-cols-[auto_1fr_auto] gap-8 items-start">
                  {/* Number + icon column */}
                  <div className="flex items-start gap-4 lg:flex-col lg:items-center">
                    <span className={`text-5xl lg:text-6xl font-display font-semibold tabular-nums ${a.number}`}>
                      {p.number}
                    </span>
                    <div className={`w-12 h-12 rounded-lg ${a.iconBg} flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-5 h-5 ${a.iconColor}`} />
                    </div>
                  </div>

                  {/* Content column */}
                  <div>
                    <span
                      className={`inline-block text-[10px] font-mono tracking-[0.2em] uppercase px-2 py-1 rounded border mb-4 ${a.tag}`}
                    >
                      {p.tag}
                    </span>
                    <h3 className="text-2xl lg:text-3xl font-display font-semibold text-white mb-3 tracking-[-0.01em]">
                      {p.title}
                    </h3>
                    <p className={`text-base lg:text-lg font-display ${a.iconColor}/80 mb-4 leading-snug`}>
                      {p.headline}
                    </p>
                    <p className="text-sm lg:text-[15px] text-steel leading-relaxed max-w-2xl">
                      {p.description}
                    </p>
                  </div>

                  {/* Stats column */}
                  <div className="lg:min-w-[240px] lg:pl-6 lg:border-l lg:border-white/[0.06]">
                    <div className="space-y-3">
                      {p.stats.map((s, i) => (
                        <div key={i}>
                          <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-steel/50 mb-0.5">
                            {s.label}
                          </div>
                          <div className={`text-sm font-mono font-semibold ${a.statValue} tabular-nums`}>
                            {s.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Bottom gradient accent */}
                <div
                  className={`absolute bottom-0 left-8 right-8 h-px bg-gradient-to-r from-white/0 ${a.divider} to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
                />
              </div>
            );
          })}
        </div>

        {/* Bottom stat strip */}
        <div className="mt-16 lg:mt-20 grid grid-cols-2 lg:grid-cols-4 gap-6 border-t border-white/[0.06] pt-12">
          <Stat icon={Shield} value="135" label="on-chain tests passing" accent="gold" />
          <Stat icon={DollarSign} value="80/20" label="operator ↔ treasury fee split" accent="cyan" />
          <Stat icon={Award} value="5" label="staking tiers (None → Platinum)" accent="emerald-soft" />
          <Stat icon={CheckCircle} value="Immutable" label="no upgradable proxies" accent="gold" />
        </div>
      </div>
    </SectionWrapper>
  );
}

function Stat({ icon, value, label, accent }) {
  const a = accentMap[accent];
  const Icon = icon;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-3.5 h-3.5 ${a.iconColor}`} />
        <span className="text-[10px] font-mono tracking-[0.15em] uppercase text-steel/50">
          {label}
        </span>
      </div>
      <div className={`text-2xl lg:text-3xl font-display font-semibold ${a.statValue} tabular-nums`}>
        {value}
      </div>
    </div>
  );
}
