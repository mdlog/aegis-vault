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

    error OracleDeviationExceeded(uint256 fairMin, uint256 claimed);
    error OracleExpoMismatch(int32 expoIn, int32 expoOut);
    error OraclePriceNonPositive();

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
