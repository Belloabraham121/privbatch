/**
 * LiquidityAgent - Trading strategy based on liquidity conditions
 *
 * This strategy monitors pool liquidity levels and makes trades when liquidity
 * conditions signal potential opportunities. It detects liquidity imbalances,
 * sudden liquidity changes, and low-liquidity conditions that can indicate
 * upcoming price movements.
 *
 * Key features:
 * - Liquidity imbalance detection (token0/token1 ratio)
 * - Liquidity change monitoring (sudden add/remove)
 * - Low liquidity detection for potential large price impacts
 * - Volume-to-liquidity ratio analysis
 * - Configurable thresholds for all liquidity metrics
 * - Adaptive position sizing based on available liquidity
 */

import {
  MarketData,
  TradeDecision,
  AgentConfig,
  SwapDirection,
} from '../types/interfaces';
import { BaseStrategy } from './BaseStrategy';

/**
 * Configuration for the Liquidity strategy
 */
export interface LiquidityConfig {
  /** Minimum liquidity imbalance ratio to trigger a trade (default: 1.5 = 50% more on one side) */
  imbalanceThreshold: number;
  /** Minimum total liquidity to consider the pool viable (default: '1000') */
  minTotalLiquidity: string;
  /** Maximum total liquidity above which we skip (too deep to exploit, default: unlimited) */
  maxTotalLiquidity: string;
  /** Volume-to-liquidity ratio threshold (higher = more volatile, default: 0.1 = 10%) */
  volumeToLiquidityThreshold: number;
  /** Cooldown period in seconds between trades (default: 600 = 10 min) */
  cooldownPeriod: number;
  /** Whether to trade into the imbalance (buy the scarcer token, default: true) */
  tradeIntoImbalance: boolean;
  /** Minimum confidence to execute a trade (default: 0.3) */
  minConfidence: number;
  /** Position size as fraction of available liquidity (default: 0.01 = 1%) */
  positionSizeFraction: number;
  /** Whether to detect sudden liquidity changes as signals (default: true) */
  detectLiquidityChanges: boolean;
  /** Threshold for "sudden" liquidity change in percentage (default: 10%) */
  liquidityChangeThreshold: number;
}

const DEFAULT_LIQUIDITY_CONFIG: LiquidityConfig = {
  imbalanceThreshold: 1.5,
  minTotalLiquidity: '1000',
  maxTotalLiquidity: '0', // 0 = unlimited
  volumeToLiquidityThreshold: 0.1,
  cooldownPeriod: 600,
  tradeIntoImbalance: true,
  minConfidence: 0.3,
  positionSizeFraction: 0.01,
  detectLiquidityChanges: true,
  liquidityChangeThreshold: 10.0,
};

/**
 * Liquidity analysis result
 */
interface LiquidityAnalysis {
  imbalanceRatio: number; // ratio of liquidity0 to liquidity1
  isImbalanced: boolean;
  scarcerSide: 'token0' | 'token1' | 'balanced';
  volumeToLiquidityRatio: number;
  isHighVolume: boolean;
  totalLiquidity: bigint;
  isViable: boolean; // has enough liquidity to trade
}

export class LiquidityAgent extends BaseStrategy {
  name = 'liquidity';
  private previousLiquidity: Map<string, string> = new Map(); // poolId -> previous total liquidity

