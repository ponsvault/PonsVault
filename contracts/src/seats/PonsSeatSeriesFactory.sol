// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

import {PonsSeatCollection} from "./PonsSeatCollection.sol";
import {PonsSeatSeriesCoreDeployer} from "./PonsSeatSeriesCoreDeployer.sol";
import {PonsSeatSeriesMarketDeployer} from "./PonsSeatSeriesMarketDeployer.sol";
import {PonsSeatSeriesRegistry} from "./PonsSeatSeriesRegistry.sol";

interface ILoanPrincipal {
    function principalAmount() external view returns (uint256);
}

/// @notice Orchestrates a Seat Series deploy via size-split helper contracts.
contract PonsSeatSeriesFactory {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error NotLauncher();

    struct CreateParams {
        string name;
        string symbol;
        string tokenName;
        string tokenSymbol;
        string baseTokenURI;
        /**
         * keccak256 of the real base URI, or zero to sell with the art already visible.
         *
         * Set it and `baseTokenURI` is a placeholder every seat shows until someone calls `reveal`
         * with the matching pack. Left zero, the pack is public from the first sale, which lets a
         * buyer look up which seat holds the rarest piece and snipe that exact number.
         */
        bytes32 provenanceHash;
        uint256 maxSupply;
        uint256 tokenSupply;
        uint256 seatPrice;
        uint16 swapFeeBps;
        uint16 snipeFeeBps;
        uint16 royaltyBps;
        uint256 distributeThreshold;
        address protocolTreasury;
        uint256[] activationFees;
        uint256[] activationWeights;
        uint64 loanTermSeconds;
        uint256 loanMinEthFee;
        /**
         * An existing ERC-20 to use as this series' fuel, or zero to mint a fresh companion token.
         *
         * A minted companion token starts its life entirely in the creator's wallet, which means
         * nobody else can buy a seat until the creator hands fuel out. Pointing a series at a token
         * that already trades — a Pons V2 bonding-curve launch, for instance — gives buyers a market
         * to get fuel from.
         */
        address fuelToken;
        /**
         * Fuel pulled from the creator to stock the loan vault, used only with an existing
         * fuelToken. Zero is allowed: the vault lends from its own balance, so it can be topped up
         * with a plain transfer at any time, and until then borrowing simply has nothing to lend.
         */
        uint256 loanSeed;
    }

    PonsSeatSeriesRegistry public immutable registry;
    address public immutable tbaRegistry;
    PonsSeatSeriesCoreDeployer public immutable coreDeployer;
    PonsSeatSeriesMarketDeployer public immutable marketDeployer;
    /**
     * The one contract allowed to create a series on someone else's behalf.
     *
     * A one-transaction launch has to go through a contract, which would otherwise be recorded as
     * every series' creator. Trusting a single fixed address keeps that attribution honest without
     * making it forgeable by anyone who wants to put a series in a stranger's name.
     */
    address public immutable launcher;

    event SeriesCreated(
        uint256 indexed seriesId,
        address indexed creator,
        address token,
        address collection,
        address amm,
        address activation,
        address booster,
        address loan
    );

    constructor(
        address registry_,
        address tbaRegistry_,
        address coreDeployer_,
        address marketDeployer_,
        address launcher_
    ) {
        if (
            registry_ == address(0) || tbaRegistry_ == address(0) || coreDeployer_ == address(0)
                || marketDeployer_ == address(0) || launcher_ == address(0)
        ) {
            revert ZeroAddress();
        }
        registry = PonsSeatSeriesRegistry(registry_);
        tbaRegistry = tbaRegistry_;
        coreDeployer = PonsSeatSeriesCoreDeployer(coreDeployer_);
        marketDeployer = PonsSeatSeriesMarketDeployer(marketDeployer_);
        launcher = launcher_;
    }

    function createSeries(CreateParams calldata p) external returns (uint256 seriesId) {
        return _create(msg.sender, p);
    }

    /// @notice Create a series recorded under `creator` rather than the caller.
    function createSeriesFor(address creator, CreateParams calldata p) external returns (uint256 seriesId) {
        if (msg.sender != launcher) revert NotLauncher();
        if (creator == address(0)) revert ZeroAddress();
        return _create(creator, p);
    }

    function _create(address creator, CreateParams calldata p) internal returns (uint256 seriesId) {
        bool mintsOwnToken = p.fuelToken == address(0);
        require(p.maxSupply > 0, "supply");
        require(!mintsOwnToken || p.tokenSupply > 0, "supply");
        require(p.protocolTreasury != address(0), "treasury");
        require(p.activationFees.length == p.activationWeights.length, "tiers");

        PonsSeatSeriesCoreDeployer.CoreResult memory core = coreDeployer.deploy(
            PonsSeatSeriesCoreDeployer.CoreParams({
                minterAndTokenRecipient: address(this),
                tbaRegistry: tbaRegistry,
                name: p.name,
                symbol: p.symbol,
                tokenName: p.tokenName,
                tokenSymbol: p.tokenSymbol,
                baseTokenURI: p.baseTokenURI,
                provenanceHash: p.provenanceHash,
                maxSupply: p.maxSupply,
                tokenSupply: p.tokenSupply,
                protocolTreasury: p.protocolTreasury,
                royaltyBps: p.royaltyBps,
                activationFees: p.activationFees,
                activationWeights: p.activationWeights,
                fuelToken: p.fuelToken
            })
        );

        PonsSeatCollection(core.collection).setActivationManager(core.activation);

        PonsSeatSeriesMarketDeployer.MarketResult memory market = marketDeployer.deploy(
            core.token,
            core.collection,
            core.activation,
            p.protocolTreasury,
            p.seatPrice,
            p.swapFeeBps,
            p.snipeFeeBps,
            p.distributeThreshold,
            p.loanTermSeconds,
            p.loanMinEthFee
        );

        if (mintsOwnToken) {
            // The factory holds the freshly minted supply: stock the loan book, then hand the rest over.
            uint256 loanBook = ILoanPrincipal(market.loan).principalAmount() * p.maxSupply;
            require(p.tokenSupply > loanBook, "loan book");
            IERC20(core.token).safeTransfer(market.loan, loanBook);
            IERC20(core.token).safeTransfer(creator, p.tokenSupply - loanBook);
        } else if (p.loanSeed > 0) {
            // The supply lives on someone else's market, so the loan book can only be seeded with
            // fuel the creator already holds.
            IERC20(core.token).safeTransferFrom(msg.sender, market.loan, p.loanSeed);
        }

        // No seats are minted here. The shop mints each one as it is bought, so creation costs the
        // same for a 4,444-seat series as for a 10-seat one and every buyer pays for their own seat.
        PonsSeatCollection(core.collection).setShop(market.amm);

        seriesId = registry.register(
            creator,
            core.token,
            core.collection,
            market.amm,
            core.activation,
            market.booster,
            market.loan,
            p.name,
            p.symbol,
            p.maxSupply
        );

        emit SeriesCreated(
            seriesId,
            creator,
            core.token,
            core.collection,
            market.amm,
            core.activation,
            market.booster,
            market.loan
        );
    }
}
