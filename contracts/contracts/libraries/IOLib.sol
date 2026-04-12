// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../VaultEvents.sol";

/**
 * @title IOLib
 * @notice Owner deposit/withdraw helpers. DELEGATECALL'd from AegisVault.
 *         Split out so each library bytecode fits 0G mainnet's per-block gas limit.
 */
library IOLib {
    using SafeERC20 for IERC20;

    function doDeposit(
        address baseAssetAddr,
        address depositor,
        uint256 amount,
        address feeRecipient,
        uint256 entryFeeBps
    ) external returns (uint256 net) {
        require(amount > 0, "0");
        IERC20(baseAssetAddr).safeTransferFrom(depositor, address(this), amount);
        net = amount;
        uint256 fee = (amount * entryFeeBps) / 10000;
        if (fee > 0 && feeRecipient != address(0)) {
            IERC20(baseAssetAddr).safeTransfer(feeRecipient, fee);
            net = amount - fee;
        }
        emit VaultEvents.Deposited(address(this), depositor, net);
    }

    function doWithdraw(
        address baseAssetAddr,
        address ownerAddr,
        uint256 amount,
        address feeRecipient,
        uint256 exitFeeBps
    ) external {
        require(amount > 0, "0");
        require(amount <= IERC20(baseAssetAddr).balanceOf(address(this)), "b");
        uint256 fee = (amount * exitFeeBps) / 10000;
        if (fee > 0 && feeRecipient != address(0)) {
            IERC20(baseAssetAddr).safeTransfer(feeRecipient, fee);
        }
        IERC20(baseAssetAddr).safeTransfer(ownerAddr, amount - fee);
        emit VaultEvents.Withdrawn(address(this), ownerAddr, amount - fee);
    }
}
