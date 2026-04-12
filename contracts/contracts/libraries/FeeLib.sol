// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FeeLib
 * @notice External library for fee accrual + split math. Marked external so the
 *         compiled bytecode lives in a separate contract and is DELEGATECALL'd
 *         from AegisVault — keeping the vault implementation small enough to
 *         fit 0G mainnet's tight per-block gas limit.
 */
library FeeLib {
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant PROTOCOL_FEE_CUT_BPS = 2000; // 20%

    /// @notice Compute lazy fee accrual since lastFeeAccrual.
    /// @param currentNav         Total NAV (oracle or base balance)
    /// @param accruedMgmt        Currently accrued management fee
    /// @param accruedPerf        Currently accrued performance fee
    /// @param hwm                High water mark
    /// @param mgmtBps            Management fee bps (per year)
    /// @param perfBps            Performance fee bps
    /// @param elapsed            Seconds since last accrual
    /// @return newAccruedMgmt    Updated accrued management fee
    /// @return newAccruedPerf    Updated accrued performance fee
    /// @return newHwm            Updated HWM
    /// @return mgmtAdded         Newly added management fee (for events)
    /// @return perfAdded         Newly added performance fee (for events)
    function computeAccrual(
        uint256 currentNav,
        uint256 accruedMgmt,
        uint256 accruedPerf,
        uint256 hwm,
        uint256 mgmtBps,
        uint256 perfBps,
        uint256 elapsed
    ) external pure returns (
        uint256 newAccruedMgmt,
        uint256 newAccruedPerf,
        uint256 newHwm,
        uint256 mgmtAdded,
        uint256 perfAdded
    ) {
        newAccruedMgmt = accruedMgmt;
        newAccruedPerf = accruedPerf;
        newHwm = hwm;

        if (elapsed == 0) {
            return (newAccruedMgmt, newAccruedPerf, newHwm, 0, 0);
        }

        uint256 effectiveNav = currentNav > (accruedMgmt + accruedPerf)
            ? currentNav - accruedMgmt - accruedPerf
            : 0;

        if (mgmtBps > 0 && effectiveNav > 0) {
            mgmtAdded = (effectiveNav * mgmtBps * elapsed) / (10000 * SECONDS_PER_YEAR);
            if (mgmtAdded > 0) {
                newAccruedMgmt += mgmtAdded;
                effectiveNav = effectiveNav > mgmtAdded ? effectiveNav - mgmtAdded : 0;
            }
        }

        if (perfBps > 0 && effectiveNav > hwm && hwm > 0) {
            uint256 profit = effectiveNav - hwm;
            perfAdded = (profit * perfBps) / 10000;
            if (perfAdded > 0) {
                newAccruedPerf += perfAdded;
                newHwm = effectiveNav - perfAdded;
            }
        }
    }

    /// @notice Split a fee amount between operator and protocol treasury.
    /// @param feeAmount         Gross fee
    /// @param vaultBalance      Liquid base asset available
    /// @param treasury          Protocol treasury (0 = no split)
    /// @return operatorAmount   Amount to send operator
    /// @return protocolCut      Amount to send protocol treasury
    /// @return totalCapped      Total fee actually transferable (capped to balance)
    function splitFee(
        uint256 feeAmount,
        uint256 vaultBalance,
        address treasury
    ) external pure returns (uint256 operatorAmount, uint256 protocolCut, uint256 totalCapped) {
        totalCapped = feeAmount > vaultBalance ? vaultBalance : feeAmount;
        if (treasury != address(0)) {
            protocolCut = (totalCapped * PROTOCOL_FEE_CUT_BPS) / 10000;
        }
        operatorAmount = totalCapped - protocolCut;
    }
}
