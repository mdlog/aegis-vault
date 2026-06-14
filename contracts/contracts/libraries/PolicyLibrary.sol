// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../VaultEvents.sol";

/**
 * @title PolicyLibrary
 * @notice Pure validation functions for vault policy enforcement.
 *         Every check is stateless — state is passed in from the vault contract.
 */
library PolicyLibrary {
    /// @notice Validates that the intent does not exceed max position size
    /// @param intentAmountIn The amount of the incoming trade
    /// @param vaultTotalValue The total NAV of the vault
    /// @param maxPositionBps Maximum allowed position in basis points
    function validatePositionSize(
        uint256 intentAmountIn,
        uint256 vaultTotalValue,
        uint256 maxPositionBps
    ) internal pure returns (bool valid, string memory reason) {
        if (vaultTotalValue == 0) {
            return (false, "Vault has no value");
        }
        uint256 positionBps = (intentAmountIn * 10000) / vaultTotalValue;
        if (positionBps > maxPositionBps) {
            return (false, "Position size exceeds max limit");
        }
        return (true, "");
    }

    /// @notice Validates that the vault actually holds enough of tokenIn
    function validateAvailableBalance(
        uint256 intentAmountIn,
        uint256 availableBalance
    ) internal pure returns (bool valid, string memory reason) {
        if (intentAmountIn > availableBalance) {
            return (false, "Insufficient token balance");
        }
        return (true, "");
    }

    /// @notice Validates that cooldown period has elapsed since last execution
    /// @param lastExecutionTime Timestamp of last execution
    /// @param cooldownSeconds Required cooldown in seconds
    function validateCooldown(
        uint256 lastExecutionTime,
        uint256 cooldownSeconds
    ) internal view returns (bool valid, string memory reason) {
        if (block.timestamp < lastExecutionTime + cooldownSeconds) {
            return (false, "Cooldown period not elapsed");
        }
        return (true, "");
    }

    /// @notice Validates that the asset is in the allowed whitelist
    /// @param asset The asset address to check
    /// @param allowedAssets Array of whitelisted asset addresses
    function validateAssetWhitelist(
        address asset,
        address[] memory allowedAssets
    ) internal pure returns (bool valid, string memory reason) {
        for (uint256 i = 0; i < allowedAssets.length; i++) {
            if (allowedAssets[i] == asset) {
                return (true, "");
            }
        }
        return (false, "Asset not in whitelist");
    }

    // NOTE: validateDailyLoss / validateAll were removed (Post-TEE remediation
    // P0-5). They were never wired into any executeIntent path — the live gate
    // is ExecLib(V4).runExecution, which enforces trade-shape only. Daily-loss /
    // stop-loss are enforced OFF-CHAIN by the orchestrator risk veto
    // (see orchestrator/src/services/riskVeto.js). Keeping a dead on-chain
    // validator here falsely implied on-chain loss enforcement.

    /// @notice Validates that the intent has not expired
    /// @param expiresAt The expiry timestamp of the intent
    function validateIntentExpiry(
        uint256 expiresAt
    ) internal view returns (bool valid, string memory reason) {
        if (block.timestamp > expiresAt) {
            return (false, "Intent has expired");
        }
        return (true, "");
    }

    /// @notice Validates that the vault is not paused
    /// @param isPaused Current pause state
    function validateNotPaused(
        bool isPaused
    ) internal pure returns (bool valid, string memory reason) {
        if (isPaused) {
            return (false, "Vault is paused");
        }
        return (true, "");
    }

    /// @notice Validates that AI confidence meets minimum threshold
    /// @param confidenceBps Confidence score in basis points
    /// @param thresholdBps Minimum confidence threshold
    function validateConfidence(
        uint256 confidenceBps,
        uint256 thresholdBps
    ) internal pure returns (bool valid, string memory reason) {
        if (confidenceBps < thresholdBps) {
            return (false, "Confidence below threshold");
        }
        return (true, "");
    }

    /// @notice Validates that daily action count has not been exceeded
    /// @param currentActions Number of actions today
    /// @param maxActions Maximum allowed per day
    function validateActionCount(
        uint256 currentActions,
        uint256 maxActions
    ) internal pure returns (bool valid, string memory reason) {
        if (currentActions >= maxActions) {
            return (false, "Max daily actions exceeded");
        }
        return (true, "");
    }

    /// @notice Fix F2: Validates minimum trade size to prevent micro-churn
    /// @dev Trades must be at least 100 bps (1%) of vault value to prevent dust trades
    uint256 constant MIN_TRADE_BPS = 100; // 1% minimum

    function validateMinTradeSize(
        uint256 intentAmountIn,
        uint256 vaultTotalValue
    ) internal pure returns (bool valid, string memory reason) {
        if (vaultTotalValue == 0) return (true, "");
        uint256 tradeBps = (intentAmountIn * 10000) / vaultTotalValue;
        if (tradeBps < MIN_TRADE_BPS) {
            return (false, "Trade size below minimum (1%)");
        }
        return (true, "");
    }
}
