// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./AegisVault_v3.sol";
import "./ExecutionRegistry.sol";
import "./VaultEvents.sol";

/**
 * @title AegisVaultFactoryV3
 * @notice EIP-1167 minimal-proxy factory for AegisVault_v3 clones.
 *
 *         Mirrors AegisVaultFactory (v1/v2) but targets the v3 implementation,
 *         which adds cross-chain (Khalani) fill acceptance via `acceptCrossChainFill`.
 *
 *         Each clone is auto-authorized in the shared ExecutionRegistry so the
 *         vault can register + finalize intents (both Jaine on-chain swaps and
 *         Khalani cross-chain fills go through the same replay-guard map).
 *
 *         **`maxCrossChainFeeBps` wiring**
 *
 *         AegisVault_v3.initialize() does NOT take `maxCrossChainFeeBps` as a
 *         parameter — the field is seeded to `DEFAULT_MAX_CROSS_CHAIN_FEE_BPS`
 *         (50 bps) by the initializer and may only be changed afterwards via
 *         `setMaxCrossChainFeeBps`, which is `owner`-gated.
 *
 *         Because the factory passes `msg.sender` (the user, not the factory)
 *         as `_owner` to `initialize`, the factory itself has no authority to
 *         call `setMaxCrossChainFeeBps` post-init. We therefore:
 *           1. Validate the requested cap at factory level (`<= 200` bps)
 *              against the same hard cap the vault enforces, so a bad value
 *              fails fast at vault creation rather than on the follow-up call.
 *           2. Persist the requested cap in `requestedMaxCrossChainFeeBps[vault]`
 *              and emit it in `VaultDeployed` so off-chain consumers (frontend,
 *              orchestrator) can read the user's intended cap before they
 *              follow up with their own `vault.setMaxCrossChainFeeBps(...)` tx.
 *           3. Leave the actual on-chain value at the v3 default until the
 *              owner submits that follow-up call. Clones created with the
 *              default (50 bps) are immediately usable for cross-chain fills.
 *
 *         If a future v3.x adds either an `initialize` overload that accepts
 *         the cap, or a `transferOwnership` (so the factory can briefly own
 *         the clone, set the cap, then hand it off), this factory can be
 *         updated to set the cap atomically. Until then, the two-tx pattern
 *         is the only path consistent with the v3 contract's owner gate.
 */
