// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CircuitSmartAccount} from "../src/CircuitSmartAccount.sol";

interface SmartAccountVm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
}

contract SmartAccountTarget {
    uint256 public calls;

    function ping(uint256 value) external returns (uint256) {
        calls = value;
        return value;
    }

    function placeBinaryOrder(
        uint8,
        uint256,
        uint256,
        uint64,
        uint8,
        uint8,
        address,
        uint96,
        uint64
    ) external returns (bool, uint128) {
        calls++;
        return (true, 7);
    }
}

contract CircuitSmartAccountTest {
    SmartAccountVm private constant vm = SmartAccountVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OWNER = address(0xA11CE);
    address private constant ENGINE = address(0xE11CE);
    address private constant SESSION = address(0x5E5510);

    CircuitSmartAccount private account;
    SmartAccountTarget private target;

    function setUp() public {
        account = new CircuitSmartAccount(OWNER, ENGINE);
        target = new SmartAccountTarget();
    }

    function test_ownerCanExecuteSetupCall() public {
        vm.prank(OWNER);
        bytes memory result = account.execute(address(target), 0, abi.encodeCall(target.ping, (42)));
        require(abi.decode(result, (uint256)) == 42, "bad return");
        require(target.calls() == 42, "owner call not executed");
    }

    function test_nonExecutorCannotExecute() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(CircuitSmartAccount.OnlyExecutor.selector);
        account.execute(address(target), 0, abi.encodeCall(target.ping, (1)));
    }

    function test_executorOnlyAcceptsBinaryPlacementSelector() public {
        vm.prank(ENGINE);
        vm.expectRevert(CircuitSmartAccount.TargetNotAllowed.selector);
        account.execute(address(target), 0, abi.encodeCall(target.ping, (1)));

        vm.prank(ENGINE);
        bytes memory result = account.execute(
            address(target),
            0,
            abi.encodeCall(target.placeBinaryOrder, (uint8(0), uint256(500_000), uint256(1_000_000), uint64(1), uint8(2), uint8(0), address(0), uint96(0), uint64(1)))
        );
        (bool success, uint128 orderId) = abi.decode(result, (bool, uint128));
        require(success && orderId == 7, "binary call failed");
    }

    function test_sessionKeyIsExactAndExpires() public {
        vm.prank(OWNER);
        account.setSessionKey(SESSION, address(target), target.placeBinaryOrder.selector, 2_000_000);

        vm.prank(SESSION);
        bytes memory result = account.executeSession(
            address(target),
            0,
            abi.encodeCall(target.placeBinaryOrder, (uint8(2), uint256(500_000), uint256(1_000_000), uint64(1), uint8(2), uint8(0), address(0), uint96(0), uint64(1)))
        );
        (bool success,) = abi.decode(result, (bool, uint128));
        require(success, "session call failed");

        vm.prank(SESSION);
        vm.expectRevert(CircuitSmartAccount.TargetNotAllowed.selector);
        account.executeSession(address(target), 0, abi.encodeCall(target.ping, (1)));

        vm.warp(2_000_001);
        vm.prank(SESSION);
        vm.expectRevert(CircuitSmartAccount.SessionExpired.selector);
        account.executeSession(
            address(target),
            0,
            abi.encodeCall(target.placeBinaryOrder, (uint8(2), uint256(500_000), uint256(1_000_000), uint64(1), uint8(2), uint8(0), address(0), uint96(0), uint64(1)))
        );
    }
}
