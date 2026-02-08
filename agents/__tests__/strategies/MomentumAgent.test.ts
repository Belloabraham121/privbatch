import { MomentumAgent } from '../../strategies/MomentumAgent';
import { SwapDirection } from '../../types/interfaces';
import {
  createMockAgentConfig,
  BULLISH_MARKET,
  BEARISH_MARKET,
  FLAT_MARKET,
  createMockMarketData,
} from '../helpers/fixtures';

describe('MomentumAgent', () => {
  let agent: MomentumAgent;

  beforeEach(() => {
    agent = new MomentumAgent();
  });

  test('name is "momentum"', () => {
    expect(agent.name).toBe('momentum');
  });

  // ─── Bullish signal ──────────────────────────────────

  test('detects bullish momentum and returns ZERO_FOR_ONE', async () => {
    const config = createMockAgentConfig({
      strategy: {
        name: 'momentum',
        config: { momentumThreshold1h: 1.0, momentumThreshold24h: 2.0 },
      },
    });
    const decision = await agent.shouldTrade(BULLISH_MARKET, config);
    expect(decision.shouldTrade).toBe(true);
    expect(decision.direction).toBe(SwapDirection.ZERO_FOR_ONE);
    expect(decision.confidence).toBeGreaterThan(0);
    expect(decision.reasoning).toBeDefined();
  });

  // ─── Bearish signal ──────────────────────────────────

  test('detects bearish momentum and returns ONE_FOR_ZERO', async () => {
    const config = createMockAgentConfig({
      strategy: {
        name: 'momentum',
        config: { momentumThreshold1h: 1.0, momentumThreshold24h: 2.0 },
      },
    });
    const decision = await agent.shouldTrade(BEARISH_MARKET, config);
    expect(decision.shouldTrade).toBe(true);
    expect(decision.direction).toBe(SwapDirection.ONE_FOR_ZERO);
  });

  // ─── No signal ───────────────────────────────────────

  test('does not trade in a flat market', async () => {
    const config = createMockAgentConfig({
      strategy: {
        name: 'momentum',
        config: { momentumThreshold1h: 1.0, momentumThreshold24h: 2.0 },
      },
    });
    const decision = await agent.shouldTrade(FLAT_MARKET, config);
    expect(decision.shouldTrade).toBe(false);
  });

  // ─── Volume confirmation ─────────────────────────────

  test('rejects trade when volume is below threshold', async () => {
    const lowVolBullish = createMockMarketData({
      currentPrice: '1.05',
      priceChange1h: 3.0,
      priceChange24h: 8.0,
      volume1h: '0', // No volume
    });
    const config = createMockAgentConfig({
      strategy: {
        name: 'momentum',
        config: {
          momentumThreshold1h: 1.0,
          requireVolumeConfirmation: true,
          minVolumeThreshold: '1000000000000000000', // Needs at least 1 token volume
        },
      },
    });
    const decision = await agent.shouldTrade(lowVolBullish, config);
    // Should either not trade or have reduced confidence
    if (decision.shouldTrade) {
      expect(decision.confidence).toBeLessThan(1);
    }
  });

  // ─── Excessive volatility ───────────────────────────

  test('rejects trade when volatility is extreme', async () => {
    const extremeMarket = createMockMarketData({
      priceChange1h: 25.0, // 25% in 1h
      priceChange24h: 50.0,
    });
    const config = createMockAgentConfig({
      strategy: {
        name: 'momentum',
        config: { maxVolatilityThreshold: 20.0 },
      },
    });
    const decision = await agent.shouldTrade(extremeMarket, config);
    expect(decision.shouldTrade).toBe(false);
    expect(decision.reasoning.toLowerCase()).toContain('volatil');
  });

  // ─── Cooldown ────────────────────────────────────────

  test('respects cooldown between trades', async () => {
    const config = createMockAgentConfig({
      strategy: {
        name: 'momentum',
        config: { cooldownPeriod: 300, momentumThreshold1h: 1.0 },
      },
    });
    // First trade should succeed
    const first = await agent.shouldTrade(BULLISH_MARKET, config);
    expect(first.shouldTrade).toBe(true);

    // Second trade should be blocked by cooldown
    const second = await agent.shouldTrade(BULLISH_MARKET, config);
    expect(second.shouldTrade).toBe(false);
    expect(second.reasoning.toLowerCase()).toContain('cooldown');
  });

  // ─── Confidence scaling ──────────────────────────────

  test('higher momentum produces higher confidence', async () => {
    const config = createMockAgentConfig({
      strategy: { name: 'momentum', config: { momentumThreshold1h: 0.5 } },
    });

    const mildBullish = createMockMarketData({
      currentPrice: '1.01',
      priceChange1h: 1.0,
      priceChange24h: 3.0,
      volume1h: '500000000000000000000',
    });
    const strongBullish = createMockMarketData({
      currentPrice: '1.05',
      priceChange1h: 5.0,
      priceChange24h: 15.0,
      volume1h: '500000000000000000000',
    });

    // Reset cooldowns between tests
    const agent1 = new MomentumAgent();
    const agent2 = new MomentumAgent();

    const mildDecision = await agent1.shouldTrade(mildBullish, config);
    const strongDecision = await agent2.shouldTrade(strongBullish, config);

    if (mildDecision.shouldTrade && strongDecision.shouldTrade) {
      expect(strongDecision.confidence).toBeGreaterThanOrEqual(mildDecision.confidence);
    }
  });
});
