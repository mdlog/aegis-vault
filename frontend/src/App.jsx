import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

// Lazy-load the whitepaper page so react-markdown + remark-gfm don't bloat
// the main bundle. Visitors hitting /whitepaper see a brief loading state
// while the chunk fetches, which is acceptable for a document page.
const WhitepaperPage = lazy(() => import('./pages/WhitepaperPage'));

function AppLayout({ children }) {
  return <AppShell>{children}</AppShell>;
}

function App() {
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
      </Routes>
    </BrowserRouter>
  );
}

export default App;
