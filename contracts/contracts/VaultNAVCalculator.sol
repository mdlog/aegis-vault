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
    IPyth public pyth;
    address public admin;

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

    // ── Errors ──
    error OnlyAdmin();
    error PriceStale(bytes32 feedId, uint256 publishTime, uint256 nowTs);
    error PriceLowConfidence(bytes32 feedId, uint64 conf, uint256 price);
    error PriceNonPositive(bytes32 feedId);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    constructor(address _pyth) {
        pyth = IPyth(_pyth);
        admin = msg.sender;
    }

    // ── Admin: Configure tracked assets ──

    function addAsset(address token, bytes32 priceFeedId, uint8 decimals, bool isStablecoin) external onlyAdmin {
        assets.push(AssetConfig(token, priceFeedId, decimals, isStablecoin));
        emit AssetAdded(token, priceFeedId, decimals);
    }

    function clearAssets() external onlyAdmin {
        delete assets;
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

                uint256 absPrice = uint256(uint64(price.price));
                int32 expo = price.expo; // typically -8

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
     * @dev Caller must send enough ETH/native token to cover the update fee
     */
    function updatePriceFeeds(bytes[] calldata updateData) external payable {
        uint256 fee = pyth.getUpdateFee(updateData);
        pyth.updatePriceFeeds{value: fee}(updateData);
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
