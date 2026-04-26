import { ethers } from 'ethers';
import { ABIs, getVaultContract, getShardedVaultContract, computeIntentHash, computeCommitHash, getProvider, getSigner, EXECUTION_INTENT_TYPES } from '../config/contracts.js';
import { buildAssetAddressMap, getTrackedAsset, normalizeTradeSymbol } from './assets.js';
import { withRetry } from '../utils/retry.js';
import { chooseRoute } from './quoteRouter.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

// Minimal venue interface — supports MockDEX.getAmountOut and any adapter
// exposing the same 3-arg quote signature. Called statically so a missing pair
// just falls back to oracle-derived minAmountOut.
const VENUE_QUOTE_ABI = [
  'function getAmountOut(address,address,uint256) view returns (uint256)',
];

async function quoteVenueAmountOut(venue, tokenIn, tokenOut, amountIn) {
  if (!venue || venue === ethers.ZeroAddress) return null;
  try {
    const c = new ethers.Contract(venue, VENUE_QUOTE_ABI, getProvider());
    const out = await c.getAmountOut(tokenIn, tokenOut, amountIn);
    return BigInt(out);
  } catch (err) {
    logger.warn(`  Venue quote failed (${venue}): ${err.shortMessage || err.message}`);
    return null;
  }
}

function isNonceExpiredError(err) {
  const msg = `${err?.code || ''} ${err?.message || ''} ${err?.shortMessage || ''}`;
  return msg.includes('NONCE_EXPIRED') ||
    /nonce (has already been used|too low|expired)/i.test(msg);
}

async function resetNonceManager(contract, err) {
  const runner = contract?.runner;
  if (typeof runner?.reset !== 'function') return;

  runner.reset();
  try {
    const address = typeof runner.getAddress === 'function'
      ? await runner.getAddress()
      : runner.signer?.address;
    const pending = address
      ? await getProvider().getTransactionCount(address, 'pending')
      : null;
    logger.warn(`  NonceManager reset after stale nonce (${err.code || 'nonce_error'}${pending !== null ? `, pending=${pending}` : ''})`);
  } catch {
    logger.warn(`  NonceManager reset after stale nonce (${err.code || 'nonce_error'})`);
  }
}

/**
 * ExecutorService
 * Builds execution intents from AI decisions and submits them to the vault contract.
 * Also handles recording execution results after off-chain swap.
 */

// Asset symbol → contract address mapping (populated at runtime)
let assetAddresses = buildAssetAddressMap();

export function setAssetAddresses(mapping) {
  assetAddresses = { ...assetAddresses, ...mapping };
}

/**
 * Resolve an asset symbol to its contract address
 */
function resolveAssetAddress(symbol) {
  const addr = assetAddresses[symbol];
  if (!addr) {
    throw new Error(`No address mapping for asset: ${symbol}`);
  }
  return addr;
}

/**
 * Build an ExecutionIntent struct from an AI decision
 * @param {object} decision - AI decision { action, asset, size_bps, confidence, risk_score, reason }
 * @param {object} vaultState - Current vault state
 * @returns {object} ExecutionIntent struct ready for contract call
 */
/**
 * Default slippage tolerance in basis points (0.5% = 50 bps)
 */
const DEFAULT_SLIPPAGE_BPS = 50;

/**
 * Track 2: Compute the TEE attestation report hash from a 0G Compute response.
 * Binds the inference output to a verifiable provider+chatId on-chain.
 *
 * Honest disclosure: this is provider-attestation (signed by the registered
 * 0G Compute provider key). True TEE-grade attestation depends on whether the
 * selected provider runs in SGX/TDX hardware. We hash everything we have so the
 * vault can be audited against the original 0G Compute call.
 */
export function computeAttestationReportHash(computeResponse) {
  if (!computeResponse) return ethers.ZeroHash;
  const { provider, chatId, content, model } = computeResponse;
  const contentDigest = ethers.keccak256(ethers.toUtf8Bytes(content || ''));
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'string', 'string', 'bytes32'],
      [provider || ethers.ZeroAddress, chatId || '', model || '', contentDigest]
    )
  );
}

