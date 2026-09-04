// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface ICircuitReactivityBinder {
    function bindMarket(address pool, bytes32 strategyId, bytes32 marketId, uint16 round) external;
}
