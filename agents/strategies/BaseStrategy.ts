/**
 * BaseStrategy - Template for implementing trading strategies
 * 
 * This abstract class provides a base implementation that can be extended
 * to create custom trading strategies. All strategies must extend this class
 * and implement the `shouldTrade()` method.
 * 
 * ## How to Create a Custom Strategy
 * 
 * 1. Create a new file in `strategies/` (e.g., `MyCustomAgent.ts`)
 * 2. Import `BaseStrategy` and relevant types
 * 3. Extend `BaseStrategy` and set the `name` property
 * 4. Implement the `shouldTrade()` method with your logic
 * 5. Optionally override `calculateAmount()` and `calculateMinAmountOut()`
 * 6. Export your strategy from `index.ts`
 * 
 * ## Example:
 * 
 * ```typescript
 * import { BaseStrategy } from './BaseStrategy';
 * import { MarketData, TradeDecision, AgentConfig, SwapDirection } from '../types/interfaces';
 * 
 * export class MyCustomAgent extends BaseStrategy {
 *   name = 'my-custom-strategy';
 * 
 *   async shouldTrade(marketData: MarketData, config: AgentConfig): Promise<TradeDecision> {
 *     // Your custom logic here
 *     const price = parseFloat(marketData.currentPrice);
 *     
 *     if (someCondition) {
 *       return {
 *         shouldTrade: true,
 *         direction: SwapDirection.ZERO_FOR_ONE,
 *         amountIn: config.tradingSettings.minAmountIn,
 *         confidence: 0.8,
 *         reasoning: 'My custom signal triggered',
 *         timestamp: Date.now(),
 *       };
 *     }
 *     
 *     return this.noTradeDecision('No signal');
 *   }
 * }
 * ```
 * 
 * ## Available Strategies:
 * - **MomentumAgent** - Trades in the direction of price momentum
 * - **ArbitrageAgent** - Exploits cross-pool price discrepancies
 * - **LiquidityAgent** - Trades based on liquidity imbalances and conditions
 * - **MeanReversionAgent** - Trades against price deviations from a moving average
 */

import {
  TradingStrategy,
  MarketData,
  TradeDecision,
  AgentConfig,
  SwapDirection,
} from '../types/interfaces';

/**
 * Validation result for market data
 */
export interface MarketDataValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export abstract class BaseStrategy implements TradingStrategy {
  abstract name: string;

  /**
   * Per-pool cooldown tracking. Subclasses that use `checkCooldown()`
   * get automatic per-pool trade throttling.
   */
  protected lastTradeTimestamp: Map<string, number> = new Map();

  // ─── Abstract ────────────────────────────────────────────

  /**
   * Evaluate market data and decide whether to trade.
   * Must be implemented by subclasses.
   */
  abstract shouldTrade(
    marketData: MarketData,
    config: AgentConfig
  ): Promise<TradeDecision>;

  // ─── Default Implementations ─────────────────────────────

  /**
   * Calculate the amount to trade based on market conditions.
   * Default implementation uses confidence level to scale between
   * the configured min and max trade amounts.
   */
  async calculateAmount(
    _marketData: MarketData,
    decision: TradeDecision,
    config: AgentConfig
  ): Promise<string> {
    if (!decision.shouldTrade || !decision.amountIn) {
      throw new Error('Invalid trade decision: shouldTrade must be true and amountIn must be set');
    }

    // Scale amount based on confidence
    const baseAmount = decision.amountIn;
    const confidenceMultiplier = decision.confidence;
    const scaledAmount = BigInt(Math.floor(Number(baseAmount) * confidenceMultiplier));

    return this.clampAmount(scaledAmount, config).toString();
  }

  /**
   * Calculate minimum amount out for slippage protection.
   * Uses current price and applies slippage tolerance in basis points.
   */
  async calculateMinAmountOut(
    amountIn: string,
    marketData: MarketData,
    direction: SwapDirection,
    slippageBps: number
  ): Promise<string> {
    const amountInBig = BigInt(amountIn);
    const price = BigInt(Math.floor(parseFloat(marketData.currentPrice) * 1e18));

    // Guard against zero or negative price
    if (price <= BigInt(0)) {
      return '0';
    }

    let expectedOut: bigint;
    if (direction === SwapDirection.ZERO_FOR_ONE) {
      // Selling currency0 for currency1
      // expectedOut = amountIn * price (scaled)
      expectedOut = (amountInBig * price) / BigInt(1e18);
    } else {
      // Selling currency1 for currency0
      // expectedOut = amountIn / price (scaled)
      expectedOut = (amountInBig * BigInt(1e18)) / price;
    }

    // Apply slippage tolerance
    const slippageMultiplier = BigInt(10000 - slippageBps);
    const minAmountOut = (expectedOut * slippageMultiplier) / BigInt(10000);

    return minAmountOut.toString();
  }

