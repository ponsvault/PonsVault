// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";
import {BeaconProxy} from "@openzeppelin/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";

import {PonsAddresses} from "../src/PonsAddresses.sol";
import {PonsLotteryVault} from "../src/vaults/PonsLotteryVault.sol";

contract MockToken is ERC20 {
    address public deployer;

    constructor(address deployer_) ERC20("Mock", "MOCK") {
        deployer = deployer_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

interface IERC20Bal {
    function balanceOf(address) external view returns (uint256);
}

/// @notice Commit-reveal raffle without a fork: fund WETH directly, skip the locker.
contract PonsLotteryVaultTest is Test {
    PonsLotteryVault vault;
    MockToken token;
    address operator = address(0xBEEF);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        token = new MockToken(address(this));

        PonsLotteryVault impl = new PonsLotteryVault();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl));
        vault = PonsLotteryVault(
            address(
                new BeaconProxy(
                    address(beacon),
                    abi.encodeCall(
                        PonsLotteryVault.initialize,
                        (
                            address(token),
                            address(0x1234),
                            address(this),
                            operator,
                            PonsLotteryVault.Config({
                                minHarvestWei: 0.01 ether,
                                entryPeriod: 1 hours,
                                revealDelay: 10 minutes
                            })
                        )
                    )
                )
            )
        );

        // Local anvil has no WETH at the pons address; put a real ERC-20 there so
        // deal and SafeERC20 transfers behave like mainnet.
        MockToken weth = new MockToken(address(this));
        vm.etch(PonsAddresses.WETH, address(weth).code);
        deal(PonsAddresses.WETH, address(vault), 0.05 ether);
        token.mint(alice, 1 ether);
        token.mint(bob, 1 ether);
    }

    function test_fullRoundPaysWinner() public {
        vault.run();
        assertEq(vault.roundCount(), 1);

        vm.prank(alice);
        vault.enter();
        vm.prank(bob);
        vault.enter();

        vm.warp(block.timestamp + 1 hours);

        uint256 secret = 42;
        bytes32 commitment = keccak256(abi.encodePacked(secret, uint256(0), address(vault)));

        vm.prank(operator);
        vault.commit(commitment);

        vm.warp(block.timestamp + 10 minutes);

        uint256 bobBefore = IERC20Bal(PonsAddresses.WETH).balanceOf(bob);
        uint256 aliceBefore = IERC20Bal(PonsAddresses.WETH).balanceOf(alice);

        vm.prank(operator);
        vault.reveal(secret);

        PonsLotteryVault.Round memory round = vault.rounds(0);
        assertEq(uint8(round.phase), uint8(PonsLotteryVault.Phase.Drawn));
        assertTrue(round.winner == alice || round.winner == bob);

        uint256 winnerBefore = round.winner == bob ? bobBefore : aliceBefore;
        uint256 paid = IERC20Bal(PonsAddresses.WETH).balanceOf(round.winner) - winnerBefore;
        assertEq(paid, 0.05 ether);
    }

    function test_noEntrantsCancels() public {
        vault.run();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(operator);
        vault.commit(bytes32(uint256(1)));

        PonsLotteryVault.Round memory round = vault.rounds(0);
        assertEq(uint8(round.phase), uint8(PonsLotteryVault.Phase.Cancelled));
        assertEq(IERC20Bal(PonsAddresses.WETH).balanceOf(address(vault)), 0.05 ether);
    }

    function test_badRevealReverts() public {
        vault.run();
        vm.prank(alice);
        vault.enter();
        vm.warp(block.timestamp + 1 hours);

        bytes32 commitment = keccak256(abi.encodePacked(uint256(1), uint256(0), address(vault)));
        vm.prank(operator);
        vault.commit(commitment);
        vm.warp(block.timestamp + 10 minutes);

        vm.prank(operator);
        vm.expectRevert(PonsLotteryVault.BadReveal.selector);
        vault.reveal(999);
    }
}
