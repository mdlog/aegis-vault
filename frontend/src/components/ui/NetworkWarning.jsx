import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useChainId, useSwitchChain } from 'wagmi';
import { getNetworkLabel } from '../../lib/contracts';
import GlassPanel from './GlassPanel';

// Renders a banner if the connected wallet is on a chain where the required
// contract is not deployed. Pass `requiredAddress` (e.g. registryAddress) and
// optionally `expectedChainId` to suggest a chain switch in the wallet.
export default function NetworkWarning({
  requiredAddress,
  expectedChainId,
  contractName = 'this contract',
}) {
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (requiredAddress) return null;

  const currentLabel = getNetworkLabel(chainId);
  const targetLabel = expectedChainId ? getNetworkLabel(expectedChainId) : null;

  return (
    <GlassPanel className="p-4 mb-6 border-amber-warn/25 bg-amber-warn/[0.04]">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-warn flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white/85 font-medium">
            {contractName} is not deployed on {currentLabel}
          </p>
          <p className="text-[11px] text-steel/55 mt-1 leading-relaxed">
            {targetLabel
              ? `Switch your wallet to ${targetLabel} to continue.`
              : 'Switch your wallet to a supported network to continue.'}
          </p>
        </div>
        {expectedChainId && switchChain && (
          <button
            type="button"
            onClick={() => switchChain({ chainId: expectedChainId })}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-warn/30 bg-amber-warn/10 text-[11px] font-mono text-amber-warn hover:bg-amber-warn/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isPending ? 'animate-spin' : ''}`} />
            {isPending ? 'Switching…' : `Switch to ${targetLabel || 'supported network'}`}
          </button>
        )}
      </div>
    </GlassPanel>
  );
}
