// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title PonsV2Addresses
/// @notice Current pons v2 + Uniswap v4 addresses on Robinhood Chain (4663).
/// @dev The earlier factory `0x7E1EAbd5…` was replaced as a whole set. These match
///      https://docs.ponsfamily.com/v2 (Deployed addresses). `launchEnabled` is true —
///      public launches are open; check `canLaunch(address)` rather than assuming.
library PonsV2Addresses {
    uint256 internal constant CHAIN_ID = 4663;

    address internal constant FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address internal constant FEE_ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
    address internal constant BUYBACK_VAULT = 0x42df2a798f82289E177311362e8f5ccC45c1219c;
    address internal constant MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address internal constant LOCKER = 0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952;
    address internal constant LAUNCH_DEPLOYER = 0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42;
    address internal constant LAUNCH_AND_BUY = 0xe33E9E479dF8802cb0866d5d05258bEc4cF62948;

    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    /// @notice Apple • Robinhood Token — currently an approved quote asset.
    address internal constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;

    address internal constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    uint16 internal constant BPS_DENOMINATOR = 10_000;
}
