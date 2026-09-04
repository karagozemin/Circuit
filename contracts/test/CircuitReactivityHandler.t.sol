// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CircuitReactivityHandler} from "../src/CircuitReactivityHandler.sol";
import {ICircuitEngine} from "../src/interfaces/ICircuitEngine.sol";

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
}

contract MockCircuitEngine is ICircuitEngine {
    uint256 public calls;
    uint256 public lastFillPrice;
    bytes32 public lastCallbackId;

    function handleMarketFill(bytes32, uint16, bytes32, address, uint256 fillPrice, bytes32 callbackId) external {
        calls++;
        lastFillPrice = fillPrice;
        lastCallbackId = callbackId;
    }
}

contract CircuitReactivityHandlerTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant REACTIVITY_PRECOMPILE = address(0x0100);
    address private constant POOL = address(0xBEEF);
    bytes32 private constant STRATEGY_ID = keccak256("strategy-1");
    bytes32 private constant MARKET_ID = bytes32(uint256(99));

    MockCircuitEngine private engine;
    CircuitReactivityHandler private handler;

    function setUp() public {
        engine = new MockCircuitEngine();
        handler = new CircuitReactivityHandler(address(this), address(engine));
        handler.bindMarket(POOL, STRATEGY_ID, MARKET_ID, 1);
    }

    function testRejectsSpoofedDirectCallback() public {
        bytes32[] memory topics = _topics();
        bytes memory data = _data(700_000);
        vm.expectRevert(bytes4(keccak256("OnlyReactivityPrecompile()")));
        handler.onEvent(POOL, topics, data);
    }

    function testForwardsVerifiedFillPrice() public {
        bytes32[] memory topics = _topics();
        bytes memory data = _data(712_000);
        vm.prank(REACTIVITY_PRECOMPILE);
        handler.onEvent(POOL, topics, data);

        require(engine.calls() == 1, "callback not forwarded");
        require(engine.lastFillPrice() == 712_000, "wrong fill price");
    }

    function testDuplicateCallbackIsIdempotent() public {
        bytes32[] memory topics = _topics();
        bytes memory data = _data(712_000);
        vm.prank(REACTIVITY_PRECOMPILE);
        handler.onEvent(POOL, topics, data);
        vm.prank(REACTIVITY_PRECOMPILE);
        handler.onEvent(POOL, topics, data);

        require(engine.calls() == 1, "duplicate callback forwarded");
    }

    function testRejectsWrongEmitter() public {
        bytes32[] memory topics = _topics();
        bytes memory data = _data(712_000);
        vm.expectRevert(CircuitReactivityHandler.UnboundEmitter.selector);
        vm.prank(REACTIVITY_PRECOMPILE);
        handler.onEvent(address(0xCAFE), topics, data);
    }

    function testRejectsReplacingAnotherStrategyBinding() public {
        vm.expectRevert(CircuitReactivityHandler.EmitterAlreadyBound.selector);
        handler.bindMarket(POOL, keccak256("strategy-2"), MARKET_ID, 1);
    }

    function _topics() private view returns (bytes32[] memory topics) {
        topics = new bytes32[](3);
        topics[0] = handler.ORDER_FILLED_TOPIC();
        topics[1] = bytes32(uint256(1));
        topics[2] = bytes32(uint256(2));
    }

    function _data(uint256 fillPrice) private pure returns (bytes memory) {
        return abi.encode(uint256(10), uint256(0), uint256(0), fillPrice);
    }
}
