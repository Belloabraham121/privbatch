import { ArbitrageAgent, ReferencePrice } from '../../strategies/ArbitrageAgent';
import { SwapDirection } from '../../types/interfaces';
import {
  createMockAgentConfig,
  createMockMarketData,
  FLAT_MARKET,
} from '../helpers/fixtures';

describe('ArbitrageAgent', () => {
  let agent: ArbitrageAgent;

  beforeEach(() => {
    agent = new ArbitrageAgent();
  });

  test('name is "arbitrage"', () => {
    expect(agent.name).toBe('arbitrage');
  });

  // ─── Arbitrage opportunity detected ──────────────────

  test('detects arbitrage when pool price is below reference price', async () => {
    // Pool = 1.0, Oracle = 1.05 → 5% spread (within default 0.3-10% range)
    const refs: ReferencePrice[] = [
      { source: 'oracle', price: '1.05', timestamp: Date.now(), confidence: 0.9 },
    ];
    const config = createMockAgentConfig({
      strategy: {
        name: 'arbitrage',
        config: {
          referencePrices: refs,
          minSpreadThreshold: 0.3,
          maxSpreadThreshold: 10.0,
        },
      },
    });
    const decision = await agent.shouldTrade(FLAT_MARKET, config);
    expect(decision.shouldTrade).toBe(true);
    expect(decision.confidence).toBeGreaterThan(0);
  });

  // ─── No opportunity ──────────────────────────────────

  test('does not trade when prices are aligned', async () => {
    const refs: ReferencePrice[] = [
      { source: 'oracle', price: '1.0', timestamp: Date.now(), confidence: 0.9 },
    ];
    const config = createMockAgentConfig({
      strategy: {
        name: 'arbitrage',
        config: {
          referencePrices: refs,
          minSpreadThreshold: 0.3,
        },
      },
    });
    const decision = await agent.shouldTrade(FLAT_MARKET, config);
    expect(decision.shouldTrade).toBe(false);
  });

  // ─── No reference prices → no trade ──────────────────

  test('does not trade when no reference prices are configured', async () => {
    const config = createMockAgentConfig({
      strategy: {
        name: 'arbitrage',
        config: { referencePrices: [] },
      },
    });
    const decision = await agent.shouldTrade(FLAT_MARKET, config);
    expect(decision.shouldTrade).toBe(false);
  });

  // ─── Spread too suspicious (outside max) ─────────────

  test('rejects spreads above maxSpreadThreshold', async () => {
    const refs: ReferencePrice[] = [
      { source: 'oracle', price: '10.0', timestamp: Date.now(), confidence: 0.9 },
    ];
    const config = createMockAgentConfig({
      strategy: {
        name: 'arbitrage',
        config: {
          referencePrices: refs,
          minSpreadThreshold: 0.3,
          maxSpreadThreshold: 10.0,
        },
      },
    });
    // Pool price 1.0, oracle says 10.0 → 900% spread → exceeds 10% max
    const market = createMockMarketData({ currentPrice: '1.0' });
    const decision = await agent.shouldTrade(market, config);
    expect(decision.shouldTrade).toBe(false);
  });

  // ─── Direction is correct ────────────────────────────

  test('buys token0 when pool price is below reference (pool underpriced)', async () => {
    // Pool: 1.0, Oracle: 1.08 → spread > 0 → ONE_FOR_ZERO (buy token0)
    const refs: ReferencePrice[] = [
      { source: 'oracle', price: '1.08', timestamp: Date.now(), confidence: 0.9 },
    ];
    const config = createMockAgentConfig({
      strategy: {
        name: 'arbitrage',
        config: { referencePrices: refs, minSpreadThreshold: 0.3, maxSpreadThreshold: 20 },
      },
    });
    const market = createMockMarketData({ currentPrice: '1.0' });
    const decision = await agent.shouldTrade(market, config);
    expect(decision.shouldTrade).toBe(true);
    expect(decision.direction).toBe(SwapDirection.ONE_FOR_ZERO);
  });

  test('sells token0 when pool price is above reference (pool overpriced)', async () => {
    // Pool: 1.08, Oracle: 1.0 → spread < 0 → ZERO_FOR_ONE (sell token0)
    const refs: ReferencePrice[] = [
      { source: 'oracle', price: '1.0', timestamp: Date.now(), confidence: 0.9 },
    ];
    const config = createMockAgentConfig({
      strategy: {
        name: 'arbitrage',
        config: { referencePrices: refs, minSpreadThreshold: 0.3, maxSpreadThreshold: 20 },
      },
    });
    const market = createMockMarketData({ currentPrice: '1.08' });
    const decision = await agent.shouldTrade(market, config);
    expect(decision.shouldTrade).toBe(true);
    expect(decision.direction).toBe(SwapDirection.ZERO_FOR_ONE);
  });

  // ─── Cooldown ────────────────────────────────────────

  test('respects cooldown between arbitrage trades', async () => {
    const refs: ReferencePrice[] = [
      { source: 'oracle', price: '1.05', timestamp: Date.now(), confidence: 0.9 },
    ];
    const config = createMockAgentConfig({
      strategy: {
        name: 'arbitrage',
        config: {
          referencePrices: refs,
          minSpreadThreshold: 0.3,
          maxSpreadThreshold: 20,
          cooldownPeriod: 300,
        },
      },
    });
    const first = await agent.shouldTrade(FLAT_MARKET, config);
    expect(first.shouldTrade).toBe(true);

    const second = await agent.shouldTrade(FLAT_MARKET, config);
    expect(second.shouldTrade).toBe(false);
  });
});
