/**
 * MomentumAgent - Trading strategy based on price momentum
 *
 * This strategy monitors price changes over time and trades in the direction
 * of the momentum when it exceeds configurable thresholds. It uses a
 * combination of short-term (1h) and long-term (24h) momentum signals
 * to determine trade direction and confidence.
 *
 * Key features:
 * - Dual timeframe momentum analysis (1h and 24h)
 * - Configurable momentum thresholds and weights
 * - Volume-weighted confidence scoring
 * - Adaptive position sizing based on momentum strength
 * - Cooldown period to prevent overtrading
 */

import {
  MarketData,
  TradeDecision,
  AgentConfig,
  SwapDirection,
} from '../types/interfaces';
import { BaseStrategy } from './BaseStrategy';

/**
 * Configuration for the Momentum strategy
 */
export interface MomentumConfig {
  /** Minimum 1h price change (%) to trigger a trade (default: 0.5%) */
  momentumThreshold1h: number;
  /** Minimum 24h price change (%) to trigger a trade (default: 2.0%) */
  momentumThreshold24h: number;
  /** Weight for 1h momentum in composite signal (0-1, default: 0.6) */
  shortTermWeight: number;
  /** Weight for 24h momentum in composite signal (0-1, default: 0.4) */
  longTermWeight: number;
  /** Minimum volume (in raw units) to confirm momentum (default: '0') */
  minVolumeThreshold: string;
  /** Cooldown period in seconds between trades (default: 300 = 5 min) */
  cooldownPeriod: number;
  /** Maximum price change (%) above which we consider it too volatile (default: 20%) */
  maxVolatilityThreshold: number;
  /** Use volume confirmation for higher confidence (default: true) */
  requireVolumeConfirmation: boolean;
  /** Number of recent swaps to consider for trend confirmation (default: 5) */
  trendConfirmationSwaps: number;
}

const DEFAULT_MOMENTUM_CONFIG: MomentumConfig = {
  momentumThreshold1h: 0.5,
  momentumThreshold24h: 2.0,
  shortTermWeight: 0.6,
  longTermWeight: 0.4,
  minVolumeThreshold: '0',
  cooldownPeriod: 300,
  maxVolatilityThreshold: 20.0,
  requireVolumeConfirmation: true,
  trendConfirmationSwaps: 5,
};

export class MomentumAgent extends BaseStrategy {
  name = 'momentum';

