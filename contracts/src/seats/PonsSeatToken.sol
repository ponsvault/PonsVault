// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";

/// @notice Companion ERC-20 for a Seat Series (buy / activate fuel).
contract PonsSeatToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply_, address to) ERC20(name_, symbol_) {
        _mint(to, supply_);
    }
}
