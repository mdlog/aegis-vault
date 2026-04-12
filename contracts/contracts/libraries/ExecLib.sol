// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../VaultEvents.sol";
import "../ExecutionRegistry.sol";

/**
 * @title ExecLib
 * @notice External library for vault execution helpers. DELEGATECALL'd from AegisVault
 *         so the heavy swap + sealed-mode bytecode lives outside the implementation,
 *         keeping it small enough to fit 0G mainnet's per-block gas limit.
 */
library ExecLib {
    using SafeERC20 for IERC20;

    error SwapOutputMismatch();
    error SlippageTooHigh(uint256 minRequired, uint256 actual);

    // verifyAttestation moved to SealedLib for size budget on 0G mainnet.

    /// @notice Inline policy + hash + swap pipeline. DELEGATECALL'd from vault.
    ///         Slim build: policy checks reduced to essentials with short revert messages.
    function runExecution(
        ExecutionIntent calldata intent,
        VaultPolicy memory _policy,
        address venue,
        address baseAssetAddr,
        address registryAddr,
        uint256 lastExecutionTime,
        uint256 dailyActionCount
    ) external returns (uint256 amountOut, bool success) {
        // Hash check
        require(keccak256(abi.encode(
            intent.vault, intent.assetIn, intent.assetOut,
            intent.amountIn, intent.minAmountOut,
            intent.createdAt, intent.expiresAt,
            intent.confidenceBps, intent.riskScoreBps,
            intent.attestationReportHash
        )) == intent.intentHash, "hash");

        // Inline essential policy checks (shorter than PolicyLibrary.validateAll)
        require(block.timestamp <= intent.expiresAt, "expired");
        require(block.timestamp >= lastExecutionTime + _policy.cooldownSeconds, "cooldown");
        require(intent.confidenceBps >= _policy.confidenceThresholdBps, "conf");
        require(dailyActionCount < _policy.maxActionsPerDay, "actions");
        require(IERC20(intent.assetIn).balanceOf(address(this)) >= intent.amountIn, "tokIn");

        ExecutionRegistry(registryAddr).registerIntent(intent.intentHash, address(this));
        emit VaultEvents.IntentSubmitted(address(this), intent.intentHash, intent.assetIn, intent.assetOut, intent.amountIn);

        require(!(venue != address(0) && intent.amountIn > 0 && intent.minAmountOut == 0), "minOut");

        amountOut = 0;
        if (venue != address(0) && intent.amountIn > 0) {
            amountOut = _swap(venue, intent.assetIn, intent.assetOut, intent.amountIn, intent.minAmountOut);
        }

        success = amountOut > 0 || venue == address(0);
        ExecutionResult memory result = ExecutionResult({
            intentHash: intent.intentHash,
            venueTxRef: bytes32(uint256(uint160(venue))),
            amountIn: intent.amountIn,
            amountOut: amountOut,
            executedAt: block.timestamp,
            success: success
        });
        ExecutionRegistry(registryAddr).finalizeIntent(result);
        emit VaultEvents.IntentExecuted(address(this), intent.intentHash, intent.amountIn, amountOut, success);
    }

    function _swap(address venue, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) private returns (uint256 amountOut) {
        uint256 tokenOutBefore = IERC20(tokenOut).balanceOf(address(this));
        uint256 tokenInBefore = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(venue, amountIn);
        (bool ok, ) = venue.call(abi.encodeWithSignature("swap(address,address,uint256,uint256)", tokenIn, tokenOut, amountIn, minAmountOut));
        IERC20(tokenIn).forceApprove(venue, 0);
        if (!ok) return 0;
        uint256 tokenOutAfter = IERC20(tokenOut).balanceOf(address(this));
        amountOut = tokenOutAfter - tokenOutBefore;
        require(IERC20(tokenIn).balanceOf(address(this)) < tokenInBefore, "swap mismatch");
        if (amountOut == 0) return 0;
        require(amountOut >= minAmountOut, "slippage");
    }

}
