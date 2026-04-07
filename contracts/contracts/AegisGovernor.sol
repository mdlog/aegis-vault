// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AegisGovernor
 * @notice Minimal M-of-N multi-sig governor for Aegis Vault protocol governance.
 *
 *         Owners can submit proposals (any contract call), other owners confirm them,
 *         and once the threshold is reached anyone can execute the proposal.
 *
 *         Used for:
 *         - Slashing arbitration (calls OperatorStaking.slash)
 *         - Treasury management (calls ProtocolTreasury.spend, ProtocolTreasury.setApprovedSpender)
 *         - Granting verified badges (calls OperatorReputation.setVerified)
 *         - Managing arbitrator role (calls OperatorStaking.setArbitrator)
 *         - Owner rotation (calls AegisGovernor.addOwner / removeOwner / changeThreshold via self-call)
 *
 *         Self-call pattern: owner-management functions can only be called by the governor itself
 *         via an executed proposal — i.e., owners must collectively agree to add/remove owners.
 */
contract AegisGovernor is ReentrancyGuard {
    // ── Storage ──
    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public threshold;

    /// @notice P5-S7: Monotonically increasing generation counter, bumped on every
    ///         owner-set change. Each Proposal records the generation at which it was
    ///         submitted; if the generation has advanced since, the proposal is stale
    ///         and cannot be confirmed or executed. This prevents removed owners from
    ///         retaining vote power on already-submitted proposals.
    uint256 public ownerGeneration;

    struct Proposal {
        address target;          // contract to call
        uint256 value;           // native 0G value to forward
        bytes   data;            // calldata
        string  description;     // human-readable summary
        address proposer;
        uint256 confirmations;
        bool    executed;
        bool    canceled;
        uint256 createdAt;
        uint256 executedAt;
        uint256 generation;      // ownerGeneration at submission time
    }

    Proposal[] public proposals;
    // proposalId => owner => confirmed?
    mapping(uint256 => mapping(address => bool)) public hasConfirmed;

    // ── Events ──
    event ProposalSubmitted(
        uint256 indexed id,
        address indexed proposer,
        address indexed target,
        uint256 value,
        string description
    );
    event ProposalConfirmed(uint256 indexed id, address indexed owner, uint256 confirmations);
    event ProposalRevoked(uint256 indexed id, address indexed owner, uint256 confirmations);
    event ProposalExecuted(uint256 indexed id, address indexed executor, bool success, bytes returnData);
    event ProposalCanceled(uint256 indexed id, address indexed canceler);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdChanged(uint256 previous, uint256 next);

    // ── Errors ──
    error NotOwner();
    error NotGovernor();
    error AlreadyOwner();
    error InvalidThreshold();
    error InvalidOwner();
    error ProposalNotFound();
    error AlreadyExecuted();
    error AlreadyConfirmed();
    error NotConfirmed();
    error NotEnoughConfirmations();
    error AlreadyCanceled();
    error CallFailed();
    error EmptyOwners();
    error NotProposer();
    error ProposalStale();

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    modifier onlyGovernor() {
        if (msg.sender != address(this)) revert NotGovernor();
        _;
    }

    constructor(address[] memory _owners, uint256 _threshold) {
        if (_owners.length == 0) revert EmptyOwners();
        if (_threshold == 0 || _threshold > _owners.length) revert InvalidThreshold();
        for (uint256 i = 0; i < _owners.length; i++) {
            address o = _owners[i];
            if (o == address(0) || isOwner[o]) revert InvalidOwner();
            isOwner[o] = true;
            owners.push(o);
            emit OwnerAdded(o);
        }
        threshold = _threshold;
        emit ThresholdChanged(0, _threshold);
    }

    receive() external payable {}

    // ── Proposal lifecycle ──

    function submit(address target, uint256 value, bytes calldata data, string calldata description)
        external
        onlyOwner
        returns (uint256 id)
    {
        id = proposals.length;
        proposals.push(Proposal({
            target: target,
            value: value,
            data: data,
            description: description,
            proposer: msg.sender,
            confirmations: 0,
            executed: false,
            canceled: false,
            createdAt: block.timestamp,
            executedAt: 0,
            generation: ownerGeneration
        }));
        emit ProposalSubmitted(id, msg.sender, target, value, description);

        // Auto-confirm by proposer
        _confirm(id, msg.sender);
    }

    function confirm(uint256 id) external onlyOwner {
        _confirm(id, msg.sender);
    }

    function _confirm(uint256 id, address voter) internal {
        if (id >= proposals.length) revert ProposalNotFound();
        Proposal storage p = proposals[id];
        if (p.executed) revert AlreadyExecuted();
        if (p.canceled) revert AlreadyCanceled();
        // P5-S7: Stale proposals (submitted before the latest owner-set change) are
        // invalidated to prevent removed owners' confirmations from carrying over.
        if (p.generation != ownerGeneration) revert ProposalStale();
        if (hasConfirmed[id][voter]) revert AlreadyConfirmed();
        hasConfirmed[id][voter] = true;
        p.confirmations += 1;
        emit ProposalConfirmed(id, voter, p.confirmations);
    }

    function revokeConfirmation(uint256 id) external onlyOwner {
        if (id >= proposals.length) revert ProposalNotFound();
        Proposal storage p = proposals[id];
        if (p.executed) revert AlreadyExecuted();
        if (!hasConfirmed[id][msg.sender]) revert NotConfirmed();
        hasConfirmed[id][msg.sender] = false;
        p.confirmations -= 1;
        emit ProposalRevoked(id, msg.sender, p.confirmations);
    }

    function execute(uint256 id) external nonReentrant {
        if (id >= proposals.length) revert ProposalNotFound();
        Proposal storage p = proposals[id];
        if (p.executed) revert AlreadyExecuted();
        if (p.canceled) revert AlreadyCanceled();
        // P5-S7: Stale proposals must be re-submitted under the new owner set.
        if (p.generation != ownerGeneration) revert ProposalStale();
        if (p.confirmations < threshold) revert NotEnoughConfirmations();

        p.executed = true;
        p.executedAt = block.timestamp;

        (bool success, bytes memory ret) = p.target.call{ value: p.value }(p.data);
        emit ProposalExecuted(id, msg.sender, success, ret);
        if (!success) revert CallFailed();
    }

    /**
     * @notice Cancel a pending proposal.
     * @dev P5-S6: Cancellation is restricted to the original proposer ONLY. Previously
     *      ANY single owner could cancel ANY proposal, allowing one rogue/compromised
     *      key to grief governance by spam-canceling every submission. Self-cancellation
     *      is reasonable: the proposer can withdraw their own proposal. To override
     *      another owner's proposal, the multi-sig must instead reach threshold and
     *      execute a counter-proposal.
     */
    function cancel(uint256 id) external onlyOwner {
        if (id >= proposals.length) revert ProposalNotFound();
        Proposal storage p = proposals[id];
        if (p.executed) revert AlreadyExecuted();
        if (p.canceled) revert AlreadyCanceled();
        if (msg.sender != p.proposer) revert NotProposer();
        p.canceled = true;
        emit ProposalCanceled(id, msg.sender);
    }

    // ── Owner management (must be called via executed proposal) ──

    function addOwner(address newOwner) external onlyGovernor {
        if (newOwner == address(0)) revert InvalidOwner();
        if (isOwner[newOwner]) revert AlreadyOwner();
        isOwner[newOwner] = true;
        owners.push(newOwner);
        ownerGeneration += 1; // P5-S7: invalidate prior proposals
        emit OwnerAdded(newOwner);
    }

    function removeOwner(address oldOwner) external onlyGovernor {
        if (!isOwner[oldOwner]) revert NotOwner();
        // Safety: never allow the governor to reach zero owners — that would brick
        // the contract (threshold would auto-lower to 0, letting any pending proposal
        // execute without confirmations).
        if (owners.length <= 1) revert InvalidOwner();
        isOwner[oldOwner] = false;
        // Remove from owners array (preserve order via swap-and-pop)
        uint256 len = owners.length;
        for (uint256 i = 0; i < len; i++) {
            if (owners[i] == oldOwner) {
                owners[i] = owners[len - 1];
                owners.pop();
                break;
            }
        }
        if (threshold > owners.length) {
            uint256 prev = threshold;
            threshold = owners.length;
            emit ThresholdChanged(prev, threshold);
        }
        ownerGeneration += 1; // P5-S7: invalidate prior proposals
        emit OwnerRemoved(oldOwner);
    }

    function changeThreshold(uint256 newThreshold) external onlyGovernor {
        if (newThreshold == 0 || newThreshold > owners.length) revert InvalidThreshold();
        uint256 prev = threshold;
        threshold = newThreshold;
        ownerGeneration += 1; // P5-S7: invalidate prior proposals
        emit ThresholdChanged(prev, newThreshold);
    }

    // ── Views ──

    function totalProposals() external view returns (uint256) {
        return proposals.length;
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        if (id >= proposals.length) revert ProposalNotFound();
        return proposals[id];
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function ownerCount() external view returns (uint256) {
        return owners.length;
    }
}
