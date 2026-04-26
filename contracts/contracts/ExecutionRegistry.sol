// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./VaultEvents.sol";

/**
 * @title ExecutionRegistry
 * @notice Tracks intent hashes to prevent replay attacks and stores execution results.
 *         Each intent can only be executed once.
 *
 * @dev ACCESS CONTROL: Only authorized vaults (registered by the factory admin)
 *      can register and finalize intents. This prevents DoS via pre-registration
 *      and result fabrication by unauthorized parties.
 */
contract ExecutionRegistry {
    // ── State ──

    address public admin;

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
    error IntentOwnerMismatch();

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
    ///      compatible: the existing v1 deploy script transfers admin to the
    ///      factory, which still satisfies this gate.
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
        authorizedVaults[vault] = true;
    }

    /// @notice Revoke vault authorization. Admin-only — factories cannot
    ///         deauthorize each other's clones.
    function revokeVault(address vault) external onlyAdmin {
        authorizedVaults[vault] = false;
    }

    /// @notice Add a factory to the multi-factory authorization set. Admin
    ///         only. Callers added here can register vault clones via
    ///         `authorizeVault` without holding the registry's `admin` slot.
    function authorizeFactory(address factory) external onlyAdmin {
        authorizedFactories[factory] = true;
    }

    /// @notice Remove a factory from the authorization set. Admin only.
    function revokeFactory(address factory) external onlyAdmin {
        authorizedFactories[factory] = false;
    }

    /// @notice Transfer admin role
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Zero address");
        admin = newAdmin;
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
