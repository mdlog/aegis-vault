// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./VaultEvents.sol";
import "./libraries/ExecLib.sol";
import "./libraries/SealedLib.sol";
import "./libraries/IOLib.sol";

/**
 * @title AegisVault (slim build for 0G Aristotle mainnet)
 * @notice Track 2 sealed-strategy vault. Aggressively slimmed to fit per-block gas
 *         limit on 0G mainnet. Heavy logic delegated to ExecLib (DELEGATECALL'd).
 */
contract AegisVault {
    using SafeERC20 for IERC20;

    // Slim state
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


    function commitIntent(bytes32 commitHash) external {
        require(msg.sender == executor && policy.sealedMode && commitHash != bytes32(0), "c");
        intentCommits[commitHash] = block.number;
        emit VaultEvents.IntentCommitted(address(this), commitHash, block.number);
    }

    function executeIntent(ExecutionIntent calldata intent, bytes calldata sig) external {
        require(msg.sender == executor && !policy.paused && policy.autoExecution, "x");
        require(intent.vault == address(this), "v");

        if (policy.sealedMode) {
            bytes32 commitHash = SealedLib.verifyAttestation(intent.intentHash, intent.attestationReportHash, policy.attestedSigner, sig);
            uint256 cb = intentCommits[commitHash];
            require(cb != 0 && block.number >= cb + 1, "cr");
            delete intentCommits[commitHash];
            emit VaultEvents.SealedIntentExecuted(address(this), intent.intentHash, policy.attestedSigner, intent.attestationReportHash);
        }

        if (block.timestamp >= dailyActionResetTime) {
            dailyActionCount = 0;
            dailyActionResetTime = block.timestamp + 1 days;
        }

        ExecLib.runExecution(intent, policy, venue, address(baseAsset), registry, lastExecutionTime, dailyActionCount);

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
}
