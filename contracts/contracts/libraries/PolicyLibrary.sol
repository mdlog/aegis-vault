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

    /// @notice Validates that the daily loss limit has not been exceeded
    /// @param currentDailyLossBps Current daily loss in basis points
    /// @param maxDailyLossBps Maximum daily loss allowed
    function validateDailyLoss(
        uint256 currentDailyLossBps,
        uint256 maxDailyLossBps
    ) internal pure returns (bool valid, string memory reason) {
        if (currentDailyLossBps > maxDailyLossBps) {
            return (false, "Daily loss limit exceeded");
        }
        return (true, "");
    }

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

    /// @notice Runs all policy checks and returns the first failure reason
    function validateAll(
        VaultPolicy memory _policy,
        uint256 intentAmountIn,
        uint256 vaultTotalValue,
        uint256 lastExecutionTime,
        uint256 currentDailyLossBps,
        uint256 intentExpiresAt,
        uint256 intentConfidenceBps,
        uint256 dailyActionCount,
        address assetIn,
        address assetOut,
        address baseAsset,
        uint256 tokenInBalance,
        address[] memory allowedAssets
    ) external view returns (bool valid, string memory reason) {
        bool isSellToBase = assetOut == baseAsset && assetIn != baseAsset;

        // 1. Not paused
        (valid, reason) = validateNotPaused(_policy.paused);
        if (!valid) return (valid, reason);

        // 2. Intent not expired
        (valid, reason) = validateIntentExpiry(intentExpiresAt);
        if (!valid) return (valid, reason);

        // 3. Cooldown
        (valid, reason) = validateCooldown(lastExecutionTime, _policy.cooldownSeconds);
        if (!valid) return (valid, reason);

        // 4. Token balance
        (valid, reason) = validateAvailableBalance(intentAmountIn, tokenInBalance);
        if (!valid) return (valid, reason);

        // 5. Entry-only sizing checks.
        // Exits are validated against the actual tokenIn balance above and should
        // remain possible even when the vault is fully rotated out of the base asset.
        if (!isSellToBase) {
            (valid, reason) = validatePositionSize(intentAmountIn, vaultTotalValue, _policy.maxPositionBps);
            if (!valid) return (valid, reason);

            (valid, reason) = validateMinTradeSize(intentAmountIn, vaultTotalValue);
            if (!valid) return (valid, reason);
        }

        // 6. Daily loss
        (valid, reason) = validateDailyLoss(currentDailyLossBps, _policy.maxDailyLossBps);
        if (!valid) return (valid, reason);

        // 7. Confidence
        (valid, reason) = validateConfidence(intentConfidenceBps, _policy.confidenceThresholdBps);
        if (!valid) return (valid, reason);

        // 8. Action count
        (valid, reason) = validateActionCount(dailyActionCount, _policy.maxActionsPerDay);
        if (!valid) return (valid, reason);

        // 9. Asset whitelist (assetIn)
        (valid, reason) = validateAssetWhitelist(assetIn, allowedAssets);
        if (!valid) return (false, "AssetIn not in whitelist");

        // 10. Asset whitelist (assetOut)
        (valid, reason) = validateAssetWhitelist(assetOut, allowedAssets);
        if (!valid) return (false, "AssetOut not in whitelist");

        return (true, "");
    }
}
