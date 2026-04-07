// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title OperatorRegistry
 * @notice Public directory of AI agent operators that can be set as executors on AegisVaults.
 *
 *         Operators register themselves with metadata (name, strategy, endpoint).
 *         Vault owners browse the registry and pick an operator to manage their vault.
 *
 *         Trust model:
 *         - Registry only stores public metadata, NEVER funds.
 *         - Operators have ZERO access to vault funds (they only call executeIntent).
 *         - Owners can switch operators at any time via vault.setExecutor().
 *         - Reputation tracking is opt-in: operators self-report performance via attestations,
 *           but the actual on-chain executions speak for themselves.
 */
contract OperatorRegistry {
    // ── Strategy mandates ──
    enum Mandate {
        Conservative,
        Balanced,
        Tactical
    }

    // ── State ──
    struct Operator {
        address wallet;             // executor wallet (used as setExecutor target)
        string  name;               // human-readable display name
        string  description;        // strategy/approach description (max ~500 chars)
        string  endpoint;           // optional public API URL
        Mandate mandate;            // strategy mandate type
        uint256 registeredAt;       // block timestamp of registration
        uint256 updatedAt;          // last metadata update
        bool    active;             // operator can be deactivated by owner

        // ── Phase 1: Declared Fee Structure ──
        uint256 performanceFeeBps;  // declared performance fee (max 3000 = 30%)
        uint256 managementFeeBps;   // declared management fee (max 500 = 5%/year)
        uint256 entryFeeBps;        // declared entry fee (max 200 = 2%)
        uint256 exitFeeBps;         // declared exit fee (max 200 = 2%)

        // ── Phase 1: Strategy Recommendations ──
        uint256 recommendedMaxPositionBps;
        uint256 recommendedConfidenceMinBps;
        uint256 recommendedStopLossBps;
        uint256 recommendedCooldownSeconds;
        uint256 recommendedMaxActionsPerDay;
    }

    // Hardcoded fee caps mirrored from AegisVault
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 3000;
    uint256 public constant MAX_MANAGEMENT_FEE_BPS = 500;
    uint256 public constant MAX_ENTRY_FEE_BPS = 200;
    uint256 public constant MAX_EXIT_FEE_BPS = 200;

    // wallet => operator metadata
    mapping(address => Operator) public operators;

    // List of all registered operator wallets (for enumeration)
    address[] public operatorList;
    mapping(address => uint256) private operatorIndex; // wallet => index+1 (0 = not present)

    // ── Events ──
    event OperatorRegistered(
        address indexed wallet,
        string name,
        Mandate mandate,
        uint256 timestamp
    );

    event OperatorUpdated(
        address indexed wallet,
        string name,
        Mandate mandate
    );

    event OperatorActivated(address indexed wallet);
    event OperatorDeactivated(address indexed wallet);

    // ── Errors ──
    error AlreadyRegistered();
    error NotRegistered();
    error EmptyName();
    error NameTooLong();
    error DescriptionTooLong();
    error EndpointTooLong();
    error NotOperatorOwner();
    error FeeAboveMax();

    // ── Constants ──
    uint256 public constant MAX_NAME_LENGTH = 64;
    uint256 public constant MAX_DESCRIPTION_LENGTH = 500;
    uint256 public constant MAX_ENDPOINT_LENGTH = 200;

    // ── Modifiers ──
    modifier onlyRegistered(address wallet) {
        if (operatorIndex[wallet] == 0) revert NotRegistered();
        _;
    }

    modifier onlyOperatorSelf(address wallet) {
        if (msg.sender != wallet) revert NotOperatorOwner();
        _;
    }

    // ── Registration ──

    /// @notice Input struct for register/update — avoids stack too deep
    struct OperatorInput {
        string  name;
        string  description;
        string  endpoint;
        Mandate mandate;
        uint256 performanceFeeBps;
        uint256 managementFeeBps;
        uint256 entryFeeBps;
        uint256 exitFeeBps;
        uint256 recommendedMaxPositionBps;
        uint256 recommendedConfidenceMinBps;
        uint256 recommendedStopLossBps;
        uint256 recommendedCooldownSeconds;
        uint256 recommendedMaxActionsPerDay;
    }

    /**
     * @notice Register the caller as an operator.
     */
    function register(OperatorInput calldata input) external {
        if (operatorIndex[msg.sender] != 0) revert AlreadyRegistered();
        _validateMetadata(input.name, input.description, input.endpoint);
        _validateFees(input.performanceFeeBps, input.managementFeeBps, input.entryFeeBps, input.exitFeeBps);

        operators[msg.sender] = Operator({
            wallet: msg.sender,
            name: input.name,
            description: input.description,
            endpoint: input.endpoint,
            mandate: input.mandate,
            registeredAt: block.timestamp,
            updatedAt: block.timestamp,
            active: true,
            performanceFeeBps: input.performanceFeeBps,
            managementFeeBps: input.managementFeeBps,
            entryFeeBps: input.entryFeeBps,
            exitFeeBps: input.exitFeeBps,
            recommendedMaxPositionBps: input.recommendedMaxPositionBps,
            recommendedConfidenceMinBps: input.recommendedConfidenceMinBps,
            recommendedStopLossBps: input.recommendedStopLossBps,
            recommendedCooldownSeconds: input.recommendedCooldownSeconds,
            recommendedMaxActionsPerDay: input.recommendedMaxActionsPerDay
        });

        operatorList.push(msg.sender);
        operatorIndex[msg.sender] = operatorList.length;

        emit OperatorRegistered(msg.sender, input.name, input.mandate, block.timestamp);
    }

    /**
     * @notice Update operator metadata.
     */
    function updateMetadata(OperatorInput calldata input) external onlyRegistered(msg.sender) {
        _validateMetadata(input.name, input.description, input.endpoint);
        _validateFees(input.performanceFeeBps, input.managementFeeBps, input.entryFeeBps, input.exitFeeBps);

        Operator storage op = operators[msg.sender];
        op.name = input.name;
        op.description = input.description;
        op.endpoint = input.endpoint;
        op.mandate = input.mandate;
        op.performanceFeeBps = input.performanceFeeBps;
        op.managementFeeBps = input.managementFeeBps;
        op.entryFeeBps = input.entryFeeBps;
        op.exitFeeBps = input.exitFeeBps;
        op.recommendedMaxPositionBps = input.recommendedMaxPositionBps;
        op.recommendedConfidenceMinBps = input.recommendedConfidenceMinBps;
        op.recommendedStopLossBps = input.recommendedStopLossBps;
        op.recommendedCooldownSeconds = input.recommendedCooldownSeconds;
        op.recommendedMaxActionsPerDay = input.recommendedMaxActionsPerDay;
        op.updatedAt = block.timestamp;

        emit OperatorUpdated(msg.sender, input.name, input.mandate);
    }

    /**
     * @notice Deactivate operator (hide from marketplace listing).
     *         Existing vault->executor links remain functional on-chain.
     *         Owners must update their vault.executor manually if they want to switch away.
     */
    function deactivate() external onlyRegistered(msg.sender) {
        operators[msg.sender].active = false;
        operators[msg.sender].updatedAt = block.timestamp;
        emit OperatorDeactivated(msg.sender);
    }

    /**
     * @notice Reactivate a previously deactivated operator.
     */
    function activate() external onlyRegistered(msg.sender) {
        operators[msg.sender].active = true;
        operators[msg.sender].updatedAt = block.timestamp;
        emit OperatorActivated(msg.sender);
    }

    // ── Views ──

    function totalOperators() external view returns (uint256) {
        return operatorList.length;
    }

    function getOperator(address wallet) external view returns (Operator memory) {
        if (operatorIndex[wallet] == 0) revert NotRegistered();
        return operators[wallet];
    }

    function isRegistered(address wallet) external view returns (bool) {
        return operatorIndex[wallet] != 0;
    }

    function isActive(address wallet) external view returns (bool) {
        return operatorIndex[wallet] != 0 && operators[wallet].active;
    }

    /**
     * @notice Returns paginated list of operator wallet addresses.
     * @dev Use along with getOperator(wallet) to fetch full metadata.
     *      Front-end can batch via multicall for efficiency.
     */
    function getOperatorPage(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory page)
    {
        uint256 total = operatorList.length;
        if (offset >= total) {
            return new address[](0);
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 size = end - offset;
        page = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = operatorList[offset + i];
        }
    }

    /**
     * @notice Returns ALL operator wallet addresses. Use with caution if list grows large.
     */
    function getAllOperators() external view returns (address[] memory) {
        return operatorList;
    }

    // ── Internal ──

    function _validateMetadata(
        string calldata name,
        string calldata description,
        string calldata endpoint
    ) internal pure {
        bytes memory nameBytes = bytes(name);
        if (nameBytes.length == 0) revert EmptyName();
        if (nameBytes.length > MAX_NAME_LENGTH) revert NameTooLong();
        if (bytes(description).length > MAX_DESCRIPTION_LENGTH) revert DescriptionTooLong();
        if (bytes(endpoint).length > MAX_ENDPOINT_LENGTH) revert EndpointTooLong();
    }

    function _validateFees(
        uint256 perfBps,
        uint256 mgmtBps,
        uint256 entryBps,
        uint256 exitBps
    ) internal pure {
        if (perfBps > MAX_PERFORMANCE_FEE_BPS) revert FeeAboveMax();
        if (mgmtBps > MAX_MANAGEMENT_FEE_BPS) revert FeeAboveMax();
        if (entryBps > MAX_ENTRY_FEE_BPS) revert FeeAboveMax();
        if (exitBps > MAX_EXIT_FEE_BPS) revert FeeAboveMax();
    }
}
