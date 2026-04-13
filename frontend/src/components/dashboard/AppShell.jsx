import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import Logo from '../ui/Logo';
import StatusPill from '../ui/StatusPill';
import WalletButton from '../ui/WalletButton';
import { useVaultList } from '../../hooks/useVault';
import { useAlerts, useOrchestratorStatus } from '../../hooks/useOrchestrator';
import { getDefaultVaultAddress, getDeployments, getNetworkLabel, getSettingsRoute, getVaultRoute } from '../../lib/contracts';
import {
  LayoutDashboard, Shield, Activity, FileText, Settings, Cpu, Vote, Droplets,
  ChevronDown, Bell, Globe, Menu, X
} from 'lucide-react';

export default function AppShell({ children }) {
  const location = useLocation();
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);

  const [vaultOpen, setVaultOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(null);

  // Real vault list from on-chain factory
  const { vaults, isLoading: vaultsLoading, count: vaultCount } = useVaultList(
    deployments.aegisVaultFactory,
    address
  );
  const { data: orchStatus } = useOrchestratorStatus();
  const { data: alerts } = useAlerts(6);

  // Only show vaults owned by the connected wallet
  const displayVaults = vaults;
  const routeVaultAddress = location.pathname.startsWith('/app/vault/') || location.pathname.startsWith('/app/settings/')
    ? location.pathname.split('/')[3]
    : null;
  const activeVaultAddress = routeVaultAddress || displayVaults[0]?.address || getDefaultVaultAddress(chainId);

  // Current vault name (derive from address)
  const currentVaultLabel = activeVaultAddress
    ? `Vault ${activeVaultAddress?.slice(0, 6)}...${activeVaultAddress?.slice(-4)}`
    : 'No Vault';
  const navItems = [
    { label: 'Overview', path: '/app', icon: LayoutDashboard, active: location.pathname === '/app' },
    { label: 'Vault Detail', path: getVaultRoute(activeVaultAddress), icon: Shield, active: location.pathname.startsWith('/app/vault') },
    { label: 'Marketplace', path: '/marketplace', icon: Cpu, active: location.pathname === '/marketplace' || location.pathname.startsWith('/operator') },
    { label: 'Governance', path: '/governance', icon: Vote, active: location.pathname === '/governance' },
    { label: 'AI Actions', path: '/app/actions', icon: Activity, active: location.pathname === '/app/actions' || location.pathname === '/app/journal' },
    { label: 'Settings', path: getSettingsRoute(activeVaultAddress), icon: Settings, active: location.pathname.startsWith('/app/settings') },
    { label: 'Faucet', path: '/faucet', icon: Droplets, active: location.pathname === '/faucet' },
  ];
  const alertCount = Math.max(alerts?.length || 0, orchStatus?.pendingApprovalCount || 0);

  return (
    <div className="min-h-screen bg-obsidian flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-obsidian/95 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="max-w-[1440px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between gap-4">
          {/* Left: Logo + vault switcher */}
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2.5 group">
              <Logo size={24} />
              <span className="text-xs font-medium tracking-[0.12em] uppercase text-white/70 group-hover:text-white transition-colors hidden sm:inline">
                Aegis Vault
              </span>
            </Link>

            <div className="h-5 w-px bg-white/[0.06] hidden sm:block" />

            {/* Vault switcher */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setVaultOpen(!vaultOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06]
                  hover:border-white/[0.1] transition-all text-xs"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isConnected && displayVaults.length > 0 ? 'bg-emerald-soft' : 'bg-steel/50'}`} />
                <span className="text-white/70 font-medium max-w-[140px] truncate">
                  {!isConnected ? 'Not Connected' : vaultsLoading ? 'Loading...' : currentVaultLabel}
                </span>
                <ChevronDown className="w-3 h-3 text-steel/50" />
              </button>

              {vaultOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setVaultOpen(false)} />
                  <div className="absolute top-full left-0 mt-1 w-72 rounded-lg py-1 z-50 shadow-2xl bg-[#13131a] border border-white/[0.08]">
                    {!isConnected ? (
                      <div className="px-3 py-4 text-center">
                        <p className="text-xs text-steel/50 mb-2">Connect wallet to see your vaults</p>
                        <WalletButton />
                      </div>
                    ) : displayVaults.length === 0 ? (
                      <div className="px-3 py-4 text-center">
                        <p className="text-xs text-steel/50">No vaults found for this wallet</p>
                      </div>
                    ) : (
                      displayVaults.map((v, i) => {
                        const shortAddr = `${v.address?.slice(0, 6)}...${v.address?.slice(-4)}`;
                        const isPaused = v.loaded ? v.paused : false;
                        const balance = v.loaded ? `$${parseFloat(v.balance).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Loading...';

                        return (
                          <div
                            key={v.address || i}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors"
                          >
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isPaused ? 'bg-amber-warn' : 'bg-emerald-soft'}`} />
                            <Link
                              to={getVaultRoute(v.address)}
                              onClick={() => setVaultOpen(false)}
                              className="flex-1 min-w-0"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-white/70 truncate font-mono">{shortAddr}</span>
                                {isPaused && <StatusPill label="Paused" variant="paused" />}
                              </div>
                              <div className="text-[10px] font-mono text-steel/40">
                                {balance} {v.loaded && `· ${v.dailyActions} actions today`}
                              </div>
                            </Link>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(v.address);
                                setCopiedAddr(v.address);
                                setTimeout(() => setCopiedAddr(null), 1500);
                              }}
                              className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center
                                hover:bg-white/[0.06] transition-colors text-steel/40 hover:text-white/70"
                              title="Copy vault address"
                            >
                              {copiedAddr === v.address ? (
                                <svg className="w-3.5 h-3.5 text-emerald-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                                </svg>
                              )}
                            </button>
                          </div>
                        );
                      })
                    )}

                    <div className="border-t border-white/[0.04] mt-1 pt-1">
                      <div className="px-3 py-1 text-[9px] font-mono text-steel/30">
                        {vaultCount} vault{vaultCount !== 1 ? 's' : ''} on-chain
                      </div>
                      <Link
                        to="/create"
                        onClick={() => setVaultOpen(false)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-mono text-gold/70 hover:text-gold transition-colors"
                      >
                        + Create New Vault
                      </Link>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Center: Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => {
              const active = item.active;
              return (
                <Link
                  key={item.label}
                  to={item.path}
                  className={`flex items-center px-3 py-1.5 rounded-md text-[11px] font-medium tracking-wide transition-all duration-200
                    ${active
                      ? 'text-white bg-white/[0.06] border border-white/[0.06]'
                      : 'text-steel/60 hover:text-steel/90 hover:bg-white/[0.02]'
                    }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right: Status + Wallet + Mobile toggle */}
          <div className="flex items-center gap-3">
            {/* Network */}
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-steel/50">
              <Globe className="w-3 h-3" />
              <span>{getNetworkLabel(chainId)}</span>
            </div>

            {/* Notifications */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative w-8 h-8 rounded-md flex items-center justify-center hover:bg-white/[0.03] transition-colors"
              >
                <Bell className="w-4 h-4 text-steel/50" />
                {alertCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-warn" />
                )}
              </button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                  <div className="absolute top-full right-0 mt-1 w-72 glass-panel rounded-lg p-3 z-50 shadow-2xl">
                    <div className="text-[10px] font-mono text-steel/40 uppercase tracking-wider mb-2">Notifications</div>
                    {alerts && alerts.length > 0 ? (
                      <div className="space-y-2">
                        {alerts.map((alert) => (
                          <div key={alert.id} className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[10px] text-white/70 line-clamp-1">{alert.message}</span>
                              <StatusPill
                                label={alert.level || 'info'}
                                variant={alert.level === 'critical' ? 'critical' : alert.level === 'warning' ? 'warning' : 'info'}
                              />
                            </div>
                            <div className="text-[9px] font-mono text-steel/35">
                              {alert.vault ? `${alert.vault.slice(0, 8)}...${alert.vault.slice(-4)}` : 'Global'}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-steel/40 py-2 text-center">No new notifications</div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Wallet */}
            <WalletButton />

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="lg:hidden w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/[0.03] transition-colors"
            >
              {mobileNavOpen ? <X className="w-4 h-4 text-steel" /> : <Menu className="w-4 h-4 text-steel" />}
            </button>
          </div>
        </div>

        {/* Mobile nav dropdown */}
        {mobileNavOpen && (
          <div className="lg:hidden bg-obsidian/98 backdrop-blur-xl border-t border-white/[0.04] px-4 py-3 space-y-1">
            {navItems.map((item) => {
              const active = item.active;
              const Icon = item.icon;
              return (
                <Link
                  key={item.label}
                  to={item.path}
                  onClick={() => setMobileNavOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all
                    ${active
                      ? 'text-white bg-white/[0.06]'
                      : 'text-steel/60 hover:text-white hover:bg-white/[0.03]'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
            <Link
              to="/create"
              onClick={() => setMobileNavOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-gold/70 hover:text-gold hover:bg-gold/5 transition-all"
            >
              + Create New Vault
            </Link>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-6 mt-12">
        <div className="max-w-[1440px] mx-auto px-4 lg:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo size={18} />
            <span className="text-[10px] font-mono tracking-[0.12em] uppercase text-steel/40">
              Aegis Vault
            </span>
          </div>
          <div className="flex items-center gap-5">
            {['Documentation', 'GitHub', 'Architecture', 'Contact'].map((link) => (
              <a
                key={link}
                href="#"
                className="text-[10px] tracking-[0.08em] uppercase text-steel/30 hover:text-steel/60 transition-colors duration-300"
              >
                {link}
              </a>
            ))}
          </div>
          <div className="text-[10px] font-mono tracking-wider text-steel/20">
            Built on 0G · 2025
          </div>
        </div>
      </footer>
    </div>
  );
}
