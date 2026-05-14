// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "./libraries/OracleGuardLib.sol";

/**
 * @title  JaineVenueAdapterV2
 * @notice Same external surface as `JaineVenueAdapter` (vault calls
 *         `swap(tokenIn, tokenOut, amountIn, minAmountOut)`), but with an
 *         internal fallback that routes through a configured *hub token* when
 *         no direct pool exists. Designed for 0G's Jaine DEX, whose live
 *         pools are W0G-centric — USDC.e/W0G, WETH/W0G, WBTC/W0G — with no
 *         direct USDC.e ↔ WBTC or USDC.e ↔ WETH (deep) liquidity.
 *
 *         Routing decision (deterministic, on-chain):
 *           1. tokenIn == tokenOut          → revert SameToken()
 *           2. Direct pool with liquidity   → single-hop via exactInputSingle
 *           3. Hub-via path possible        → two-hop via exactInput(path)
 *           4. Otherwise                    → revert NoRoute()
 *
 *         Token flow stays atomic — adapter pulls from vault, approves
 *         router, calls router (which sends output directly to vault),
 *         resets approval, emits. If anything reverts, the whole tx
 *         reverts and `safeTransferFrom` is undone.
 *
 *         Important on slippage: with multi-hop, `minAmountOut` covers the
 *         END-TO-END output. The router enforces it as a hard floor, so
 *         per-leg slippage compounds within that single bound — no
 *         multi-leg approval surface exposed to callers.
 *
 *         This contract is deliberately a sibling, not a subclass, of v1:
 *           - v1 stays bytecode-identical at its deployed address (no
 *             unintended behavior shifts for live vaults pointing at it).
 *           - v2 is its own audit unit; auditors don't have to re-verify
 *             v1 to clear v2.
 *           - The vault's `venue` is set at `initialize()` and is not
 *             mutable, so existing vaults stay on v1; new vaults opt in
 *             to v2 by passing this address at creation.
 */

interface IJaineSwapRouterV2 {
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

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external payable returns (uint256 amountOut);

    function exactInput(ExactInputParams calldata params)
        external payable returns (uint256 amountOut);
}

interface IJaineFactoryV2 {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IJainePoolV2 {
    function liquidity() external view returns (uint128);
    function slot0()
        external view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
    function token0() external view returns (address);
}

contract JaineVenueAdapterV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ──
    uint256 public constant MAX_FEE_TIERS = 10;
    /// @notice Hard cap on `maxSlippageBps`. Tightened from 2000 (20%) to
    ///         500 (5%) so an admin error cannot expose vault flow to
    ///         catastrophic sandwich extraction. Pyth is the primary price
    ///         protection; this cap is the fallback when Pyth is disabled.
    uint16  public constant MAX_SLIPPAGE_BPS_CAP = 500;

    // ── Immutables ──
    IJaineSwapRouterV2 public immutable router;
    IJaineFactoryV2 public immutable factory;
    /// @notice Intermediate token used for two-hop routing. On 0G mainnet
    ///         this is W0G — every Jaine pool with meaningful TVL has W0G
    ///         on one side. Set once at deploy and immutable thereafter.
    address public immutable hubToken;

    address public owner;

    // ── Fee tiers, oracle guard (mirrors v1 surface so admin tooling
    // built against v1 keeps working) ──
    uint24[] public feeTiers;
    IPyth public pyth;
    uint16 public maxSlippageBps = 300; // 3%
    mapping(address => bytes32) public priceFeeds;
    mapping(address => uint8)   public tokenDecimals;

