import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import CreateVaultPage from './pages/CreateVaultPage';
import VaultDetailPage from './pages/VaultDetailPage';
import ActionsPage from './pages/ActionsPage';
import JournalPage from './pages/JournalPage';
import SettingsPage from './pages/SettingsPage';
import OperatorMarketplacePage from './pages/OperatorMarketplacePage';
import OperatorRegisterPage from './pages/OperatorRegisterPage';
import OperatorProfilePage from './pages/OperatorProfilePage';
import GovernancePage from './pages/GovernancePage';
import AppShell from './components/dashboard/AppShell';

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
        <Route path="/app/journal" element={<AppLayout><JournalPage /></AppLayout>} />
        <Route path="/app/settings" element={<AppLayout><SettingsPage /></AppLayout>} />
        <Route path="/app/settings/:vaultAddress" element={<AppLayout><SettingsPage /></AppLayout>} />

        {/* Operator marketplace */}
        <Route path="/marketplace" element={<AppLayout><OperatorMarketplacePage /></AppLayout>} />
        <Route path="/operator/register" element={<AppLayout><OperatorRegisterPage /></AppLayout>} />
        <Route path="/operator/:operatorAddress" element={<AppLayout><OperatorProfilePage /></AppLayout>} />

        {/* Governance */}
        <Route path="/governance" element={<AppLayout><GovernancePage /></AppLayout>} />

        {/* Vault creation (standalone layout) */}
        <Route path="/create" element={<CreateVaultPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