  /**
   * Get strategy-specific configuration schema.
   * Override in subclasses to provide validation rules for custom config keys.
   */
  getConfigSchema?(): Record<string, any> {
    return {};
  }

  // ─── Shared Helpers (available to all subclasses) ────────

  /**
   * Create a no-trade decision with a reasoning string.
   * Every strategy needs this — use it to return early when conditions aren't met.
   *
   * @example
   * ```ts
   * if (volume < threshold) {
   *   return this.noTradeDecision('Volume too low');
   * }
   * ```
   */
  protected noTradeDecision(reasoning: string): TradeDecision {
    return {
      shouldTrade: false,
      confidence: 0,
      reasoning,
      timestamp: Date.now(),
    };
  }

  /**
   * Check if the cooldown period has elapsed since the last trade for a pool.
   * Returns `true` if still in cooldown (should NOT trade), `false` if clear.
   *
   * @param poolId     Unique pool identifier
   * @param cooldownMs Cooldown period in **milliseconds**
   *
   * @example
   * ```ts
   * if (this.isCooldownActive(marketData.poolId, config.cooldownPeriod * 1000)) {
   *   return this.noTradeDecision('Cooldown period active');
   * }
   * ```
   */
  protected isCooldownActive(poolId: string, cooldownMs: number): boolean {
    const lastTrade = this.lastTradeTimestamp.get(poolId) || 0;
    return Date.now() - lastTrade < cooldownMs;
  }

  /**
   * Record that a trade was just executed for a pool.
   * Call this when `shouldTrade()` returns a positive decision.
   */
  protected recordTrade(poolId: string): void {
    this.lastTradeTimestamp.set(poolId, Date.now());
  }

  /**
   * Scale an amount linearly between minAmountIn and maxAmountIn
   * based on a factor between 0 and 1 (typically confidence).
   *
   * @param factor 0–1 scale factor (e.g. confidence)
   * @param config Agent config containing min/max trade amounts
   * @returns Scaled amount as a string
   */
  protected scaleAmount(factor: number, config: AgentConfig): string {
    const min = BigInt(config.tradingSettings.minAmountIn);
    const max = BigInt(config.tradingSettings.maxAmountIn);
    const range = max - min;

    const clampedFactor = Math.max(0, Math.min(factor, 1));
    const amount = min + (range * BigInt(Math.floor(clampedFactor * 100))) / BigInt(100);
    return amount.toString();
  }

  /**
   * Clamp a raw amount to the configured min/max trade amounts.
   */
  protected clampAmount(amount: bigint, config: AgentConfig): bigint {
    const minAmount = BigInt(config.tradingSettings.minAmountIn);
    const maxAmount = BigInt(config.tradingSettings.maxAmountIn);

    if (amount < minAmount) return minAmount;
    if (amount > maxAmount) return maxAmount;
    return amount;
  }

  /**
   * Merge strategy-specific config with defaults.
   * Useful in subclasses to resolve user-provided overrides against defaults.
   *
   * @example
   * ```ts
   * const cfg = this.mergeConfig<MomentumConfig>(DEFAULT_MOMENTUM_CONFIG, agentConfig);
   * ```
   */
  protected mergeConfig<T extends Record<string, unknown>>(
    defaults: T,
    agentConfig: AgentConfig
  ): T {
    return {
      ...defaults,
      ...(agentConfig.strategy.config as Partial<T>),
    };
  }

