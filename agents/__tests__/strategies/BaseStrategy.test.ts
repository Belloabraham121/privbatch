import { BaseStrategy, MarketDataValidation } from '../../strategies/BaseStrategy';
import {
  MarketData,
  TradeDecision,
  AgentConfig,
  SwapDirection,
} from '../../types/interfaces';
import {
  createMockMarketData,
  createMockAgentConfig,
  STALE_MARKET,
} from '../helpers/fixtures';

// Concrete subclass to test BaseStrategy helpers
class TestStrategy extends BaseStrategy {
  name = 'test';

  async shouldTrade(
    _marketData: MarketData,
    _config: AgentConfig
  ): Promise<TradeDecision> {
    return this.noTradeDecision('Test strategy — always no trade');
  }

  // Expose protected members for testing
  public testNoTradeDecision(r: string) { return this.noTradeDecision(r); }
  public testIsCooldownActive(poolId: string, ms: number) { return this.isCooldownActive(poolId, ms); }
  public testRecordTrade(poolId: string) { this.recordTrade(poolId); }
  public testScaleAmount(f: number, c: AgentConfig) { return this.scaleAmount(f, c); }
  public testClampAmount(a: bigint, c: AgentConfig) { return this.clampAmount(a, c); }
  public testMergeConfig<T extends Record<string, unknown>>(d: T, c: AgentConfig) { return this.mergeConfig(d, c); }
  public testValidateMarketData(d: MarketData) { return this.validateMarketData(d); }
  public testBuildTradeDecision(dir: SwapDirection, amt: string, min: string, conf: number, reason: string) { return this.buildTradeDecision(dir, amt, min, conf, reason); }
  public testFormatDirection(d: SwapDirection) { return this.formatDirection(d); }
  public testCalculateVolumeToLiquidityRatio(d: MarketData) { return this.calculateVolumeToLiquidityRatio(d); }
  public testGetDirectionFromPriceChange(c: number) { return this.getDirectionFromPriceChange(c); }
  public testCalculateConfidence(c: number) { return this.calculateConfidence(c); }
}

