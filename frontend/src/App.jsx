import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import CreateVaultPage from './pages/CreateVaultPage';
import VaultDetailPage from './pages/VaultDetailPage';
import ActionsPage from './pages/ActionsPage';
import JournalPage from './pages/JournalPage';
import SettingsPage from './pages/SettingsPage';
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
        <Route path="/app/vault" element={<AppLayout><VaultDetailPage /></AppLayout>} />
        <Route path="/app/actions" element={<AppLayout><ActionsPage /></AppLayout>} />
        <Route path="/app/journal" element={<AppLayout><JournalPage /></AppLayout>} />
        <Route path="/app/settings" element={<AppLayout><SettingsPage /></AppLayout>} />

        {/* Vault creation (standalone layout) */}
        <Route path="/create" element={<CreateVaultPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
