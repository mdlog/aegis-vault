// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title VaultNAVCalculator
 * @notice Calculates multi-asset Net Asset Value for Aegis Vaults using Pyth oracle prices.
 *
 *         For each token the vault holds, reads the Pyth price feed and computes
 *         value in USD terms. Returns total NAV in 6 decimals (USDC-scale).
 *
 *         On 0G testnet where Pyth is not natively deployed, deploy MockPyth first.
 */
contract VaultNAVCalculator {
    /// @notice Pyth oracle contract. `immutable` so the most critical
    ///         dependency cannot be silently rotated to a malicious target
    ///         and to save the SLOAD on every NAV read. If Pyth ever
    ///         migrates contracts on 0G, this NAV calculator must be
    ///         redeployed (callers point at the new address via factory
    ///         setters).
    IPyth public immutable pyth;
    address public admin;
    /// @notice Address proposed by the current admin that must call
    ///         `acceptAdmin()` to finalize the transfer. Prevents typos / lost
    ///         keys from locking up the contract (Ownable2Step pattern).
    address public pendingAdmin;

    uint256 public constant MAX_PRICE_AGE = 300;        // 5 minutes staleness allowed
    /// @notice Reject Pyth prices whose confidence interval exceeds this fraction of price.
    ///         500 = 5% of price → reject. Tunable per asset class in future.
    uint256 public constant MAX_CONF_BPS = 500;
    uint256 public constant BPS_DENOM = 10_000;

    struct AssetConfig {
        address token;        // ERC20 token address
        bytes32 priceFeedId;  // Pyth price feed ID
        uint8   decimals;     // Token decimals
        bool    isStablecoin; // If true, price is assumed $1.00 (skip oracle)
    }

    AssetConfig[] public assets;

    // ── Events ──
    event AssetAdded(address indexed token, bytes32 priceFeedId, uint8 decimals);
    event AssetRemoved(address indexed token);
    event NAVCalculated(address indexed vault, uint256 navUsd6);
    event AdminTransferStarted(address indexed previousAdmin, address indexed newAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    // ── Errors ──
    error OnlyAdmin();
    error OnlyPendingAdmin();
    error InvalidAdmin();
    error PriceStale(bytes32 feedId, uint256 publishTime, uint256 nowTs);
    error PriceLowConfidence(bytes32 feedId, uint64 conf, uint256 price);
    error PriceNonPositive(bytes32 feedId);
    /// @notice Asset decimals out of the supported range (0..18). Without this
    ///         guard an admin typo (e.g. `decimals=255`) would be accepted and
    ///         later overflow `denomPow = decimals + |expo|` inside calculateNAV.
    error AssetDecimalsOutOfRange(uint8 decimals);
    error InvalidAsset(address token);
    /// @notice Pyth feed returned a non-negative `expo`, which violates the
    ///         calculator's assumption that prices use a negative-exponent
    ///         scale (typically `expo = -8`). Without this guard, the
    ///         downstream `uint256(uint32(-expo))` cast on a positive `expo`
    ///         underflows the unary minus on int32 and produces a wildly
    ///         wrong `denomPow`, silently corrupting NAV.
    error PriceUnsupportedExpo(bytes32 feedId, int32 expo);
    /// @notice `removeAssetAt` index argument is past the end of the array.
    error AssetIndexOutOfBounds(uint256 index, uint256 length);
    /// @notice Constructor argument validation.
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    constructor(address _pyth) {
        if (_pyth == address(0)) revert ZeroAddress();
        pyth = IPyth(_pyth);
        admin = msg.sender;
    }

    // ── Admin rotation (Ownable2Step pattern) ──

    /// @notice Propose a new admin. Takes effect only after `newAdmin`
    ///         calls `acceptAdmin()` — guards against setting a bad address.
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert InvalidAdmin();
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    /// @notice Called by the pending admin to finalize the transfer.
    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert OnlyPendingAdmin();
        address previous = admin;
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferred(previous, admin);
    }

    /// @notice Cancel a previously-started transfer. Callable by current admin.
    function cancelAdminTransfer() external onlyAdmin {
        pendingAdmin = address(0);
    }

    // ── Admin: Configure tracked assets ──

    function addAsset(address token, bytes32 priceFeedId, uint8 decimals, bool isStablecoin) external onlyAdmin {
        if (token == address(0)) revert InvalidAsset(token);
        // Solidity's checked arithmetic still allows uint256 exponents up to
        // type(uint256).max in the `10 ** denomPow` expressions inside
        // calculateNAV; the practical bound is 18 (ERC-20 convention) plus
        // the typical Pyth |expo| of 8. Anything above 18 indicates an admin
        // mistake and would silently produce garbage NAV values.
        if (decimals > 18) revert AssetDecimalsOutOfRange(decimals);
        assets.push(AssetConfig(token, priceFeedId, decimals, isStablecoin));
        emit AssetAdded(token, priceFeedId, decimals);
    }

    function clearAssets() external onlyAdmin {
        delete assets;
    }

    /// @notice Remove a single asset by index using swap-and-pop. Lets the
    ///         admin retire one bad-feed configuration without nuking the
    ///         entire registry (which `clearAssets` would do). Order of
    ///         remaining assets is not preserved.
    function removeAssetAt(uint256 index) external onlyAdmin {
        uint256 len = assets.length;
        if (index >= len) revert AssetIndexOutOfBounds(index, len);
        address removed = assets[index].token;
        if (index != len - 1) {
            assets[index] = assets[len - 1];
        }
        assets.pop();
        emit AssetRemoved(removed);
    }

    function getAssetCount() external view returns (uint256) {
        return assets.length;
    }

    // ── NAV Calculation ──

    /**
     * @notice Calculate total NAV of a vault in USD (6 decimals)
     * @param vault Address of the vault to calculate NAV for
     * @return navUsd6 Total NAV in USD with 6 decimal places
     * @return breakdown Array of per-asset values in USD (6 decimals)
     */
    function calculateNAV(address vault) external view returns (
        uint256 navUsd6,
        uint256[] memory breakdown
    ) {
        breakdown = new uint256[](assets.length);

        for (uint256 i = 0; i < assets.length; i++) {
            AssetConfig memory asset = assets[i];
            uint256 balance = IERC20(asset.token).balanceOf(vault);

            if (balance == 0) {
                breakdown[i] = 0;
                continue;
            }

            uint256 valueUsd6;

            if (asset.isStablecoin) {
                // Stablecoin: 1 token = $1.00, just convert decimals to 6
                if (asset.decimals >= 6) {
                    valueUsd6 = balance / (10 ** (asset.decimals - 6));
                } else {
                    valueUsd6 = balance * (10 ** (6 - asset.decimals));
                }
            } else {
                // P5-S2: Use getPriceNoOlderThan for staleness enforcement.
                // The MAX_PRICE_AGE constant (5 min) was previously defined but unused —
                // getPriceUnsafe accepted ANY age. This now reverts hard if the oracle
                // hasn't been updated in 5 minutes, which the calling vault catches via
                // try/catch and falls back to base-asset balance.
                PythStructs.Price memory price = pyth.getPriceNoOlderThan(
                    asset.priceFeedId,
                    MAX_PRICE_AGE
                );

                if (price.price <= 0) revert PriceNonPositive(asset.priceFeedId);
                // Reject non-negative expo. The downstream `uint256(uint32(-expo))`
                // cast is only safe when `expo < 0`. With `expo == 0` the
                // denominator collapses; with `expo > 0` the unary minus on
                // int32 produces a negative value whose uint32 reinterpretation
                // is a near-2^32 garbage exponent that overflows `denomPow`
                // and corrupts NAV silently.
                if (price.expo >= 0) revert PriceUnsupportedExpo(asset.priceFeedId, price.expo);

                uint256 absPrice = uint256(uint64(price.price));
                int32 expo = price.expo; // typically -8, guaranteed < 0 by check above

                // P5-S3: Reject prices with low confidence (high uncertainty).
                // Pyth `conf` is the 1-sigma uncertainty band around `price`. If the band
                // exceeds MAX_CONF_BPS of price, the oracle is in a degraded state and
                // shouldn't be used to value funds.
                uint256 confLimit = (absPrice * MAX_CONF_BPS) / BPS_DENOM;
                if (uint256(price.conf) > confLimit) {
                    revert PriceLowConfidence(asset.priceFeedId, price.conf, absPrice);
                }

                // Calculate: balance * absPrice, then adjust for decimals
                // target = balance * absPrice * 10^6 / (10^tokenDecimals * 10^(-expo))
                // = balance * absPrice * 10^6 / (10^(tokenDecimals + (-expo)))
                uint256 numerator = balance * absPrice;
                uint256 expoAbs = uint256(uint32(-expo)); // e.g., 8
                uint256 denomPow = asset.decimals + expoAbs; // e.g., 8 + 8 = 16 for BTC

                if (denomPow >= 6) {
                    valueUsd6 = numerator / (10 ** (denomPow - 6));
                } else {
                    valueUsd6 = numerator * (10 ** (6 - denomPow));
                }
            }

            breakdown[i] = valueUsd6;
            navUsd6 += valueUsd6;
        }

    }

    /**
     * @notice Update Pyth price feeds (pass-through to Pyth contract)
     * @dev Caller must send at least the update fee. Any overpayment is
     *      refunded in the same tx so callers don't have to compute the
     *      exact fee off-chain (or send a tight estimate that risks
     *      reverting on a fee bump). Overpaid native that previously stuck
     *      in this contract permanently is now sent back.
     */
    function updatePriceFeeds(bytes[] calldata updateData) external payable {
        uint256 fee = pyth.getUpdateFee(updateData);
        // `pyth` is the immutable Pyth oracle contract (set at deploy).
        // Not an arbitrary target.
        // slither-disable-next-line arbitrary-send-eth
        pyth.updatePriceFeeds{value: fee}(updateData);
        if (msg.value > fee) {
            uint256 refund = msg.value - fee;
            (bool ok, ) = payable(msg.sender).call{value: refund}("");
            require(ok, "refund failed");
        }
    }

    /**
     * @notice Get the fee required to update price feeds
     */
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256) {
        return pyth.getUpdateFee(updateData);
    }

    /**
     * @notice Read a single Pyth price
     */
    function getPrice(bytes32 feedId) external view returns (
        int64 price, uint64 conf, int32 expo, uint256 publishTime
    ) {
        PythStructs.Price memory p = pyth.getPriceUnsafe(feedId);
        return (p.price, p.conf, p.expo, p.publishTime);
    }
}
