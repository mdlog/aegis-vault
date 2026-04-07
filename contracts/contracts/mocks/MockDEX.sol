// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockDEX
 * @notice A simple AMM-like DEX for testing Aegis Vault execution flow.
 *         Supports fixed-rate swaps between whitelisted token pairs.
 *         NOT for production — this is a testing/demo tool.
 *
 *         In production, this is replaced by Jaine / 0G Hub swap routes.
 */
contract MockDEX {
    using SafeERC20 for IERC20;

    struct PairRate {
        uint256 rate;       // Price of tokenA in tokenB (scaled by 1e18)
        uint8 decimalsA;
        uint8 decimalsB;
        bool active;
    }

    address public owner;

    // pairKey => PairRate
    mapping(bytes32 => PairRate) public pairs;

    // Events
    event PairSet(address indexed tokenA, address indexed tokenB, uint256 rate);
    event Swapped(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    error PairNotActive();
    error InsufficientLiquidity();
    error ZeroAmount();
    error SlippageExceeded();
    error OnlyOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Set a swap rate for a token pair
    /// @param tokenA The "base" token
    /// @param tokenB The "quote" token
    /// @param rate Price of 1 unit of tokenA in tokenB (scaled by 1e18)
    /// @param decimalsA Decimals of tokenA
    /// @param decimalsB Decimals of tokenB
    function setPairRate(
        address tokenA,
        address tokenB,
        uint256 rate,
        uint8 decimalsA,
        uint8 decimalsB
    ) external onlyOwner {
        bytes32 key = _pairKey(tokenA, tokenB);
        pairs[key] = PairRate(rate, decimalsA, decimalsB, true);
        emit PairSet(tokenA, tokenB, rate);
    }

    /// @notice Execute a swap
    /// @param tokenIn The token being sold
    /// @param tokenOut The token being bought
    /// @param amountIn Amount of tokenIn to swap
    /// @param minAmountOut Minimum acceptable output (slippage protection)
    /// @return amountOut The actual output amount
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();

        // Look up pair rate
        bytes32 keyDirect = _pairKey(tokenIn, tokenOut);
        bytes32 keyReverse = _pairKey(tokenOut, tokenIn);

        PairRate memory pair;
        bool isReverse = false;

        if (pairs[keyDirect].active) {
            pair = pairs[keyDirect];
        } else if (pairs[keyReverse].active) {
            pair = pairs[keyReverse];
            isReverse = true;
        } else {
            revert PairNotActive();
        }

        // Calculate output
        if (!isReverse) {
            // tokenIn = tokenA, tokenOut = tokenB
            // amountOut = amountIn * rate / 1e18, adjusted for decimals
            amountOut = (amountIn * pair.rate) / 1e18;
            // Adjust for decimal difference
            if (pair.decimalsB > pair.decimalsA) {
                amountOut = amountOut * (10 ** (pair.decimalsB - pair.decimalsA));
            } else if (pair.decimalsA > pair.decimalsB) {
                amountOut = amountOut / (10 ** (pair.decimalsA - pair.decimalsB));
            }
        } else {
            // tokenIn = tokenB, tokenOut = tokenA (reverse direction)
            // amountOut = amountIn * 1e18 / rate, adjusted for decimals
            amountOut = (amountIn * 1e18) / pair.rate;
            if (pair.decimalsA > pair.decimalsB) {
                amountOut = amountOut * (10 ** (pair.decimalsA - pair.decimalsB));
            } else if (pair.decimalsB > pair.decimalsA) {
                amountOut = amountOut / (10 ** (pair.decimalsB - pair.decimalsA));
            }
        }

        if (amountOut < minAmountOut) revert SlippageExceeded();

        // Check DEX has enough liquidity
        uint256 dexBalance = IERC20(tokenOut).balanceOf(address(this));
        if (dexBalance < amountOut) revert InsufficientLiquidity();

        // Transfer tokenIn from sender to DEX
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Transfer tokenOut from DEX to sender
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);

        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @notice Get estimated output for a swap
    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        bytes32 keyDirect = _pairKey(tokenIn, tokenOut);
        bytes32 keyReverse = _pairKey(tokenOut, tokenIn);

        PairRate memory pair;
        bool isReverse = false;

        if (pairs[keyDirect].active) {
            pair = pairs[keyDirect];
        } else if (pairs[keyReverse].active) {
            pair = pairs[keyReverse];
            isReverse = true;
        } else {
            return 0;
        }

        if (!isReverse) {
            amountOut = (amountIn * pair.rate) / 1e18;
            if (pair.decimalsB > pair.decimalsA) {
                amountOut = amountOut * (10 ** (pair.decimalsB - pair.decimalsA));
            } else if (pair.decimalsA > pair.decimalsB) {
                amountOut = amountOut / (10 ** (pair.decimalsA - pair.decimalsB));
            }
        } else {
            amountOut = (amountIn * 1e18) / pair.rate;
            if (pair.decimalsA > pair.decimalsB) {
                amountOut = amountOut * (10 ** (pair.decimalsA - pair.decimalsB));
            } else if (pair.decimalsB > pair.decimalsA) {
                amountOut = amountOut / (10 ** (pair.decimalsB - pair.decimalsA));
            }
        }
    }

    /// @notice Add liquidity (just transfer tokens in for the DEX to use)
    function addLiquidity(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    function _pairKey(address a, address b) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(a, b));
    }
}
