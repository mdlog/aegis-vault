import { useAccount, useChainId } from 'wagmi';
import { useParams } from 'react-router-dom';
import { useVaultPolicy, useAllowedAssets, useVaultList } from '../hooks/useVault';
import { useOGStorageStatus, useOrchestratorStatus } from '../hooks/useOrchestrator';
import { getDeployments } from '../lib/contracts';
import GlassPanel from '../components/ui/GlassPanel';
import StatusPill from '../components/ui/StatusPill';
import SectionLabel from '../components/ui/SectionLabel';
import PolicyChip from '../components/ui/PolicyChip';
import {
  Shield, TrendingDown, Target, Clock, AlertTriangle,
  Layers, Lock, Zap, Globe, Database, Cpu, ExternalLink
} from 'lucide-react';

function AddressRow({ label, address, explorer }) {
  const short = address ? `${address.slice(0, 10)}...${address.slice(-8)}` : 'Not set';
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
      <span className="text-xs text-steel/60">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-white/50">{short}</span>
        {address && explorer && (
          <a href={`${explorer}/address/${address}`} target="_blank" rel="noopener noreferrer"
            className="text-cyan/30 hover:text-cyan/60 transition-colors">
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const { vaultAddress: routeVaultAddress } = useParams();
  const { vaults: myVaults } = useVaultList(deployments.aegisVaultFactory, address);
  const vaultAddr = routeVaultAddress || myVaults[0]?.address || deployments.demoVault;

  const { data: policy } = useVaultPolicy(vaultAddr);
  const { data: assets } = useAllowedAssets(vaultAddr);
  const { data: ogStatus } = useOGStorageStatus();
  const { data: orchStatus } = useOrchestratorStatus();

  const explorer = chainId === 16602 ? 'https://chainscan-galileo.0g.ai' : null;

  return (
    <div className="max-w-[1440px] mx-auto px-4 lg:px-6 py-6 lg:py-8">
      <h1 className="text-xl font-display font-semibold text-white tracking-tight mb-1">Settings & System Info</h1>
      <p className="text-xs text-steel/50 mb-6">Contract addresses, policy configuration, and system status.</p>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Contract Addresses */}
        <div>
          <SectionLabel color="text-cyan/60">Contract Addresses</SectionLabel>
          <GlassPanel className="p-5">
            <AddressRow label="Vault" address={vaultAddr} explorer={explorer} />
            <AddressRow label="Factory" address={deployments.aegisVaultFactory} explorer={explorer} />
            <AddressRow label="Registry" address={deployments.executionRegistry} explorer={explorer} />
            <AddressRow label="MockDEX" address={deployments.mockDEX} explorer={explorer} />
            <AddressRow label="USDC" address={deployments.mockUSDC} explorer={explorer} />
            <AddressRow label="WBTC" address={deployments.mockWBTC} explorer={explorer} />
            <AddressRow label="WETH" address={deployments.mockWETH} explorer={explorer} />
            <div className="mt-3 pt-2 border-t border-white/[0.04]">
              <div className="flex items-center justify-between">
                <span className="text-xs text-steel/60">Network</span>
                <span className="text-[11px] font-mono text-white/50">
                  {chainId === 16602 ? '0G Galileo (16602)' : chainId === 31337 ? 'Hardhat Local (31337)' : `Chain ${chainId}`}
                </span>
              </div>
            </div>
          </GlassPanel>
        </div>

        {/* Current Policy */}
        <div>
          <SectionLabel color="text-gold/60">Vault Policy</SectionLabel>
          <GlassPanel gold className="p-5">
            {policy ? (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-4 h-4 text-gold/60" />
                  <span className="text-xs font-display font-medium text-white/80">
                    {policy.maxPositionPct <= 30 ? 'Defensive' : policy.maxPositionPct <= 50 ? 'Balanced' : 'Tactical'} Mandate
                  </span>
                  <StatusPill label={policy.paused ? 'Paused' : 'Active'} variant={policy.paused ? 'paused' : 'active'} pulse={!policy.paused} />
                </div>
                <PolicyChip label="Max Position" value={`${policy.maxPositionPct}%`} icon={<Target className="w-3.5 h-3.5" />} />
                <PolicyChip label="Max Daily Loss" value={`${policy.maxDailyLossPct}%`} icon={<TrendingDown className="w-3.5 h-3.5" />} />
                <PolicyChip label="Stop-Loss" value={`${policy.stopLossPct}%`} icon={<AlertTriangle className="w-3.5 h-3.5" />} />
                <PolicyChip label="Cooldown" value={`${policy.cooldownSeconds}s`} icon={<Clock className="w-3.5 h-3.5" />} />
                <PolicyChip label="Confidence Min" value={`${policy.confidenceThresholdPct}%`} icon={<Zap className="w-3.5 h-3.5" />} />
                <PolicyChip label="Max Actions/Day" value={policy.maxActionsPerDay} icon={<Layers className="w-3.5 h-3.5" />} />
                <PolicyChip label="Auto-Execution" value={policy.autoExecution ? 'Enabled' : 'Disabled'} icon={<Zap className="w-3.5 h-3.5" />} />
                <PolicyChip label="Sealed Mode" value="Roadmap" icon={<Lock className="w-3.5 h-3.5" />} />

                {assets && (
                  <div className="mt-3 pt-2 border-t border-white/[0.04]">
                    <span className="text-[10px] font-mono text-steel/40 block mb-1.5">Allowed Assets ({assets.length})</span>
                    <div className="flex flex-wrap gap-1">
                      {assets.map((a, i) => (
                        <span key={i} className="px-2 py-0.5 rounded text-[9px] font-mono text-white/50 bg-white/[0.03] border border-white/[0.05]">
                          {a.slice(0, 8)}...
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-steel/40">{isConnected ? 'Loading policy...' : 'Connect wallet to view policy'}</p>
            )}
          </GlassPanel>
        </div>

        {/* Orchestrator Status */}
        <div>
          <SectionLabel color="text-cyan/60">Orchestrator</SectionLabel>
          <GlassPanel className="p-5">
            {orchStatus ? (
              <>
                <PolicyChip label="Status" value={orchStatus.running ? 'Running' : 'Idle'} icon={<Cpu className="w-3.5 h-3.5" />} />
                <PolicyChip
                  label="Executor Wallet"
                  value={orchStatus.executorAddress ? `${orchStatus.executorAddress.slice(0, 8)}...${orchStatus.executorAddress.slice(-6)}` : 'Not configured'}
                  icon={<Shield className="w-3.5 h-3.5" />}
                />
                <PolicyChip
                  label="Mutation Auth"
                  value={orchStatus.mutationAuthMode === 'api-key' ? 'API Key' : 'Localhost Only'}
                  icon={<Lock className="w-3.5 h-3.5" />}
                />
                <PolicyChip label="Total Cycles" value={orchStatus.cycleCount || 0} icon={<Clock className="w-3.5 h-3.5" />} />
                <PolicyChip label="Executions" value={orchStatus.totalExecutions || 0} icon={<Shield className="w-3.5 h-3.5" />} />
                <PolicyChip label="Blocked" value={orchStatus.totalBlocked || 0} icon={<AlertTriangle className="w-3.5 h-3.5" />} />
                <PolicyChip label="Skipped (Hold)" value={orchStatus.totalSkipped || 0} icon={<Clock className="w-3.5 h-3.5" />} />
                <PolicyChip label="Pending Approvals" value={orchStatus.pendingApprovalCount || 0} icon={<Lock className="w-3.5 h-3.5" />} />
                <PolicyChip label="Managed Vaults" value={orchStatus.managedVaultCount || 0} icon={<Layers className="w-3.5 h-3.5" />} />
                {orchStatus.lastSignal && (
                  <div className="mt-3 pt-2 border-t border-white/[0.04]">
                    <span className="text-[10px] font-mono text-steel/40 block mb-1">Last Signal</span>
                    <span className="text-xs text-white/60">
                      {orchStatus.lastSignal.action.toUpperCase()} {orchStatus.lastSignal.asset} — {orchStatus.lastSignal.reason?.substring(0, 60)}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-steel/40">Orchestrator not reachable. Start it with: <code className="text-cyan/50">cd orchestrator && npm start</code></p>
            )}
          </GlassPanel>
        </div>

        {/* 0G Storage Status */}
        <div>
          <SectionLabel color="text-emerald-soft/60">0G Storage</SectionLabel>
          <GlassPanel className="p-5">
            {ogStatus ? (
              <>
                <PolicyChip label="Connected" value={ogStatus.available ? 'Yes' : 'No'} icon={<Database className="w-3.5 h-3.5" />} />
                <PolicyChip label="Indexer" value={ogStatus.indexer?.replace('https://', '') || 'N/A'} icon={<Globe className="w-3.5 h-3.5" />} />
                <PolicyChip label="KV Node" value={ogStatus.kvNode || 'N/A'} icon={<Database className="w-3.5 h-3.5" />} />
              </>
            ) : (
              <p className="text-xs text-steel/40">0G Storage status unavailable. Start orchestrator first.</p>
            )}
          </GlassPanel>
        </div>

        <div className="lg:col-span-2">
          <SectionLabel color="text-gold/60">Bring Your Own Orchestrator</SectionLabel>
          <GlassPanel gold className="p-5">
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-4 py-4">
                <div className="text-[10px] font-mono tracking-[0.12em] uppercase text-gold/50 mb-2">1. Run It</div>
                <p className="text-xs text-white/70 leading-relaxed">
                  Start your orchestrator with the wallet you want to trust as executor.
                </p>
                <p className="text-[11px] font-mono text-cyan/55 mt-2">
                  {orchStatus?.executorAddress || 'Executor wallet not detected yet'}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-4 py-4">
                <div className="text-[10px] font-mono tracking-[0.12em] uppercase text-gold/50 mb-2">2. Point The Vault</div>
                <p className="text-xs text-white/70 leading-relaxed">
                  Set the vault executor to the same address from the vault detail page or at creation time.
                </p>
                <p className="text-[11px] text-steel/45 mt-2">
                  Current vault: {vaultAddr ? `${vaultAddr.slice(0, 8)}...${vaultAddr.slice(-6)}` : 'No vault selected'}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-4 py-4">
                <div className="text-[10px] font-mono tracking-[0.12em] uppercase text-gold/50 mb-2">3. Verify Sync</div>
                <p className="text-xs text-white/70 leading-relaxed">
                  When the API executor and vault executor match, that orchestrator can manage the vault within its on-chain policy.
                </p>
                <p className="text-[11px] text-steel/45 mt-2">
                  Auth mode: {orchStatus?.mutationAuthMode === 'api-key' ? 'API key protected' : 'Localhost-only mutations'}
                </p>
              </div>
            </div>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
