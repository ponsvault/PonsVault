// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PonsSeatActivationManager} from "./PonsSeatActivationManager.sol";
import {PonsSeatCollection} from "./PonsSeatCollection.sol";
import {PonsSeatToken} from "./PonsSeatToken.sol";

/// @notice Deploys companion token + NFT collection + activation manager for one series.
/// @dev Split out of the series factory so each contract stays under EIP-170.
contract PonsSeatSeriesCoreDeployer {
    /// @dev A struct rather than a parameter list: fifteen arguments does not fit the EVM stack.
    struct CoreParams {
        address minterAndTokenRecipient;
        address tbaRegistry;
        string name;
        string symbol;
        string tokenName;
        string tokenSymbol;
        string baseTokenURI;
        /// @dev keccak256 of the real base URI when the series sells blind, zero when it does not.
        bytes32 provenanceHash;
        uint256 maxSupply;
        uint256 tokenSupply;
        address protocolTreasury;
        uint16 royaltyBps;
        uint256[] activationFees;
        uint256[] activationWeights;
        /**
         * An existing ERC-20 to use as the series currency, or zero to mint a fresh companion token.
         *
         * Passing one lets a series run on a token that already trades somewhere — a Pons V2
         * bonding-curve launch, say — so buyers have a market to get fuel from instead of depending
         * on the creator to hand it out.
         */
        address fuelToken;
    }

    struct CoreResult {
        address token;
        address collection;
        address activation;
    }

    function deploy(CoreParams calldata p) external returns (CoreResult memory out) {
        address seatToken = p.fuelToken;
        if (seatToken == address(0)) {
            seatToken = address(
                new PonsSeatToken(p.tokenName, p.tokenSymbol, p.tokenSupply, p.minterAndTokenRecipient)
            );
        }

        PonsSeatCollection collection = new PonsSeatCollection(
            p.name,
            p.symbol,
            p.maxSupply,
            p.baseTokenURI,
            p.provenanceHash,
            p.minterAndTokenRecipient,
            p.tbaRegistry,
            p.protocolTreasury,
            p.royaltyBps
        );

        PonsSeatActivationManager activation = new PonsSeatActivationManager(
            seatToken,
            address(collection),
            p.protocolTreasury,
            5000,
            5000,
            p.activationFees,
            p.activationWeights
        );

        out = CoreResult({
            token: seatToken,
            collection: address(collection),
            activation: address(activation)
        });
    }
}
