/**
 * Shared test fixtures & mock factories
 */

import {
  PoolKey,
  MarketData,
  AgentConfig,
  SwapDirection,
  SwapIntent,
  CommitmentData,
  AgentStatus,
} from '../../types/interfaces';

// ─── Addresses ────────────────────────────────────────────────

export const MOCK_ADDRESSES = {
  token0: '0x0000000000000000000000000000000000000001',
  token1: '0x0000000000000000000000000000000000000002',
  hook: '0x0000000000000000000000000000000000000080',
  poolManager: '0x0000000000000000000000000000000000000099',
  user: '0x0000000000000000000000000000000000000AAA',
  recipient: '0x0000000000000000000000000000000000000BBB',
};

export const MOCK_POOL_ID = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

// ─── Pool Key ─────────────────────────────────────────────────

export function createMockPoolKey(overrides: Partial<PoolKey> = {}): PoolKey {
  return {
    currency0: MOCK_ADDRESSES.token0,
    currency1: MOCK_ADDRESSES.token1,
    fee: 3000,
    tickSpacing: 60,
    hooks: MOCK_ADDRESSES.hook,
    ...overrides,
  };
}

// ─── Market Data ──────────────────────────────────────────────

export function createMockMarketData(
  overrides: Partial<MarketData> = {}
): MarketData {
  return {
    poolId: MOCK_POOL_ID,
    poolKey: createMockPoolKey(),
    currentPrice: '1.0',
    priceChange1h: 0,
    priceChange24h: 0,
    totalLiquidity: '1000000000000000000000', // 1000 tokens
    liquidity0: '500000000000000000000',
    liquidity1: '500000000000000000000',
    volume1h: '100000000000000000000', // 100 tokens
    volume24h: '1000000000000000000000', // 1000 tokens
    recentSwaps: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Agent Config ─────────────────────────────────────────────

export function createMockAgentConfig(
  overrides: Partial<AgentConfig> = {}
): AgentConfig {
  return {
    agentId: 'test-agent-1',
    wallet: {
      address: MOCK_ADDRESSES.user,
      privateKey: '0x' + 'a'.repeat(64),
    },
    strategy: {
      name: 'momentum',
      config: {},
    },
    pools: [createMockPoolKey()],
    hookAddress: MOCK_ADDRESSES.hook,
    poolManagerAddress: MOCK_ADDRESSES.poolManager,
    rpcUrl: 'http://localhost:8545',
    chainId: 84532,
    commitmentSettings: {
      defaultDeadlineOffset: 3600,
      minCommitments: 2,
      batchInterval: 300,
    },
    monitoringSettings: {
      pollInterval: 30000,
      maxRetries: 3,
      retryDelay: 5000,
    },
    tradingSettings: {
      maxAmountIn: '10000000000000000000', // 10 tokens
      minAmountIn: '1000000000000000000',   // 1 token
      defaultSlippageBps: 50,
    },
    ...overrides,
  };
}

// ─── Swap Intent ──────────────────────────────────────────────

export function createMockSwapIntent(
  overrides: Partial<SwapIntent> = {}
): SwapIntent {
  return {
    user: MOCK_ADDRESSES.user,
    tokenIn: MOCK_ADDRESSES.token0,
    tokenOut: MOCK_ADDRESSES.token1,
    amountIn: '1000000000000000000', // 1 token
    minAmountOut: '900000000000000000', // 0.9 token
    recipient: MOCK_ADDRESSES.recipient,
    nonce: 1,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

// ─── Commitment Data ──────────────────────────────────────────

export function createMockCommitmentData(
  overrides: Partial<CommitmentData> = {}
): CommitmentData {
  return {
    commitmentHash: '0x' + 'ab'.repeat(32),
    swapIntent: createMockSwapIntent(),
    poolId: MOCK_POOL_ID,
    submittedAt: Date.now(),
    revealed: false,
    ...overrides,
  };
}

// ─── Market Data Scenarios ────────────────────────────────────

/** Strong upward momentum */
export const BULLISH_MARKET = createMockMarketData({
  currentPrice: '1.05',
  priceChange1h: 3.0,
  priceChange24h: 8.0,
  volume1h: '500000000000000000000', // 500 tokens — high vol
  recentSwaps: [
    { poolId: MOCK_POOL_ID, timestamp: Date.now() - 60000, amount0: '-100', amount1: '105', zeroForOne: true, sqrtPriceX96: '0' },
    { poolId: MOCK_POOL_ID, timestamp: Date.now() - 120000, amount0: '-50', amount1: '52', zeroForOne: true, sqrtPriceX96: '0' },
  ],
});

/** Strong downward momentum */
export const BEARISH_MARKET = createMockMarketData({
  currentPrice: '0.95',
  priceChange1h: -3.0,
  priceChange24h: -8.0,
  volume1h: '500000000000000000000',
  recentSwaps: [
    { poolId: MOCK_POOL_ID, timestamp: Date.now() - 60000, amount0: '100', amount1: '-95', zeroForOne: false, sqrtPriceX96: '0' },
  ],
});

/** Flat / sideways market */
export const FLAT_MARKET = createMockMarketData({
  currentPrice: '1.0',
  priceChange1h: 0.05,
  priceChange24h: 0.1,
  volume1h: '10000000000000000000', // 10 tokens — low vol
});

/** Imbalanced liquidity */
export const IMBALANCED_MARKET = createMockMarketData({
  totalLiquidity: '1000000000000000000000',
  liquidity0: '800000000000000000000',
  liquidity1: '200000000000000000000',
  currentPrice: '0.95',
});

/** Stale market data */
export const STALE_MARKET = createMockMarketData({
  timestamp: Date.now() - 10 * 60 * 1000, // 10 minutes ago
});
