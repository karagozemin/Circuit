// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IBinaryMarket {
    function pool() external view returns (address);
    function collateral() external view returns (address);
    function outcomeToken() external view returns (address);
    function yesId() external view returns (uint256);
    function noId() external view returns (uint256);
    function status() external view returns (uint8);
    function expiry() external view returns (uint64);
}

interface IBinaryPool {
    struct OrderBookParameters {
        uint256 tickSize;
        uint256 minQuantity;
        uint256 lotSize;
    }

    function getOrderBookParameters() external view returns (OrderBookParameters memory);

    function placeBinaryOrderFor(
        address owner,
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k,
        uint64 userData
    ) external payable returns (bool success, uint128 orderId);
}

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

interface IERC6909Balance {
    function balanceOf(address owner, uint256 id) external view returns (uint256);
}
