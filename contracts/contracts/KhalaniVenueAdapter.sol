// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title KhalaniVenueAdapter
 * @notice Route registry + view-only validator for Khalani's HyperStream
 *         cross-chain intent protocol.
 *
 *         Khalani settlement is OFF-CHAIN — solvers fill intents and deliver
 *         tokens; there is no on-chain `swap()` to call. As a result this
 *         adapter is NOT a venue adapter in the traditional sense (compare
 *         {JaineVenueAdapter} which performs an on-chain Uniswap V3 swap).
 *         Instead, governance uses this contract to declare which chains and
 *         tokens are acceptable for cross-chain routing, and the orchestrator
 *         queries {isRouteAllowed} before publishing an intent.
 *
 *         The adapter holds no funds and never moves ERC-20 tokens — every
 *         function is either an admin write or a pure/view query. As a
 *         consequence we deliberately do NOT import OpenZeppelin Ownable:
 *           - no upgrade path is needed (governance can redeploy)
 *           - keeping the bytecode minimal is preferable for a tiny registry
 *           - the single-step ownership pattern matches {JaineVenueAdapter}
 *
 *         Deployed on 0G Mainnet (Aristotle, chain 16661).
 */
contract KhalaniVenueAdapter {
    // ── Storage ──

    /// @notice Current owner (governance multisig in production).
    address public owner;

    /// @notice Allowed source/destination chains for cross-chain routing.
    /// @dev    chainId => allowed
    mapping(uint64 => bool) public allowedChains;

    /// @notice Per-token allowlist on the vault's chain (the chain this
    ///         contract is deployed to). Tokens not in here can't be used as
    ///         assetIn or assetOut even if Khalani supports them globally.
    mapping(address => bool) public allowedTokens;

    /// @notice Default fee cap that orchestrators should respect when quoting.
    ///         Vault enforces its own per-vault cap separately; this is an
    ///         adapter-wide protocol-level guideline.
    uint16 public defaultMaxFeeBps;

    // ── Constants ──

    /// @notice Hard ceiling on {defaultMaxFeeBps}. Governance cannot exceed 2%.
    uint16 public constant ABSOLUTE_FEE_CAP_BPS = 200; // 2%

    // ── Events ──

    event ChainAllowed(uint64 indexed chainId, bool allowed);
    event TokenAllowed(address indexed token, bool allowed);
    event MaxFeeBpsUpdated(uint16 oldBps, uint16 newBps);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ── Errors ──

    error OnlyOwner();
    error ZeroAddress();
    error FeeBpsTooHigh();

    // ── Modifiers ──

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ── Constructor ──

    /**
     * @param _defaultMaxFeeBps Initial default fee cap (must be <= ABSOLUTE_FEE_CAP_BPS).
     */
    constructor(uint16 _defaultMaxFeeBps) {
        if (_defaultMaxFeeBps > ABSOLUTE_FEE_CAP_BPS) revert FeeBpsTooHigh();
        owner = msg.sender;
        defaultMaxFeeBps = _defaultMaxFeeBps;
        emit OwnershipTransferred(address(0), msg.sender);
        emit MaxFeeBpsUpdated(0, _defaultMaxFeeBps);
    }

    // ── Admin ──

    /**
     * @notice Allow or disallow a chain id for cross-chain routing.
     * @param chainId EVM chain id (or other Khalani-supported chain id).
     * @param allowed True to allow, false to disallow.
     */
    function setChainAllowed(uint64 chainId, bool allowed) external onlyOwner {
        allowedChains[chainId] = allowed;
        emit ChainAllowed(chainId, allowed);
    }

    /**
     * @notice Allow or disallow a token on this chain for routing as assetIn/assetOut.
     * @param token ERC-20 token address.
     * @param allowed True to allow, false to disallow.
     */
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    /**
     * @notice Update the default per-route fee cap (basis points).
     * @param newBps New fee cap; must be <= ABSOLUTE_FEE_CAP_BPS (200 bps / 2%).
     */
    function setDefaultMaxFeeBps(uint16 newBps) external onlyOwner {
        if (newBps > ABSOLUTE_FEE_CAP_BPS) revert FeeBpsTooHigh();
        emit MaxFeeBpsUpdated(defaultMaxFeeBps, newBps);
        defaultMaxFeeBps = newBps;
    }

    /**
     * @notice Transfer ownership in a single step.
     * @dev    Single-step (matches {JaineVenueAdapter}). Ownable2Step is
     *         overkill for a registry that holds no funds.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    // ── Views ──

    /**
     * @notice Check whether a (chainId, tokenIn, tokenOut) route is allowed.
     *         Returns true only when all of the following hold:
     *           - chainId is allowlisted
     *           - tokenIn  is allowlisted on this chain
     *           - tokenOut is allowlisted on this chain
     *           - tokenIn != tokenOut
     *           - neither token is the zero address
     */
    function isRouteAllowed(uint64 chainId, address tokenIn, address tokenOut)
        external
        view
        returns (bool)
    {
        if (tokenIn == address(0) || tokenOut == address(0)) return false;
        if (tokenIn == tokenOut) return false;
        if (!allowedChains[chainId]) return false;
        if (!allowedTokens[tokenIn]) return false;
        if (!allowedTokens[tokenOut]) return false;
        return true;
    }

    /**
     * @notice Canonical Khalani HyperStream API base URL.
     * @dev    Pure constant — exposed on-chain so off-chain orchestrators and
     *         indexers can resolve the API endpoint deterministically from the
     *         deployed adapter address.
     */
    function khalaniApiBase() external pure returns (string memory) {
        return "https://api.hyperstream.dev";
    }
}