contract AegisVaultFactoryV3 {
    using Clones for address;

    // ── Constants ──

    /// @notice Hard cap on the per-vault cross-chain fee setting. Mirrors
    ///         AegisVault_v3.MAX_CROSS_CHAIN_FEE_BPS_CAP so the factory can
    ///         fail fast without an extra cross-contract read.
    uint16 public constant MAX_CROSS_CHAIN_FEE_BPS_CAP = 200;

    // ── State ──

    /// @notice AegisVault_v3 implementation cloned by this factory
    address public immutable vaultImplementation;

    /// @notice ExecutionRegistry shared with the v2 stack (so cross-version
    ///         replay guards stay consistent)
    address public executionRegistry;

    /// @notice Optional protocol treasury forwarded to clones at init
    address public protocolTreasury;

    /// @notice Factory admin — can rotate treasury / admin (mirrors v1/v2)
    address public admin;

    address[] public allVaults;
    mapping(address => address[]) public ownerVaults;
    mapping(address => bool) public isVault;

    /// @notice Per-clone record of the maxCrossChainFeeBps the user requested
    ///         at creation time. Off-chain consumers read this to know the
    ///         intended ceiling even before the owner submits the follow-up
    ///         `setMaxCrossChainFeeBps` tx. The on-chain value on the vault
    ///         remains at v3's `DEFAULT_MAX_CROSS_CHAIN_FEE_BPS` until then.
    mapping(address => uint16) public requestedMaxCrossChainFeeBps;

    // ── Events ──

    event VaultDeployed(
        address indexed vault,
        address indexed owner,
        address baseAsset,
        address venue,
        uint16  requestedMaxCrossChainFeeBps,
        uint256 timestamp
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
        protocolTreasury = _protocolTreasury; // can be 0 for no treasury
        admin = msg.sender;
    }

    // ── Create Vault ──

    /**
     * @notice Deploy a new AegisVault_v3 clone, authorize it in the registry,
     *         and record the user's requested cross-chain fee cap.
     *
     * @dev    The caller becomes the vault's `owner`. After this tx returns,
     *         the new owner SHOULD send a follow-up tx
     *         `IAegisVaultV3(vault).setMaxCrossChainFeeBps(_maxCrossChainFeeBps)`
     *         if `_maxCrossChainFeeBps != DEFAULT_MAX_CROSS_CHAIN_FEE_BPS`
     *         (50 bps). Until then the clone enforces the v3 default.
     *
     * @param _operator               Address that becomes the vault's owner
     *                                (passes through to `initialize._owner`).
     * @param _baseAsset              ERC-20 base asset (e.g. USDC.e on 0G).
     * @param _venue                  Either JaineVenueAdapterV2 (on-chain swap
     *                                path) or KhalaniVenueAdapter (cross-chain
     *                                attestation path) — v3 supports both.
     * @param _policy                 Initial vault policy (risk + fees).
     * @param _allowedAssets          Array of additionally permitted assets.
     * @param _maxCrossChainFeeBps    User-requested cross-chain fee ceiling
     *                                (must be `<= MAX_CROSS_CHAIN_FEE_BPS_CAP`).
     */
    function createVault(
        address _operator,
        address _baseAsset,
        address _venue,
        VaultPolicy calldata _policy,
        address[] calldata _allowedAssets,
        uint16 _maxCrossChainFeeBps
    ) external returns (address vault) {
        if (_baseAsset == address(0)) revert ZeroAddress();
        if (_operator == address(0)) revert ZeroAddress();

        // Mirror the v3 vault's hard cap at the factory boundary so a request
        // outside the allowed range is rejected before any state is touched.
        if (_maxCrossChainFeeBps > MAX_CROSS_CHAIN_FEE_BPS_CAP) {
            revert CrossChainFeeCapTooHigh();
        }

        // Fail early if the registry admin slot has drifted (mirrors v1/v2).
        if (ExecutionRegistry(executionRegistry).admin() != address(this)) {
            revert FactoryNotRegistryAdmin();
        }

        // EIP-1167 minimal proxy clone of the v3 implementation.
        address vaultAddr = vaultImplementation.clone();
        AegisVault_v3 newVault = AegisVault_v3(vaultAddr);

        // v3.initialize() takes the cross-chain fee cap directly so the
        // factory can persist the operator's requested value at vault
        // creation, in one transaction. (v2 had no such slot.)
        newVault.initialize(
            _operator,
            _baseAsset,
            msg.sender, // executor — v1/v2 used a separate `_executor` arg;
                        // we keep parity by sourcing it from msg.sender so
                        // the deployer-of-record is the off-chain orchestrator
                        // wallet that submitted this tx. If a third-party
                        // admin needs to deploy on behalf of an operator, use
                        // a meta-tx relayer or call from the operator wallet.
            executionRegistry,
            _venue,
            _policy,
            _allowedAssets,
            protocolTreasury,
            _maxCrossChainFeeBps
        );

        vault = address(newVault);

        // Authorize the new vault so it can register + finalize intents
        // (covers both on-chain Jaine swaps and cross-chain Khalani fills).
        ExecutionRegistry(executionRegistry).authorizeVault(vault);

        allVaults.push(vault);
        ownerVaults[_operator].push(vault);
        isVault[vault] = true;
        requestedMaxCrossChainFeeBps[vault] = _maxCrossChainFeeBps;

        emit VaultDeployed(
            vault,
            _operator,
            _baseAsset,
            _venue,
            _maxCrossChainFeeBps,
            block.timestamp
        );
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