  /**
   * Evaluate market data and decide whether to trade based on liquidity conditions
   */
  async shouldTrade(
    marketData: MarketData,
    config: AgentConfig
  ): Promise<TradeDecision> {
    const strategyConfig = this.getLiquidityConfig(config);
    const now = Date.now();

    // Check cooldown
    const lastTrade = this.lastTradeTimestamp.get(marketData.poolId) || 0;
    if (now - lastTrade < strategyConfig.cooldownPeriod * 1000) {
      return this.noTradeDecision('Cooldown period active');
    }

    // Analyze liquidity conditions
    const analysis = this.analyzeLiquidity(marketData, strategyConfig);

    // Check if pool is viable
    if (!analysis.isViable) {
      return this.noTradeDecision(
        `Pool not viable: liquidity=${analysis.totalLiquidity.toString()}, ` +
        `min=${strategyConfig.minTotalLiquidity}`
      );
    }

    // Check for sudden liquidity changes
    let liquidityChangeSignal = false;
    if (strategyConfig.detectLiquidityChanges) {
      liquidityChangeSignal = this.detectLiquidityChange(
        marketData.poolId,
        marketData.totalLiquidity,
        strategyConfig.liquidityChangeThreshold
      );
    }
    // Update stored liquidity for next comparison
    this.previousLiquidity.set(marketData.poolId, marketData.totalLiquidity);

    // Determine trading signals
    let shouldTrade = false;
    let direction: SwapDirection | undefined;
    let confidence = 0;
    let reasoning = '';

    // Signal 1: Liquidity imbalance
    if (analysis.isImbalanced) {
      shouldTrade = true;

      if (strategyConfig.tradeIntoImbalance) {
        // Buy the scarcer token (trade into the imbalance to profit from rebalancing)
        direction =
          analysis.scarcerSide === 'token0'
            ? SwapDirection.ONE_FOR_ZERO // Buy token0 (scarce)
            : SwapDirection.ZERO_FOR_ONE; // Buy token1 (scarce)
      } else {
        // Trade out of the imbalance (sell the scarcer token)
        direction =
          analysis.scarcerSide === 'token0'
            ? SwapDirection.ZERO_FOR_ONE
            : SwapDirection.ONE_FOR_ZERO;
      }

      // Confidence based on imbalance severity
      const imbalanceSeverity = Math.min(
        (analysis.imbalanceRatio - strategyConfig.imbalanceThreshold) /
          strategyConfig.imbalanceThreshold,
        1.0
      );
      confidence = 0.3 + imbalanceSeverity * 0.4;

      reasoning = `Liquidity imbalance detected: ratio=${analysis.imbalanceRatio.toFixed(2)}, ` +
        `scarcer side=${analysis.scarcerSide}`;
    }

    // Signal 2: High volume relative to liquidity
    if (analysis.isHighVolume) {
      if (shouldTrade) {
        // Boost confidence if volume confirms
        confidence = Math.min(confidence + 0.15, 1.0);
        reasoning += `. High volume-to-liquidity ratio: ${analysis.volumeToLiquidityRatio.toFixed(3)}`;
      } else {
        // Volume-based signal alone (weaker)
        shouldTrade = true;
        confidence = 0.25;

        // In high-volume low-liquidity, expect price impact
        // Default to selling (ZERO_FOR_ONE) as high volume often means selling pressure
        direction = direction || SwapDirection.ZERO_FOR_ONE;
        reasoning = `High volume-to-liquidity ratio: ${analysis.volumeToLiquidityRatio.toFixed(3)}`;
      }
    }

    // Signal 3: Sudden liquidity change
    if (liquidityChangeSignal) {
      if (shouldTrade) {
        confidence = Math.min(confidence + 0.1, 1.0);
        reasoning += '. Sudden liquidity change detected';
      } else {
        shouldTrade = true;
        confidence = 0.2;
        // Liquidity removal often signals upcoming volatility
        // Conservative: don't trade on this signal alone unless combined
        direction = direction || SwapDirection.ZERO_FOR_ONE;
        reasoning = 'Sudden liquidity change detected - potential volatility incoming';
      }
    }

    // Final checks
    if (!shouldTrade || !direction) {
      return this.noTradeDecision(
        'No liquidity-based trading signals detected'
      );
    }

    if (confidence < strategyConfig.minConfidence) {
      return this.noTradeDecision(
        `Confidence too low: ${(confidence * 100).toFixed(1)}% < ${(strategyConfig.minConfidence * 100).toFixed(1)}%`
      );
    }

    // Calculate position size based on available liquidity
    const amountIn = this.calculateLiquidityAmount(
      analysis,
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

    const directionStr =
      direction === SwapDirection.ZERO_FOR_ONE ? 'SELL token0' : 'BUY token0';

    return {
      shouldTrade: true,
      direction,
      amountIn,
      minAmountOut,
      confidence,
      reasoning:
        reasoning +
        `. Action: ${directionStr} with ${(confidence * 100).toFixed(1)}% confidence.`,
      timestamp: now,
    };
  }

  /**
   * Analyze liquidity conditions
   */
  private analyzeLiquidity(
    marketData: MarketData,
    config: LiquidityConfig
  ): LiquidityAnalysis {
    const liquidity0 = BigInt(marketData.liquidity0 || '0');
    const liquidity1 = BigInt(marketData.liquidity1 || '0');
    const totalLiquidity = BigInt(marketData.totalLiquidity || '0');
    const volume1h = BigInt(marketData.volume1h || '0');

    // Check if pool is viable
    const minLiquidity = BigInt(config.minTotalLiquidity || '0');
    const maxLiquidity = BigInt(config.maxTotalLiquidity || '0');
    const isViable =
      totalLiquidity >= minLiquidity &&
      (maxLiquidity === BigInt(0) || totalLiquidity <= maxLiquidity);

    // Calculate imbalance ratio
    let imbalanceRatio = 1.0;
    let scarcerSide: 'token0' | 'token1' | 'balanced' = 'balanced';

    if (liquidity0 > BigInt(0) && liquidity1 > BigInt(0)) {
      if (liquidity0 > liquidity1) {
        imbalanceRatio =
          Number((liquidity0 * BigInt(1000)) / liquidity1) / 1000;
        scarcerSide = 'token1';
      } else if (liquidity1 > liquidity0) {
        imbalanceRatio =
          Number((liquidity1 * BigInt(1000)) / liquidity0) / 1000;
        scarcerSide = 'token0';
      }
    }

    const isImbalanced = imbalanceRatio >= config.imbalanceThreshold;

    // Calculate volume-to-liquidity ratio
    let volumeToLiquidityRatio = 0;
    if (totalLiquidity > BigInt(0)) {
      volumeToLiquidityRatio =
        Number((volume1h * BigInt(10000)) / totalLiquidity) / 10000;
    }
    const isHighVolume =
      volumeToLiquidityRatio >= config.volumeToLiquidityThreshold;

    return {
      imbalanceRatio,
      isImbalanced,
      scarcerSide,
      volumeToLiquidityRatio,
      isHighVolume,
      totalLiquidity,
      isViable,
    };
  }

  /**
   * Detect sudden liquidity changes
   */
  private detectLiquidityChange(
    poolId: string,
    currentLiquidityStr: string,
    thresholdPercent: number
  ): boolean {
    const previousStr = this.previousLiquidity.get(poolId);
    if (!previousStr) return false;

    const current = BigInt(currentLiquidityStr);
    const previous = BigInt(previousStr);

    if (previous === BigInt(0)) return false;

    // Calculate percentage change
    const changePercent =
      Number(((current - previous) * BigInt(10000)) / previous) / 100;

    return Math.abs(changePercent) >= thresholdPercent;
  }

  /**
   * Calculate trade amount based on liquidity analysis
   */
  private calculateLiquidityAmount(
    analysis: LiquidityAnalysis,
    confidence: number,
    config: AgentConfig,
    strategyConfig: LiquidityConfig
  ): string {
    const min = BigInt(config.tradingSettings.minAmountIn);
    const max = BigInt(config.tradingSettings.maxAmountIn);

    // Base amount as a fraction of total liquidity
    const liquidityBasedAmount =
      (analysis.totalLiquidity *
        BigInt(Math.floor(strategyConfig.positionSizeFraction * 10000))) /
      BigInt(10000);

    // Scale by confidence
    const confidenceScaled =
      (liquidityBasedAmount * BigInt(Math.floor(confidence * 100))) /
      BigInt(100);

    // Apply min/max constraints
    let amount = confidenceScaled;
    if (amount < min) amount = min;
    if (amount > max) amount = max;

    return amount.toString();
  }

  /**
   * Get liquidity configuration with defaults
   */
  private getLiquidityConfig(config: AgentConfig): LiquidityConfig {
    return {
      ...DEFAULT_LIQUIDITY_CONFIG,
      ...(config.strategy.config as Partial<LiquidityConfig>),
    };
  }

  /**
   * Get configuration schema
   */
  override getConfigSchema(): Record<string, any> {
    return {
      imbalanceThreshold: {
        type: 'number',
        default: 1.5,
        description: 'Minimum liquidity imbalance ratio to trigger a trade',
      },
      minTotalLiquidity: {
        type: 'string',
        default: '1000',
        description: 'Minimum total liquidity for a viable pool',
      },
      maxTotalLiquidity: {
        type: 'string',
        default: '0',
        description: 'Maximum total liquidity (0 = unlimited)',
      },
      volumeToLiquidityThreshold: {
        type: 'number',
        default: 0.1,
        description: 'Volume-to-liquidity ratio threshold',
      },
      cooldownPeriod: {
        type: 'number',
        default: 600,
        description: 'Cooldown period in seconds between trades',
      },
      tradeIntoImbalance: {
        type: 'boolean',
        default: true,
        description: 'Trade into the imbalance (buy scarcer token)',
      },
      minConfidence: {
        type: 'number',
        default: 0.3,
        description: 'Minimum confidence to execute a trade',
      },
      positionSizeFraction: {
        type: 'number',
        default: 0.01,
        description: 'Position size as fraction of available liquidity',
      },
      detectLiquidityChanges: {
        type: 'boolean',
        default: true,
        description: 'Detect sudden liquidity changes as signals',
      },
      liquidityChangeThreshold: {
        type: 'number',
        default: 10.0,
        description: 'Threshold for sudden liquidity change (%)',
      },
    };
  }
}