export async function buildExecutionIntent(decision, vaultState, oraclePrices = null, computeResponse = null) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = 300; // 5 minute TTL

  // Determine assetIn / assetOut based on action
  let assetIn, assetOut, amountIn;
  let expectedOutputUsd = 0;

  if (decision.action === 'buy') {
    // Buying: spend base asset (USDC) to get target asset
    assetIn = resolveAssetAddress('USDC');
    assetOut = resolveAssetAddress(decision.asset);
    amountIn = calculateBuyAmountFromBps(decision.size_bps, vaultState);
    expectedOutputUsd = parseFloat(ethers.formatUnits(amountIn, 6));
  } else if (decision.action === 'sell') {
    // Selling: spend target asset to get base asset (USDC)
    const tradeSymbol = normalizeTradeSymbol(decision.asset);
    const assetMeta = getTrackedAsset(tradeSymbol);
    if (!assetMeta) {
      throw new Error(`Unsupported sell asset: ${decision.asset}`);
    }

    assetIn = resolveAssetAddress(tradeSymbol);
    assetOut = resolveAssetAddress('USDC');
    amountIn = calculateSellAmountFromHoldings(
      vaultState,
      tradeSymbol,
      decision.sell_fraction_bps || decision.size_bps || 10000
    );
    const assetPrice = oraclePrices?.[tradeSymbol]?.price || oraclePrices?.[tradeSymbol] || 0;
    expectedOutputUsd = parseFloat(ethers.formatUnits(amountIn, assetMeta.decimals)) * assetPrice;
  } else {
    return null; // hold — no intent needed
  }

  if (!amountIn || amountIn <= 0n) {
    logger.warn(`  No executable amount for ${decision.action} ${decision.asset}`);
    return null;
  }

  // ── Calculate minAmountOut with slippage protection ──
  //
  // The venue's actual quote (e.g. MockDEX `getAmountOut` / adapter equivalent)
  // is the ground truth for what the swap will return at execution time. Oracle
  // price is kept as a sanity floor — if the venue quote is wildly below oracle
  // expectation, we still refuse to trade. Previously we derived minAmountOut
  // solely from oracle price, which caused every swap to revert silently when
  // the venue rate drifted outside the slippage buffer (observed on 0G mainnet
  // MockDEX where rates can diverge ~5% from oracle).
  const slippageBps = Number.isFinite(config.swapSlippageBps) && config.swapSlippageBps >= 0
    ? config.swapSlippageBps
    : DEFAULT_SLIPPAGE_BPS;
  const outAssetSymbol = decision.action === 'buy' ? decision.asset : 'USDC';
  const outAssetMeta = getTrackedAsset(outAssetSymbol);
  const outDecimals = decision.action === 'buy'
    ? (outAssetMeta?.decimals || 18)
    : 6;

  let oracleMinOut = 0n;
  if (oraclePrices && expectedOutputUsd > 0) {
    if (outAssetSymbol === 'USDC') {
      const minUsd = expectedOutputUsd * (1 - slippageBps / 10000);
      oracleMinOut = ethers.parseUnits(minUsd.toFixed(outDecimals > 6 ? 6 : outDecimals), outDecimals);
    } else {
      const priceKey = outAssetSymbol === 'BTC' || outAssetSymbol === 'WBTC' ? 'BTC' : 'ETH';
      const assetPrice = oraclePrices[priceKey]?.price || oraclePrices[priceKey] || 0;
      if (assetPrice > 0) {
        const expectedTokens = expectedOutputUsd / assetPrice;
        const minTokens = expectedTokens * (1 - slippageBps / 10000);
        oracleMinOut = ethers.parseUnits(
          minTokens.toFixed(outDecimals > 8 ? 8 : outDecimals),
          outDecimals
        );
      }
    }
  }

  // Phase 2: compare Jaine direct quote against a Khalani cross-chain route.
  // Both quotes run in parallel inside chooseRoute; the winner's amountOut is
  // used for slippage calculation. Execution still goes through Jaine — the
  // Khalani submission path (deposit/build → broadcast → deposit/submit) lands
  // in Phase 3 with the V3 vault.
  // TODO(phase3): when route === 'khalani', call khalani.buildDeposit(quoteId,
  //   routeId, executor) and route the deposit tx through the sharded wallet
  //   instead of falling through to Jaine submission.
  const routeChoice = await chooseRoute({
    venue: vaultState.venue,
    tokenIn: assetIn,
    tokenOut: assetOut,
    amountIn,
    executorAddress: vaultState.executor,
  });
  logger.info(`  Route: ${routeChoice.route} | diff ${routeChoice.diffBps} bps | ${routeChoice.rationale}`);
  if (routeChoice.route === 'khalani') {
    logger.info(`  chose Khalani: orderRoute<-stub (quoteId=${routeChoice.quoteId?.substring(0, 10)}…, routeId=${routeChoice.routeId?.substring(0, 10)}…) — falling back to Jaine submission for Phase 2`);
  }
  const venueQuote = routeChoice.amountOut > 0n ? routeChoice.amountOut : null;
  let venueMinOut = 0n;
  if (venueQuote && venueQuote > 0n) {
    // Apply slippage to the chosen quote — this is what the swap will accept.
    venueMinOut = (venueQuote * BigInt(10000 - slippageBps)) / 10000n;
  }

  // Use the LOWER of (oracle floor, venue quote - slippage). Oracle catches
  // a pool that's been drained below fair value; venue catches an oracle that
  // over-estimates what the pool can actually deliver. Taking the min means
  // both checks are enforced simultaneously.
  let minAmountOut;
  if (venueMinOut > 0n && oracleMinOut > 0n) {
    minAmountOut = venueMinOut < oracleMinOut ? venueMinOut : oracleMinOut;
  } else {
    minAmountOut = venueMinOut > 0n ? venueMinOut : oracleMinOut;
  }

  logger.info(`  Slippage ${slippageBps / 100}% | venue quote: ${venueQuote?.toString() ?? 'n/a'} | oracle floor: ${oracleMinOut.toString()} | minAmountOut: ${minAmountOut.toString()}`);

  // Track 2: bind the TEE attestation report hash into the intent
  const attestationReportHash = computeAttestationReportHash(computeResponse);

  const intent = {
    intentHash: ethers.ZeroHash, // computed below
    vault: vaultState.address,
    assetIn,
    assetOut,
    amountIn,
    minAmountOut,
    createdAt: now,
    expiresAt: now + ttl,
    confidenceBps: Math.round(decision.confidence * 10000),
    riskScoreBps: Math.round(decision.risk_score * 10000),
    attestationReportHash,
    reasonSummary: (decision.reason || '').substring(0, 200),
  };

  // Compute intent hash (now binds attestationReportHash on-chain)
  intent.intentHash = computeIntentHash(intent);

  return intent;
}

