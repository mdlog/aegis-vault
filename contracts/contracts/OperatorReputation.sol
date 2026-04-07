// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title OperatorReputation
 * @notice On-chain reputation registry for operators. Tracks execution stats, vault attestations,
 *         user ratings, and a "verified" badge granted by protocol governance.
 *
 *         Sources of truth:
 *         - Vaults call recordExecution() after each successful executeIntent (must be authorized).
 *         - Users call submitRating() once per (vault, operator) pair.
 *         - Protocol admin (multi-sig) toggles the verified badge.
 *
 *         Anti-gaming:
 *         - Only authorized recorders (vaults, registered via setRecorder by protocol admin)
 *           can write execution stats. This prevents operators from inflating their own numbers.
 *         - Each rating is keyed by (vault, rater) — one rating per vault owner per operator.
 */
contract OperatorReputation {
    // ── Storage ──
    address public admin;

    // Authorized contracts that may write stats (typically the AegisVaultFactory + each vault clone).
    // For simplicity in Phase 3 we authorize the factory which then authorizes its vaults.
    mapping(address => bool) public authorizedRecorders;

    struct Stats {
        uint256 totalExecutions;     // count of recorded executions
        uint256 successfulExecutions; // executions reported as success
        uint256 totalVolumeUsd6;     // cumulative notional in USDC 6-decimals
        int256  cumulativePnlUsd6;   // cumulative realized PnL (signed)
        uint256 lastExecutionAt;     // most recent execution timestamp
        uint256 firstExecutionAt;    // first execution timestamp
        uint256 ratingCount;         // total ratings received
        uint256 ratingSumScaled;     // sum of ratings scaled (1..5 stars)
        bool    verified;            // protocol-issued verified badge
    }

    mapping(address => Stats) public stats;

    // (operator => rater => already rated?)
    mapping(address => mapping(address => bool)) public hasRated;

    /// @notice P5-S10: Sybil resistance — only addresses with a recorded execution
    ///         on the operator (i.e. they actually used them) can submit a rating.
    ///         The vault calls markEligibleRater() when it routes a withdraw or
    ///         a successful executeIntent so that genuine users can rate.
    ///         (operator => potential rater => eligible?)
    mapping(address => mapping(address => bool)) public eligibleRater;

    // ── Events ──
    event ExecutionRecorded(
        address indexed operator,
        address indexed vault,
        uint256 volumeUsd6,
        int256 pnlUsd6,
        bool success,
        uint256 timestamp
    );
    event RatingSubmitted(
        address indexed operator,
        address indexed rater,
        uint8 stars,
        string comment
    );
    event RecorderAuthorized(address indexed recorder, bool allowed);
    event VerifiedBadgeChanged(address indexed operator, bool verified);
    event AdminTransferred(address indexed previous, address indexed next);

    // ── Errors ──
    error NotAdmin();
    error NotAuthorized();
    error AlreadyRated();
    error InvalidRating();
    error ZeroAddress();
    error NotEligibleToRate();
    error CommentTooLong();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAuthorized() {
        if (!authorizedRecorders[msg.sender]) revert NotAuthorized();
        _;
    }

    constructor(address _admin) {
        if (_admin == address(0)) revert ZeroAddress();
        admin = _admin;
    }

    // ── Admin ──
    function setRecorder(address recorder, bool allowed) external onlyAdmin {
        authorizedRecorders[recorder] = allowed;
        emit RecorderAuthorized(recorder, allowed);
    }

    function setVerified(address operator, bool verified) external onlyAdmin {
        stats[operator].verified = verified;
        emit VerifiedBadgeChanged(operator, verified);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address prev = admin;
        admin = newAdmin;
        emit AdminTransferred(prev, newAdmin);
    }

    // ── Recording (only authorized vaults) ──
    function recordExecution(
        address operator,
        uint256 volumeUsd6,
        int256 pnlUsd6,
        bool success
    ) external onlyAuthorized {
        Stats storage s = stats[operator];
        s.totalExecutions += 1;
        if (success) {
            s.successfulExecutions += 1;
        }
        s.totalVolumeUsd6 += volumeUsd6;
        s.cumulativePnlUsd6 += pnlUsd6;
        s.lastExecutionAt = block.timestamp;
        if (s.firstExecutionAt == 0) {
            s.firstExecutionAt = block.timestamp;
        }
        emit ExecutionRecorded(operator, msg.sender, volumeUsd6, pnlUsd6, success, block.timestamp);
    }

    /**
     * @notice P5-S10: Mark a wallet as eligible to rate the given operator.
     *         Called by an authorized recorder (typically the vault) when it can
     *         attest the rater is a real user of the operator (e.g., the vault
     *         owner whose vault used this operator). Sybil-resistant gate.
     */
    function markEligibleRater(address operator, address rater) external onlyAuthorized {
        if (operator == address(0) || rater == address(0)) revert ZeroAddress();
        eligibleRater[operator][rater] = true;
    }

    // ── User ratings ──
    /**
     * @notice Submit a 1..5 star rating with optional comment.
     * @dev P5-S10: Caller must be marked as eligibleRater for the operator.
     *      Comment is capped at 256 chars to prevent gas griefing of indexers.
     *      One rating per (operator, rater) pair.
     */
    function submitRating(address operator, uint8 stars, string calldata comment) external {
        if (stars < 1 || stars > 5) revert InvalidRating();
        if (bytes(comment).length > 256) revert CommentTooLong();
        if (!eligibleRater[operator][msg.sender]) revert NotEligibleToRate();
        if (hasRated[operator][msg.sender]) revert AlreadyRated();
        hasRated[operator][msg.sender] = true;

        Stats storage s = stats[operator];
        s.ratingCount += 1;
        s.ratingSumScaled += stars;

        emit RatingSubmitted(operator, msg.sender, stars, comment);
    }

    // ── Views ──

    function getStats(address operator) external view returns (Stats memory) {
        return stats[operator];
    }

    /**
     * @notice Returns success rate in basis points (10000 = 100%).
     */
    function successRateBps(address operator) external view returns (uint256) {
        Stats storage s = stats[operator];
        if (s.totalExecutions == 0) return 0;
        return (s.successfulExecutions * 10_000) / s.totalExecutions;
    }

    /**
     * @notice Returns average rating scaled by 100 (e.g. 423 = 4.23 stars).
     */
    function averageRatingScaled(address operator) external view returns (uint256) {
        Stats storage s = stats[operator];
        if (s.ratingCount == 0) return 0;
        return (s.ratingSumScaled * 100) / s.ratingCount;
    }
}
