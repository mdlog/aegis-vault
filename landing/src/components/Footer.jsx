import logoImg from '../assets/aegis-vault-logo.png';

export default function Footer() {
  return (
    <footer className="bg-obsidian border-t border-white/[0.04] py-12">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <img src={logoImg} alt="Aegis Vault" className="h-28 w-auto object-contain" />
          </div>

          {/* Links */}
          <div className="flex items-center gap-6">
            {['Documentation', 'GitHub', 'Architecture', 'Contact'].map((link) => (
              <a
                key={link}
                href="#"
                className="text-[11px] tracking-[0.1em] uppercase text-steel/40 hover:text-steel/70 transition-colors duration-300"
              >
                {link}
              </a>
            ))}
          </div>

          {/* Copyright */}
          <div className="text-[10px] font-mono tracking-wider text-steel/30">
            Built on 0G · 2025
          </div>
        </div>
      </div>
    </footer>
  );
}
