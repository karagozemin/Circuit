// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface ICircuitEngine {
    function handleResolution(bytes32 strategyId, bytes32 marketId, bytes32 callbackId) external;
    function handleMarketFill(
        bytes32 strategyId,
        uint16 round,
        bytes32 marketId,
        address pool,
        uint256 fillPrice,
        bytes32 callbackId
    ) external;
}