  /**
   * Evaluate market data and decide whether to trade based on momentum signals
   */
  async shouldTrade(
    marketData: MarketData,
    config: AgentConfig
  ): Promise<TradeDecision> {
    const strategyConfig = this.getMomentumConfig(config);
    const now = Date.now();

    // Check cooldown
    const lastTrade = this.lastTradeTimestamp.get(marketData.poolId) || 0;
    if (now - lastTrade < strategyConfig.cooldownPeriod * 1000) {
      return this.noTradeDecision('Cooldown period active');
    }

    // Extract momentum signals
    const momentum1h = marketData.priceChange1h;
    const momentum24h = marketData.priceChange24h;

    // Check for excessive volatility
    if (
      Math.abs(momentum1h) > strategyConfig.maxVolatilityThreshold ||
      Math.abs(momentum24h) > strategyConfig.maxVolatilityThreshold
    ) {
      return this.noTradeDecision(
        `Volatility too high: 1h=${momentum1h.toFixed(2)}%, 24h=${momentum24h.toFixed(2)}%`
      );
    }

    // Calculate composite momentum score
    const compositeMomentum =
      momentum1h * strategyConfig.shortTermWeight +
      momentum24h * strategyConfig.longTermWeight;

    // Check if momentum exceeds thresholds
    const absComposite = Math.abs(compositeMomentum);
    const weightedThreshold =
      strategyConfig.momentumThreshold1h * strategyConfig.shortTermWeight +
      strategyConfig.momentumThreshold24h * strategyConfig.longTermWeight;

    if (absComposite < weightedThreshold) {
      return this.noTradeDecision(
        `Momentum below threshold: composite=${compositeMomentum.toFixed(2)}%, threshold=${weightedThreshold.toFixed(2)}%`
      );
    }

    // Volume confirmation
    if (strategyConfig.requireVolumeConfirmation) {
      const volume = BigInt(marketData.volume1h || '0');
      const minVolume = BigInt(strategyConfig.minVolumeThreshold || '0');
      if (volume < minVolume) {
        return this.noTradeDecision(
          `Volume too low for confirmation: ${volume.toString()} < ${minVolume.toString()}`
        );
      }
    }

    // Trend confirmation from recent swaps
    const trendConfirmed = this.confirmTrend(
      marketData.recentSwaps,
      compositeMomentum > 0,
      strategyConfig.trendConfirmationSwaps
    );

    // Determine direction: momentum > 0 means price is rising, so buy (ONE_FOR_ZERO)
    // momentum < 0 means price is falling, so sell (ZERO_FOR_ONE)
    // In momentum trading, we trade WITH the trend
    const direction =
      compositeMomentum > 0
        ? SwapDirection.ZERO_FOR_ONE
        : SwapDirection.ONE_FOR_ZERO;

    // Calculate confidence
    let confidence = this.calculateMomentumConfidence(
      momentum1h,
      momentum24h,
      strategyConfig
    );

    // Boost or reduce confidence based on trend confirmation
    if (trendConfirmed) {
      confidence = Math.min(confidence * 1.2, 1.0);
    } else {
      confidence *= 0.7;
    }

    // Calculate amount based on confidence and config
    const baseAmount = this.calculateBaseAmount(confidence, config);

    // Calculate min amount out with slippage
    const minAmountOut = await this.calculateMinAmountOut(
      baseAmount,
      marketData,
      direction,
      config.tradingSettings.defaultSlippageBps
    );

    // Update last trade timestamp
    this.lastTradeTimestamp.set(marketData.poolId, now);

    return {
      shouldTrade: true,
      direction,
      amountIn: baseAmount,
      minAmountOut,
      confidence,
      reasoning: this.buildReasoning(
        momentum1h,
        momentum24h,
        compositeMomentum,
        confidence,
        trendConfirmed,
        direction
      ),
      timestamp: now,
    };
  }

  /**
   * Calculate amount based on confidence and trading settings
   */
  async calculateAmount(
    _marketData: MarketData,
    decision: TradeDecision,
    config: AgentConfig
  ): Promise<string> {
    if (!decision.shouldTrade || !decision.amountIn) {
      throw new Error('Invalid trade decision');
    }

    // Use the pre-calculated amount, applying confidence scaling
    const baseAmount = BigInt(decision.amountIn);
    const scaledAmount = (baseAmount * BigInt(Math.floor(decision.confidence * 100))) / BigInt(100);

    const minAmount = BigInt(config.tradingSettings.minAmountIn);
    const maxAmount = BigInt(config.tradingSettings.maxAmountIn);

    if (scaledAmount < minAmount) return minAmount.toString();
    if (scaledAmount > maxAmount) return maxAmount.toString();

    return scaledAmount.toString();
  }

  /**
   * Confirm trend direction from recent swap events
   * Returns true if the majority of recent swaps align with the expected direction
   */
  private confirmTrend(
    recentSwaps: MarketData['recentSwaps'],
    expectingUptrend: boolean,
    minSwaps: number
  ): boolean {
    if (recentSwaps.length < minSwaps) {
      return false; // Not enough data to confirm
    }

    const relevantSwaps = recentSwaps.slice(0, minSwaps);
    let alignedCount = 0;

    for (const swap of relevantSwaps) {
      // zeroForOne = true means selling token0, which pushes price down
      // For uptrend confirmation, we want more ONE_FOR_ZERO (buying token0)
      if (expectingUptrend && !swap.zeroForOne) {
        alignedCount++;
      } else if (!expectingUptrend && swap.zeroForOne) {
        alignedCount++;
      }
    }

    // More than 60% aligned = trend confirmed
    return alignedCount / relevantSwaps.length > 0.6;
  }

