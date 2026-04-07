// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title InsurancePool
 * @notice Holds slashed operator funds plus a portion of protocol revenue.
 *         Pays out claims to vault owners damaged by operator misbehavior, after
 *         arbitrator approval.
 *
 *         Funding sources:
 *         - Slashed stake from OperatorStaking
 *         - Voluntary deposits from anyone
 *         - Optional split from ProtocolTreasury (Phase 4)
 *
 *         Claim flow:
 *         1. Damaged user submits claim (off-chain or via submitClaim).
 *         2. Arbitrator (multi-sig) reviews evidence.
 *         3. Arbitrator approves and pays out via payoutClaim.
 *
 *         Phase 2 keeps the claim flow simple — full arbitration UI lands in Phase 4.
 */
contract InsurancePool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable payoutToken; // USDC
    address public arbitrator;

    uint256 public totalDeposited;       // voluntary deposits only
    uint256 public totalSlashReceived;   // notified from OperatorStaking.slash()
    uint256 public totalPaidOut;
    uint256 public claimCount;

    /// @notice Whitelist of contracts permitted to call notifySlashReceived().
    ///         Set by arbitrator (multi-sig in production).
    mapping(address => bool) public authorizedNotifiers;

    struct Claim {
        address claimant;
        uint256 amount;
        string  reason;
        uint256 submittedAt;
        bool    paid;
        uint256 paidAt;
    }

    mapping(uint256 => Claim) public claims;

    /// @notice P5-S12: Track pending (unpaid) claims per claimant to prevent spam.
    ///         A claimant can only have ONE open claim at a time. They must wait for
    ///         the arbitrator to act before submitting another. Plus a 512-byte cap on
    ///         the reason string. These two together cap the storage cost an attacker
    ///         can inflict per address.
    mapping(address => uint256) public openClaimId; // 0 = no open claim
    uint256 public constant MAX_REASON_LENGTH = 512;

    event Deposited(address indexed from, uint256 amount, string source);
    event SlashReceived(address indexed from, uint256 amount);
    event ClaimSubmitted(uint256 indexed claimId, address indexed claimant, uint256 amount, string reason);
    event ClaimPaid(uint256 indexed claimId, address indexed claimant, uint256 amount);
    event ArbitratorChanged(address indexed previous, address indexed next);
    event NotifierAuthorized(address indexed notifier, bool allowed);

    error ZeroAddress();
    error ZeroAmount();
    error NotArbitrator();
    error NotAuthorized();
    error InsufficientFunds();
    error ClaimNotFound();
    error AlreadyPaid();
    error ReasonTooLong();
    error AlreadyHasOpenClaim();

    modifier onlyArbitrator() {
        if (msg.sender != arbitrator) revert NotArbitrator();
        _;
    }

    constructor(address _payoutToken, address _arbitrator) {
        if (_payoutToken == address(0) || _arbitrator == address(0)) revert ZeroAddress();
        payoutToken = IERC20(_payoutToken);
        arbitrator  = _arbitrator;
    }

    /**
     * @notice Deposit funds into the insurance pool. Anyone may call.
     * @param source Free-form tag for accounting (e.g. "treasury", "donation")
     */
    function deposit(uint256 amount, string calldata source) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        payoutToken.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
        emit Deposited(msg.sender, amount, source);
    }

    /**
     * @notice Notify the pool that slashed funds have arrived via direct transfer
     *         (OperatorStaking.slash() uses safeTransfer, bypassing deposit()).
     *         Callers must have already transferred the funds before calling.
     * @dev Restricted to authorized notifiers (set by arbitrator). The funds
     *      themselves are validated by the safeTransfer that precedes this call;
     *      this function only updates the accounting counter.
     */
    function notifySlashReceived(uint256 amount) external {
        if (!authorizedNotifiers[msg.sender]) revert NotAuthorized();
        if (amount == 0) revert ZeroAmount();
        totalSlashReceived += amount;
        emit SlashReceived(msg.sender, amount);
    }

    /**
     * @notice Authorize/deauthorize a contract to call notifySlashReceived().
     *         Typically the OperatorStaking contract.
     */
    function setNotifier(address notifier, bool allowed) external onlyArbitrator {
        if (notifier == address(0)) revert ZeroAddress();
        authorizedNotifiers[notifier] = allowed;
        emit NotifierAuthorized(notifier, allowed);
    }

    /**
     * @notice Submit a claim for review. Arbitrator decides whether to pay.
     * @dev P5-S12: Spam-resistant. A claimant can only have ONE open claim at a time
     *      (must be paid OR explicitly closed via arbitrator action), and the reason
     *      string is capped at MAX_REASON_LENGTH bytes.
     */
    function submitClaim(uint256 amount, string calldata reason) external returns (uint256 claimId) {
        if (amount == 0) revert ZeroAmount();
        if (bytes(reason).length > MAX_REASON_LENGTH) revert ReasonTooLong();
        if (openClaimId[msg.sender] != 0) revert AlreadyHasOpenClaim();

        claimId = ++claimCount;
        claims[claimId] = Claim({
            claimant: msg.sender,
            amount: amount,
            reason: reason,
            submittedAt: block.timestamp,
            paid: false,
            paidAt: 0
        });
        openClaimId[msg.sender] = claimId;
        emit ClaimSubmitted(claimId, msg.sender, amount, reason);
    }

    /**
     * @notice Approve and pay out a claim. Arbitrator may pay a different amount than requested.
     */
    function payoutClaim(uint256 claimId, uint256 actualAmount) external onlyArbitrator nonReentrant {
        Claim storage c = claims[claimId];
        if (c.claimant == address(0)) revert ClaimNotFound();
        if (c.paid) revert AlreadyPaid();
        if (actualAmount == 0) revert ZeroAmount();
        if (actualAmount > payoutToken.balanceOf(address(this))) revert InsufficientFunds();

        c.paid = true;
        c.paidAt = block.timestamp;
        totalPaidOut += actualAmount;
        // P5-S12: Free up the claimant's open-claim slot so they can submit again later
        openClaimId[c.claimant] = 0;

        payoutToken.safeTransfer(c.claimant, actualAmount);
        emit ClaimPaid(claimId, c.claimant, actualAmount);
    }

    /// @notice Close a claim without payout (e.g., rejected after review).
    /// @dev P5-S12: Releases the claimant's open-claim slot so they can submit a
    ///      revised claim. Only the arbitrator can reject.
    function rejectClaim(uint256 claimId) external onlyArbitrator {
        Claim storage c = claims[claimId];
        if (c.claimant == address(0)) revert ClaimNotFound();
        if (c.paid) revert AlreadyPaid();
        c.paid = true; // mark closed (no funds sent)
        c.paidAt = block.timestamp;
        openClaimId[c.claimant] = 0;
        emit ClaimPaid(claimId, c.claimant, 0); // amount=0 signals rejection
    }

    function setArbitrator(address newArbitrator) external onlyArbitrator {
        if (newArbitrator == address(0)) revert ZeroAddress();
        address prev = arbitrator;
        arbitrator = newArbitrator;
        emit ArbitratorChanged(prev, newArbitrator);
    }

    function balance() external view returns (uint256) {
        return payoutToken.balanceOf(address(this));
    }
}