    // ── Events ──
    event Swapped(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint24 fee
    );
    event MultiHopSwapped(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        address hub,
        uint24 feeIn,
        uint24 feeOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event PythUpdated(address indexed oldPyth, address indexed newPyth);
    event MaxSlippageUpdated(uint16 oldBps, uint16 newBps);
    event AssetRegistered(address indexed token, bytes32 priceFeedId, uint8 decimals);

    // ── Errors ──
    error NoRoute(address tokenIn, address tokenOut);
    error SwapFailed();
    error OnlyOwner();
    error ZeroAmount();
    error ZeroAddress();
    error SameToken();
    error TooManyFeeTiers();
    error SlippageBpsTooHigh();
    /// @notice Router returned `amountOut` but the recipient's actual
    ///         `tokenOut` balance increase is below `minAmountOut`. Either
    ///         the router lied about its output or some unexpected token
    ///         flow occurred — fail closed.
    error BalanceDeltaBelowMin(uint256 actual, uint256 minRequired);
    /// @notice `addFeeTier` rejected: fee==0 or fee already registered.
    error InvalidFeeTier(uint24 fee);
    /// @notice `setPyth` rejected non-zero address with no contract code.
    error PythNotAContract();
    /// @notice `registerAsset` rejected `decimals > 18` (ERC-20 convention bound).
    error AssetDecimalsOutOfRange(uint8 decimals);

    // Additional events
    event TokensRescued(address indexed token, address indexed to, uint256 amount);
    event FeeTierAdded(uint24 fee);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address _router, address _factory, address _hubToken) {
        if (_router == address(0) || _factory == address(0) || _hubToken == address(0)) {
            revert ZeroAddress();
        }
        router = IJaineSwapRouterV2(_router);
        factory = IJaineFactoryV2(_factory);
        hubToken = _hubToken;
        owner = msg.sender;

        feeTiers.push(100);
        feeTiers.push(500);
        feeTiers.push(3000);
        feeTiers.push(10000);
    }

