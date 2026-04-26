import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { isAddress } from 'viem';
import { toast } from 'sonner';
import GlassPanel from '../components/ui/GlassPanel';
import ControlButton from '../components/ui/ControlButton';
import StatusPill from '../components/ui/StatusPill';
import WalletButton from '../components/ui/WalletButton';
import NetworkWarning from '../components/ui/NetworkWarning';
import ConfirmModal from '../components/ui/ConfirmModal';
import { useCreateVault, useApprove, useDeposit, useTokenBalance } from '../hooks/useVault';
import { useOrchestratorStatus } from '../hooks/useOrchestrator';
import { useOperatorList, useIsRegistered, useOperator } from '../hooks/useOperatorRegistry';
import { formatBps, estimateAnnualFees } from '../hooks/useVaultFees';
import {
  useOperatorTiers, TIER_LABELS, TIER_COLORS, formatVaultCap,
} from '../hooks/useOperatorStaking';
import { demoOperatorTiers, demoOperators } from '../data/demoContent';
import { ENABLE_DEMO_FALLBACKS, getDeployments, findDeploymentChainId } from '../lib/contracts';
import { resolveVenueAddress, getChainProfile } from '../lib/chainConfig';
import { getPrimaryOrchestratorExecutor } from '../lib/orchestratorStatus';
import { parseTxError } from '../lib/txErrors';
import { useDraftState } from '../lib/useDraftState';
import TokenIcon from '../components/ui/TokenIcon';
import {
  ArrowLeft, ArrowRight, Check, Shield, Lock, Zap, Cpu,
  TrendingDown, Target, Clock, AlertTriangle, Layers, Wallet,
  TrendingUp, Percent, DollarSign, Info, Award, ChevronDown,
  RotateCcw, HelpCircle
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

const baseAssetOptions = [
  { symbol: 'USDC', name: 'USD Coin', depKey: 'mockUSDC', decimals: 6, color: 'text-cyan', border: 'border-cyan/30' },
  { symbol: 'WBTC', name: 'Wrapped BTC', depKey: 'mockWBTC', decimals: 8, color: 'text-gold', border: 'border-gold/30' },
  { symbol: 'WETH', name: 'Wrapped ETH', depKey: 'mockWETH', decimals: 18, color: 'text-emerald-soft', border: 'border-emerald-soft/30' },
  { symbol: '0G', name: 'Wrapped 0G', depKey: 'W0G', decimals: 18, color: 'text-cyan', border: 'border-cyan/30' },
];

const riskScoreByProfile = {
  defensive: 3,
  balanced: 5,
  tactical: 8,
};

export default function CreateVaultPage() {
  const navigate = useNavigate();
  const { isConnected, address: walletAddress } = useAccount();
  const chainId = useChainId();
  const deployments = getDeployments(chainId);
  const factoryChainId = findDeploymentChainId('aegisVaultFactoryV2')
    || findDeploymentChainId('aegisVaultFactory');
  const {
    createVault,
    isSuccess: createSuccess,
    deployedVaultAddress,
    error: createError,
  } = useCreateVault();
  const {
    approve,
    isSuccess: approveSuccess,
    error: approveError,
  } = useApprove();
  const {
    deposit,
    isSuccess: depositSuccess,
    error: depositError,
  } = useDeposit();
  const { data: orchStatus } = useOrchestratorStatus();
  const [step, setStep] = useState(0);
  const [deployPhase, setDeployPhase] = useState('idle'); // idle | creating | approving | depositing | done | error
  const [deployStartedAt, setDeployStartedAt] = useState(null);
  const [deployError, setDeployError] = useState(null); // { phase, message, isUserReject }
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Snapshot taken at executeDeploy() so subsequent phases (approve, deposit)
  // are immune to user edits during the multi-tx flow.
  const deploySnapshotRef = useRef(null);
  // One-shot guards — React 19 StrictMode + effect dep changes used to fire
  // the success toast + navigate twice (and sometimes loop). Refs gate each
  // side-effect to exactly one invocation per deploy.
  const doneHandledRef = useRef(false);
  const navigateQueuedRef = useRef(false);
  const draftKey = `draft:create-vault:v1:${walletAddress || 'anon'}`;
  const [config, setConfig, { clearDraft, hasDraft }] = useDraftState(draftKey, {
    depositAmount: 50000,
    baseAsset: 'USDC',
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
  const selectedBaseAsset = baseAssetOptions.find((a) => a.symbol === config.baseAsset) || baseAssetOptions[0];
  const { balance: walletBalance, isLoading: balanceLoading } = useTokenBalance(
    deployments[selectedBaseAsset.depKey],
    walletAddress,
    selectedBaseAsset.decimals,
  );
  const walletBalanceNum = parseFloat(walletBalance || '0');
  const exceedsBalance = isConnected && config.depositAmount > walletBalanceNum;
  const insufficientBalance = isConnected && walletBalanceNum <= 0;
  const [executorMode, setExecutorMode] = useState(ENABLE_DEMO_FALLBACKS ? 'marketplace' : '');
  const [customExecutor, setCustomExecutor] = useState('');
  // Tracks which policy fields were pre-filled from the selected operator's
  // recommendedXxx values. Used to render a "suggested by operator" badge on
  // each slider and auto-clear the badge when the user edits that field.
  const [operatorSuggestions, setOperatorSuggestions] = useState(null);
  // Optional manual attestation-signer override for sealed mode.
  // Operators who run their orchestrator with TEE_SIGNER_PRIVATE_KEY set to a
  // separate key can paste the corresponding address here; otherwise we default
  // to the operator's wallet (works when TEE signer == operator key).
  const [customAttestedSigner, setCustomAttestedSigner] = useState('');
  const [selectedMarketplaceOperator, setSelectedMarketplaceOperator] = useState(
    ENABLE_DEMO_FALLBACKS ? demoOperators[0]?.wallet || '' : ''
  );

  const { operators: marketplaceOperators, isLoading: operatorsLoading } = useOperatorList(deployments.operatorRegistryV2 || deployments.operatorRegistry);
  const liveMarketplaceOperators = marketplaceOperators.filter((op) => op.loaded && op.active);
  const useDemoMarketplace = ENABLE_DEMO_FALLBACKS && liveMarketplaceOperators.length === 0;
  const activeMarketplaceOperators = useDemoMarketplace ? demoOperators : liveMarketplaceOperators;

  // Query-param + auto-select effects live after pickMarketplaceOperator
  // declaration (below) to avoid a temporal-dead-zone crash when Vite's
  // production bundler evaluates dependency arrays eagerly.
  const [searchParams] = useSearchParams();
  const operatorFromQuery = searchParams.get('operator');
  const [prefillHandled, setPrefillHandled] = useState(false);

  // Phase 2: tier data for all marketplace operators
  const allOperatorAddrs = activeMarketplaceOperators.map((op) => op.wallet);
  const { tiersByAddress: liveTiersByAddress } = useOperatorTiers(deployments.operatorStaking, allOperatorAddrs);
  const tiersByAddress = useDemoMarketplace ? demoOperatorTiers : liveTiersByAddress;

  const currentStep = steps[step];
  const selectedProfile = riskProfiles.find((p) => p.id === config.riskProfile);
  const detectedExecutor = getPrimaryOrchestratorExecutor(orchStatus);
  const canUseDetectedExecutor = Boolean(detectedExecutor);
  const isExecutorAutoResolved = !executorMode;
  const activeExecutorMode =
    executorMode || (canUseDetectedExecutor ? 'orchestrator' : useDemoMarketplace ? 'marketplace' : customExecutor ? 'custom' : 'marketplace');

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

  // Min one allowed asset; user can't deploy with empty list
  const noAssetsSelected = config.allowedAssets.length === 0;

  let resolvedExecutor = '';
  if (activeExecutorMode === 'orchestrator') resolvedExecutor = detectedExecutor.trim();
  else if (activeExecutorMode === 'marketplace') resolvedExecutor = selectedMarketplaceOperator.trim();
  else resolvedExecutor = customExecutor.trim();

  const executorReady = Boolean(resolvedExecutor) && isAddress(resolvedExecutor);
  const shortExecutor = executorReady
    ? `${resolvedExecutor.slice(0, 8)}...${resolvedExecutor.slice(-6)}`
    : 'Not configured';

  // Defense-in-depth: when the user pastes a custom executor address, verify
  // it's actually registered (and active) in OperatorRegistry. If it isn't,
  // the orchestrator network won't pick up the vault and funds get stranded.
  const customExecutorIsAddr = customExecutor.length === 0 || isAddress(customExecutor);
  const { data: customExecRegistered } = useIsRegistered(
    (deployments.operatorRegistryV2 || deployments.operatorRegistry),
    activeExecutorMode === 'custom' && customExecutor && isAddress(customExecutor) ? customExecutor : undefined,
  );
  const { data: customExecData } = useOperator(
    (deployments.operatorRegistryV2 || deployments.operatorRegistry),
    activeExecutorMode === 'custom' && customExecRegistered ? customExecutor : undefined,
  );
  const customExecutorWarning =
    activeExecutorMode === 'custom' && customExecutor && isAddress(customExecutor)
      ? customExecRegistered === false
        ? { level: 'warn', message: 'This address is not a registered operator. The vault will deploy, but no orchestrator in the public network will trade for it.' }
        : customExecData && customExecData.active === false
          ? { level: 'warn', message: 'This operator is registered but currently INACTIVE. Trades will not execute until the operator reactivates.' }
          : null
      : null;
  const annualFeeEstimate = selectedOperatorData
    ? estimateAnnualFees(
        config.depositAmount,
        selectedOperatorData.performanceFeeBps,
        selectedOperatorData.managementFeeBps,
        10
      )
    : null;
  const entryCost = selectedOperatorData
    ? (config.depositAmount * (selectedOperatorData.entryFeeBps || 0)) / 10000
    : 0;
  const previewChecklist = [
    { label: 'Capital committed', value: `$${config.depositAmount.toLocaleString()}`, ready: config.depositAmount > 0 },
    { label: 'Policy selected', value: `${selectedProfile.label} mandate`, ready: Boolean(selectedProfile) },
    { label: 'Execution path', value: config.sealedMode ? 'TEE-sealed + commit reveal' : 'Open strategy mode', ready: true },
    { label: 'Executor assigned', value: selectedOperatorData?.name || shortExecutor, ready: executorReady },
  ];

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

  // Pick a marketplace operator and apply their recommended policy as a
  // starting point. Registry stores percentages as bps (5000 = 50%) and time
  // as seconds; the form holds them as percent and minutes.
  // Stable identity so the auto-select effects below can list it as a dep
  // without retriggering every render. Only reads prop `op` + state setters.
  const pickMarketplaceOperator = useCallback((op) => {
    setSelectedMarketplaceOperator(op.wallet);
    const hasRecommendation =
      op.recommendedMaxPositionBps ||
      op.recommendedConfidenceMinBps ||
      op.recommendedStopLossBps ||
      op.recommendedCooldownSeconds ||
      op.recommendedMaxActionsPerDay;
    if (!hasRecommendation) {
      setOperatorSuggestions(null);
      return;
    }
    const suggestions = {
      operatorName: op.name || 'operator',
      maxPosition: op.recommendedMaxPositionBps
        ? Math.round(op.recommendedMaxPositionBps / 100)
        : null,
      confidenceThreshold: op.recommendedConfidenceMinBps
        ? Math.round(op.recommendedConfidenceMinBps / 100)
        : null,
      stopLoss: op.recommendedStopLossBps
        ? Math.round(op.recommendedStopLossBps / 100)
        : null,
      cooldown: op.recommendedCooldownSeconds
        ? Math.round(op.recommendedCooldownSeconds / 60)
        : null,
      maxActionsPerDay: op.recommendedMaxActionsPerDay || null,
    };
    setOperatorSuggestions(suggestions);
    setConfig((prev) => ({
      ...prev,
      maxPosition: suggestions.maxPosition ?? prev.maxPosition,
      confidenceThreshold: suggestions.confidenceThreshold ?? prev.confidenceThreshold,
      stopLoss: suggestions.stopLoss ?? prev.stopLoss,
      cooldown: suggestions.cooldown ?? prev.cooldown,
      maxActionsPerDay: suggestions.maxActionsPerDay ?? prev.maxActionsPerDay,
    }));
    // setConfig / setSelectedMarketplaceOperator / setOperatorSuggestions are
    // stable useState setters, so no deps are actually needed. Listing setConfig
    // explicitly just silences react-hooks/exhaustive-deps without affecting
    // identity stability.
  }, [setConfig]);

  // Pre-select an operator when landing here from "Assign to vault" button.
  // Reads ?operator=0x... from URL, auto-selects the matching operator and
  // forces executor mode to 'marketplace' so user skips Step-Executor manually.
  // Runs once when operators list loads — subsequent user clicks override.
  useEffect(() => {
    if (prefillHandled) return;
    if (!operatorFromQuery || !isAddress(operatorFromQuery)) return;
    if (activeMarketplaceOperators.length === 0) return;
    const match = activeMarketplaceOperators.find(
      (op) => op.wallet?.toLowerCase() === operatorFromQuery.toLowerCase()
    );
    if (match) {
      pickMarketplaceOperator(match);
      setExecutorMode('marketplace');
    }
    setPrefillHandled(true);
  }, [operatorFromQuery, activeMarketplaceOperators, prefillHandled, pickMarketplaceOperator]);

  // Auto-select first operator when user switches to marketplace mode and
  // there's no selection yet. Saves a click when the list is small. User
  // can still click any other operator to override.
  useEffect(() => {
    if (activeExecutorMode !== 'marketplace') return;
    if (selectedMarketplaceOperator) return;
    if (activeMarketplaceOperators.length === 0) return;
    pickMarketplaceOperator(activeMarketplaceOperators[0]);
  }, [activeExecutorMode, selectedMarketplaceOperator, activeMarketplaceOperators, pickMarketplaceOperator]);

  // Auto-deposit flow: createVault → approve → deposit → navigate
  // Each phase reads from deploySnapshotRef (frozen at executeDeploy) so user
  // edits to deposit amount or base asset mid-flow can't desync approve/deposit.
  useEffect(() => {
    if (deployPhase === 'creating' && createSuccess && deployedVaultAddress) {
      const snap = deploySnapshotRef.current;
      if (!snap) return;
      setDeployPhase('approving');
      approve(snap.tokenAddr, deployedVaultAddress, snap.depositAmount, snap.decimals);
    }
  }, [deployPhase, createSuccess, deployedVaultAddress, approve]);

  // Trigger deposit once approve is confirmed
  useEffect(() => {
    if (deployPhase === 'approving' && approveSuccess && deployedVaultAddress) {
      const snap = deploySnapshotRef.current;
      if (!snap) return;
      setDeployPhase('depositing');
      deposit(deployedVaultAddress, snap.depositAmount, snap.decimals);
    }
  }, [deployPhase, approveSuccess, deployedVaultAddress, deposit]);

  // Navigate once deposit is confirmed. Guarded so StrictMode's dev-only
  // double-invocation doesn't queue two `setTimeout(navigate)` calls.
  useEffect(() => {
    if (deployPhase === 'depositing' && depositSuccess && !navigateQueuedRef.current) {
      navigateQueuedRef.current = true;
      setDeployPhase('done');
      setTimeout(() => navigate('/app'), 1500);
    }
  }, [deployPhase, depositSuccess, navigate]);

  // Error capture: any failure in the 3-phase flow parks us in 'error' state with context
  useEffect(() => {
    const activeError =
      (deployPhase === 'creating' && createError) ||
      (deployPhase === 'approving' && approveError) ||
      (deployPhase === 'depositing' && depositError);
    if (activeError) {
      const parsed = parseTxError(activeError) || { title: 'Transaction failed', message: 'Unknown error', isUserReject: false };
      setDeployError({
        phase: deployPhase,
        title: parsed.title,
        message: parsed.message,
        isUserReject: parsed.isUserReject,
      });
      setDeployPhase('error');
      if (parsed.isUserReject) {
        toast.info(parsed.title, { description: parsed.message });
      } else {
        toast.error(parsed.title, { description: parsed.message, duration: 8000 });
      }
    }
  }, [deployPhase, createError, approveError, depositError]);

  // Success toast + draft cleanup when full flow completes.
  // Guarded by doneHandledRef: `clearDraft` re-creates state which can
  // otherwise feed back into the effect and spam toasts.
  useEffect(() => {
    if (deployPhase === 'done' && !doneHandledRef.current) {
      doneHandledRef.current = true;
      toast.success('Vault deployed and funded', {
        description: 'Redirecting you to the dashboard…',
      });
      clearDraft();
    }
  }, [deployPhase, clearDraft]);

  // Tick state so the elapsed counter on the deploy banner updates every second.
  // We store the current ms (not a counter) so render code can read it without
  // calling Date.now() inline, which react-hooks/purity flags as impure.
  const [nowMs, setNowMs] = useState(null);
  const _isDeployingForTick = deployPhase !== 'idle' && deployPhase !== 'done' && deployPhase !== 'error';
  useEffect(() => {
    if (!_isDeployingForTick) return undefined;
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [_isDeployingForTick]);

  const isDeploying = deployPhase !== 'idle' && deployPhase !== 'done' && deployPhase !== 'error';
  // Once a deploy is in flight, show the symbol that was actually committed to
  // (from the snapshot), not the live form value the user might have changed.
  const deploySymbol = deploySnapshotRef.current?.symbol || selectedBaseAsset.symbol;
  const deployPhaseLabel = {
    idle: 'Deploy Vault',
    creating: 'Deploying Vault…',
    approving: `Approving ${deploySymbol}…`,
    depositing: `Depositing ${deploySymbol}…`,
    done: 'Success — redirecting…',
    error: 'Retry deployment',
  }[deployPhase];

  // Retry from the failed phase without restarting the whole flow.
  // Always uses the original deploy snapshot so retry can't accidentally use
  // values the user changed after the failure.
  const retryDeployment = () => {
    if (!deployError) return;
    const failedPhase = deployError.phase;
    const snap = deploySnapshotRef.current;
    setDeployError(null);
    if (failedPhase === 'approving' && deployedVaultAddress && snap) {
      setDeployPhase('approving');
      approve(snap.tokenAddr, deployedVaultAddress, snap.depositAmount, snap.decimals);
    } else if (failedPhase === 'depositing' && deployedVaultAddress && snap) {
      setDeployPhase('depositing');
      deposit(deployedVaultAddress, snap.depositAmount, snap.decimals);
    } else {
      // creating failed — reset to idle so user re-clicks Deploy
      deploySnapshotRef.current = null;
      setDeployPhase('idle');
    }
  };

  const dismissDeployError = () => {
    setDeployError(null);
    setDeployPhase('idle');
  };

  // Kick off the 3-phase deploy. Called from the confirmation modal so users
  // always get a final review before any wallet popup. Captures a snapshot of
  // every value the multi-phase flow needs so later edits to the form can't
  // desync approve/deposit from the actual on-chain create.
  const executeDeploy = () => {
    setConfirmOpen(false);
    const attestSignerOverride = customAttestedSigner.trim();
    const teeAttestedSigner = config.sealedMode
      ? (attestSignerOverride && isAddress(attestSignerOverride)
          ? attestSignerOverride
          : (selectedOperatorData?.wallet || resolvedExecutor))
      : '0x0000000000000000000000000000000000000000';
    const policyStruct = {
      maxPositionBps: BigInt(config.maxPosition * 100),
      maxDailyLossBps: BigInt(config.dailyLossLimit * 100),
      stopLossBps: BigInt(config.stopLoss * 100),
      cooldownSeconds: BigInt(config.cooldown * 60),
      confidenceThresholdBps: BigInt(config.confidenceThreshold * 100),
      maxActionsPerDay: BigInt(config.maxActionsPerDay),
      autoExecution: config.autoExecution,
      paused: false,
      performanceFeeBps: BigInt(selectedOperatorData?.performanceFeeBps || 0),
      managementFeeBps: BigInt(selectedOperatorData?.managementFeeBps || 0),
      entryFeeBps: BigInt(selectedOperatorData?.entryFeeBps || 0),
      exitFeeBps: BigInt(selectedOperatorData?.exitFeeBps || 0),
      feeRecipient: selectedOperatorData?.wallet || resolvedExecutor,
      sealedMode: !!config.sealedMode,
      attestedSigner: teeAttestedSigner,
    };
    const assetAddrs = config.allowedAssets.map((s) => {
      if (s === 'BTC') return deployments.mockWBTC;
      if (s === 'ETH') return deployments.mockWETH;
      if (s === 'USDC') return deployments.mockUSDC;
      if (s === '0G') return deployments.W0G;
      return deployments.mockUSDC;
    }).filter(Boolean);
    const baseAssetAddr = deployments[selectedBaseAsset.depKey];

    // Chain-aware venue resolution. On 0G mainnet this prefers the V2
    // multi-hop adapter (`jaineVenueAdapterV2`) when present and falls
    // back to the legacy V1 single-hop. On Arbitrum it resolves to the
    // deployed UniswapV3VenueAdapter. We refuse to deploy if the venue
    // is not configured, rather than silently creating a vault bound to
    // address(0) that can never execute a swap.
    const venueAddr = resolveVenueAddress(chainId);
    if (!venueAddr) {
      const profile = getChainProfile(chainId);
      toast.error('Venue not configured for this chain', {
        description: profile
          ? `${profile.label} has no ${profile.venueName} address in the deployments map. Run sync-frontend after deploy.`
          : `Chain ${chainId} is not supported by Aegis.`,
      });
      return;
    }

    // Freeze every value subsequent phases need.
    deploySnapshotRef.current = {
      tokenAddr: baseAssetAddr,
      depositAmount: config.depositAmount,
      decimals: selectedBaseAsset.decimals,
      symbol: selectedBaseAsset.symbol,
    };
    // eslint-disable-next-line react-hooks/purity -- event handler, not render
    const startedAt = Date.now();
    setDeployStartedAt(startedAt);
    setDeployPhase('creating');
    createVault(
      baseAssetAddr,
      resolvedExecutor,
      venueAddr,
      policyStruct,
      assetAddrs,
    );
  };

  return (
    <div className="max-w-[1540px] mx-auto px-4 lg:px-6 py-8 lg:py-12">
        {/* Mobile sticky progress bar — keeps step context visible while scrolling */}
        <div className="sm:hidden sticky top-0 z-20 -mx-4 px-4 py-2 mb-4 bg-obsidian/85 backdrop-blur border-b border-white/[0.06]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[9px] font-mono uppercase tracking-[0.14em] text-gold/70">
                Step {step + 1} of {steps.length}
              </div>
              <div className="text-sm font-display font-semibold text-white truncate">
                {currentStep.label}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={`h-1 rounded-full transition-all ${
                    i === step ? 'w-5 bg-gold' : i < step ? 'w-2 bg-emerald-soft/60' : 'w-2 bg-white/10'
                  }`}
                  aria-hidden="true"
                />
              ))}
            </div>
          </div>
        </div>

        {isConnected && (
          <NetworkWarning
            requiredAddress={deployments.aegisVaultFactoryV2 || deployments.aegisVaultFactory}
            expectedChainId={factoryChainId}
            contractName="Aegis Vault Factory"
          />
        )}

        {hasDraft && deployPhase === 'idle' && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-cyan/20 bg-cyan/[0.04] px-4 py-2.5">
            <div className="flex items-center gap-2 text-[11px] text-cyan/80">
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Vault draft auto-saved. Pick up where you left off.</span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Discard saved draft and reset the form?')) clearDraft();
              }}
              className="text-[10px] font-mono uppercase tracking-wide text-steel/55 hover:text-white transition-colors"
            >
              Reset draft
            </button>
          </div>
        )}

        {/* Step indicator — numbered progress (hidden on mobile, sticky bar replaces it) */}
        <div className="mb-10 hidden sm:block">
          <div className="flex items-start justify-between relative">
            {/* Background track */}
            <div className="absolute top-4 left-0 right-0 h-px bg-white/[0.06]" aria-hidden="true" />
            {/* Progress fill */}
            <div
              className="absolute top-4 left-0 h-px bg-gradient-to-r from-emerald-soft/40 via-emerald-soft/40 to-gold/50 transition-all duration-500"
              style={{ width: `${(step / (steps.length - 1)) * 100}%` }}
              aria-hidden="true"
            />
            {steps.map((s, i) => {
              const isDone = i < step;
              const isCurrent = i === step;
              const clickable = i <= step;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => clickable && setStep(i)}
                  disabled={!clickable}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Step ${i + 1}: ${s.label}`}
                  className={`relative z-10 flex flex-col items-center gap-2 group ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <span
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-mono font-semibold border transition-all
                      ${isCurrent
                        ? 'bg-gold/15 border-gold/50 text-gold shadow-[0_0_0_4px_rgba(207,168,61,0.08)]'
                        : isDone
                          ? 'bg-emerald-soft/15 border-emerald-soft/40 text-emerald-soft group-hover:border-emerald-soft/70'
                          : 'bg-obsidian border-white/[0.08] text-steel/40'
                      }`}
                  >
                    {isDone ? <Check className="w-3.5 h-3.5" /> : s.number}
                  </span>
                  <span
                    className={`hidden sm:block text-[10px] font-mono tracking-[0.12em] uppercase transition-colors
                      ${isCurrent ? 'text-gold' : isDone ? 'text-emerald-soft/70' : 'text-steel/35'}`}
                  >
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          {/* Step content */}
          <div className="min-h-[400px]">
          {/* Deploy progress tracker */}
          {(isDeploying || deployPhase === 'done' || deployPhase === 'error') && (
            <GlassPanel gold={deployPhase !== 'error'} className={`p-5 mb-6 ${deployPhase === 'error' ? 'border-red-warn/30 bg-red-warn/[0.04]' : ''}`}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className={`text-[10px] font-mono uppercase tracking-[0.15em] mb-1 ${deployPhase === 'error' ? 'text-red-warn/80' : 'text-gold/70'}`}>
                    {deployPhase === 'error' ? `Deployment halted at "${deployError?.phase}"` : 'Vault launch in progress'}
                  </div>
                  <div className="text-sm text-white font-display font-semibold">
                    {deployPhase === 'error' ? (deployError?.isUserReject ? 'Transaction rejected' : (deployError?.title || 'Transaction failed')) : deployPhaseLabel}
                  </div>
                  {isDeploying && deployStartedAt && nowMs && (
                    <div className="text-[10px] font-mono text-steel/45 mt-1">
                      Elapsed {Math.max(0, Math.round((nowMs - deployStartedAt) / 1000))}s · Don't close this tab.
                    </div>
                  )}
                </div>
                {deployPhase === 'done' ? (
                  <StatusPill label="Deployed" variant="active" />
                ) : deployPhase === 'error' ? (
                  <StatusPill label={deployError?.isUserReject ? 'Rejected' : 'Failed'} variant="critical" />
                ) : (
                  <StatusPill label="Working" variant="warning" pulse />
                )}
              </div>
              <div className="space-y-2.5">
                {[
                  { key: 'creating', label: '1. Deploy vault contract' },
                  { key: 'approving', label: `2. Approve ${selectedBaseAsset.symbol} spending` },
                  { key: 'depositing', label: `3. Deposit ${selectedBaseAsset.symbol} into vault` },
                ].map((phase) => {
                  const errorHere = deployPhase === 'error' && deployError?.phase === phase.key;
                  const orderMap = { creating: 0, approving: 1, depositing: 2 };
                  const currentOrder = orderMap[deployPhase === 'error' ? deployError?.phase : deployPhase] ?? 3;
                  const done = orderMap[phase.key] < currentOrder || deployPhase === 'done';
                  const active = !errorHere && deployPhase === phase.key;
                  return (
                    <div key={phase.key} className="flex items-center gap-3">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono border
                          ${errorHere
                            ? 'bg-red-warn/15 border-red-warn/50 text-red-warn'
                            : done
                              ? 'bg-emerald-soft/15 border-emerald-soft/40 text-emerald-soft'
                              : active
                                ? 'bg-gold/15 border-gold/50 text-gold animate-pulse'
                                : 'bg-obsidian border-white/[0.08] text-steel/40'}`}
                      >
                        {errorHere ? <AlertTriangle className="w-3 h-3" /> : done ? <Check className="w-3.5 h-3.5" /> : active ? <Clock className="w-3 h-3" /> : ''}
                      </span>
                      <span className={`text-xs ${errorHere ? 'text-red-warn' : done ? 'text-emerald-soft/80' : active ? 'text-white' : 'text-steel/40'}`}>
                        {phase.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              {deployPhase === 'error' && deployError && (
                <div className="mt-4 pt-3 border-t border-red-warn/20">
                  <p className="text-[11px] text-red-warn/90 leading-relaxed mb-3 break-words">
                    {deployError.message}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <ControlButton variant="primary" size="sm" onClick={retryDeployment}>
                      <ArrowRight className="w-3.5 h-3.5" /> Retry {deployError.phase === 'creating' ? 'deployment' : deployError.phase === 'approving' ? 'approval' : 'deposit'}
                    </ControlButton>
                    <ControlButton variant="ghost" size="sm" onClick={dismissDeployError}>
                      Cancel
                    </ControlButton>
                    {deployedVaultAddress && deployError.phase !== 'creating' && (
                      <span className="text-[10px] font-mono text-steel/50">
                        Vault already deployed: you can also finish deposit manually on the vault page.
                      </span>
                    )}
                  </div>
                </div>
              )}
              {deployedVaultAddress && deployPhase !== 'error' && (
                <div className="mt-4 pt-3 border-t border-white/[0.06] text-[10px] font-mono text-steel/50">
                  Vault: <span className="text-gold/80">{deployedVaultAddress.slice(0, 10)}…{deployedVaultAddress.slice(-8)}</span>
                </div>
              )}
            </GlassPanel>
          )}

          {/* Step 1: Deposit */}
          {currentStep.key === 'deposit' && (
            <div>
              <div className="mb-5 pb-4 border-b border-white/[0.04]">
                <div className="flex items-baseline gap-3.5 flex-wrap">
                  <span className="ed-eyebrow">§ C.01</span>
                  <span className="ed-mono text-[10.5px] tracking-[0.22em] uppercase" style={{ color: 'var(--ed-steel-400)' }}>
                    Deposit
                  </span>
                  <h2
                    className="ed-display"
                    style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, margin: 0 }}
                  >
                    Fund your <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>vault.</span>
                  </h2>
                </div>
                <p className="text-[13px] mt-2 max-w-[620px]" style={{ color: 'var(--ed-steel-400)', lineHeight: 1.55 }}>
                  Specify the initial deposit amount. Your capital remains under smart contract custody.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_240px]">
                <GlassPanel gold className="p-6">
                  <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-steel/40 block mb-3">
                    Base Asset
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
                    {baseAssetOptions.map((asset) => {
                      const selected = config.baseAsset === asset.symbol;
                      const tokenAddr = deployments[asset.depKey];
                      const unavailable = !tokenAddr || tokenAddr === '';
                      return (
                        <button
                          key={asset.symbol}
                          onClick={() => !unavailable && updateConfig('baseAsset', asset.symbol)}
                          disabled={unavailable}
                          title={unavailable ? `${asset.symbol} not deployed on this network` : ''}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all
                            ${unavailable
                              ? 'border-white/[0.04] bg-white/[0.01] opacity-40 cursor-not-allowed'
                              : selected
                                ? `bg-white/[0.04] ${asset.border} shadow-[0_0_0_3px_rgba(255,255,255,0.03)]`
                                : 'border-white/[0.06] hover:border-white/[0.12] bg-white/[0.01]'
                            }`}
                        >
                          <TokenIcon symbol={asset.symbol} size={22} />
                          <div className="text-left">
                            <div className={`text-xs font-display font-semibold ${selected ? asset.color : 'text-white'}`}>{asset.symbol}</div>
                            <div className="text-[9px] font-mono text-steel/40">{asset.decimals} dec</div>
                          </div>
                          {selected && <Check className="w-3.5 h-3.5 ml-auto text-gold" />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-[10px] font-mono tracking-[0.15em] uppercase text-steel/40">
                      Deposit Amount ({selectedBaseAsset.symbol})
                    </label>
                    <div className="text-[10px] font-mono text-steel/50">
                      {!isConnected ? (
                        <span className="text-steel/40">Connect wallet for balance</span>
                      ) : balanceLoading ? (
                        <span>Loading…</span>
                      ) : (
                        <span>
                          Balance:{' '}
                          <span className={`${exceedsBalance ? 'text-red-warn' : insufficientBalance ? 'text-amber-warn' : 'text-white/80'}`}>
                            {walletBalanceNum.toLocaleString(undefined, { maximumFractionDigits: 6 })} {selectedBaseAsset.symbol}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-mono text-steel/35">{selectedBaseAsset.symbol}</span>
                    <input
                      type="number"
                      min="0"
                      max={walletBalanceNum || undefined}
                      value={config.depositAmount}
                      onChange={(e) => updateConfig('depositAmount', Number(e.target.value))}
                      className={`w-full bg-obsidian/60 border rounded-lg px-4 pl-16 pr-20 py-4
                        text-2xl font-display font-semibold text-white
                        focus:outline-none transition-colors
                        ${exceedsBalance ? 'border-red-warn/40 focus:border-red-warn/60' : 'border-white/[0.08] focus:border-gold/30'}`}
                    />
                    {isConnected && walletBalanceNum > 0 && (
                      <button
                        type="button"
                        onClick={() => updateConfig('depositAmount', walletBalanceNum)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded bg-gold/10 hover:bg-gold/20 border border-gold/20 text-[10px] font-mono text-gold transition-colors"
                      >
                        MAX
                      </button>
                    )}
                  </div>
                  {exceedsBalance && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-warn">
                      <AlertTriangle className="w-3 h-3" />
                      Amount exceeds your wallet balance
                    </div>
                  )}
                  {insufficientBalance && !exceedsBalance && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-warn">
                      <AlertTriangle className="w-3 h-3" />
                      No {selectedBaseAsset.symbol} balance — mint some at <Link to="/faucet" className="underline hover:text-amber-warn/80">faucet</Link>
                    </div>
                  )}
                  {exceedsTierCap && (
                    <div className="mt-2 flex items-start gap-1.5 text-[11px] text-red-warn/85">
                      <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span>
                        Exceeds {selectedOperatorData?.name}'s tier cap of{' '}
                        {formatVaultCap(selectedOperatorTier?.maxVaultSize || 0, selectedOperatorTier?.isUnlimited)}.
                        Reduce deposit or pick a higher-tier operator at Step 6.
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-4">
                    {(config.baseAsset === 'USDC' ? [10000, 25000, 50000, 100000]
                      : config.baseAsset === 'WBTC' ? [0.25, 0.5, 1, 2.5]
                      : [1, 5, 10, 25]
                    ).map((amt) => {
                      const overBalance = isConnected && amt > walletBalanceNum;
                      return (
                        <button
                          key={amt}
                          disabled={overBalance}
                          onClick={() => updateConfig('depositAmount', amt)}
                          className={`px-3 py-1.5 rounded text-[10px] font-mono transition-all
                            ${overBalance
                              ? 'text-steel/25 border border-white/[0.04] cursor-not-allowed'
                              : config.depositAmount === amt
                                ? 'bg-gold/15 text-gold border border-gold/20'
                                : 'text-steel/50 border border-white/[0.06] hover:border-white/[0.1]'
                            }`}
                        >
                          {config.baseAsset === 'USDC' ? `$${(amt / 1000).toFixed(0)}k` : `${amt} ${config.baseAsset}`}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-steel/45 mt-4 leading-relaxed">
                    On deploy, this amount will be approved and deposited into your new vault in a single guided flow.
                  </p>
                </GlassPanel>
                <div className="space-y-3">
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-steel/40 mb-1.5">
                      <DollarSign className="w-3 h-3" /> Recommended
                    </div>
                    <div className="text-sm font-display font-semibold text-white">$25k – $100k</div>
                    <div className="text-[10px] text-steel/45">Optimal for demo-day operators</div>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-steel/40 mb-1.5">
                      <Shield className="w-3 h-3" /> Custody
                    </div>
                    <div className="text-sm font-display font-semibold text-white">Non-custodial</div>
                    <div className="text-[10px] text-steel/45">Smart contract escrow only</div>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-steel/40 mb-1.5">
                      <Info className="w-3 h-3" /> Asset
                    </div>
                    <div className={`text-sm font-display font-semibold ${selectedBaseAsset.color}`}>Mock {selectedBaseAsset.symbol}</div>
                    <div className="text-[10px] text-steel/45">{selectedBaseAsset.decimals}-decimal testnet token</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Risk Profile */}
          {currentStep.key === 'risk' && (
            <div>
              <div className="mb-5 pb-4 border-b border-white/[0.04]">
                <div className="flex items-baseline gap-3.5 flex-wrap">
                  <span className="ed-eyebrow">§ C.02</span>
                  <span className="ed-mono text-[10.5px] tracking-[0.22em] uppercase" style={{ color: 'var(--ed-steel-400)' }}>
                    Risk profile
                  </span>
                  <h2
                    className="ed-display"
                    style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, margin: 0 }}
                  >
                    Choose your risk <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>mandate.</span>
                  </h2>
                </div>
                <p className="text-[13px] mt-2 max-w-[620px]" style={{ color: 'var(--ed-steel-400)', lineHeight: 1.55 }}>
                  This sets the baseline risk posture for your vault. You can fine-tune parameters in the next step.
                </p>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
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
              <div className="mb-5 pb-4 border-b border-white/[0.04]">
                <div className="flex items-baseline gap-3.5 flex-wrap">
                  <span className="ed-eyebrow">§ C.03</span>
                  <span className="ed-mono text-[10.5px] tracking-[0.22em] uppercase" style={{ color: 'var(--ed-steel-400)' }}>
                    Policy · hard gates
                  </span>
                  <h2
                    className="ed-display"
                    style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, margin: 0 }}
                  >
                    Fine-tune <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>guardrails.</span>
                  </h2>
                </div>
                <p className="text-[13px] mt-2 max-w-[620px]" style={{ color: 'var(--ed-steel-400)', lineHeight: 1.55 }}>
                  Fields tagged <span className="inline-flex items-center rounded-full border border-amber-400/35 bg-amber-400/10 px-1.5 py-px text-[8.5px] font-mono uppercase tracking-[0.08em] text-amber-200/90 align-middle">hard cap</span> are <strong className="text-white/80">enforced on-chain</strong> — the vault contract reverts any trade that breaches them, and not even the operator can override them. Fields tagged <span className="inline-flex items-center rounded-full border border-cyan/30 bg-cyan/10 px-1.5 py-px text-[8.5px] font-mono uppercase tracking-[0.08em] text-cyan/85 align-middle">off-chain</span> are enforced by the orchestrator's risk veto, not the contract. Values are sealed at vault creation; pause/executor/venue can be rotated later but the policy itself is not mutable.
                </p>
              </div>
              <GlassPanel className="p-6">
                {operatorSuggestions && (
                  <div className="mb-5 p-3 rounded-md border border-gold/20 bg-gold/[0.04] flex items-start gap-2.5">
                    <Cpu className="w-3.5 h-3.5 text-gold/80 mt-0.5 flex-shrink-0" />
                    <div className="text-[11.5px] text-steel/65 leading-relaxed">
                      Some values below are <strong className="text-gold/90">pre-filled from {operatorSuggestions.operatorName}</strong>'s suggested defaults. You can override any of them — whatever you confirm is what gets sealed into the vault. The operator's later edits to their own profile will not migrate into this vault.
                    </div>
                  </div>
                )}
                <div className="space-y-5">
                  {[
                    { label: 'Max Drawdown', key: 'maxDrawdown', min: 1, max: 30, suffix: '%', icon: <TrendingDown className="w-3.5 h-3.5" />, desc: 'Maximum allowed daily loss', enforcement: 'off-chain', enforceTitle: 'Stored in policy.maxDailyLossBps but currently enforced only by the orchestrator risk veto.' },
                    { label: 'Max Position Size', key: 'maxPosition', min: 10, max: 80, suffix: '%', icon: <Target className="w-3.5 h-3.5" />, desc: 'Maximum single trade size', enforcement: 'hard', enforceTitle: 'Hard cap: vault contract reverts when intent.amountIn > totalDeposited × this %.' },
                    { label: 'Daily Loss Limit', key: 'dailyLossLimit', min: 1, max: 15, suffix: '%', icon: <AlertTriangle className="w-3.5 h-3.5" />, desc: 'Stop trading if daily loss exceeds this', enforcement: 'off-chain', enforceTitle: 'Off-chain: orchestrator risk veto halts execution past this threshold.' },
                    { label: 'Cooldown Period', key: 'cooldown', min: 1, max: 60, suffix: 'min', icon: <Clock className="w-3.5 h-3.5" />, desc: 'Minimum wait between trades', enforcement: 'hard', enforceTitle: 'Hard cap: vault contract reverts until block.timestamp ≥ lastExecutionTime + cooldown.' },
                    { label: 'Confidence Threshold', key: 'confidenceThreshold', min: 30, max: 95, suffix: '%', icon: <Zap className="w-3.5 h-3.5" />, desc: 'AI must be at least this confident to trade', enforcement: 'hard', enforceTitle: 'Hard cap: vault contract reverts when intent.confidenceBps < this value (also drives orchestrator engine thresholds).' },
                    { label: 'Global Stop-Loss', key: 'stopLoss', min: 5, max: 30, suffix: '%', icon: <Shield className="w-3.5 h-3.5" />, desc: 'Halt all trading if total loss exceeds this', enforcement: 'off-chain', enforceTitle: 'Off-chain: orchestrator risk veto halts trading past this NAV-relative threshold.' },
                    { label: 'Max Trades Per Day', key: 'maxActionsPerDay', min: 1, max: 50, suffix: '', icon: <Layers className="w-3.5 h-3.5" />, desc: 'Maximum number of trades per day', enforcement: 'hard', enforceTitle: 'Hard cap: vault contract reverts past this count over a rolling 24-hour window.' },
                  ].map((param) => {
                    const suggestedValue = operatorSuggestions?.[param.key];
                    const isSuggested =
                      suggestedValue != null && suggestedValue === config[param.key];
                    const enforcementClass =
                      param.enforcement === 'hard'
                        ? 'border-amber-400/35 bg-amber-400/10 text-amber-200/90'
                        : 'border-cyan/30 bg-cyan/10 text-cyan/85';
                    const enforcementLabel = param.enforcement === 'hard' ? 'hard cap' : 'off-chain';
                    return (
                      <div key={param.key}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 text-xs text-steel/70">
                            <span className="text-steel/40">{param.icon}</span>
                            {param.label}
                            <span
                              className={`text-[8.5px] font-mono uppercase tracking-[0.08em] px-1.5 py-px rounded-full border ${enforcementClass}`}
                              title={param.enforceTitle}
                            >
                              {enforcementLabel}
                            </span>
                            {isSuggested && (
                              <span
                                className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-gold/25 text-gold/80 bg-gold/[0.04]"
                                title={`${operatorSuggestions.operatorName} suggested ${suggestedValue}${param.suffix}. Move the slider to override.`}
                              >
                                Suggested
                              </span>
                            )}
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
                    );
                  })}
                </div>
              </GlassPanel>
            </div>
          )}

          {/* Step 4: Assets */}
          {currentStep.key === 'assets' && (
            <div>
              <div className="mb-5 pb-4 border-b border-white/[0.04]">
                <div className="flex items-baseline gap-3.5 flex-wrap">
                  <span className="ed-eyebrow">§ C.04</span>
                  <span className="ed-mono text-[10.5px] tracking-[0.22em] uppercase" style={{ color: 'var(--ed-steel-400)' }}>
                    Assets
                  </span>
                  <h2
                    className="ed-display"
                    style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, margin: 0 }}
                  >
                    Select <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>allowed</span> assets.
                  </h2>
                </div>
                <p className="text-[13px] mt-2 max-w-[620px]" style={{ color: 'var(--ed-steel-400)', lineHeight: 1.55 }}>
                  The AI can only trade assets you explicitly authorize. This is enforced on-chain. At least one is required.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3" role="group" aria-label="Allowed trading assets">
                {availableAssets.map((asset) => {
                  const selected = config.allowedAssets.includes(asset.symbol);
                  return (
                    <button
                      key={asset.symbol}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
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
              {noAssetsSelected && (
                <div className="mt-3 flex items-center gap-2 text-[11px] text-amber-warn">
                  <AlertTriangle className="w-3 h-3" />
                  Pick at least one asset before continuing.
                </div>
              )}
            </div>
          )}

          {/* Step 5: Sealed Mode */}
          {currentStep.key === 'sealed' && (
            <div>
              <div className="mb-5 pb-4 border-b border-white/[0.04]">
                <div className="flex items-baseline gap-3.5 flex-wrap">
                  <span className="ed-eyebrow">§ C.05</span>
                  <span className="ed-mono text-[10.5px] tracking-[0.22em] uppercase" style={{ color: 'var(--ed-steel-400)' }}>
                    Privacy
                  </span>
                  <h2
                    className="ed-display"
                    style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, margin: 0 }}
                  >
                    Privacy & <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>execution</span> mode.
                  </h2>
                </div>
                <p className="text-[13px] mt-2 max-w-[620px]" style={{ color: 'var(--ed-steel-400)', lineHeight: 1.55 }}>
                  Choose whether to run in sealed strategy mode and enable autonomous execution.
                </p>
              </div>
              <div className="space-y-4">
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.sealedMode}
                  aria-label="Enable Sealed Strategy Mode"
                  onClick={() => updateConfig('sealedMode', !config.sealedMode)}
                  className={`w-full flex items-center gap-4 p-5 rounded-lg border text-left transition-all duration-300
                    ${config.sealedMode ? 'glass-panel-gold border-gold/30' : 'glass-panel hover:border-white/[0.1]'}`}
                >
                  <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
                    <Lock className={`w-5 h-5 ${config.sealedMode ? 'text-gold' : 'text-steel/40'}`} />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-display font-medium text-white block mb-0.5">Sealed Strategy Mode</span>
                    <span className="text-[11px] text-steel/50">Hide trades from front-runners until they execute</span>
                  </div>
                  <StatusPill label={config.sealedMode ? 'Enabled' : 'Off'} variant={config.sealedMode ? 'sealed' : 'paused'} />
                </button>

                {config.sealedMode && (
                  <>
                    <details className="group rounded-lg border border-gold/20 bg-gold/[0.04]">
                      <summary className="cursor-pointer list-none p-4 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-gold/80 inline-flex items-center gap-2">
                          <HelpCircle className="w-3 h-3" />
                          How sealed mode protects you
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 text-gold/60 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="px-4 pb-4 text-[11px] text-steel/65 space-y-2 leading-relaxed">
                        <p>
                          <strong className="text-white/80">Trade decisions stay private</strong> — the AI's swap parameters are
                          committed as a hash one block before they execute, so MEV bots can't front-run them.
                        </p>
                        <p>
                          <strong className="text-white/80">Inference is verified</strong> — the vault checks a signature from
                          an attested TEE signer before allowing any trade.
                        </p>
                        <p className="text-[10px] text-steel/45">
                          Hardware confidentiality strength depends on the 0G Compute provider you (or your operator) selected.
                        </p>
                      </div>
                    </details>

                    {/* Attestation signer override — advanced. Most operators run their
                        orchestrator with TEE_SIGNER_PRIVATE_KEY equal to their main
                        wallet, in which case this can be left blank. Operators who
                        use a separate TEE key MUST paste its address here, otherwise
                        sealed-mode executions will fail with "InvalidAttestationSignature". */}
                    <details className="group rounded-lg border border-white/[0.08] bg-white/[0.02]">
                      <summary className="cursor-pointer list-none p-4 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-steel/60 inline-flex items-center gap-2">
                          <HelpCircle className="w-3 h-3" />
                          Advanced: TEE attestation signer
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 text-steel/45 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="px-4 pb-4 space-y-3">
                        <p className="text-[11px] text-steel/55 leading-relaxed">
                          By default we use your selected operator's wallet as the attestation signer. If
                          your operator runs the orchestrator with <code className="text-cyan/70 font-mono">TEE_SIGNER_PRIVATE_KEY</code> set
                          to a different key, paste that key's <strong className="text-white/75">address</strong> below.
                          Sealed-mode trades will revert if the signer here doesn't match the orchestrator's TEE key.
                        </p>
                        <input
                          type="text"
                          value={customAttestedSigner}
                          onChange={(e) => setCustomAttestedSigner(e.target.value.trim())}
                          placeholder={`Default: ${selectedOperatorData?.wallet?.slice(0, 10) || '0x...'}…`}
                          spellCheck="false"
                          className={`w-full bg-obsidian/60 border rounded-md px-3 py-2 text-xs font-mono text-white focus:outline-none transition-colors ${
                            customAttestedSigner && !isAddress(customAttestedSigner)
                              ? 'border-red-warn/40 focus:border-red-warn/60'
                              : 'border-white/[0.08] focus:border-gold/30'
                          }`}
                        />
                        {customAttestedSigner && !isAddress(customAttestedSigner) && (
                          <p className="text-[11px] text-red-warn flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Not a valid address — leave blank to use operator wallet.
                          </p>
                        )}
                      </div>
                    </details>
                  </>
                )}

                <button
                  type="button"
                  role="switch"
                  aria-checked={config.autoExecution}
                  aria-label="Enable Auto-Execution"
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
              <div className="mb-5 pb-4 border-b border-white/[0.04]">
                <div className="flex items-baseline gap-3.5 flex-wrap">
                  <span className="ed-eyebrow">§ C.06</span>
                  <span className="ed-mono text-[10.5px] tracking-[0.22em] uppercase" style={{ color: 'var(--ed-steel-400)' }}>
                    Review & seal
                  </span>
                  <h2
                    className="ed-display"
                    style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.035em', lineHeight: 1, margin: 0 }}
                  >
                    Review, <span className="ed-italic" style={{ color: 'var(--ed-gold)' }}>then seal.</span>
                  </h2>
                </div>
                <p className="text-[13px] mt-2 max-w-[620px]" style={{ color: 'var(--ed-steel-400)', lineHeight: 1.55 }}>
                  Confirm your vault parameters before deployment. All policies will be enforced on-chain.
                </p>
              </div>
              <GlassPanel gold className="p-6">
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
                      <span className="text-xs text-steel/60 inline-flex items-center gap-2">
                        Executor
                        {isExecutorAutoResolved && (
                          <span className="text-[8px] font-mono text-cyan/70 bg-cyan/10 border border-cyan/20 px-1.5 py-0.5 rounded uppercase tracking-wider">
                            Auto-detected
                          </span>
                        )}
                      </span>
                      <span className="text-sm font-mono text-white">{shortExecutor}</span>
                    </div>
                    {isExecutorAutoResolved && (
                      <p className="text-[10px] text-steel/45 -mt-2">
                        We picked a default for you. Choose one explicitly below to confirm.
                      </p>
                    )}

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
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-[10px] font-mono tracking-[0.12em] uppercase text-gold/80 inline-flex items-center gap-1.5">
                            <ArrowRight className="w-3 h-3" />
                            Click an operator below to select
                          </label>
                          {selectedOperatorData && (
                            <span className="text-[9px] font-mono text-emerald-soft/70 uppercase tracking-wider">
                              ✓ {selectedOperatorData.name} selected
                            </span>
                          )}
                        </div>
                        {useDemoMarketplace && (
                          <div className="mb-2 rounded-md bg-amber-warn/5 border border-amber-warn/25 px-3 py-2 flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-warn/80 flex-shrink-0 mt-0.5" />
                            <p className="text-[11px] text-amber-warn/85 leading-relaxed">
                              <strong>Demo roster only.</strong> No live operators are registered on this network yet.
                              Selecting one will deploy your vault, but no orchestrator is actually running this address —
                              trades will not execute. Either{' '}
                              <Link to="/operator/register" className="underline hover:text-amber-warn">register an operator</Link>{' '}
                              or wait for live operators to appear.
                            </p>
                          </div>
                        )}
                        {operatorsLoading && activeMarketplaceOperators.length === 0 ? (
                          <div className="space-y-1.5">
                            {[0, 1, 2].map((i) => (
                              <div key={i} className="px-3 py-2.5 rounded-md border border-white/[0.06] bg-white/[0.02] animate-pulse">
                                <div className="h-3 w-32 bg-white/[0.06] rounded mb-2" />
                                <div className="h-2 w-48 bg-white/[0.04] rounded mb-2" />
                                <div className="h-2 w-64 bg-white/[0.03] rounded" />
                              </div>
                            ))}
                          </div>
                        ) : activeMarketplaceOperators.length === 0 ? (
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
                                  className={`w-full text-left px-3 py-2.5 rounded-md border-2 transition-all cursor-pointer ${
                                    selected
                                      ? 'border-gold bg-gold/10 shadow-[0_0_0_3px_rgba(201,168,76,0.08)]'
                                      : 'border-white/[0.08] bg-white/[0.02] hover:border-gold/40 hover:bg-gold/[0.03]'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 mb-0.5">
                                    <div className="flex items-center gap-2">
                                      {/* Radio-style selection indicator — makes it obvious each card is clickable */}
                                      <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                        selected ? 'border-gold bg-gold' : 'border-white/30'
                                      }`}>
                                        {selected && <Check className="w-2 h-2 text-obsidian" strokeWidth={4} />}
                                      </div>
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
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[9px] font-mono">
                                    <span className="text-gold/70">Perf {formatBps(op.performanceFeeBps)}</span>
                                    <span className="text-cyan/70">Mgmt {formatBps(op.managementFeeBps)}</span>
                                    <span className="text-steel/45">Entry {formatBps(op.entryFeeBps)}</span>
                                    <span className="text-steel/45">Exit {formatBps(op.exitFeeBps)}</span>
                                    {tierData && (
                                      <span className={opExceedsCap ? 'text-red-warn sm:ml-auto' : 'text-emerald-soft/60 sm:ml-auto'}>
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
                        <label htmlFor="custom-executor" className="text-[10px] font-mono tracking-[0.12em] uppercase text-steel/40 block mb-2">
                          Executor Address
                        </label>
                        <input
                          id="custom-executor"
                          type="text"
                          value={customExecutor}
                          onChange={(e) => setCustomExecutor(e.target.value.trim())}
                          placeholder="0x..."
                          spellCheck="false"
                          aria-invalid={!customExecutorIsAddr}
                          className={`w-full bg-obsidian/60 border rounded-lg px-3 py-2.5
                            text-sm font-mono text-white
                            focus:outline-none transition-colors
                            ${!customExecutorIsAddr
                              ? 'border-red-warn/40 focus:border-red-warn/60'
                              : 'border-white/[0.08] focus:border-gold/30'}`}
                        />
                        {!customExecutorIsAddr && (
                          <p className="mt-1.5 text-[11px] text-red-warn flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Not a valid Ethereum address.
                          </p>
                        )}
                        {customExecutorWarning && (
                          <div className="mt-2 rounded-md bg-amber-warn/5 border border-amber-warn/25 px-3 py-2 flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-warn/80 flex-shrink-0 mt-0.5" />
                            <p className="text-[11px] text-amber-warn/85 leading-relaxed">
                              {customExecutorWarning.message}
                            </p>
                          </div>
                        )}
                        {customExecRegistered && customExecData?.active && (
                          <p className="mt-1.5 text-[11px] text-emerald-soft/80 flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            Registered & active operator: {customExecData.name}
                          </p>
                        )}
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

          {/* Navigation buttons — integrated into step footer */}
          <div className="flex items-center justify-between mt-8 pt-5 border-t border-white/[0.04]">
            <div>
              {step > 0 && (
                <ControlButton variant="ghost" onClick={() => setStep(step - 1)}>
                  <ArrowLeft className="w-4 h-4" /> Previous
                </ControlButton>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-[0.14em] text-steel/40">
                Step {step + 1} of {steps.length}
              </span>
              {step < steps.length - 1 ? (
                <ControlButton
                  variant="primary"
                  disabled={
                    (currentStep.key === 'deposit' && (exceedsBalance || !(config.depositAmount > 0))) ||
                    (currentStep.key === 'assets' && noAssetsSelected)
                  }
                  onClick={() => setStep(step + 1)}
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </ControlButton>
              ) : isConnected ? (
                <ControlButton
                  variant="primary"
                  size="lg"
                  disabled={isDeploying || !executorReady || !(config.depositAmount > 0) || exceedsBalance || noAssetsSelected || exceedsTierCap || selectedOperatorTier?.frozen || (activeExecutorMode === 'marketplace' && useDemoMarketplace)}
                  title={!executorReady ? `executor="${resolvedExecutor}" mode=${activeExecutorMode} custom="${customExecutor}"` : ''}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Shield className="w-4 h-4" /> {deployPhaseLabel}
                </ControlButton>
              ) : (
                <WalletButton />
              )}
            </div>
          </div>
        </div>

          <aside className="space-y-4 lg:mt-28 lg:sticky lg:top-24">
            <GlassPanel className="p-4">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-cyan/70 mb-1">Live Preview</div>
                  <h3 className="text-lg font-display font-semibold text-white">Vault launch snapshot</h3>
                </div>
                <StatusPill
                  label={executorReady ? 'Demo ready' : 'Needs executor'}
                  variant={executorReady ? 'active' : 'warning'}
                />
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-steel/40 mb-1">Deposit</div>
                  <div className="text-lg font-display font-semibold text-white">${(config.depositAmount / 1000).toFixed(0)}k</div>
                  <div className="text-[10px] text-steel/45">USDC seed capital</div>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-steel/40 mb-1">Risk Dial</div>
                  <div className="text-lg font-display font-semibold text-gold">{riskScoreByProfile[config.riskProfile]}/10</div>
                  <div className="text-[10px] text-steel/45">{selectedProfile.label} mandate</div>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-steel/40 mb-1">Assets</div>
                  <div className="text-lg font-display font-semibold text-cyan">{config.allowedAssets.length}</div>
                  <div className="text-[10px] text-steel/45">{config.allowedAssets.join(', ')}</div>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-steel/40 mb-1">Mode</div>
                  <div className="text-lg font-display font-semibold text-white">{config.sealedMode ? 'Sealed' : 'Open'}</div>
                  <div className="text-[10px] text-steel/45">{config.autoExecution ? 'autonomous' : 'manual approval'}</div>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-2.5">
                {previewChecklist.map((item) => (
                  <div key={item.label} className="flex items-start gap-2">
                    <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center border ${
                      item.ready ? 'border-emerald-soft/30 bg-emerald-soft/10 text-emerald-soft' : 'border-gold/20 bg-gold/10 text-gold'
                    }`}>
                      {item.ready ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-white">{item.label}</div>
                      <div className="text-[10px] text-steel/45">{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </GlassPanel>

            <details className="group">
              <summary className="list-none cursor-pointer">
                <GlassPanel gold className="p-3 flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-gold/75">Judge Narrative</span>
                  <ChevronDown className="w-3.5 h-3.5 text-gold/60 transition-transform group-open:rotate-180" />
                </GlassPanel>
              </summary>
              <div className="mt-2 space-y-2 text-[11px] text-steel/55">
                <div className="flex gap-2 rounded-lg border border-gold/15 bg-gold/[0.04] px-3 py-2">
                  <span className="text-gold/80 font-mono font-semibold">1.</span>
                  <span>Show the deposit, risk mandate, and allowed assets so the policy boundary is obvious before any AI decision.</span>
                </div>
                <div className="flex gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <span className="text-steel/50 font-mono font-semibold">2.</span>
                  <span>Choose a marketplace operator; fees, caps, and trust assumptions are visible before deployment.</span>
                </div>
                <div className="flex gap-2 rounded-lg border border-cyan/15 bg-cyan/[0.04] px-3 py-2">
                  <span className="text-cyan/80 font-mono font-semibold">3.</span>
                  <span>Enable sealed mode to connect governance, audit trail, and the live action feed post-launch.</span>
                </div>
              </div>
            </details>

            {selectedOperatorData && (
              <GlassPanel className="p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-steel/40 mb-1">Operator Fit</div>
                    <h3 className="text-sm font-display font-semibold text-white">{selectedOperatorData.name}</h3>
                  </div>
                  <StatusPill label={useDemoMarketplace ? 'Demo roster' : 'Live registry'} variant={useDemoMarketplace ? 'gold' : 'active'} />
                </div>
                <p className="text-[11px] text-steel/50 leading-relaxed mb-3">
                  {selectedOperatorData.description}
                </p>
                <div className="grid grid-cols-2 gap-3 text-[10px] font-mono">
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                    <div className="text-steel/40 uppercase mb-1">Fees</div>
                    <div className="text-gold">Perf {formatBps(selectedOperatorData.performanceFeeBps)}</div>
                    <div className="text-cyan">Mgmt {formatBps(selectedOperatorData.managementFeeBps)}</div>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                    <div className="text-steel/40 uppercase mb-1">Tier Cap</div>
                    <div className="text-white/80">
                      {formatVaultCap(selectedOperatorTier?.maxVaultSize || 0, selectedOperatorTier?.isUnlimited)}
                    </div>
                    <div className={selectedOperatorTier?.frozen ? 'text-red-warn/70' : 'text-emerald-soft/70'}>
                      {selectedOperatorTier?.frozen ? 'frozen' : 'eligible'}
                    </div>
                  </div>
                </div>
                {annualFeeEstimate && (
                  <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                    <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-steel/40 mb-1">Demo Year-One Fee View</div>
                    <div className="text-sm font-display font-semibold text-white">
                      ${(entryCost + annualFeeEstimate.totalEstimated).toFixed(0)}
                    </div>
                    <div className="text-[10px] text-steel/45">
                      On a ${config.depositAmount.toLocaleString()} vault with 10% expected return
                    </div>
                  </div>
                )}
              </GlassPanel>
            )}
          </aside>
        </div>

        <ConfirmModal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={executeDeploy}
          title="Deploy this vault?"
          description="Your wallet will prompt for three signatures: deploy, approve, and deposit. Don't close the tab."
          confirmLabel="Sign & deploy"
          confirmDisabled={!executorReady || noAssetsSelected || exceedsTierCap || selectedOperatorTier?.frozen || exceedsBalance || (activeExecutorMode === 'marketplace' && useDemoMarketplace)}
          size="lg"
        >
          <div className="grid sm:grid-cols-2 gap-3 text-[12px]">
            <SummaryRow label="Deposit" value={`$${config.depositAmount.toLocaleString()} ${selectedBaseAsset.symbol}`} />
            <SummaryRow label="Risk profile" value={selectedProfile.label} valueClass={selectedProfile.color} />
            <SummaryRow label="Allowed assets" value={config.allowedAssets.join(', ') || '—'} />
            <SummaryRow label="Sealed mode" value={config.sealedMode ? 'Enabled' : 'Disabled'} />
            <SummaryRow label="Auto-execution" value={config.autoExecution ? 'Active' : 'Off'} />
            <SummaryRow
              label="Operator"
              value={selectedOperatorData?.name || shortExecutor}
              valueClass="text-white/85"
            />
          </div>
          {selectedOperatorData && (
            <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[11px] text-steel/60">
              Year-one fee estimate (10% return assumption):{' '}
              <span className="text-white/85 font-mono">
                ${(entryCost + (annualFeeEstimate?.totalEstimated || 0)).toFixed(0)}
              </span>
            </div>
          )}
          {(exceedsTierCap || selectedOperatorTier?.frozen || noAssetsSelected) && (
            <div className="mt-3 rounded-md bg-red-warn/5 border border-red-warn/20 px-3 py-2 text-[11px] text-red-warn/85">
              Resolve the highlighted issues before continuing.
            </div>
          )}
        </ConfirmModal>
      </div>
  );
}

function SummaryRow({ label, value, valueClass = 'text-white/85' }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-steel/40 mb-1">{label}</div>
      <div className={`text-[12px] font-mono ${valueClass}`}>{value}</div>
    </div>
  );
}
