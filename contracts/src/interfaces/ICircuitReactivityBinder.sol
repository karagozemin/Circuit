// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface ICircuitReactivityBinder {
    function marketMetadata(bytes32 marketId) external view returns (address creator, uint8 assetId, uint32 intervalSec, bool verified);
    function bindResolutionMarket(address market, bytes32 strategyId, bytes32 marketId, uint16 round) external;
    function unbindMarket(address emitter) external;
    function bindMarket(address pool, bytes32 strategyId, bytes32 marketId, uint16 round) external;
}
