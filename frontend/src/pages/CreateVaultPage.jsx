import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { isAddress } from 'viem';
import GlassPanel from '../components/ui/GlassPanel';
import ControlButton from '../components/ui/ControlButton';
import StatusPill from '../components/ui/StatusPill';
import WalletButton from '../components/ui/WalletButton';
import Logo from '../components/ui/Logo';
import { useCreateVault } from '../hooks/useVault';
import { useOrchestratorStatus } from '../hooks/useOrchestrator';
import { useOperatorList, MandateLabel } from '../hooks/useOperatorRegistry';
import { formatBps, estimateAnnualFees } from '../hooks/useVaultFees';
import {
  useOperatorTiers, TIER_LABELS, TIER_COLORS, formatVaultCap,
} from '../hooks/useOperatorStaking';
import { getDeployments } from '../lib/contracts';
import TokenIcon from '../components/ui/TokenIcon';
import {
  ArrowLeft, ArrowRight, Check, Shield, Lock, Zap, Cpu,
  TrendingDown, Target, Clock, AlertTriangle, Layers, Wallet,
  TrendingUp, Percent, DollarSign, Info, Award
} from 'lucide-react';

const steps = [
  { key: 'deposit', label: 'Deposit', number: '01' },
  { key: 'risk', label: 'Risk Profile', number: '02' },
  { key: 'policy', label: 'Policy', number: '03' },
  { key: 'assets', label: 'Assets', number: '04' },
  { key: 'sealed', label: 'Privacy', number: '05' },
  { key: 'review', label: 'Review', number: '06' },
];

const riskProfiles = [
  {
    id: 'defensive',
    label: 'Defensive',
    description: 'Capital preservation focus. Minimal exposure, strict drawdown limits, high confidence thresholds.',
    maxDrawdown: 5, maxPosition: 30, confidence: 0.80, color: 'text-emerald-soft', border: 'border-emerald-soft/30',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Risk-adjusted growth. Moderate positions, balanced guardrails, standard confidence threshold.',
    maxDrawdown: 10, maxPosition: 50, confidence: 0.60, color: 'text-cyan', border: 'border-cyan/30',
  },
  {
    id: 'tactical',
    label: 'Tactical',
    description: 'Active alpha pursuit. Larger positions, wider drawdown tolerance, lower confidence floor.',
    maxDrawdown: 20, maxPosition: 70, confidence: 0.45, color: 'text-gold', border: 'border-gold/30',
  },
];

const availableAssets = [
  { symbol: 'BTC', name: 'Bitcoin', color: '#f7931a' },
  { symbol: 'ETH', name: 'Ethereum', color: '#627eea' },
  { symbol: 'USDC', name: 'USD Coin', color: '#2775ca' },
  { symbol: '0G', name: '0G Token', color: '#4cc9f0' },
];

