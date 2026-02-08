/**
 * MeanReversionAgent - Trading strategy based on price deviation from a mean
 *
 * This strategy tracks a moving average of pool prices and trades when the
 * current price deviates significantly from the mean, betting that the price
 * will revert back toward the average. This is a contrarian strategy that
 * trades AGAINST price movements.
 *
 * Key features:
 * - Exponential moving average (EMA) tracking
 * - Configurable deviation thresholds (standard deviation-based)
 * - Multiple signal zones (moderate, strong, extreme deviation)
 * - Volume confirmation for deviation signals
 * - Cooldown to avoid whipsaw trading
 * - Adaptive confidence based on deviation magnitude and history
 * - Historical price tracking for accurate mean calculation
 */

import {
  MarketData,
  TradeDecision,
  AgentConfig,
  SwapDirection,
} from '../types/interfaces';
import { BaseStrategy } from './BaseStrategy';

/**
 * Configuration for the Mean Reversion strategy
 */
export interface MeanReversionConfig {
  /** Number of data points for EMA calculation (default: 20) */
  emaPeriod: number;
  /** Standard deviations for moderate signal zone (default: 1.5) */
  moderateDeviationThreshold: number;
  /** Standard deviations for strong signal zone (default: 2.5) */
  strongDeviationThreshold: number;
  /** Standard deviations for extreme signal zone (default: 3.5) */
  extremeDeviationThreshold: number;
  /** Maximum deviation before we consider it a regime change and don't trade (default: 5.0) */
  maxDeviationThreshold: number;
  /** Cooldown period in seconds between trades (default: 300 = 5 min) */
  cooldownPeriod: number;
  /** Minimum confidence to execute a trade (default: 0.3) */
  minConfidence: number;
  /** Whether to require volume confirmation (default: true) */
  requireVolumeConfirmation: boolean;
  /** Volume threshold for confirmation (normalized, default: 0.05 = 5%) */
  volumeConfirmationRatio: number;
  /** Minimum data points before strategy can make decisions (default: 5) */
  minDataPoints: number;
  /** EMA smoothing factor override (default: calculated from emaPeriod) */
  emaSmoothingFactor?: number;
}

const DEFAULT_MEAN_REVERSION_CONFIG: MeanReversionConfig = {
  emaPeriod: 20,
  moderateDeviationThreshold: 1.5,
  strongDeviationThreshold: 2.5,
  extremeDeviationThreshold: 3.5,
  maxDeviationThreshold: 5.0,
  cooldownPeriod: 300,
  minConfidence: 0.3,
  requireVolumeConfirmation: true,
  volumeConfirmationRatio: 0.05,
  minDataPoints: 5,
};

/**
 * Price history entry
 */
interface PriceEntry {
  price: number;
  timestamp: number;
}

/**
 * Statistical analysis result
 */
interface PriceStatistics {
  ema: number;
  standardDeviation: number;
  currentDeviation: number; // In standard deviations
  deviationPercent: number; // As percentage from mean
  zScore: number; // Standard score (positive = above mean, negative = below)
  dataPoints: number;
}

export class MeanReversionAgent extends BaseStrategy {
  name = 'mean-reversion';
  private priceHistory: Map<string, PriceEntry[]> = new Map(); // poolId -> price history
  private emaValues: Map<string, number> = new Map(); // poolId -> current EMA
  private emaSquaredValues: Map<string, number> = new Map(); // poolId -> EMA of squared prices (for variance)

