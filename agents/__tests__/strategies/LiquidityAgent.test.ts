import { LiquidityAgent } from '../../strategies/LiquidityAgent';
import { SwapDirection } from '../../types/interfaces';
import {
  createMockAgentConfig,
  createMockMarketData,
  IMBALANCED_MARKET,
  FLAT_MARKET,
} from '../helpers/fixtures';

describe('LiquidityAgent', () => {
  let agent: LiquidityAgent;

  beforeEach(() => {
    agent = new LiquidityAgent();
  });

  test('name is "liquidity"', () => {
    expect(agent.name).toBe('liquidity');
  });

  // ─── Imbalance detection ─────────────────────────────

  test('detects liquidity imbalance and trades into it', async () => {
    const config = createMockAgentConfig({
      strategy: {
        name: 'liquidity',
        config: {
          imbalanceThreshold: 1.5,
          tradeIntoImbalance: true,
        },
      },
    });
    // liquidity0 = 800, liquidity1 = 200 → ratio 4.0 → heavy imbalance
    const decision = await agent.shouldTrade(IMBALANCED_MARKET, config);
    expect(decision.shouldTrade).toBe(true);
    expect(decision.confidence).toBeGreaterThan(0);
  });

  // ─── Balanced pool ───────────────────────────────────

  test('does not trade in a balanced pool', async () => {
    const config = createMockAgentConfig({
      strategy: {
        name: 'liquidity',
        config: { imbalanceThreshold: 1.5 },
      },
    });
    // FLAT_MARKET has equal liquidity (500 / 500)
    const decision = await agent.shouldTrade(FLAT_MARKET, config);
    expect(decision.shouldTrade).toBe(false);
  });

  // ─── Low liquidity detection ─────────────────────────

  test('does not trade when pool liquidity is below minimum', async () => {
    const lowLiquidityMarket = createMockMarketData({
      totalLiquidity: '100',
      liquidity0: '50',
      liquidity1: '50',
    });
    const config = createMockAgentConfig({
      strategy: {
        name: 'liquidity',
        config: {
          imbalanceThreshold: 1.5,
          minTotalLiquidity: '1000',
        },
      },
    });
    const decision = await agent.shouldTrade(lowLiquidityMarket, config);
    expect(decision.shouldTrade).toBe(false);
  });

  // ─── Direction for imbalance ─────────────────────────

  test('buys the scarcer token when tradeIntoImbalance is true', async () => {
    // liquidity0 = 800, liquidity1 = 200 → token1 is scarcer → buy token1 → ZERO_FOR_ONE
    const config = createMockAgentConfig({
      strategy: {
        name: 'liquidity',
        config: {
          imbalanceThreshold: 1.5,
          tradeIntoImbalance: true,
        },
      },
    });
    const decision = await agent.shouldTrade(IMBALANCED_MARKET, config);
    if (decision.shouldTrade) {
      expect(decision.direction).toBe(SwapDirection.ZERO_FOR_ONE);
    }
  });

  // ─── Cooldown ────────────────────────────────────────

  test('respects cooldown', async () => {
    const config = createMockAgentConfig({
      strategy: {
        name: 'liquidity',
        config: {
          imbalanceThreshold: 1.5,
          cooldownPeriod: 600,
        },
      },
    });
    const first = await agent.shouldTrade(IMBALANCED_MARKET, config);
    expect(first.shouldTrade).toBe(true);

    const second = await agent.shouldTrade(IMBALANCED_MARKET, config);
    expect(second.shouldTrade).toBe(false);
  });

  // ─── Volume to liquidity ratio ───────────────────────

  test('detects high volume-to-liquidity ratio', async () => {
    const highVTLMarket = createMockMarketData({
      totalLiquidity: '1000000000000000000000',
      liquidity0: '800000000000000000000',
      liquidity1: '200000000000000000000',
      volume1h: '500000000000000000000', // 50% of liquidity
    });
    const config = createMockAgentConfig({
      strategy: {
        name: 'liquidity',
        config: {
          imbalanceThreshold: 1.5,
          volumeToLiquidityThreshold: 0.1,
        },
      },
    });
    const decision = await agent.shouldTrade(highVTLMarket, config);
    expect(decision.shouldTrade).toBe(true);
  });
});
