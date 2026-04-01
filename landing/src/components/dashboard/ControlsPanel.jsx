import { useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import GlassPanel from '../ui/GlassPanel';
import SectionLabel from '../ui/SectionLabel';
import ControlButton from '../ui/ControlButton';
import { usePause, useUnpause, useWithdraw, useVaultSummary } from '../../hooks/useVault';
import { useTriggerCycle } from '../../hooks/useOrchestrator';
import { getDeployments } from '../../lib/contracts';
import { PauseCircle, PlayCircle, ArrowDownToLine, Settings, Zap, Download, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ControlsPanel() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const vaultAddr = deployments.demoVault;

  const { data: vault, refetch } = useVaultSummary(vaultAddr);
  const isPaused = vault?.paused || false;

  const [confirmPause, setConfirmPause] = useState(false);
  const navigate = useNavigate();

  // Contract write hooks
  const { pause, isPending: pausePending } = usePause();
  const { unpause, isPending: unpausePending } = useUnpause();
  const { trigger: triggerCycle, loading: cyclePending } = useTriggerCycle();

  const handlePauseToggle = () => {
    if (!isConnected) return;
    if (!isPaused && !confirmPause) {
      setConfirmPause(true);
      return;
    }
    if (isPaused) {
      unpause(vaultAddr);
    } else {
      pause(vaultAddr);
    }
    setConfirmPause(false);
    setTimeout(() => refetch(), 2000);
  };

  const handleTriggerCycle = async () => {
    await triggerCycle();
    setTimeout(() => refetch(), 3000);
  };

  return (
    <div>
      <SectionLabel color="text-steel/50">Vault Controls</SectionLabel>
      <GlassPanel className="p-5">
        {/* Emergency pause — prominent */}
        <div className="mb-4 pb-4 border-b border-white/[0.04]">
          {!confirmPause ? (
            <ControlButton
              variant={isPaused ? 'gold' : 'danger'}
              className="w-full"
              onClick={handlePauseToggle}
              disabled={!isConnected || pausePending || unpausePending}
            >
              {isPaused ? (
                <><PlayCircle className="w-4 h-4" /> {unpausePending ? 'Resuming...' : 'Resume Vault'}</>
              ) : (
                <><PauseCircle className="w-4 h-4" /> {pausePending ? 'Pausing...' : 'Emergency Pause'}</>
              )}
            </ControlButton>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-red-warn/80 text-center mb-2">
                This will immediately halt all AI execution. Confirm?
              </p>
              <div className="flex gap-2">
                <ControlButton variant="danger" className="flex-1" onClick={handlePauseToggle} disabled={pausePending}>
                  {pausePending ? 'Pausing...' : 'Confirm Pause'}
                </ControlButton>
                <ControlButton variant="secondary" className="flex-1" onClick={() => setConfirmPause(false)}>
                  Cancel
                </ControlButton>
              </div>
            </div>
          )}
        </div>

        {/* Trigger AI cycle */}
        <div className="mb-3">
          <ControlButton variant="secondary" className="w-full" onClick={handleTriggerCycle} disabled={cyclePending}>
            <Zap className="w-3.5 h-3.5" /> {cyclePending ? 'Running Cycle...' : 'Trigger AI Cycle'}
          </ControlButton>
        </div>

        {/* Other controls */}
        <div className="grid grid-cols-2 gap-2">
          <ControlButton variant="secondary" disabled={!isConnected}>
            <ArrowDownToLine className="w-3.5 h-3.5" /> Withdraw
          </ControlButton>
          <ControlButton variant="secondary" disabled={!isConnected}>
            <Settings className="w-3.5 h-3.5" /> Edit Policy
          </ControlButton>
        </div>

        {/* Create new vault */}
        <div className="mt-3">
          <ControlButton variant="gold" className="w-full" onClick={() => navigate('/create')}>
            <Plus className="w-3.5 h-3.5" /> Create New Vault
          </ControlButton>
        </div>

        {!isConnected && (
          <p className="text-[10px] text-steel/40 text-center mt-3">
            Connect wallet to enable controls
          </p>
        )}
      </GlassPanel>
    </div>
  );
}
