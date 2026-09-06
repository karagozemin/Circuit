// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {IBinaryModule} from "./interfaces/IBinaryLifecycle.sol";
import {ICircuitEngine} from "./interfaces/ICircuitEngine.sol";

interface IEngineModuleView { function binaryModule() external view returns (address); }

contract CircuitReactivityHandler is SomniaEventHandler {
    error OnlyOwner();
    error OnlyOwnerOrEngine();
    error InvalidAddress();
    error UnboundEmitter();
    error UnexpectedTopic();
    error MalformedEvent();
    error EmitterAlreadyBound();

    bytes32 public constant ORDER_FILLED_TOPIC =
        keccak256("OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)");

    bytes32 public constant STATUS_CHANGED_TOPIC = keccak256("StatusChanged(uint8,uint8)");
    mapping(address => bool) public resolutionEmitters;

    bytes32 public constant MARKET_CREATED_TOPIC = keccak256("MarketCreated(bytes32,address,address,uint256,uint256,address,string,uint256,uint64,uint64,uint256,string,uint64)");
    struct MarketMetadata { address creator; uint8 assetId; uint32 intervalSec; bool verified; }
    struct CreatedMarketData {
        uint256 yesId; uint256 noId; address collateral; string asset; uint256 strike;
        uint64 tradingStart; uint64 expiry; uint256 oracleQuestionId; string question; uint64 intervalSec;
    }
    mapping(bytes32 => MarketMetadata) public marketMetadata;
    event SuccessorMarketRegistered(bytes32 indexed marketId, address indexed creator, uint8 assetId, uint32 intervalSec);

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
    event MarketBound(address indexed pool, bytes32 indexed strategyId, bytes32 indexed marketId, uint16 round);
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

    modifier onlyOwnerOrEngine() {
        if (msg.sender != owner && msg.sender != address(engine)) revert OnlyOwnerOrEngine();
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

    function bindMarket(address pool, bytes32 strategyId, bytes32 marketId, uint16 round) external onlyOwnerOrEngine {
        if (pool == address(0)) revert InvalidAddress();
        Binding memory current = bindings[pool];
        if (current.active && current.strategyId != strategyId) revert EmitterAlreadyBound();
        bindings[pool] = Binding({strategyId: strategyId, marketId: marketId, round: round, active: true});
        emit MarketBound(pool, strategyId, marketId, round);
    }

    function bindResolutionMarket(address market, bytes32 strategyId, bytes32 marketId, uint16 round) external onlyOwnerOrEngine {
        if (market == address(0)) revert InvalidAddress();
        if (bindings[market].active && bindings[market].strategyId != strategyId) revert EmitterAlreadyBound();
        bindings[market] = Binding(strategyId, marketId, round, true);
        resolutionEmitters[market] = true;
        emit MarketBound(market, strategyId, marketId, round);
    }

    function unbindMarket(address pool) external onlyOwnerOrEngine {
        delete bindings[pool];
        delete resolutionEmitters[pool];
        emit MarketUnbound(pool);
    }

    function _onEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata data) internal override {
        if (eventTopics.length > 0 && eventTopics[0] == MARKET_CREATED_TOPIC) {
            _registerSuccessor(emitter, eventTopics, data);
            return;
        }
        Binding memory binding = bindings[emitter];
        if (!binding.active) revert UnboundEmitter();
        if (eventTopics.length != 3) revert MalformedEvent();
        if (resolutionEmitters[emitter]) {
            if (eventTopics[0] != STATUS_CHANGED_TOPIC) revert UnexpectedTopic();
            if (data.length != 0 || uint256(eventTopics[1]) > 5 || uint256(eventTopics[2]) > 5) revert MalformedEvent();
            // State payload only wakes the engine; settlement is independently read there.
            engine.handleResolution(binding.strategyId, binding.marketId,
                keccak256(abi.encode(binding.strategyId, binding.round, emitter, eventTopics, data)));
            return;
        }
        if (eventTopics[0] != ORDER_FILLED_TOPIC) revert UnexpectedTopic();
        if (data.length != 128) revert MalformedEvent();

        bytes32 callbackId = keccak256(abi.encode(binding.strategyId, binding.round, emitter, eventTopics, data));
        if (processedCallbacks[callbackId]) return;
        processedCallbacks[callbackId] = true;

        (,,, uint256 fillPrice) = abi.decode(data, (uint256, uint256, uint256, uint256));
        engine.handleMarketFill(binding.strategyId, binding.round, binding.marketId, emitter, fillPrice, callbackId);
        emit ReactivityCallbackProcessed(
            callbackId, binding.strategyId, binding.marketId, emitter, binding.round, fillPrice
        );
    }
    function _registerSuccessor(address emitter, bytes32[] calldata topics, bytes calldata data) private {
        if (topics.length != 4 || data.length < 320) revert MalformedEvent();
        bytes32 marketId = topics[1];
        if (marketMetadata[marketId].verified) return;
        // Event data is a flattened ABI tuple. Prefix its offset to decode a dynamic struct.
        CreatedMarketData memory created = abi.decode(abi.encodePacked(uint256(32), data), (CreatedMarketData));
        IBinaryModule module = IBinaryModule(IEngineModuleView(address(engine)).binaryModule());
        IBinaryModule.MarketRecord memory record = module.markets(marketId);
        if (record.creator != emitter || record.outcomeSlotCount != 2
            || topics[2] != bytes32(uint256(uint160(record.market))) || topics[3] != bytes32(uint256(uint160(record.pool)))
            || record.collateral != created.collateral || record.yesId != created.yesId || record.noId != created.noId
            || record.tradingStart != created.tradingStart || record.expiry != created.expiry
            || record.oracleQuestionId != created.oracleQuestionId) revert UnboundEmitter();
        if (created.expiry < created.tradingStart || created.expiry - created.tradingStart != created.intervalSec) revert MalformedEvent();
        bytes32 asset = keccak256(bytes(created.asset));
        if ((asset != keccak256("BTC") && asset != keccak256("ETH")) || (created.intervalSec != 900 && created.intervalSec != 3600)) return;
        uint8 assetId = asset == keccak256("BTC") ? 0 : 1;
        marketMetadata[marketId] = MarketMetadata(emitter, assetId, uint32(created.intervalSec), true);
        emit SuccessorMarketRegistered(marketId, emitter, assetId, uint32(created.intervalSec));
    }

}
