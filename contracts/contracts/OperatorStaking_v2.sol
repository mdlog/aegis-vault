// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IOperatorRegistry {
    function isRegistered(address wallet) external view returns (bool);
    function isActive(address wallet) external view returns (bool);
}

interface IInsurancePool {
    function notifySlashReceived(uint256 amount) external;
}

/**
 * @title OperatorStaking_v2
 * @notice Same economics as v1 (Bronze..Platinum tiers, 14-day cooldown, 50%
 *         per-call / 7-day-window slash caps). The only behavioral change is
 *         the addition of rescueToken() so an arbitrator can release any
 *         non-stakeToken ERC-20 that was accidentally sent to the contract.
 *         stakeToken (USDC) is explicitly blocked from rescueToken — legitimate
 *         stake must exit through requestUnstake / claimUnstake.
 */
contract OperatorStaking_v2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Tier {
        None,
        Bronze,
        Silver,
        Gold,
        Platinum
    }

    uint256 public constant BRONZE_THRESHOLD   = 1_000 * 1e6;
    uint256 public constant SILVER_THRESHOLD   = 10_000 * 1e6;
    uint256 public constant GOLD_THRESHOLD     = 100_000 * 1e6;
    uint256 public constant PLATINUM_THRESHOLD = 1_000_000 * 1e6;

    uint256 public constant CAP_NONE     = 5_000 * 1e6;
    uint256 public constant CAP_BRONZE   = 50_000 * 1e6;
    uint256 public constant CAP_SILVER   = 500_000 * 1e6;
    uint256 public constant CAP_GOLD     = 5_000_000 * 1e6;
    uint256 public constant CAP_PLATINUM = type(uint256).max;

    uint256 public constant UNSTAKE_COOLDOWN = 14 days;

    uint256 public constant MAX_SLASH_BPS = 5000;
    uint256 public constant SLASH_WINDOW = 7 days;
    uint256 public constant BPS = 10_000;

    IERC20 public immutable stakeToken;
    IOperatorRegistry public immutable registry;
    address public immutable insurancePool;
    address public arbitrator;

    struct Stake {
        uint256 amount;
        uint256 pendingUnstake;
        uint256 unstakeAvailableAt;
        uint256 lifetimeStaked;
        uint256 lifetimeSlashed;
        bool    frozen;
        uint256 windowStartAt;
        uint256 windowStartStake;
        uint256 windowSlashedTotal;
    }

    mapping(address => Stake) public stakes;
    address[] public stakerList;
    mapping(address => uint256) private stakerIndex;

    event Staked(address indexed operator, uint256 amount, uint256 newTotal);
    event UnstakeRequested(address indexed operator, uint256 amount, uint256 availableAt);
    event UnstakeClaimed(address indexed operator, uint256 amount);
    event Slashed(
        address indexed operator,
        uint256 amount,
        bytes32 indexed reasonHash,
        string reason
    );
    event StakerFrozen(address indexed operator);
    event StakerUnfrozen(address indexed operator);
    event ArbitratorChanged(address indexed previous, address indexed next);
    /// @notice v2: emitted when non-stakeToken is rescued by the arbitrator.
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    error ZeroAmount();
    error NotRegistered();
    error InsufficientStake();
    error UnstakeStillCooling();
    error NoUnstakeRequested();
    error AlreadyHasPendingUnstake();
    error Frozen();
    error NotFrozen();
    error NotArbitrator();
    error SlashTooLarge();
    error ZeroAddress();
    /// @notice v2: rescueToken was called with the protected stakeToken.
    error CannotRescueStakeToken();

    modifier onlyArbitrator() {
        if (msg.sender != arbitrator) revert NotArbitrator();
        _;
    }

    constructor(address _stakeToken, address _registry, address _insurancePool, address _arbitrator) {
        if (_stakeToken == address(0) || _registry == address(0) || _insurancePool == address(0) || _arbitrator == address(0)) {
            revert ZeroAddress();
        }
        stakeToken    = IERC20(_stakeToken);
        registry      = IOperatorRegistry(_registry);
        insurancePool = _insurancePool;
        arbitrator    = _arbitrator;
    }

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!registry.isRegistered(msg.sender)) revert NotRegistered();

        Stake storage s = stakes[msg.sender];
        if (s.frozen) revert Frozen();

        uint256 balBefore = stakeToken.balanceOf(address(this));
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = stakeToken.balanceOf(address(this)) - balBefore;
        if (received == 0) revert ZeroAmount();

        s.amount += received;
        s.lifetimeStaked += received;

        if (stakerIndex[msg.sender] == 0) {
            stakerList.push(msg.sender);
            stakerIndex[msg.sender] = stakerList.length;
        }

        emit Staked(msg.sender, received, s.amount);
    }

    function requestUnstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Stake storage s = stakes[msg.sender];
        if (s.frozen) revert Frozen();
        if (s.amount < amount) revert InsufficientStake();
        if (s.pendingUnstake != 0) revert AlreadyHasPendingUnstake();

        s.amount -= amount;
        s.pendingUnstake = amount;
        s.unstakeAvailableAt = block.timestamp + UNSTAKE_COOLDOWN;

        emit UnstakeRequested(msg.sender, amount, s.unstakeAvailableAt);
    }

    function claimUnstake() external nonReentrant {
        Stake storage s = stakes[msg.sender];
        if (s.frozen) revert Frozen();
        if (s.pendingUnstake == 0) revert NoUnstakeRequested();
        if (block.timestamp < s.unstakeAvailableAt) revert UnstakeStillCooling();

        uint256 amount = s.pendingUnstake;
        s.pendingUnstake = 0;
        s.unstakeAvailableAt = 0;

        stakeToken.safeTransfer(msg.sender, amount);
        emit UnstakeClaimed(msg.sender, amount);
    }

    function freeze(address operator) external onlyArbitrator {
        Stake storage s = stakes[operator];
        if (s.amount == 0 && s.pendingUnstake == 0) revert InsufficientStake();
        s.frozen = true;
        emit StakerFrozen(operator);
    }

    function unfreeze(address operator) external onlyArbitrator {
        Stake storage s = stakes[operator];
        if (!s.frozen) revert NotFrozen();
        s.frozen = false;
        emit StakerUnfrozen(operator);
    }

    function slash(address operator, uint256 amount, string calldata reason)
        external
        onlyArbitrator
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        Stake storage s = stakes[operator];
        uint256 totalSlashable = s.amount + s.pendingUnstake;
        if (totalSlashable == 0) revert InsufficientStake();

        uint256 maxPerCall = (totalSlashable * MAX_SLASH_BPS) / BPS;
        if (amount > maxPerCall) revert SlashTooLarge();

        if (s.windowStartAt == 0 || block.timestamp >= s.windowStartAt + SLASH_WINDOW) {
            s.windowStartAt = block.timestamp;
            s.windowStartStake = totalSlashable;
            s.windowSlashedTotal = 0;
        }
        uint256 maxPerWindow = (s.windowStartStake * MAX_SLASH_BPS) / BPS;
        if (s.windowSlashedTotal + amount > maxPerWindow) revert SlashTooLarge();
        s.windowSlashedTotal += amount;

        uint256 fromActive = amount > s.amount ? s.amount : amount;
        uint256 fromPending = amount - fromActive;
        s.amount -= fromActive;
        if (fromPending > 0) {
            s.pendingUnstake -= fromPending;
            if (s.pendingUnstake == 0) {
                s.unstakeAvailableAt = 0;
            }
        }
        s.lifetimeSlashed += amount;

        stakeToken.safeTransfer(insurancePool, amount);
        try IInsurancePool(insurancePool).notifySlashReceived(amount) {} catch {}

        bytes32 reasonHash = keccak256(bytes(reason));
        emit Slashed(operator, amount, reasonHash, reason);
    }

    function setArbitrator(address newArbitrator) external onlyArbitrator {
        if (newArbitrator == address(0)) revert ZeroAddress();
        address prev = arbitrator;
        arbitrator = newArbitrator;
        emit ArbitratorChanged(prev, newArbitrator);
    }

    // ── NEW in v2: rescue accidentally-sent non-stakeToken ──

    /**
     * @notice Release a non-stakeToken ERC-20 accidentally sent to this
     *         contract. The stakeToken (USDC) is explicitly blocked so a
     *         rogue arbitrator cannot drain legitimate stakes.
     */
    function rescueToken(address token, address to, uint256 amount) external onlyArbitrator nonReentrant {
        if (token == address(stakeToken)) revert CannotRescueStakeToken();
        if (token == address(0) || to == address(0) || amount == 0) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }

    // ── Views (unchanged from v1) ──

    function tierOf(address operator) public view returns (Tier) {
        uint256 amt = stakes[operator].amount;
        if (amt >= PLATINUM_THRESHOLD) return Tier.Platinum;
        if (amt >= GOLD_THRESHOLD)     return Tier.Gold;
        if (amt >= SILVER_THRESHOLD)   return Tier.Silver;
        if (amt >= BRONZE_THRESHOLD)   return Tier.Bronze;
        return Tier.None;
    }

    function maxVaultSize(address operator) external view returns (uint256) {
        Tier t = tierOf(operator);
        if (t == Tier.Platinum) return CAP_PLATINUM;
        if (t == Tier.Gold)     return CAP_GOLD;
        if (t == Tier.Silver)   return CAP_SILVER;
        if (t == Tier.Bronze)   return CAP_BRONZE;
        return CAP_NONE;
    }

    function getStake(address operator) external view returns (Stake memory) {
        return stakes[operator];
    }

    function totalStakers() external view returns (uint256) {
        return stakerList.length;
    }

    function totalStaked() external view returns (uint256 total) {
        uint256 len = stakerList.length;
        for (uint256 i = 0; i < len; i++) {
            total += stakes[stakerList[i]].amount + stakes[stakerList[i]].pendingUnstake;
        }
    }

    function getStakerPage(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory page)
    {
        uint256 total = stakerList.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 size = end - offset;
        page = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = stakerList[offset + i];
        }
    }

    /// @notice v2 marker for frontend/indexer routing.
    function version() external pure returns (string memory) { return "v2"; }
}
