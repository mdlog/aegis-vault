import { Link } from 'react-router-dom';
import { useChainId } from 'wagmi';
import { getDeployments } from '../../lib/contracts';
import { useTokenBalance } from '../../hooks/useVault';
import { useStakingStats, useInsurancePoolStats } from '../../hooks/useOperatorStaking';
import { useGovernorConfig, useProposals } from '../../hooks/useGovernor';
import GlassPanel from '../ui/GlassPanel';
import SectionLabel from '../ui/SectionLabel';
import {
  Lock, Vote, ShieldCheck, DollarSign, ArrowRight, Award,
} from 'lucide-react';

/**
 * Dashboard widget summarizing Phase 1-5 protocol state:
 *   - Total staked across all operators (Phase 2)
 *   - Protocol treasury balance (Phase 1)
 *   - Insurance pool balance + claim count (Phase 2)
 *   - Active governance proposals (Phase 4)
 *
 * Hidden entirely if none of these contracts are deployed on the current chain
 * (graceful degradation for MVP / dev networks).
 */
export default function ProtocolHealthPanel() {
  const chainId = useChainId();
  const deployments = getDeployments(chainId);

  const { balance: treasuryUsdc } = useTokenBalance(deployments.mockUSDC, deployments.protocolTreasury, 6);
  const { totalStakers, totalStakedUsd } = useStakingStats(deployments.operatorStaking);
  const { balance: insuranceBalance, claimCount } = useInsurancePoolStats(
    deployments.insurancePool,
    deployments.mockUSDC
  );
  const { totalProposals, threshold, owners } = useGovernorConfig(deployments.aegisGovernor);
  const { proposals } = useProposals(deployments.aegisGovernor, totalProposals);

  const pendingProposals = proposals.filter(p => !p.executed && !p.canceled).length;
  const readyProposals = proposals.filter(p => !p.executed && !p.canceled && p.confirmations >= threshold).length;

  // Any of the phase 2-4 contracts deployed?
  const anyDeployed = !!(
    deployments.operatorStaking ||
    deployments.protocolTreasury ||
    deployments.insurancePool ||
    deployments.aegisGovernor
  );
  if (!anyDeployed) return null;

  return (
    <div className="mb-8">
      <SectionLabel color="text-cyan/60">
        Protocol Health
        <span className="ml-2 text-[9px] font-mono text-cyan/40 px-1.5 py-0.5 rounded bg-cyan/5 border border-cyan/10">
          PHASE 1-4
        </span>
      </SectionLabel>
      <GlassPanel className="p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

          {/* Total Staked */}
          <ProtocolStat
            icon={Lock}
            iconColor="text-gold/70"
            bg="bg-gold/[0.04]"
            border="border-gold/15"
            label="Operator Stake"
            value={`$${(totalStakedUsd || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            subValue={`${totalStakers || 0} operator${totalStakers === 1 ? '' : 's'} staked`}
            accent="text-gold"
            enabled={!!deployments.operatorStaking}
          />

          {/* Treasury */}
          <ProtocolStat
            icon={DollarSign}
            iconColor="text-emerald-soft/70"
            bg="bg-emerald-soft/[0.04]"
            border="border-emerald-soft/15"
            label="Protocol Treasury"
            value={`$${parseFloat(treasuryUsdc || '0').toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            subValue="20% of all fees"
            accent="text-emerald-soft"
            enabled={!!deployments.protocolTreasury}
          />

          {/* Insurance Pool */}
          <ProtocolStat
            icon={ShieldCheck}
            iconColor="text-cyan/70"
            bg="bg-cyan/[0.04]"
            border="border-cyan/15"
            label="Insurance Pool"
            value={`$${(insuranceBalance || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            subValue={`${claimCount || 0} claim${claimCount === 1 ? '' : 's'} submitted`}
            accent="text-cyan"
            enabled={!!deployments.insurancePool}
          />

          {/* Governance */}
          <Link
            to="/governance"
            className={`block group ${!deployments.aegisGovernor ? 'pointer-events-none opacity-40' : ''}`}
          >
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.05] p-3 h-full transition-all group-hover:border-gold/30 group-hover:bg-gold/[0.03]">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <Vote className="w-3 h-3 text-steel/50 group-hover:text-gold/60 transition-colors" />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-steel/45">
                    Governance
                  </span>
                </div>
                <ArrowRight className="w-3 h-3 text-steel/20 group-hover:text-gold/60 transition-all group-hover:translate-x-0.5" />
              </div>
              {deployments.aegisGovernor ? (
                <>
                  <div className="text-xl lg:text-2xl font-display font-semibold text-white tabular-nums leading-tight">
                    {threshold || 0}<span className="text-steel/40">/</span>{owners?.length || 0}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono">
                    <span className="text-steel/45">{totalProposals || 0} proposal{totalProposals === 1 ? '' : 's'}</span>
                    {pendingProposals > 0 && (
                      <span className="text-amber-warn/70">
                        · {pendingProposals} pending
                      </span>
                    )}
                    {readyProposals > 0 && (
                      <span className="text-gold animate-pulse">
                        · {readyProposals} ready
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-xs text-steel/30 italic mt-1">Not deployed</div>
              )}
            </div>
          </Link>
        </div>

        {/* Call-to-action strip */}
        <div className="mt-4 pt-3 border-t border-white/[0.04] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[10px] font-mono text-steel/40">
          <span className="flex items-center gap-1.5">
            <Award className="w-3 h-3 text-gold/60" />
            Protocol health reflects Phase 1-4 deployment. Slashing, treasury, insurance gated via governance.
          </span>
          <Link
            to="/marketplace"
            className="text-gold/60 hover:text-gold transition-colors flex items-center gap-1 self-start sm:self-auto"
          >
            Browse operators <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </GlassPanel>
    </div>
  );
}

function ProtocolStat({ icon: Icon, iconColor, bg, border, label, value, subValue, accent, enabled }) {
  if (!enabled) {
    return (
      <div className="rounded-lg bg-white/[0.02] border border-white/[0.05] p-3 opacity-40">
        <div className="flex items-center gap-1.5 mb-1">
          <Icon className="w-3 h-3 text-steel/40" />
          <span className="text-[9px] font-mono uppercase tracking-wider text-steel/40">{label}</span>
        </div>
        <div className="text-xs text-steel/30 italic mt-1">Not deployed</div>
      </div>
    );
  }
  return (
    <div className={`rounded-lg ${bg} border ${border} p-3`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3 h-3 ${iconColor}`} />
        <span className="text-[9px] font-mono uppercase tracking-wider text-steel/45">{label}</span>
      </div>
      <div className={`text-xl lg:text-2xl font-display font-semibold ${accent} tabular-nums leading-tight`}>
        {value}
      </div>
      <div className="text-[10px] text-steel/40 mt-0.5">{subValue}</div>
    </div>
  );
}
