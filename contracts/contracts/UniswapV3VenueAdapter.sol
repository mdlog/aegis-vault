// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title UniswapV3VenueAdapter
 * @notice Adapter that bridges AegisVault's venue interface to Uniswap V3 SwapRouter02.
 *
 *         AegisVault calls:  swap(tokenIn, tokenOut, amountIn, minAmountOut)
 *         This adapter calls: SwapRouter02.exactInputSingle(...)
 *
 *         Token flow:
 *           1. Vault approves adapter for amountIn (via forceApprove in _executeSwapViaVenue)
 *           2. Adapter pulls tokenIn from vault via safeTransferFrom
 *           3. Adapter approves SwapRouter02 for amountIn
 *           4. SwapRouter02 swaps and sends tokenOut directly to vault (recipient = vault)
 *           5. Adapter resets Router approval to 0
 *           6. If anything reverts, entire call reverts → vault sees success=false, no tokens lost
 *
 *         Differences from JaineVenueAdapter:
 *           - Uses SwapRouter02 ExactInputSingleParams (no `deadline` field — Uniswap V3 v2 router)
 *           - Designed for canonical Uniswap V3 deployments (Arbitrum, Base, Optimism, etc.)
 *           - Same security guarantees: nonReentrant, force-approve-then-zero, balance verification
 *
 *         Verified deployments:
 *           - Arbitrum One (chain 42161)
 *             SwapRouter02: 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45
 *             Factory:      0x1F98431c8aD98523631AE4a59f267346ea31F984
 */

/// @notice Minimal Uniswap V3 SwapRouter02 interface (no deadline field)
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
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
interface IUniV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

/// @notice Minimal Uniswap V3 Pool interface for liquidity check
interface IUniV3Pool {
    function liquidity() external view returns (uint128);
}

contract UniswapV3VenueAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ──
    uint256 public constant MAX_FEE_TIERS = 10;

    // ── Immutables ──
    ISwapRouter02 public immutable router;
    IUniV3Factory public immutable factory;
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
        router = ISwapRouter02(_router);
        factory = IUniV3Factory(_factory);
        owner = msg.sender;

        // Standard Uniswap V3 fee tiers: 0.01%, 0.05%, 0.3%, 1%
        feeTiers.push(100);
        feeTiers.push(500);
        feeTiers.push(3000);
        feeTiers.push(10000);
    }

    /**
     * @notice Swap tokens via Uniswap V3 — called by AegisVault
     * @dev Matches the interface: swap(address,address,uint256,uint256)
     *
     *      If this function reverts for ANY reason (no pool, no liquidity,
     *      slippage exceeded, router error), the vault's low-level .call()
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
        if (tokenIn == tokenOut) revert SameToken();

        // Find pool with best liquidity (reverts if none found)
        uint24 fee = _findPoolWithLiquidity(tokenIn, tokenOut);

        // Pull tokenIn from caller (vault approved this adapter in _executeSwapViaVenue)
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Approve Router to spend tokenIn (exact amount, not unlimited)
        IERC20(tokenIn).forceApprove(address(router), amountIn);

        // Execute swap — output goes directly to msg.sender (vault)
        amountOut = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: msg.sender, // tokens go directly back to vault
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
     */
    function _findPoolWithLiquidity(address tokenIn, address tokenOut) internal view returns (uint24 bestFee) {
        uint128 bestLiquidity = 0;
        bool foundAnyPool = false;
        uint24 fallbackFee = 0;

        for (uint256 i = 0; i < feeTiers.length; i++) {
            address pool = factory.getPool(tokenIn, tokenOut, feeTiers[i]);
            if (pool == address(0)) continue;

            if (!foundAnyPool) {
                foundAnyPool = true;
                fallbackFee = feeTiers[i];
            }

            try IUniV3Pool(pool).liquidity() returns (uint128 liq) {
                if (liq > bestLiquidity) {
                    bestLiquidity = liq;
                    bestFee = feeTiers[i];
                }
            } catch {}
        }

        if (!foundAnyPool) revert NoPoolFound(tokenIn, tokenOut);

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
                try IUniV3Pool(pool).liquidity() returns (uint128 liq) {
                    return (true, feeTiers[i], liq);
                } catch {
                    return (true, feeTiers[i], 0);
                }
            }
        }
        return (false, 0, 0);
    }

    // ── Admin ──

    function addFeeTier(uint24 _fee) external onlyOwner {
        if (feeTiers.length >= MAX_FEE_TIERS) revert TooManyFeeTiers();
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
