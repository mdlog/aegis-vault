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
    error PositionTooLarge(uint256 amountIn, uint256 capBps);

    uint256 internal constant BPS_DENOM = 10_000;

    // ── EIP-712 ──
    bytes32 internal constant EXECUTION_INTENT_TYPEHASH = keccak256(
        "ExecutionIntent(address vault,address assetIn,address assetOut,uint256 amountIn,uint256 minAmountOut,uint256 createdAt,uint256 expiresAt,uint256 confidenceBps,uint256 riskScoreBps,bytes32 attestationReportHash)"
    );
    bytes32 internal constant DOMAIN_TYPE_HASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 internal constant NAME_HASH    = keccak256("AegisVault");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPE_HASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function computeIntentHash(ExecutionIntent calldata intent) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            EXECUTION_INTENT_TYPEHASH,
            intent.vault, intent.assetIn, intent.assetOut,
            intent.amountIn, intent.minAmountOut,
            intent.createdAt, intent.expiresAt,
            intent.confidenceBps, intent.riskScoreBps,
            intent.attestationReportHash
        ));
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    /// @notice Inline policy + hash + swap pipeline. DELEGATECALL'd from vault.
    /// @dev allowedAssets is passed from vault storage (_allowedAssets) so the
    ///      whitelist check runs against the exact policy-committed list, not
    ///      against any list the caller could control.
    ///
    ///      Policy enforcement scope (on-chain, here):
    ///        - expiresAt              : intent expiry
    ///        - cooldownSeconds        : min time between executions
    ///        - confidenceThresholdBps : min AI confidence
    ///        - maxActionsPerDay       : per-24h action cap
    ///        - allowedAssets          : whitelist for both legs of the swap
    ///        - maxPositionBps         : single-trade size cap as a fraction of
    ///                                    totalDeposited (defensive trade-size
    ///                                    cap; full allocation enforcement
    ///                                    requires a NAV oracle and is the
    ///                                    orchestrator risk-veto's job).
    ///
    ///      Off-chain enforced (orchestrator risk veto + emergency `pause()`):
    ///        - maxDailyLossBps : 24h drawdown halt
    ///        - stopLossBps     : NAV-relative stop-loss
    ///      These fields are exposed in policy for transparency / governance
    ///      but their on-chain enforcement requires per-vault PnL state that
    ///      the v3 storage layout does not yet carry.
    function runExecution(
        ExecutionIntent calldata intent,
        VaultPolicy memory _policy,
        address[] memory allowedAssets,
        address venue,
        address baseAssetAddr,
        address registryAddr,
        uint256 lastExecutionTime,
        uint256 dailyActionCount,
        uint256 totalDeposited
    ) external returns (uint256 amountOut, bool success) {
        // EIP-712 hash check
        require(computeIntentHash(intent) == intent.intentHash, "hash");

        // Inline essential policy checks (shorter than PolicyLibrary.validateAll)
        require(block.timestamp <= intent.expiresAt, "expired");
        require(block.timestamp >= lastExecutionTime + _policy.cooldownSeconds, "cooldown");
        require(intent.confidenceBps >= _policy.confidenceThresholdBps, "conf");
        require(dailyActionCount < _policy.maxActionsPerDay, "actions");
        require(IERC20(intent.assetIn).balanceOf(address(this)) >= intent.amountIn, "tokIn");

        // maxPositionBps as defensive trade-size cap. We treat this as a
        // ceiling on `intent.amountIn` relative to the vault's principal
        // (`totalDeposited`). Skipped when totalDeposited == 0 (a vault that
        // hasn't received its first deposit cannot meaningfully bound trade
        // size yet). The orchestrator risk veto enforces the more accurate
        // NAV-relative variant off-chain.
        if (_policy.maxPositionBps != 0 && totalDeposited != 0) {
            uint256 cap = (totalDeposited * _policy.maxPositionBps) / BPS_DENOM;
            if (intent.amountIn > cap) revert PositionTooLarge(intent.amountIn, _policy.maxPositionBps);
        }

        // Asset whitelist enforcement (Finding 1 fix — both sides of the swap
        // must appear in the vault's policy-committed allowedAssets list).
        bool inOk;
        bool outOk;
        for (uint256 i = 0; i < allowedAssets.length; i++) {
            if (allowedAssets[i] == intent.assetIn)  inOk  = true;
            if (allowedAssets[i] == intent.assetOut) outOk = true;
        }
        require(inOk, "assetIn!wl");
        require(outOk, "assetOut!wl");

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
        // Measure-before / measure-after is the standard AMM swap pattern: we
        // read balances, call the venue, then compute actuals from the delta.
        // No state writes happen between the reads and the call, and the
        // `require(balanceOf < tokenInBefore)` check below rejects any
        // post-call tampering. `venue` is the vault's configured adapter
        // (not user-controlled).
        // slither-disable-next-line reentrancy-balance
        uint256 tokenOutBefore = IERC20(tokenOut).balanceOf(address(this));
        // slither-disable-next-line reentrancy-balance
        uint256 tokenInBefore = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(venue, amountIn);
        (bool ok, bytes memory ret) = venue.call(abi.encodeWithSignature("swap(address,address,uint256,uint256)", tokenIn, tokenOut, amountIn, minAmountOut));
        IERC20(tokenIn).forceApprove(venue, 0);
        // Bubble up the venue's revert reason. Previously we silently returned 0
        // which caused the top-level tx to succeed with success=false, making
        // failed swaps look identical to executed ones in off-chain logs.
        if (!ok) {
            if (ret.length > 0) {
                assembly { revert(add(ret, 0x20), mload(ret)) }
            }
            revert("venue swap failed");
        }
        uint256 tokenOutAfter = IERC20(tokenOut).balanceOf(address(this));
        amountOut = tokenOutAfter - tokenOutBefore;
        require(IERC20(tokenIn).balanceOf(address(this)) < tokenInBefore, "swap mismatch");
        require(amountOut >= minAmountOut, "slippage");
    }

}
