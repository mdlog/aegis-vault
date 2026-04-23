// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title InsurancePool_v2
 * @notice Same claim / deposit / payout mechanics as v1. The only behavioral
 *         change is the addition of rescueToken() so the arbitrator can release
 *         any non-payoutToken ERC-20 that was accidentally sent to the
 *         contract. The payoutToken (USDC) is explicitly blocked — legitimate
 *         claims must exit through payoutClaim().
 */
contract InsurancePool_v2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable payoutToken;
    address public arbitrator;

    uint256 public totalDeposited;
    uint256 public totalSlashReceived;
    uint256 public totalPaidOut;
    uint256 public claimCount;

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

    mapping(address => uint256) public openClaimId;
    uint256 public constant MAX_REASON_LENGTH = 512;

    event Deposited(address indexed from, uint256 amount, string source);
    event SlashReceived(address indexed from, uint256 amount);
    event ClaimSubmitted(uint256 indexed claimId, address indexed claimant, uint256 amount, string reason);
    event ClaimPaid(uint256 indexed claimId, address indexed claimant, uint256 amount);
    event ArbitratorChanged(address indexed previous, address indexed next);
    event NotifierAuthorized(address indexed notifier, bool allowed);
    /// @notice v2: emitted when non-payoutToken is rescued by the arbitrator.
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error NotArbitrator();
    error NotAuthorized();
    error InsufficientFunds();
    error ClaimNotFound();
    error AlreadyPaid();
    error ReasonTooLong();
    error AlreadyHasOpenClaim();
    /// @notice v2: rescueToken was called with the protected payoutToken.
    error CannotRescuePayoutToken();

    modifier onlyArbitrator() {
        if (msg.sender != arbitrator) revert NotArbitrator();
        _;
    }

    constructor(address _payoutToken, address _arbitrator) {
        if (_payoutToken == address(0) || _arbitrator == address(0)) revert ZeroAddress();
        payoutToken = IERC20(_payoutToken);
        arbitrator  = _arbitrator;
    }

    function deposit(uint256 amount, string calldata source) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        payoutToken.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
        emit Deposited(msg.sender, amount, source);
    }

    function notifySlashReceived(uint256 amount) external {
        if (!authorizedNotifiers[msg.sender]) revert NotAuthorized();
        if (amount == 0) revert ZeroAmount();
        totalSlashReceived += amount;
        emit SlashReceived(msg.sender, amount);
    }

    function setNotifier(address notifier, bool allowed) external onlyArbitrator {
        if (notifier == address(0)) revert ZeroAddress();
        authorizedNotifiers[notifier] = allowed;
        emit NotifierAuthorized(notifier, allowed);
    }

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

    function payoutClaim(uint256 claimId, uint256 actualAmount) external onlyArbitrator nonReentrant {
        Claim storage c = claims[claimId];
        if (c.claimant == address(0)) revert ClaimNotFound();
        if (c.paid) revert AlreadyPaid();
        if (actualAmount == 0) revert ZeroAmount();
        if (actualAmount > payoutToken.balanceOf(address(this))) revert InsufficientFunds();

        c.paid = true;
        c.paidAt = block.timestamp;
        totalPaidOut += actualAmount;
        openClaimId[c.claimant] = 0;

        payoutToken.safeTransfer(c.claimant, actualAmount);
        emit ClaimPaid(claimId, c.claimant, actualAmount);
    }

    function rejectClaim(uint256 claimId) external onlyArbitrator {
        Claim storage c = claims[claimId];
        if (c.claimant == address(0)) revert ClaimNotFound();
        if (c.paid) revert AlreadyPaid();
        c.paid = true;
        c.paidAt = block.timestamp;
        openClaimId[c.claimant] = 0;
        emit ClaimPaid(claimId, c.claimant, 0);
    }

    function setArbitrator(address newArbitrator) external onlyArbitrator {
        if (newArbitrator == address(0)) revert ZeroAddress();
        address prev = arbitrator;
        arbitrator = newArbitrator;
        emit ArbitratorChanged(prev, newArbitrator);
    }

    // ── NEW in v2: rescue accidentally-sent non-payoutToken ──

    /**
     * @notice Release a non-payoutToken ERC-20 accidentally sent to this
     *         contract. The payoutToken (USDC) is explicitly blocked — a
     *         rogue arbitrator cannot use this path to bypass the claim
     *         queue or drain insured funds.
     */
    function rescueToken(address token, address to, uint256 amount) external onlyArbitrator nonReentrant {
        if (token == address(payoutToken)) revert CannotRescuePayoutToken();
        if (token == address(0) || to == address(0) || amount == 0) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }

    function balance() external view returns (uint256) {
        return payoutToken.balanceOf(address(this));
    }

    /// @notice v2 marker for frontend/indexer routing.
    function version() external pure returns (string memory) { return "v2"; }
}
