// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * User-owned execution account for Event Contract strategies.
 *
 * The owner funds and approves this account. CircuitEngine is the narrow
 * executor for policy-checked pool calls; an optional session key may be
 * granted one exact target/selector and expiry for off-chain relayers.
 */
contract CircuitSmartAccount {
    error OnlyOwner();
    error OnlyExecutor();
    error InvalidAddress();
    error SessionExpired();
    error TargetNotAllowed();
    error CallFailed(bytes data);

    struct Session {
        address target;
        bytes4 selector;
        uint64 expiresAt;
    }

    address public immutable owner;
    address public immutable executor;
    mapping(address => Session) public sessions;

    event SessionKeySet(address indexed key, address indexed target, bytes4 selector, uint64 expiresAt);
    event SessionKeyRevoked(address indexed key);
    event Executed(address indexed caller, address indexed target, uint256 value, bytes4 selector);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address owner_, address executor_) {
        if (owner_ == address(0) || executor_ == address(0)) revert InvalidAddress();
        owner = owner_;
        executor = executor_;
    }

    receive() external payable {}

    function setSessionKey(address key, address target, bytes4 selector, uint64 expiresAt) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (key == address(0) || target == address(0) || expiresAt <= block.timestamp) revert InvalidAddress();
        sessions[key] = Session({target: target, selector: selector, expiresAt: expiresAt});
        emit SessionKeySet(key, target, selector, expiresAt);
    }

    function revokeSessionKey(address key) external {
        if (msg.sender != owner) revert OnlyOwner();
        delete sessions[key];
        emit SessionKeyRevoked(key);
    }

    function execute(address target, uint256 value, bytes calldata data) external returns (bytes memory result) {
        if (msg.sender != owner && msg.sender != executor) revert OnlyExecutor();
        if (target == address(0) || data.length < 4) revert TargetNotAllowed();
        if (msg.sender == executor) {
            bytes4 selector;
            assembly { selector := calldataload(data.offset) }
            // Engine policy checks the pool, price, quantity and expiry. The
            // account accepts placement and the Engine's exact-position redemption path.
            if (selector != bytes4(keccak256("placeBinaryOrder(uint8,uint256,uint256,uint64,uint8,uint8,address,uint96,uint64)"))
                && selector != bytes4(keccak256("approve(address,uint256,uint256)"))
                && selector != bytes4(keccak256("approve(address,uint256)"))
                && selector != bytes4(keccak256("redeem(uint32,bytes32,bytes32,uint8,uint256)"))) {
                revert TargetNotAllowed();
            }
        }
        (bool ok, bytes memory returned) = target.call{value: value}(data);
        if (!ok) revert CallFailed(returned);
        emit Executed(msg.sender, target, value, bytes4(data));
        return returned;
    }

    function executeSession(address target, uint256 value, bytes calldata data) external returns (bytes memory result) {
        Session memory session = sessions[msg.sender];
        if (session.expiresAt == 0 || session.expiresAt < block.timestamp) revert SessionExpired();
        if (target != session.target || data.length < 4 || bytes4(data) != session.selector) revert TargetNotAllowed();
        (bool ok, bytes memory returned) = target.call{value: value}(data);
        if (!ok) revert CallFailed(returned);
        emit Executed(msg.sender, target, value, bytes4(data));
        return returned;
    }
}
