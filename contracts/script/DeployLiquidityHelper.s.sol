// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {LiquidityHelper} from "../LiquidityHelper.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

contract DeployLiquidityHelper is Script {
    // Base Sepolia PoolManager
    address constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying LiquidityHelper...");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", POOL_MANAGER);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy LiquidityHelper
        LiquidityHelper helper = new LiquidityHelper(IPoolManager(POOL_MANAGER));
        console.log("LiquidityHelper deployed at:", address(helper));

        vm.stopBroadcast();

        console.log("\n=== Deployment Summary ===");
        console.log("LiquidityHelper:", address(helper));
        console.log("PoolManager:", POOL_MANAGER);
    }
}
