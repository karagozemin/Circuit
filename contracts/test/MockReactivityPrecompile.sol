// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Local Anvil-only subscription storage. Does not claim to emulate validator delivery.
contract MockReactivityPrecompile {
    struct SubscriptionData {
        bytes32[4] eventTopics;
        address origin;
        address caller;
        address emitter;
        address handlerContractAddress;
        bytes4 handlerFunctionSelector;
        uint64 priorityFeePerGas;
        uint64 maxFeePerGas;
        uint64 gasLimit;
        bool isGuaranteed;
        bool isCoalesced;
    }
    uint256 private nonce;
    mapping(uint256 => SubscriptionData) private subscriptions;
    mapping(uint256 => address) private owners;
    event SubscriptionCreated(uint256 indexed subscriptionId, address indexed owner, SubscriptionData subscriptionData);
    function subscribe(SubscriptionData calldata data) external returns (uint256 id) {
        id = ++nonce;
        subscriptions[id] = data;
        owners[id] = msg.sender;
        emit SubscriptionCreated(id, msg.sender, data);
    }
    function getSubscriptionInfo(uint256 id) external view returns (SubscriptionData memory subscriptionData, address owner) {
        require(owners[id] != address(0), "unknown subscription");
        return (subscriptions[id], owners[id]);
    }
}
