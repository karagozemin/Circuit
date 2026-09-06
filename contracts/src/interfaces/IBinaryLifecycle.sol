// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IBinaryLifecycle {
    function isResolved() external view returns (bool);
    function isVoided() external view returns (bool);
    function payoutNumerators() external view returns (uint256[] memory);
}

interface IBinaryModule {
    struct MarketRecord {
        uint256 oracleQuestionId;
        uint8 outcomeSlotCount;
        uint8 voidPolicy;
        address collateral;
        uint32 originOperatorId;
        bytes32 originVenueId;
        address oracleAdapter;
        address creator;
        address market;
        address pool;
        uint256 yesId;
        uint256 noId;
        uint64 tradingStart;
        uint64 expiry;
    }
    function markets(bytes32 marketId) external view returns (MarketRecord memory);
    function redeem(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint8 outcomeIdx, uint256 amount) external;
}
