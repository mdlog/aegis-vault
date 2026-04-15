import SectionWrapper from './SectionWrapper';
import VaultShield from './VaultShield';

export default function ClosingCTA() {
  return (
    <SectionWrapper id="cta" dark className="py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="relative rounded-2xl overflow-hidden">
          {/* Background */}
          <div className="absolute inset-0 bg-gradient-to-br from-graphite via-charcoal to-obsidian" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(201,168,76,0.06)_0%,transparent_70%)]" />
          <div className="absolute inset-0 border border-gold/10 rounded-2xl" />

          <div className="relative z-10 py-16 lg:py-24 px-8 lg:px-16">
            <div className="grid lg:grid-cols-[1fr_auto] gap-12 items-center">
              {/* Left: Copy */}
              <div className="text-center lg:text-left">
                <div className="flex items-center justify-center lg:justify-start gap-3 mb-6">
                  <div className="w-8 h-px bg-gold/40" />
                  <span className="text-[11px] font-mono tracking-[0.2em] uppercase text-gold/70">
                    Get Started
                  </span>
                </div>

                <h2 className="text-3xl lg:text-4xl xl:text-5xl font-display font-semibold leading-[1.12] tracking-[-0.03em] text-white mb-5">
                  Three roles.
                  <br />
                  <span className="text-gradient-gold">One verifiable protocol.</span>
                </h2>

                <p className="text-base text-steel leading-relaxed max-w-lg mx-auto lg:mx-0 mb-8">
                  Whether you want a vault, want to operate one, or want to test the system —
                  start here. All flows are live on 0G Aristotle Mainnet.
                </p>

                {/* CTAs — three personas */}
                <div className="grid sm:grid-cols-3 gap-3 mb-6">
                  <a
                    href="/create"
                    className="group relative px-5 py-4 text-xs font-medium tracking-[0.08em] uppercase
                      bg-gold text-obsidian rounded text-center
                      hover:bg-gold-light transition-all duration-300
                      shadow-[0_0_30px_rgba(201,168,76,0.18)]"
                  >
                    Create a Vault
                    <span className="block mt-1 text-[9px] text-obsidian/70 normal-case tracking-normal">For users</span>
                  </a>
                  <a
                    href="/operator/register"
                    className="group relative px-5 py-4 text-xs font-medium tracking-[0.08em] uppercase
                      text-cyan border border-cyan/30 rounded text-center
                      hover:bg-cyan/5 hover:border-cyan/50 transition-all duration-300"
                  >
                    Become an Operator
                    <span className="block mt-1 text-[9px] text-steel/50 normal-case tracking-normal">For AI agents</span>
                  </a>
                  <a
                    href="/faucet"
                    className="group relative px-5 py-4 text-xs font-medium tracking-[0.08em] uppercase
                      text-white/70 border border-white/10 rounded text-center
                      hover:border-white/20 hover:text-white transition-all duration-300"
                  >
                    Mint Mock Tokens
                    <span className="block mt-1 text-[9px] text-steel/50 normal-case tracking-normal">For testing</span>
                  </a>
                </div>

                {/* Secondary CTAs */}
                <div className="flex flex-wrap justify-center lg:justify-start gap-4 text-[11px] font-mono">
                  <a
                    href="/marketplace"
                    className="text-white/60 hover:text-cyan transition-colors uppercase tracking-[0.08em]"
                  >
                    Browse Marketplace →
                  </a>
                  <a
                    href="/app/actions"
                    className="text-white/60 hover:text-cyan transition-colors uppercase tracking-[0.08em]"
                  >
                    See AI Audit Trail →
                  </a>
                  <a
                    href="https://github.com/mdlog/aegis-vault"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/60 hover:text-cyan transition-colors uppercase tracking-[0.08em]"
                  >
                    GitHub →
                  </a>
                </div>

                {/* Trust line + verified TX proof */}
                <div className="mt-8 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-center lg:justify-start gap-3">
                    <span className="text-[10px] font-mono tracking-[0.1em] uppercase text-steel/40">
                      Powered by
                    </span>
                    <span className="text-[11px] font-mono tracking-[0.1em] uppercase text-cyan/50">0G Chain</span>
                    <span className="text-steel/20">·</span>
                    <span className="text-[11px] font-mono tracking-[0.1em] uppercase text-cyan/50">0G Compute</span>
                    <span className="text-steel/20">·</span>
                    <span className="text-[11px] font-mono tracking-[0.1em] uppercase text-cyan/50">0G Storage</span>
                    <span className="text-steel/20">·</span>
                    <span className="text-[11px] font-mono tracking-[0.1em] uppercase text-cyan/50">Pyth</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2 text-[10px] font-mono">
                    <span className="text-emerald-soft/70">✓ Live mainnet execution:</span>
                    <a
                      href="https://chainscan.0g.ai/mainnet/blockchain/txns/0x96b3e45435156849ee38c8a94c72ab3582a1abba1fa7cbf5d06374777e102a26/overview"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan/60 hover:text-cyan transition-colors"
                    >
                      0x96b3e454...e102a26 ↗
                    </a>
                  </div>
                </div>
              </div>

              {/* Right: Mini vault shield */}
              <div className="hidden lg:block">
                <div className="animate-float">
                  <VaultShield size={240} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SectionWrapper>
  );
}
