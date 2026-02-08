/**
 * Main entry point for the agents module
 */

// Core
export { TradingAgent } from './TradingAgent';
export { AgentManager } from './AgentManager';
export type { AgentRegistration, BatchExecutionState } from './AgentManager';

// Strategies
export { BaseStrategy } from './strategies/BaseStrategy';
export type { MarketDataValidation } from './strategies/BaseStrategy';
export { MomentumAgent } from './strategies/MomentumAgent';
export type { MomentumConfig } from './strategies/MomentumAgent';
export { ArbitrageAgent } from './strategies/ArbitrageAgent';
export type { ArbitrageConfig, ReferencePrice } from './strategies/ArbitrageAgent';
export { LiquidityAgent } from './strategies/LiquidityAgent';
export type { LiquidityConfig } from './strategies/LiquidityAgent';
export { MeanReversionAgent } from './strategies/MeanReversionAgent';
export type { MeanReversionConfig } from './strategies/MeanReversionAgent';

// Types
export * from './types';

// Utilities
export { MarketDataFetcher, createMarketDataFetcher } from './utils/marketData';
export { PoolMonitor, createPoolMonitor } from './utils/poolMonitor';