  /**
   * Validate market data completeness and sanity.
   * Returns a validation result with errors and warnings.
   *
   * @example
   * ```ts
   * const validation = this.validateMarketData(marketData);
   * if (!validation.isValid) {
   *   return this.noTradeDecision(`Invalid market data: ${validation.errors.join(', ')}`);
   * }
   * ```
   */
  protected validateMarketData(marketData: MarketData): MarketDataValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!marketData.poolId) {
      errors.push('Missing poolId');
    }
    if (!marketData.poolKey) {
      errors.push('Missing poolKey');
    }

    // Price validation
    const price = parseFloat(marketData.currentPrice);
    if (isNaN(price)) {
      errors.push('currentPrice is not a valid number');
    } else if (price <= 0) {
      errors.push('currentPrice must be positive');
    }

    // Liquidity validation
    try {
      const liquidity = BigInt(marketData.totalLiquidity || '0');
      if (liquidity < BigInt(0)) {
        errors.push('totalLiquidity cannot be negative');
      }
      if (liquidity === BigInt(0)) {
        warnings.push('totalLiquidity is zero — pool may have no liquidity');
      }
    } catch {
      errors.push('totalLiquidity is not a valid BigInt');
    }

    // Volume validation
    try {
      const vol1h = BigInt(marketData.volume1h || '0');
      if (vol1h < BigInt(0)) {
        errors.push('volume1h cannot be negative');
      }
    } catch {
      errors.push('volume1h is not a valid BigInt');
    }

    try {
      const vol24h = BigInt(marketData.volume24h || '0');
      if (vol24h < BigInt(0)) {
        errors.push('volume24h cannot be negative');
      }
    } catch {
      errors.push('volume24h is not a valid BigInt');
    }

    // Timestamp freshness
    const ageMs = Date.now() - marketData.timestamp;
    if (ageMs > 5 * 60 * 1000) {
      warnings.push(`Market data is ${Math.round(ageMs / 1000)}s old — may be stale`);
    }

    // Price change sanity (e.g. >100% in 1h is suspicious)
    if (Math.abs(marketData.priceChange1h) > 100) {
      warnings.push(`Extreme 1h price change: ${marketData.priceChange1h.toFixed(2)}%`);
    }
    if (Math.abs(marketData.priceChange24h) > 200) {
      warnings.push(`Extreme 24h price change: ${marketData.priceChange24h.toFixed(2)}%`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Determine swap direction from a price movement.
   * Positive change → price increased → sell token0 (ZERO_FOR_ONE).
   * Negative change → price decreased → buy token0 (ONE_FOR_ZERO).
   * Zero → no direction.
   */
  protected getDirectionFromPriceChange(
    priceChange: number
  ): SwapDirection | null {
    if (priceChange > 0) {
      return SwapDirection.ZERO_FOR_ONE;
    } else if (priceChange < 0) {
      return SwapDirection.ONE_FOR_ZERO;
    }
    return null;
  }

  /**
   * Calculate a 0–1 confidence value from a price change magnitude.
   * A 10% move yields maximum confidence; smaller moves scale linearly.
   * Minimum returned confidence is 0.1.
   */
  protected calculateConfidence(priceChangePercent: number): number {
    const absChange = Math.abs(priceChangePercent);
    const confidence = Math.min(absChange / 10, 1); // 10% change = max confidence
    return Math.max(confidence, 0.1); // Minimum 10% confidence
  }

  /**
   * Build a standardized trade decision object.
   * Convenience method for subclasses to return consistent results.
   */
  protected buildTradeDecision(
    direction: SwapDirection,
    amountIn: string,
    minAmountOut: string,
    confidence: number,
    reasoning: string
  ): TradeDecision {
    return {
      shouldTrade: true,
      direction,
      amountIn,
      minAmountOut,
      confidence: Math.max(0, Math.min(confidence, 1)),
      reasoning,
      timestamp: Date.now(),
    };
  }

  /**
   * Format a direction enum to a human-readable string.
   */
  protected formatDirection(direction: SwapDirection): string {
    return direction === SwapDirection.ZERO_FOR_ONE
      ? 'SELL token0 → token1'
      : 'BUY token0 ← token1';
  }

  /**
   * Calculate the volume-to-liquidity ratio for a pool.
   * Useful for gauging how active a pool is relative to its depth.
   * Returns a number (e.g. 0.05 means 5% of liquidity traded in the period).
   */
  protected calculateVolumeToLiquidityRatio(marketData: MarketData): number {
    const volume = BigInt(marketData.volume1h || '0');
    const liquidity = BigInt(marketData.totalLiquidity || '1');

    if (liquidity === BigInt(0)) return 0;

    return Number((volume * BigInt(10000)) / liquidity) / 10000;
  }
}
