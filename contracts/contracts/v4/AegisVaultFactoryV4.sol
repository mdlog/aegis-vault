// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./AegisVault_v4.sol";
import "../ExecutionRegistry.sol";
import "../VaultEvents.sol";

/**
 * @title AegisVaultFactoryV4
 * @notice EIP-1167 minimal-proxy factory for AegisVault_v4 clones.
 *
 *         Mirrors AegisVaultFactoryV3 with one additive parameter at
 *         createVault time: `acceptedManifestHash`. The V4 vault binds this
 *         hash atomically with the rest of its initialization, so there is
 *         no transient window during which a V4 vault is alive but unbound.
 *
 *         Trust model is unchanged from V3 — the depositor (msg.sender)
 *         becomes the vault `owner`, and the operator's orchestrator wallet
 *         (`_operator`) becomes the `executor`. The depositor is also the
 *         only address allowed to upgrade `acceptedManifestHash`, so an
 *         operator pushing a new manifest off-chain cannot unilaterally
 *         flip the on-chain commitment.
 *
 *         The `VaultDeployed` event carries `acceptedManifestHash` as an
 *         additional indexed-parameter slot so off-chain indexers can build
 *         strategy-pinned vault catalogues without an extra round-trip read.
 */
contract AegisVaultFactoryV4 {
    using Clones for address;

    // ── Constants ──
    uint16 public constant MAX_CROSS_CHAIN_FEE_BPS_CAP = 200;

    // ── State ──

    /// @notice AegisVault_v4 implementation cloned by this factory
    address public immutable vaultImplementation;

    /// @notice ExecutionRegistry shared with the v2/v3 stack so cross-version
    ///         replay guards stay consistent.
    address public executionRegistry;

    /// @notice Optional protocol treasury forwarded to clones at init.
    address public protocolTreasury;

    /// @notice Factory admin — manages treasury / admin handover (mirrors V3).
    address public admin;

    address[] public allVaults;
    mapping(address => address[]) public ownerVaults;
    mapping(address => bool) public isVault;
    mapping(address => uint16) public requestedMaxCrossChainFeeBps;

    /// @notice Per-clone record of the manifest hash committed at creation.
    ///         Off-chain indexers consume this to bucket vaults by strategy
    ///         without a vault round-trip.
    mapping(address => bytes32) public vaultManifestHash;

    // ── Events ──

    event VaultDeployed(
        address indexed vault,
        address indexed owner,
        address indexed operator,
        address baseAsset,
        address venue,
        uint16  requestedMaxCrossChainFeeBps,
        uint256 timestamp,
        bytes32 acceptedManifestHash
    );

    event ProtocolTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    // ── Errors ──
    error ZeroAddress();
    error FactoryNotRegistryAdmin();
    error OnlyAdmin();
    error CrossChainFeeCapTooHigh();

    // ── Modifiers ──
    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    // ── Constructor ──
    constructor(
        address _vaultImplementation,
        address _executionRegistry,
        address _protocolTreasury
    ) {
        if (_vaultImplementation == address(0)) revert ZeroAddress();
        if (_executionRegistry == address(0)) revert ZeroAddress();
        vaultImplementation = _vaultImplementation;
        executionRegistry = _executionRegistry;
        protocolTreasury = _protocolTreasury;
        admin = msg.sender;
    }

    // ── Create Vault ──

    /**
     * @notice Deploy a new AegisVault_v4 clone, authorize it in the registry,
     *         record the requested cross-chain fee cap, and atomically commit
     *         the operator strategy manifest hash.
     *
     * @param _operator               Operator's orchestrator wallet — becomes
     *                                the vault's `executor`.
     * @param _baseAsset              ERC-20 base asset (e.g. USDC.e on 0G).
     * @param _venue                  On-chain swap adapter address.
     * @param _policy                 Initial vault policy (risk + fees).
     * @param _allowedAssets          Whitelisted swap legs.
     * @param _maxCrossChainFeeBps    User-requested cross-chain fee ceiling
     *                                (`<= MAX_CROSS_CHAIN_FEE_BPS_CAP`).
     * @param _acceptedManifestHash   keccak256 of the canonical-JSON strategy
     *                                manifest the depositor approved at the
     *                                moment of vault creation. May be
     *                                `bytes32(0)` for vaults whose operator
     *                                has not yet published a manifest — in
     *                                that mode `executeIntent` only accepts
     *                                intents whose strategyHash is also zero
     *                                (see AegisVault_v4 NatSpec).
     */
    function createVault(
        address _operator,
        address _baseAsset,
        address _venue,
        VaultPolicy calldata _policy,
        address[] calldata _allowedAssets,
        uint16 _maxCrossChainFeeBps,
        bytes32 _acceptedManifestHash
    ) external returns (address vault) {
        if (_baseAsset == address(0)) revert ZeroAddress();
        if (_operator == address(0)) revert ZeroAddress();

        if (_maxCrossChainFeeBps > MAX_CROSS_CHAIN_FEE_BPS_CAP) {
            revert CrossChainFeeCapTooHigh();
        }

        ExecutionRegistry reg = ExecutionRegistry(executionRegistry);
        if (reg.admin() != address(this) && !reg.authorizedFactories(address(this))) {
            revert FactoryNotRegistryAdmin();
        }

        address vaultAddr = vaultImplementation.clone();
        AegisVault_v4 newVault = AegisVault_v4(vaultAddr);

        newVault.initialize(
            msg.sender,
            _baseAsset,
            _operator,
            executionRegistry,
            _venue,
            _policy,
            _allowedAssets,
            protocolTreasury,
            _maxCrossChainFeeBps,
            _acceptedManifestHash
        );

        vault = address(newVault);

        ExecutionRegistry(executionRegistry).authorizeVault(vault);

        allVaults.push(vault);
        ownerVaults[msg.sender].push(vault);
        isVault[vault] = true;
        requestedMaxCrossChainFeeBps[vault] = _maxCrossChainFeeBps;
        vaultManifestHash[vault] = _acceptedManifestHash;

        emit VaultDeployed(
            vault,
            msg.sender,
            _operator,
            _baseAsset,
            _venue,
            _maxCrossChainFeeBps,
            block.timestamp,
            _acceptedManifestHash
        );
    }

    // ── Admin ──

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

    /// @notice V4 factory tag — frontend routing key.
    function version() external pure returns (string memory) { return "v4"; }
}
