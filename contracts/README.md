# PrivBatchHook - Private Autonomous Batch Swaps on Uniswap v4

**PrivBatch** enables private batch swaps through a commit-reveal mechanism. Users submit hashed swap intents, and batches are executed permissionlessly when conditions are met.

## Features

- 🔒 **Privacy**: Trade details hidden until batch execution
- 🛡️ **MEV Protection**: Reduced front-running and sandwich attack exposure
- ⚡ **Permissionless**: No paid automation services needed
- 🎯 **Fair Execution**: Better slippage through batch netting
- ✅ **Fully Tested**: Comprehensive test suite included

## Quick Start

### Build

```bash
forge build
```

### Test

```bash
forge test -vv
```

### Deploy

```bash
forge script script/DeployPrivBatchHook.s.sol:DeployPrivBatchHook \
    --rpc-url $BASE_SEPOLIA_RPC_URL \
    --broadcast \
    --verify
```

### Monitor & Execute

```bash
# Check if batch can execute
forge script script/MonitorAndExecute.s.sol:MonitorAndExecute \
    --rpc-url $BASE_SEPOLIA_RPC_URL

# Execute batch (after collecting reveals)
forge script script/ExecuteBatch.s.sol:ExecuteBatch \
    --rpc-url $BASE_SEPOLIA_RPC_URL \
    --broadcast
```

## Documentation

- **Hackathon Demo Guide**: See `HACKATHON_DEMO.md` for demo setup
- **Token Flow Architecture**: See `TOKEN_FLOW_ARCHITECTURE.md` for technical details
- **Project Requirements**: See `prd.md` for full specification
- **Implementation Checklist**: See `TODO.md` for progress tracking

## How It Works

1. **Commit**: Users submit commitment hashes (trade details hidden)
2. **Wait**: System waits for minimum commitments + batch interval
3. **Reveal & Execute**: Anyone can trigger batch execution with reveals
4. **Distribute**: Output tokens distributed proportionally to recipients

## Permissionless Execution

No paid automation services required! Batch execution is permissionless:
- ✅ Anyone can call `revealAndBatchExecute()` when conditions are met
- ✅ Use simple monitoring scripts for automation
- ✅ Perfect for hackathon demos

## Project Structure

```
privbatch/
├── src/
│   └── PrivBatchHook.sol      # Main hook contract
├── test/
│   └── PrivBatchHook.t.sol    # Test suite
├── script/
│   ├── DeployPrivBatchHook.s.sol
│   ├── MonitorAndExecute.s.sol
│   └── ExecuteBatch.s.sol
└── utils/
    └── CommitmentHelper.s.sol
```

## Foundry Commands

```bash
# Build
forge build

# Test
forge test -vv

# Format
forge fmt

# Deploy
forge script script/DeployPrivBatchHook.s.sol --broadcast --verify
```

## License

MIT
