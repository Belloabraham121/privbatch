// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SimpleERC20} from "./lib/SimpleERC20.sol";

/**
 * @title MockUSDC
 * @notice Mock USDC token with 6 decimals for testing
 */
contract MockUSDC is SimpleERC20 {
    constructor() SimpleERC20("Mock USDC", "mUSDC", 6) {
        // Mint initial supply to deployer
        _mint(msg.sender, 1000000 * 10**6); // 1M tokens
    }

    /**
     * @notice Mint tokens to an address (for testing)
     * @param to Address to mint to
     * @param amount Amount to mint (in token units, not wei)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount * 10**6);
    }

    /**
     * @notice Mint tokens to an address with exact wei amount
     * @param to Address to mint to
     * @param amount Amount to mint (in wei)
     */
    function mintWei(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
