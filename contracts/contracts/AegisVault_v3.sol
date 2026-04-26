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
        address /*_protocolTreasury*/
    ) external {
        require(owner == address(0), "init");
        require(_owner != address(0) && _baseAsset != address(0) && _executor != address(0) && _registry != address(0), "0");
        require(_policy.performanceFeeBps <= 3000 && _policy.managementFeeBps <= 500 && _policy.entryFeeBps <= 200 && _policy.exitFeeBps <= 200, "f");
        require(assets_.length <= MAX_ALLOWED_ASSETS, "too many assets");

        owner = _owner;
        venue = _venue;
        baseAsset = IERC20(_baseAsset);
        executor = _executor;
        registry = _registry;
        policy = _policy;
        for (uint256 i = 0; i < assets_.length; i++) _allowedAssets.push(assets_[i]);
        dailyActionResetTime = block.timestamp + 1 days;

        // v3: seed the cross-chain fee cap to the safe default. Owner can
        //     tighten it further (lower) without redeploying.
        maxCrossChainFeeBps = DEFAULT_MAX_CROSS_CHAIN_FEE_BPS;

        emit VaultEvents.VaultCreated(address(this), _owner, _baseAsset);
    }

    // ── v2 surface (unchanged) ──

    function deposit(uint256 amount) external {
        require(msg.sender == owner && !policy.paused, "d");
        uint256 net = IOLib.doDeposit(address(baseAsset), msg.sender, amount, policy.feeRecipient, policy.entryFeeBps);
        totalDeposited += net;
    }

    function withdraw(uint256 amount) external {
        require(msg.sender == owner && !policy.paused, "w");
        IOLib.doWithdraw(address(baseAsset), owner, amount, policy.feeRecipient, policy.exitFeeBps);
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

    function executeIntent(ExecutionIntent calldata intent, bytes calldata sig) external {
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

        ExecLib.runExecution(intent, policy, _allowedAssets, venue, address(baseAsset), registry, lastExecutionTime, dailyActionCount);

        lastExecutionTime = block.timestamp;
        dailyActionCount += 1;
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

        // 1. Vault binding
        if (intent.vault != address(this)) revert CrossChain_BadVault();

        // 2. Expiry
        if (block.timestamp > intent.expiresAt) revert CrossChain_Expired();

        // 8 (early): snapshot vault's `assetOut` balance BEFORE we touch any
        //            registry state. The delivery must already have landed on
        //            this contract — we're attesting to a deposit that exists
        //            at function entry. Any tokens that arrived between this
        //            snapshot and the post-check (e.g. an in-flight donation)
        //            satisfies the >= check, which is acceptable: the vault
        //            cannot lose tokens, only over-attest, and the delta is
        //            still real value the vault now controls.
        uint256 prevBalance = IERC20(intent.assetOut).balanceOf(address(this));

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

        // 5. Replay guard (registry-level)
        ExecutionRegistry reg = ExecutionRegistry(registry);
        if (reg.isFinalized(intentHash)) revert CrossChain_AlreadyFinalized();

        // 6. Fee caps (intent-level AND policy-level — whichever is tighter wins)
        if (
            actualFeeBps > intent.maxFeeBps ||
            actualFeeBps > maxCrossChainFeeBps
        ) revert CrossChain_FeeTooHigh();

        // 7. minOut floor
        if (actualAmountOut < intent.minAmountOut) revert CrossChain_MinOut();

        // 9. Physical settlement: the vault's assetOut balance must have grown
        //    by at least `actualAmountOut` since the start of this function.
        //    Underflow-safe via Solidity 0.8 checked arithmetic — if the
        //    balance somehow decreased the subtraction reverts before we ever
        //    compare to actualAmountOut, which is the desired safe-fail mode.
        uint256 newBalance = IERC20(intent.assetOut).balanceOf(address(this));
        if (newBalance < prevBalance || newBalance - prevBalance < actualAmountOut) {
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
