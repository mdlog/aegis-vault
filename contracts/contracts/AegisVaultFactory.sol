// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./AegisVault.sol";
import "./ExecutionRegistry.sol";
import "./VaultEvents.sol";

/**
 * @title AegisVaultFactory
 * @notice Factory contract that deploys new AegisVault instances via EIP-1167
 *         minimal proxy clones. Vault implementation is deployed once, factory
 *         clones it cheaply for each new vault.
 *         Automatically authorizes new vaults in the ExecutionRegistry.
 *         Phase 1: Passes protocolTreasury to all deployed vaults.
 */
contract AegisVaultFactory {
    using Clones for address;

    // ── State ──

    /// @notice Address of the AegisVault implementation contract used as the clone template
    address public immutable vaultImplementation;
    address public executionRegistry;
    address public protocolTreasury;
    address public admin;
    /// @notice Pending admin queued by `transferAdmin`; finalized by `acceptAdmin`.
    address public pendingAdmin;

    address[] public allVaults;
    mapping(address => address[]) public ownerVaults;
    mapping(address => bool) public isVault;

    // ── Events ──

    event VaultDeployed(
        address indexed vault,
        address indexed owner,
        address baseAsset,
        address executor,
        uint256 timestamp
    );

    event ProtocolTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    // ── Errors ──

    error ZeroAddress();
    error FactoryNotRegistryAdmin();
    error OnlyAdmin();
    error OnlyPendingAdmin();

    // ── Modifiers ──

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    // ── Constructor ──

    constructor(address _vaultImplementation, address _executionRegistry, address _protocolTreasury) {
        if (_vaultImplementation == address(0)) revert ZeroAddress();
        if (_executionRegistry == address(0)) revert ZeroAddress();
        vaultImplementation = _vaultImplementation;
        executionRegistry = _executionRegistry;
        protocolTreasury = _protocolTreasury; // can be 0 for no treasury (testnet)
        admin = msg.sender;
    }

    // ── Create Vault ──

    function createVault(
        address _baseAsset,
        address _executor,
        address _venue,
        VaultPolicy calldata _policy,
        address[] calldata _allowedAssets
    ) external returns (address vault) {
        if (_baseAsset == address(0)) revert ZeroAddress();
        if (_executor == address(0)) revert ZeroAddress();

        // Fail early if this factory cannot register clones — accepts either
        // legacy admin-style ownership OR membership in the registry's
        // multi-factory authorization set, so v1/v3 can coexist on the same
        // registry without rotating admin (which would brick the other side).
        ExecutionRegistry reg = ExecutionRegistry(executionRegistry);
        if (reg.admin() != address(this) && !reg.authorizedFactories(address(this))) {
            revert FactoryNotRegistryAdmin();
        }

        // EIP-1167 minimal proxy clone of the implementation (cheap deploy)
        address vaultAddr = vaultImplementation.clone();
        AegisVault newVault = AegisVault(vaultAddr);

        newVault.initialize(
            msg.sender,
            _baseAsset,
            _executor,
            executionRegistry,
            _venue,
            _policy,
            _allowedAssets,
            protocolTreasury
        );

        vault = address(newVault);

        // C-1 fix: Authorize the new vault in the registry
        ExecutionRegistry(executionRegistry).authorizeVault(vault);

        allVaults.push(vault);
        ownerVaults[msg.sender].push(vault);
        isVault[vault] = true;

        emit VaultDeployed(vault, msg.sender, _baseAsset, _executor, block.timestamp);
    }

    // ── Admin ──

    /// @notice Update protocol treasury — only affects newly deployed vaults
    function setProtocolTreasury(address newTreasury) external onlyAdmin {
        address old = protocolTreasury;
        protocolTreasury = newTreasury;
        emit ProtocolTreasuryUpdated(old, newTreasury);
    }

    // ── Ownable2Step admin transfer ──
    //
    //   Two-step pattern mirrors ExecutionRegistry. A typo on `transferAdmin`
    //   no longer bricks the factory — until `acceptAdmin` is called by the
    //   incoming address, the current admin retains full authority and can
    //   overwrite or cancel the pending value.

    /// @notice Propose a new admin. Takes effect only after `newAdmin`
    ///         calls `acceptAdmin()`.
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

    // ── Views ──

    function totalVaults() external view returns (uint256) {
        return allVaults.length;
    }

    function getOwnerVaults(address _owner) external view returns (address[] memory) {
        return ownerVaults[_owner];
    }

    function getVaultAt(uint256 index) external view returns (address) {
        return allVaults[index];
    }
}