  /**
   * Evaluate market data and decide whether to trade based on mean reversion signals
   */
  async shouldTrade(
    marketData: MarketData,
    config: AgentConfig
  ): Promise<TradeDecision> {
    const strategyConfig = this.getMeanReversionConfig(config);
    const now = Date.now();

    // Check cooldown
    const lastTrade = this.lastTradeTimestamp.get(marketData.poolId) || 0;
    if (now - lastTrade < strategyConfig.cooldownPeriod * 1000) {
      return this.noTradeDecision('Cooldown period active');
    }

    // Update price history
    const currentPrice = parseFloat(marketData.currentPrice);
    if (currentPrice <= 0 || isNaN(currentPrice)) {
      return this.noTradeDecision('Invalid current price');
    }
    this.updatePriceHistory(marketData.poolId, currentPrice, now);

    // Update EMA
    this.updateEMA(marketData.poolId, currentPrice, strategyConfig);

    // Get statistics
    const stats = this.calculateStatistics(
      marketData.poolId,
      currentPrice,
      strategyConfig
    );

    if (!stats || stats.dataPoints < strategyConfig.minDataPoints) {
      return this.noTradeDecision(
        `Insufficient data: ${stats?.dataPoints || 0}/${strategyConfig.minDataPoints} data points`
      );
    }

    // Check if deviation exceeds maximum (regime change - don't trade)
    if (Math.abs(stats.zScore) > strategyConfig.maxDeviationThreshold) {
      return this.noTradeDecision(
        `Deviation too extreme (possible regime change): z-score=${stats.zScore.toFixed(2)}`
      );
    }

    // Determine signal strength and trading decision
    const absZScore = Math.abs(stats.zScore);
    let signalZone: 'none' | 'moderate' | 'strong' | 'extreme' = 'none';
    let baseConfidence = 0;

    if (absZScore >= strategyConfig.extremeDeviationThreshold) {
      signalZone = 'extreme';
      baseConfidence = 0.9;
    } else if (absZScore >= strategyConfig.strongDeviationThreshold) {
      signalZone = 'strong';
      baseConfidence = 0.65;
    } else if (absZScore >= strategyConfig.moderateDeviationThreshold) {
      signalZone = 'moderate';
      baseConfidence = 0.4;
    }

    if (signalZone === 'none') {
      return this.noTradeDecision(
        `Price within normal range: z-score=${stats.zScore.toFixed(2)}, ` +
        `deviation=${stats.deviationPercent.toFixed(2)}%`
      );
    }

    // Mean reversion: trade AGAINST the deviation
    // Price above mean → sell (ZERO_FOR_ONE)
    // Price below mean → buy (ONE_FOR_ZERO)
    const direction =
      stats.zScore > 0
        ? SwapDirection.ZERO_FOR_ONE // Price above mean, sell
        : SwapDirection.ONE_FOR_ZERO; // Price below mean, buy

    // Volume confirmation
    let confidence = baseConfidence;
    if (strategyConfig.requireVolumeConfirmation) {
      const volumeConfirmed = this.checkVolumeConfirmation(
        marketData,
        strategyConfig
      );
      if (volumeConfirmed) {
        confidence = Math.min(confidence * 1.2, 1.0);
      } else {
        confidence *= 0.7;
      }
    }

    // Apply minimum confidence check
    if (confidence < strategyConfig.minConfidence) {
      return this.noTradeDecision(
        `Confidence too low: ${(confidence * 100).toFixed(1)}% < ${(strategyConfig.minConfidence * 100).toFixed(1)}%`
      );
    }

    // Calculate trade amount
    const amountIn = this.calculateReversionAmount(
      stats,
      confidence,
      config,
      strategyConfig
    );

    // Calculate min amount out
    const minAmountOut = await this.calculateMinAmountOut(
      amountIn,
      marketData,
      direction,
      config.tradingSettings.defaultSlippageBps
    );

    // Update last trade timestamp
    this.lastTradeTimestamp.set(marketData.poolId, now);

    return {
      shouldTrade: true,
      direction,
      amountIn,
      minAmountOut,
      confidence,
      reasoning: this.buildReasoning(stats, signalZone, direction, confidence),
      timestamp: now,
    };
  }

  /**
   * Update price history for a pool
   */
  private updatePriceHistory(
    poolId: string,
    price: number,
    timestamp: number
  ): void {
    let history = this.priceHistory.get(poolId);
    if (!history) {
      history = [];
      this.priceHistory.set(poolId, history);
    }

    history.push({ price, timestamp });

    // Keep last 1000 data points
    if (history.length > 1000) {
      history.splice(0, history.length - 1000);
    }
  }

  /**
   * Update Exponential Moving Average
   */
  private updateEMA(
    poolId: string,
    currentPrice: number,
    config: MeanReversionConfig
  ): void {
    const smoothingFactor =
      config.emaSmoothingFactor || 2 / (config.emaPeriod + 1);

    const previousEMA = this.emaValues.get(poolId);
    const previousEMASquared = this.emaSquaredValues.get(poolId);

    if (previousEMA === undefined) {
      // Initialize EMA with first price
      this.emaValues.set(poolId, currentPrice);
      this.emaSquaredValues.set(poolId, currentPrice * currentPrice);
    } else {
      // Update EMA: EMA_new = price * k + EMA_old * (1 - k)
      const newEMA =
        currentPrice * smoothingFactor + previousEMA * (1 - smoothingFactor);
      const newEMASquared =
        currentPrice * currentPrice * smoothingFactor +
        (previousEMASquared || 0) * (1 - smoothingFactor);

      this.emaValues.set(poolId, newEMA);
      this.emaSquaredValues.set(poolId, newEMASquared);
    }
  }

  /**
   * Calculate statistics for current price relative to the mean
   */
  private calculateStatistics(
    poolId: string,
    currentPrice: number,
    _config: MeanReversionConfig
  ): PriceStatistics | null {
    const ema = this.emaValues.get(poolId);
    const emaSquared = this.emaSquaredValues.get(poolId);
    const history = this.priceHistory.get(poolId);

    if (ema === undefined || emaSquared === undefined || !history) {
      return null;
    }

    // Calculate standard deviation from EMA
    // Variance = E[X²] - (E[X])²
    const variance = Math.max(emaSquared - ema * ema, 0);
    const standardDeviation = Math.sqrt(variance);

    // Avoid division by zero
    if (standardDeviation === 0) {
      return {
        ema,
        standardDeviation: 0,
        currentDeviation: 0,
        deviationPercent: 0,
        zScore: 0,
        dataPoints: history.length,
      };
    }

    // Calculate z-score
    const zScore = (currentPrice - ema) / standardDeviation;

    // Deviation as percentage from mean
    const deviationPercent = ((currentPrice - ema) / ema) * 100;

    return {
      ema,
      standardDeviation,
      currentDeviation: Math.abs(currentPrice - ema),
      deviationPercent,
      zScore,
      dataPoints: history.length,
    };
  }

