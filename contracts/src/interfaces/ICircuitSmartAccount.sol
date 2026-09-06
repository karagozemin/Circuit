// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface ICircuitSmartAccount {
    function owner() external view returns (address);
    function executor() external view returns (address);
    function execute(address target, uint256 value, bytes calldata data) external returns (bytes memory result);
}