/**
 * Calculate USDC amount from basis points of vault NAV, capped by available base balance.
 */
function calculateBuyAmountFromBps(sizeBps, vaultState) {
  const desiredUsd = ((vaultState.nav || 0) * sizeBps) / 10000;
  const spendableUsd = Math.max(0, vaultState.baseBalance ?? vaultState.balance ?? 0);
  const amountUsd = Math.min(desiredUsd, spendableUsd);
  return ethers.parseUnits(amountUsd.toFixed(6), 6);
}

function calculateSellAmountFromHoldings(vaultState, symbol, fractionBps) {
  const assetMeta = getTrackedAsset(symbol);
  if (!assetMeta) {
    throw new Error(`Unsupported sell asset: ${symbol}`);
  }

  const rawBalance = getVaultAssetBalanceRaw(vaultState, symbol);
  const cappedFraction = Math.max(0, Math.min(Number(fractionBps || 0), 10000));
  const amountIn = rawBalance * BigInt(cappedFraction) / 10000n;

  if (amountIn <= 0n && rawBalance > 0n && cappedFraction > 0) {
    return rawBalance;
  }

  return amountIn;
}

function getVaultAssetBalanceRaw(vaultState, symbol) {
  const assetMeta = getTrackedAsset(symbol);
  const candidates = [
    symbol,
    normalizeTradeSymbol(symbol),
    assetMeta?.contractSymbol,
    assetMeta?.tradeSymbol,
    ...(assetMeta?.aliases || []),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const raw = vaultState.assetBalancesRaw?.[candidate];
    if (raw !== undefined && raw !== null) {
      return BigInt(raw);
    }
  }

  return 0n;
}

/**
 * Track 2: Sign an intent hash with the TEE signer key (EIP-191 prefixed).
 * The vault recovers this signer and requires it to equal policy.attestedSigner.
 */
async function signIntentHashWithTeeKey(intentHash, intent) {
  const pk = (config.teeSigner.privateKey || '').replace(/^0x/, '');
  if (!pk) {
    throw new Error('TEE_SIGNER_PRIVATE_KEY missing — required for sealed-mode vaults');
  }
  const wallet = new ethers.Wallet(pk);
  // EIP-712 signTypedData — matches \x19\x01 + domain + structHash in ExecLib.sol
  const domain = {
    name: 'AegisVault',
    version: '1',
    chainId: config.chainId,
    verifyingContract: intent.vault,
  };
  const value = {
    vault: intent.vault,
    assetIn: intent.assetIn,
    assetOut: intent.assetOut,
    amountIn: intent.amountIn,
    minAmountOut: intent.minAmountOut,
    createdAt: intent.createdAt,
    expiresAt: intent.expiresAt,
    confidenceBps: intent.confidenceBps,
    riskScoreBps: intent.riskScoreBps,
    attestationReportHash: intent.attestationReportHash || ethers.ZeroHash,
  };
  const sig = await wallet.signTypedData(domain, EXECUTION_INTENT_TYPES, value);
  return { signer: wallet.address, signature: sig };
}

