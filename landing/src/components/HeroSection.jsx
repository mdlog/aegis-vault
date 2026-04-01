import VaultShield from './VaultShield';

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden noise-overlay">
      {/* Background layers */}
      <div className="absolute inset-0">
        {/* Radial gradient from center */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,rgba(201,168,76,0.06)_0%,transparent_70%)]" />
        {/* Bottom horizon glow */}
        <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-gold/20 to-transparent" />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(201,168,76,0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(201,168,76,0.3) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />
        {/* Scan line */}
        <div className="absolute left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan/10 to-transparent animate-scan-line" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-12 pt-24 pb-20">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
          {/* Left: Copy */}
          <div className="text-left space-y-8 reveal-stagger">
            {/* Tag */}
            <div className="animate-fade-in-up">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gold/20 bg-gold/5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-soft animate-pulse" />
                <span className="text-[11px] font-mono tracking-[0.15em] uppercase text-gold/80">
                  Built on 0G — Live on Testnet
                </span>
              </span>
            </div>

            {/* Headline */}
            <h1 className="animate-fade-in-up text-4xl sm:text-5xl lg:text-6xl xl:text-[4.2rem] font-display font-semibold leading-[1.08] tracking-[-0.03em]">
              <span className="text-white">Autonomous capital</span>
              <br />
              <span className="text-white">protection for the</span>
              <br />
              <span className="text-gradient-gold">AI-native era.</span>
            </h1>

            {/* Subhead */}
            <p className="animate-fade-in-up text-base lg:text-lg text-steel leading-relaxed max-w-lg">
              Aegis Vault is an AI-managed, policy-constrained trading vault.
              Deposit assets. Define risk mandates. Let disciplined intelligence
              execute within verifiable limits.
            </p>

            {/* CTAs */}
            <div className="animate-fade-in-up flex flex-wrap gap-4">
              <a
                href="/app"
                className="group relative px-7 py-3.5 text-sm font-medium tracking-[0.08em] uppercase
                  bg-gold text-obsidian rounded
                  hover:bg-gold-light transition-all duration-300
                  shadow-[0_0_30px_rgba(201,168,76,0.15)]
                  hover:shadow-[0_0_40px_rgba(201,168,76,0.25)]"
              >
                Launch App
                <span className="ml-2 inline-block transition-transform duration-300 group-hover:translate-x-1">→</span>
              </a>
              <a
                href="#architecture"
                className="px-7 py-3.5 text-sm font-medium tracking-[0.08em] uppercase
                  text-white/70 border border-white/10 rounded
                  hover:border-white/20 hover:text-white transition-all duration-300"
              >
                Explore Architecture
              </a>
            </div>

            {/* Trust indicators */}
            <div className="animate-fade-in-up flex items-center gap-6 pt-4">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-cyan/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                <span className="text-[11px] font-mono tracking-wide text-steel/70 uppercase">Policy-constrained</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-cyan/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-[11px] font-mono tracking-wide text-steel/70 uppercase">On-chain verifiable</span>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <svg className="w-4 h-4 text-cyan/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <span className="text-[11px] font-mono tracking-wide text-steel/70 uppercase">Sealed strategy mode</span>
              </div>
            </div>
          </div>

          {/* Right: Vault Shield */}
          <div className="flex items-center justify-center lg:justify-end">
            <div className="animate-float">
              <VaultShield size={420} className="hidden lg:block" />
              <VaultShield size={260} className="block lg:hidden" />
            </div>
          </div>
        </div>

        {/* Bottom metrics bar */}
        <div className="mt-20 pt-8 border-t border-white/[0.04]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { value: '$2.4M', label: 'Total Value Locked', accent: 'text-white' },
              { value: '99.7%', label: 'Policy Compliance', accent: 'text-emerald-soft' },
              { value: '142', label: 'Autonomous Executions', accent: 'text-cyan' },
              { value: '0', label: 'Policy Violations', accent: 'text-gold' },
            ].map((metric) => (
              <div key={metric.label} className="text-center md:text-left">
                <div className={`text-2xl lg:text-3xl font-display font-semibold tracking-tight ${metric.accent}`}>
                  {metric.value}
                </div>
                <div className="text-[11px] font-mono tracking-[0.1em] uppercase text-steel/60 mt-1">
                  {metric.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
