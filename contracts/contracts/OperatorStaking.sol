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
 * @title OperatorStaking
 * @notice Skin-in-the-game escrow for operators. Operators must lock USDC stake to be eligible
 *         to manage vaults above certain size thresholds. Stake can be slashed by governance
 *         (multi-sig arbitration) for proven misbehavior, with proceeds flowing to the
 *         insurance pool that compensates affected vault owners.
 *
 *         Stake tiers (USDC):
 *         - None      : 0          → can manage vaults up to $5k
 *         - Bronze    : 1,000      → up to $50k
 *         - Silver    : 10,000     → up to $500k
 *         - Gold      : 100,000    → up to $5M
 *         - Platinum  : 1,000,000  → unlimited
 *
 *         Withdrawal rules:
 *         - Operators can request unstake at any time, but funds enter a 14-day cooldown.
 *         - During cooldown the stake remains slashable.
 *         - After cooldown, operator can claim their stake.
 *         - If a slash arbitration is opened, withdrawal is frozen until resolution.
 */
contract OperatorStaking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Stake tiers ──
    enum Tier {
        None,
        Bronze,
        Silver,
        Gold,
        Platinum
    }

    // Tier thresholds (USDC, 6 decimals)
    uint256 public constant BRONZE_THRESHOLD   = 1_000 * 1e6;
    uint256 public constant SILVER_THRESHOLD   = 10_000 * 1e6;
    uint256 public constant GOLD_THRESHOLD     = 100_000 * 1e6;
    uint256 public constant PLATINUM_THRESHOLD = 1_000_000 * 1e6;

    // Vault size caps per tier (USDC, 6 decimals). type(uint256).max = unlimited.
    uint256 public constant CAP_NONE     = 5_000 * 1e6;
    uint256 public constant CAP_BRONZE   = 50_000 * 1e6;
    uint256 public constant CAP_SILVER   = 500_000 * 1e6;
    uint256 public constant CAP_GOLD     = 5_000_000 * 1e6;
    uint256 public constant CAP_PLATINUM = type(uint256).max;

    // Withdrawal cooldown
    uint256 public constant UNSTAKE_COOLDOWN = 14 days;

    // Slashing caps
    /// @notice Single-action cap: max 50% of total slashable stake per slash() call
    uint256 public constant MAX_SLASH_BPS = 5000;
    /// @notice P5-S9: Per-window cap. Cumulative slashing within a SLASH_WINDOW
    ///         cannot exceed MAX_SLASH_BPS of the stake at the start of the window.
    ///         Prevents the multi-call bypass where governance slashes 50% three
    ///         times in a row to drain the operator entirely.
    uint256 public constant SLASH_WINDOW = 7 days;
    uint256 public constant BPS = 10_000;

    // ── Storage ──
    IERC20 public immutable stakeToken; // USDC
    IOperatorRegistry public immutable registry;
    address public immutable insurancePool; // receives slashed funds
    address public arbitrator; // multi-sig that can slash

    struct Stake {
        uint256 amount;             // active stake amount
        uint256 pendingUnstake;     // amount in cooldown
        uint256 unstakeAvailableAt; // timestamp when pending becomes claimable
        uint256 lifetimeStaked;     // analytics
        uint256 lifetimeSlashed;    // analytics
        bool    frozen;             // true if arbitration in progress
        // P5-S9: per-window slash tracking
        uint256 windowStartAt;      // timestamp when current slash window opened
        uint256 windowStartStake;   // (amount + pendingUnstake) at window start
        uint256 windowSlashedTotal; // cumulative slashed in this window
    }

    mapping(address => Stake) public stakes;
    address[] public stakerList;
    mapping(address => uint256) private stakerIndex; // wallet => index+1

    // ── Events ──
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

    // ── Errors ──
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

    // ── Modifiers ──
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

    // ── Stake ──

    /**
     * @notice Operator deposits stake. Must already be registered in OperatorRegistry.
     * @dev P5-S8: Credits the operator with the ACTUAL received amount (post-transfer
     *      balance delta), not the requested amount. This makes the contract safe with
     *      fee-on-transfer tokens like USDT-on-some-bridges. Without this, the LAST
     *      operator to unstake would be unable to withdraw because totalStaked exceeds
     *      the actual contract balance.
     */
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

    /**
     * @notice Request to unstake. Funds enter a 14-day cooldown.
     *         During cooldown they remain slashable. Only one pending unstake at a time.
     */
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

    /**
     * @notice Claim a pending unstake after the cooldown has elapsed.
     */
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

    // ── Slashing (arbitrator only) ──

    /**
     * @notice Freeze an operator's stake while arbitration is in progress.
     *         Prevents the operator from withdrawing or unstaking.
     * @dev Only allows freezing wallets that currently have a stake, so the
     *      arbitrator cannot pre-freeze arbitrary wallets and block them from
     *      ever staking.
     */
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

    /**
     * @notice Slash an operator's stake. Slashed funds go to the insurance pool.
     *         Can slash from BOTH active stake and pending unstake.
     *
     *         Two compounding caps:
     *           - Per-call: max 50% of (active + pending) at this exact moment
     *           - Per-window (P5-S9): cumulative slashing within SLASH_WINDOW (7 days)
     *             cannot exceed 50% of the stake observed at the start of the window.
     *             This blocks the multi-call wipeout: 100k → 50k → 25k → 12.5k... in
     *             a single transaction.
     */
    function slash(address operator, uint256 amount, string calldata reason)
        external
        onlyArbitrator
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        Stake storage s = stakes[operator];
        uint256 totalSlashable = s.amount + s.pendingUnstake;
        if (totalSlashable == 0) revert InsufficientStake();

        // Per-call cap (50% of current slashable)
        uint256 maxPerCall = (totalSlashable * MAX_SLASH_BPS) / BPS;
        if (amount > maxPerCall) revert SlashTooLarge();

        // P5-S9: Per-window cap (50% of stake at window start, rolling 7d window)
        if (s.windowStartAt == 0 || block.timestamp >= s.windowStartAt + SLASH_WINDOW) {
            // Open a new window — snapshot current slashable
            s.windowStartAt = block.timestamp;
            s.windowStartStake = totalSlashable;
            s.windowSlashedTotal = 0;
        }
        uint256 maxPerWindow = (s.windowStartStake * MAX_SLASH_BPS) / BPS;
        if (s.windowSlashedTotal + amount > maxPerWindow) revert SlashTooLarge();
        s.windowSlashedTotal += amount;

        // Slash from active first, then from pending
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
        // Best-effort accounting notification to the pool (totalSlashReceived tracker).
        // Wrapped in try/catch so a stale pool version never blocks slashing.
        try IInsurancePool(insurancePool).notifySlashReceived(amount) {} catch {}

        bytes32 reasonHash = keccak256(bytes(reason));
        emit Slashed(operator, amount, reasonHash, reason);
    }

    // ── Admin ──

    function setArbitrator(address newArbitrator) external onlyArbitrator {
        if (newArbitrator == address(0)) revert ZeroAddress();
        address prev = arbitrator;
        arbitrator = newArbitrator;
        emit ArbitratorChanged(prev, newArbitrator);
    }

    // ── Views ──

    /**
     * @notice Compute current tier of an operator based on active stake (excludes pending).
     */
    function tierOf(address operator) public view returns (Tier) {
        uint256 amt = stakes[operator].amount;
        if (amt >= PLATINUM_THRESHOLD) return Tier.Platinum;
        if (amt >= GOLD_THRESHOLD)     return Tier.Gold;
        if (amt >= SILVER_THRESHOLD)   return Tier.Silver;
        if (amt >= BRONZE_THRESHOLD)   return Tier.Bronze;
        return Tier.None;
    }

    /**
     * @notice Returns the maximum NAV (USDC, 6 decimals) an operator is eligible to manage.
     */
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
        // Note: O(n) — clients should prefer indexer for large lists.
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
}
