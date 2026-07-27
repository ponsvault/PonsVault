// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {PonsTemplates} from "../src/PonsTemplates.sol";
import {PonsBuybackBurnVault} from "../src/vaults/PonsBuybackBurnVault.sol";
import {PonsStakingVault} from "../src/vaults/PonsStakingVault.sol";

/// @notice Decodes the exact bytes the launch form produces.
///
/// @dev Every other test builds its config in Solidity, which means the encoding the browser
///      actually performs is never exercised: a field reordered or resized on one side would pass
///      the whole suite and then revert on a real launch, after the token had already been created.
///
///      The literals below are the real output of `encodeLaunchWithVaultTransaction`, taken from
///      `scripts/audit-config-bytes.ts`. Regenerate them with that script if a Config changes —
///      and if it changed by accident, this test is what says so.
contract VaultConfigDecodingTest is Test {
    /// burnPercent 80, treasury 0x1111…, minHarvest 0.025 ETH
    bytes constant BUYBACK_PARTIAL =
        hex"0000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000058d15e17628000";

    /// burnPercent 100, so the form sends no treasury at all
    bytes constant BUYBACK_FULL =
        hex"000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000058d15e17628000";

    /// lock 0 days, minHarvest 0.025 ETH
    bytes constant STAKING_NO_LOCK =
        hex"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000058d15e17628000";

    /// lock 30 days, minHarvest 0.025 ETH
    bytes constant STAKING_THIRTY_DAY =
        hex"0000000000000000000000000000000000000000000000000000000000278d000000000000000000000000000000000000000000000000000058d15e17628000";

    function test_buybackPartialBurnDecodes() public pure {
        PonsBuybackBurnVault.Config memory cfg =
            abi.decode(BUYBACK_PARTIAL, (PonsBuybackBurnVault.Config));

        assertEq(cfg.burnBps, 8000, "80% should arrive as 8000 bps");
        assertEq(cfg.treasury, 0x1111111111111111111111111111111111111111, "treasury");
        assertEq(cfg.minHarvestWei, 0.025 ether, "minHarvest");
    }

    function test_buybackFullBurnDecodes() public pure {
        PonsBuybackBurnVault.Config memory cfg = abi.decode(BUYBACK_FULL, (PonsBuybackBurnVault.Config));

        assertEq(cfg.burnBps, 10_000, "100% should arrive as 10000 bps");
        assertEq(cfg.treasury, address(0), "a full burn should carry no treasury");
        assertEq(cfg.minHarvestWei, 0.025 ether, "minHarvest");
    }

    function test_stakingNoLockDecodes() public pure {
        PonsStakingVault.Config memory cfg = abi.decode(STAKING_NO_LOCK, (PonsStakingVault.Config));

        assertEq(cfg.lockPeriod, 0, "no lock");
        assertEq(cfg.minHarvestWei, 0.025 ether, "minHarvest");
    }

    function test_stakingLockDecodesAsSeconds() public pure {
        PonsStakingVault.Config memory cfg = abi.decode(STAKING_THIRTY_DAY, (PonsStakingVault.Config));

        // The form collects days; the contract stores seconds. A unit slip here would silently
        // lock stakers for 30 seconds, or for 30 days when they asked for 30 minutes.
        assertEq(cfg.lockPeriod, 30 days, "30 days should arrive as seconds");
        assertEq(cfg.minHarvestWei, 0.025 ether, "minHarvest");
    }

    /// @dev The other half of the seam: the id the form sends must be the id the registry is keyed
    ///      on. Both are right-padded ASCII, so a mismatch would only surface as UnknownTemplate.
    function test_templateIdsMatchTheFrontend() public pure {
        assertEq(
            PonsTemplates.BUYBACK_BURN,
            hex"6275796261636b2d6275726e0000000000000000000000000000000000000000",
            "buyback-burn"
        );
        assertEq(
            PonsTemplates.STAKING,
            hex"7374616b696e6700000000000000000000000000000000000000000000000000",
            "staking"
        );
    }

    /// @dev A wrong-shaped blob must fail loudly at the factory rather than decoding into
    ///      plausible-looking garbage. Staking's config is two words; the buyback's is three.
    function test_wrongTemplateConfigCannotDecode() public {
        vm.expectRevert();
        this.decodeBuyback(STAKING_NO_LOCK);
    }

    function decodeBuyback(bytes calldata data)
        external
        pure
        returns (PonsBuybackBurnVault.Config memory)
    {
        return abi.decode(data, (PonsBuybackBurnVault.Config));
    }
}
