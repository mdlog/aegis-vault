// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VaultEvents.sol";
import "./ExecutionRegistry.sol";
import "./libraries/ExecLib.sol";
import "./libraries/SealedLib.sol";
import "./libraries/IOLib.sol";
import "./libraries/CrossChainLib.sol";

/**
 * @title AegisVault_v3
 * @notice Track 2 sealed-strategy vault, v3.
 *
 *         Adds **cross-chain swap acceptance** via Khalani.
 *
 *         Settlement is solver-driven and OFF-chain triggered:
 *           1. Orchestrator signs an EIP-712 `CrossChainIntent` and publishes
 *              it to Khalani's API (carrying `khalaniIntentId`, route policy,
 *              fee ceiling, etc.).
 *           2. A Khalani solver fills the intent and delivers `assetOut` to
 *              this vault on 0G via a regular ERC-20 transfer.
 *           3. Orchestrator calls `acceptCrossChainFill(intent, sig, actualAmountOut, actualFeeBps)`
 *              which proves (a) the intent was authorised by the policy's
 *              attested signer, (b) the fee taken stayed within both the
 *              intent's and the policy's caps, and (c) the vault's `assetOut`
 *              balance actually rose by `actualAmountOut` since the start of
 *              this transaction. Replay is blocked via `ExecutionRegistry`.
 *
 *         The vault never calls a swap function for cross-chain trades — it
 *         only attests to a delivery that has already physically happened.
 *
 *         Backwards compatibility: v3 retains the entire v2 surface (deposit,
 *         withdraw, withdrawToken, withdrawAllNonBase, commitIntent,
 *         executeIntent) so on-chain (Jaine) execution still works unchanged.
 *
 *         Storage layout: identical to v2 up to and including `intentCommits`,
 *         then v3-only fields are appended. v2 vaults are NOT upgraded to v3 —
 *         a fresh deployment is required.
 */
