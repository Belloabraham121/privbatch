# Agents - Agentic Finance Component

This directory contains the implementation of autonomous trading agents that interact with PrivBatchHook.

## Overview

The agents component implements programmatic trading bots that:
- Monitor Uniswap v4 pools autonomously
- Make algorithmic trading decisions
- Commit trades privately via PrivBatchHook
- Coordinate batch execution with other agents
- Adapt strategies based on market conditions

## Project Structure

```
agents/
├── types/               # Type definitions and interfaces
│   ├── interfaces.ts    # Core interfaces (AgentConfig, TradingStrategy, MarketData, TradeDecision)
│   └── index.ts         # Type exports
├── strategies/          # Trading strategy implementations
│   ├── TradingAgent.ts  # Core agent class (✅ Implemented)
│   ├── BaseStrategy.ts  # Base strategy template (✅ Implemented)
│   ├── MomentumAgent.ts # Momentum strategy (to be implemented)
│   ├── ArbitrageAgent.ts # Arbitrage strategy (to be implemented)
│   └── LiquidityAgent.ts # Liquidity strategy (to be implemented)
├── utils/               # Utility functions
│   ├── marketData.ts    # Market data fetching (to be implemented)
│   └── poolMonitor.ts   # Pool monitoring (to be implemented)
├── config/              # Configuration files
│   └── agentConfig.ts   # Agent configurations (to be implemented)
├── AgentManager.ts      # Agent orchestration (to be implemented)
├── index.ts             # Main entry point
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript configuration
└── README.md            # This file
```

## Implementation Status

### ✅ Completed
- **Core Architecture**: Agent interfaces and base classes
  - `TradingAgent` base class with monitoring, commitment submission, and lifecycle management
  - `TradingStrategy` interface for strategy implementations
  - `BaseStrategy` template class
  - Type definitions: `AgentConfig`, `MarketData`, `TradeDecision`, `SwapIntent`, etc.
  - TypeScript configuration and project setup

### 🚧 In Progress / To Do
- Market data fetching utilities
- Pool monitoring utilities
- Strategy implementations (Momentum, Arbitrage, Liquidity)
- Agent manager/orchestrator
- Configuration system
- Integration with PrivBatchHook

See [`../AGENTIC_TODO.md`](../AGENTIC_TODO.md) for detailed implementation checklist.

## Quick Start

1. Install dependencies:
```bash
cd agents
npm install
```

2. Build the project:
```bash
npm run build
```

3. Configure agents (when config system is implemented):
```bash
cp config/agentConfig.example.ts config/agentConfig.ts
# Edit agentConfig.ts with your settings
```

4. Start agents (when implementation is complete):
```bash
npm start
# or for development
npm run dev
```

## Core Architecture

### TradingAgent
The `TradingAgent` class is the base class for all trading agents. It provides:
- Pool monitoring loop
- Commitment submission to PrivBatchHook
- Nonce management
- Lifecycle management (start, stop, pause, resume)
- Metrics tracking

### TradingStrategy Interface
All trading strategies must implement the `TradingStrategy` interface:
- `shouldTrade()`: Evaluate market data and decide whether to trade
- `calculateAmount()`: Calculate trade amount based on market conditions
- `calculateMinAmountOut()`: Calculate minimum output for slippage protection

### BaseStrategy
A template class that provides default implementations for common strategy operations. Extend this class to create custom strategies.

## Agent Types

### Momentum Agent
Trades based on price momentum (trend following).

### Arbitrage Agent
Detects and executes arbitrage opportunities across pools.

### Liquidity Agent
Trades when liquidity conditions are favorable.

## Development

See [`../AGENTIC_TODO.md`](../AGENTIC_TODO.md) for implementation tasks.

## Documentation

- [Agent Architecture](../docs/AGENT_ARCHITECTURE.md) - Coming soon
- [Strategy Guide](../docs/STRATEGY_GUIDE.md) - Coming soon
- [Configuration Guide](../docs/CONFIG_GUIDE.md) - Coming soon