describe('BaseStrategy', () => {
  let strategy: TestStrategy;
  let config: AgentConfig;

  beforeEach(() => {
    strategy = new TestStrategy();
    config = createMockAgentConfig();
  });

  // ─── noTradeDecision ─────────────────────────────────

  test('noTradeDecision returns shouldTrade false with reasoning', () => {
    const decision = strategy.testNoTradeDecision('Not ready');
    expect(decision.shouldTrade).toBe(false);
    expect(decision.confidence).toBe(0);
    expect(decision.reasoning).toBe('Not ready');
    expect(decision.timestamp).toBeDefined();
  });

  // ─── Cooldown ────────────────────────────────────────

  test('isCooldownActive returns false when no trade recorded', () => {
    expect(strategy.testIsCooldownActive('pool-1', 60000)).toBe(false);
  });

  test('isCooldownActive returns true right after recording a trade', () => {
    strategy.testRecordTrade('pool-1');
    expect(strategy.testIsCooldownActive('pool-1', 60000)).toBe(true);
  });

  test('isCooldownActive returns false after cooldown elapses', () => {
    strategy.testRecordTrade('pool-1');
    // Hack: override the timestamp
    (strategy as any).lastTradeTimestamp.set('pool-1', Date.now() - 70000);
    expect(strategy.testIsCooldownActive('pool-1', 60000)).toBe(false);
  });

  test('cooldowns are independent per pool', () => {
    strategy.testRecordTrade('pool-A');
    expect(strategy.testIsCooldownActive('pool-A', 60000)).toBe(true);
    expect(strategy.testIsCooldownActive('pool-B', 60000)).toBe(false);
  });

  // ─── scaleAmount ─────────────────────────────────────

  test('scaleAmount at factor=0 returns minAmountIn', () => {
    const result = strategy.testScaleAmount(0, config);
    expect(result).toBe(config.tradingSettings.minAmountIn);
  });

  test('scaleAmount at factor=1 returns maxAmountIn', () => {
    const result = strategy.testScaleAmount(1, config);
    expect(result).toBe(config.tradingSettings.maxAmountIn);
  });

  test('scaleAmount at factor=0.5 returns midpoint', () => {
    const result = strategy.testScaleAmount(0.5, config);
    const min = BigInt(config.tradingSettings.minAmountIn);
    const max = BigInt(config.tradingSettings.maxAmountIn);
    const expected = min + (max - min) * BigInt(50) / BigInt(100);
    expect(result).toBe(expected.toString());
  });

  test('scaleAmount clamps factor below 0', () => {
    const result = strategy.testScaleAmount(-1, config);
    expect(result).toBe(config.tradingSettings.minAmountIn);
  });

  test('scaleAmount clamps factor above 1', () => {
    const result = strategy.testScaleAmount(2, config);
    expect(result).toBe(config.tradingSettings.maxAmountIn);
  });

  // ─── clampAmount ─────────────────────────────────────

  test('clampAmount returns min when below', () => {
    const result = strategy.testClampAmount(BigInt(0), config);
    expect(result).toBe(BigInt(config.tradingSettings.minAmountIn));
  });

  test('clampAmount returns max when above', () => {
    const result = strategy.testClampAmount(BigInt('999999999999999999999'), config);
    expect(result).toBe(BigInt(config.tradingSettings.maxAmountIn));
  });

  test('clampAmount passes through when in range', () => {
    const mid = BigInt('5000000000000000000');
    expect(strategy.testClampAmount(mid, config)).toBe(mid);
  });

  // ─── mergeConfig ─────────────────────────────────────

  test('mergeConfig overrides defaults with strategy config', () => {
    const defaults = { a: 1, b: 'hello', c: true };
    const cfg = createMockAgentConfig({
      strategy: { name: 'test', config: { b: 'world' } },
    });
    const result = strategy.testMergeConfig(defaults, cfg);
    expect(result).toEqual({ a: 1, b: 'world', c: true });
  });

  // ─── validateMarketData ──────────────────────────────

  test('valid market data passes validation', () => {
    const data = createMockMarketData();
    const result = strategy.testValidateMarketData(data);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('missing poolId fails validation', () => {
    const data = createMockMarketData({ poolId: '' });
    const result = strategy.testValidateMarketData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('poolId'))).toBe(true);
  });

  test('zero price fails validation', () => {
    const data = createMockMarketData({ currentPrice: '0' });
    const result = strategy.testValidateMarketData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('positive'))).toBe(true);
  });

  test('stale data emits warning', () => {
    const result = strategy.testValidateMarketData(STALE_MARKET);
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.includes('stale'))).toBe(true);
  });

  test('extreme price change emits warning', () => {
    const data = createMockMarketData({ priceChange1h: 150 });
    const result = strategy.testValidateMarketData(data);
    expect(result.warnings.some((w) => w.includes('Extreme'))).toBe(true);
  });

  test('zero liquidity emits warning', () => {
    const data = createMockMarketData({ totalLiquidity: '0' });
    const result = strategy.testValidateMarketData(data);
    expect(result.warnings.some((w) => w.includes('zero'))).toBe(true);
  });

  // ─── calculateMinAmountOut ───────────────────────────

  test('calculateMinAmountOut applies slippage for ZERO_FOR_ONE', async () => {
    const data = createMockMarketData({ currentPrice: '2.0' });
    const result = await strategy.calculateMinAmountOut(
      '1000000000000000000', // 1 token in
      data,
      SwapDirection.ZERO_FOR_ONE,
      100 // 1% slippage
    );
    // Expected out = 1 * 2 = 2 tokens, minus 1% = 1.98 tokens
    expect(BigInt(result)).toBe(BigInt('1980000000000000000'));
  });

  test('calculateMinAmountOut applies slippage for ONE_FOR_ZERO', async () => {
    const data = createMockMarketData({ currentPrice: '2.0' });
    const result = await strategy.calculateMinAmountOut(
      '2000000000000000000', // 2 tokens in
      data,
      SwapDirection.ONE_FOR_ZERO,
      50 // 0.5% slippage
    );
    // Expected out = 2 / 2 = 1 token, minus 0.5% = 0.995 tokens
    expect(BigInt(result)).toBe(BigInt('995000000000000000'));
  });

  test('calculateMinAmountOut returns 0 for zero price', async () => {
    const data = createMockMarketData({ currentPrice: '0' });
    const result = await strategy.calculateMinAmountOut(
      '1000000000000000000',
      data,
      SwapDirection.ZERO_FOR_ONE,
      50
    );
    expect(result).toBe('0');
  });

  // ─── calculateAmount ─────────────────────────────────

  test('calculateAmount scales by confidence and clamps', async () => {
    const decision = strategy.testBuildTradeDecision(
      SwapDirection.ZERO_FOR_ONE,
      '5000000000000000000', // 5 tokens
      '4500000000000000000',
      0.5,
      'test'
    );
    const amount = await strategy.calculateAmount(createMockMarketData(), decision, config);
    // 5 * 0.5 = 2.5 tokens → clamped to min (1 token) because 2.5e18 > minAmountIn
    const val = BigInt(amount);
    expect(val >= BigInt(config.tradingSettings.minAmountIn)).toBe(true);
    expect(val <= BigInt(config.tradingSettings.maxAmountIn)).toBe(true);
  });

  test('calculateAmount throws for non-trade decision', async () => {
    const noTrade = strategy.testNoTradeDecision('nope');
    await expect(
      strategy.calculateAmount(createMockMarketData(), noTrade, config)
    ).rejects.toThrow('Invalid trade decision');
  });

  // ─── Direction / Confidence helpers ──────────────────

  test('getDirectionFromPriceChange positive → ZERO_FOR_ONE', () => {
    expect(strategy.testGetDirectionFromPriceChange(5)).toBe(SwapDirection.ZERO_FOR_ONE);
  });

  test('getDirectionFromPriceChange negative → ONE_FOR_ZERO', () => {
    expect(strategy.testGetDirectionFromPriceChange(-5)).toBe(SwapDirection.ONE_FOR_ZERO);
  });

  test('getDirectionFromPriceChange zero → null', () => {
    expect(strategy.testGetDirectionFromPriceChange(0)).toBeNull();
  });

  test('calculateConfidence saturates at 10%', () => {
    expect(strategy.testCalculateConfidence(10)).toBe(1);
    expect(strategy.testCalculateConfidence(20)).toBe(1);
  });

  test('calculateConfidence has minimum of 0.1', () => {
    expect(strategy.testCalculateConfidence(0)).toBe(0.1);
  });

  // ─── buildTradeDecision ──────────────────────────────

  test('buildTradeDecision clamps confidence to [0, 1]', () => {
    const d = strategy.testBuildTradeDecision(SwapDirection.ZERO_FOR_ONE, '1', '1', 5, 'test');
    expect(d.confidence).toBe(1);
    const d2 = strategy.testBuildTradeDecision(SwapDirection.ZERO_FOR_ONE, '1', '1', -5, 'test');
    expect(d2.confidence).toBe(0);
  });

  // ─── formatDirection ─────────────────────────────────

  test('formatDirection returns human-readable strings', () => {
    expect(strategy.testFormatDirection(SwapDirection.ZERO_FOR_ONE)).toContain('SELL');
    expect(strategy.testFormatDirection(SwapDirection.ONE_FOR_ZERO)).toContain('BUY');
  });

  // ─── volumeToLiquidityRatio ──────────────────────────

  test('calculateVolumeToLiquidityRatio returns correct ratio', () => {
    const data = createMockMarketData({
      volume1h: '100000000000000000000',     // 100
      totalLiquidity: '1000000000000000000000', // 1000
    });
    expect(strategy.testCalculateVolumeToLiquidityRatio(data)).toBeCloseTo(0.1, 2);
  });

  test('calculateVolumeToLiquidityRatio returns 0 for zero liquidity', () => {
    const data = createMockMarketData({ totalLiquidity: '0' });
    expect(strategy.testCalculateVolumeToLiquidityRatio(data)).toBe(0);
  });
});