contract AegisVault_v3 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ──
    uint256 public constant MAX_ALLOWED_ASSETS = 10;

    /// @notice Hard cap on the cross-chain fee setting. Even the owner cannot
    ///         exceed 200 bps (2%). Matches the design's "absolute ceiling".
    uint16 public constant MAX_CROSS_CHAIN_FEE_BPS_CAP = 200;

    /// @notice Default cross-chain fee ceiling applied at initialize. The
    ///         owner can lower or raise this (within the cap) post-init.
    uint16 public constant DEFAULT_MAX_CROSS_CHAIN_FEE_BPS = 50;

    // ── State (v2-compatible prefix) ──
    address public owner;
    address public executor;
    IERC20  public baseAsset;
    address public venue;
    address internal registry;
    VaultPolicy internal policy;
    address[] internal _allowedAssets;
    uint256 public totalDeposited;
    uint256 public lastExecutionTime;
    uint256 internal dailyActionCount;
    uint256 internal dailyActionResetTime;
    mapping(bytes32 => uint256) internal intentCommits;

    // ── State (v3-only) ──
    //
    //   `maxCrossChainFeeBps` is the per-vault cap for the actualFeeBps the
    //   orchestrator is allowed to claim on a Khalani fill. Stored as its
    //   own slot (NOT inside `VaultPolicy`) so the v1/v2 struct layout +
    //   the off-chain ABI of `defaultPolicy()` stays untouched. Owner-tunable
    //   via `setMaxCrossChainFeeBps`, hard-capped at MAX_CROSS_CHAIN_FEE_BPS_CAP.
    uint16 public maxCrossChainFeeBps;

    /// @notice Marks each Khalani off-chain fill identifier as consumed once
    ///         this vault credits the matching delivery. Prevents an
    ///         orchestrator (or a stolen TEE key) from authoring two
    ///         separate signed intents that both point at the same physical
    ///         Khalani fill: the registry replay guard only blocks re-runs
    ///         of the SAME intent hash, but two distinct intents over the
    ///         same `khalaniIntentId` would each produce a fresh hash. This
    ///         per-fill guard closes that gap.
    mapping(bytes32 => bool) public consumedKhalaniIds;

    /// @notice Protocol treasury for the FeeLib 80/20 fee split on entry/exit
    ///         fees. Set at init from `AegisVaultFactoryV3.protocolTreasury`.
    ///         When zero, the operator (`policy.feeRecipient`) keeps the full
    ///         fee — preserves backwards compat with v1/v2 deployments that
    ///         were configured without a treasury.
    address public protocolTreasury;

    // ── Errors (cross-chain path only — v2 inline strings retained for the
    //    rest of the surface to keep the diff readable) ──
    error CrossChain_Expired();
    error CrossChain_BadSig();
    error CrossChain_AlreadyFinalized();
    error CrossChain_FeeTooHigh();
    error CrossChain_MinOut();
    error CrossChain_NotSettled();
    error CrossChain_BadVault();
    error CrossChain_Paused();
    error CrossChain_FeeCapTooHigh();
    error CrossChain_AutoExecOff();
    error CrossChain_Cooldown();
    error CrossChain_LowConfidence();
    error CrossChain_DailyActionsExceeded();
    error CrossChain_AssetNotWhitelisted();
    error CrossChain_PositionTooLarge();
    error CrossChain_FillReused();
    error CrossChain_MissingKhalaniId();

    // ── Events ──
    event CrossChainFillAccepted(
        bytes32 indexed intentHash,
        address indexed assetIn,
        address indexed assetOut,
        uint256 amountIn,
        uint256 amountOut,
        uint16  feeBps
    );

    event MaxCrossChainFeeBpsUpdated(uint16 oldFeeBps, uint16 newFeeBps);

    function initialize(
        address _owner,
        address _baseAsset,
        address _executor,
        address _registry,
        address _venue,
        VaultPolicy calldata _policy,
        address[] calldata assets_,
        address _protocolTreasury,
        uint16 _maxCrossChainFeeBps
    ) external {
        require(owner == address(0), "init");
        require(_owner != address(0) && _baseAsset != address(0) && _executor != address(0) && _registry != address(0), "0");
        require(_policy.performanceFeeBps <= 3000 && _policy.managementFeeBps <= 500 && _policy.entryFeeBps <= 200 && _policy.exitFeeBps <= 200, "f");
        require(assets_.length <= MAX_ALLOWED_ASSETS, "too many assets");
        // v3: cross-chain fee cap is set at init time. 0 disables the
        //     `acceptCrossChainFill` path (any fill reverts with FeeTooHigh).
        //     Hard ceiling enforced here so factory + governance can't push it
        //     past the protocol-wide cap.
        if (_maxCrossChainFeeBps > MAX_CROSS_CHAIN_FEE_BPS_CAP) revert CrossChain_FeeCapTooHigh();

        owner = _owner;
        venue = _venue;
        baseAsset = IERC20(_baseAsset);
        executor = _executor;
        registry = _registry;
        policy = _policy;
        for (uint256 i = 0; i < assets_.length; i++) _allowedAssets.push(assets_[i]);
        dailyActionResetTime = block.timestamp + 1 days;
        maxCrossChainFeeBps = _maxCrossChainFeeBps;
        protocolTreasury = _protocolTreasury;

        emit VaultEvents.VaultCreated(address(this), _owner, _baseAsset);
    }

    // ── v2 surface (unchanged) ──

    function deposit(uint256 amount) external {
        require(msg.sender == owner && !policy.paused, "d");
        uint256 net = IOLib.doDepositV3(
            address(baseAsset),
            msg.sender,
            amount,
            policy.feeRecipient,
            protocolTreasury,
            policy.entryFeeBps
        );
        totalDeposited += net;
    }

    function withdraw(uint256 amount) external {
        require(msg.sender == owner && !policy.paused, "w");
        // Decrement totalDeposited so maxPositionBps continues to bound trade
        // size against the *current* principal, not against the high-water
        // mark of every deposit ever made. Without this, a depositor who
        // withdraws most of their principal would leave the on-chain trade
        // cap pegged to the original deposit and effectively unbounded
        // relative to the funds remaining in the vault.
        //
        // A withdrawal larger than totalDeposited represents a draw against
        // realized PnL (e.g. base-asset gains parked in the vault); clamp to
        // zero rather than underflow. Mirrors the V4 implementation; existing
        // V3 vaults already on chain remain affected by the original miss
        // (immutable bytecode) — operators of those vaults should migrate
        // to V4 if the trade-size cap matters for their mandate.
        if (amount >= totalDeposited) {
            totalDeposited = 0;
        } else {
            totalDeposited -= amount;
        }
        IOLib.doWithdrawV3(
            address(baseAsset),
            owner,
            amount,
            policy.feeRecipient,
            protocolTreasury,
            policy.exitFeeBps
        );
    }

    function withdrawToken(address token, uint256 amount) external {
        require(msg.sender == owner && !policy.paused, "wt");
        require(token != address(baseAsset), "use withdraw()");
        require(token != address(0) && amount > 0, "bad args");
        IERC20(token).safeTransfer(owner, amount);
        emit VaultEvents.TokenWithdrawn(address(this), token, owner, amount);
    }

    function withdrawAllNonBase() external {
        require(msg.sender == owner && !policy.paused, "wa");
        uint256 n = _allowedAssets.length;
        for (uint256 i = 0; i < n; i++) {
            address t = _allowedAssets[i];
            if (t == address(baseAsset) || t == address(0)) continue;
            uint256 bal = IERC20(t).balanceOf(address(this));
            if (bal == 0) continue;
            IERC20(t).safeTransfer(owner, bal);
            emit VaultEvents.TokenWithdrawn(address(this), t, owner, bal);
        }
    }

    function commitIntent(bytes32 commitHash) external {
        require(msg.sender == executor && policy.sealedMode && commitHash != bytes32(0), "c");
        intentCommits[commitHash] = block.number;
        emit VaultEvents.IntentCommitted(address(this), commitHash, block.number);
    }

    function executeIntent(ExecutionIntent calldata intent, bytes calldata sig) external nonReentrant {
        require(msg.sender == executor && !policy.paused && policy.autoExecution, "x");
        require(intent.vault == address(this), "v");

        if (policy.attestedSigner != address(0)) {
            bytes32 commitHash = SealedLib.verifyAttestation(intent.intentHash, intent.attestationReportHash, policy.attestedSigner, sig);
            if (policy.sealedMode) {
                uint256 cb = intentCommits[commitHash];
                require(cb != 0 && block.number >= cb + 1, "cr");
                delete intentCommits[commitHash];
                emit VaultEvents.SealedIntentExecuted(address(this), intent.intentHash, policy.attestedSigner, intent.attestationReportHash);
            }
        } else {
            require(!policy.sealedMode, "sealed needs signer");
        }

        if (block.timestamp >= dailyActionResetTime) {
            dailyActionCount = 0;
            dailyActionResetTime = block.timestamp + 1 days;
        }

        // CEI: snapshot the values runExecution needs to enforce cooldown +
        // per-day caps, then commit state updates BEFORE the external venue
        // call inside runExecution. ReentrancyGuard already blocks re-entry
        // through `nonReentrant`; the early state update here is defense in
        // depth so even a delegatecall path that bypassed the guard would
        // still see the cooldown clock advanced.
        uint256 lastExec   = lastExecutionTime;
        uint256 dailyCount = dailyActionCount;
        lastExecutionTime  = block.timestamp;
        dailyActionCount   = dailyCount + 1;

        ExecLib.runExecution(intent, policy, _allowedAssets, venue, address(baseAsset), registry, lastExec, dailyCount, totalDeposited);
    }

    // ── Owner-only emergency controls ──
    //
    //   v1/v2 vaults shipped without these setters: a compromised executor
    //   key, a buggy venue, or a need to halt activity could only be
    //   resolved by redeploying the vault. v3 adds the missing surface so
    //   the depositor can rotate the orchestrator wallet, halt activity,
    //   or migrate venues without losing the vault's history.

    /// @notice Rotate the executor (orchestrator wallet). Only callable by
    ///         the depositor (vault owner). Useful when the orchestrator
    ///         hot-wallet is rotated or believed compromised.
    function setExecutor(address newExecutor) external {
        require(msg.sender == owner, "owner");
        require(newExecutor != address(0), "0");
        address old = executor;
        executor = newExecutor;
        emit VaultEvents.ExecutorUpdated(address(this), old, newExecutor);
    }

    /// @notice Migrate the on-chain venue used by `executeIntent` (e.g.
    ///         JaineVenueAdapterV2 → a new V3 adapter). Owner-only. Does NOT
    ///         affect the cross-chain (Khalani) path, which is venue-less.
    function setVenue(address newVenue) external {
        require(msg.sender == owner, "owner");
        require(newVenue != address(0), "0");
        address old = venue;
        venue = newVenue;
        emit VaultEvents.VenueUpdated(address(this), old, newVenue);
    }

    /// @notice Rotate the TEE-bound attestation signer used by sealed mode
    ///         and cross-chain fill verification. Owner-only.
    ///
    ///         If the off-chain TEE_SIGNER private key is suspected
    ///         compromised, the depositor can immediately revoke it by
    ///         pointing `policy.attestedSigner` at a fresh key (or at
    ///         `address(0)` to disable sealed-mode attestation entirely;
    ///         when zeroed and `policy.sealedMode` was on, the flag is
    ///         cleared in the same tx so `executeIntent` does not brick on
    ///         the "sealed needs signer" require). Without this setter, a
    ///         leaked signer would force the depositor to redeploy the
    ///         vault and migrate funds to revoke the key. Pair this
    ///         rotation with `setExecutor` when the orchestrator wallet
    ///         is also rotated.
    ///
    ///         Note: clearing the signer is a one-way migration to public
    ///         mode. Re-entering sealed mode after a clear requires a
    ///         fresh deploy — re-enabling sealed semantics is a security
    ///         policy choice that should be explicit, not a side-effect
    ///         of key rotation.
    function setAttestedSigner(address newSigner) external {
        require(msg.sender == owner, "owner");
        address old = policy.attestedSigner;
        policy.attestedSigner = newSigner;
        if (newSigner == address(0) && policy.sealedMode) {
            policy.sealedMode = false;
        }
        emit VaultEvents.AttestedSignerUpdated(address(this), old, newSigner);
    }

    /// @notice Halt deposits / withdrawals / executions. Sets the policy's
    ///         `paused` flag. Idempotent — re-pausing is a no-op.
    function pause() external {
        require(msg.sender == owner, "owner");
        if (!policy.paused) {
            policy.paused = true;
            emit VaultEvents.VaultPaused(address(this), msg.sender);
        }
    }

    /// @notice Resume vault activity. Owner-only. Idempotent.
    function unpause() external {
        require(msg.sender == owner, "owner");
        if (policy.paused) {
            policy.paused = false;
            emit VaultEvents.VaultUnpaused(address(this), msg.sender);
        }
    }

    // ── v3-only: cross-chain fill acceptance ──

    /**
     * @notice Owner setter for the per-vault cross-chain fee ceiling. The cap
     *         passed in must be `<= MAX_CROSS_CHAIN_FEE_BPS_CAP` (200 bps).
     */
    function setMaxCrossChainFeeBps(uint16 newFeeBps) external {
        require(msg.sender == owner, "owner");
        if (newFeeBps > MAX_CROSS_CHAIN_FEE_BPS_CAP) revert CrossChain_FeeCapTooHigh();
        uint16 old = maxCrossChainFeeBps;
        maxCrossChainFeeBps = newFeeBps;
        emit MaxCrossChainFeeBpsUpdated(old, newFeeBps);
    }

    /**
     * @notice Verify and account for a Khalani solver fill that has *already*
     *         delivered `assetOut` to this vault.
     *
     * @dev    Caller responsibility: invoke this RIGHT AFTER the solver's
     *         delivery transaction is finalized on 0G. The settlement check
     *         compares this vault's `assetOut` balance at the start of this
     *         tx (`prevBalance`) against its current balance — only the delta
     *         credited *during this tx* is rejected, while a delivery that
     *         landed in a prior block is the contract's intended scope.
     *
     *         Replay protection comes from `ExecutionRegistry`: each intent
     *         hash can be registered + finalized exactly once.
     *
     *         Only `executor` (the orchestrator's wallet) may call this. The
     *         executor authorisation alone is NOT sufficient — the intent
     *         must also carry a fresh ECDSA signature from `policy.attestedSigner`
     *         (TEE-bound key). Both checks together provide the full chain
     *         of trust: (orchestrator submitted) ∧ (TEE signed) ∧ (delivery happened).
     *
     * @param intent          EIP-712 typed `CrossChainIntent` (mirror of the
     *                        signed off-chain intent). `intent.vault` MUST
     *                        equal `address(this)`.
     * @param teeSignature    65-byte ECDSA signature from `policy.attestedSigner`
     *                        over the intent's EIP-712 digest.
     * @param actualAmountOut Amount of `assetOut` the orchestrator claims was
     *                        delivered. Must satisfy `>= intent.minAmountOut`
     *                        AND must be matched by the on-chain balance delta.
     * @param actualFeeBps    Orchestrator-computed protocol fee taken from the
     *                        gross fill (in bps). Must satisfy
     *                        `<= intent.maxFeeBps` AND `<= maxCrossChainFeeBps`.
     */
    function acceptCrossChainFill(
        CrossChainLib.CrossChainIntent calldata intent,
        bytes calldata teeSignature,
        uint256 actualAmountOut,
        uint256 actualFeeBps
    ) external nonReentrant {
        // Caller authorisation: only the orchestrator wallet may submit fills.
        // (TEE signature alone is not enough — without this, anyone holding a
        //  leaked signed intent could replay it before the legitimate caller.)
        require(msg.sender == executor, "x");
        if (policy.paused) revert CrossChain_Paused();
        if (!policy.autoExecution) revert CrossChain_AutoExecOff();

        // 1. Vault binding
        if (intent.vault != address(this)) revert CrossChain_BadVault();

        // 2. Expiry
        if (block.timestamp > intent.expiresAt) revert CrossChain_Expired();

        // 3 + 4. Hash + ECDSA verification (delegated to CrossChainLib)
        bytes32 intentHash = CrossChainLib.verifySignature(
            intent,
            address(this),
            block.chainid,
            policy.attestedSigner,
            teeSignature
        );
        // verifySignature reverts on mismatch with InvalidCrossChainSignature.
        // The vault's own CrossChain_BadSig error is reserved for cases where
        // the signer config is missing (caught by CrossChainLib internally).

        // 5. Replay guard (registry-level). Checked BEFORE policy gates so a
        //    replay always fails fast with the most informative error — even
        //    for an intent that would otherwise trip cooldown.
        ExecutionRegistry reg = ExecutionRegistry(registry);
        if (reg.isFinalized(intentHash)) revert CrossChain_AlreadyFinalized();

        // 5b. Per-fill replay guard. The registry guard protects against the
        //     SAME intent hash being settled twice; this map protects against
        //     two DIFFERENT signed intents claiming the same Khalani delivery
        //     (whose unique ID is `khalaniIntentId`). Without this an
        //     orchestrator (or a stolen TEE key) could double-credit a single
        //     physical fill by authoring two intents with disjoint metadata
        //     pointing at the same `khalaniIntentId`.
        if (intent.khalaniIntentId == bytes32(0)) revert CrossChain_MissingKhalaniId();
        if (consumedKhalaniIds[intent.khalaniIntentId]) revert CrossChain_FillReused();

        // 5a. Policy gates ported from `executeIntent` so cross-chain fills go
        //     through the same risk checks as on-chain swaps. Otherwise an
        //     attacker who compromised the TEE's signing key (or any signed
        //     intent) could bypass cooldown / confidence / per-day caps that
        //     bound the on-chain path.
        if (block.timestamp < lastExecutionTime + policy.cooldownSeconds) revert CrossChain_Cooldown();
        if (uint256(intent.confidenceBps) < policy.confidenceThresholdBps) revert CrossChain_LowConfidence();

        // Daily action accounting: same rolling 24h window as executeIntent.
        if (block.timestamp >= dailyActionResetTime) {
            dailyActionCount = 0;
            dailyActionResetTime = block.timestamp + 1 days;
        }
        if (dailyActionCount >= policy.maxActionsPerDay) revert CrossChain_DailyActionsExceeded();

        // Asset whitelist: only `assetOut` must be policy-committed because
        // that is what physically lands in this vault. `assetIn` may legitimately
        // live only on the origin chain (e.g. USDC on Ethereum delivered as
        // cbBTC on 0G) — requiring it in the destination whitelist would
        // forbid the canonical cross-chain rebalance flow. The TEE signs the
        // pair so the orchestrator cannot freely substitute assetOut.
        bool outOk;
        for (uint256 i = 0; i < _allowedAssets.length; i++) {
            if (_allowedAssets[i] == intent.assetOut) { outOk = true; break; }
        }
        if (!outOk) revert CrossChain_AssetNotWhitelisted();

        // maxPositionBps trade-size cap, mirrored from ExecLib so the same
        // policy field constrains both paths.
        if (policy.maxPositionBps != 0 && totalDeposited != 0) {
            uint256 cap = (totalDeposited * policy.maxPositionBps) / 10_000;
            if (intent.amountIn > cap) revert CrossChain_PositionTooLarge();
        }

        // 6. Fee caps (intent-level AND policy-level — whichever is tighter wins)
        if (
            actualFeeBps > intent.maxFeeBps ||
            actualFeeBps > maxCrossChainFeeBps
        ) revert CrossChain_FeeTooHigh();

        // 7. minOut floor
        if (actualAmountOut < intent.minAmountOut) revert CrossChain_MinOut();

        // 9. Physical settlement: orchestrator captures `intent.prevBalance` —
        //    the vault's `assetOut` balance immediately BEFORE publishing the
        //    Khalani deposit — and the TEE signs over it. We re-read the
        //    current balance and require it has grown by at least
        //    `actualAmountOut` since the snapshot. The TEE signature binds
        //    the snapshot to a specific moment; the registry replay guard
        //    binds each intent to a single accept; together they prevent
        //    replays of the same delivery.
        //
        //    Underflow-safe via Solidity 0.8: a decrease underflows the
        //    subtraction and reverts inside the comparison, the desired
        //    safe-fail mode (cannot undercount).
        uint256 currentBalance = IERC20(intent.assetOut).balanceOf(address(this));
        if (currentBalance < intent.prevBalance ||
            currentBalance - intent.prevBalance < actualAmountOut) {
            revert CrossChain_NotSettled();
        }

        // 10. Accounting: only credit `totalDeposited` when the inbound asset
        //     IS the vault's base asset (the cross-chain fill effectively
        //     re-denominated value back into the principal currency). For
        //     non-base receipts (e.g. an inbound BTC fill into a USDC vault)
        //     the position is held as the new asset and NAV is reflected via
        //     balance only — `totalDeposited` continues to track principal.
        if (intent.assetOut == address(baseAsset)) {
            totalDeposited += actualAmountOut;
        }

        // 10a. Mark the Khalani fill consumed BEFORE any external calls so a
        //      reentrant path through the registry or token contract can't
        //      sneak a second credit through with the same `khalaniIntentId`.
        consumedKhalaniIds[intent.khalaniIntentId] = true;

        // 11. Registry finalize. We register-then-finalize in the same tx to
        //     consume one slot in the replay map. `intentOwner` is set to the
        //     vault (msg.sender of the registry call), and the result struct
        //     records the cross-chain origin via venueTxRef = 0 (no on-chain
        //     swap was performed).
        reg.registerIntent(intentHash, address(this));
        ExecutionResult memory result = ExecutionResult({
            intentHash: intentHash,
            venueTxRef: bytes32(0),
            amountIn:  intent.amountIn,
            amountOut: actualAmountOut,
            executedAt: block.timestamp,
            success:   true
        });
        reg.finalizeIntent(result);

        // 11a. Policy bookkeeping mirroring `executeIntent` so cooldown +
        //      per-day caps roll together for both execution paths.
        lastExecutionTime = block.timestamp;
        dailyActionCount += 1;

        // 12. Event — indexed assetIn/assetOut allow off-chain accounting to
        //     filter by trading-pair without scanning the full log.
        emit CrossChainFillAccepted(
            intentHash,
            intent.assetIn,
            intent.assetOut,
            intent.amountIn,
            actualAmountOut,
            uint16(actualFeeBps)
        );
    }

    // ── Views ──
    function getAllowedAssets() external view returns (address[] memory) { return _allowedAssets; }
    function getPolicy() external view returns (VaultPolicy memory) { return policy; }
    function getVaultSummary() external view returns (
        address, address, address, uint256, uint256, uint256, uint256, bool, bool
    ) {
        return (owner, executor, address(baseAsset), baseAsset.balanceOf(address(this)),
                totalDeposited, lastExecutionTime, dailyActionCount, policy.paused, policy.autoExecution);
    }

    /// @notice v3-specific: version tag for frontend routing / indexer labeling
    function version() external pure returns (string memory) { return "v3"; }
}
