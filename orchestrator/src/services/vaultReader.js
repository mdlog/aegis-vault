import { ethers } from 'ethers';
import {
  getVaultContract, getERC20Contract,
  getOperatorStakingContract, getOperatorReputationContract,
} from '../config/contracts.js';
import { calculateMultiAssetNAV } from './pythPrice.js';
import { getAllowedAssetSymbols, getTokenAddresses } from './assets.js';
import logger from '../utils/logger.js';

/**
 * VaultReaderService
 * Reads the current state of the vault from on-chain data.
 */

/**
 * Read comprehensive vault state from the contract
 * @param {string} vaultAddress - Address of the vault contract
 * @returns {object} Complete vault state
 */
export async function readVaultState(vaultAddress) {
  try {
    const vault = getVaultContract(vaultAddress);

    // Get summary
    const summary = await vault.getVaultSummary();
    const policy = await vault.getPolicy();
    const allowedAssets = await vault.getAllowedAssets();
    let venue = ethers.ZeroAddress;
    try { venue = await vault.venue(); } catch { /* pre-venue vault */ }

    // Detect V3 by probing the `version()` view added in AegisVault_v3. V1/V2
    // vaults don't expose this — call reverts and we treat as non-V3. Used
    // by the orchestrator to gate the Khalani submission path: only V3 has
    // `acceptCrossChainFill`, so V1/V2 vaults always route through Jaine even
    // when chooseRoute prefers Khalani.
    let vaultVersion = null;
    let isV3 = false;
    let isV4 = false;
    try {
      const v = await vault.version();
      vaultVersion = String(v);
      isV3 = vaultVersion === 'v3';
      isV4 = vaultVersion === 'v4';
    } catch { /* v1/v2 vault — leave nulls */ }

    // V4: read acceptedManifestHash so the orchestrator can validate that
    // the strategy it loaded for this operator matches what the vault accepts.
    // Must use the V4-specific ABI here — the legacy/V3 ABI doesn't include
    // the acceptedManifestHash() getter, so a default `vault.acceptedManifestHash()`
    // call would fail with "function not found" rather than reading the value.
    //
    // We also read the pending-upgrade slots (`pendingManifestHash` +
    // `manifestUpgradeRequestedAt`) so ops dashboards can flag vaults whose
    // depositor has queued a strategy switch but is still inside the 24h
    // timelock. Has no effect on intent submission — `executeIntent` keeps
    // using `acceptedManifestHash` until `applyManifestUpgrade()` finalises
    // the swap — but log visibility helps catch silent operator changes.
    let acceptedManifestHash = null;
    let pendingManifestHash = null;
    let manifestUpgradeRequestedAt = 0;
    if (isV4) {
      try {
        const v4Vault = getVaultContract(vaultAddress, 'v4');
        acceptedManifestHash = await v4Vault.acceptedManifestHash();
        pendingManifestHash = await v4Vault.pendingManifestHash();
        manifestUpgradeRequestedAt = Number(await v4Vault.manifestUpgradeRequestedAt());
        if (
          pendingManifestHash &&
          pendingManifestHash !== ethers.ZeroHash &&
          manifestUpgradeRequestedAt > 0
        ) {
          const readyAt = manifestUpgradeRequestedAt + 24 * 3600;
          const remainingSec = Math.max(0, readyAt - Math.floor(Date.now() / 1000));
          logger.info(
            `    Pending manifest upgrade for ${vaultAddress}: ` +
            `${pendingManifestHash.slice(0, 10)}... ` +
            `(ready in ~${Math.ceil(remainingSec / 3600)}h)`
          );
        }
      } catch { /* getter missing — treat as zero */ }
    }

    // Parse the summary tuple
    const [
      owner,
      executor,
      baseAsset,
      vaultBalance,
      totalDeposited,
      lastExecution,
      dailyActions,
      paused,
      autoExecution,
    ] = summary;

    // Get base asset info
    const baseToken = getERC20Contract(baseAsset);
    const baseDecimals = await baseToken.decimals();
    const baseBalanceFormatted = parseFloat(ethers.formatUnits(vaultBalance, baseDecimals));

    let navData = null;
    try {
      navData = await calculateMultiAssetNAV(vaultAddress, getTokenAddresses());
    } catch (navErr) {
      logger.warn(`Failed to calculate multi-asset NAV for ${vaultAddress}: ${navErr.message}`);
    }

    const breakdown = navData?.breakdown || [];
    const assetBalances = Object.fromEntries(
      breakdown.flatMap((asset) => ([
        [asset.symbol, asset.balance],
        [asset.tradeSymbol, asset.balance],
      ]))
    );
    const assetBalancesRaw = Object.fromEntries(
      breakdown.flatMap((asset) => ([
        [asset.symbol, asset.rawBalance || '0'],
        [asset.tradeSymbol, asset.rawBalance || '0'],
      ]))
    );
    const nonBaseAssets = breakdown.filter((asset) => asset.tradeSymbol !== 'USDC' && asset.valueUsd > 0);
    const primaryPositionAsset = nonBaseAssets.length > 0
      ? [...nonBaseAssets].sort((a, b) => b.valueUsd - a.valueUsd)[0].tradeSymbol
      : null;
    const totalNav = navData?.totalNav ?? baseBalanceFormatted;

    return {
      address: vaultAddress,
      owner,
      executor,
      baseAsset,
      venue,
      version: vaultVersion,
      isV3,
      isV4,
      acceptedManifestHash,
      pendingManifestHash,
      manifestUpgradeRequestedAt,
      _vaultVersion: vaultVersion,
      baseDecimals: Number(baseDecimals),
      nav: totalNav,
      navSource: navData?.source || 'base-asset-balance',
      totalDeposited: parseFloat(ethers.formatUnits(totalDeposited, baseDecimals)),
      balance: baseBalanceFormatted,
      baseBalance: baseBalanceFormatted,
      baseBalanceRaw: vaultBalance.toString(),
      lastExecutionTimestamp: Number(lastExecution),
      lastExecution: Number(lastExecution) > 0
        ? new Date(Number(lastExecution) * 1000).toISOString()
        : null,
      dailyActionsUsed: Number(dailyActions),
      paused,
      autoExecution,

      // Policy (including Phase 1 fee fields)
      policy: {
        maxPositionBps: Number(policy.maxPositionBps),
        maxDailyLossBps: Number(policy.maxDailyLossBps),
        stopLossBps: Number(policy.stopLossBps),
        cooldownSeconds: Number(policy.cooldownSeconds),
        confidenceThresholdBps: Number(policy.confidenceThresholdBps),
        maxActionsPerDay: Number(policy.maxActionsPerDay),
        autoExecution: policy.autoExecution,
        paused: policy.paused,
        // Phase 1: fees
        performanceFeeBps: Number(policy.performanceFeeBps || 0),
        managementFeeBps: Number(policy.managementFeeBps || 0),
        entryFeeBps: Number(policy.entryFeeBps || 0),
        exitFeeBps: Number(policy.exitFeeBps || 0),
        feeRecipient: policy.feeRecipient || ethers.ZeroAddress,
        // Track 2: Sealed strategy mode + TEE attested signer
        sealedMode: !!policy.sealedMode,
        attestedSigner: policy.attestedSigner || ethers.ZeroAddress,
      },

      // Derived for prompts
      mandate: getMandateLabel(Number(policy.maxPositionBps), Number(policy.maxDailyLossBps)),
      maxPositionPct: Number(policy.maxPositionBps) / 100,
      maxDrawdownPct: Number(policy.maxDailyLossBps) / 100,
      confidenceThreshold: Number(policy.confidenceThresholdBps) / 100,
      maxActionsPerDay: Number(policy.maxActionsPerDay),

      allowedAssets: allowedAssets.map(a => a.toLowerCase()),
      allowedAssetSymbols: getAllowedAssetSymbols(allowedAssets),

      allocation: breakdown.map((asset) => ({
        symbol: asset.symbol,
        tradeSymbol: asset.tradeSymbol,
        balance: asset.balance,
        valueUsd: asset.valueUsd,
        pct: asset.pct,
      })),
      breakdown,
      assetBalances,
      assetBalancesRaw,
      primaryPositionAsset,
      nonBasePositionValueUsd: nonBaseAssets.reduce((sum, asset) => sum + asset.valueUsd, 0),
      // Placeholder — the orchestrator cycle overrides this with the real value
      // derived from persisted NAV baselines (updatePnlMetrics, P0-3). Readers
      // outside the cycle (e.g. dashboard) see 0 until a cycle has run.
      currentDailyLossPct: 0,
    };

  } catch (err) {
    logger.error(`Failed to read vault state: ${err.message}`);
    throw err;
  }
}

/**
 * Determine mandate label from policy parameters
 */
function getMandateLabel(maxPositionBps, maxDailyLossBps) {
  if (maxPositionBps <= 3000 && maxDailyLossBps <= 300) return 'Defensive';
  if (maxPositionBps <= 5000 && maxDailyLossBps <= 500) return 'Balanced';
  return 'Tactical';
}
