/**
 * BaseStrategy - Template for implementing trading strategies
 * 
 * This class provides a base implementation that can be extended
 * to create custom trading strategies.
 */

import {
  TradingStrategy,
  MarketData,
  TradeDecision,
  AgentConfig,
  SwapDirection,
} from '../types/interfaces';

export abstract class BaseStrategy implements TradingStrategy {
  abstract name: string;

  /**
   * Evaluate market data and decide whether to trade
   * Must be implemented by subclasses
   */
  abstract shouldTrade(
    marketData: MarketData,
    config: AgentConfig
  ): Promise<TradeDecision>;

  /**
   * Calculate the amount to trade based on market conditions
   * Default implementation uses confidence level to scale amount
   */
  async calculateAmount(
    _marketData: MarketData,
    decision: TradeDecision,
    config: AgentConfig
  ): Promise<string> {
    if (!decision.shouldTrade || !decision.amountIn) {
      throw new Error('Invalid trade decision');
    }

    // Scale amount based on confidence
    const baseAmount = decision.amountIn;
    const confidenceMultiplier = decision.confidence;
    const scaledAmount = BigInt(Math.floor(Number(baseAmount) * confidenceMultiplier));

    // Apply min/max constraints
    const minAmount = BigInt(config.tradingSettings.minAmountIn);
    const maxAmount = BigInt(config.tradingSettings.maxAmountIn);

    if (scaledAmount < minAmount) {
      return config.tradingSettings.minAmountIn;
    }
    if (scaledAmount > maxAmount) {
      return config.tradingSettings.maxAmountIn;
    }

    return scaledAmount.toString();
  }

  /**
   * Calculate minimum amount out for slippage protection
   * Uses current price and applies slippage tolerance
   */
  async calculateMinAmountOut(
    amountIn: string,
    marketData: MarketData,
    direction: SwapDirection,
    slippageBps: number
  ): Promise<string> {
    const amountInBig = BigInt(amountIn);
    const price = BigInt(Math.floor(parseFloat(marketData.currentPrice) * 1e18));

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
   * Get strategy-specific configuration schema
   * Override in subclasses to provide validation
   */
  getConfigSchema?(): Record<string, any> {
    return {};
  }

  /**
   * Helper method to determine swap direction from price movement
   */
  protected getDirectionFromPriceChange(
    priceChange: number
  ): SwapDirection | null {
    if (priceChange > 0) {
      // Price increased - might want to sell (currency0 -> currency1)
      return SwapDirection.ZERO_FOR_ONE;
    } else if (priceChange < 0) {
      // Price decreased - might want to buy (currency1 -> currency0)
      return SwapDirection.ONE_FOR_ZERO;
    }
    return null;
  }

  /**
   * Helper method to calculate confidence from price change magnitude
   */
  protected calculateConfidence(priceChangePercent: number): number {
    // Normalize to 0-1 range, with stronger moves having higher confidence
    const absChange = Math.abs(priceChangePercent);
    const confidence = Math.min(absChange / 10, 1); // 10% change = max confidence
    return Math.max(confidence, 0.1); // Minimum 10% confidence
  }
}
