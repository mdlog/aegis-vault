import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import logoImg from '../assets/aegis-vault-logo.png';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const links = [
    { label: 'Architecture', href: '#architecture' },
    { label: 'Security', href: '#trust' },
    { label: 'Capabilities', href: '#capabilities' },
  ];

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-obsidian/90 backdrop-blur-xl border-b border-white/[0.04]'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-12 h-16 flex items-center justify-between">
        {/* Logo */}
        <a href="#" className="flex items-center gap-3 group">
          <img src={logoImg} alt="Aegis Vault" className="h-28 w-auto object-contain" />
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-xs tracking-[0.12em] uppercase text-steel hover:text-white/90 transition-colors duration-300"
            >
              {link.label}
            </a>
          ))}
          <Link
            to="/app"
            className="ml-4 px-5 py-2 text-xs tracking-[0.1em] uppercase font-medium
              bg-gold/10 text-gold border border-gold/20 rounded
              hover:bg-gold/20 hover:border-gold/40 transition-all duration-300"
          >
            Launch App
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden w-8 h-8 flex flex-col items-center justify-center gap-1.5"
        >
          <span className={`w-5 h-px bg-steel transition-all duration-300 ${mobileOpen ? 'rotate-45 translate-y-1' : ''}`} />
          <span className={`w-5 h-px bg-steel transition-all duration-300 ${mobileOpen ? 'opacity-0' : ''}`} />
          <span className={`w-5 h-px bg-steel transition-all duration-300 ${mobileOpen ? '-rotate-45 -translate-y-1' : ''}`} />
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-obsidian/95 backdrop-blur-xl border-t border-white/[0.04] px-6 py-6 space-y-4">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="block text-sm tracking-[0.1em] uppercase text-steel hover:text-white transition-colors"
            >
              {link.label}
            </a>
          ))}
          <a
            href="#cta"
            className="block text-center px-5 py-2.5 text-sm tracking-[0.1em] uppercase font-medium
              bg-gold/10 text-gold border border-gold/20 rounded
              hover:bg-gold/20 transition-all duration-300"
          >
            Launch App
          </a>
        </div>
      )}
    </nav>
  );
}