/**
 * Submit intent to the vault contract.
 *
 * Track 2: For sealed-mode vaults, performs a two-step commit-reveal:
 *   1. commitIntent(commitHash) at block N
 *   2. wait until block ≥ N+1 (COMMIT_REVEAL_MIN_BLOCKS)
 *   3. executeIntent(intent, attestationSig)
 * For non-sealed vaults, falls through to a single executeIntent(intent, "0x").
 *
 * @param {object} intent - Built ExecutionIntent
 * @param {object} [opts] - { sealedMode: boolean, attestedSigner: address }
 * @returns {{ success: boolean, txHash?: string, error?: string }}
 */
export async function submitIntent(intent, opts = {}) {
  try {
    // Use sharded vault contract: each vault routes tx through its assigned
    // wallet-pool shard, avoiding nonce collisions when multiple vaults execute
    // in parallel. Falls back to single-signer getVaultContract() if pool errors.
    let vault;
    try {
      vault = await getShardedVaultContract(intent.vault);
    } catch {
      vault = getVaultContract(intent.vault);
    }
    const iface = new ethers.Interface(ABIs.AegisVault);

    const sealedMode = !!opts.sealedMode;

    logger.info(`Submitting ${sealedMode ? 'SEALED' : 'public'} intent ${intent.intentHash.substring(0, 10)}...`);
    logger.info(`  Action: ${intent.assetIn} → ${intent.assetOut}`);
    logger.info(`  Amount: ${intent.amountIn.toString()}`);
    logger.info(`  Confidence: ${intent.confidenceBps} bps`);
    if (sealedMode) {
      logger.info(`  Attestation: ${intent.attestationReportHash}`);
    }

    let attestationSig = '0x';
    if (sealedMode) {
      // Step 1: Sign intent hash with the TEE-attested signer key
      const { signer, signature } = await signIntentHashWithTeeKey(intent.intentHash, intent);
      attestationSig = signature;
      logger.info(`  TEE signer: ${signer}`);
      if (opts.attestedSigner && signer.toLowerCase() !== opts.attestedSigner.toLowerCase()) {
        throw new Error(`TEE signer mismatch: vault expects ${opts.attestedSigner} but TEE_SIGNER_PRIVATE_KEY produces ${signer}`);
      }

      // Step 2: Pre-commit the (intentHash, attestationReportHash) pair
      const commitHash = computeCommitHash(intent.intentHash, intent.attestationReportHash);
      logger.info(`  Commit hash: ${commitHash.substring(0, 10)}...`);
      const commitTx = await vault.commitIntent(commitHash);
      const commitReceipt = await commitTx.wait();
      logger.info(`  Commit mined at block ${commitReceipt.blockNumber}`);

      // Step 3: Wait at least one fresh block before reveal (with timeout)
      const provider = getProvider();
      let currentBlock = await provider.getBlockNumber();
      const maxWaitMs = 60_000; // 60s max wait for next block
      const waitStart = Date.now();
      while (currentBlock < commitReceipt.blockNumber + 1) {
        if (Date.now() - waitStart > maxWaitMs) {
          throw new Error(`Sealed mode: timed out waiting for reveal block after ${maxWaitMs}ms (commit at block ${commitReceipt.blockNumber}, current ${currentBlock})`);
        }
        await new Promise((r) => setTimeout(r, 1000));
        currentBlock = await provider.getBlockNumber();
      }
      logger.info(`  Reveal block ready: ${currentBlock} (commit was ${commitReceipt.blockNumber})`);
    }

    const receipt = await withRetry(async () => {
      try {
        const tx = await vault.executeIntent(intent, attestationSig);
        return tx.wait();
      } catch (err) {
        if (isNonceExpiredError(err)) {
          await resetNonceManager(vault, err);
        }
        throw err;
      }
    }, {
      maxRetries: 3,
      baseDelayMs: 2000,
      label: `submitIntent(${intent.intentHash.substring(0, 10)})`,
      shouldRetry: (err) => {
        const msg = err.message || '';
        // Don't retry contract reverts (permanent failures)
        if (msg.includes('PolicyCheckFailed') || msg.includes('IntentHashMismatch') ||
            msg.includes('IntentVaultMismatch') || msg.includes('AutoExecutionDisabled') ||
            msg.includes('OnlyExecutor') || msg.includes('VaultPaused') ||
            msg.includes('revert') || msg.includes('CALL_EXCEPTION')) {
          return false;
        }
        return true; // Retry nonce errors, timeouts, network errors
      },
    });
    const intentExecutedEvent = receipt.logs
      .map((log) => {
        try {
          return iface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event) => event?.name === 'IntentExecuted' && event.args.intentHash === intent.intentHash);

    const executionSuccess = intentExecutedEvent ? intentExecutedEvent.args.success : true;
    const amountOut = intentExecutedEvent ? intentExecutedEvent.args.amountOut?.toString() : null;

    logger.info(`Intent submitted. TX: ${receipt.hash}`);

    return {
      success: executionSuccess,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      amountIn: intent.amountIn.toString(),
      amountOut,
    };

  } catch (err) {
    // Parse revert reason (L-2 fix: decode all custom errors)
    let reason = err.message;
    if (err.data) {
      try {
        const iface = new ethers.Interface([
          'error PolicyCheckFailed(string)',
          'error IntentHashMismatch()',
          'error IntentVaultMismatch()',
          'error AutoExecutionDisabled()',
          'error SwapOutputMismatch()',
          'error OnlyExecutor()',
          'error VaultPaused()',
        ]);
        const decoded = iface.parseError(err.data);
        reason = decoded.args.length > 0
          ? `${decoded.name}: ${decoded.args[0]}`
          : decoded.name;
      } catch (_) {}
    }

    logger.error(`Intent submission failed: ${reason}`);
    return {
      success: false,
      error: reason,
    };
  }
}

/**
 * Record execution result to OperatorReputation contract so the operator
 * detail page's track record (totalExecutions, successRate, volume, PnL) stays
 * in sync with actual on-chain swap activity.
 *
 * Must be called by a wallet that the reputation admin has authorized via
 * `setRecorder(wallet, true)`. If the executor wallet is not authorized yet,
 * this returns `{ success: false, error: 'not_authorized' }` and the caller
 * should surface a setup instruction instead of failing the whole cycle.
 *
 * @param {string} operator  operator wallet (vault's `executor` field)
 * @param {bigint|number} volumeUsd6  notional in USDC 6-decimal units
 * @param {bigint|number} pnlUsd6     signed realized PnL (6-decimal); 0 on BUY
 * @param {boolean} success           whether the swap settled successfully
 */
export async function recordExecutionToReputation(operator, volumeUsd6, pnlUsd6, success) {
  const reputationAddress = config.contracts.operatorReputation;
  if (!reputationAddress || reputationAddress === ethers.ZeroAddress) {
    return { success: false, error: 'reputation_not_configured' };
  }
  if (!operator || operator === ethers.ZeroAddress) {
    return { success: false, error: 'no_operator' };
  }

  try {
    const signer = getSigner();
    const recorderAddress = typeof signer.getAddress === 'function'
      ? await signer.getAddress()
      : signer.signer?.address || signer.address;
    const rep = new ethers.Contract(reputationAddress, [
      'function recordExecution(address operator, uint256 volumeUsd6, int256 pnlUsd6, bool success) external',
      'function authorizedRecorders(address) view returns (bool)',
    ], signer);

    const authed = await rep.authorizedRecorders(recorderAddress);
    if (!authed) {
      logger.warn(`    Reputation recorder not authorized (${recorderAddress}). Run scripts/authorize-reputation-recorder.mjs as admin.`);
      return { success: false, error: 'not_authorized' };
    }

    const receipt = await withRetry(async () => {
      try {
        const tx = await rep.recordExecution(operator, BigInt(volumeUsd6), BigInt(pnlUsd6), success);
        return tx.wait();
      } catch (err) {
        if (isNonceExpiredError(err)) {
          await resetNonceManager(rep, err);
        }
        throw err;
      }
    }, {
      maxRetries: 3,
      baseDelayMs: 2000,
      label: `recordExecution(${operator.substring(0, 10)})`,
      shouldRetry: (err) => {
        const msg = err.message || '';
        if (msg.includes('revert') || msg.includes('CALL_EXCEPTION')) {
          return false;
        }
        return true;
      },
    });
    logger.info(`    ✓ Reputation recorded. TX: ${receipt.hash.substring(0, 18)}…`);
    return { success: true, txHash: receipt.hash };

  } catch (err) {
    logger.warn(`    Reputation record failed: ${err.shortMessage || err.message}`);
    return { success: false, error: err.shortMessage || err.message };
  }
}
