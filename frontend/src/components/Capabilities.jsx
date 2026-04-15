import SectionWrapper from './SectionWrapper';

const capabilities = [
  {
    tag: 'INTELLIGENCE',
    title: 'AI Risk Engine on 0G Compute',
    description: 'Real GLM-5-FP8 inference verified via processResponse(). Decision Engine v1: 8 market regimes, 15 veto rules, edge & quality scoring. Operators choose from 6 active 0G Compute models — committed on-chain at register time.',
    metrics: ['Models: 6 active', 'Engine: v1', 'Verified: VALID'],
    accentColor: 'cyan',
  },
  {
    tag: 'POLICY',
    title: 'Vault Policy Guardrails',
    description: 'On-chain policy enforcement inline in ExecLib. Max position, daily loss cap, cooldown, confidence threshold, asset whitelist — every check runs in Solidity before any swap executes.',
    metrics: ['Caps: Hardcoded', 'Replay: EIP-712 protected', 'Cooldown: per-vault'],
    accentColor: 'gold',
  },
  {
    tag: 'INDEXER',
    title: 'O(1) Vault Discovery',
    description: 'Production-grade event-driven indexer. VaultDeployed events ingested every 15s into a local store. Cycle queries vaults by executor in microseconds — scales from 2 to 100k+ vaults without RPC overhead.',
    metrics: ['Lookup: O(1)', 'Polling: 15s', 'Persistence: JSON+memory'],
    accentColor: 'cyan',
  },
  {
    tag: 'WALLET POOL',
    title: 'Multi-Executor Sharding',
    description: 'EXECUTOR_PRIVATE_KEYS pool with NonceManager per wallet. Deterministic sharding hash(vault) % poolSize means no nonce collisions, parallel tx submission, and horizontal scale without coordination.',
    metrics: ['Pool: configurable', 'Concurrency: parallel', 'Nonce: per-wallet'],
    accentColor: 'gold',
  },
  {
    tag: 'STORAGE',
    title: 'Strategy Manifest on 0G Storage',
    description: 'Operators publish strategy JSON to IPFS / 0G Storage. keccak256(content) committed on-chain via OperatorRegistry.publishManifest(uri, hash, bonded). Frontend verifies hash before display. Bonded manifests slashable on deviation.',
    metrics: ['Hosting: IPFS+0G+HTTPS', 'Verify: keccak256', 'Slash: Bonded'],
    accentColor: 'cyan',
  },
  {
    tag: 'GOVERNANCE',
    title: 'M-of-N AegisGovernor',
    description: 'On-chain multi-sig governance for slashing arbitration, treasury spending, verified-badge grants, and operator deactivation. Every protocol-level action requires explicit owner approval — no admin keys.',
    metrics: ['Threshold: M-of-N', 'Treasury: 20% protocol cut', 'Slashing: governed'],
    accentColor: 'gold',
  },
  {
    tag: 'CONTROL',
    title: 'User Custody, Emergency Pause',
    description: 'Vault holds funds — operator can never withdraw or pause. Owner alone has pause + withdraw rights. Single-tx emergency pause halts all execution; deposits and withdraws stay open under owner control.',
    metrics: ['Custody: Vault contract', 'Pause: Owner-only', 'Withdraw: Owner-only'],
    accentColor: 'emerald-soft',
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
            Production-grade primitives across smart contracts, orchestrator, and storage.
            Every capability solves a specific operational challenge in autonomous on-chain execution at scale.
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
