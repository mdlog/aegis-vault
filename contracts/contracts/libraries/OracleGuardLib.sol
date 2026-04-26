// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/**
 * @title OracleGuardLib
 * @notice Stateless swap-deviation check against Pyth oracle prices.
 *         Venue adapters call checkDeviation() before forwarding a swap to
 *         the underlying DEX. If the AI-supplied minAmountOut is more than
 *         maxSlippageBps below the oracle-derived fair value, the call
 *         reverts — defense against hallucinated slippage caught before
 *         tokens move.
 */
library OracleGuardLib {
    uint256 internal constant BPS_DENOM = 10_000;
    uint256 internal constant MAX_PRICE_AGE = 300; // 5 minutes

    /// @notice Reject Pyth quotes whose 1-sigma confidence band exceeds this
    ///         fraction of the price. 500 = 5% — matches VaultNAVCalculator.
    ///         A degraded feed (wide band) cannot be used to bound slippage:
    ///         the "fair" value is itself uncertain, so an AI minAmountOut
    ///         that looked safe against the midpoint could in reality clear a
    ///         price several percent away. Failing closed here is the
    ///         expected production behaviour — venues catch it and abort.
    uint256 internal constant MAX_CONF_BPS = 500;

    error OracleDeviationExceeded(uint256 fairMin, uint256 claimed);
    error OracleExpoMismatch(int32 expoIn, int32 expoOut);
    error OraclePriceNonPositive();
    error OracleLowConfidence(bytes32 feedId, uint64 conf, uint256 price);

    /// @notice Revert if minAmountOut is below fair oracle output by more than maxSlippageBps.
    /// @dev Assumes feedIn/feedOut share a common denomination (typically USD) so the
    ///      price ratio cancels to a tokenOut-per-tokenIn quote. Requires matching
    ///      expos — virtually always true for Pyth USD feeds (expo = -8).
    function checkDeviation(
        IPyth pyth,
        bytes32 feedIn,
        bytes32 feedOut,
        uint8 decimalsIn,
        uint8 decimalsOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint16 maxSlippageBps
    ) internal view {
        PythStructs.Price memory pIn  = pyth.getPriceNoOlderThan(feedIn, MAX_PRICE_AGE);
        PythStructs.Price memory pOut = pyth.getPriceNoOlderThan(feedOut, MAX_PRICE_AGE);

        if (pIn.price <= 0 || pOut.price <= 0) revert OraclePriceNonPositive();
        if (pIn.expo != pOut.expo) revert OracleExpoMismatch(pIn.expo, pOut.expo);

        uint256 priceInAbs  = uint256(uint64(pIn.price));
        uint256 priceOutAbs = uint256(uint64(pOut.price));

        // Reject feeds whose confidence interval exceeds MAX_CONF_BPS of price.
        // Pyth `conf` is the 1-sigma uncertainty around `price`; a wide band
        // means the "fair" value is itself unknowable to the precision we
        // need for a slippage decision. Both sides must pass.
        uint256 confInLimit  = (priceInAbs  * MAX_CONF_BPS) / BPS_DENOM;
        uint256 confOutLimit = (priceOutAbs * MAX_CONF_BPS) / BPS_DENOM;
        if (uint256(pIn.conf)  > confInLimit)  revert OracleLowConfidence(feedIn,  pIn.conf,  priceInAbs);
        if (uint256(pOut.conf) > confOutLimit) revert OracleLowConfidence(feedOut, pOut.conf, priceOutAbs);

        // fairOut = amountIn * (priceIn / priceOut) * 10^(decimalsOut - decimalsIn)
        // Expos cancel because we required pIn.expo == pOut.expo.
        uint256 fairOut;
        if (decimalsOut >= decimalsIn) {
            fairOut = (amountIn * priceInAbs * (10 ** (decimalsOut - decimalsIn))) / priceOutAbs;
        } else {
            fairOut = (amountIn * priceInAbs) / (priceOutAbs * (10 ** (decimalsIn - decimalsOut)));
        }

        uint256 minAcceptable = (fairOut * (BPS_DENOM - maxSlippageBps)) / BPS_DENOM;
        if (minAmountOut < minAcceptable) revert OracleDeviationExceeded(minAcceptable, minAmountOut);
    }
}
