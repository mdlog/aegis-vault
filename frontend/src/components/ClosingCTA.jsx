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
                  Your capital deserves
                  <br />
                  <span className="text-gradient-gold">disciplined intelligence.</span>
                </h2>

                <p className="text-base text-steel leading-relaxed max-w-lg mx-auto lg:mx-0 mb-8">
                  Deploy an AI-managed vault with verifiable risk constraints.
                  Define your mandate. Let Aegis Vault execute with precision,
                  accountability, and full transparency.
                </p>

                {/* CTAs */}
                <div className="flex flex-wrap justify-center lg:justify-start gap-4">
                  <a
                    href="/app"
                    className="group relative px-8 py-4 text-sm font-medium tracking-[0.08em] uppercase
                      bg-gold text-obsidian rounded
                      hover:bg-gold-light transition-all duration-300
                      shadow-[0_0_40px_rgba(201,168,76,0.2)]
                      hover:shadow-[0_0_50px_rgba(201,168,76,0.3)]"
                  >
                    Launch App
                    <span className="ml-2 inline-block transition-transform duration-300 group-hover:translate-x-1">→</span>
                  </a>
                  <a
                    href="#"
                    className="px-8 py-4 text-sm font-medium tracking-[0.08em] uppercase
                      text-white/70 border border-white/10 rounded
                      hover:border-gold/30 hover:text-gold transition-all duration-300"
                  >
                    View Demo
                  </a>
                  <a
                    href="#"
                    className="px-8 py-4 text-sm font-medium tracking-[0.08em] uppercase
                      text-white/50 rounded
                      hover:text-white/70 transition-all duration-300"
                  >
                    Read Docs
                  </a>
                </div>

                {/* Trust line */}
                <div className="mt-8 flex items-center justify-center lg:justify-start gap-4">
                  <span className="text-[10px] font-mono tracking-[0.1em] uppercase text-steel/40">
                    Powered by
                  </span>
                  <span className="text-[11px] font-mono tracking-[0.1em] uppercase text-cyan/50">
                    0G Chain
                  </span>
                  <span className="text-steel/20">·</span>
                  <span className="text-[11px] font-mono tracking-[0.1em] uppercase text-cyan/50">
                    0G Compute
                  </span>
                  <span className="text-steel/20">·</span>
                  <span className="text-[11px] font-mono tracking-[0.1em] uppercase text-cyan/50">
                    0G Storage
                  </span>
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
