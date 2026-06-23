import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import CreateVaultPage from './pages/CreateVaultPage';
import VaultDetailPage from './pages/VaultDetailPage';
import ActionsPage from './pages/ActionsPage';
import SettingsPage from './pages/SettingsPage';
import OperatorMarketplacePage from './pages/OperatorMarketplacePage';
import OperatorRegisterPage from './pages/OperatorRegisterPage';
import OperatorProfilePage from './pages/OperatorProfilePage';
import GovernancePage from './pages/GovernancePage';
import FaucetPage from './pages/FaucetPage';
import AppShell from './components/dashboard/AppShell';
import { useFollowWalletAccount } from './hooks/useFollowWalletAccount';

// Lazy-load the whitepaper page so react-markdown + remark-gfm don't bloat
// the main bundle. Visitors hitting /whitepaper see a brief loading state
// while the chunk fetches, which is acceptable for a document page.
const WhitepaperPage = lazy(() => import('./pages/WhitepaperPage'));
const DocsPage = lazy(() => import('./pages/DocsPage'));

function AppLayout({ children }) {
  return <AppShell>{children}</AppShell>;
}

// Shared loading state for the lazily-loaded document pages.
const docsFallback = (
  <div className="min-h-screen bg-obsidian flex items-center justify-center text-steel-400 text-sm">
    Loading docs…
  </div>
);

// The marketing site + app live on the apex domain.
const APEX_ORIGIN = 'https://aegisvaults.xyz';

// On the docs subdomain, any app route (e.g. /marketplace, /app) is bounced to
// the apex domain — preserving path + query + hash — so the app's relative
// <Link>s never trap the visitor on docs.aegisvaults.xyz.
function ApexRedirect() {
  const location = useLocation();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.location.replace(
      APEX_ORIGIN + location.pathname + location.search + location.hash
    );
  }, [location]);
  return docsFallback;
}

function App() {
  // Auto-follow the account currently selected/connected in MetaMask.
  useFollowWalletAccount();

  // The docs subdomain (docs.aegisvaults.xyz) is documentation-only: it serves
  // the docs + whitepaper pages and redirects every other route to the apex
  // domain. The marketing site + app stay on aegisvaults.xyz.
  const onDocsSubdomain =
    typeof window !== 'undefined' &&
    window.location.hostname.startsWith('docs.');

  if (onDocsSubdomain) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Suspense fallback={docsFallback}><DocsPage /></Suspense>} />
          <Route path="/docs" element={<Suspense fallback={docsFallback}><DocsPage /></Suspense>} />
          <Route path="/whitepaper" element={<Suspense fallback={docsFallback}><WhitepaperPage /></Suspense>} />
          {/* Everything else belongs to the app → send it to the apex domain. */}
          <Route path="*" element={<ApexRedirect />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public landing */}
        <Route path="/" element={<LandingPage />} />

        {/* Authenticated app */}
        <Route path="/app" element={<AppLayout><DashboardPage /></AppLayout>} />
        <Route path="/app/vault" element={<Navigate to="/app" replace />} />
        <Route path="/app/vault/:vaultAddress" element={<AppLayout><VaultDetailPage /></AppLayout>} />
        <Route path="/app/actions" element={<AppLayout><ActionsPage /></AppLayout>} />
        <Route path="/app/journal" element={<Navigate to="/app/actions" replace />} />
        <Route path="/app/settings" element={<AppLayout><SettingsPage /></AppLayout>} />
        <Route path="/app/settings/:vaultAddress" element={<AppLayout><SettingsPage /></AppLayout>} />

        {/* Operator marketplace */}
        <Route path="/marketplace" element={<AppLayout><OperatorMarketplacePage /></AppLayout>} />
        <Route path="/operator/register" element={<AppLayout><OperatorRegisterPage /></AppLayout>} />
        <Route path="/operator/:operatorAddress" element={<AppLayout><OperatorProfilePage /></AppLayout>} />

        {/* Governance */}
        <Route path="/governance" element={<AppLayout><GovernancePage /></AppLayout>} />

        {/* Faucet — mint mock tokens for testing */}
        <Route path="/faucet" element={<AppLayout><FaucetPage /></AppLayout>} />

        {/* Vault creation */}
        <Route path="/create" element={<AppLayout><CreateVaultPage /></AppLayout>} />

        {/* Whitepaper — standalone document page, outside the dashboard shell */}
        <Route
          path="/whitepaper"
          element={
            <Suspense fallback={<div className="min-h-screen bg-obsidian flex items-center justify-center text-steel-400 text-sm">Loading whitepaper…</div>}>
              <WhitepaperPage />
            </Suspense>
          }
        />

        {/* Docs — developer & operator documentation, standalone page */}
        <Route
          path="/docs"
          element={
            <Suspense fallback={<div className="min-h-screen bg-obsidian flex items-center justify-center text-steel-400 text-sm">Loading docs…</div>}>
              <DocsPage />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
