// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title JaineVenueAdapter
 * @notice Adapter that bridges AegisVault's venue interface to Jaine DEX (Uniswap V3 SwapRouter).
 *
 *         AegisVault calls:  swap(tokenIn, tokenOut, amountIn, minAmountOut)
 *         This adapter calls: JaineRouter.exactInputSingle(...)
 *
 *         Token flow:
 *           1. Vault approves adapter for amountIn (via forceApprove in _executeSwapViaVenue)
 *           2. Adapter pulls tokenIn from vault via safeTransferFrom
 *           3. Adapter approves Jaine Router for amountIn
 *           4. Jaine Router swaps and sends tokenOut directly to vault (recipient = vault)
 *           5. Adapter resets Router approval to 0
 *           6. If anything reverts, entire call reverts → vault sees success=false, no tokens lost
 *
 *         Security fixes:
 *           F-1: _findPoolWithLiquidity correctly handles pools with zero in-range liquidity
 *           F-2: tokenIn != tokenOut validation
 *           F-3: feeTiers array capped at MAX_FEE_TIERS to prevent gas DoS
 *           F-4: rescueTokens for stuck token recovery
 *           F-5: nonReentrant on swap
 *
 *         Deployed on 0G Mainnet (Aristotle, chain 16661).
 *         Jaine SwapRouter: 0x8b598a7c136215a95ba0282b4d832b9f9801f2e2
 *         Jaine Factory:    0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4
 *         W0G (WETH9):      0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c
 */

/// @notice Minimal Uniswap V3 SwapRouter interface
interface IJaineSwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

/// @notice Minimal Uniswap V3 Factory interface for pool lookup
interface IJaineFactory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

/// @notice Minimal Uniswap V3 Pool interface for liquidity check and price
interface IJainePool {
    function liquidity() external view returns (uint128);
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24  tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8  feeProtocol,
            bool   unlocked
        );
    function token0() external view returns (address);
    function token1() external view returns (address);
}

