// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ProtocolTreasury
 * @notice Holds protocol fee revenue from all vaults.
 *         Phase 1: Simple multi-sig admin access (governance moves to DAO in Phase 4).
 *
 *         Receives:
 *           - 20% cut of all operator fees (performance, management, entry, exit)
 *           - Slashing income (Phase 2)
 *           - Listing fees (Phase 2)
 *
 *         Spends on:
 *           - Audits, bug bounty
 *           - Operator grants
 *           - Development funding
 *           - Insurance pool seeding (Phase 2)
 */
contract ProtocolTreasury is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── State ──
    address public admin;
    mapping(address => bool) public approvedSpenders;
    /// @notice P5-S11: Whitelist of addresses (typically vault contracts) permitted
    ///         to call notifyReceived() to attribute incoming fees to lifetimeRevenue.
    ///         Without this, anyone could inflate the analytics counter.
    mapping(address => bool) public authorizedReporters;

    // Track all-time revenue per token (for analytics / dashboards)
    mapping(address => uint256) public lifetimeRevenue;

    // ── Events ──
    event Received(address indexed token, address indexed from, uint256 amount);
    event Spent(address indexed token, address indexed to, uint256 amount, string purpose);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event SpenderApproved(address indexed spender, bool approved);
    event ReporterAuthorized(address indexed reporter, bool allowed);

    // ── Errors ──
    error OnlyAdmin();
    error OnlyApprovedSpender();
    error OnlyAuthorizedReporter();
    error ZeroAddress();
    error InsufficientBalance();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    modifier onlySpender() {
        if (msg.sender != admin && !approvedSpenders[msg.sender]) revert OnlyApprovedSpender();
        _;
    }

    constructor(address _admin) {
        if (_admin == address(0)) revert ZeroAddress();
        admin = _admin;
    }

    /**
     * @notice Track received tokens (called by authorized reporters during fee distribution).
     * @dev P5-S11: Restricted to whitelisted reporters (vault contracts). Previously
     *      anyone could call this and inflate the lifetimeRevenue counter, polluting
     *      dashboards and any off-chain analytics that relied on it.
     */
    function notifyReceived(address token, uint256 amount) external {
        if (!authorizedReporters[msg.sender]) revert OnlyAuthorizedReporter();
        lifetimeRevenue[token] += amount;
        emit Received(token, msg.sender, amount);
    }

    /// @notice Authorize a contract (typically a vault or factory) to call notifyReceived.
    function setReporter(address reporter, bool allowed) external onlyAdmin {
        if (reporter == address(0)) revert ZeroAddress();
        authorizedReporters[reporter] = allowed;
        emit ReporterAuthorized(reporter, allowed);
    }

    /// @notice Spend treasury funds (only admin or approved spenders)
    function spend(
        address token,
        address to,
        uint256 amount,
        string calldata purpose
    ) external onlySpender nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (amount > bal) revert InsufficientBalance();

        IERC20(token).safeTransfer(to, amount);
        emit Spent(token, to, amount, purpose);
    }

    /// @notice Spend native 0G token (e.g. for grants)
    function spendNative(address payable to, uint256 amount, string calldata purpose) external onlyAdmin nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount > address(this).balance) revert InsufficientBalance();
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Native transfer failed");
        emit Spent(address(0), to, amount, purpose);
    }

    /// @notice Approve / revoke spender (delegate to multi-sig members or sub-DAO)
    function setSpender(address spender, bool approved) external onlyAdmin {
        approvedSpenders[spender] = approved;
        emit SpenderApproved(spender, approved);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
    }

    /// @notice Get token balance held by treasury
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    receive() external payable {
        emit Received(address(0), msg.sender, msg.value);
    }
}
