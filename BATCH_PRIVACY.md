# Batch Privacy Documentation

## Overview

This document describes the privacy guarantees provided by the PrivBatchHook's batch execution mechanism. It details what information is visible vs. hidden during different phases of the batch swap process.

## Privacy Guarantees

### ✅ What is Hidden (Private)

1. **Individual Trade Details During Commitment Phase**
   - User addresses: Not stored in commitments (committer = address(0))
   - Token pairs: Only commitment hash visible
   - Trade amounts: Only commitment hash visible
   - Recipients: Only commitment hash visible
   - **Visibility**: Only `commitmentHash` is visible on-chain

2. **Individual Trade Details During Batch Execution**
   - **Calldata**: Only commitment hashes (32 bytes each) are in batch execution calldata
   - **Reveals**: Stored separately via `submitReveal()`, not in batch execution transaction
   - **Swap Execution**: Only net deltas (aggregated amounts) are passed to PoolManager
   - **Pool Visibility**: Pool only sees net swap direction and net amounts, not individual trades

3. **Individual Trade Details in Events**
   - `CommitmentSubmitted`: Only poolId and commitmentHash (no user address)
   - `CommitmentRevealed`: Only poolId and commitmentHash (no user address)
   - `BatchExecuted`: Only net amounts (netDelta0, netDelta1) and batch size (no individual trades)
   - `TokensDistributed`: Only recipient hash (not address), token address, and amount

4. **Netting Privacy**
   - Individual contributions are aggregated into net deltas before swap execution
   - Pool only sees the net swap direction and net amounts
   - Individual trade sizes, directions, and participants are hidden from the pool

### ⚠️ What is Visible (Public)

1. **Commitment Phase**
   - Commitment hash (can be used to verify commitment later)
   - Pool ID (which pool the commitment is for)
   - Timestamp (when commitment was submitted)

2. **Reveal Phase** (if using `submitReveal()`)
   - Full swap intent is stored on-chain (visible in state)
   - This is a trade-off: Reveals must be stored to enable batch execution
   - **Mitigation**: Reveals are cleaned up after batch execution
   - **Future**: ZK proofs will hide this data (see PRIVACY_TODO.md)

3. **Batch Execution**
   - Commitment hashes (in calldata)
   - Net swap direction (zeroForOne)
   - Net amounts (netDelta0, netDelta1)
   - Batch size (number of commitments)

4. **Distribution Phase**
   - Recipient hashes (not addresses, but can be brute-forced)
   - Token addresses
   - Individual distribution amounts (visible in `TokensDistributed` events)

## Privacy Validation

The contract includes several validations to ensure privacy guarantees:

1. **Net Delta Validation** (`_validateBatchPrivacy`)
   - Ensures net deltas have opposite signs (valid swap direction)
   - Verifies net deltas correctly represent sum of individual contributions
   - Prevents information leakage through incorrect netting

2. **Swap Direction Validation**
   - Ensures swap direction matches net delta signs
   - Prevents invalid swap attempts that could leak information

3. **Commitment Hash Validation**
   - Verifies commitment hash matches revealed intent
   - Prevents commitment manipulation

4. **Nonce Validation**
   - Ensures each commitment can only be revealed once
   - Prevents replay attacks

## Privacy Comparison

### Current Implementation (Batching Only)

| Information | Commitment Phase | Reveal Phase | Batch Execution | Pool Visibility |
|------------|------------------|-------------|-----------------|-----------------|
| User Address | ❌ Hidden | ⚠️ Visible (in reveal storage) | ❌ Hidden | ❌ Hidden |
| Token Pairs | ❌ Hidden | ⚠️ Visible (in reveal storage) | ❌ Hidden | ❌ Hidden |
| Trade Amounts | ❌ Hidden | ⚠️ Visible (in reveal storage) | ❌ Hidden | ❌ Hidden |
| Recipients | ❌ Hidden | ⚠️ Visible (in reveal storage) | ❌ Hidden | ⚠️ Hash visible |
| Net Swap Direction | N/A | N/A | ✅ Visible | ✅ Visible |
| Net Amounts | N/A | N/A | ✅ Visible | ✅ Visible |

### With ZK Proofs (Future - See PRIVACY_TODO.md)

| Information | Commitment Phase | Reveal Phase | Batch Execution | Pool Visibility |
|------------|------------------|-------------|-----------------|-----------------|
| User Address | ❌ Hidden | ❌ Hidden (in proof) | ❌ Hidden | ❌ Hidden |
| Token Pairs | ❌ Hidden | ❌ Hidden (in proof) | ❌ Hidden | ❌ Hidden |
| Trade Amounts | ❌ Hidden | ❌ Hidden (in proof) | ❌ Hidden | ❌ Hidden |
| Recipients | ❌ Hidden | ❌ Hidden (in proof) | ❌ Hidden | ❌ Hidden |
| Net Swap Direction | N/A | N/A | ✅ Visible | ✅ Visible |
| Net Amounts | N/A | N/A | ✅ Visible | ✅ Visible |

## Privacy Limitations

### Current Limitations

1. **Reveal Storage**: Individual trade details are stored on-chain during reveal phase
   - **Impact**: Medium - Data is visible but cleaned up after execution
   - **Mitigation**: Reveals are deleted after batch execution
   - **Future**: ZK proofs will eliminate this limitation

2. **Recipient Hashes**: Recipient addresses are hashed but can be brute-forced
   - **Impact**: Low - Requires brute force attack
   - **Mitigation**: Use recipient addresses that are not easily guessable
   - **Future**: ZK proofs will hide recipients completely

3. **Distribution Events**: Individual distribution amounts are visible
   - **Impact**: Low - Only visible after batch execution
   - **Mitigation**: Events only show hashes, not addresses
   - **Future**: ZK proofs will hide individual amounts

### Information Leakage Prevention

The contract includes several mechanisms to prevent information leakage:

1. **Netting Validation**: Ensures individual contributions are properly aggregated
2. **Swap Direction Validation**: Prevents invalid swaps that could leak information
3. **Commitment Verification**: Ensures commitments match reveals without exposing data
4. **Cleanup**: Removes reveal data after batch execution

## Best Practices for Privacy

1. **Use Anonymous Commitments**: Don't include user addresses in commitments
2. **Submit Reveals Separately**: Use `submitReveal()` before batch execution to minimize calldata
3. **Use Unique Nonces**: Prevent commitment replay attacks
4. **Clean Up After Execution**: Reveals are automatically cleaned up, but ensure proper execution
5. **Future: Use ZK Proofs**: For maximum privacy, use ZK proofs (see PRIVACY_TODO.md)

## Privacy Guarantees Summary

✅ **Guaranteed Private**:
- Individual trade details during commitment phase
- Individual trade details in batch execution calldata
- Individual trade details visible to the pool
- User addresses in events (replaced with hashes)

⚠️ **Partially Private**:
- Reveal storage (visible but cleaned up)
- Recipient addresses (hashed but brute-forceable)

✅ **Public by Design**:
- Net swap direction (required for execution)
- Net amounts (required for execution)
- Batch size (useful for monitoring)

---

**Last Updated**: 2024-02-08  
**Status**: Current implementation provides batching privacy. ZK proofs planned for full cryptographic privacy (see PRIVACY_TODO.md).