  /**
   * Check volume confirmation for the signal
   */
  private checkVolumeConfirmation(
    marketData: MarketData,
    config: MeanReversionConfig
  ): boolean {
    const volume = BigInt(marketData.volume1h || '0');
    const liquidity = BigInt(marketData.totalLiquidity || '1');

    if (liquidity === BigInt(0)) return false;

    const ratio = Number((volume * BigInt(10000)) / liquidity) / 10000;
    return ratio >= config.volumeConfirmationRatio;
  }

  /**
   * Calculate trade amount based on deviation severity
   * Larger deviations warrant larger positions (stronger mean reversion signal)
   */
  private calculateReversionAmount(
    _stats: PriceStatistics,
    confidence: number,
    config: AgentConfig,
    _strategyConfig: MeanReversionConfig
  ): string {
    const min = BigInt(config.tradingSettings.minAmountIn);
    const max = BigInt(config.tradingSettings.maxAmountIn);
    const range = max - min;

    // Scale with confidence (which already accounts for deviation severity)
    const scaleFactor = confidence;
    const amount =
      min + (range * BigInt(Math.floor(scaleFactor * 100))) / BigInt(100);

    return amount.toString();
  }

  /**
   * Build reasoning string
   */
  private buildReasoning(
    stats: PriceStatistics,
    signalZone: string,
    direction: SwapDirection,
    confidence: number
  ): string {
    const directionStr =
      direction === SwapDirection.ZERO_FOR_ONE
        ? 'SELL token0 (price above mean)'
        : 'BUY token0 (price below mean)';

    return (
      `Mean reversion signal [${signalZone.toUpperCase()}]: ` +
      `EMA=${stats.ema.toFixed(6)}, ` +
      `z-score=${stats.zScore.toFixed(2)}, ` +
      `deviation=${stats.deviationPercent >= 0 ? '+' : ''}${stats.deviationPercent.toFixed(2)}%, ` +
      `σ=${stats.standardDeviation.toFixed(6)}. ` +
      `Data points: ${stats.dataPoints}. ` +
      `Action: ${directionStr} with ${(confidence * 100).toFixed(1)}% confidence.`
    );
  }

  /**
   * Get mean reversion configuration with defaults
   */
  private getMeanReversionConfig(config: AgentConfig): MeanReversionConfig {
    return {
      ...DEFAULT_MEAN_REVERSION_CONFIG,
      ...(config.strategy.config as Partial<MeanReversionConfig>),
    };
  }

  /**
   * Get the current EMA for a pool (useful for debugging/monitoring)
   */
  getEMA(poolId: string): number | undefined {
    return this.emaValues.get(poolId);
  }

  /**
   * Get price history for a pool (useful for debugging/monitoring)
   */
  getPriceHistory(poolId: string): PriceEntry[] {
    return this.priceHistory.get(poolId) || [];
  }

  /**
   * Reset price history and EMA for a pool
   */
  resetPool(poolId: string): void {
    this.priceHistory.delete(poolId);
    this.emaValues.delete(poolId);
    this.emaSquaredValues.delete(poolId);
    this.lastTradeTimestamp.delete(poolId);
  }

  /**
   * Get configuration schema
   */
  override getConfigSchema(): Record<string, any> {
    return {
      emaPeriod: {
        type: 'number',
        default: 20,
        description: 'Number of data points for EMA calculation',
      },
      moderateDeviationThreshold: {
        type: 'number',
        default: 1.5,
        description: 'Standard deviations for moderate signal zone',
      },
      strongDeviationThreshold: {
        type: 'number',
        default: 2.5,
        description: 'Standard deviations for strong signal zone',
      },
      extremeDeviationThreshold: {
        type: 'number',
        default: 3.5,
        description: 'Standard deviations for extreme signal zone',
      },
      maxDeviationThreshold: {
        type: 'number',
        default: 5.0,
        description: 'Maximum deviation (regime change detection)',
      },
      cooldownPeriod: {
        type: 'number',
        default: 300,
        description: 'Cooldown period in seconds between trades',
      },
      minConfidence: {
        type: 'number',
        default: 0.3,
        description: 'Minimum confidence to execute a trade',
      },
      requireVolumeConfirmation: {
        type: 'boolean',
        default: true,
        description: 'Require volume confirmation for signals',
      },
      volumeConfirmationRatio: {
        type: 'number',
        default: 0.05,
        description: 'Volume-to-liquidity ratio for confirmation',
      },
      minDataPoints: {
        type: 'number',
        default: 5,
        description: 'Minimum data points before strategy can decide',
      },
      emaSmoothingFactor: {
        type: 'number',
        default: undefined,
        description: 'EMA smoothing factor override (calculated from emaPeriod by default)',
      },
    };
  }
}
