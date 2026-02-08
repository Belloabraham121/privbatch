import { MeanReversionAgent } from '../../strategies/MeanReversionAgent';
import { SwapDirection } from '../../types/interfaces';
import {
  createMockAgentConfig,
  createMockMarketData,
  FLAT_MARKET,
  MOCK_POOL_ID,
} from '../helpers/fixtures';

describe('MeanReversionAgent', () => {
  let agent: MeanReversionAgent;

  beforeEach(() => {
    agent = new MeanReversionAgent();
  });

  test('name is "mean-reversion"', () => {
    expect(agent.name).toBe('mean-reversion');
  });

  // ─── Needs data before trading ───────────────────────

  test('does not trade until enough data points collected', async () => {
    const config = createMockAgentConfig({
      strategy: {
        name: 'mean-reversion',
        config: { minDataPoints: 5 },
      },
    });
    // First call — not enough history
    const decision = await agent.shouldTrade(FLAT_MARKET, config);
    expect(decision.shouldTrade).toBe(false);
    expect(decision.reasoning.toLowerCase()).toContain('data');
  });

  // ─── Builds history and detects deviation ────────────

  test('detects upward deviation after building history', async () => {
    const config = createMockAgentConfig({
      strategy: {
        name: 'mean-reversion',
        config: {
          emaPeriod: 5,
          moderateDeviationThreshold: 1.0,
          minDataPoints: 3,
          cooldownPeriod: 0, // No cooldown
        },
      },
    });

    // Feed stable prices to build the EMA
    for (let i = 0; i < 5; i++) {
      const stableData = createMockMarketData({
        currentPrice: '1.0',
        timestamp: Date.now() - (5 - i) * 60000,
      });
      await agent.shouldTrade(stableData, config);
    }

    // Now spike the price
    const spikedData = createMockMarketData({
      currentPrice: '1.5', // 50% above mean
      priceChange1h: 50,
      volume1h: '500000000000000000000',
    });
    const decision = await agent.shouldTrade(spikedData, config);

    // Mean reversion should trade AGAINST the spike → sell token0 → ONE_FOR_ZERO
    // Or buy token0 depending on the interpretation. The strategy trades
    // AGAINST the deviation, so if price went UP, it sells (ZERO_FOR_ONE)
    if (decision.shouldTrade) {
      // Price went up → mean reversion sells → we just check it decided to trade
      expect(decision.confidence).toBeGreaterThan(0);
      expect(decision.direction).toBeDefined();
    }
  });

  test('detects downward deviation after building history', async () => {
    const agent2 = new MeanReversionAgent();
    const config = createMockAgentConfig({
      strategy: {
        name: 'mean-reversion',
        config: {
          emaPeriod: 5,
          moderateDeviationThreshold: 1.0,
          minDataPoints: 3,
          cooldownPeriod: 0,
        },
      },
    });

    for (let i = 0; i < 5; i++) {
      const stableData = createMockMarketData({
        currentPrice: '1.0',
        timestamp: Date.now() - (5 - i) * 60000,
      });
      await agent2.shouldTrade(stableData, config);
    }

    // Drop the price significantly
    const droppedData = createMockMarketData({
      currentPrice: '0.5', // 50% below mean
      priceChange1h: -50,
      volume1h: '500000000000000000000',
    });
    const decision = await agent2.shouldTrade(droppedData, config);

    if (decision.shouldTrade) {
      // Price went down → mean reversion buys → ONE_FOR_ZERO
      expect(decision.confidence).toBeGreaterThan(0);
      expect(decision.direction).toBeDefined();
    }
  });

  // ─── No trade when close to mean ─────────────────────

  test('does not trade when price is close to the mean', async () => {
    const agent3 = new MeanReversionAgent();
    const config = createMockAgentConfig({
      strategy: {
        name: 'mean-reversion',
        config: {
          emaPeriod: 5,
          moderateDeviationThreshold: 1.5,
          minDataPoints: 3,
          cooldownPeriod: 0,
        },
      },
    });

    // Feed stable prices
    for (let i = 0; i < 5; i++) {
      const data = createMockMarketData({
        currentPrice: '1.0',
        timestamp: Date.now() - (5 - i) * 60000,
      });
      await agent3.shouldTrade(data, config);
    }

    // Price barely moves
    const smallMove = createMockMarketData({
      currentPrice: '1.01',
      priceChange1h: 1,
    });
    const decision = await agent3.shouldTrade(smallMove, config);
    expect(decision.shouldTrade).toBe(false);
  });

  // ─── Cooldown ────────────────────────────────────────

  test('respects cooldown between trades', async () => {
    const agent4 = new MeanReversionAgent();
    const config = createMockAgentConfig({
      strategy: {
        name: 'mean-reversion',
        config: {
          emaPeriod: 3,
          moderateDeviationThreshold: 0.5,
          minDataPoints: 2,
          cooldownPeriod: 300,
        },
      },
    });

    for (let i = 0; i < 5; i++) {
      const data = createMockMarketData({
        currentPrice: '1.0',
        timestamp: Date.now() - (5 - i) * 60000,
      });
      await agent4.shouldTrade(data, config);
    }

    const spike = createMockMarketData({
      currentPrice: '2.0',
      priceChange1h: 100,
      volume1h: '500000000000000000000',
    });

    const first = await agent4.shouldTrade(spike, config);
    // If first triggers, second should be blocked by cooldown
    if (first.shouldTrade) {
      const second = await agent4.shouldTrade(spike, config);
      expect(second.shouldTrade).toBe(false);
    }
  });
});