contract JaineVenueAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ──
    uint256 public constant MAX_FEE_TIERS = 10; // F-3: cap to prevent gas DoS

    // ── Immutables ──
    IJaineSwapRouter public immutable router;
    IJaineFactory public immutable factory;
    address public owner;

    // ── Fee tiers to try (Uniswap V3 standard) ──
    uint24[] public feeTiers;

    // ── Events ──
    event Swapped(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint24 fee
    );

    // ── Errors ──
    error NoPoolFound(address tokenIn, address tokenOut);
    error SwapFailed();
    error OnlyOwner();
    error ZeroAmount();
    error ZeroAddress();
    error SameToken();
    error TooManyFeeTiers();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address _router, address _factory) {
        if (_router == address(0) || _factory == address(0)) revert ZeroAddress();
        router = IJaineSwapRouter(_router);
        factory = IJaineFactory(_factory);
        owner = msg.sender;

        // Standard Uniswap V3 fee tiers: 0.01%, 0.05%, 0.3%, 1%
        feeTiers.push(100);
        feeTiers.push(500);
        feeTiers.push(3000);
        feeTiers.push(10000);
    }

    /**
     * @notice Swap tokens via Jaine DEX — called by AegisVault
     * @dev Matches the interface: swap(address,address,uint256,uint256)
     *
     *      If this function reverts for ANY reason (no pool, no liquidity,
     *      slippage exceeded, Jaine router error), the vault's low-level .call()
     *      catches the revert and returns success=false. No tokens are lost
     *      because safeTransferFrom also reverts atomically.
     *
     * @param tokenIn The token being sold
     * @param tokenOut The token being bought
     * @param amountIn Amount of tokenIn to swap
     * @param minAmountOut Minimum acceptable output (slippage protection)
     * @return amountOut The actual output amount
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        if (tokenIn == tokenOut) revert SameToken(); // F-2

        // Find pool with best liquidity (reverts if none found)
        uint24 fee = _findPoolWithLiquidity(tokenIn, tokenOut);

        // Pull tokenIn from caller (vault approved this adapter in _executeSwapViaVenue)
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Approve Jaine Router to spend tokenIn (exact amount, not unlimited)
        IERC20(tokenIn).forceApprove(address(router), amountIn);

        // Execute swap — output goes directly to msg.sender (vault)
        amountOut = router.exactInputSingle(
            IJaineSwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: msg.sender, // tokens go directly back to vault
                deadline: block.timestamp + 300,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );

        // Always reset approval after swap
        IERC20(tokenIn).forceApprove(address(router), 0);

        // Verify we got output (belt-and-suspenders — router enforces minAmountOut)
        if (amountOut == 0) revert SwapFailed();

        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }

    /**
     * @notice Find a pool with actual liquidity for the given token pair.
     *         Tries all fee tiers and picks the one with the most liquidity.
     *         F-1: Correctly handles pools with zero in-range liquidity by
     *         tracking whether ANY pool was found separately from best liquidity.
     * @return bestFee The fee tier of the best pool
     */
    function _findPoolWithLiquidity(address tokenIn, address tokenOut) internal view returns (uint24 bestFee) {
        uint128 bestLiquidity = 0;
        bool foundAnyPool = false;
        uint24 fallbackFee = 0; // First pool found, used if all have 0 liquidity

        for (uint256 i = 0; i < feeTiers.length; i++) {
            address pool = factory.getPool(tokenIn, tokenOut, feeTiers[i]);
            if (pool == address(0)) continue;

            if (!foundAnyPool) {
                foundAnyPool = true;
                fallbackFee = feeTiers[i]; // Remember first valid pool as fallback
            }

            // Check pool liquidity
            try IJainePool(pool).liquidity() returns (uint128 liq) {
                if (liq > bestLiquidity) {
                    bestLiquidity = liq;
                    bestFee = feeTiers[i];
                }
            } catch {
                // Pool exists but can't read liquidity — track as fallback only
            }
        }

        if (!foundAnyPool) revert NoPoolFound(tokenIn, tokenOut);

        // If no pool had readable liquidity > 0, use the first pool found
        // The swap may still work (liquidity could be in a different tick range)
        if (bestFee == 0) {
            bestFee = fallbackFee;
        }
    }

    /**
     * @notice Check if a pool exists for a token pair and return its liquidity
     */
    function hasPool(address tokenA, address tokenB) external view returns (bool exists, uint24 fee, uint128 liquidity) {
        for (uint256 i = 0; i < feeTiers.length; i++) {
            address pool = factory.getPool(tokenA, tokenB, feeTiers[i]);
            if (pool != address(0)) {
                try IJainePool(pool).liquidity() returns (uint128 liq) {
                    return (true, feeTiers[i], liq);
                } catch {
                    return (true, feeTiers[i], 0);
                }
            }
        }
        return (false, 0, 0);
    }

    /**
     * @notice Get estimated output for a swap using pool's current sqrtPriceX96.
     *
     * @dev This is a spot-price estimate, NOT a Quoter simulation.  It ignores
     *      fee deduction, tick crossing, and price impact — treat it as an
     *      approximate pre-flight check rather than an exact quote.
     *
     *      Math (Uniswap V3 Q64.96 fixed-point):
     *        sqrtPriceX96  = sqrt(token1 / token0) * 2^96
     *        price(1→0)    = (sqrtPriceX96)^2 / 2^192  (token1 per token0)
     *
     *      To avoid uint256 overflow (sqrtPriceX96 can be up to ~2^160):
     *        Split into two 96-bit shifts:
     *          If tokenIn == token0:
     *            amountOut = amountIn * (sqrtPriceX96 / 2^96)^2
     *                      = amountIn * sqrtPriceX96 / 2^96 * sqrtPriceX96 / 2^96
     *          If tokenIn == token1:
     *            amountOut = amountIn * 2^192 / sqrtPriceX96^2
     *                      = amountIn * (2^96 / sqrtPriceX96)^2
     *
     *      Returns 0 (does NOT revert) when:
     *        - no pool found for the pair
     *        - pool slot0 / token0 / token1 calls revert
     *        - sqrtPriceX96 is 0 (uninitialized pool)
     *        - amountIn is 0
     *
     * @param tokenIn  Token being sold
     * @param tokenOut Token being bought
     * @param amountIn Amount of tokenIn
     * @return estimated output amount of tokenOut (spot-price estimate)
     */
    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256) {
        if (amountIn == 0 || tokenIn == tokenOut) return 0;

        // ── Step 1: find best pool fee tier ──────────────────────────────────
        // _findPoolWithLiquidity reverts if no pool exists; we catch it below.
        uint24 fee;
        try this._findPoolWithLiquidityExternal(tokenIn, tokenOut) returns (uint24 f) {
            fee = f;
        } catch {
            return 0;
        }

        address pool = factory.getPool(tokenIn, tokenOut, fee);
        if (pool == address(0)) return 0;

        // ── Step 2: read slot0 and token ordering ────────────────────────────
        uint160 sqrtPriceX96;
        address poolToken0;

        try IJainePool(pool).slot0() returns (
            uint160 _sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool
        ) {
            sqrtPriceX96 = _sqrtPriceX96;
        } catch {
            return 0;
        }

        try IJainePool(pool).token0() returns (address t0) {
            poolToken0 = t0;
        } catch {
            return 0;
        }

        if (sqrtPriceX96 == 0) return 0;

        // ── Step 3: compute spot-price estimate ──────────────────────────────
        // All arithmetic uses uint256; split the Q96 shift in two to stay
        // within 256 bits (sqrtPriceX96 <= ~2^160, so one shift brings it to
        // <=2^64, well inside uint256).
        uint256 Q96 = 2**96;

        if (tokenIn == poolToken0) {
            // price = (sqrtPriceX96)^2 / 2^192
            // amountOut = amountIn * sqrtPriceX96 / 2^96 * sqrtPriceX96 / 2^96
            uint256 p = (uint256(sqrtPriceX96) * amountIn) / Q96;
            return (p * uint256(sqrtPriceX96)) / Q96;
        } else {
            // tokenIn == token1: price = 2^192 / (sqrtPriceX96)^2
            // amountOut = amountIn * 2^96 / sqrtPriceX96 * 2^96 / sqrtPriceX96
            uint256 p = (Q96 * amountIn) / uint256(sqrtPriceX96);
            return (p * Q96) / uint256(sqrtPriceX96);
        }
    }

    /**
     * @notice Public wrapper around _findPoolWithLiquidity so getAmountOut
     *         can call it via try/catch (internal functions cannot be try-caught).
     * @dev Intentionally public; callers get the same result as _findPoolWithLiquidity.
     */
    function _findPoolWithLiquidityExternal(address tokenIn, address tokenOut)
        external
        view
        returns (uint24)
    {
        return _findPoolWithLiquidity(tokenIn, tokenOut);
    }

    // ── Admin ──

    function addFeeTier(uint24 _fee) external onlyOwner {
        if (feeTiers.length >= MAX_FEE_TIERS) revert TooManyFeeTiers(); // F-3
        feeTiers.push(_fee);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    /**
     * @notice Rescue tokens accidentally sent to this contract.
     * @dev This adapter should NEVER hold tokens — all swaps are atomic.
     *      If tokens are stuck here due to a bug, owner can rescue them.
     */
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }
}
