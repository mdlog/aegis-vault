// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../VaultEvents.sol";
import "../ExecutionRegistry.sol";
import "./ExecLibV4.sol";
import "../libraries/SealedLib.sol";
import "../libraries/IOLib.sol";
import "./CrossChainLibV4.sol";

/**
 * @title AegisVault_v4
 * @notice V4 sealed-strategy vault. Identical surface and storage layout to
 *         AegisVault_v3 with one additive concept: an on-chain commitment to
 *         the operator strategy manifest (`acceptedManifestHash`).
 *
 *         Why V4 exists
 *         -------------
 *         V3 already binds the AI signing key + attestation report into
 *         every executed intent. V4 closes the remaining gap: the operator
 *         framework is config-driven, so two operators sharing one orchestrator
 *         binary now distinguish themselves by a JSON manifest. V4 binds the
 *         keccak256 of that manifest into the vault — the orchestrator must
 *         present a strategy commitment that matches the user-approved
 *         acceptance, or `executeIntent` reverts.
 *
 *         Strategy upgrades go through a 24-hour timelock so a compromised
 *         operator cannot flip a vault onto a malicious manifest in the same
 *         block they propose it.
 *
 *         Migration model: V3 vaults are NOT upgraded. Users opt into V4 by
 *         creating a fresh vault via AegisVaultFactoryV4. This is intentional
 *         — the V3 storage layout has no slot for `acceptedManifestHash`, and
 *         clones cannot grow storage retroactively without breaking the
 *         existing slot map.
 *
 *         Strict-equality binding
 *         -----------------------
 *         `executeIntent` requires `intent.strategyHash == acceptedManifestHash`
 *         on every call. There is no zero-hash bypass: a vault initialised with
 *         `_acceptedManifestHash == 0` will only accept intents whose
 *         strategyHash is also zero. Operators that have not yet published a
 *         manifest must coordinate with the orchestrator to sign zero-hash
 *         intents (DE v1 default behaviour); to switch to a real manifest the
 *         depositor goes through the 24h timelocked upgrade flow.
 */
