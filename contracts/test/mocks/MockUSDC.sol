// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Freely mintable 6-decimal token for tests and local chains.
/// `transfer` to a recipient marked with `setTransferFails` returns false and moves nothing.
contract MockUSDC is ERC20 {
    mapping(address recipient => bool) public transferFails;

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTransferFails(address recipient, bool fails) external {
        transferFails[recipient] = fails;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (transferFails[to]) return false;
        return super.transfer(to, value);
    }
}
