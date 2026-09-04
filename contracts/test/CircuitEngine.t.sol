// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CircuitEngine} from "../src/CircuitEngine.sol";
import {CircuitReactivityHandler} from "../src/CircuitReactivityHandler.sol";
import {IBinaryMarket, IBinaryPool, IERC20Balance, IERC6909Balance} from "../src/interfaces/IDreamDexBinary.sol";

interface EngineVm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
}

contract MockCollateral is IERC20Balance {
    mapping(address => uint256) public balanceOf;

    function setBalance(address account, uint256 amount) external {
        balanceOf[account] = amount;
    }

    function debit(address account, uint256 amount) external {
        balanceOf[account] -= amount;
    }
}

contract MockOutcome is IERC6909Balance {
    mapping(address => mapping(uint256 => uint256)) private balances;

    function balanceOf(address owner, uint256 id) external view returns (uint256) {
        return balances[owner][id];
    }

    function credit(address owner, uint256 id, uint256 amount) external {
        balances[owner][id] += amount;
    }
}

contract MockBinaryPool is IBinaryPool {
    error OnlyApprovedContracts();

    MockCollateral public immutable collateralToken;
    MockOutcome public immutable outcomeToken;
    mapping(address => bool) public approvedContracts;
    uint256 public collateralUsed = 2_500_000;
    uint256 public positionReceived = 10_000_000;
    bool public succeeds = true;
    uint128 public nextOrderId = 41;

    function getOrderBookParameters() external pure returns (OrderBookParameters memory) {
        return OrderBookParameters({tickSize: 1_000, minQuantity: 1_000_000, lotSize: 1_000_000});
    }

    constructor(MockCollateral collateral_, MockOutcome outcome_) {
        collateralToken = collateral_;
        outcomeToken = outcome_;
    }

    function configure(uint256 collateralUsed_, uint256 positionReceived_, bool succeeds_) external {
        collateralUsed = collateralUsed_;
        positionReceived = positionReceived_;
        succeeds = succeeds_;
    }

    function setApprovedContract(address account, bool approved) external {
        approvedContracts[account] = approved;
    }

    function placeBinaryOrderFor(
        address owner,
        uint8 kind,
        uint256,
        uint256,
        uint64,
        uint8 orderType,
        uint8,
        address,
        uint96,
        uint64
    ) external payable returns (bool success, uint128 orderId) {
        if (!approvedContracts[msg.sender]) revert OnlyApprovedContracts();
        require(kind == 0 || kind == 2, "invalid kind");
        require(orderType == 2, "not IOC");
        if (!succeeds) return (false, 0);
        collateralToken.debit(owner, collateralUsed);
        outcomeToken.credit(owner, kind == 0 ? 1 : 2, positionReceived);
        return (true, nextOrderId++);
    }
}

contract MockBinaryMarket is IBinaryMarket {
    address public immutable pool;
    address public immutable collateral;
    address public immutable outcomeToken;
    uint256 public constant yesId = 1;
    uint256 public constant noId = 2;
    uint8 public status = 1;
    uint64 public expiry;

    constructor(address pool_, address collateral_, address outcomeToken_, uint64 expiry_) {
        pool = pool_;
        collateral = collateral_;
        outcomeToken = outcomeToken_;
        expiry = expiry_;
    }

    function setStatus(uint8 status_) external {
        status = status_;
    }
}

