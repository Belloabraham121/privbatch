// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PrivBatchHook} from "../PrivBatchHook.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";
import {Groth16Verifier} from "../CommitmentVerifier.sol";

contract DeployPrivBatchHook is Script {
    // Base Sepolia PoolManager address
    address constant POOLMANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying ZK Verifier and PrivBatchHook...");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", POOLMANAGER);

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy the ZK Verifier contract
        console.log("\n=== Deploying Groth16Verifier ===");
        Groth16Verifier verifier = new Groth16Verifier();
        console.log("Groth16Verifier deployed at:", address(verifier));

        // Step 2: Mine for hook address with correct flags
        // We need beforeSwap and afterSwap flags
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG |
                Hooks.AFTER_SWAP_FLAG |
                Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );

        // Find salt that gives us address with correct flags
        // Note: Hook constructor now takes both poolManager and verifier
        (address hookAddress, bytes32 salt) = HookMiner.find(
            deployer,
            flags,
            type(PrivBatchHook).creationCode,
            abi.encode(IPoolManager(POOLMANAGER), address(verifier))
        );

        console.log("\n=== Mining Hook Address ===");
        console.log("Mined hook address:", hookAddress);
        console.log("Salt:", vm.toString(salt));

        // Step 3: Deploy hook using CREATE2
        console.log("\n=== Deploying PrivBatchHook ===");
        PrivBatchHook hook = new PrivBatchHook{salt: salt}(
            IPoolManager(POOLMANAGER),
            address(verifier)
        );

        require(address(hook) == hookAddress, "Hook address mismatch");

        console.log("PrivBatchHook deployed at:", address(hook));
        console.log("\n=== Deployment Summary ===");
        console.log("Verifier:", address(verifier));
        console.log("Hook:", address(hook));

        vm.stopBroadcast();
    }
}