  /**
   * Calculate momentum-specific confidence
   */
  private calculateMomentumConfidence(
    momentum1h: number,
    momentum24h: number,
    config: MomentumConfig
  ): number {
    // Base confidence from 1h momentum
    const shortTermSignal = Math.min(
      Math.abs(momentum1h) / (config.momentumThreshold1h * 3),
      1.0
    );

    // Long-term confirmation
    const longTermSignal = Math.min(
      Math.abs(momentum24h) / (config.momentumThreshold24h * 3),
      1.0
    );

    // Are short-term and long-term aligned?
    const aligned = Math.sign(momentum1h) === Math.sign(momentum24h);
    const alignmentBonus = aligned ? 0.15 : -0.15;

    // Weighted confidence
    const rawConfidence =
      shortTermSignal * config.shortTermWeight +
      longTermSignal * config.longTermWeight +
      alignmentBonus;

    return Math.max(0.1, Math.min(rawConfidence, 1.0));
  }

  /**
   * Calculate base trade amount from confidence and config
   */
  private calculateBaseAmount(confidence: number, config: AgentConfig): string {
    const min = BigInt(config.tradingSettings.minAmountIn);
    const max = BigInt(config.tradingSettings.maxAmountIn);
    const range = max - min;

    // Scale amount linearly with confidence
    const amount = min + (range * BigInt(Math.floor(confidence * 100))) / BigInt(100);
    return amount.toString();
  }

  /**
   * Build a human-readable reasoning string
   */
  private buildReasoning(
    momentum1h: number,
    momentum24h: number,
    composite: number,
    confidence: number,
    trendConfirmed: boolean,
    direction: SwapDirection
  ): string {
    const directionStr =
      direction === SwapDirection.ZERO_FOR_ONE ? 'SELL token0' : 'BUY token0';
    return (
      `Momentum signal detected: ` +
      `1h=${momentum1h >= 0 ? '+' : ''}${momentum1h.toFixed(2)}%, ` +
      `24h=${momentum24h >= 0 ? '+' : ''}${momentum24h.toFixed(2)}%, ` +
      `composite=${composite >= 0 ? '+' : ''}${composite.toFixed(2)}%. ` +
      `Trend confirmed: ${trendConfirmed ? 'YES' : 'NO'}. ` +
      `Action: ${directionStr} with ${(confidence * 100).toFixed(1)}% confidence.`
    );
  }

  /**
   * Get momentum configuration with defaults
   */
  private getMomentumConfig(config: AgentConfig): MomentumConfig {
    return {
      ...DEFAULT_MOMENTUM_CONFIG,
      ...(config.strategy.config as Partial<MomentumConfig>),
    };
  }

  /**
   * Get configuration schema for validation
   */
  override getConfigSchema(): Record<string, any> {
    return {
      momentumThreshold1h: {
        type: 'number',
        default: 0.5,
        description: 'Minimum 1h price change (%) to trigger a trade',
      },
      momentumThreshold24h: {
        type: 'number',
        default: 2.0,
        description: 'Minimum 24h price change (%) to trigger a trade',
      },
      shortTermWeight: {
        type: 'number',
        default: 0.6,
        min: 0,
        max: 1,
        description: 'Weight for 1h momentum in composite signal',
      },
      longTermWeight: {
        type: 'number',
        default: 0.4,
        min: 0,
        max: 1,
        description: 'Weight for 24h momentum in composite signal',
      },
      minVolumeThreshold: {
        type: 'string',
        default: '0',
        description: 'Minimum volume to confirm momentum',
      },
      cooldownPeriod: {
        type: 'number',
        default: 300,
        description: 'Cooldown period in seconds between trades',
      },
      maxVolatilityThreshold: {
        type: 'number',
        default: 20.0,
        description: 'Maximum price change (%) above which we consider it too volatile',
      },
      requireVolumeConfirmation: {
        type: 'boolean',
        default: true,
        description: 'Whether to require volume confirmation',
      },
      trendConfirmationSwaps: {
        type: 'number',
        default: 5,
        description: 'Number of recent swaps to consider for trend confirmation',
      },
    };
  }
}
