// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {ICircuitEngine} from "./interfaces/ICircuitEngine.sol";

contract CircuitReactivityHandler is SomniaEventHandler {
    error OnlyOwner();
    error InvalidAddress();
    error UnboundEmitter();
    error UnexpectedTopic();
    error MalformedEvent();

    bytes32 public constant ORDER_FILLED_TOPIC =
        keccak256("OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)");

    struct Binding {
        bytes32 strategyId;
        bytes32 marketId;
        uint16 round;
        bool active;
    }

    address public immutable owner;
    ICircuitEngine public engine;
    mapping(address pool => Binding) public bindings;
    mapping(bytes32 callbackId => bool) public processedCallbacks;

    event EngineUpdated(address indexed previousEngine, address indexed newEngine);
    event MarketBound(
        address indexed pool,
        bytes32 indexed strategyId,
        bytes32 indexed marketId,
        uint16 round
    );
    event MarketUnbound(address indexed pool);
    event ReactivityCallbackProcessed(
        bytes32 indexed callbackId,
        bytes32 indexed strategyId,
        bytes32 indexed marketId,
        address pool,
        uint16 round,
        uint256 fillPrice
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address initialOwner, address initialEngine) {
        if (initialOwner == address(0) || initialEngine == address(0)) revert InvalidAddress();
        owner = initialOwner;
        engine = ICircuitEngine(initialEngine);
    }

    function setEngine(address newEngine) external onlyOwner {
        if (newEngine == address(0)) revert InvalidAddress();
        address previous = address(engine);
        engine = ICircuitEngine(newEngine);
        emit EngineUpdated(previous, newEngine);
    }

    function bindMarket(
        address pool,
        bytes32 strategyId,
        bytes32 marketId,
        uint16 round
    ) external onlyOwner {
        if (pool == address(0)) revert InvalidAddress();
        bindings[pool] = Binding({
            strategyId: strategyId,
            marketId: marketId,
            round: round,
            active: true
        });
        emit MarketBound(pool, strategyId, marketId, round);
    }

    function unbindMarket(address pool) external onlyOwner {
        delete bindings[pool];
        emit MarketUnbound(pool);
    }

    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal override {
        Binding memory binding = bindings[emitter];
        if (!binding.active) revert UnboundEmitter();
        if (eventTopics.length != 3) revert MalformedEvent();
        if (eventTopics[0] != ORDER_FILLED_TOPIC) revert UnexpectedTopic();
        if (data.length != 128) revert MalformedEvent();

        bytes32 callbackId = keccak256(abi.encode(emitter, eventTopics, data));
        if (processedCallbacks[callbackId]) return;
        processedCallbacks[callbackId] = true;

        (, , , uint256 fillPrice) = abi.decode(data, (uint256, uint256, uint256, uint256));
        engine.handleMarketFill(
            binding.strategyId,
            binding.round,
            binding.marketId,
            emitter,
            fillPrice,
            callbackId
        );
        emit ReactivityCallbackProcessed(
            callbackId,
            binding.strategyId,
            binding.marketId,
            emitter,
            binding.round,
            fillPrice
        );
    }
}

