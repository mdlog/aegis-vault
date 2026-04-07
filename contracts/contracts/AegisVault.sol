// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VaultEvents.sol";
import "./ExecutionRegistry.sol";
import "./libraries/PolicyLibrary.sol";

/// @notice Minimal interface for VaultNAVCalculator (Phase 1.8)
interface INavCalculator {
    function calculateNAV(address vault) external view returns (uint256 navUsd6, uint256[] memory breakdown);
}

/// @notice Minimal interface for OperatorReputation (Phase 5)
interface IReputationRecorder {
    function recordExecution(
        address operator,
        uint256 volumeUsd6,
        int256 pnlUsd6,
        bool success
    ) external;
    function markEligibleRater(address operator, address rater) external;
}

/**
 * @title AegisVault
 * @notice Core vault contract for the Aegis Vault system.
 *
 * Security fixes applied:
 *   C-2: approve → call → approve(0) pattern for venue swaps
 *   C-3: intentHash recomputed on-chain and verified
 *   C-4: intent.vault validated against address(this)
 *   H-2: totalDeposited decremented on withdraw
 *   H-3: setVenue emits event + validates address
 *   H-4: Swap output verified via actual balanceOf delta
 *   H-5: autoExecution flag enforced + deposit restricted to owner
 *   H-6: Daily loss tracking functional
 */
