// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AegisVault.sol";
import "./ExecutionRegistry.sol";
import "./VaultEvents.sol";

/**
 * @title AegisVaultFactory
 * @notice Factory contract that deploys new AegisVault instances.
 *         Automatically authorizes new vaults in the ExecutionRegistry.
 *         Phase 1: Now passes protocolTreasury to all deployed vaults.
 */
contract AegisVaultFactory {
    // ── State ──

    address public executionRegistry;
    address public protocolTreasury;
    address public admin;

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
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    // ── Errors ──

    error ZeroAddress();
    error FactoryNotRegistryAdmin();
    error OnlyAdmin();

    // ── Modifiers ──

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    // ── Constructor ──

    constructor(address _executionRegistry, address _protocolTreasury) {
        if (_executionRegistry == address(0)) revert ZeroAddress();
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

        // M-4: Fail early if factory is not the registry admin
        if (ExecutionRegistry(executionRegistry).admin() != address(this)) {
            revert FactoryNotRegistryAdmin();
        }

        AegisVault newVault = new AegisVault();

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

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address old = admin;
        admin = newAdmin;
        emit AdminTransferred(old, newAdmin);
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
