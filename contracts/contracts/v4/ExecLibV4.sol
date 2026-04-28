// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../VaultEvents.sol";
import "../ExecutionRegistry.sol";

/**
 * @title ExecLibV4
 * @notice External library for V4 vault on-chain execution. Functionally a
 *         drop-in replacement for `ExecLib` (DELEGATECALL'd from
 *         AegisVault_v4) that swaps the V3 `ExecutionIntent` for a V4-only
 *         struct carrying two extra fields:
 *
 *           - `bytes32 strategyHash`        — keccak256 of the canonical-JSON
 *                                             strategy manifest the orchestrator
 *                                             used to derive this intent.
 *                                             Bound on-chain to
 *                                             `AegisVault_v4.acceptedManifestHash`
 *                                             so any deviation by the
 *                                             orchestrator is cryptographically
 *                                             detectable at the vault gate.
 *           - `uint32  strategySchemaVer`   — the schema version the manifest
 *                                             was authored against. Vault
 *                                             rejects intents whose schema is
 *                                             newer than the implementation
 *                                             knows how to enforce.
 *
 *         The new typehash threads both fields into the EIP-712 struct so
 *         signatures cover the strategy commitment alongside the rest of
 *         the intent — replay across vaults bound to different strategies
 *         is impossible by construction.
 *
 *         The IOLib + SealedLib helpers are unchanged and are linked into
 *         AegisVault_v4 directly (no V4 fork needed for those libs — the
 *         deposit/withdraw/attestation pipelines did not change shape).
 */
library ExecLibV4 {
    using SafeERC20 for IERC20;

    error SwapOutputMismatch();
    error SlippageTooHigh(uint256 minRequired, uint256 actual);
    error PositionTooLarge(uint256 amountIn, uint256 capBps);

    uint256 internal constant BPS_DENOM = 10_000;

    // ── V4 ExecutionIntent ──
    //
    //   Mirrors VaultEvents.ExecutionIntent (V3) and appends `strategyHash` +
    //   `strategySchemaVer`. Declared here (not in VaultEvents) so the V3
    //   struct stays untouched and V3 callers see no ABI shift.
    struct ExecutionIntentV4 {
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
        bytes32 attestationReportHash;
        bytes32 strategyHash;
        uint32  strategySchemaVer;
        string  reasonSummary;
    }

    // ── EIP-712 ──
    //
    //   Field order MUST match the struct exactly (off `intentHash` and
    //   `reasonSummary`, both of which are derived/free-form and therefore
    //   not part of the type encoding — same convention V3 uses).
    bytes32 internal constant EXECUTION_INTENT_TYPEHASH_V4 = keccak256(
        "ExecutionIntent(address vault,address assetIn,address assetOut,uint256 amountIn,uint256 minAmountOut,uint256 createdAt,uint256 expiresAt,uint256 confidenceBps,uint256 riskScoreBps,bytes32 attestationReportHash,bytes32 strategyHash,uint32 strategySchemaVer)"
    );
    bytes32 internal constant DOMAIN_TYPE_HASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    // Reuse the V3 domain identity ("AegisVault" / "1") so off-chain signers
    // do not need a second keystore namespace per chain. The version field
    // here is the EIP-712 domain version (frozen at "1" since v1) — distinct
    // from the vault contract `version()` view ("v3" / "v4").
    bytes32 internal constant NAME_HASH    = keccak256("AegisVault");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPE_HASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    /// @notice Compute the EIP-712 digest for a V4 execution intent.
    function computeIntentHash(ExecutionIntentV4 calldata intent) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            EXECUTION_INTENT_TYPEHASH_V4,
            intent.vault, intent.assetIn, intent.assetOut,
            intent.amountIn, intent.minAmountOut,
            intent.createdAt, intent.expiresAt,
            intent.confidenceBps, intent.riskScoreBps,
            intent.attestationReportHash,
            intent.strategyHash,
            intent.strategySchemaVer
        ));
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    /// @notice Inline policy + hash + swap pipeline for V4 intents.
    /// @dev    See ExecLib.runExecution for the full annotation of which
    ///         policy fields are enforced on-chain vs off-chain. The V4
    ///         override changes nothing about that contract — only the
    ///         struct shape passed in is different.
    function runExecution(
        ExecutionIntentV4 calldata intent,
        VaultPolicy memory _policy,
        address[] memory allowedAssets,
        address venue,
        address /* baseAssetAddr */,
        address registryAddr,
        uint256 lastExecutionTime,
        uint256 dailyActionCount,
        uint256 totalDeposited
    ) external returns (uint256 amountOut, bool success) {
        // EIP-712 hash check
        require(computeIntentHash(intent) == intent.intentHash, "hash");

        // Inline essential policy checks (mirror of V3)
        require(block.timestamp <= intent.expiresAt, "expired");
        require(block.timestamp >= lastExecutionTime + _policy.cooldownSeconds, "cooldown");
        require(intent.confidenceBps >= _policy.confidenceThresholdBps, "conf");
        require(dailyActionCount < _policy.maxActionsPerDay, "actions");
        require(IERC20(intent.assetIn).balanceOf(address(this)) >= intent.amountIn, "tokIn");

        // maxPositionBps trade-size cap (skipped when totalDeposited == 0).
        if (_policy.maxPositionBps != 0 && totalDeposited != 0) {
            uint256 cap = (totalDeposited * _policy.maxPositionBps) / BPS_DENOM;
            if (intent.amountIn > cap) revert PositionTooLarge(intent.amountIn, _policy.maxPositionBps);
        }

        // Asset whitelist enforcement on both legs.
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
        // Standard measure-before / measure-after AMM swap. See ExecLib._swap
        // for the full annotation; the V4 fork keeps the implementation
        // identical because the venue interface did not change.
        // slither-disable-next-line reentrancy-balance
        uint256 tokenOutBefore = IERC20(tokenOut).balanceOf(address(this));
        // slither-disable-next-line reentrancy-balance
        uint256 tokenInBefore = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(venue, amountIn);
        (bool ok, bytes memory ret) = venue.call(abi.encodeWithSignature("swap(address,address,uint256,uint256)", tokenIn, tokenOut, amountIn, minAmountOut));
        IERC20(tokenIn).forceApprove(venue, 0);
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
