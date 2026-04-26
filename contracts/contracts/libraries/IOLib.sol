// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../VaultEvents.sol";

/**
 * @title IOLib
 * @notice Owner deposit/withdraw helpers. DELEGATECALL'd from AegisVault.
 *         Split out so each library bytecode fits 0G mainnet's per-block gas limit.
 *
 *         The original `doDeposit` / `doWithdraw` route the entry/exit fee
 *         entirely to `feeRecipient` (the operator). v3's new `doDepositV3`
 *         / `doWithdrawV3` reuse the same plumbing but split the fee 80/20
 *         between `feeRecipient` (operator) and `protocolTreasury` via
 *         the split helper below — kept inline (rather than delegating to
 *         FeeLib's external `splitFee`) to avoid an extra library link in
 *         the deploy graph.
 */
library IOLib {
    using SafeERC20 for IERC20;

    /// @dev Mirrors FeeLib.PROTOCOL_FEE_CUT_BPS (2000 = 20%) so the on-chain
    ///      split math stays consistent with FeeLib without requiring callers
    ///      to link both libraries.
    uint256 internal constant PROTOCOL_FEE_CUT_BPS = 2000;

    function _splitFee(
        uint256 feeAmount,
        address treasury
    ) private pure returns (uint256 operatorAmt, uint256 protocolAmt) {
        if (treasury == address(0) || feeAmount == 0) {
            return (feeAmount, 0);
        }
        protocolAmt = (feeAmount * PROTOCOL_FEE_CUT_BPS) / 10000;
        operatorAmt = feeAmount - protocolAmt;
    }

    function doDeposit(
        address baseAssetAddr,
        address depositor,
        uint256 amount,
        address feeRecipient,
        uint256 entryFeeBps
    ) external returns (uint256 net) {
        require(amount > 0, "0");
        // `depositor` is always the upstream `msg.sender` of the vault's
        // `deposit()` entrypoint, so this pulls tokens from the caller —
        // not from an arbitrary account.
        // slither-disable-next-line arbitrary-send-erc20
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

    /// @notice v3 deposit with 80/20 fee split between feeRecipient (operator)
    ///         and protocolTreasury. Falls back to operator-only if treasury is 0.
    function doDepositV3(
        address baseAssetAddr,
        address depositor,
        uint256 amount,
        address feeRecipient,
        address protocolTreasury,
        uint256 entryFeeBps
    ) external returns (uint256 net) {
        require(amount > 0, "0");
        // slither-disable-next-line arbitrary-send-erc20
        IERC20(baseAssetAddr).safeTransferFrom(depositor, address(this), amount);
        net = amount;

        uint256 fee = (amount * entryFeeBps) / 10000;
        if (fee > 0 && feeRecipient != address(0)) {
            (uint256 operatorAmt, uint256 protocolAmt) = _splitFee(fee, protocolTreasury);
            if (operatorAmt > 0) IERC20(baseAssetAddr).safeTransfer(feeRecipient, operatorAmt);
            if (protocolAmt > 0) IERC20(baseAssetAddr).safeTransfer(protocolTreasury, protocolAmt);
            emit VaultEvents.EntryFeeCharged(address(this), depositor, amount, fee);
            emit VaultEvents.FeesClaimed(address(this), feeRecipient, operatorAmt, protocolAmt);
            net = amount - fee;
        }
        emit VaultEvents.Deposited(address(this), depositor, net);
    }

    /// @notice v3 withdraw with 80/20 fee split between feeRecipient (operator)
    ///         and protocolTreasury. Falls back to operator-only if treasury is 0.
    function doWithdrawV3(
        address baseAssetAddr,
        address ownerAddr,
        uint256 amount,
        address feeRecipient,
        address protocolTreasury,
        uint256 exitFeeBps
    ) external {
        require(amount > 0, "0");
        require(amount <= IERC20(baseAssetAddr).balanceOf(address(this)), "b");

        uint256 fee = (amount * exitFeeBps) / 10000;
        if (fee > 0 && feeRecipient != address(0)) {
            (uint256 operatorAmt, uint256 protocolAmt) = _splitFee(fee, protocolTreasury);
            if (operatorAmt > 0) IERC20(baseAssetAddr).safeTransfer(feeRecipient, operatorAmt);
            if (protocolAmt > 0) IERC20(baseAssetAddr).safeTransfer(protocolTreasury, protocolAmt);
            emit VaultEvents.ExitFeeCharged(address(this), ownerAddr, amount, fee);
            emit VaultEvents.FeesClaimed(address(this), feeRecipient, operatorAmt, protocolAmt);
        }

        IERC20(baseAssetAddr).safeTransfer(ownerAddr, amount - fee);
        emit VaultEvents.Withdrawn(address(this), ownerAddr, amount - fee);
    }
}
