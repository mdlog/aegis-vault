// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @notice Test helper that pretends to be Uniswap V3 SwapRouter02.
 *         Pulls tokenIn from msg.sender, sends a configurable rate of tokenOut
 *         to recipient. Used in unit tests to simulate the real router behavior
 *         without forking Arbitrum.
 */
contract MockSwapRouter02 {
    using SafeERC20 for IERC20;

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Configurable rate: amountOut = amountIn * rateOutPerInBps / 10000
    /// Default 1:1 (10000 bps)
    uint256 public rateBps = 10000;
    /// @notice Set to true to make the next swap revert (for testing failure paths)
    bool public failNext;

    function setRate(uint256 _rateBps) external { rateBps = _rateBps; }
    function setFailNext(bool _fail) external { failNext = _fail; }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        if (failNext) {
            failNext = false;
            revert("MockSwapRouter02: forced fail");
        }

        // Pull tokenIn from caller
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);

        // Calculate output
        amountOut = (params.amountIn * rateBps) / 10000;

        require(amountOut >= params.amountOutMinimum, "MockSwapRouter02: insufficient output");

        // Send tokenOut to recipient (must have been pre-funded)
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
    }
}