contract AegisVault_v4 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ──
    uint256 public constant MAX_ALLOWED_ASSETS = 10;
    uint16  public constant MAX_CROSS_CHAIN_FEE_BPS_CAP = 200;
    uint16  public constant DEFAULT_MAX_CROSS_CHAIN_FEE_BPS = 50;

    /// @notice Highest manifest schemaVersion this vault implementation knows
    ///         how to enforce. An intent referencing a newer schema is
    ///         rejected — the operator's manifest is from a future framework
    ///         version that this vault cannot reason about.
    uint32  public constant MAX_SUPPORTED_SCHEMA_VER = 1;

    /// @notice Mandatory cool-down between requesting a manifest upgrade and
    ///         being able to apply it. Gives the user a 24h window to notice
    ///         a malicious operator-pushed manifest before it activates.
    uint256 public constant MANIFEST_UPGRADE_TIMELOCK = 24 hours;

    // ── State (v3-compatible prefix) ──
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
    uint16  public maxCrossChainFeeBps;
    mapping(bytes32 => bool) public consumedKhalaniIds;
    address public protocolTreasury;

    // ── State (v4-only) ──
    //
    //   Storage is appended after the v3 layout so a future inheritance-based
    //   evolution of v3 can keep its slot map. V4 vaults are independent
    //   clones (own implementation, own factory) so this is purely defensive.

    /// @notice Active manifest hash. `executeIntent` requires that any
    ///         submitted intent references this exact value via
    ///         `intent.strategyHash`, unless the slot is zero (backwards-compat
    ///         valve described in the contract NatSpec).
    bytes32 public acceptedManifestHash;

    /// @notice Manifest hash queued by `requestManifestUpgrade` and not yet
    ///         applied. Zero when no upgrade is in flight.
    bytes32 public pendingManifestHash;

    /// @notice Block timestamp at which the pending upgrade was requested.
    ///         `applyManifestUpgrade` reverts until
    ///         `block.timestamp >= manifestUpgradeRequestedAt + MANIFEST_UPGRADE_TIMELOCK`.
    uint256 public manifestUpgradeRequestedAt;

    // ── Errors ──

    /// @notice Submitted intent's strategyHash does not match the vault's
    ///         active commitment. Either the orchestrator is using a stale
    ///         manifest, the operator has been deviating, or the vault
    ///         expects a manifest that has not been published yet.
    error WrongStrategyHash();

    /// @notice Submitted intent declares a strategySchemaVer beyond what
    ///         this vault implementation knows how to enforce.
    error UnsupportedSchemaVersion();

    /// @notice Manifest upgrade request issued for a hash that is already
    ///         the active commitment. No-op rejected so off-chain callers
    ///         get an explicit signal instead of a silent re-emission.
    error ManifestUpgradeNoChange();

    /// @notice `applyManifestUpgrade` called before the timelock elapsed.
    error ManifestTimelockActive();

    /// @notice `applyManifestUpgrade` / `cancelManifestUpgrade` called when
    ///         no pending upgrade exists.
    error NoPendingManifestUpgrade();

    // Cross-chain errors — inherited from v3 surface.
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

    /// @notice Operator (depositor) queued a new manifest hash. `readyAt` is
    ///         the earliest timestamp at which `applyManifestUpgrade` will
    ///         succeed.
    event ManifestUpgradeRequested(bytes32 indexed newHash, uint256 readyAt);

    /// @notice Pending manifest hash promoted to the active commitment.
    event ManifestUpgraded(bytes32 indexed oldHash, bytes32 indexed newHash);

    /// @notice Pending manifest upgrade discarded before being applied.
    event ManifestUpgradeCancelled(bytes32 indexed cancelledHash);

    /// @notice Emitted at the tail of every successful `executeIntent` so
    ///         off-chain indexers can prove which strategy + schema version
    ///         produced each on-chain action. Indexed `strategyHash` lets
    ///         dashboards filter by manifest without scanning the full log.
    event StrategyApplied(bytes32 indexed strategyHash, uint32 schemaVer);

    /// @notice Lock the implementation contract so its `initialize` can never
    ///         be called directly. EIP-1167 clones start with zeroed storage
    ///         (so `owner == address(0)` and the init guard passes), but the
    ///         implementation itself is reachable on-chain at the address the
    ///         factory holds in `vaultImplementation`. Without this lock, any
    ///         caller could `initialize` the implementation and become its
    ///         `owner`, then emit `AttestedSignerUpdated` / `VaultCreated` /
    ///         etc. from the implementation address — poisoning indexers and
    ///         creating a fake "vault" that naive integrators might trust.
    ///         Setting `owner` to a non-zero sentinel in the constructor flips
    ///         the `require(owner == address(0))` guard permanently on the
    ///         implementation while leaving cloned storage intact.
    constructor() {
        owner = address(0xdEaD);
    }

    function initialize(
        address _owner,
        address _baseAsset,
        address _executor,
        address _registry,
        address _venue,
        VaultPolicy calldata _policy,
        address[] calldata assets_,
        address _protocolTreasury,
        uint16 _maxCrossChainFeeBps,
        bytes32 _acceptedManifestHash
    ) external {
        require(owner == address(0), "init");
        require(_owner != address(0) && _baseAsset != address(0) && _executor != address(0) && _registry != address(0), "0");
        require(_policy.performanceFeeBps <= 3000 && _policy.managementFeeBps <= 500 && _policy.entryFeeBps <= 200 && _policy.exitFeeBps <= 200, "f");
        require(assets_.length <= MAX_ALLOWED_ASSETS, "too many assets");
        // BPS fields must be <= 10_000 (100%). Without this guard a depositor
        // (or a buggy factory) could set confidenceThresholdBps > 10_000, which
        // is unreachable by any valid intent and silently freezes the vault on
        // both executeIntent and acceptCrossChainFill paths.
        require(
            _policy.confidenceThresholdBps <= 10_000 && _policy.maxPositionBps <= 10_000,
            "policyBps"
        );
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
        // V4: bind the manifest hash at create time. Zero is permitted — see
        // the contract-level "Backwards-compat valve" annotation for the
        // intended use of an unbound vault.
        acceptedManifestHash = _acceptedManifestHash;

        emit VaultEvents.VaultCreated(address(this), _owner, _baseAsset);
    }

    // ── v3-compatible deposit / withdraw / commitIntent surface ──

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
        // zero rather than underflow.
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

    /// @notice V4 execution gate. Adds two checks before delegating to
    ///         ExecLibV4.runExecution:
    ///
    ///           1. `intent.strategySchemaVer ∈ [1, MAX_SUPPORTED_SCHEMA_VER]`
    ///              — rejects intents authored against a newer manifest schema
    ///              than this vault knows how to enforce. The lower bound of 1
    ///              also blocks the all-zero default value sneaking through
    ///              when callers forget to set the field.
    ///           2. `intent.strategyHash == acceptedManifestHash` — strict
    ///              equality. Binds the intent to the user-approved strategy
    ///              manifest. The orchestrator cannot deviate without the
    ///              depositor noticing (the deviation surfaces as a revert).
    ///              When the depositor wants to switch strategies they must
    ///              go through the 24h timelocked upgrade flow.
    ///
    ///         The schema check runs first so a forward-version manifest is
    ///         distinguishable from a hash mismatch in off-chain logs.
    function executeIntent(ExecLibV4.ExecutionIntentV4 calldata intent, bytes calldata sig) external nonReentrant {
        require(msg.sender == executor && !policy.paused && policy.autoExecution, "x");
        require(intent.vault == address(this), "v");

        // ── V4 strategy binding ──
        if (
            intent.strategySchemaVer < 1
            || intent.strategySchemaVer > MAX_SUPPORTED_SCHEMA_VER
        ) revert UnsupportedSchemaVersion();
        if (intent.strategyHash != acceptedManifestHash) revert WrongStrategyHash();

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

        // CEI: snapshot for the lib call, then commit state writes ahead of
        // the venue interaction inside runExecution. Same defense-in-depth
        // pattern as V3.
        uint256 lastExec   = lastExecutionTime;
        uint256 dailyCount = dailyActionCount;
        lastExecutionTime  = block.timestamp;
        dailyActionCount   = dailyCount + 1;

        ExecLibV4.runExecution(intent, policy, _allowedAssets, venue, address(baseAsset), registry, lastExec, dailyCount, totalDeposited);

        // Strategy provenance event. Emitted last so it pairs cleanly with
        // the IntentExecuted log already emitted from inside ExecLibV4.
        emit StrategyApplied(intent.strategyHash, intent.strategySchemaVer);
    }

    // ── Owner-only emergency controls ──

    function setExecutor(address newExecutor) external {
        require(msg.sender == owner, "owner");
        require(newExecutor != address(0), "0");
        address old = executor;
        executor = newExecutor;
        emit VaultEvents.ExecutorUpdated(address(this), old, newExecutor);
    }

    function setVenue(address newVenue) external {
        require(msg.sender == owner, "owner");
        require(newVenue != address(0), "0");
        address old = venue;
        venue = newVenue;
        emit VaultEvents.VenueUpdated(address(this), old, newVenue);
    }

    /// @notice Rotate the TEE-bound attestation signer. Owner-only.
    ///         Pass `address(0)` to disable sealed-mode attestation entirely;
    ///         in that case `policy.sealedMode` is also cleared atomically so
    ///         `executeIntent` does not brick on the "sealed needs signer"
    ///         require. Used to revoke a leaked TEE_SIGNER private key
    ///         without having to redeploy and migrate the vault.
    function setAttestedSigner(address newSigner) external {
        require(msg.sender == owner, "owner");
        address old = policy.attestedSigner;
        policy.attestedSigner = newSigner;
        // When the signer is cleared, sealed mode cannot operate — clear it
        // in the same tx so the vault remains usable on the public-mode
        // execution path. Note: this is a one-way migration. Setting a
        // non-zero signer later does NOT auto-re-enable sealed mode; flipping
        // back into sealed mode after a clear requires a fresh deploy (or a
        // future setSealedMode setter). The asymmetry is intentional —
        // re-entering sealed mode is a security policy choice that should be
        // explicit, not a side-effect of key rotation.
        if (newSigner == address(0) && policy.sealedMode) {
            policy.sealedMode = false;
        }
        emit VaultEvents.AttestedSignerUpdated(address(this), old, newSigner);
    }

    function pause() external {
        require(msg.sender == owner, "owner");
        if (!policy.paused) {
            policy.paused = true;
            emit VaultEvents.VaultPaused(address(this), msg.sender);
        }
    }

    function unpause() external {
        require(msg.sender == owner, "owner");
        if (policy.paused) {
            policy.paused = false;
            emit VaultEvents.VaultUnpaused(address(this), msg.sender);
        }
    }

    // ── V4 manifest upgrade flow ──
    //
    //   Two-step, owner-only:
    //     1. `requestManifestUpgrade(newHash)` — records `newHash` and
    //        timestamp. A subsequent request overwrites the previous pending
    //        value (so a typo can be corrected without waiting for the
    //        timelock to elapse on the wrong hash).
    //     2. `applyManifestUpgrade()` — promotes `pendingManifestHash` to
    //        `acceptedManifestHash` once `MANIFEST_UPGRADE_TIMELOCK` has
    //        elapsed. Clears the pending slot.
    //
    //   Owner can `cancelManifestUpgrade()` at any time before apply.
    //
    //   The owner is the depositor (set by the factory at create time), not
    //   the operator. This is by design: the operator publishes the manifest
    //   off-chain; the depositor decides whether to accept it.

    function requestManifestUpgrade(bytes32 newHash) external {
        require(msg.sender == owner, "owner");
        // Zero hash is rejected to keep the pending-state machine simple — a
        // pending value of zero is what we use elsewhere to mean "nothing
        // pending", so allowing a zero queue would alias the two states.
        // (To intentionally clear an already-active hash back to zero, the
        // owner should request a fresh non-zero hash and apply it; or wait
        // for a future variant of this flow that supports explicit detach.)
        if (newHash == bytes32(0)) revert ManifestUpgradeNoChange();
        pendingManifestHash = newHash;
        manifestUpgradeRequestedAt = block.timestamp;
        emit ManifestUpgradeRequested(newHash, block.timestamp + MANIFEST_UPGRADE_TIMELOCK);
    }

    function applyManifestUpgrade() external {
        require(msg.sender == owner, "owner");
        if (pendingManifestHash == bytes32(0)) revert NoPendingManifestUpgrade();
        if (block.timestamp < manifestUpgradeRequestedAt + MANIFEST_UPGRADE_TIMELOCK) {
            revert ManifestTimelockActive();
        }
        bytes32 old = acceptedManifestHash;
        bytes32 newHash = pendingManifestHash;
        acceptedManifestHash = newHash;
        pendingManifestHash = bytes32(0);
        manifestUpgradeRequestedAt = 0;
        emit ManifestUpgraded(old, newHash);
    }

    function cancelManifestUpgrade() external {
        require(msg.sender == owner, "owner");
        if (pendingManifestHash == bytes32(0)) revert NoPendingManifestUpgrade();
        bytes32 cancelled = pendingManifestHash;
        pendingManifestHash = bytes32(0);
        manifestUpgradeRequestedAt = 0;
        emit ManifestUpgradeCancelled(cancelled);
    }

    // ── v3-compatible cross-chain (Khalani) acceptance path ──

    function setMaxCrossChainFeeBps(uint16 newFeeBps) external {
        require(msg.sender == owner, "owner");
        if (newFeeBps > MAX_CROSS_CHAIN_FEE_BPS_CAP) revert CrossChain_FeeCapTooHigh();
        uint16 old = maxCrossChainFeeBps;
        maxCrossChainFeeBps = newFeeBps;
        emit MaxCrossChainFeeBpsUpdated(old, newFeeBps);
    }

    function acceptCrossChainFill(
        CrossChainLibV4.CrossChainIntent calldata intent,
        bytes calldata teeSignature,
        uint256 actualAmountOut,
        uint256 actualFeeBps
    ) external nonReentrant {
        require(msg.sender == executor, "x");
        if (policy.paused) revert CrossChain_Paused();
        if (!policy.autoExecution) revert CrossChain_AutoExecOff();

        if (intent.vault != address(this)) revert CrossChain_BadVault();
        if (block.timestamp > intent.expiresAt) revert CrossChain_Expired();

        // V4 strategy binding on the cross-chain path. Without these checks an
        // operator (or a stolen TEE key) could deviate from the user-approved
        // manifest by routing trades through Khalani — `executeIntent` enforces
        // strategyHash but the previous V3 cross-chain path did not.
        if (
            intent.strategySchemaVer < 1
            || intent.strategySchemaVer > MAX_SUPPORTED_SCHEMA_VER
        ) revert UnsupportedSchemaVersion();
        if (intent.strategyHash != acceptedManifestHash) revert WrongStrategyHash();

        bytes32 intentHash = CrossChainLibV4.verifySignature(
            intent,
            address(this),
            block.chainid,
            policy.attestedSigner,
            teeSignature
        );

        ExecutionRegistry reg = ExecutionRegistry(registry);
        if (reg.isFinalized(intentHash)) revert CrossChain_AlreadyFinalized();

        if (intent.khalaniIntentId == bytes32(0)) revert CrossChain_MissingKhalaniId();
        if (consumedKhalaniIds[intent.khalaniIntentId]) revert CrossChain_FillReused();

        if (block.timestamp < lastExecutionTime + policy.cooldownSeconds) revert CrossChain_Cooldown();
        if (uint256(intent.confidenceBps) < policy.confidenceThresholdBps) revert CrossChain_LowConfidence();

        if (block.timestamp >= dailyActionResetTime) {
            dailyActionCount = 0;
            dailyActionResetTime = block.timestamp + 1 days;
        }
        if (dailyActionCount >= policy.maxActionsPerDay) revert CrossChain_DailyActionsExceeded();

        bool outOk;
        for (uint256 i = 0; i < _allowedAssets.length; i++) {
            if (_allowedAssets[i] == intent.assetOut) { outOk = true; break; }
        }
        if (!outOk) revert CrossChain_AssetNotWhitelisted();

        if (policy.maxPositionBps != 0 && totalDeposited != 0) {
            uint256 cap = (totalDeposited * policy.maxPositionBps) / 10_000;
            if (intent.amountIn > cap) revert CrossChain_PositionTooLarge();
        }

        if (
            actualFeeBps > intent.maxFeeBps ||
            actualFeeBps > maxCrossChainFeeBps
        ) revert CrossChain_FeeTooHigh();

        if (actualAmountOut < intent.minAmountOut) revert CrossChain_MinOut();

        uint256 currentBalance = IERC20(intent.assetOut).balanceOf(address(this));
        if (currentBalance < intent.prevBalance ||
            currentBalance - intent.prevBalance < actualAmountOut) {
            revert CrossChain_NotSettled();
        }

        if (intent.assetOut == address(baseAsset)) {
            totalDeposited += actualAmountOut;
        }

        consumedKhalaniIds[intent.khalaniIntentId] = true;

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

        lastExecutionTime = block.timestamp;
        dailyActionCount += 1;

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

    /// @notice V4 version tag — used by indexers / frontend routing to
    ///         distinguish vaults bound to the strategy commitment from
    ///         legacy V3 deployments.
    function version() external pure returns (string memory) { return "v4"; }
}
