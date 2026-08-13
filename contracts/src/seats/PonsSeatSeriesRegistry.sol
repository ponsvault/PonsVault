// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Append-only list of deployed Seat Series for the UI.
contract PonsSeatSeriesRegistry {
    error NotFactory();

    event SeriesRegistered(
        uint256 indexed seriesId,
        address indexed creator,
        address token,
        address collection,
        address amm,
        address activation,
        address booster,
        address loan
    );

    struct Series {
        address creator;
        address token;
        address collection;
        address amm;
        address activation;
        address booster;
        address loan;
        string name;
        string symbol;
        uint256 maxSupply;
        uint64 createdAt;
    }

    address public factory;
    Series[] public series;

    function setFactory(address factory_) external {
        require(factory == address(0) || msg.sender == factory, "factory");
        factory = factory_;
    }

    function register(
        address creator,
        address token,
        address collection,
        address amm,
        address activation,
        address booster,
        address loan,
        string calldata name,
        string calldata symbol,
        uint256 maxSupply
    ) external returns (uint256 seriesId) {
        if (msg.sender != factory) revert NotFactory();
        seriesId = series.length;
        series.push(
            Series({
                creator: creator,
                token: token,
                collection: collection,
                amm: amm,
                activation: activation,
                booster: booster,
                loan: loan,
                name: name,
                symbol: symbol,
                maxSupply: maxSupply,
                createdAt: uint64(block.timestamp)
            })
        );
        emit SeriesRegistered(seriesId, creator, token, collection, amm, activation, booster, loan);
    }

    function seriesCount() external view returns (uint256) {
        return series.length;
    }
}