contract CircuitEngineTest {
    EngineVm private constant vm = EngineVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant MANIFEST_HASH = keccak256("manifest-v1");
    bytes32 private constant MARKET_ID = bytes32(uint256(123));

    CircuitEngine private engine;
    MockCollateral private collateral;
    MockOutcome private outcome;
    MockBinaryPool private pool;
    MockBinaryMarket private market;
    bytes32 private strategyId;

    function setUp() public {
        vm.warp(1_000_000);
        collateral = new MockCollateral();
        outcome = new MockOutcome();
        pool = new MockBinaryPool(collateral, outcome);
        market =
            new MockBinaryMarket(address(pool), address(collateral), address(outcome), uint64(block.timestamp + 900));
        engine = new CircuitEngine(address(this), address(this));
        pool.setApprovedContract(address(engine), true);
        collateral.setBalance(address(this), 100_000_000);
        strategyId = engine.createStrategy(MANIFEST_HASH, _config());
        engine.bindMarket(
            strategyId, MARKET_ID, address(market), address(pool), address(collateral), address(outcome), 2
        );
        engine.activateStrategy(strategyId);
    }

    function testValidatedStrategyExecutesFromActualBalanceDeltas() public {
        _trigger(bytes32(uint256(1)));
        (uint128 orderId, uint256 used, uint256 received) = engine.executeReadyAction(strategyId, 745_000, 10_000_000);
        (, CircuitEngine.StrategyRuntime memory runtime) = engine.getStrategy(strategyId);

        require(orderId == 41, "wrong order id");
        require(used == 2_500_000, "wrong collateral accounting");
        require(received == 10_000_000, "wrong position accounting");
        require(runtime.cumulativeCapitalUsed == used, "cumulative accounting mismatch");
        require(runtime.currentPositionSize == received, "position mismatch");
        require(runtime.status == CircuitEngine.StrategyStatus.WAITING_RESOLUTION, "wrong state");
    }

    function testRejectsPriceOutsideSlippageBound() public {
        _trigger(bytes32(uint256(2)));
        vm.expectRevert(CircuitEngine.SlippageExceeded.selector);
        engine.executeReadyAction(strategyId, 700_000, 10_000_000);
    }

    function testRejectsPriceAndQuantityOutsidePoolGrid() public {
        _trigger(bytes32(uint256(21)));
        vm.expectRevert(CircuitEngine.InvalidOrder.selector);
        engine.executeReadyAction(strategyId, 744_500, 10_000_000);

        vm.expectRevert(CircuitEngine.InvalidOrder.selector);
        engine.executeReadyAction(strategyId, 745_000, 10_500_000);
    }

    function testRejectsDuplicateCallback() public {
        bytes32 callbackId = bytes32(uint256(3));
        _trigger(callbackId);
        vm.expectRevert(CircuitEngine.DuplicateCallback.selector);
        engine.handleMarketFill(strategyId, 1, MARKET_ID, address(pool), 750_000, callbackId);
    }

    function testNonMatchingFillKeepsStrategyArmedAndConsumesCallback() public {
        bytes32 callbackId = bytes32(uint256(30));
        engine.handleMarketFill(strategyId, 1, MARKET_ID, address(pool), 650_000, callbackId);

        (, CircuitEngine.StrategyRuntime memory runtime) = engine.getStrategy(strategyId);
        require(runtime.status == CircuitEngine.StrategyStatus.ARMED, "non-match changed state");
        require(engine.processedCallbacks(callbackId), "callback was not consumed");

        vm.expectRevert(CircuitEngine.DuplicateCallback.selector);
        engine.handleMarketFill(strategyId, 1, MARKET_ID, address(pool), 750_000, callbackId);
    }

    function testPauseResumeRestoresArmedState() public {
        engine.pauseStrategy(strategyId);
        (, CircuitEngine.StrategyRuntime memory paused) = engine.getStrategy(strategyId);
        require(paused.status == CircuitEngine.StrategyStatus.PAUSED, "not paused");
        require(paused.pausedFrom == CircuitEngine.StrategyStatus.ARMED, "lost prior state");

        engine.resumeStrategy(strategyId);
        (, CircuitEngine.StrategyRuntime memory resumed) = engine.getStrategy(strategyId);
        require(resumed.status == CircuitEngine.StrategyStatus.ARMED, "not resumed");
    }

    function testStopsAfterConfiguredConsecutiveLosses() public {
        _completeLoss(10);
        engine.bindMarket(
            strategyId, bytes32(uint256(124)), address(market), address(pool), address(collateral), address(outcome), 2
        );
        _completeLoss(20);
        (, CircuitEngine.StrategyRuntime memory runtime) = engine.getStrategy(strategyId);
        require(runtime.status == CircuitEngine.StrategyStatus.STOPPED, "loss policy did not stop");
        require(runtime.consecutiveLosses == 2, "wrong loss count");
    }

    function testRejectsExecutionWhenMarketLocks() public {
        _trigger(bytes32(uint256(4)));
        market.setStatus(2);
        vm.expectRevert(CircuitEngine.MarketNotTrading.selector);
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
    }

    function testRevertsWhenReportedFillExceedsBoundedSpend() public {
        pool.configure(3_000_000, 10_000_000, true);
        _trigger(bytes32(uint256(40)));
        vm.expectRevert(CircuitEngine.RiskLimitExceeded.selector);
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
    }

    function testExecutionRequiresDreamDexProtocolApproval() public {
        pool.setApprovedContract(address(engine), false);
        _trigger(bytes32(uint256(41)));
        vm.expectRevert(MockBinaryPool.OnlyApprovedContracts.selector);
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
    }

    function testStopsAtMaximumRoundCount() public {
        CircuitEngine.StrategyConfig memory oneRound = _config();
        oneRound.maxRounds = 1;
        bytes32 oneRoundId = engine.createStrategy(keccak256("one-round"), oneRound);
        engine.bindMarket(
            oneRoundId, bytes32(uint256(500)), address(market), address(pool), address(collateral), address(outcome), 2
        );
        engine.activateStrategy(oneRoundId);
        engine.handleMarketFill(oneRoundId, 1, bytes32(uint256(500)), address(pool), 750_000, bytes32(uint256(501)));
        engine.executeReadyAction(oneRoundId, 745_000, 10_000_000);
        engine.handleResolution(
            oneRoundId, bytes32(uint256(500)), CircuitEngine.RoundResult.WIN, 10_000_000, bytes32(uint256(502))
        );

        (, CircuitEngine.StrategyRuntime memory runtime) = engine.getStrategy(oneRoundId);
        require(runtime.status == CircuitEngine.StrategyStatus.STOPPED, "max rounds did not stop");
    }

    function testOnlyOwnerCanPause() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(CircuitEngine.OnlyStrategyOwner.selector);
        engine.pauseStrategy(strategyId);
    }

    function testVerifiedReactivityCallbackTriggersEngine() public {
        CircuitEngine integratedEngine = new CircuitEngine(address(this), address(this));
        CircuitReactivityHandler integratedHandler =
            new CircuitReactivityHandler(address(this), address(integratedEngine));
        integratedEngine.setReactivityHandler(address(integratedHandler));

        bytes32 integratedId = integratedEngine.createStrategy(keccak256("integrated"), _config());
        integratedEngine.bindMarket(
            integratedId, MARKET_ID, address(market), address(pool), address(collateral), address(outcome), 2
        );
        integratedEngine.activateStrategy(integratedId);
        integratedHandler.bindMarket(address(pool), integratedId, MARKET_ID, 1);

        bytes32[] memory topics = new bytes32[](3);
        topics[0] = integratedHandler.ORDER_FILLED_TOPIC();
        topics[1] = bytes32(uint256(10));
        topics[2] = bytes32(uint256(11));
        bytes memory data = abi.encode(uint256(1), uint256(0), uint256(0), uint256(750_000));
        vm.prank(address(0x0100));
        integratedHandler.onEvent(address(pool), topics, data);

        (, CircuitEngine.StrategyRuntime memory runtime) = integratedEngine.getStrategy(integratedId);
        require(runtime.status == CircuitEngine.StrategyStatus.TRIGGERED, "handler did not trigger engine");
        require(runtime.triggerFillPrice == 750_000, "fill evidence not stored");
    }

    function testRejectsMissingHardCapitalCap() public {
        CircuitEngine.StrategyConfig memory invalid = _config();
        invalid.maxTotalCapitalAtRisk = 0;
        vm.expectRevert(CircuitEngine.InvalidPolicy.selector);
        engine.createStrategy(keccak256("invalid"), invalid);
    }

    function testOnlyConfiguredHandlerCanTrigger() public {
        engine.setReactivityHandler(address(0xCAFE));
        vm.expectRevert(CircuitEngine.OnlyReactivityHandler.selector);
        engine.handleMarketFill(strategyId, 1, MARKET_ID, address(pool), 750_000, bytes32(uint256(5)));
    }

    function _completeLoss(uint256 seed) private {
        _trigger(bytes32(seed));
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
        engine.handleResolution(strategyId, engineRoundMarket(), CircuitEngine.RoundResult.LOSS, 0, bytes32(seed + 1));
    }

    function engineRoundMarket() private view returns (bytes32) {
        (, CircuitEngine.StrategyRuntime memory runtime) = engine.getStrategy(strategyId);
        return runtime.currentMarketId;
    }

    function _trigger(bytes32 callbackId) private {
        (, CircuitEngine.StrategyRuntime memory runtime) = engine.getStrategy(strategyId);
        engine.handleMarketFill(strategyId, runtime.round, runtime.currentMarketId, address(pool), 750_000, callbackId);
    }

    function _config() private pure returns (CircuitEngine.StrategyConfig memory) {
        return CircuitEngine.StrategyConfig({
            assetId: 0,
            intervalSec: 900,
            triggerType: CircuitEngine.TriggerType.LAST_FILL_PRICE_ABOVE,
            triggerValue: 700_000,
            actionType: CircuitEngine.ActionType.BUY_DOWN,
            maxOrderCollateral: 10_000_000,
            maxSlippageBps: 200,
            maxTotalCapitalAtRisk: 20_000_000,
            maxRounds: 5,
            stopAfterLosses: 2,
            minSecondsToExpiry: 120,
            rollPercentBps: 5_000
        });
    }
}
