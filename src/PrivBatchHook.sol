// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary
} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

/**
 * @title PrivBatchHook
 * @notice A Uniswap v4 hook enabling private batch swaps through commit-reveal mechanism
 * @dev Users commit hashed swap intents, autonomous agent reveals and executes batched swaps
 */
contract PrivBatchHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    // ============ Errors ============
    error InvalidCommitment();
    error CommitmentAlreadyRevealed();
    error DeadlineExpired();
    error InsufficientCommitments();
    error SlippageExceeded();
    error InvalidNonce();
    error BatchConditionsNotMet();

    // ============ Events ============
    event CommitmentSubmitted(
        PoolId indexed poolId,
        bytes32 indexed commitmentHash,
        address indexed committer
    );
    event BatchExecuted(
        PoolId indexed poolId,
        int256 netDelta0,
        int256 netDelta1,
        uint256 batchSize,
        uint256 timestamp
    );
    event CommitmentRevealed(
        PoolId indexed poolId,
        bytes32 indexed commitmentHash,
        address user
    );

    // ============ Structs ============
    struct Commitment {
        bytes32 commitmentHash;
        address committer;
        uint256 timestamp;
        bool revealed;
    }

    struct SwapIntent {
        address user;
        Currency tokenIn;
        Currency tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
        uint256 nonce;
        uint256 deadline;
    }

    struct BatchState {
        uint256 lastBatchTimestamp;
        uint256 batchNonce;
    }

    // ============ State Variables ============
    mapping(PoolId => Commitment[]) public commitments;
    mapping(PoolId => BatchState) public batchStates;
    mapping(PoolId => mapping(address => mapping(uint256 => bool)))
        public usedNonces;

    // Configurable parameters
    uint256 public constant MIN_COMMITMENTS = 2;
    uint256 public constant BATCH_INTERVAL = 5 minutes;

    // Optional: Gelato/Chainlink automation address
    address public immutable automationExecutor;

    // ============ Constructor ============
    constructor(
        IPoolManager _poolManager,
        address _automationExecutor
    ) BaseHook(_poolManager) {
        automationExecutor = _automationExecutor;
    }

    // ============ Hook Permissions ============
    function getHookPermissions()
        public
        pure
        override
        returns (Hooks.Permissions memory)
    {
        return
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            });
    }

    // ============ Core Functions ============

    /**
     * @notice Submit a commitment hash for a future swap
     * @param key The pool key
     * @param _commitmentHash Hash of the swap intent
     */
    function submitCommitment(
        PoolKey calldata key,
        bytes32 _commitmentHash
    ) external {
        PoolId poolId = key.toId();

        Commitment memory newCommitment = Commitment({
            commitmentHash: _commitmentHash,
            committer: msg.sender,
            timestamp: block.timestamp,
            revealed: false
        });

        commitments[poolId].push(newCommitment);

        emit CommitmentSubmitted(poolId, _commitmentHash, msg.sender);
    }

    /**
     * @notice Check if batch execution conditions are met (for automation)
     * @param poolId The pool ID to check
     * @return canExec Whether execution can proceed
     * @return execPayload Encoded payload for execution
     */
    function checker(
        PoolId poolId
    ) external view returns (bool canExec, bytes memory execPayload) {
        BatchState memory state = batchStates[poolId];
        Commitment[] memory poolCommitments = commitments[poolId];

        uint256 pendingCount = 0;
        for (uint256 i = 0; i < poolCommitments.length; i++) {
            if (!poolCommitments[i].revealed) {
                pendingCount++;
            }
        }

        bool hasEnoughCommitments = pendingCount >= MIN_COMMITMENTS;
        bool intervalElapsed = block.timestamp - state.lastBatchTimestamp >=
            BATCH_INTERVAL;

        canExec = hasEnoughCommitments && intervalElapsed;

        if (canExec) {
            // In production, this would encode the actual call
            execPayload = abi.encodeWithSelector(
                this.revealAndBatchExecute.selector,
                poolId
            );
        }
    }

    /**
     * @notice Reveal commitments and execute batched swap
     * @param key The pool key
     * @param reveals Array of revealed swap intents
     */
    function revealAndBatchExecute(
        PoolKey calldata key,
        SwapIntent[] calldata reveals
    ) external {
        PoolId poolId = key.toId();

        // Verify batch conditions
        if (reveals.length < MIN_COMMITMENTS) revert InsufficientCommitments();

        BatchState storage state = batchStates[poolId];
        if (block.timestamp - state.lastBatchTimestamp < BATCH_INTERVAL) {
            revert BatchConditionsNotMet();
        }

        // Accumulate net deltas
        int256 netDelta0 = 0;
        int256 netDelta1 = 0;

        Currency token0 = key.currency0;

        // Process each reveal
        for (uint256 i = 0; i < reveals.length; i++) {
            SwapIntent calldata intent = reveals[i];

            // Verify deadline
            if (block.timestamp > intent.deadline) revert DeadlineExpired();

            // Verify nonce uniqueness
            if (usedNonces[poolId][intent.user][intent.nonce])
                revert InvalidNonce();

            // Compute and verify commitment hash
            bytes32 computedHash = keccak256(
                abi.encode(
                    intent.user,
                    intent.tokenIn,
                    intent.tokenOut,
                    intent.amountIn,
                    intent.minAmountOut,
                    intent.recipient,
                    intent.nonce,
                    intent.deadline
                )
            );

            // Find and validate commitment
            bool found = false;
            Commitment[] storage poolCommitments = commitments[poolId];
            for (uint256 j = 0; j < poolCommitments.length; j++) {
                if (
                    poolCommitments[j].commitmentHash == computedHash &&
                    !poolCommitments[j].revealed
                ) {
                    poolCommitments[j].revealed = true;
                    found = true;
                    emit CommitmentRevealed(poolId, computedHash, intent.user);
                    break;
                }
            }

            if (!found) revert InvalidCommitment();

            // Mark nonce as used
            usedNonces[poolId][intent.user][intent.nonce] = true;

            // Accumulate deltas
            if (Currency.unwrap(intent.tokenIn) == Currency.unwrap(token0)) {
                netDelta0 += int256(intent.amountIn);
                netDelta1 -= int256(intent.minAmountOut); // negative = output
            } else {
                netDelta1 += int256(intent.amountIn);
                netDelta0 -= int256(intent.minAmountOut);
            }

            // Transfer tokens from user to hook
            IERC20(Currency.unwrap(intent.tokenIn)).transferFrom(
                intent.user,
                address(this),
                intent.amountIn
            );
        }

        // Execute single batched swap via PoolManager
        // Note: In production, this would use poolManager.unlock() and swap()
        // For hackathon demo, emit event with net deltas

        // Update state
        state.lastBatchTimestamp = block.timestamp;
        state.batchNonce++;

        emit BatchExecuted(
            poolId,
            netDelta0,
            netDelta1,
            reveals.length,
            block.timestamp
        );

        // Distribute outputs to recipients (simplified for demo)
        // In production: calculate each user's share based on actual swap results
    }

    /**
     * @notice Generate commitment hash off-chain helper view
     * @param intent The swap intent to hash
     * @return The commitment hash
     */
    function computeCommitmentHash(
        SwapIntent calldata intent
    ) external pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    intent.user,
                    intent.tokenIn,
                    intent.tokenOut,
                    intent.amountIn,
                    intent.minAmountOut,
                    intent.recipient,
                    intent.nonce,
                    intent.deadline
                )
            );
    }

    /**
     * @notice Get pending commitments for a pool
     * @param poolId The pool ID
     * @return Array of commitments
     */
    function getCommitments(
        PoolId poolId
    ) external view returns (Commitment[] memory) {
        return commitments[poolId];
    }

    /**
     * @notice Get count of unrevealed commitments
     * @param poolId The pool ID
     * @return count Number of pending commitments
     */
    function getPendingCommitmentCount(
        PoolId poolId
    ) external view returns (uint256 count) {
        Commitment[] memory poolCommitments = commitments[poolId];
        for (uint256 i = 0; i < poolCommitments.length; i++) {
            if (!poolCommitments[i].revealed) {
                count++;
            }
        }
    }

    // ============ Hook Overrides ============

    function _beforeSwap(
        address,
        PoolKey calldata,
        SwapParams calldata,
        bytes calldata
    ) internal pure override returns (bytes4, BeforeSwapDelta, uint24) {
        // Optional: Block direct swaps to force batch-only mode
        // For hackathon: allow both modes
        return (
            BaseHook.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            0
        );
    }

    function _afterSwap(
        address,
        PoolKey calldata,
        SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) internal pure override returns (bytes4, int128) {
        // Optional: Return delta adjustments or MEV redistribution
        return (BaseHook.afterSwap.selector, 0);
    }
}
