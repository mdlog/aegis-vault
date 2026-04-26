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
 *         **Trust model — owner vs operator**
 *
 *         AegisVault_v3 separates two trusted roles:
 *           - `owner`    : the depositor, who can deposit/withdraw and rotate
 *                          policy fields.
 *           - `executor` : the operator's orchestrator wallet, the only
 *                          address allowed to submit signed intents and
 *                          accept Khalani fills on behalf of the vault.
 *
 *         The factory mirrors v1's canonical mapping: `msg.sender` (the user
 *         calling createVault) becomes the vault's `owner`, and the
 *         `_operator` argument — the chosen operator's executor wallet —
 *         becomes the vault's `executor`. Inverting these two would let the
 *         operator drain the vault via `withdraw`, which is why this factory
 *         takes them as distinct values rather than collapsing both onto
 *         `msg.sender`.
 *
 *         **`maxCrossChainFeeBps` wiring**
 *
 *         AegisVault_v3.initialize() takes `_maxCrossChainFeeBps` directly so
 *         the user's requested cap is sealed at vault creation in a single
 *         transaction. The factory still validates the cap against the same
 *         hard ceiling the vault enforces (`<= 200` bps) so a bad value
 *         fails fast at the factory boundary, and persists the value in
 *         `requestedMaxCrossChainFeeBps[vault]` for off-chain consumers to
 *         read without a vault round-trip.
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
        address indexed operator,
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
     * @dev    `msg.sender` becomes the vault's `owner` (depositor). The
     *         `_operator` parameter — the chosen operator's orchestrator
     *         wallet — becomes the vault's `executor`. These two roles are
     *         intentionally distinct: the owner controls deposits/withdrawals,
     *         the executor signs intents and accepts cross-chain fills.
     *         Conflating them (e.g. by sourcing both from `msg.sender`) would
     *         allow whichever wallet held the executor role to also drain
     *         deposited funds via `withdraw`.
     *
     * @param _operator               Operator's orchestrator wallet — becomes
     *                                the vault's `executor`. The depositor
     *                                (`msg.sender`) becomes the `owner`.
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

        // Fail early if this factory cannot register clones — accepts either
        // legacy admin-style ownership OR membership in the registry's
        // multi-factory authorization set so v1/v2/v3 can coexist.
        ExecutionRegistry reg = ExecutionRegistry(executionRegistry);
        if (reg.admin() != address(this) && !reg.authorizedFactories(address(this))) {
            revert FactoryNotRegistryAdmin();
        }

        // EIP-1167 minimal proxy clone of the v3 implementation.
        address vaultAddr = vaultImplementation.clone();
        AegisVault_v3 newVault = AegisVault_v3(vaultAddr);

        // Canonical role mapping (matches v1 factory): caller is the depositor
        // (owner), `_operator` is the orchestrator wallet (executor). v3's
        // initialize seals `_maxCrossChainFeeBps` in the same call so the cap
        // is bound atomically with deployment.
        newVault.initialize(
            msg.sender,
            _baseAsset,
            _operator,
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
        ownerVaults[msg.sender].push(vault);
        isVault[vault] = true;
        requestedMaxCrossChainFeeBps[vault] = _maxCrossChainFeeBps;

        emit VaultDeployed(
            vault,
            msg.sender,
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
