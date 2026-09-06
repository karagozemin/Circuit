// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IBinaryLifecycle, IBinaryModule} from "./interfaces/IBinaryLifecycle.sol";
import {ICircuitEngine} from "./interfaces/ICircuitEngine.sol";
import {ICircuitReactivityBinder} from "./interfaces/ICircuitReactivityBinder.sol";
import {ICircuitSmartAccount} from "./interfaces/ICircuitSmartAccount.sol";
import {IBinaryMarket, IBinaryPool, IERC20Balance, IERC6909Balance} from "./interfaces/IDreamDexBinary.sol";

contract CircuitEngine is ICircuitEngine {
    error OnlyAdmin();
    error OnlyStrategyOwner();
    error OnlyReactivityHandler();
    error InvalidAddress();
    error InvalidManifest();
    error InvalidPolicy();
    error InvalidState();
    error InvalidMarketBinding();
    error MarketNotTrading();
    error ExpiryBufferViolated();
    error InvalidOrder();
    error SlippageExceeded();
    error RiskLimitExceeded();
    error DuplicateAction();
    error DuplicateCallback();
    error ExternalBalanceIncreased();
    error ReentrantCall();
    error InvalidExecutionAccount();

    uint256 public constant PRICE_SCALE = 1_000_000;
    uint16 public constant MAX_SLIPPAGE_BPS = 1_000;
    uint16 public constant BPS = 10_000;
    uint8 public constant MARKET_STATUS_TRADING = 1;
    uint8 public constant ORDER_KIND_BUY_YES = 0;
    uint8 public constant ORDER_KIND_BUY_NO = 2;
    uint8 public constant ORDER_TYPE_IOC = 2;

    enum StrategyStatus {
        NONE,
        VALIDATED,
        ARMED,
        TRIGGERED,
        ORDER_SUBMITTED,
        WAITING_RESOLUTION,
        ROLLING,
        PAUSED,
        STOPPED,
        CANCELLED
    }

    enum TriggerType {
        LAST_FILL_PRICE_ABOVE,
        LAST_FILL_PRICE_BELOW
    }

    enum ActionType {
        BUY_UP,
        BUY_DOWN
    }

    enum RoundResult {
        WIN,
        LOSS,
        VOID,
        SKIPPED
    }

    enum StopReason {
        NONE,
        MAX_ROUNDS,
        CONSECUTIVE_LOSSES,
        CAPITAL_CAP,
        ZERO_ROLLOVER
    }

    struct StrategyConfig {
        uint8 assetId;
        uint32 intervalSec;
        TriggerType triggerType;
        uint256 triggerValue;
        ActionType actionType;
        uint256 maxOrderCollateral;
        uint16 maxSlippageBps;
        uint256 maxTotalCapitalAtRisk;
        uint16 maxRounds;
        uint16 stopAfterLosses;
        uint32 minSecondsToExpiry;
        uint16 rollPercentBps;
    }

    struct StrategyRuntime {
        address owner;
        bytes32 manifestHash;
        StrategyStatus status;
        StrategyStatus pausedFrom;
        bytes32 currentMarketId;
        address currentMarket;
        address currentPool;
        address collateral;
        address outcomeToken;
        uint256 outcomeTokenId;
        uint16 round;
        uint16 consecutiveLosses;
        uint256 cumulativeCapitalUsed;
        uint256 currentPositionSize;
        uint256 nextOrderBudget;
        uint256 triggerFillPrice;
        address executionAccount;
    }

    struct ExecutionPlan {
        bytes32 actionKey;
        uint256 maxSpend;
        uint256 budget;
    }

    struct BinaryOrderCall {
        address pool;
        address owner;
        uint8 kind;
        uint256 yesLimitPrice;
        uint256 quantity;
        uint64 expireTimestampNs;
        uint64 userData;
    }

    address public immutable admin;
    IBinaryModule public immutable binaryModule;
    address public reactivityHandler;
    uint256 private entered;
    mapping(bytes32 => address) public seriesCreators;
    mapping(bytes32 => bool) public automaticRollover;
    event AutomaticRolloverUpdated(bytes32 indexed strategyId, bool enabled);
    mapping(address owner => uint256 nonce) public ownerNonces;
    mapping(bytes32 strategyId => StrategyConfig) private configs;
    mapping(bytes32 strategyId => StrategyRuntime) private runtimes;
    mapping(bytes32 callbackId => bool processed) public processedCallbacks;
    mapping(bytes32 actionKey => bool processed) public processedActions;

    event ReactivityHandlerUpdated(address indexed previousHandler, address indexed newHandler);
    event StrategyCreated(bytes32 indexed strategyId, address indexed owner, bytes32 indexed manifestHash);
    event StrategyActivated(bytes32 indexed strategyId, bytes32 indexed marketId, address indexed pool);
    event StrategyPaused(bytes32 indexed strategyId, StrategyStatus previousStatus);
    event StrategyResumed(bytes32 indexed strategyId, StrategyStatus restoredStatus);
    event StrategyStopped(bytes32 indexed strategyId, StopReason reason);
    event StrategyCancelled(bytes32 indexed strategyId);
    event MarketBound(bytes32 indexed strategyId, bytes32 indexed marketId, address indexed pool, uint16 round);
    event TriggerMatched(bytes32 indexed strategyId, bytes32 indexed marketId, uint16 round, uint256 fillPrice);
    event OrderRequested(
        bytes32 indexed strategyId, bytes32 indexed actionKey, uint256 yesPrice, uint256 quantity, uint256 maxSpend
    );
    event OrderExecuted(
        bytes32 indexed strategyId,
        bytes32 indexed actionKey,
        uint128 orderId,
        uint256 collateralUsed,
        uint256 positionReceived
    );
    event OrderSkipped(bytes32 indexed strategyId, bytes32 indexed actionKey);
    event RoundResolved(
        bytes32 indexed strategyId, bytes32 indexed marketId, uint16 round, RoundResult result, uint256 realizedProceeds
    );
    event RolloverComputed(bytes32 indexed strategyId, uint256 nextOrderBudget);
    event RiskLimitReached(bytes32 indexed strategyId, StopReason reason);
    event ReactivityCallbackProcessed(bytes32 indexed strategyId, bytes32 indexed callbackId);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    modifier onlyOwner(bytes32 strategyId) {
        if (runtimes[strategyId].owner != msg.sender) revert OnlyStrategyOwner();
        _;
    }

    modifier onlyHandler() {
        if (msg.sender != reactivityHandler) revert OnlyReactivityHandler();
        _;
    }

    modifier nonReentrant() {
        if (entered != 0) revert ReentrantCall();
        entered = 1;
        _;
        entered = 0;
    }

    constructor(address initialAdmin, address initialReactivityHandler, address module) {
        if (initialAdmin == address(0) || initialReactivityHandler == address(0) || module == address(0)) revert InvalidAddress();
        admin = initialAdmin;
        binaryModule = IBinaryModule(module);
        reactivityHandler = initialReactivityHandler;
    }

    function setReactivityHandler(address newHandler) external onlyAdmin {
        if (newHandler == address(0)) revert InvalidAddress();
        address previous = reactivityHandler;
        reactivityHandler = newHandler;
        emit ReactivityHandlerUpdated(previous, newHandler);
    }

    function createStrategy(bytes32 manifestHash, StrategyConfig calldata config)
        external
        returns (bytes32 strategyId)
    {
        _validateConfig(manifestHash, config);
        uint256 nonce = ++ownerNonces[msg.sender];
        strategyId = keccak256(abi.encode(msg.sender, nonce, manifestHash));
        configs[strategyId] = config;
        runtimes[strategyId] = StrategyRuntime({
            owner: msg.sender,
            manifestHash: manifestHash,
            status: StrategyStatus.VALIDATED,
            pausedFrom: StrategyStatus.NONE,
            currentMarketId: bytes32(0),
            currentMarket: address(0),
            currentPool: address(0),
            collateral: address(0),
            outcomeToken: address(0),
            outcomeTokenId: 0,
            round: 1,
            consecutiveLosses: 0,
            cumulativeCapitalUsed: 0,
            currentPositionSize: 0,
            nextOrderBudget: config.maxOrderCollateral,
            triggerFillPrice: 0,
            executionAccount: address(0)
        });
        emit StrategyCreated(strategyId, msg.sender, manifestHash);
    }

    function bindMarket(
        bytes32 strategyId,
        bytes32 marketId,
        address market,
        address pool,
        address collateral,
        address outcomeToken,
        uint256 outcomeTokenId
    ) external onlyOwner(strategyId) {
        _bindMarket(strategyId, marketId, market, pool, collateral, outcomeToken, outcomeTokenId);
    }

    /// @notice Explicit owner consent for bounded approvals to verified successor pools.
    function setAutomaticRollover(bytes32 strategyId, bool enabled) external onlyOwner(strategyId) {
        if (enabled && runtimes[strategyId].executionAccount == address(0)) revert InvalidExecutionAccount();
        automaticRollover[strategyId] = enabled;
        emit AutomaticRolloverUpdated(strategyId, enabled);
    }

    /// @notice Any keeper can progress a series authenticated by a real creator callback.
    function rollToNextMarket(bytes32 strategyId, bytes32 marketId) external nonReentrant {
        StrategyRuntime storage runtime = runtimes[strategyId];
        StrategyConfig storage config = configs[strategyId];
        if (!automaticRollover[strategyId] || runtime.status != StrategyStatus.ROLLING) revert InvalidState();
        (address creator, uint8 assetId, uint32 intervalSec, bool verified) =
            ICircuitReactivityBinder(reactivityHandler).marketMetadata(marketId);
        if (!verified || creator != seriesCreators[strategyId] || assetId != config.assetId || intervalSec != config.intervalSec) {
            revert InvalidMarketBinding();
        }
        IBinaryModule.MarketRecord memory record = binaryModule.markets(marketId);
        if (record.creator != creator) revert InvalidMarketBinding();
        address previousPool = runtime.currentPool;
        address outcome = IBinaryMarket(record.market).outcomeToken();
        _bindMarket(strategyId, marketId, record.market, record.pool, record.collateral, outcome,
            config.actionType == ActionType.BUY_UP ? record.yesId : record.noId);
        // Exact, per-round grants. Revocation/paused state prevents this entrypoint from running.
        ICircuitSmartAccount(runtime.executionAccount).execute(runtime.collateral, 0,
            abi.encodeWithSignature("approve(address,uint256)", previousPool, 0));
        ICircuitSmartAccount(runtime.executionAccount).execute(runtime.collateral, 0,
            abi.encodeWithSignature("approve(address,uint256)", runtime.currentPool, runtime.nextOrderBudget));
    }

    function _bindMarket(bytes32 strategyId, bytes32 marketId, address market, address pool, address collateral,
        address outcomeToken, uint256 outcomeTokenId) private {
        StrategyRuntime storage runtime = runtimes[strategyId];
        if (runtime.status != StrategyStatus.VALIDATED && runtime.status != StrategyStatus.ROLLING) {
            revert InvalidState();
        }
        if (
            marketId == bytes32(0) || market == address(0) || pool == address(0) || collateral == address(0)
                || outcomeToken == address(0)
        ) revert InvalidMarketBinding();
        IBinaryModule.MarketRecord memory record = binaryModule.markets(marketId);
        if (record.market != market || record.pool != pool || record.collateral != collateral
            || record.outcomeSlotCount != 2 || record.expiry < record.tradingStart
            || record.expiry - record.tradingStart != configs[strategyId].intervalSec) revert InvalidMarketBinding();
        if (runtime.status == StrategyStatus.ROLLING) {
            if (collateral != runtime.collateral || outcomeToken != runtime.outcomeToken
                || record.creator != seriesCreators[strategyId]
                || marketId == runtime.currentMarketId || record.tradingStart < IBinaryMarket(runtime.currentMarket).expiry()
                || record.expiry <= IBinaryMarket(runtime.currentMarket).expiry()
                || record.expiry - record.tradingStart != configs[strategyId].intervalSec) revert InvalidMarketBinding();
            ICircuitReactivityBinder(reactivityHandler).unbindMarket(runtime.currentPool);
            ICircuitReactivityBinder(reactivityHandler).unbindMarket(runtime.currentMarket);
        }
        IBinaryMarket binaryMarket = IBinaryMarket(market);
        if (
            binaryMarket.pool() != pool || binaryMarket.collateral() != collateral
                || binaryMarket.outcomeToken() != outcomeToken
        ) revert InvalidMarketBinding();
        uint256 expectedOutcomeId =
            configs[strategyId].actionType == ActionType.BUY_UP ? binaryMarket.yesId() : binaryMarket.noId();
        if (expectedOutcomeId != outcomeTokenId) revert InvalidMarketBinding();
        _requireTradingWindow(strategyId, market);

        if (runtime.status == StrategyStatus.ROLLING) {
            runtime.round++;
            runtime.status = StrategyStatus.ARMED;
        }
        if (runtime.status == StrategyStatus.VALIDATED) seriesCreators[strategyId] = record.creator;
        runtime.currentMarketId = marketId;
        runtime.currentMarket = market;
        runtime.currentPool = pool;
        runtime.collateral = collateral;
        runtime.outcomeToken = outcomeToken;
        runtime.outcomeTokenId = outcomeTokenId;
        runtime.triggerFillPrice = 0;
        runtime.currentPositionSize = 0;
        ICircuitReactivityBinder(reactivityHandler).bindMarket(pool, strategyId, marketId, runtime.round);
        ICircuitReactivityBinder(reactivityHandler).bindResolutionMarket(market, strategyId, marketId, runtime.round);
        emit MarketBound(strategyId, marketId, pool, runtime.round);
    }

    function activateStrategy(bytes32 strategyId) external onlyOwner(strategyId) {
        StrategyRuntime storage runtime = runtimes[strategyId];
        if (runtime.status != StrategyStatus.VALIDATED || runtime.currentMarket == address(0)) revert InvalidState();
        _requireTradingWindow(strategyId, runtime.currentMarket);
        runtime.status = StrategyStatus.ARMED;
        emit StrategyActivated(strategyId, runtime.currentMarketId, runtime.currentPool);
    }

    /// @notice Attach a user-owned smart account for direct BinaryPool calls.
    /// Passing zero restores the legacy delegated `placeBinaryOrderFor` path.
    function setExecutionAccount(bytes32 strategyId, address account) external onlyOwner(strategyId) {
        if (runtimes[strategyId].currentPositionSize != 0) revert InvalidState();
        if (account != address(0)) {
            try ICircuitSmartAccount(account).owner() returns (address accountOwner) {
                if (accountOwner != runtimes[strategyId].owner) revert InvalidExecutionAccount();
            } catch {
                revert InvalidExecutionAccount();
            }
            try ICircuitSmartAccount(account).executor() returns (address accountExecutor) {
                if (accountExecutor != address(this)) revert InvalidExecutionAccount();
            } catch {
                revert InvalidExecutionAccount();
            }
        }
        runtimes[strategyId].executionAccount = account;
    }

    function pauseStrategy(bytes32 strategyId) external onlyOwner(strategyId) {
        StrategyRuntime storage runtime = runtimes[strategyId];
        if (!_isActive(runtime.status)) revert InvalidState();
        runtime.pausedFrom = runtime.status;
        runtime.status = StrategyStatus.PAUSED;
        emit StrategyPaused(strategyId, runtime.pausedFrom);
    }

    function resumeStrategy(bytes32 strategyId) external onlyOwner(strategyId) {
        StrategyRuntime storage runtime = runtimes[strategyId];
        if (runtime.status != StrategyStatus.PAUSED || !_isActive(runtime.pausedFrom)) revert InvalidState();
        StrategyStatus restored = runtime.pausedFrom;
        runtime.pausedFrom = StrategyStatus.NONE;
        runtime.status = restored;
        emit StrategyResumed(strategyId, restored);
    }

    function cancelStrategy(bytes32 strategyId) external onlyOwner(strategyId) {
        StrategyRuntime storage runtime = runtimes[strategyId];
        if (runtime.status == StrategyStatus.STOPPED || runtime.status == StrategyStatus.CANCELLED) {
            revert InvalidState();
        }
        runtime.status = StrategyStatus.CANCELLED;
        runtime.pausedFrom = StrategyStatus.NONE;
        emit StrategyCancelled(strategyId);
    }

    function handleMarketFill(
        bytes32 strategyId,
        uint16 round,
        bytes32 marketId,
        address pool,
        uint256 fillPrice,
        bytes32 callbackId
    ) external onlyHandler {
        if (processedCallbacks[callbackId]) revert DuplicateCallback();
        processedCallbacks[callbackId] = true;

        StrategyRuntime storage runtime = runtimes[strategyId];
        StrategyConfig storage config = configs[strategyId];
        if (runtime.status != StrategyStatus.ARMED) return;
        if (runtime.round != round || runtime.currentMarketId != marketId || runtime.currentPool != pool) {
            revert InvalidMarketBinding();
        }
        if (fillPrice > PRICE_SCALE) revert InvalidOrder();

        bool matched = config.triggerType == TriggerType.LAST_FILL_PRICE_ABOVE
            ? fillPrice > config.triggerValue
            : fillPrice < config.triggerValue;
        if (!matched) {
            emit ReactivityCallbackProcessed(strategyId, callbackId);
            return;
        }

        runtime.triggerFillPrice = fillPrice;
        runtime.status = StrategyStatus.TRIGGERED;
        emit TriggerMatched(strategyId, marketId, round, fillPrice);
        emit ReactivityCallbackProcessed(strategyId, callbackId);
    }

    function executeReadyAction(bytes32 strategyId, uint256 yesLimitPrice, uint256 quantity)
        external
        nonReentrant
        returns (uint128 orderId, uint256 collateralUsed, uint256 positionReceived)
    {
        StrategyRuntime storage runtime = runtimes[strategyId];
        StrategyConfig storage config = configs[strategyId];
        if (runtime.status != StrategyStatus.TRIGGERED) revert InvalidState();
        _requireTradingWindow(strategyId, runtime.currentMarket);
        ExecutionPlan memory plan = _executionPlan(strategyId, runtime, config, yesLimitPrice, quantity);
        if (processedActions[plan.actionKey]) revert DuplicateAction();
        processedActions[plan.actionKey] = true;
        runtime.status = StrategyStatus.ORDER_SUBMITTED;
        emit OrderRequested(strategyId, plan.actionKey, yesLimitPrice, quantity, plan.maxSpend);

        address executionOwner = _executionOwner(runtime);
        uint256 collateralBefore = IERC20Balance(runtime.collateral).balanceOf(executionOwner);
        uint256 positionBefore = IERC6909Balance(runtime.outcomeToken).balanceOf(executionOwner, runtime.outcomeTokenId);
        bool success;
        (success, orderId) = _placeBinaryOrder(runtime, config, yesLimitPrice, quantity);
        uint256 collateralAfter = IERC20Balance(runtime.collateral).balanceOf(executionOwner);
        uint256 positionAfter = IERC6909Balance(runtime.outcomeToken).balanceOf(executionOwner, runtime.outcomeTokenId);
        if (collateralAfter > collateralBefore || positionAfter < positionBefore) revert ExternalBalanceIncreased();
        collateralUsed = collateralBefore - collateralAfter;
        positionReceived = positionAfter - positionBefore;
        if (collateralUsed > plan.maxSpend || collateralUsed > plan.budget) revert RiskLimitExceeded();

        runtime.cumulativeCapitalUsed += collateralUsed;
        runtime.currentPositionSize = positionReceived;
        runtime.status = StrategyStatus.WAITING_RESOLUTION;
        if (!success || positionReceived == 0) emit OrderSkipped(strategyId, plan.actionKey);
        else emit OrderExecuted(strategyId, plan.actionKey, orderId, collateralUsed, positionReceived);
    }

    /// @notice Event payloads never supply the winner or proceeds. Read chain truth and redeem atomically.
    function handleResolution(bytes32 strategyId, bytes32 marketId, bytes32 callbackId) external onlyHandler nonReentrant {
        if (processedCallbacks[callbackId]) return;
        if (_syncStrategy(strategyId, marketId)) {
            processedCallbacks[callbackId] = true;
            emit ReactivityCallbackProcessed(strategyId, callbackId);
        }
    }

    /// @notice Permissionless missed-callback/restart backstop. Never fabricates a fill price.
    function syncStrategy(bytes32 strategyId, bytes32 marketId) external nonReentrant returns (bool) {
        return _syncStrategy(strategyId, marketId);
    }

    function _syncStrategy(bytes32 strategyId, bytes32 marketId) private returns (bool) {
        StrategyRuntime storage runtime = runtimes[strategyId];
        if (runtime.currentMarketId != marketId) revert InvalidMarketBinding();
        if (runtime.status == StrategyStatus.ARMED || runtime.status == StrategyStatus.TRIGGERED) {
            if (IBinaryMarket(runtime.currentMarket).expiry() > block.timestamp) return false;
            _applyResolution(strategyId, RoundResult.SKIPPED, 0);
            return true;
        }
        if (runtime.status != StrategyStatus.WAITING_RESOLUTION) return false;
        IBinaryLifecycle market = IBinaryLifecycle(runtime.currentMarket);
        bool voided = market.isVoided();
        if (!voided && !market.isResolved()) return false;
        uint256 position = runtime.currentPositionSize;
        RoundResult result = RoundResult.SKIPPED;
        uint256 proceeds;
        if (position > 0) {
            uint256[] memory payouts = market.payoutNumerators();
            if (payouts.length != 2) revert InvalidMarketBinding();
            uint8 side = configs[strategyId].actionType == ActionType.BUY_UP ? 0 : 1;
            // P0 binary wins are one-hot. Partial distributions must not be mislabelled as wins.
            if (!voided && payouts[0] != 0 && payouts[1] != 0) revert InvalidMarketBinding();
            result = voided ? RoundResult.VOID : payouts[side] > 0 ? RoundResult.WIN : RoundResult.LOSS;
            proceeds = _redeem(runtime, side, position);
        }
        _applyResolution(strategyId, result, proceeds);
        return true;
    }

    function _redeem(StrategyRuntime storage runtime, uint8 side, uint256 amount) private returns (uint256 proceeds) {
        address account = runtime.executionAccount;
        if (account == address(0)) revert InvalidExecutionAccount();
        uint256 beforeBalance = IERC20Balance(runtime.collateral).balanceOf(account);
        uint256 beforePosition = IERC6909Balance(runtime.outcomeToken).balanceOf(account, runtime.outcomeTokenId);
        // Exact per-token approval; no global operator grant or discretionary destination.
        ICircuitSmartAccount(account).execute(runtime.outcomeToken, 0,
            abi.encodeWithSignature("approve(address,uint256,uint256)", address(binaryModule), runtime.outcomeTokenId, amount));
        ICircuitSmartAccount(account).execute(address(binaryModule), 0,
            abi.encodeCall(IBinaryModule.redeem, (0, bytes32(0), runtime.currentMarketId, side, amount)));
        uint256 afterBalance = IERC20Balance(runtime.collateral).balanceOf(account);
        uint256 afterPosition = IERC6909Balance(runtime.outcomeToken).balanceOf(account, runtime.outcomeTokenId);
        if (afterBalance < beforeBalance || beforePosition < amount || afterPosition != beforePosition - amount) {
            revert ExternalBalanceIncreased();
        }
        proceeds = afterBalance - beforeBalance;
    }

    function _applyResolution(bytes32 strategyId, RoundResult result, uint256 realizedProceeds) private {
        StrategyRuntime storage runtime = runtimes[strategyId];
        StrategyConfig storage config = configs[strategyId];
        if (result == RoundResult.WIN) runtime.consecutiveLosses = 0;
        else if (result == RoundResult.LOSS) runtime.consecutiveLosses++;
        runtime.currentPositionSize = 0;
        emit RoundResolved(strategyId, runtime.currentMarketId, runtime.round, result, realizedProceeds);

        StopReason reason = _stopReason(runtime, config);
        if (reason != StopReason.NONE) {
            _stop(strategyId, runtime, reason);
            return;
        }

        uint256 remainingCap = config.maxTotalCapitalAtRisk - runtime.cumulativeCapitalUsed;
        uint256 desiredBudget =
            result == RoundResult.WIN ? realizedProceeds * config.rollPercentBps / BPS : config.maxOrderCollateral;
        runtime.nextOrderBudget = _min(desiredBudget, _min(config.maxOrderCollateral, remainingCap));
        if (runtime.nextOrderBudget == 0) {
            _stop(strategyId, runtime, StopReason.ZERO_ROLLOVER);
            return;
        }
        runtime.status = StrategyStatus.ROLLING;
        emit RolloverComputed(strategyId, runtime.nextOrderBudget);
    }

    function getStrategy(bytes32 strategyId)
        external
        view
        returns (StrategyConfig memory config, StrategyRuntime memory runtime)
    {
        return (configs[strategyId], runtimes[strategyId]);
    }

    function actionKeyFor(bytes32 strategyId) external view returns (bytes32) {
        StrategyRuntime storage runtime = runtimes[strategyId];
        return keccak256(abi.encode(strategyId, runtime.round, runtime.currentMarketId, configs[strategyId].actionType));
    }

    function _validateConfig(bytes32 manifestHash, StrategyConfig calldata config) private pure {
        if (manifestHash == bytes32(0)) revert InvalidManifest();
        if (config.assetId > 1 || (config.intervalSec != 900 && config.intervalSec != 3600) || config.triggerValue > PRICE_SCALE) revert InvalidPolicy();
        if (config.maxOrderCollateral == 0 || config.maxOrderCollateral > 10_000_000 || config.maxTotalCapitalAtRisk < config.maxOrderCollateral) {
            revert InvalidPolicy();
        }
        if (config.maxRounds == 0 || config.stopAfterLosses == 0) revert InvalidPolicy();
        if (config.minSecondsToExpiry == 0 || config.maxSlippageBps > MAX_SLIPPAGE_BPS) revert InvalidPolicy();
        if (config.rollPercentBps > BPS) revert InvalidPolicy();
    }

    function _requireTradingWindow(bytes32 strategyId, address market) private view {
        if (IBinaryMarket(market).status() != MARKET_STATUS_TRADING) revert MarketNotTrading();
        uint256 expiry = IBinaryMarket(market).expiry();
        if (expiry <= block.timestamp || expiry - block.timestamp < configs[strategyId].minSecondsToExpiry) {
            revert ExpiryBufferViolated();
        }
    }

    function _executionPlan(
        bytes32 strategyId,
        StrategyRuntime storage runtime,
        StrategyConfig storage config,
        uint256 yesLimitPrice,
        uint256 quantity
    ) private view returns (ExecutionPlan memory plan) {
        if (yesLimitPrice == 0 || yesLimitPrice >= PRICE_SCALE || quantity == 0) revert InvalidOrder();
        IBinaryPool.OrderBookParameters memory orderBook = IBinaryPool(runtime.currentPool).getOrderBookParameters();
        if (
            orderBook.tickSize == 0 || orderBook.lotSize == 0 || quantity < orderBook.minQuantity
                || yesLimitPrice % orderBook.tickSize != 0 || quantity % orderBook.lotSize != 0
        ) revert InvalidOrder();
        uint256 outcomePrice = config.actionType == ActionType.BUY_UP ? yesLimitPrice : PRICE_SCALE - yesLimitPrice;
        uint256 observedOutcomePrice =
            config.actionType == ActionType.BUY_UP ? runtime.triggerFillPrice : PRICE_SCALE - runtime.triggerFillPrice;
        uint256 maxOutcomePrice = observedOutcomePrice * (BPS + config.maxSlippageBps) / BPS;
        if (outcomePrice > maxOutcomePrice) revert SlippageExceeded();

        plan.maxSpend = _ceilDiv(quantity * outcomePrice, PRICE_SCALE);
        uint256 remainingCap = config.maxTotalCapitalAtRisk - runtime.cumulativeCapitalUsed;
        plan.budget = _min(runtime.nextOrderBudget, _min(config.maxOrderCollateral, remainingCap));
        if (plan.maxSpend == 0 || plan.maxSpend > plan.budget) revert RiskLimitExceeded();
        plan.actionKey = keccak256(abi.encode(strategyId, runtime.round, runtime.currentMarketId, config.actionType));
    }

    function _placeBinaryOrder(
        StrategyRuntime storage runtime,
        StrategyConfig storage config,
        uint256 yesLimitPrice,
        uint256 quantity
    ) private returns (bool success, uint128 orderId) {
        BinaryOrderCall memory order = BinaryOrderCall({
            pool: runtime.currentPool,
            owner: runtime.owner,
            kind: config.actionType == ActionType.BUY_UP ? ORDER_KIND_BUY_YES : ORDER_KIND_BUY_NO,
            yesLimitPrice: yesLimitPrice,
            quantity: quantity,
            expireTimestampNs: uint64(IBinaryMarket(runtime.currentMarket).expiry() * 1_000_000_000),
            userData: uint64(runtime.round)
        });
        if (runtime.executionAccount != address(0)) {
            return _sendSmartAccountOrder(runtime.executionAccount, order);
        }
        return _sendBinaryOrder(order);
    }

    function _sendSmartAccountOrder(address account, BinaryOrderCall memory order)
        private
        returns (bool success, uint128 orderId)
    {
        bytes memory callData = abi.encodeWithSelector(
            IBinaryPool.placeBinaryOrder.selector,
            order.kind,
            order.yesLimitPrice,
            order.quantity,
            order.expireTimestampNs,
            ORDER_TYPE_IOC,
            0,
            address(0),
            0,
            order.userData
        );
        bytes memory returned = ICircuitSmartAccount(account).execute(order.pool, 0, callData);
        (success, orderId) = abi.decode(returned, (bool, uint128));
    }

    function _executionOwner(StrategyRuntime storage runtime) private view returns (address) {
        return runtime.executionAccount == address(0) ? runtime.owner : runtime.executionAccount;
    }

    function _sendBinaryOrder(BinaryOrderCall memory order) private returns (bool success, uint128 orderId) {
        return IBinaryPool(order.pool).placeBinaryOrderFor(
            order.owner,
            order.kind,
            order.yesLimitPrice,
            order.quantity,
            order.expireTimestampNs,
            ORDER_TYPE_IOC,
            0,
            address(0),
            0,
            order.userData
        );
    }

    function _stopReason(StrategyRuntime storage runtime, StrategyConfig storage config)
        private
        view
        returns (StopReason)
    {
        if (runtime.round >= config.maxRounds) return StopReason.MAX_ROUNDS;
        if (runtime.consecutiveLosses >= config.stopAfterLosses) return StopReason.CONSECUTIVE_LOSSES;
        if (runtime.cumulativeCapitalUsed >= config.maxTotalCapitalAtRisk) return StopReason.CAPITAL_CAP;
        return StopReason.NONE;
    }

    function _stop(bytes32 strategyId, StrategyRuntime storage runtime, StopReason reason) private {
        runtime.status = StrategyStatus.STOPPED;
        emit RiskLimitReached(strategyId, reason);
        emit StrategyStopped(strategyId, reason);
    }

    function _isActive(StrategyStatus status) private pure returns (bool) {
        return status == StrategyStatus.ARMED || status == StrategyStatus.TRIGGERED
            || status == StrategyStatus.ORDER_SUBMITTED || status == StrategyStatus.WAITING_RESOLUTION
            || status == StrategyStatus.ROLLING;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
