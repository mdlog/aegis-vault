// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title VaultEvents
 * @notice Shared event and struct definitions for the Aegis Vault system.
 *
 *         Production-grade with operator economics:
 *           - HWM-protected performance fee
 *           - Streaming management fee
 *           - Entry/exit fees
 *           - Protocol fee split
 */

// ── Data Structures ──

struct VaultPolicy {
    // Risk policy
    uint256 maxPositionBps;          // Max single-asset allocation (e.g. 5000 = 50%)
    uint256 maxDailyLossBps;         // Max daily loss in basis points
    uint256 stopLossBps;             // Global stop-loss threshold
    uint256 cooldownSeconds;         // Min seconds between executions
    uint256 confidenceThresholdBps;  // Min AI confidence required
    uint256 maxActionsPerDay;        // Max executions per 24h
    bool    autoExecution;           // AI auto-execute enabled
    bool    paused;                  // Emergency pause state

    // ── Phase 1: Operator Economics ──
    uint256 performanceFeeBps;       // % of profit above HWM (max 3000 = 30%)
    uint256 managementFeeBps;        // %/year of NAV (max 500 = 5%)
    uint256 entryFeeBps;             // % of deposit (max 200 = 2%)
    uint256 exitFeeBps;              // % of withdrawal (max 200 = 2%)
    address feeRecipient;            // Operator wallet receiving fees

    // ── Track 2: Sealed Strategy Mode (TEE attestation + commit-reveal) ──
    bool    sealedMode;              // When true: require TEE attestation sig + commit-reveal
    address attestedSigner;          // ECDSA signer key bound to TEE-attested 0G Compute pipeline
}

struct ExecutionIntent {
    bytes32 intentHash;
    address vault;
    address assetIn;
    address assetOut;
    uint256 amountIn;
    uint256 minAmountOut;
    uint256 createdAt;
    uint256 expiresAt;
    uint256 confidenceBps;
    uint256 riskScoreBps;
    bytes32 attestationReportHash;   // Track 2: hash of TEE attestation report (provider/chatId/content)
    string  reasonSummary;
}

struct ExecutionResult {
    bytes32 intentHash;
    bytes32 venueTxRef;
    uint256 amountIn;
    uint256 amountOut;
    uint256 executedAt;
    bool    success;
}

// Pending fee changes (Phase 4: cooldown protection)
struct PendingFeeChange {
    uint256 newPerformanceFeeBps;
    uint256 newManagementFeeBps;
    uint256 newEntryFeeBps;
    uint256 newExitFeeBps;
    uint256 effectiveAt;
    bool    pending;
}

// ── Events ──

library VaultEvents {
    // Vault lifecycle
    event VaultCreated(address indexed vault, address indexed owner, address baseAsset);
    event VaultPaused(address indexed vault, address indexed triggeredBy);
    event VaultUnpaused(address indexed vault, address indexed triggeredBy);

    // Capital flow
    event Deposited(address indexed vault, address indexed depositor, uint256 amount);
    event WithdrawRequested(address indexed vault, address indexed owner, uint256 amount);
    event Withdrawn(address indexed vault, address indexed owner, uint256 amount);

    // Policy
    event PolicyUpdated(address indexed vault, address indexed updatedBy);
    event AllowedAssetsUpdated(address indexed vault, address indexed updatedBy, uint256 assetCount);
    event ExecutorUpdated(address indexed vault, address indexed oldExecutor, address indexed newExecutor);
    event VenueUpdated(address indexed vault, address indexed oldVenue, address indexed newVenue);

    // Execution
    event IntentSubmitted(address indexed vault, bytes32 indexed intentHash, address assetIn, address assetOut, uint256 amountIn);
    event IntentExecuted(address indexed vault, bytes32 indexed intentHash, uint256 amountIn, uint256 amountOut, bool success);
    event IntentBlocked(address indexed vault, bytes32 indexed intentHash, string reason);
    event IntentExpired(address indexed vault, bytes32 indexed intentHash);

    // Track 2: Sealed Mode commit-reveal + attestation
    event IntentCommitted(address indexed vault, bytes32 indexed commitHash, uint256 commitBlock);
    event SealedIntentExecuted(address indexed vault, bytes32 indexed intentHash, address indexed attestedSigner, bytes32 attestationReportHash);

    // Risk
    event RiskThresholdBreached(address indexed vault, string riskType, uint256 currentValue, uint256 limitValue);
    event EmergencyWithdraw(address indexed vault, address indexed owner, uint256 amount);

    // ── Phase 1: Fee Events ──
    event FeeAccrued(address indexed vault, uint256 managementFee, uint256 performanceFee, uint256 newHwm);
    event FeesClaimed(address indexed vault, address indexed operator, uint256 operatorAmount, uint256 protocolAmount);
    event EntryFeeCharged(address indexed vault, address indexed depositor, uint256 grossAmount, uint256 fee);
    event ExitFeeCharged(address indexed vault, address indexed owner, uint256 grossAmount, uint256 fee);
    event HighWaterMarkUpdated(address indexed vault, uint256 oldHwm, uint256 newHwm);
    event FeeRecipientUpdated(address indexed vault, address indexed oldRecipient, address indexed newRecipient);
    event FeeChangeQueued(address indexed vault, uint256 effectiveAt);
    event FeeChangeApplied(address indexed vault);

    // ── Phase 5: Reputation recording ──
    event ReputationRecorderUpdated(address indexed vault, address indexed newRecorder);

    // ── Phase 5 / KillCritic: Edge case events ──
    /// @notice Emitted when accrued operator fees are forfeited because vault balance is insufficient
    event AccruedFeesForfeited(address indexed vault, uint256 vaultBalance);
}
