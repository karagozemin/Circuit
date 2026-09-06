// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IBinaryModule} from "../src/interfaces/IBinaryLifecycle.sol";
import {CircuitEngine} from "../src/CircuitEngine.sol";
import {CircuitReactivityHandler} from "../src/CircuitReactivityHandler.sol";
import {CircuitSmartAccount} from "../src/CircuitSmartAccount.sol";
import {IBinaryMarket, IBinaryPool, IERC20Balance, IERC6909Balance} from "../src/interfaces/IDreamDexBinary.sol";

interface EngineVm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
}

contract MockCollateral is IERC20Balance {
    mapping(address => uint256) public balanceOf;

    mapping(address => mapping(address => uint256)) public allowance;
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }

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

    function approve(address, uint256, uint256) external pure returns (bool) { return true; }
    function debit(address owner, uint256 id, uint256 amount) external { balances[owner][id] -= amount; }

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

    function placeBinaryOrder(
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
        require(kind == 0 || kind == 2, "invalid kind");
        require(orderType == 2, "not IOC");
        if (!succeeds) return (false, 0);
        collateralToken.debit(msg.sender, collateralUsed);
        outcomeToken.credit(msg.sender, kind == 0 ? 1 : 2, positionReceived);
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

    uint256 public winner = 1;
    function isResolved() external view returns (bool) { return status == 4; }
    function isVoided() external view returns (bool) { return status == 5; }
    function setWinner(uint256 value) external { winner = value; }
    function payoutNumerators() external view returns (uint256[] memory values) {
        values = new uint256[](2);
        if (status == 5) { values[0] = 5_000_000; values[1] = 5_000_000; }
        else values[winner] = 10_000_000;
    }
    function setExpiry(uint64 value) external { expiry = value; }
    function setStatus(uint8 status_) external {
        status = status_;
    }
}

contract MockBinaryModule is IBinaryModule {
    MockBinaryMarket public market;
    MockCollateral public collateral;
    MockOutcome public outcome;
    constructor(MockBinaryMarket m, MockCollateral c, MockOutcome o) { market = m; collateral = c; outcome = o; }
    function markets(bytes32) external view returns (MarketRecord memory record) {
        record.market = address(market); record.pool = market.pool(); record.collateral = address(collateral);
        record.creator = address(this); record.outcomeSlotCount = 2; record.yesId = 1; record.noId = 2;
        record.expiry = market.expiry(); record.tradingStart = record.expiry - 900;
    }
    function useMarket(MockBinaryMarket m) external { market = m; }
    function redeem(uint32, bytes32, bytes32, uint8 side, uint256 amount) external {
        require(market.status() == 4 || market.status() == 5, "unsettled");
        outcome.debit(msg.sender, side + 1, amount);
        uint256 proceeds = market.status() == 5 ? amount / 2 : market.winner() == side ? amount : 0;
        collateral.setBalance(msg.sender, collateral.balanceOf(msg.sender) + proceeds);
    }
}