    /**
     * @notice Vault entry point. Picks single-hop or two-hop automatically.
     * @dev    Reverts atomically on any failure; vault sees `success=false`
     *         and tokens stay where they were.
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        if (tokenIn == tokenOut) revert SameToken();

        _checkOracleDeviation(tokenIn, tokenOut, amountIn, minAmountOut);

        // 1. Direct pool — preferred path. Mirrors v1 behavior.
        (bool hasDirect, uint24 directFee) = _findDirectPool(tokenIn, tokenOut);
        if (hasDirect) {
            amountOut = _singleHopSwap(tokenIn, tokenOut, directFee, amountIn, minAmountOut);
            emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut, directFee);
            return amountOut;
        }

        // 2. Two-hop via hubToken. Skip if the requested pair already
        //    involves the hub (means there's no direct pool *and* no
        //    legitimate detour — bail rather than make a meaningless
        //    self-hop hub→hub leg).
        if (tokenIn == hubToken || tokenOut == hubToken) {
            revert NoRoute(tokenIn, tokenOut);
        }

        (bool hasInLeg,  uint24 feeIn)  = _findDirectPool(tokenIn,  hubToken);
        (bool hasOutLeg, uint24 feeOut) = _findDirectPool(hubToken, tokenOut);
        if (!hasInLeg || !hasOutLeg) revert NoRoute(tokenIn, tokenOut);

        amountOut = _multiHopSwap(tokenIn, tokenOut, feeIn, feeOut, amountIn, minAmountOut);
        emit MultiHopSwapped(
            msg.sender, tokenIn, tokenOut, hubToken,
            feeIn, feeOut, amountIn, amountOut
        );
    }

    // ── Internal swap pipelines ──

    function _singleHopSwap(
        address tokenIn,
        address tokenOut,
        uint24  fee,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        // Balance-delta is the source of truth for amountOut. The router's
        // return value is advisory — some forks under-report or over-report.
        // Snapshot the recipient's tokenOut balance before/after and require
        // the actual delta meets the slippage floor.
        uint256 outBefore = IERC20(tokenOut).balanceOf(msg.sender);
        router.exactInputSingle(
            IJaineSwapRouterV2.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: msg.sender,
                deadline: block.timestamp + 300,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(tokenIn).forceApprove(address(router), 0);
        uint256 outAfter = IERC20(tokenOut).balanceOf(msg.sender);
        amountOut = outAfter - outBefore;
        if (amountOut < minAmountOut) revert BalanceDeltaBelowMin(amountOut, minAmountOut);
        if (amountOut == 0) revert SwapFailed();
    }

    function _multiHopSwap(
        address tokenIn,
        address tokenOut,
        uint24  feeIn,
        uint24  feeOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal returns (uint256 amountOut) {
        // Uniswap V3 path is tightly packed:
        //   tokenIn (20 bytes) || feeIn (3 bytes) || hub (20) || feeOut (3) || tokenOut (20)
        bytes memory path = abi.encodePacked(tokenIn, feeIn, hubToken, feeOut, tokenOut);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        // See `_singleHopSwap` for the balance-delta rationale.
        uint256 outBefore = IERC20(tokenOut).balanceOf(msg.sender);
        router.exactInput(
            IJaineSwapRouterV2.ExactInputParams({
                path: path,
                recipient: msg.sender,
                deadline: block.timestamp + 300,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut
            })
        );
        IERC20(tokenIn).forceApprove(address(router), 0);
        uint256 outAfter = IERC20(tokenOut).balanceOf(msg.sender);
        amountOut = outAfter - outBefore;
        if (amountOut < minAmountOut) revert BalanceDeltaBelowMin(amountOut, minAmountOut);
        if (amountOut == 0) revert SwapFailed();
    }

    // ── Pool discovery ──

    /// @notice Find best fee tier (highest in-range liquidity) for a direct pool.
    ///         Returns (false, 0) when no pool exists OR no pool in any tier
    ///         has readable, non-zero liquidity. Failing closed prevents
    ///         routing to a dead pool whose `slot0()` could be manipulated by
    ///         a permissionless creator (anyone can `factory.createPool` on
    ///         Jaine), which combined with the disabled Pyth guard would
    ///         expose vault flow to up-to-`maxSlippageBps` extraction.
    function _findDirectPool(address tokenA, address tokenB)
        internal view returns (bool exists, uint24 bestFee)
    {
        uint128 bestLiquidity = 0;

        for (uint256 i = 0; i < feeTiers.length; i++) {
            address pool = factory.getPool(tokenA, tokenB, feeTiers[i]);
            if (pool == address(0)) continue;

            try IJainePoolV2(pool).liquidity() returns (uint128 liq) {
                if (liq > bestLiquidity) {
                    bestLiquidity = liq;
                    bestFee = feeTiers[i];
                }
            } catch {
                // pool exists but liquidity() reverts — treat as dead pool.
            }
        }
        // Only report `exists` when at least one pool yielded readable,
        // non-zero liquidity. The previous fallback (return the first pool
        // found regardless of liquidity) opened a routing path into pools
        // an attacker could deploy with manipulated slot0() prices.
        exists = bestLiquidity > 0;
    }

    /// @notice Public wrapper for off-chain tooling (frontend pre-flight,
    ///         orchestrator route preview). Returns the route the adapter
    ///         WOULD pick today. Returns (kind=0) if neither path works.
    ///         kind: 0=none, 1=direct, 2=hub
    function previewRoute(address tokenIn, address tokenOut)
        external view
        returns (uint8 kind, uint24 feeA, uint24 feeB)
    {
        if (tokenIn == tokenOut) return (0, 0, 0);
        (bool d, uint24 f) = _findDirectPool(tokenIn, tokenOut);
        if (d) return (1, f, 0);

        if (tokenIn == hubToken || tokenOut == hubToken) return (0, 0, 0);
        (bool hin,  uint24 fi) = _findDirectPool(tokenIn,  hubToken);
        (bool hout, uint24 fo) = _findDirectPool(hubToken, tokenOut);
        if (hin && hout) return (2, fi, fo);
        return (0, 0, 0);
    }

    /// @notice Spot-price estimate for `amountIn` of `tokenIn` → `tokenOut`,
    ///         using the same direct-or-hub routing decision as `swap()`.
    ///
    /// @dev    This is a Q64.96 spot-price estimate (no Quoter simulation,
    ///         no fee deduction, no price-impact slippage). Treat as a
    ///         pre-flight check, not a hard quote — the orchestrator's
    ///         minAmountOut should add a slippage buffer on top.
    ///
    ///         Returns 0 (does NOT revert) when the pair has no route, the
    ///         pool's slot0 reverts, or the pool isn't initialised. Restoring
    ///         the V1 surface so off-chain tooling that called
    ///         `IVenue.getAmountOut(...)` against the old adapter keeps
    ///         working when pointed at V2.
    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256) {
        if (amountIn == 0 || tokenIn == tokenOut) return 0;
        (bool direct, uint24 feeA) = _findDirectPool(tokenIn, tokenOut);
        if (direct) {
            return _quoteSingleHop(tokenIn, tokenOut, feeA, amountIn);
        }
        if (tokenIn == hubToken || tokenOut == hubToken) return 0;
        (bool hin,  uint24 fi) = _findDirectPool(tokenIn,  hubToken);
        (bool hout, uint24 fo) = _findDirectPool(hubToken, tokenOut);
        if (!hin || !hout) return 0;
        uint256 hubAmount = _quoteSingleHop(tokenIn,  hubToken, fi, amountIn);
        if (hubAmount == 0) return 0;
        return _quoteSingleHop(hubToken, tokenOut, fo, hubAmount);
    }

    /// @notice Internal Q64.96 spot quote against a specific Uniswap V3 pool.
    ///         Returns 0 on any read failure rather than reverting so the
    ///         outer route picker can fall through to alternative paths.
    function _quoteSingleHop(
        address tokenIn,
        address tokenOut,
        uint24  fee,
        uint256 amountIn
    ) internal view returns (uint256) {
        address pool = factory.getPool(tokenIn, tokenOut, fee);
        if (pool == address(0)) return 0;
        uint160 sqrtPriceX96;
        address poolToken0;
        try IJainePoolV2(pool).slot0() returns (
            uint160 _s, int24, uint16, uint16, uint16, uint8, bool
        ) { sqrtPriceX96 = _s; } catch { return 0; }
        try IJainePoolV2(pool).token0() returns (address t0) {
            poolToken0 = t0;
        } catch { return 0; }
        if (sqrtPriceX96 == 0) return 0;
        uint256 Q96 = 2**96;
        if (tokenIn == poolToken0) {
            // price = (sqrtPriceX96)^2 / 2^192 ; split shifts to stay <2^256
            uint256 p = (uint256(sqrtPriceX96) * amountIn) / Q96;
            return (p * uint256(sqrtPriceX96)) / Q96;
        }
        uint256 q = (Q96 * amountIn) / uint256(sqrtPriceX96);
        return (q * Q96) / uint256(sqrtPriceX96);
    }

    // ── Oracle guard ── (same surface as v1)

    function _checkOracleDeviation(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal view {
        if (address(pyth) == address(0)) return;
        bytes32 feedIn  = priceFeeds[tokenIn];
        bytes32 feedOut = priceFeeds[tokenOut];
        if (feedIn == bytes32(0) || feedOut == bytes32(0)) return;

        OracleGuardLib.checkDeviation(
            pyth, feedIn, feedOut,
            tokenDecimals[tokenIn], tokenDecimals[tokenOut],
            amountIn, minAmountOut, maxSlippageBps
        );
    }

    // ── Admin ──

    function addFeeTier(uint24 _fee) external onlyOwner {
        if (feeTiers.length >= MAX_FEE_TIERS) revert TooManyFeeTiers();
        if (_fee == 0) revert InvalidFeeTier(_fee);
        // Reject duplicates — the loop is bounded by MAX_FEE_TIERS = 10.
        for (uint256 i = 0; i < feeTiers.length; i++) {
            if (feeTiers[i] == _fee) revert InvalidFeeTier(_fee);
        }
        feeTiers.push(_fee);
        emit FeeTierAdded(_fee);
    }

    function setPyth(address _pyth) external onlyOwner {
        // address(0) explicitly disables the oracle guard. Any non-zero
        // address must be a contract — an EOA here would cause every swap
        // to revert with empty data on `getPriceNoOlderThan`, silently
        // bricking the adapter until the next admin tx.
        if (_pyth != address(0) && _pyth.code.length == 0) revert PythNotAContract();
        emit PythUpdated(address(pyth), _pyth);
        pyth = IPyth(_pyth);
    }

    function setMaxSlippageBps(uint16 _bps) external onlyOwner {
        if (_bps > MAX_SLIPPAGE_BPS_CAP) revert SlippageBpsTooHigh();
        emit MaxSlippageUpdated(maxSlippageBps, _bps);
        maxSlippageBps = _bps;
    }

    function registerAsset(address token, bytes32 feedId, uint8 decimals) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        // Bound decimals to ERC-20 convention. Without this, an admin typo
        // (e.g. decimals=255) is accepted and `OracleGuardLib.checkDeviation`
        // overflows `10 ** (decimalsOut - decimalsIn)` on every subsequent
        // swap that touches this asset.
        if (decimals > 18) revert AssetDecimalsOutOfRange(decimals);
        priceFeeds[token]    = feedId;
        tokenDecimals[token] = decimals;
        emit AssetRegistered(token, feedId, decimals);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit TokensRescued(token, to, amount);
    }
}
