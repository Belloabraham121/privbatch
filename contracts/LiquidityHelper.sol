// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";

/**
 * @title LiquidityHelper
 * @notice Helper contract to add liquidity to Uniswap v4 pools
 * @dev Implements IUnlockCallback to handle the unlock callback required by modifyLiquidity
 */
contract LiquidityHelper is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using CurrencySettler for Currency;

    IPoolManager public immutable poolManager;

    struct CallbackData {
        address sender;
        PoolKey key;
        IPoolManager.ModifyLiquidityParams params;
        bytes hookData;
    }

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    /**
     * @notice Add liquidity to a pool using unlock pattern
     * @param key The pool key
     * @param params The modify liquidity parameters
     * @param hookData Hook data (empty for simple liquidity)
     */
    function addLiquidity(
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external returns (BalanceDelta callerDelta, BalanceDelta feesAccrued) {
        // Use unlock pattern - this will call unlockCallback
        callerDelta = abi.decode(
            poolManager.unlock(abi.encode(CallbackData(msg.sender, key, params, hookData))),
            (BalanceDelta)
        );
        
        // Note: feesAccrued is not returned from unlock, but that's okay for our use case
        feesAccrued = BalanceDelta.wrap(0);
        
        // Settle balances
        poolManager.settle(key.currency0);
        poolManager.settle(key.currency1);
    }

    /**
     * @notice Unlock callback - handles token transfers during modifyLiquidity
     * @dev This is called by the pool manager during unlock()
     */
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "Only pool manager");

        CallbackData memory data = abi.decode(rawData, (CallbackData));

        // Call modifyLiquidity - this will calculate the required token amounts
        (BalanceDelta delta,) = poolManager.modifyLiquidity(data.key, data.params, data.hookData);

        // Extract amount0 and amount1 from delta using BalanceDeltaLibrary
        int128 amount0 = BalanceDeltaLibrary.amount0(delta);
        int128 amount1 = BalanceDeltaLibrary.amount1(delta);

        // Negative delta means we need to pay tokens (settle)
        // Positive delta means we receive tokens (take)
        if (amount0 < 0) {
            data.key.currency0.settle(poolManager, data.sender, uint256(-amount0), false);
        } else if (amount0 > 0) {
            data.key.currency0.take(poolManager, data.sender, uint256(amount0), false);
        }

        if (amount1 < 0) {
            data.key.currency1.settle(poolManager, data.sender, uint256(-amount1), false);
        } else if (amount1 > 0) {
            data.key.currency1.take(poolManager, data.sender, uint256(amount1), false);
        }

        // Return the delta
        return abi.encode(delta);
    }
}
