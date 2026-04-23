// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./VaultEvents.sol";
import "./libraries/ExecLib.sol";
import "./libraries/SealedLib.sol";
import "./libraries/IOLib.sol";

/**
 * @title AegisVault_v2
 * @notice Track 2 sealed-strategy vault, v2.
 *
 *         Changes vs v1:
 *           - withdrawToken(token, amount):  owner can rescue any non-baseAsset
 *                                            ERC-20 stuck in the vault (e.g. W0G
 *                                            deposited via bare transfer to a USDC
 *                                            vault, or non-base holdings left from
 *                                            an AI trade that wasn't closed).
 *           - withdrawAllNonBase():          convenience — drain every allowed
 *                                            non-base asset in one call. Bounded
 *                                            by MAX_ALLOWED_ASSETS (set at init).
 *           - MAX_ALLOWED_ASSETS:            init-time sanity cap to prevent a
 *                                            gas-DoS on withdrawAllNonBase via an
 *                                            excessively long allowed-assets list.
 *
 *         v1 vaults keep working; they just don't get the rescue path. Users who
 *         want rescue must create a new vault from the v2 factory.
 */
contract AegisVault_v2 {
    using SafeERC20 for IERC20;

    // ── Constants ──
    /// @notice Hard cap on the allowed-assets list to keep withdrawAllNonBase()
    ///         gas-bounded. Matches the 10-asset limit discussed for v2 scope.
    uint256 public constant MAX_ALLOWED_ASSETS = 10;

    // Slim state (same layout as v1 — keep storage slots identical so the
    // frontend ABI can reuse view selectors where they overlap).
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
        emit VaultEvents.VaultCreated(address(this), _owner, _baseAsset);
    }

    function deposit(uint256 amount) external {
        require(msg.sender == owner && !policy.paused, "d");
        uint256 net = IOLib.doDeposit(address(baseAsset), msg.sender, amount, policy.feeRecipient, policy.entryFeeBps);
        totalDeposited += net;
    }

    function withdraw(uint256 amount) external {
        require(msg.sender == owner && !policy.paused, "w");
        IOLib.doWithdraw(address(baseAsset), owner, amount, policy.feeRecipient, policy.exitFeeBps);
    }

    // ── NEW in v2: multi-asset rescue ──

    /**
     * @notice Withdraw a non-baseAsset ERC-20 directly to the owner. No fee is
     *         charged (rescue semantics, not a priced exit). The base asset is
     *         explicitly blocked — callers must use withdraw() for that path so
     *         the exit fee is collected consistently.
     * @param token  ERC-20 token to rescue (must not be the vault's base asset)
     * @param amount amount in token's native units
     */
    function withdrawToken(address token, uint256 amount) external {
        require(msg.sender == owner && !policy.paused, "wt");
        require(token != address(baseAsset), "use withdraw()");
        require(token != address(0) && amount > 0, "bad args");
        IERC20(token).safeTransfer(owner, amount);
        emit VaultEvents.TokenWithdrawn(address(this), token, owner, amount);
    }

    /**
     * @notice Drain every allowed non-base asset this vault currently holds to
     *         the owner. Skips the base asset (use withdraw()) and skips tokens
     *         with zero balance. Gas-bounded by MAX_ALLOWED_ASSETS enforced at
     *         initialize time.
     */
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

    function getAllowedAssets() external view returns (address[] memory) { return _allowedAssets; }
    function getPolicy() external view returns (VaultPolicy memory) { return policy; }
    function getVaultSummary() external view returns (
        address, address, address, uint256, uint256, uint256, uint256, bool, bool
    ) {
        return (owner, executor, address(baseAsset), baseAsset.balanceOf(address(this)),
                totalDeposited, lastExecutionTime, dailyActionCount, policy.paused, policy.autoExecution);
    }

    /// @notice v2-specific: version tag for frontend routing / indexer labeling
    function version() external pure returns (string memory) { return "v2"; }
}