contract CircuitEngineTest {
    EngineVm private constant vm = EngineVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant MANIFEST_HASH = keccak256("manifest-v1");
    bytes32 private constant MARKET_ID = bytes32(uint256(123));

    MockBinaryModule private module;
    CircuitEngine private engine;
    CircuitReactivityHandler private handler;
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
        module = new MockBinaryModule(market, collateral, outcome);
        engine = new CircuitEngine(address(this), address(this), address(module));
        handler = new CircuitReactivityHandler(address(this), address(engine));
        engine.setReactivityHandler(address(handler));
        pool.setApprovedContract(address(engine), true);
        collateral.setBalance(address(this), 100_000_000);
        strategyId = engine.createStrategy(MANIFEST_HASH, _config());
        engine.bindMarket(
            strategyId, MARKET_ID, address(market), address(pool), address(collateral), address(outcome), 2
        );
        CircuitSmartAccount account = new CircuitSmartAccount(address(this), address(engine));
        collateral.setBalance(address(account), 100_000_000);
        engine.setExecutionAccount(strategyId, address(account));
        engine.activateStrategy(strategyId);
    }

    function _clearBindings() private {
        handler.unbindMarket(address(pool));
        handler.unbindMarket(address(market));
    }

    function testCombinedSetupPreservesOwnerRulesAndRequiresExplicitActivation() public {
        _clearBindings();
        CircuitSmartAccount account = new CircuitSmartAccount(address(this), address(engine));
        bytes32 id = engine.createConfiguredStrategy(MANIFEST_HASH, _config(), address(account), MARKET_ID, true);
        (CircuitEngine.StrategyConfig memory config, CircuitEngine.StrategyRuntime memory runtime) = engine.getStrategy(id);
        require(engine.activationSetupVersion() == 1, "missing feature detection");
        require(runtime.owner == address(this) && runtime.manifestHash == MANIFEST_HASH, "wrong owner or manifest");
        require(runtime.executionAccount == address(account), "wrong account");
        require(runtime.currentMarketId == MARKET_ID && runtime.currentPool == address(pool), "wrong market");
        require(runtime.outcomeTokenId == 2 && config.maxTotalCapitalAtRisk == _config().maxTotalCapitalAtRisk, "wrong rules");
        require(engine.automaticRollover(id), "rollover not authorized");
        require(runtime.status == CircuitEngine.StrategyStatus.VALIDATED, "armed before subscriptions");
        (bytes32 boundId,,, bool active) = handler.bindings(address(market));
        require(active && boundId == id, "missing resolution binding");
        engine.activateStrategy(id);
        (, runtime) = engine.getStrategy(id);
        require(runtime.status == CircuitEngine.StrategyStatus.ARMED, "not armed");
    }

    function testCombinedSetupSupportsUpAndNoRollover() public {
        _clearBindings();
        CircuitSmartAccount account = new CircuitSmartAccount(address(this), address(engine));
        CircuitEngine.StrategyConfig memory config = _config();
        config.actionType = CircuitEngine.ActionType.BUY_UP;
        bytes32 id = engine.createConfiguredStrategy(MANIFEST_HASH, config, address(account), MARKET_ID, false);
        (, CircuitEngine.StrategyRuntime memory runtime) = engine.getStrategy(id);
        require(runtime.outcomeTokenId == 1, "wrong up outcome");
        require(!engine.automaticRollover(id), "unexpected rollover consent");
    }

    function testCombinedSetupRejectsWrongAccountOwnerOrExecutorWithoutCreatingStrategy() public {
        uint256 nonce = engine.ownerNonces(address(this));
        CircuitSmartAccount wrongOwner = new CircuitSmartAccount(address(0xBEEF), address(engine));
        CircuitSmartAccount wrongExecutor = new CircuitSmartAccount(address(this), address(0xBEEF));
        vm.expectRevert(CircuitEngine.InvalidExecutionAccount.selector);
        engine.createConfiguredStrategy(MANIFEST_HASH, _config(), address(wrongOwner), MARKET_ID, true);
        vm.expectRevert(CircuitEngine.InvalidExecutionAccount.selector);
        engine.createConfiguredStrategy(MANIFEST_HASH, _config(), address(wrongExecutor), MARKET_ID, true);
        vm.expectRevert(CircuitEngine.InvalidExecutionAccount.selector);
        engine.createConfiguredStrategy(MANIFEST_HASH, _config(), address(0), MARKET_ID, true);
        require(engine.ownerNonces(address(this)) == nonce, "partial strategy created");
    }

    function testCombinedSetupRollsBackWhenMarketClosed() public {
        _clearBindings();
        market.setStatus(2);
        CircuitSmartAccount account = new CircuitSmartAccount(address(this), address(engine));
        uint256 nonce = engine.ownerNonces(address(this));
        vm.expectRevert(CircuitEngine.MarketNotTrading.selector);
        engine.createConfiguredStrategy(MANIFEST_HASH, _config(), address(account), MARKET_ID, true);
        require(engine.ownerNonces(address(this)) == nonce, "partial strategy created");
        (,,, bool active) = handler.bindings(address(pool));
        require(!active, "partial pool binding");
    }

    function testCombinedSetupRollsBackPoolBindingWhenResolutionEmitterOccupied() public {
        handler.unbindMarket(address(pool));
        CircuitSmartAccount account = new CircuitSmartAccount(address(this), address(engine));
        uint256 nonce = engine.ownerNonces(address(this));
        vm.expectRevert(CircuitReactivityHandler.EmitterAlreadyBound.selector);
        engine.createConfiguredStrategy(MANIFEST_HASH, _config(), address(account), MARKET_ID, true);
        require(engine.ownerNonces(address(this)) == nonce, "partial strategy created");
        (,,, bool active) = handler.bindings(address(pool));
        require(!active, "partial pool binding");
        (bytes32 boundId,,,) = handler.bindings(address(market));
        require(boundId == strategyId, "existing binding overwritten");
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

    function testSmartAccountExecutesDirectBinaryOrder() public {
        CircuitSmartAccount account = new CircuitSmartAccount(address(this), address(engine));
        engine.setExecutionAccount(strategyId, address(account));
        collateral.setBalance(address(account), 100_000_000);

        _trigger(bytes32(uint256(101)));
        (uint128 orderId, uint256 used, uint256 received) = engine.executeReadyAction(strategyId, 745_000, 10_000_000);

        require(orderId == 41, "wrong smart-account order id");
        require(used == 2_500_000, "wrong smart-account collateral accounting");
        require(received == 10_000_000, "wrong smart-account position accounting");
        require(collateral.balanceOf(address(account)) == 97_500_000, "account collateral not debited");
        require(outcome.balanceOf(address(account), 2) == 10_000_000, "account position not credited");
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
        vm.prank(address(handler));
        engine.handleMarketFill(strategyId, 1, MARKET_ID, address(pool), 750_000, callbackId);
    }

    function testNonMatchingFillKeepsStrategyArmedAndConsumesCallback() public {
        bytes32 callbackId = bytes32(uint256(30));
        vm.prank(address(handler));
        engine.handleMarketFill(strategyId, 1, MARKET_ID, address(pool), 650_000, callbackId);

        (, CircuitEngine.StrategyRuntime memory runtime) = engine.getStrategy(strategyId);
        require(runtime.status == CircuitEngine.StrategyStatus.ARMED, "non-match changed state");
        require(engine.processedCallbacks(callbackId), "callback was not consumed");

        vm.expectRevert(CircuitEngine.DuplicateCallback.selector);
        vm.prank(address(handler));
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
        MockBinaryMarket next = new MockBinaryMarket(address(pool), address(collateral), address(outcome), uint64(block.timestamp + 1800));
        module.useMarket(next);
        engine.bindMarket(strategyId, bytes32(uint256(124)), address(next), address(pool), address(collateral), address(outcome), 2);
        market = next;
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
        engine.setExecutionAccount(strategyId, address(0));
        pool.setApprovedContract(address(engine), false);
        _trigger(bytes32(uint256(41)));
        vm.expectRevert(MockBinaryPool.OnlyApprovedContracts.selector);
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
    }

    function testStopsAtMaximumRoundCount() public {
        handler.unbindMarket(address(pool));
        handler.unbindMarket(address(market));
        CircuitEngine.StrategyConfig memory oneRound = _config();
        oneRound.maxRounds = 1;
        bytes32 oneRoundId = engine.createStrategy(keccak256("one-round"), oneRound);
        engine.bindMarket(
            oneRoundId, bytes32(uint256(500)), address(market), address(pool), address(collateral), address(outcome), 2
        );
        CircuitSmartAccount account = new CircuitSmartAccount(address(this), address(engine));
        collateral.setBalance(address(account), 100_000_000);
        engine.setExecutionAccount(oneRoundId, address(account));
        engine.activateStrategy(oneRoundId);
        vm.prank(address(handler));
        engine.handleMarketFill(oneRoundId, 1, bytes32(uint256(500)), address(pool), 750_000, bytes32(uint256(501)));
        engine.executeReadyAction(oneRoundId, 745_000, 10_000_000);
        market.setStatus(4);
        vm.prank(address(handler));
        engine.handleResolution(oneRoundId, bytes32(uint256(500)), bytes32(uint256(502)));

        (, CircuitEngine.StrategyRuntime memory runtime) = engine.getStrategy(oneRoundId);
        require(runtime.status == CircuitEngine.StrategyStatus.STOPPED, "max rounds did not stop");
    }

    function testOnlyOwnerCanPause() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(CircuitEngine.OnlyStrategyOwner.selector);
        engine.pauseStrategy(strategyId);
    }

    function testVerifiedReactivityCallbackTriggersEngine() public {
        CircuitEngine integratedEngine = new CircuitEngine(address(this), address(this), address(module));
        CircuitReactivityHandler integratedHandler =
            new CircuitReactivityHandler(address(this), address(integratedEngine));
        integratedEngine.setReactivityHandler(address(integratedHandler));

        bytes32 integratedId = integratedEngine.createStrategy(keccak256("integrated"), _config());
        integratedEngine.bindMarket(
            integratedId, MARKET_ID, address(market), address(pool), address(collateral), address(outcome), 2
        );
        integratedEngine.activateStrategy(integratedId);

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

    function testPermissionlessSyncRedeemsActualWinAndIsIdempotent() public {
        _trigger(bytes32(uint256(701)));
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
        (, CircuitEngine.StrategyRuntime memory beforeState) = engine.getStrategy(strategyId);
        uint256 beforeBalance = collateral.balanceOf(beforeState.executionAccount);
        market.setStatus(4);
        vm.prank(address(0xCAFE));
        require(engine.syncStrategy(strategyId, MARKET_ID), "sync failed");
        (, CircuitEngine.StrategyRuntime memory afterState) = engine.getStrategy(strategyId);
        require(collateral.balanceOf(beforeState.executionAccount) - beforeBalance == 10_000_000, "proceeds not owned by account");
        require(afterState.nextOrderBudget == 5_000_000, "rollover not realized proceeds");
        require(afterState.status == CircuitEngine.StrategyStatus.ROLLING, "not rolling");
        require(!engine.syncStrategy(strategyId, MARKET_ID), "duplicate sync changed state");
        require(outcome.balanceOf(beforeState.executionAccount, 2) == 0, "position not burned");
    }

    function testResolutionCallbackRedeemsAndReturnsToArmedSuccessor() public {
        bytes32[] memory fillTopics = new bytes32[](3);
        fillTopics[0] = handler.ORDER_FILLED_TOPIC();
        fillTopics[1] = bytes32(uint256(702)); fillTopics[2] = bytes32(uint256(703));
        vm.prank(address(0x0100));
        handler.onEvent(address(pool), fillTopics, abi.encode(uint256(1),uint256(0),uint256(0),uint256(750_000)));
        vm.prank(address(0xCAFE)); // The keeper holds no owner permission.
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
        market.setStatus(4);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = handler.STATUS_CHANGED_TOPIC(); topics[1] = bytes32(uint256(3)); topics[2] = bytes32(uint256(4));
        vm.prank(address(0x0100));
        handler.onEvent(address(market), topics, "");
        vm.prank(address(0x0100));
        handler.onEvent(address(market), topics, "");
        MockBinaryMarket next = new MockBinaryMarket(address(pool), address(collateral), address(outcome), uint64(block.timestamp + 1800));
        module.useMarket(next);
        engine.bindMarket(strategyId, bytes32(uint256(999)), address(next), address(pool), address(collateral), address(outcome), 2);
        (, CircuitEngine.StrategyRuntime memory state) = engine.getStrategy(strategyId);
        require(state.round == 2 && state.status == CircuitEngine.StrategyStatus.ARMED, "successor not armed");
        (,,,bool oldActive) = handler.bindings(address(market));
        require(!oldActive, "stale resolution binding");
    }

    function testVoidRedeemsHalfAndPreservesLossCounter() public {
        _completeLoss(710);
        MockBinaryMarket next = new MockBinaryMarket(address(pool), address(collateral), address(outcome), uint64(block.timestamp + 1800));
        module.useMarket(next);
        engine.bindMarket(strategyId, bytes32(uint256(888)), address(next), address(pool), address(collateral), address(outcome), 2);
        market = next;
        _trigger(bytes32(uint256(713)));
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
        market.setStatus(5);
        engine.syncStrategy(strategyId, bytes32(uint256(888)));
        (, CircuitEngine.StrategyRuntime memory state) = engine.getStrategy(strategyId);
        require(state.consecutiveLosses == 1, "void changed losses");
        require(state.nextOrderBudget == 10_000_000, "void budget wrong");
        require(collateral.balanceOf(state.executionAccount) == 100_000_000, "void refund missing");
    }

    function testUnsettledAndPausedCannotRedeemOrRoll() public {
        _trigger(bytes32(uint256(720)));
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
        require(!engine.syncStrategy(strategyId, MARKET_ID), "unsettled advanced");
        engine.pauseStrategy(strategyId);
        market.setStatus(4);
        require(!engine.syncStrategy(strategyId, MARKET_ID), "paused advanced");
        engine.resumeStrategy(strategyId);
        require(engine.syncStrategy(strategyId, MARKET_ID), "resume lost settlement");
    }

    function testNoFillAndExpiredUntriggeredWindowDoNotCountAsLoss() public {
        pool.configure(0, 0, false);
        _trigger(bytes32(uint256(730)));
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
        market.setWinner(0); market.setStatus(4);
        engine.syncStrategy(strategyId, MARKET_ID);
        (, CircuitEngine.StrategyRuntime memory state) = engine.getStrategy(strategyId);
        require(state.consecutiveLosses == 0 && state.cumulativeCapitalUsed == 0, "no-fill counted as loss");
        MockBinaryMarket next = new MockBinaryMarket(address(pool), address(collateral), address(outcome), uint64(block.timestamp + 1800));
        module.useMarket(next);
        engine.bindMarket(strategyId, bytes32(uint256(777)), address(next), address(pool), address(collateral), address(outcome), 2);
        vm.warp(block.timestamp + 1801);
        require(engine.syncStrategy(strategyId, bytes32(uint256(777))), "expired window stuck");
    }

    function testPartialFillRedeemsOnlyReceivedPosition() public {
        pool.configure(500_000, 2_000_000, true);
        _trigger(bytes32(uint256(739)));
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
        market.setStatus(4);
        engine.syncStrategy(strategyId, MARKET_ID);
        (, CircuitEngine.StrategyRuntime memory state) = engine.getStrategy(strategyId);
        require(state.cumulativeCapitalUsed == 500_000, "partial spend overstated");
        require(state.nextOrderBudget == 1_000_000, "partial proceeds overstated");
    }

    function testCannotSwapAccountWithOpenPosition() public {
        _trigger(bytes32(uint256(740)));
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
        vm.expectRevert(CircuitEngine.InvalidState.selector);
        engine.setExecutionAccount(strategyId, address(0));
    }

    function testRejectsUnregisteredMarketAndSameWindowSuccessor() public {
        _completeLoss(750);
        vm.expectRevert(CircuitEngine.InvalidMarketBinding.selector);
        engine.bindMarket(strategyId, MARKET_ID, address(market), address(pool), address(collateral), address(outcome), 2);
        vm.expectRevert(CircuitEngine.InvalidMarketBinding.selector);
        engine.bindMarket(strategyId, bytes32(uint256(999)), address(0xCAFE), address(pool), address(collateral), address(outcome), 2);
    }

    function testPermissionlessAutomaticRolloverUsesVerifiedCreatorAndExactApproval() public {
        engine.setAutomaticRollover(strategyId, true);
        _completeLoss(800);
        (MockBinaryMarket next, MockBinaryPool nextPool, bytes32 nextId) = _registerNext("BTC", 801);
        vm.prank(address(0xCAFE));
        engine.rollToNextMarket(strategyId, nextId);
        (, CircuitEngine.StrategyRuntime memory state) = engine.getStrategy(strategyId);
        require(state.status == CircuitEngine.StrategyStatus.ARMED && state.round == 2, "not automatically armed");
        require(state.currentMarket == address(next), "wrong successor");
        require(collateral.allowance(state.executionAccount, address(nextPool)) == state.nextOrderBudget, "approval exceeded round budget");
        require(collateral.allowance(state.executionAccount, address(pool)) == 0, "old pool allowance retained");
        CircuitSmartAccount(payable(state.executionAccount)).execute(address(collateral), 0,
            abi.encodeWithSignature("approve(address,uint256)", address(nextPool), 0));
        vm.expectRevert(CircuitEngine.InvalidState.selector);
        engine.rollToNextMarket(strategyId, nextId);
        require(collateral.allowance(state.executionAccount, address(nextPool)) == 0, "revoked allowance restored");
    }

    function testAutomaticRolloverNeedsExplicitConsentAndRespectsRevocationAndPause() public {
        _completeLoss(810);
        (,,bytes32 nextId) = _registerNext("BTC", 811);
        vm.expectRevert(CircuitEngine.InvalidState.selector);
        engine.rollToNextMarket(strategyId, nextId);
        engine.setAutomaticRollover(strategyId, true);
        engine.setAutomaticRollover(strategyId, false);
        vm.expectRevert(CircuitEngine.InvalidState.selector);
        engine.rollToNextMarket(strategyId, nextId);
        engine.setAutomaticRollover(strategyId, true);
        engine.pauseStrategy(strategyId);
        vm.expectRevert(CircuitEngine.InvalidState.selector);
        engine.rollToNextMarket(strategyId, nextId);
        engine.resumeStrategy(strategyId);
        engine.rollToNextMarket(strategyId, nextId);
    }

    function testAutomaticRolloverRejectsUnverifiedMarketAndWrongAsset() public {
        engine.setAutomaticRollover(strategyId, true);
        _completeLoss(820);
        vm.expectRevert(CircuitEngine.InvalidMarketBinding.selector);
        engine.rollToNextMarket(strategyId, bytes32(uint256(821)));
        (,,bytes32 nextId) = _registerNext("ETH", 821);
        vm.expectRevert(CircuitEngine.InvalidMarketBinding.selector);
        engine.rollToNextMarket(strategyId, nextId);
    }

    function testCreatorCallbackCannotBeSpoofed() public {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = handler.MARKET_CREATED_TOPIC(); topics[1] = bytes32(uint256(830));
        topics[2] = bytes32(uint256(uint160(address(market)))); topics[3] = bytes32(uint256(uint160(address(pool))));
        bytes memory data = abi.encode(uint256(1),uint256(2),address(collateral),"BTC",uint256(0),
            uint64(market.expiry()-900),market.expiry(),uint256(0),"BTC test",uint64(900));
        vm.expectRevert(bytes4(keccak256("OnlyReactivityPrecompile()")));
        handler.onEvent(address(module), topics, data);
        vm.prank(address(0x0100));
        vm.expectRevert(CircuitReactivityHandler.UnboundEmitter.selector);
        handler.onEvent(address(0xBAD), topics, data);
    }

    function _registerNext(string memory asset, uint256 seed) private returns (MockBinaryMarket next, MockBinaryPool nextPool, bytes32 nextId) {
        nextPool = new MockBinaryPool(collateral, outcome);
        next = new MockBinaryMarket(address(nextPool), address(collateral), address(outcome), uint64(block.timestamp + 1800));
        module.useMarket(next);
        nextId = bytes32(seed);
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = handler.MARKET_CREATED_TOPIC(); topics[1] = nextId;
        topics[2] = bytes32(uint256(uint160(address(next)))); topics[3] = bytes32(uint256(uint160(address(nextPool))));
        bytes memory data = abi.encode(uint256(1),uint256(2),address(collateral),asset,uint256(0),
            uint64(next.expiry()-900),next.expiry(),uint256(0),"test window",uint64(900));
        vm.prank(address(0x0100)); handler.onEvent(address(module), topics, data);
    }

    function _completeLoss(uint256 seed) private {
        _trigger(bytes32(seed));
        engine.executeReadyAction(strategyId, 745_000, 10_000_000);
        bytes32 marketId = engineRoundMarket();
        market.setWinner(0);
        market.setStatus(4);
        vm.prank(address(handler));
        engine.handleResolution(strategyId, marketId, bytes32(seed + 1));
    }

    function engineRoundMarket() private view returns (bytes32) {
        (, CircuitEngine.StrategyRuntime memory runtime) = engine.getStrategy(strategyId);
        return runtime.currentMarketId;
    }

    function _trigger(bytes32 callbackId) private {
        (, CircuitEngine.StrategyRuntime memory runtime) = engine.getStrategy(strategyId);
        vm.prank(address(handler));
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
