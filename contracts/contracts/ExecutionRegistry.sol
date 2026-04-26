// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./VaultEvents.sol";

/**
 * @title ExecutionRegistry
 * @notice Tracks intent hashes to prevent replay attacks and stores execution results.
 *         Each intent can only be executed once.
 *
 * @dev ACCESS CONTROL — multi-factory model:
 *      Only authorized vaults can register / finalize intents. Vaults are
 *      authorized either by the registry `admin` OR by any factory in the
 *      `authorizedFactories` set (admin-curated). This lets v1, v2 and v3
 *      factories coexist on a single registry without rotating admin.
 *
 *      Admin transfer follows the Ownable2Step pattern (`transferAdmin` →
 *      `acceptAdmin`) so a typo during rotation cannot brick the registry.
 *
 *      Every state-changing admin action emits a dedicated event so off-chain
 *      monitoring can audit governance without polling state diffs.
 */
contract ExecutionRegistry {
    // ── State ──

    /// @notice Current admin. Manages multi-factory set + handles vault revocation.
    address public admin;

    /// @notice Address proposed by the current admin that must call
    ///         `acceptAdmin()` to finalize the transfer (Ownable2Step pattern).
    ///         Single-step admin transfer was previously a foot-gun: a typo
    ///         in the new-admin address would brick the registry permanently
    ///         (no way to add factories or revoke compromised vaults).
    address public pendingAdmin;

    /// @notice Factories that can authorize new vaults via `authorizeVault`.
    ///         Multiple factories (e.g. v1, v2, v3) coexist on a single
    ///         registry: the admin controls the membership of this set, and
    ///         each member is allowed to register its own clones. Without
    ///         this, deploying a v3 factory required transferring `admin`
    ///         away from the v1 factory, which would brick v1's ability to
    ///         authorize future v1 vaults — incompatible with running both
    ///         tracks side by side.
    mapping(address => bool) public authorizedFactories;

    /// @notice Authorized vault addresses that can register/finalize intents
    mapping(address => bool) public authorizedVaults;

    mapping(bytes32 => bool) public intentSubmitted;
    mapping(bytes32 => bool) public intentFinalized;
    mapping(bytes32 => ExecutionResult) public results;
    mapping(address => bytes32[]) public vaultIntents;

    /// @notice Track which vault registered each intent (for cross-vault validation)
    mapping(bytes32 => address) public intentOwner;

    // ── Errors ──

    error IntentAlreadySubmitted(bytes32 intentHash);
    error IntentNotSubmitted(bytes32 intentHash);
    error IntentAlreadyFinalized(bytes32 intentHash);
    error NotAuthorizedVault();
    error NotAuthorizedFactoryOrAdmin();
    error OnlyAdmin();
    error OnlyPendingAdmin();
    error IntentOwnerMismatch();
    error ZeroAddress();
    error FactoryNotAContract();

    // ── Events ──

    /// @notice Emitted when a vault is added to `authorizedVaults`.
    event VaultAuthorized(address indexed vault, address indexed grantedBy);
    /// @notice Emitted when a vault is removed from `authorizedVaults`.
    event VaultRevoked(address indexed vault, address indexed revokedBy);
    /// @notice Emitted when a factory is added to `authorizedFactories`.
    event FactoryAuthorized(address indexed factory);
    /// @notice Emitted when a factory is removed from `authorizedFactories`.
    event FactoryRevoked(address indexed factory);
    /// @notice Emitted when current admin proposes a new admin (Ownable2Step step 1).
    event AdminTransferStarted(address indexed previousAdmin, address indexed newAdmin);
    /// @notice Emitted when the proposed admin accepts (Ownable2Step step 2).
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    // ── Modifiers ──

    modifier onlyAuthorizedVault() {
        if (!authorizedVaults[msg.sender]) revert NotAuthorizedVault();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    /// @dev Allows either the admin OR any authorized factory through. Used
    ///      on `authorizeVault` so multiple factories can register their
    ///      clones without the admin being the sole entry point. Backwards
    ///      compatible: the existing v1 deploy pattern (admin held by the
    ///      factory itself) still satisfies this gate.
    modifier onlyFactoryOrAdmin() {
        if (msg.sender != admin && !authorizedFactories[msg.sender]) {
            revert NotAuthorizedFactoryOrAdmin();
        }
        _;
    }

    // ── Constructor ──

    constructor() {
        admin = msg.sender;
    }

    // ── Admin Functions ──

    /// @notice Authorize a vault address to use the registry. Callable by
    ///         the admin OR any factory in `authorizedFactories`.
    function authorizeVault(address vault) external onlyFactoryOrAdmin {
        if (vault == address(0)) revert ZeroAddress();
        authorizedVaults[vault] = true;
        emit VaultAuthorized(vault, msg.sender);
    }

    /// @notice Revoke vault authorization. Admin-only — factories cannot
    ///         deauthorize each other's clones.
    function revokeVault(address vault) external onlyAdmin {
        authorizedVaults[vault] = false;
        emit VaultRevoked(vault, msg.sender);
    }

    /// @notice Add a factory to the multi-factory authorization set. Admin
    ///         only. Callers added here can register vault clones via
    ///         `authorizeVault` without holding the registry's `admin` slot.
    /// @dev    Reverts if `factory` is the zero address or has no contract
    ///         code at the time of call. The code check is defense-in-depth
    ///         against an admin typo that authorizes an EOA — once added,
    ///         that EOA could call `authorizeVault(any)` from its private key
    ///         and corrupt the registry's vault set.
    function authorizeFactory(address factory) external onlyAdmin {
        if (factory == address(0)) revert ZeroAddress();
        if (factory.code.length == 0) revert FactoryNotAContract();
        authorizedFactories[factory] = true;
        emit FactoryAuthorized(factory);
    }

    /// @notice Remove a factory from the authorization set. Admin only.
    function revokeFactory(address factory) external onlyAdmin {
        authorizedFactories[factory] = false;
        emit FactoryRevoked(factory);
    }

    // ── Ownable2Step admin transfer ──
    //
    //   Two-step pattern: current admin proposes via `transferAdmin`, the
    //   proposed account confirms via `acceptAdmin`. Until accepted, the
    //   current admin retains all authority. Cancellable any time before
    //   acceptance via `cancelAdminTransfer` (or by re-calling
    //   `transferAdmin` with a different address).

    /// @notice Propose a new admin. Takes effect only after `newAdmin`
    ///         calls `acceptAdmin()`. A subsequent `transferAdmin` overwrites
    ///         the pending value; this is intentional so the current admin
    ///         can correct a typo before acceptance.
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    /// @notice Called by the pending admin to finalize the transfer.
    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert OnlyPendingAdmin();
        address previous = admin;
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferred(previous, admin);
    }

    /// @notice Cancel a previously-started transfer. Callable by current admin.
    function cancelAdminTransfer() external onlyAdmin {
        pendingAdmin = address(0);
    }

    // ── Functions (vault-only) ──

    /// @notice Register a new intent hash. Only callable by authorized vaults.
    // L-5 fix: uses msg.sender for vaultIntents (not untrusted vault param)
    function registerIntent(bytes32 intentHash, address /* vault */) external onlyAuthorizedVault {
        if (intentSubmitted[intentHash]) {
            revert IntentAlreadySubmitted(intentHash);
        }
        intentSubmitted[intentHash] = true;
        intentOwner[intentHash] = msg.sender;
        vaultIntents[msg.sender].push(intentHash);
    }

    /// @notice Finalize an intent with its execution result. Only callable by the vault that registered it.
    function finalizeIntent(ExecutionResult calldata result) external onlyAuthorizedVault {
        if (!intentSubmitted[result.intentHash]) {
            revert IntentNotSubmitted(result.intentHash);
        }
        if (intentFinalized[result.intentHash]) {
            revert IntentAlreadyFinalized(result.intentHash);
        }
        // Only the vault that registered the intent can finalize it
        if (intentOwner[result.intentHash] != msg.sender) {
            revert IntentOwnerMismatch();
        }

        intentFinalized[result.intentHash] = true;
        results[result.intentHash] = result;
    }

    // ── Views ──

    function isSubmitted(bytes32 intentHash) external view returns (bool) {
        return intentSubmitted[intentHash];
    }

    function isFinalized(bytes32 intentHash) external view returns (bool) {
        return intentFinalized[intentHash];
    }

    function getResult(bytes32 intentHash) external view returns (ExecutionResult memory) {
        return results[intentHash];
    }

    function getVaultIntentCount(address vault) external view returns (uint256) {
        return vaultIntents[vault].length;
    }

    function getVaultIntentAt(address vault, uint256 index) external view returns (bytes32) {
        return vaultIntents[vault][index];
    }

    /// @notice Compute the intent hash from parameters (H-1 fix: uses abi.encode)
    function computeIntentHash(
        address vault,
        address assetIn,
        address assetOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 createdAt,
        uint256 expiresAt,
        uint256 confidenceBps,
        uint256 riskScoreBps
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(
            vault, assetIn, assetOut, amountIn, minAmountOut,
            createdAt, expiresAt, confidenceBps, riskScoreBps
        ));
    }
}