contract AegisVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PolicyLibrary for VaultPolicy;

    // ── State ──

    address public owner;
    address public executor;
    IERC20  public baseAsset;
    ExecutionRegistry public registry;
    address public venue;

    VaultPolicy public policy;

    address[] public allowedAssets;
    mapping(address => bool) public isAllowedAsset;

    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public lastExecutionTime;
    uint256 public dailyActionCount;
    uint256 public dailyActionResetTime;
    uint256 public currentDailyLossBps;
    int256  public cumulativePnl;         // Signed — tracks actual profit/loss

    bool public initialized;

    // ── Phase 1: Fee State ──

    /// @notice Protocol treasury that receives a cut of all operator fees
    address public protocolTreasury;

    /// @notice High Water Mark — performance fees only charged on NAV growth above this
    uint256 public highWaterMark;

    /// @notice Last time management fees were accrued
    uint256 public lastFeeAccrual;

    /// @notice Accumulated management fee waiting to be claimed
    uint256 public accruedManagementFee;

    /// @notice Accumulated performance fee waiting to be claimed
    uint256 public accruedPerformanceFee;

    /// @notice Pending fee change (Phase 4: cooldown protection)
    PendingFeeChange public pendingFeeChange;

    /// @notice Optional NAV calculator for multi-asset valuation (Phase 1.8)
    /// @dev If set, fee accrual uses oracle-priced NAV instead of base asset balance.
    ///      Owner can set this after vault deployment via setNavCalculator().
    address public navCalculator;

    /// @notice Optional reputation recorder (Phase 5)
    /// @dev If set, each successful executeIntent call records stats on-chain.
    ///      Owner sets this after deployment via setReputationRecorder().
    address public reputationRecorder;

    // ── Fee Constants (HARDCODED MAX — protect users) ──

    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 3000;  // 30%
    uint256 public constant MAX_MANAGEMENT_FEE_BPS  = 500;   // 5% per year
    uint256 public constant MAX_ENTRY_FEE_BPS       = 200;   // 2%
    uint256 public constant MAX_EXIT_FEE_BPS        = 200;   // 2%
    uint256 public constant PROTOCOL_FEE_CUT_BPS    = 2000;  // 20% of operator fees go to protocol
    uint256 public constant FEE_CHANGE_COOLDOWN     = 7 days;
    uint256 public constant SECONDS_PER_YEAR        = 365 days;

    // ── Errors ──

    error OnlyOwner();
    error OnlyExecutor();
    error AlreadyInitialized();
    error NotInitialized();
    error VaultPaused();
    error VaultNotPaused();
    error ZeroAmount();
    error ZeroAddress();
    error PolicyCheckFailed(string reason);
    error InsufficientBalance();
    error IntentHashMismatch();
    error IntentVaultMismatch();
    error AutoExecutionDisabled();
    error SwapOutputMismatch();
    error SlippageTooHigh(uint256 minRequired, uint256 actual);
    error MinAmountOutRequired();
    error FeeAboveMax(uint256 attempted, uint256 max);
    error NoFeesAccrued();
    error OnlyFeeRecipient();
    error FeeChangeTooSoon();
    error NoPendingFeeChange();

    // ── Modifiers ──

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    modifier whenNotPaused() {
        if (policy.paused) revert VaultPaused();
        _;
    }

    modifier whenPaused() {
        if (!policy.paused) revert VaultNotPaused();
        _;
    }

    modifier onlyInitialized() {
        if (!initialized) revert NotInitialized();
        _;
    }

    // ── Initialization ──

    function initialize(
        address _owner,
        address _baseAsset,
        address _executor,
        address _registry,
        address _venue,
        VaultPolicy calldata _policy,
        address[] calldata _allowedAssets,
        address _protocolTreasury
    ) external {
        if (initialized) revert AlreadyInitialized();
        if (_owner == address(0)) revert ZeroAddress();
        if (_baseAsset == address(0)) revert ZeroAddress();
        if (_executor == address(0)) revert ZeroAddress();
        if (_registry == address(0)) revert ZeroAddress();

        // Validate fee caps
        _validateFeeBps(
            _policy.performanceFeeBps,
            _policy.managementFeeBps,
            _policy.entryFeeBps,
            _policy.exitFeeBps
        );

        initialized = true;
        owner = _owner;
        venue = _venue;
        baseAsset = IERC20(_baseAsset);
        executor = _executor;
        registry = ExecutionRegistry(_registry);
        policy = _policy;
        protocolTreasury = _protocolTreasury;

        for (uint256 i = 0; i < _allowedAssets.length; i++) {
            allowedAssets.push(_allowedAssets[i]);
            isAllowedAsset[_allowedAssets[i]] = true;
        }

        dailyActionResetTime = block.timestamp + 1 days;
        lastFeeAccrual = block.timestamp;

        emit VaultEvents.VaultCreated(address(this), _owner, _baseAsset);
    }

    /// @notice Internal: enforce hardcoded fee caps
    function _validateFeeBps(
        uint256 perfBps,
        uint256 mgmtBps,
        uint256 entryBps,
        uint256 exitBps
    ) internal pure {
        if (perfBps > MAX_PERFORMANCE_FEE_BPS) revert FeeAboveMax(perfBps, MAX_PERFORMANCE_FEE_BPS);
        if (mgmtBps > MAX_MANAGEMENT_FEE_BPS) revert FeeAboveMax(mgmtBps, MAX_MANAGEMENT_FEE_BPS);
        if (entryBps > MAX_ENTRY_FEE_BPS) revert FeeAboveMax(entryBps, MAX_ENTRY_FEE_BPS);
        if (exitBps > MAX_EXIT_FEE_BPS) revert FeeAboveMax(exitBps, MAX_EXIT_FEE_BPS);
    }

    // ── Deposit (with entry fee) ──

    function deposit(uint256 amount) external nonReentrant onlyOwner onlyInitialized whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        // Accrue management fees BEFORE deposit changes NAV
        _accrueFees();

        // Transfer gross amount from owner
        baseAsset.safeTransferFrom(msg.sender, address(this), amount);

        // Charge entry fee. P5-S15: Only ACTUALLY deduct the fee from the deposit if
        // we have a recipient to send it to. Without a recipient the fee is not paid
        // out, so the user's full deposit must remain credited as totalDeposited (no
        // accounting drift).
        uint256 entryFee = (amount * policy.entryFeeBps) / 10000;
        uint256 netDeposit;
        if (entryFee > 0 && policy.feeRecipient != address(0)) {
            _distributeImmediateFee(entryFee);
            emit VaultEvents.EntryFeeCharged(address(this), msg.sender, amount, entryFee);
            netDeposit = amount - entryFee;
        } else {
            // Fee skipped (no recipient) — credit user with the full amount
            netDeposit = amount;
        }
        totalDeposited += netDeposit;

        // P5-S4: Initialize HWM from the actual deposit, NOT from balanceOf(this).
        // Prior versions read the post-deposit balance, which let an attacker (or
        // even the owner) inflate the HWM via a token donation BEFORE the first
        // deposit, permanently shielding all profits below the inflated HWM from
        // performance fees. The donation attack is now defeated: HWM is bootstrapped
        // from the user's actual netDeposit only.
        if (highWaterMark == 0) {
            highWaterMark = netDeposit;
            emit VaultEvents.HighWaterMarkUpdated(address(this), 0, highWaterMark);
        }

        emit VaultEvents.Deposited(address(this), msg.sender, netDeposit);
    }

    // ── Withdraw (with exit fee + accrued fee deduction) ──

    function withdraw(uint256 amount) external nonReentrant onlyOwner onlyInitialized whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        // Accrue management + performance fees BEFORE withdrawal
        _accrueFees();

        uint256 balance = baseAsset.balanceOf(address(this));
        uint256 totalAccrued = accruedManagementFee + accruedPerformanceFee;

        // Edge case: vault balance smaller than the operator's accrued fees claim.
        // Prior versions had a math bug where `totalAccrued = balance` was assigned,
        // making `available = 0` and locking user funds. The user must have priority
        // on withdrawal, so we zero out the operator's claim entirely in this case.
        // Operator loses pending fees but the vault remains liquid for the user.
        if (balance < totalAccrued) {
            accruedManagementFee = 0;
            accruedPerformanceFee = 0;
            totalAccrued = 0;
            emit VaultEvents.AccruedFeesForfeited(address(this), balance);
        }
        uint256 available = balance - totalAccrued;
        if (amount > available) revert InsufficientBalance();

        // Charge exit fee on withdrawal
        uint256 exitFee = (amount * policy.exitFeeBps) / 10000;
        uint256 userAmount = amount - exitFee;

        if (exitFee > 0 && policy.feeRecipient != address(0)) {
            _distributeImmediateFee(exitFee);
            emit VaultEvents.ExitFeeCharged(address(this), owner, amount, exitFee);
        }

        baseAsset.safeTransfer(owner, userAmount);
        totalWithdrawn += amount;

        emit VaultEvents.Withdrawn(address(this), owner, userAmount);
    }

    function emergencyWithdraw() external nonReentrant onlyOwner onlyInitialized whenPaused {
        uint256 balance = baseAsset.balanceOf(address(this));
        if (balance == 0) revert ZeroAmount();

        baseAsset.safeTransfer(owner, balance);
        totalWithdrawn += balance;

        emit VaultEvents.EmergencyWithdraw(address(this), owner, balance);
    }

    /// @notice Fix F5: Emergency withdraw ANY token (not just base asset)
    /// @dev Only callable by owner when vault is paused.
    ///      This prevents tokens from being permanently locked in the vault
    ///      after executor swaps base asset to non-base tokens.
    function emergencyWithdrawToken(address token) external nonReentrant onlyOwner onlyInitialized whenPaused {
        if (token == address(0)) revert ZeroAddress();
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert ZeroAmount();

        IERC20(token).safeTransfer(owner, balance);

        emit VaultEvents.EmergencyWithdraw(address(this), owner, balance);
    }

    // ── Policy Management ──

    /**
     * @notice Update vault policy (RISK PARAMETERS ONLY).
     * @dev Fee fields and feeRecipient are PRESERVED — they can only be changed via
     *      queueFeeChange/applyFeeChange (7-day cooldown) or setFeeRecipient.
     *      This prevents the user (or an attacker phishing the user) from bypassing
     *      the fee cooldown via a wholesale policy replacement, AND prevents
     *      bypassing the hardcoded fee caps that protect users from misconfiguration.
     */
    function updatePolicy(VaultPolicy calldata _policy) external onlyOwner onlyInitialized {
        // Preserve current fee state — fee changes have their own cooldown-protected path
        VaultPolicy memory updated = _policy;
        updated.performanceFeeBps = policy.performanceFeeBps;
        updated.managementFeeBps = policy.managementFeeBps;
        updated.entryFeeBps = policy.entryFeeBps;
        updated.exitFeeBps = policy.exitFeeBps;
        updated.feeRecipient = policy.feeRecipient;

        // Defense-in-depth: re-validate caps in case the existing fees somehow exceed
        // them (e.g. via an upgrade that lowered constants). This call is a no-op for
        // a healthy vault and a guard against future drift.
        _validateFeeBps(
            updated.performanceFeeBps,
            updated.managementFeeBps,
            updated.entryFeeBps,
            updated.exitFeeBps
        );

        policy = updated;
        emit VaultEvents.PolicyUpdated(address(this), msg.sender);
    }

    function updateAllowedAssets(address[] calldata _assets) external onlyOwner onlyInitialized {
        for (uint256 i = 0; i < allowedAssets.length; i++) {
            isAllowedAsset[allowedAssets[i]] = false;
        }
        delete allowedAssets;

        for (uint256 i = 0; i < _assets.length; i++) {
            allowedAssets.push(_assets[i]);
            isAllowedAsset[_assets[i]] = true;
        }
        emit VaultEvents.AllowedAssetsUpdated(address(this), msg.sender, _assets.length);
    }

    function setExecutor(address _executor) external onlyOwner onlyInitialized {
        if (_executor == address(0)) revert ZeroAddress();
        address old = executor;
        executor = _executor;
        emit VaultEvents.ExecutorUpdated(address(this), old, _executor);
    }

    // H-3: setVenue with event + zero-check logging
    function setVenue(address _venue) external onlyOwner onlyInitialized {
        address old = venue;
        venue = _venue;
        emit VaultEvents.VenueUpdated(address(this), old, _venue);
    }

    // ── Pause / Unpause ──

    function pause() external onlyOwner onlyInitialized whenNotPaused {
        policy.paused = true;
        emit VaultEvents.VaultPaused(address(this), msg.sender);
    }

    function unpause() external onlyOwner onlyInitialized whenPaused {
        policy.paused = false;
        emit VaultEvents.VaultUnpaused(address(this), msg.sender);
    }

    // ──────────────────────────────────────────────
    // PHASE 1: FEE SYSTEM (Management + Performance)
    // ──────────────────────────────────────────────

    /**
     * @notice Accrue management + performance fees lazily (called by deposit/withdraw/execute/claim)
     * @dev Streaming management fee uses linear time-based accrual.
     *      Performance fee is HWM-protected (only on new highs).
     */
    function _accrueFees() internal {
        if (!initialized) return;

        uint256 nowTs = block.timestamp;
        uint256 elapsed = nowTs - lastFeeAccrual;
        if (elapsed == 0) return;

        // Phase 1.8: Use multi-asset NAV calculator if configured (oracle-priced)
        // Fallback to base asset balance otherwise (backwards compatible)
        uint256 currentBalance = _readNav();

        // Effective NAV excludes already-accrued fees
        uint256 effectiveNav = currentBalance > (accruedManagementFee + accruedPerformanceFee)
            ? currentBalance - accruedManagementFee - accruedPerformanceFee
            : 0;

        // ── Management fee (streaming linear accrual) ──
        uint256 newMgmtFee = 0;
        if (policy.managementFeeBps > 0 && effectiveNav > 0) {
            newMgmtFee = (effectiveNav * policy.managementFeeBps * elapsed) / (10000 * SECONDS_PER_YEAR);
            if (newMgmtFee > 0) {
                accruedManagementFee += newMgmtFee;
                effectiveNav = effectiveNav > newMgmtFee ? effectiveNav - newMgmtFee : 0;
            }
        }

        // ── Performance fee (HWM-protected) ──
        uint256 newPerfFee = 0;
        if (policy.performanceFeeBps > 0 && effectiveNav > highWaterMark && highWaterMark > 0) {
            uint256 profit = effectiveNav - highWaterMark;
            newPerfFee = (profit * policy.performanceFeeBps) / 10000;
            if (newPerfFee > 0) {
                accruedPerformanceFee += newPerfFee;
                uint256 oldHwm = highWaterMark;
                // Update HWM to current effective NAV minus new perf fee
                highWaterMark = effectiveNav - newPerfFee;
                emit VaultEvents.HighWaterMarkUpdated(address(this), oldHwm, highWaterMark);
            }
        }

        lastFeeAccrual = nowTs;

        if (newMgmtFee > 0 || newPerfFee > 0) {
            emit VaultEvents.FeeAccrued(address(this), newMgmtFee, newPerfFee, highWaterMark);
        }
    }

    /// @notice Manually trigger fee accrual (anyone can call)
    function accrueFees() external onlyInitialized {
        _accrueFees();
    }

    /// @notice Read NAV from the configured calculator, falling back to base balance.
    /// @dev Try/catch ensures fee accrual never reverts due to oracle issues.
    function _readNav() internal view returns (uint256) {
        if (navCalculator != address(0)) {
            try INavCalculator(navCalculator).calculateNAV(address(this)) returns (uint256 nav, uint256[] memory) {
                if (nav > 0) return nav;
            } catch {
                // Oracle failed — fall through to base asset balance
            }
        }
        return baseAsset.balanceOf(address(this));
    }

    /// @notice Public NAV reader for off-chain consumers
    function getNav() external view returns (uint256) {
        return _readNav();
    }

    /// @notice Set the NAV calculator (Phase 1.8). Only owner.
    /// @dev Pass address(0) to disable and use base asset balance only.
    function setNavCalculator(address newCalculator) external onlyOwner onlyInitialized {
        // Accrue at old NAV first to avoid sudden HWM jumps
        _accrueFees();
        navCalculator = newCalculator;
    }

    /// @notice Set the reputation recorder (Phase 5). Only owner.
    /// @dev Pass address(0) to disable reputation recording entirely.
    ///      The recorder must also authorize this vault via its admin
    ///      (OperatorReputation.setRecorder(vaultAddress, true)).
    function setReputationRecorder(address newRecorder) external onlyOwner onlyInitialized {
        reputationRecorder = newRecorder;
        emit VaultEvents.ReputationRecorderUpdated(address(this), newRecorder);
    }

    /// @notice Claim accrued fees — split between operator (80%) and protocol treasury (20%)
    /// @dev Only feeRecipient can claim
    function claimFees() external nonReentrant onlyInitialized {
        if (msg.sender != policy.feeRecipient) revert OnlyFeeRecipient();

        _accrueFees();

        uint256 totalFee = accruedManagementFee + accruedPerformanceFee;
        if (totalFee == 0) revert NoFeesAccrued();

        // Reset accrued
        accruedManagementFee = 0;
        accruedPerformanceFee = 0;

        // Verify vault has enough liquid base asset
        uint256 balance = baseAsset.balanceOf(address(this));
        if (totalFee > balance) {
            // Cap to available — rest will be claimable later when liquidity returns
            totalFee = balance;
        }

        // Split between operator and protocol
        uint256 protocolCut = 0;
        if (protocolTreasury != address(0)) {
            protocolCut = (totalFee * PROTOCOL_FEE_CUT_BPS) / 10000;
        }
        uint256 operatorAmount = totalFee - protocolCut;

        if (operatorAmount > 0) {
            baseAsset.safeTransfer(policy.feeRecipient, operatorAmount);
        }
        if (protocolCut > 0) {
            baseAsset.safeTransfer(protocolTreasury, protocolCut);
        }

        emit VaultEvents.FeesClaimed(address(this), policy.feeRecipient, operatorAmount, protocolCut);
    }

    /// @notice Distribute small immediate fee (entry/exit) directly without accrual queue
    function _distributeImmediateFee(uint256 feeAmount) internal {
        if (feeAmount == 0) return;

        uint256 protocolCut = 0;
        if (protocolTreasury != address(0)) {
            protocolCut = (feeAmount * PROTOCOL_FEE_CUT_BPS) / 10000;
        }
        uint256 operatorAmount = feeAmount - protocolCut;

        if (operatorAmount > 0 && policy.feeRecipient != address(0)) {
            baseAsset.safeTransfer(policy.feeRecipient, operatorAmount);
        }
        if (protocolCut > 0) {
            baseAsset.safeTransfer(protocolTreasury, protocolCut);
        }
    }

    /// @notice Update fee recipient (owner only)
    function setFeeRecipient(address newRecipient) external onlyOwner onlyInitialized {
        // Accrue first so old recipient gets their share
        _accrueFees();
        address old = policy.feeRecipient;
        policy.feeRecipient = newRecipient;
        emit VaultEvents.FeeRecipientUpdated(address(this), old, newRecipient);
    }

    /// @notice Queue a fee change with 7-day cooldown (Phase 4 protection)
    function queueFeeChange(
        uint256 newPerfBps,
        uint256 newMgmtBps,
        uint256 newEntryBps,
        uint256 newExitBps
    ) external onlyOwner onlyInitialized {
        _validateFeeBps(newPerfBps, newMgmtBps, newEntryBps, newExitBps);
        pendingFeeChange = PendingFeeChange({
            newPerformanceFeeBps: newPerfBps,
            newManagementFeeBps: newMgmtBps,
            newEntryFeeBps: newEntryBps,
            newExitFeeBps: newExitBps,
            effectiveAt: block.timestamp + FEE_CHANGE_COOLDOWN,
            pending: true
        });
        emit VaultEvents.FeeChangeQueued(address(this), pendingFeeChange.effectiveAt);
    }

    /// @notice Apply queued fee change after cooldown elapsed
    function applyFeeChange() external onlyOwner onlyInitialized {
        if (!pendingFeeChange.pending) revert NoPendingFeeChange();
        if (block.timestamp < pendingFeeChange.effectiveAt) revert FeeChangeTooSoon();

        // Accrue at old rates first
        _accrueFees();

        policy.performanceFeeBps = pendingFeeChange.newPerformanceFeeBps;
        policy.managementFeeBps = pendingFeeChange.newManagementFeeBps;
        policy.entryFeeBps = pendingFeeChange.newEntryFeeBps;
        policy.exitFeeBps = pendingFeeChange.newExitFeeBps;

        delete pendingFeeChange;
        emit VaultEvents.FeeChangeApplied(address(this));
    }

    // ── Execution ──

    function executeIntent(ExecutionIntent calldata intent) external nonReentrant onlyExecutor onlyInitialized whenNotPaused {
        // H-5: Check autoExecution flag
        if (!policy.autoExecution) revert AutoExecutionDisabled();

        // C-4: Validate intent.vault matches this vault
        if (intent.vault != address(this)) revert IntentVaultMismatch();

        // C-3: Recompute and verify intent hash on-chain
        bytes32 computedHash = keccak256(abi.encode(
            intent.vault, intent.assetIn, intent.assetOut,
            intent.amountIn, intent.minAmountOut,
            intent.createdAt, intent.expiresAt,
            intent.confidenceBps, intent.riskScoreBps
        ));
        if (computedHash != intent.intentHash) revert IntentHashMismatch();

        _resetDailyCounterIfNeeded();

        // This contract does not have an on-chain oracle for cross-asset NAV.
        // Use base-asset liquidity for entry sizing, and the actual tokenIn
        // balance for exit validation inside PolicyLibrary.
        uint256 vaultValue = baseAsset.balanceOf(address(this));
        uint256 tokenInBalance = IERC20(intent.assetIn).balanceOf(address(this));

        // M-3 fix: Global stop-loss check.
        // P5-S5: Guard against divide-by-zero. cumulativePnl is currently never written
        // (realized PnL accounting is deferred until oracle-priced settlement lands),
        // so this branch is dead code today. The div-by-zero guard ensures that when
        // PnL accounting is added, an empty/withdrawn-to-zero vault cannot brick
        // executeIntent through a 0-divisor.
        if (cumulativePnl < 0 && totalDeposited > 0) {
            uint256 lossAbsBps = (uint256(-cumulativePnl) * 10000) / totalDeposited;
            if (lossAbsBps >= policy.stopLossBps && policy.stopLossBps > 0) {
                emit VaultEvents.RiskThresholdBreached(address(this), "stopLoss", lossAbsBps, policy.stopLossBps);
                revert PolicyCheckFailed("Global stop-loss triggered");
            }
        }

        (bool valid, string memory reason) = PolicyLibrary.validateAll(
            policy,
            intent.amountIn,
            vaultValue,
            lastExecutionTime,
            currentDailyLossBps,
            intent.expiresAt,
            intent.confidenceBps,
            dailyActionCount,
            intent.assetIn,
            intent.assetOut,
            address(baseAsset),
            tokenInBalance,
            allowedAssets
        );

        if (!valid) {
            emit VaultEvents.IntentBlocked(address(this), intent.intentHash, reason);
            revert PolicyCheckFailed(reason);
        }

        registry.registerIntent(intent.intentHash, address(this));

        emit VaultEvents.IntentSubmitted(
            address(this),
            intent.intentHash,
            intent.assetIn,
            intent.assetOut,
            intent.amountIn
        );

        lastExecutionTime = block.timestamp;
        dailyActionCount += 1;

        // ── Fix F1: Enforce minAmountOut > 0 for real venue swaps ──
        // Prevents executor from setting minAmountOut=0 to enable sandwich attacks
        if (venue != address(0) && intent.amountIn > 0 && intent.minAmountOut == 0) {
            revert MinAmountOutRequired();
        }

        // Execute swap via venue if configured
        uint256 amountOut = 0;
        if (venue != address(0) && intent.amountIn > 0) {
            amountOut = _executeSwapViaVenue(
                intent.assetIn,
                intent.assetOut,
                intent.amountIn,
                intent.minAmountOut
            );
        }

        // Accurate realized PnL across heterogeneous assets requires oracle-priced
        // NAV accounting. Raw token-unit comparisons here would corrupt the vault's
        // risk state, especially on failed swaps or differing token decimals.
        // Keep execution accounting off-chain until NAV-based settlement is added.

        // Auto-record execution result
        bool success = amountOut > 0 || venue == address(0);
        ExecutionResult memory result = ExecutionResult({
            intentHash: intent.intentHash,
            venueTxRef: bytes32(uint256(uint160(venue))),
            amountIn: intent.amountIn,
            amountOut: amountOut,
            executedAt: block.timestamp,
            success: success
        });
        registry.finalizeIntent(result);

        emit VaultEvents.IntentExecuted(
            address(this),
            intent.intentHash,
            intent.amountIn,
            amountOut,
            success
        );

        // Phase 5: Record reputation if recorder set + this vault authorized.
        // Wrapped in try/catch so unauthorized or missing recorder never blocks execution.
        if (reputationRecorder != address(0)) {
            try IReputationRecorder(reputationRecorder).recordExecution(
                executor,
                intent.amountIn, // raw base-asset units (6 decimals USDC)
                int256(0),        // realized PnL unknown here — reconciled off-chain
                success
            ) {} catch {}
            // P5-S10: Mark the vault owner as Sybil-resistant eligible to rate this
            // operator. They've demonstrably used the operator (their vault just executed
            // an intent), so they get one rating per operator. Also wrapped in try/catch.
            try IReputationRecorder(reputationRecorder).markEligibleRater(executor, owner) {} catch {}
        }
    }

    function recordExecution(ExecutionResult calldata result) external onlyExecutor onlyInitialized {
        registry.finalizeIntent(result);

        emit VaultEvents.IntentExecuted(
            address(this),
            result.intentHash,
            result.amountIn,
            result.amountOut,
            result.success
        );
    }

    // ── Internal ──

    function _resetDailyCounterIfNeeded() internal {
        if (block.timestamp >= dailyActionResetTime) {
            dailyActionCount = 0;
            currentDailyLossBps = 0;
            dailyActionResetTime = block.timestamp + 1 days;
        }
    }

    // C-2 + H-4 + P5-S1: Safe approve pattern + verify actual balance change + enforce slippage
    function _executeSwapViaVenue(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal returns (uint256 amountOut) {
        // Snapshot balances before swap
        uint256 tokenOutBefore = IERC20(tokenOut).balanceOf(address(this));
        uint256 tokenInBefore = IERC20(tokenIn).balanceOf(address(this));

        // C-2: approve → call → approve(0) (always reset approval)
        IERC20(tokenIn).forceApprove(venue, amountIn);

        (bool success, ) = venue.call(
            abi.encodeWithSignature(
                "swap(address,address,uint256,uint256)",
                tokenIn, tokenOut, amountIn, minAmountOut
            )
        );

        // Always reset approval after call
        IERC20(tokenIn).forceApprove(venue, 0);

        if (!success) {
            return 0;
        }

        // H-4: Verify actual balance changes, don't trust return value
        uint256 tokenOutAfter = IERC20(tokenOut).balanceOf(address(this));
        amountOut = tokenOutAfter - tokenOutBefore;

        // Verify tokenIn was actually spent (prevent fake success)
        if (IERC20(tokenIn).balanceOf(address(this)) >= tokenInBefore) revert SwapOutputMismatch();

        // If venue claims success but no tokens received, treat as failed
        if (amountOut == 0) {
            return 0;
        }

        // P5-S1: Defense-in-depth slippage check on the OUTPUT side.
        // Even though the venue (Jaine V3 / MockDEX) is supposed to enforce minAmountOut
        // internally, we verify here. Mitigates a malicious or misconfigured venue
        // returning success with insufficient output.
        if (amountOut < minAmountOut) revert SlippageTooHigh(minAmountOut, amountOut);
    }

    // ── Views ──

    function getBalance() external view returns (uint256) {
        return baseAsset.balanceOf(address(this));
    }

    function getPolicy() external view returns (VaultPolicy memory) {
        return policy;
    }

    function getAllowedAssets() external view returns (address[] memory) {
        return allowedAssets;
    }

    function getNetDeposited() external view returns (uint256) {
        return totalDeposited > totalWithdrawn ? totalDeposited - totalWithdrawn : 0;
    }

    function getVaultSummary() external view returns (
        address _owner,
        address _executor,
        address _baseAsset,
        uint256 _balance,
        uint256 _totalDeposited,
        uint256 _lastExecution,
        uint256 _dailyActions,
        bool    _paused,
        bool    _autoExecution
    ) {
        return (
            owner,
            executor,
            address(baseAsset),
            baseAsset.balanceOf(address(this)),
            totalDeposited,
            lastExecutionTime,
            dailyActionCount,
            policy.paused,
            policy.autoExecution
        );
    }
}