export default function CreateVaultPage() {
  const navigate = useNavigate();
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const { createVault, isPending: createPending } = useCreateVault();
  const { data: orchStatus } = useOrchestratorStatus();
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState({
    depositAmount: 50000,
    riskProfile: 'balanced',
    maxDrawdown: 10,
    maxPosition: 50,
    dailyLossLimit: 5,
    cooldown: 15,
    confidenceThreshold: 60,
    stopLoss: 15,
    maxActionsPerDay: 20,
    allowedAssets: ['BTC', 'ETH', 'USDC', '0G'],
    sealedMode: false,
    autoExecution: true,
  });
  const [executorMode, setExecutorMode] = useState('');
  const [customExecutor, setCustomExecutor] = useState('');
  const [selectedMarketplaceOperator, setSelectedMarketplaceOperator] = useState('');

  const { operators: marketplaceOperators } = useOperatorList(deployments.operatorRegistry);
  const activeMarketplaceOperators = marketplaceOperators.filter((op) => op.loaded && op.active);

  // Phase 2: tier data for all marketplace operators
  const allOperatorAddrs = activeMarketplaceOperators.map((op) => op.wallet);
  const { tiersByAddress } = useOperatorTiers(deployments.operatorStaking, allOperatorAddrs);

  const currentStep = steps[step];
  const selectedProfile = riskProfiles.find((p) => p.id === config.riskProfile);
  const detectedExecutor = orchStatus?.executorAddress || '';
  const canUseDetectedExecutor = Boolean(detectedExecutor);
  const activeExecutorMode =
    executorMode || (canUseDetectedExecutor && !customExecutor ? 'orchestrator' : 'marketplace');

  // Selected operator full metadata (for fee preview + recommended policy preset)
  const selectedOperatorData =
    activeExecutorMode === 'marketplace' && selectedMarketplaceOperator
      ? activeMarketplaceOperators.find(
          (op) => op.wallet?.toLowerCase() === selectedMarketplaceOperator.toLowerCase()
        )
      : null;
  const selectedOperatorTier = selectedOperatorData
    ? tiersByAddress[selectedOperatorData.wallet?.toLowerCase()]
    : null;
  // Cap exceeded if selected operator's tier doesn't allow this deposit size
  const exceedsTierCap = selectedOperatorTier && !selectedOperatorTier.isUnlimited
    && config.depositAmount > selectedOperatorTier.maxVaultSize;

  let resolvedExecutor = '';
  if (activeExecutorMode === 'orchestrator') resolvedExecutor = detectedExecutor.trim();
  else if (activeExecutorMode === 'marketplace') resolvedExecutor = selectedMarketplaceOperator.trim();
  else resolvedExecutor = customExecutor.trim();

  const executorReady = Boolean(resolvedExecutor) && isAddress(resolvedExecutor);
  const shortExecutor = executorReady
    ? `${resolvedExecutor.slice(0, 8)}...${resolvedExecutor.slice(-6)}`
    : 'Not configured';

  const updateConfig = (key, value) => setConfig((prev) => ({ ...prev, [key]: value }));

  const toggleAsset = (symbol) => {
    setConfig((prev) => ({
      ...prev,
      allowedAssets: prev.allowedAssets.includes(symbol)
        ? prev.allowedAssets.filter((a) => a !== symbol)
        : [...prev.allowedAssets, symbol],
    }));
  };

  const selectProfile = (id) => {
    const profile = riskProfiles.find((p) => p.id === id);
    const presets = {
      defensive: { maxActionsPerDay: 10, cooldown: 20, dailyLossLimit: 3, stopLoss: 10 },
      balanced: { maxActionsPerDay: 20, cooldown: 15, dailyLossLimit: 5, stopLoss: 15 },
      tactical: { maxActionsPerDay: 30, cooldown: 10, dailyLossLimit: 10, stopLoss: 20 },
    };
    setConfig((prev) => ({
      ...prev,
      riskProfile: id,
      maxDrawdown: profile.maxDrawdown,
      maxPosition: profile.maxPosition,
      confidenceThreshold: profile.confidence * 100,
      ...(presets[id] || {}),
    }));
  };

  // Pick a marketplace operator and apply their recommended policy as a starting point
  const pickMarketplaceOperator = (op) => {
    setSelectedMarketplaceOperator(op.wallet);
    if (
      op.recommendedMaxPositionBps ||
      op.recommendedConfidenceMinBps ||
      op.recommendedStopLossBps ||
      op.recommendedCooldownSeconds ||
      op.recommendedMaxActionsPerDay
    ) {
      setConfig((prev) => ({
        ...prev,
        maxPosition: Math.round((op.recommendedMaxPositionBps || prev.maxPosition * 100) / 100),
        confidenceThreshold: Math.round((op.recommendedConfidenceMinBps || prev.confidenceThreshold * 100) / 100),
        stopLoss: Math.round((op.recommendedStopLossBps || prev.stopLoss * 100) / 100),
        cooldown: Math.round((op.recommendedCooldownSeconds || prev.cooldown * 60) / 60),
        maxActionsPerDay: op.recommendedMaxActionsPerDay || prev.maxActionsPerDay,
      }));
    }
  };

  return (
    <div className="min-h-screen bg-obsidian flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-obsidian/95 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="max-w-3xl mx-auto px-4 lg:px-6 h-14 flex items-center justify-between">
          <Link to="/app" className="flex items-center gap-2 text-steel/60 hover:text-white transition-colors text-xs">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <Logo size={20} />
            <span className="text-xs font-medium tracking-[0.1em] uppercase text-white/60">Create Vault</span>
          </div>
          <div className="w-20" /> {/* Spacer */}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 lg:px-6 py-8 lg:py-12 flex-1">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-1 mb-10">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <button
                onClick={() => i <= step && setStep(i)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono tracking-wider transition-all
                  ${i === step
                    ? 'bg-gold/10 text-gold border border-gold/20'
                    : i < step
                      ? 'text-emerald-soft/70 cursor-pointer hover:text-emerald-soft'
                      : 'text-steel/30'
                  }`}
              >
                {i < step ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <span>{s.number}</span>
                )}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < steps.length - 1 && (
                <div className={`w-4 lg:w-8 h-px mx-1 ${i < step ? 'bg-emerald-soft/30' : 'bg-white/[0.06]'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[400px]">
          {/* Step 1: Deposit */}
          {currentStep.key === 'deposit' && (
            <div className="text-center">
              <h2 className="text-2xl lg:text-3xl font-display font-semibold text-white mb-3 tracking-tight">
                Fund your vault
              </h2>
              <p className="text-sm text-steel/60 mb-8 max-w-md mx-auto">
                Specify the initial deposit amount. Your capital remains under smart contract custody.
              </p>
              <GlassPanel gold className="p-8 max-w-sm mx-auto">
                <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-steel/40 block mb-3">
                  Deposit Amount (USDC)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-display text-steel/30">$</span>
                  <input
                    type="number"
                    value={config.depositAmount}
                    onChange={(e) => updateConfig('depositAmount', Number(e.target.value))}
                    className="w-full bg-obsidian/60 border border-white/[0.08] rounded-lg px-4 pl-10 py-4
                      text-2xl font-display font-semibold text-white text-center
                      focus:outline-none focus:border-gold/30 transition-colors"
                  />
                </div>
                <div className="flex justify-center gap-2 mt-4">
                  {[10000, 25000, 50000, 100000].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => updateConfig('depositAmount', amt)}
                      className={`px-3 py-1 rounded text-[10px] font-mono transition-all
                        ${config.depositAmount === amt
                          ? 'bg-gold/15 text-gold border border-gold/20'
                          : 'text-steel/50 border border-white/[0.06] hover:border-white/[0.1]'
                        }`}
                    >
                      ${(amt / 1000).toFixed(0)}k
                    </button>
                  ))}
                </div>
              </GlassPanel>
            </div>
          )}

          {/* Step 2: Risk Profile */}
          {currentStep.key === 'risk' && (
            <div className="text-center">
              <h2 className="text-2xl lg:text-3xl font-display font-semibold text-white mb-3 tracking-tight">
                Choose your risk mandate
              </h2>
              <p className="text-sm text-steel/60 mb-8 max-w-md mx-auto">
                This sets the baseline risk posture for your vault. You can fine-tune parameters in the next step.
              </p>
              <div className="grid sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                {riskProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    onClick={() => selectProfile(profile.id)}
                    className={`text-left p-5 rounded-lg border transition-all duration-300
                      ${config.riskProfile === profile.id
                        ? `glass-panel-gold ${profile.border} shadow-lg`
                        : 'glass-panel hover:border-white/[0.1]'
                      }`}
                  >
                    <span className={`text-sm font-display font-semibold ${profile.color} block mb-2`}>
                      {profile.label}
                    </span>
                    <p className="text-[11px] text-steel/50 leading-relaxed mb-3">
                      {profile.description}
                    </p>
                    <div className="space-y-1 text-[10px] font-mono text-steel/40">
                      <div>Max DD: {profile.maxDrawdown}%</div>
                      <div>Max Pos: {profile.maxPosition}%</div>
                      <div>Conf: {(profile.confidence * 100).toFixed(0)}%</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Policy Fine-tune */}
          {currentStep.key === 'policy' && (
            <div>
              <div className="text-center mb-8">
                <h2 className="text-2xl lg:text-3xl font-display font-semibold text-white mb-3 tracking-tight">
                  Fine-tune guardrails
                </h2>
                <p className="text-sm text-steel/60 max-w-md mx-auto">
                  Adjust the on-chain policy parameters. These constraints are enforced at the contract level.
                </p>
              </div>
              <GlassPanel className="p-6 max-w-lg mx-auto">
                <div className="space-y-5">
                  {[
                    { label: 'Max Drawdown', key: 'maxDrawdown', min: 1, max: 30, suffix: '%', icon: <TrendingDown className="w-3.5 h-3.5" />, desc: 'Maximum allowed daily loss' },
                    { label: 'Max Position Size', key: 'maxPosition', min: 10, max: 80, suffix: '%', icon: <Target className="w-3.5 h-3.5" />, desc: 'Maximum single trade size' },
                    { label: 'Daily Loss Limit', key: 'dailyLossLimit', min: 1, max: 15, suffix: '%', icon: <AlertTriangle className="w-3.5 h-3.5" />, desc: 'Stop trading if daily loss exceeds this' },
                    { label: 'Cooldown Period', key: 'cooldown', min: 1, max: 60, suffix: 'min', icon: <Clock className="w-3.5 h-3.5" />, desc: 'Minimum wait between trades' },
                    { label: 'Confidence Threshold', key: 'confidenceThreshold', min: 30, max: 95, suffix: '%', icon: <Zap className="w-3.5 h-3.5" />, desc: 'AI must be at least this confident to trade' },
                    { label: 'Global Stop-Loss', key: 'stopLoss', min: 5, max: 30, suffix: '%', icon: <Shield className="w-3.5 h-3.5" />, desc: 'Halt all trading if total loss exceeds this' },
                    { label: 'Max Trades Per Day', key: 'maxActionsPerDay', min: 1, max: 50, suffix: '', icon: <Layers className="w-3.5 h-3.5" />, desc: 'Maximum number of trades per day' },
                  ].map((param) => (
                    <div key={param.key}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 text-xs text-steel/70">
                          <span className="text-steel/40">{param.icon}</span>
                          {param.label}
                        </div>
                        <span className="text-sm font-mono font-medium text-white">
                          {config[param.key]}{param.suffix}
                        </span>
                      </div>
                      {param.desc && (
                        <p className="text-[9px] text-steel/35 mb-2">{param.desc}</p>
                      )}
                      <input
                        type="range"
                        min={param.min}
                        max={param.max}
                        value={config[param.key]}
                        onChange={(e) => updateConfig(param.key, Number(e.target.value))}
                        className="w-full h-1 rounded-full appearance-none cursor-pointer
                          bg-white/[0.06] accent-gold [&::-webkit-slider-thumb]:appearance-none
                          [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gold
                          [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(201,168,76,0.3)]"
                      />
                    </div>
                  ))}
                </div>
              </GlassPanel>
            </div>
          )}

          {/* Step 4: Assets */}
          {currentStep.key === 'assets' && (
            <div className="text-center">
              <h2 className="text-2xl lg:text-3xl font-display font-semibold text-white mb-3 tracking-tight">
                Select allowed assets
              </h2>
              <p className="text-sm text-steel/60 mb-8 max-w-md mx-auto">
                The AI can only trade assets you explicitly authorize. This is enforced on-chain.
              </p>
              <div className="grid sm:grid-cols-2 gap-3 max-w-lg mx-auto">
                {availableAssets.map((asset) => {
                  const selected = config.allowedAssets.includes(asset.symbol);
                  return (
                    <button
                      key={asset.symbol}
                      onClick={() => toggleAsset(asset.symbol)}
                      className={`flex items-center gap-3 p-4 rounded-lg border transition-all duration-300 text-left
                        ${selected
                          ? 'glass-panel-gold border-gold/30'
                          : 'glass-panel hover:border-white/[0.1]'
                        }`}
                    >
                      <TokenIcon symbol={asset.symbol} size={32} />
                      <div>
                        <span className="text-sm font-display font-medium text-white block">{asset.symbol}</span>
                        <span className="text-[10px] text-steel/40">{asset.name}</span>
                      </div>
                      <div className="ml-auto">
                        {selected ? (
                          <Check className="w-4 h-4 text-gold" />
                        ) : (
                          <div className="w-4 h-4 rounded border border-white/10" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 5: Sealed Mode */}
          {currentStep.key === 'sealed' && (
            <div className="text-center">
              <h2 className="text-2xl lg:text-3xl font-display font-semibold text-white mb-3 tracking-tight">
                Privacy & execution mode
              </h2>
              <p className="text-sm text-steel/60 mb-8 max-w-md mx-auto">
                Choose whether to run in sealed strategy mode and enable autonomous execution.
              </p>
              <div className="space-y-4 max-w-md mx-auto">
                <button
                  onClick={() => updateConfig('sealedMode', !config.sealedMode)}
                  className={`w-full flex items-center gap-4 p-5 rounded-lg border text-left transition-all duration-300
                    ${config.sealedMode ? 'glass-panel-gold border-gold/30' : 'glass-panel hover:border-white/[0.1]'}`}
                >
                  <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
                    <Lock className={`w-5 h-5 ${config.sealedMode ? 'text-gold' : 'text-steel/40'}`} />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-display font-medium text-white block mb-0.5">Sealed Strategy Mode</span>
                    <span className="text-[11px] text-steel/50">Strategy parameters and inference inputs remain confidential</span>
                  </div>
                  <StatusPill label={config.sealedMode ? 'Enabled' : 'Off'} variant={config.sealedMode ? 'sealed' : 'paused'} />
                </button>

                <button
                  onClick={() => updateConfig('autoExecution', !config.autoExecution)}
                  className={`w-full flex items-center gap-4 p-5 rounded-lg border text-left transition-all duration-300
                    ${config.autoExecution ? 'glass-panel-gold border-gold/30' : 'glass-panel hover:border-white/[0.1]'}`}
                >
                  <div className="w-10 h-10 rounded-lg bg-cyan/10 flex items-center justify-center">
                    <Zap className={`w-5 h-5 ${config.autoExecution ? 'text-cyan' : 'text-steel/40'}`} />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-display font-medium text-white block mb-0.5">Auto-Execution</span>
                    <span className="text-[11px] text-steel/50">AI executes approved trades automatically within guardrails</span>
                  </div>
                  <StatusPill label={config.autoExecution ? 'Active' : 'Off'} variant={config.autoExecution ? 'active' : 'paused'} />
                </button>
              </div>
            </div>
          )}

          {/* Step 6: Review */}
          {currentStep.key === 'review' && (
            <div>
              <div className="text-center mb-8">
                <h2 className="text-2xl lg:text-3xl font-display font-semibold text-white mb-3 tracking-tight">
                  Review vault configuration
                </h2>
                <p className="text-sm text-steel/60 max-w-md mx-auto">
                  Confirm your vault parameters before deployment. All policies will be enforced on-chain.
                </p>
              </div>
              <GlassPanel gold className="p-6 max-w-lg mx-auto">
                <div className="space-y-4">
                  <div className="flex justify-between py-2 border-b border-white/[0.04]">
                    <span className="text-xs text-steel/60">Deposit</span>
                    <span className="text-sm font-mono font-semibold text-white">${config.depositAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/[0.04]">
                    <span className="text-xs text-steel/60">Risk Profile</span>
                    <span className={`text-sm font-display font-semibold ${selectedProfile?.color}`}>{selectedProfile?.label}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/[0.04]">
                    <span className="text-xs text-steel/60">Max Drawdown</span>
                    <span className="text-sm font-mono text-white">{config.maxDrawdown}%</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/[0.04]">
                    <span className="text-xs text-steel/60">Max Position</span>
                    <span className="text-sm font-mono text-white">{config.maxPosition}%</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/[0.04]">
                    <span className="text-xs text-steel/60">Daily Loss Limit</span>
                    <span className="text-sm font-mono text-white">{config.dailyLossLimit}%</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/[0.04]">
                    <span className="text-xs text-steel/60">Cooldown</span>
                    <span className="text-sm font-mono text-white">{config.cooldown} min</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/[0.04]">
                    <span className="text-xs text-steel/60">Confidence Threshold</span>
                    <span className="text-sm font-mono text-white">{config.confidenceThreshold}%</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/[0.04]">
                    <span className="text-xs text-steel/60">Max Trades Per Day</span>
                    <span className="text-sm font-mono text-white">{config.maxActionsPerDay}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/[0.04]">
                    <span className="text-xs text-steel/60">Allowed Assets</span>
                    <span className="text-sm font-mono text-white">{config.allowedAssets.join(', ')}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-white/[0.04]">
                    <span className="text-xs text-steel/60">Sealed Mode</span>
                    <StatusPill label={config.sealedMode ? 'Enabled' : 'Disabled'} variant={config.sealedMode ? 'sealed' : 'paused'} />
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-xs text-steel/60">Auto-Execution</span>
                    <StatusPill label={config.autoExecution ? 'Active' : 'Off'} variant={config.autoExecution ? 'active' : 'paused'} />
                  </div>

                  {/* Fee Preview from selected operator */}
                  {selectedOperatorData && (
                    <div className="pt-4 border-t border-white/[0.04]">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-gold/70">
                          Operator Fees · {selectedOperatorData.name}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 mb-3">
                        <div className="rounded-md bg-gold/[0.04] border border-gold/15 px-2 py-1.5">
                          <div className="flex items-center gap-1 mb-0.5">
                            <TrendingUp className="w-2.5 h-2.5 text-gold/60" />
                            <span className="text-[8px] font-mono uppercase text-steel/45">Perf</span>
                          </div>
                          <div className="text-[11px] font-mono text-gold tabular-nums">
                            {formatBps(selectedOperatorData.performanceFeeBps)}
                          </div>
                        </div>
                        <div className="rounded-md bg-cyan/[0.04] border border-cyan/15 px-2 py-1.5">
                          <div className="flex items-center gap-1 mb-0.5">
                            <Percent className="w-2.5 h-2.5 text-cyan/60" />
                            <span className="text-[8px] font-mono uppercase text-steel/45">Mgmt</span>
                          </div>
                          <div className="text-[11px] font-mono text-cyan tabular-nums">
                            {formatBps(selectedOperatorData.managementFeeBps)}
                          </div>
                        </div>
                        <div className="rounded-md bg-white/[0.02] border border-white/[0.06] px-2 py-1.5">
                          <div className="flex items-center gap-1 mb-0.5">
                            <DollarSign className="w-2.5 h-2.5 text-steel/45" />
                            <span className="text-[8px] font-mono uppercase text-steel/45">Entry</span>
                          </div>
                          <div className="text-[11px] font-mono text-white/80 tabular-nums">
                            {formatBps(selectedOperatorData.entryFeeBps)}
                          </div>
                        </div>
                        <div className="rounded-md bg-white/[0.02] border border-white/[0.06] px-2 py-1.5">
                          <div className="flex items-center gap-1 mb-0.5">
                            <DollarSign className="w-2.5 h-2.5 text-steel/45" />
                            <span className="text-[8px] font-mono uppercase text-steel/45">Exit</span>
                          </div>
                          <div className="text-[11px] font-mono text-white/80 tabular-nums">
                            {formatBps(selectedOperatorData.exitFeeBps)}
                          </div>
                        </div>
                      </div>
                      {(() => {
                        const est = estimateAnnualFees(
                          config.depositAmount,
                          selectedOperatorData.performanceFeeBps,
                          selectedOperatorData.managementFeeBps,
                          10
                        );
                        const entryCost = (config.depositAmount * (selectedOperatorData.entryFeeBps || 0)) / 10000;
                        return (
                          <div className="rounded-md bg-white/[0.02] border border-white/[0.05] p-3 text-[11px]">
                            <div className="flex items-center gap-1.5 mb-2 text-steel/55">
                              <Info className="w-3 h-3" />
                              <span>
                                Estimated cost on ${config.depositAmount.toLocaleString()} @ 10% expected return
                              </span>
                            </div>
                            <div className="grid grid-cols-4 gap-2 font-mono">
                              <div>
                                <div className="text-[9px] uppercase text-steel/40">Entry</div>
                                <div className="text-white/70 tabular-nums">${entryCost.toFixed(0)}</div>
                              </div>
                              <div>
                                <div className="text-[9px] uppercase text-steel/40">Mgmt/yr</div>
                                <div className="text-cyan/70 tabular-nums">${est.managementCost.toFixed(0)}</div>
                              </div>
                              <div>
                                <div className="text-[9px] uppercase text-steel/40">Perf/yr</div>
                                <div className="text-gold/70 tabular-nums">${est.performanceCost.toFixed(0)}</div>
                              </div>
                              <div>
                                <div className="text-[9px] uppercase text-steel/40">Total/yr</div>
                                <div className="text-white/85 tabular-nums">
                                  ${(entryCost + est.totalEstimated).toFixed(0)}
                                </div>
                              </div>
                            </div>
                            <p className="text-[9px] text-steel/40 mt-2">
                              80/20 split between operator and protocol treasury · HWM-protected performance fee
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <div className="pt-4 border-t border-white/[0.04] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-steel/60">Executor</span>
                      <span className="text-sm font-mono text-white">{shortExecutor}</span>
                    </div>

                    <div className="grid gap-2">
                      {/* Marketplace option (recommended) */}
                      <button
                        type="button"
                        onClick={() => setExecutorMode('marketplace')}
                        className={`text-left rounded-lg border px-3 py-3 transition-all ${
                          activeExecutorMode === 'marketplace'
                            ? 'border-gold/30 bg-gold/10'
                            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex gap-3">
                            <div className="w-9 h-9 rounded-lg bg-gold/10 flex items-center justify-center">
                              <Cpu className="w-4 h-4 text-gold" />
                            </div>
                            <div>
                              <div className="text-sm font-display font-medium text-white flex items-center gap-2">
                                Pick from Marketplace
                                <span className="text-[8px] font-mono text-gold/70 bg-gold/10 border border-gold/20 px-1 py-0.5 rounded">RECOMMENDED</span>
                              </div>
                              <div className="text-[11px] text-steel/45">
                                {activeMarketplaceOperators.length > 0
                                  ? `${activeMarketplaceOperators.length} registered operator${activeMarketplaceOperators.length === 1 ? '' : 's'} available`
                                  : 'No operators registered yet — others can register from /operator/register'}
                              </div>
                            </div>
                          </div>
                          <StatusPill
                            label={activeMarketplaceOperators.length > 0 ? 'Available' : 'Empty'}
                            variant={activeMarketplaceOperators.length > 0 ? 'active' : 'paused'}
                          />
                        </div>
                      </button>

                      <button
                        type="button"
                        disabled={!canUseDetectedExecutor}
                        onClick={() => setExecutorMode('orchestrator')}
                        className={`text-left rounded-lg border px-3 py-3 transition-all ${
                          activeExecutorMode === 'orchestrator'
                            ? 'border-cyan/30 bg-cyan/10'
                            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
                        } ${!canUseDetectedExecutor ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex gap-3">
                            <div className="w-9 h-9 rounded-lg bg-cyan/10 flex items-center justify-center">
                              <Cpu className="w-4 h-4 text-cyan" />
                            </div>
                            <div>
                              <div className="text-sm font-display font-medium text-white">Use active orchestrator</div>
                              <div className="text-[11px] text-steel/45">
                                {canUseDetectedExecutor
                                  ? `${detectedExecutor} · ${orchStatus?.mutationAuthMode === 'api-key' ? 'API key secured' : 'Localhost-only mutations'}`
                                  : 'Start your orchestrator and expose its status API to auto-detect the executor wallet.'}
                              </div>
                            </div>
                          </div>
                          <StatusPill
                            label={canUseDetectedExecutor ? 'Detected' : 'Offline'}
                            variant={canUseDetectedExecutor ? 'active' : 'paused'}
                          />
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setExecutorMode('custom')}
                        className={`text-left rounded-lg border px-3 py-3 transition-all ${
                          activeExecutorMode === 'custom'
                            ? 'border-gold/30 bg-gold/10'
                            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex gap-3">
                            <div className="w-9 h-9 rounded-lg bg-gold/10 flex items-center justify-center">
                              <Wallet className="w-4 h-4 text-gold" />
                            </div>
                            <div>
                              <div className="text-sm font-display font-medium text-white">Bring your own executor</div>
                              <div className="text-[11px] text-steel/45">
                                Paste the wallet address used by your self-hosted orchestrator.
                              </div>
                            </div>
                          </div>
                          <StatusPill label="Custom" variant="gold" />
                        </div>
                      </button>
                    </div>

                    {activeExecutorMode === 'marketplace' && (
                      <div>
                        <label className="text-[10px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-2">
                          Choose an Operator
                        </label>
                        {activeMarketplaceOperators.length === 0 ? (
                          <div className="px-3 py-4 rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] text-center">
                            <p className="text-[11px] text-steel/45 mb-2">No active operators registered yet.</p>
                            <Link to="/operator/register" className="text-[11px] text-gold/60 hover:text-gold inline-flex items-center gap-1">
                              Register one →
                            </Link>
                          </div>
                        ) : (
                          <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                            {activeMarketplaceOperators.map((op) => {
                              const selected = selectedMarketplaceOperator.toLowerCase() === op.wallet.toLowerCase();
                              const tierData = tiersByAddress[op.wallet?.toLowerCase()];
                              const tier = tierData?.tier || 0;
                              const opExceedsCap = tierData && !tierData.isUnlimited && config.depositAmount > tierData.maxVaultSize;
                              return (
                                <button
                                  key={op.wallet}
                                  type="button"
                                  onClick={() => pickMarketplaceOperator(op)}
                                  className={`w-full text-left px-3 py-2.5 rounded-md border transition-all ${
                                    selected
                                      ? 'border-gold/30 bg-gold/5'
                                      : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 mb-0.5">
                                    <div className="flex items-center gap-2">
                                      <Cpu className="w-3.5 h-3.5 text-gold/60" />
                                      <span className="text-xs font-display font-medium text-white">{op.name}</span>
                                      {tier > 0 && (
                                        <span className={`text-[8px] font-mono px-1 py-0.5 rounded border bg-white/[0.03] border-white/[0.06] flex items-center gap-0.5 ${TIER_COLORS[tier]}`}>
                                          <Award className="w-2 h-2" />
                                          {TIER_LABELS[tier]}
                                        </span>
                                      )}
                                      {tierData?.frozen && (
                                        <span className="text-[8px] font-mono text-red-warn/80 px-1 py-0.5 rounded bg-red-warn/10 border border-red-warn/20">FROZEN</span>
                                      )}
                                    </div>
                                    <span className="text-[8px] font-mono text-steel/45 px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.06]">
                                      {op.mandateLabel}
                                    </span>
                                  </div>
                                  <div className="text-[10px] font-mono text-steel/35 truncate">
                                    {op.wallet}
                                  </div>
                                  {op.description && (
                                    <p className="text-[10px] text-steel/45 mt-1 line-clamp-2">{op.description}</p>
                                  )}
                                  {/* Fee preview row */}
                                  <div className="flex items-center gap-3 mt-2 text-[9px] font-mono">
                                    <span className="text-gold/70">Perf {formatBps(op.performanceFeeBps)}</span>
                                    <span className="text-cyan/70">Mgmt {formatBps(op.managementFeeBps)}</span>
                                    <span className="text-steel/45">Entry {formatBps(op.entryFeeBps)}</span>
                                    <span className="text-steel/45">Exit {formatBps(op.exitFeeBps)}</span>
                                    {tierData && (
                                      <span className={opExceedsCap ? 'text-red-warn ml-auto' : 'text-emerald-soft/60 ml-auto'}>
                                        Cap {formatVaultCap(tierData.maxVaultSize, tierData.isUnlimited)}
                                      </span>
                                    )}
                                  </div>
                                  {opExceedsCap && (
                                    <div className="mt-2 text-[9px] text-red-warn/70 flex items-center gap-1">
                                      <AlertTriangle className="w-2.5 h-2.5" />
                                      Deposit exceeds this operator's tier cap
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {activeExecutorMode === 'custom' && (
                      <div>
                        <label className="text-[10px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-2">
                          Executor Address
                        </label>
                        <input
                          type="text"
                          value={customExecutor}
                          onChange={(e) => setCustomExecutor(e.target.value.trim())}
                          placeholder="0x..."
                          spellCheck="false"
                          className="w-full bg-obsidian/60 border border-white/[0.08] rounded-lg px-3 py-2.5
                            text-sm font-mono text-white
                            focus:outline-none focus:border-gold/30 transition-colors"
                        />
                        <p className="mt-2 text-[11px] text-steel/45">
                          Owner keeps custody. The executor can only submit intents that still pass on-chain policy checks.
                        </p>
                      </div>
                    )}

                    {!executorReady && (
                      <p className="text-[11px] text-red-warn/70">
                        Set a valid executor address before deploying the vault.
                      </p>
                    )}

                    {exceedsTierCap && (
                      <div className="rounded-md bg-red-warn/5 border border-red-warn/20 px-3 py-2 flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-warn/70 flex-shrink-0 mt-0.5" />
                        <div className="text-[11px] text-red-warn/80">
                          <strong>Tier cap exceeded.</strong> {selectedOperatorData?.name} is{' '}
                          <span className={TIER_COLORS[selectedOperatorTier?.tier || 0]}>
                            {TIER_LABELS[selectedOperatorTier?.tier || 0]}
                          </span>{' '}
                          tier with a cap of {formatVaultCap(selectedOperatorTier?.maxVaultSize || 0, selectedOperatorTier?.isUnlimited)}.
                          Reduce your deposit, choose a higher-tier operator, or wait for them to stake more.
                        </div>
                      </div>
                    )}
                    {selectedOperatorTier?.frozen && (
                      <div className="rounded-md bg-red-warn/5 border border-red-warn/20 px-3 py-2 flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-warn/70 flex-shrink-0 mt-0.5" />
                        <div className="text-[11px] text-red-warn/80">
                          This operator is currently <strong>FROZEN</strong> pending arbitration. Pick a different operator.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </GlassPanel>
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-10 pt-6 border-t border-white/[0.04]">
          <div>
            {step > 0 && (
              <ControlButton variant="ghost" onClick={() => setStep(step - 1)}>
                <ArrowLeft className="w-4 h-4" /> Previous
              </ControlButton>
            )}
          </div>
          <div>
            {step < steps.length - 1 ? (
              <ControlButton variant="primary" onClick={() => setStep(step + 1)}>
                Continue <ArrowRight className="w-4 h-4" />
              </ControlButton>
            ) : isConnected ? (
              <ControlButton
                variant="primary"
                size="lg"
                disabled={createPending || !executorReady || exceedsTierCap || selectedOperatorTier?.frozen}
                onClick={() => {
                  const policyStruct = {
                    maxPositionBps: BigInt(config.maxPosition * 100),
                    maxDailyLossBps: BigInt(config.dailyLossLimit * 100),
                    stopLossBps: BigInt(config.stopLoss * 100),
                    cooldownSeconds: BigInt(config.cooldown * 60),
                    confidenceThresholdBps: BigInt(config.confidenceThreshold * 100),
                    maxActionsPerDay: BigInt(config.maxActionsPerDay),
                    autoExecution: config.autoExecution,
                    paused: false,
                    // Phase 1: Fees — pulled from selected operator (or zero if custom executor)
                    performanceFeeBps: BigInt(selectedOperatorData?.performanceFeeBps || 0),
                    managementFeeBps: BigInt(selectedOperatorData?.managementFeeBps || 0),
                    entryFeeBps: BigInt(selectedOperatorData?.entryFeeBps || 0),
                    exitFeeBps: BigInt(selectedOperatorData?.exitFeeBps || 0),
                    // Operator wallet receives the 80% share; treasury gets 20% on claim
                    feeRecipient: selectedOperatorData?.wallet || resolvedExecutor,
                  };
                  const assetAddrs = config.allowedAssets.map(s => {
                    if (s === 'BTC') return deployments.mockWBTC;
                    if (s === 'ETH') return deployments.mockWETH;
                    if (s === 'USDC') return deployments.mockUSDC;
                    return deployments.mockUSDC;
                  }).filter(Boolean);
                  createVault(
                    deployments.mockUSDC,
                    resolvedExecutor,
                    deployments.mockDEX,
                    policyStruct,
                    assetAddrs
                  );
                  setTimeout(() => navigate('/app'), 4000);
                }}
              >
                <Shield className="w-4 h-4" /> {createPending ? 'Deploying...' : 'Deploy Vault'}
              </ControlButton>
            ) : (
              <WalletButton />
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-6 mt-12">
        <div className="max-w-3xl mx-auto px-4 lg:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo size={18} />
            <span className="text-[10px] font-mono tracking-[0.12em] uppercase text-steel/40">Aegis Vault</span>
          </div>
          <div className="flex items-center gap-5">
            {['Documentation', 'GitHub', 'Architecture', 'Contact'].map((link) => (
              <a key={link} href="#" className="text-[10px] tracking-[0.08em] uppercase text-steel/30 hover:text-steel/60 transition-colors duration-300">{link}</a>
            ))}
          </div>
          <div className="text-[10px] font-mono tracking-wider text-steel/20">Built on 0G · 2025</div>
        </div>
      </footer>
    </div>
  );
}
