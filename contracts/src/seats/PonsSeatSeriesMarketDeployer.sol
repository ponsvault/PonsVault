// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PonsSeatAmmVault} from "./PonsSeatAmmVault.sol";
import {PonsSeatDirectedBooster} from "./PonsSeatDirectedBooster.sol";
import {PonsSeatLoanVault} from "./PonsSeatLoanVault.sol";

/// @notice Deploys booster + AMM + loan vault for one series.
/// @dev Split out of the series factory so each contract stays under EIP-170.
contract PonsSeatSeriesMarketDeployer {
    /// @notice Loan principal as a share of the seat shop price. The gap is the liquidator's discount.
    uint16 public constant LOAN_LTV_BPS = 7000;

    struct MarketResult {
        address amm;
        address booster;
        address loan;
    }

    function deploy(
        address token,
        address collection,
        address activation,
        address protocolTreasury,
        uint256 seatPrice,
        uint16 swapFeeBps,
        uint16 snipeFeeBps,
        uint256 distributeThreshold,
        uint64 loanTermSeconds,
        uint256 loanMinEthFee
    ) external returns (MarketResult memory out) {
        PonsSeatDirectedBooster booster =
            new PonsSeatDirectedBooster(collection, activation, distributeThreshold, address(0));

        PonsSeatAmmVault amm = new PonsSeatAmmVault(
            token, collection, payable(address(booster)), seatPrice, swapFeeBps, snipeFeeBps
        );

        PonsSeatLoanVault loan = new PonsSeatLoanVault(
            token,
            collection,
            payable(address(booster)),
            protocolTreasury,
            (seatPrice * LOAN_LTV_BPS) / 10_000,
            loanTermSeconds == 0 ? 7 days : loanTermSeconds,
            7000,
            loanMinEthFee == 0 ? 0.01 ether : loanMinEthFee
        );

        out = MarketResult({amm: address(amm), booster: address(booster), loan: address(loan)});
    }
}
