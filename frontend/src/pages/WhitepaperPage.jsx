import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, ExternalLink, FileText } from 'lucide-react';
import Logo from '../components/ui/Logo';

/**
 * WhitepaperPage
 *
 * Renders WHITEPAPER.md as an in-app document. The markdown is fetched from
 * /WHITEPAPER.md (served from frontend/public/) at mount time so the page
 * always renders the version shipped with the current build.
 */
export default function WhitepaperPage() {
  const [content, setContent] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/WHITEPAPER.md', { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching whitepaper`);
        const text = await res.text();
        if (!cancelled) {
          setContent(text);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-obsidian text-steel-50">
      {/* Top bar — minimal, non-app shell so it feels like a document, not a dashboard */}
      <header className="sticky top-0 z-40 bg-obsidian/95 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="max-w-[960px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5 group">
            <Logo size={22} />
            <span className="text-xs font-medium tracking-[0.12em] uppercase text-white/70 group-hover:text-white transition-colors hidden sm:inline">
              Aegis Vault
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/mdlog/aegis-vault/blob/main/WHITEPAPER.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.08] text-[11px] font-mono text-steel/70 hover:text-white hover:border-white/20 transition-colors"
              title="Open versioned source on GitHub"
            >
              View on GitHub <ExternalLink className="w-3 h-3" />
            </a>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-mono text-steel/70 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3 h-3" /> Back
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[760px] mx-auto px-4 sm:px-6 py-10 sm:py-16">
        {/* Document header */}
        <div className="mb-10 pb-8 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-gold/70" />
            <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-steel/45">
              Technical Whitepaper
            </span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-display font-semibold tracking-[-0.035em] text-white mb-3">
            Aegis Vault
          </h1>
          <p className="text-[14px] text-steel/60 leading-relaxed">
            AI-managed, risk-controlled trading vaults with contract-enforced guardrails
            and dual-chain real execution. Version 1.0.
          </p>
        </div>

        {/* Body */}
        {loading && (
          <div className="text-center py-20 text-steel/40 text-sm">Loading whitepaper…</div>
        )}
        {error && (
          <div className="text-center py-20 text-red-warn/70 text-sm">
            Failed to load whitepaper: {error}.{' '}
            <a
              href="https://github.com/mdlog/aegis-vault/blob/main/WHITEPAPER.md"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-white"
            >
              Read on GitHub →
            </a>
          </div>
        )}

        {!loading && !error && (
          <article className="whitepaper-article">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </article>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-8 mt-16">
        <div className="max-w-[760px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] font-mono text-steel/40">
          <div>© Aegis Vault · Experimental software · Not audited</div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/mdlog/aegis-vault"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              github.com/mdlog/aegis-vault
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
