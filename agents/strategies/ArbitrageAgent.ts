/**
 * ArbitrageAgent - Trading strategy based on cross-pool price discrepancies
 *
 * This strategy monitors multiple pools trading the same or related token pairs
 * and identifies arbitrage opportunities when prices diverge beyond a configurable
 * threshold. It then trades to capture the price difference.
 *
 * Key features:
 * - Cross-pool price comparison with configurable spreads
 * - Supports multiple reference pools for price discovery
 * - Gas-aware profitability calculation
 * - Configurable minimum profit thresholds
 * - Cooldown and rate limiting
 * - Liquidity depth checks to ensure trade feasibility
 */

import {
  MarketData,
  TradeDecision,
  AgentConfig,
  SwapDirection,
} from '../types/interfaces';
import { BaseStrategy } from './BaseStrategy';

/**
 * Reference price from another pool or external source
 */
export interface ReferencePrice {
  source: string; // e.g., 'pool-0x...', 'chainlink', 'coingecko'
  price: string; // Price as string (token1/token0)
  timestamp: number;
  confidence: number; // 0-1, how reliable this source is
}

/**
 * Configuration for the Arbitrage strategy
 */
export interface ArbitrageConfig {
  /** Minimum price spread (%) to trigger an arbitrage trade (default: 0.3%) */
  minSpreadThreshold: number;
  /** Maximum price spread (%) - above this, the opportunity may be suspicious (default: 10%) */
  maxSpreadThreshold: number;
  /** Estimated gas cost in token units for profitability calculation (default: '0') */
  estimatedGasCost: string;
  /** Minimum net profit (after gas) in token units (default: '0') */
  minNetProfit: string;
  /** Reference prices from other pools or oracles */
  referencePrices: ReferencePrice[];
  /** Cooldown period in seconds between arbitrage trades (default: 60) */
  cooldownPeriod: number;
  /** Minimum liquidity in the pool to attempt arbitrage (default: '0') */
  minLiquidity: string;
  /** Maximum slippage tolerance in basis points (default: 30 = 0.3%) */
  maxSlippageBps: number;
  /** Weight for each reference price source (source -> weight) */
  sourceWeights: Record<string, number>;
  /** Whether to enable cross-pool arbitrage detection (default: true) */
  enableCrossPoolArbitrage: boolean;
}

const DEFAULT_ARBITRAGE_CONFIG: ArbitrageConfig = {
  minSpreadThreshold: 0.3,
  maxSpreadThreshold: 10.0,
  estimatedGasCost: '0',
  minNetProfit: '0',
  referencePrices: [],
  cooldownPeriod: 60,
  minLiquidity: '0',
  maxSlippageBps: 30,
  sourceWeights: {},
  enableCrossPoolArbitrage: true,
};

/**
 * Detected arbitrage opportunity
 */
interface ArbitrageOpportunity {
  spreadPercent: number;
  direction: SwapDirection;
  referencePrice: string;
  currentPrice: string;
  estimatedProfit: string;
  source: string;
  confidence: number;
}

export class ArbitrageAgent extends BaseStrategy {
  name = 'arbitrage';
  private externalReferencePrices: Map<string, ReferencePrice[]> = new Map(); // poolId -> prices

  /**
   * Set reference prices for a pool from an external source
   * Call this periodically to update reference prices from other pools or oracles
   */
  updateReferencePrices(poolId: string, prices: ReferencePrice[]): void {
    this.externalReferencePrices.set(poolId, prices);
  }

  /**
   * Evaluate market data and decide whether to trade based on arbitrage opportunities
   */
  async shouldTrade(
    marketData: MarketData,
    config: AgentConfig
  ): Promise<TradeDecision> {
    const strategyConfig = this.getArbitrageConfig(config);
    const now = Date.now();

    // Check cooldown
    const lastTrade = this.lastTradeTimestamp.get(marketData.poolId) || 0;
    if (now - lastTrade < strategyConfig.cooldownPeriod * 1000) {
      return this.noTradeDecision('Cooldown period active');
    }

    // Check minimum liquidity
    const totalLiquidity = BigInt(marketData.totalLiquidity || '0');
    const minLiquidity = BigInt(strategyConfig.minLiquidity || '0');
    if (totalLiquidity < minLiquidity) {
      return this.noTradeDecision(
        `Insufficient liquidity: ${totalLiquidity.toString()} < ${minLiquidity.toString()}`
      );
    }

    // Collect all reference prices
    const referencePrices = this.collectReferencePrices(
      marketData.poolId,
      strategyConfig
    );

    if (referencePrices.length === 0) {
      return this.noTradeDecision('No reference prices available for arbitrage detection');
    }

    // Detect arbitrage opportunities
    const opportunities = this.detectOpportunities(
      marketData.currentPrice,
      referencePrices,
      strategyConfig
    );

    if (opportunities.length === 0) {
      return this.noTradeDecision('No arbitrage opportunities detected');
    }

    // Select the best opportunity
    const bestOpportunity = this.selectBestOpportunity(opportunities);

    // Check profitability after gas costs
    const isProfitable = this.checkProfitability(bestOpportunity, strategyConfig);
    if (!isProfitable) {
      return this.noTradeDecision(
        `Opportunity not profitable after gas: spread=${bestOpportunity.spreadPercent.toFixed(3)}%, ` +
        `est. profit=${bestOpportunity.estimatedProfit}`
      );
    }

    // Calculate trade amount
    const baseAmount = this.calculateArbitrageAmount(
      bestOpportunity,
      marketData,
      config
    );

    // Calculate min amount out
    const minAmountOut = await this.calculateMinAmountOut(
      baseAmount,
      marketData,
      bestOpportunity.direction,
      strategyConfig.maxSlippageBps
    );

    // Update last trade timestamp
    this.lastTradeTimestamp.set(marketData.poolId, now);

    return {
      shouldTrade: true,
      direction: bestOpportunity.direction,
      amountIn: baseAmount,
      minAmountOut,
      confidence: bestOpportunity.confidence,
      reasoning: this.buildReasoning(bestOpportunity, referencePrices.length),
      timestamp: now,
    };
  }

  /**
   * Collect reference prices from config and external sources
   */
  private collectReferencePrices(
    poolId: string,
    config: ArbitrageConfig
  ): ReferencePrice[] {
    const prices: ReferencePrice[] = [];

    // Add configured reference prices
    if (config.referencePrices && config.referencePrices.length > 0) {
      prices.push(...config.referencePrices);
    }

    // Add external reference prices (set via updateReferencePrices)
    const external = this.externalReferencePrices.get(poolId);
    if (external) {
      prices.push(...external);
    }

    // Filter out stale prices (older than 5 minutes)
    const now = Date.now();
    const freshPrices = prices.filter(
      (p) => now - p.timestamp < 5 * 60 * 1000
    );

    return freshPrices;
  }

  /**
   * Detect arbitrage opportunities from reference prices
   */
  private detectOpportunities(
    currentPriceStr: string,
    referencePrices: ReferencePrice[],
    config: ArbitrageConfig
  ): ArbitrageOpportunity[] {
    const currentPrice = parseFloat(currentPriceStr);
    if (currentPrice <= 0 || isNaN(currentPrice)) {
      return [];
    }

    const opportunities: ArbitrageOpportunity[] = [];

    for (const ref of referencePrices) {
      const refPrice = parseFloat(ref.price);
      if (refPrice <= 0 || isNaN(refPrice)) continue;

      // Calculate spread as percentage
      const spreadPercent = ((refPrice - currentPrice) / currentPrice) * 100;
      const absSpread = Math.abs(spreadPercent);

      // Check thresholds
      if (absSpread < config.minSpreadThreshold) continue;
      if (absSpread > config.maxSpreadThreshold) continue;

      // Determine direction:
      // If reference price > current price, the pool is underpriced
      //   → Buy from pool (ONE_FOR_ZERO) to sell elsewhere
      // If reference price < current price, the pool is overpriced
      //   → Sell to pool (ZERO_FOR_ONE) to buy elsewhere
      const direction =
        spreadPercent > 0
          ? SwapDirection.ONE_FOR_ZERO
          : SwapDirection.ZERO_FOR_ONE;

      // Estimate profit (simplified: spread * base amount)
      // Actual profit depends on trade size and liquidity depth
      const estimatedProfit = (absSpread / 100).toFixed(6);

      // Calculate confidence from spread size, source reliability, and source weight
      const sourceWeight = config.sourceWeights[ref.source] || 1.0;
      const confidence = Math.min(
        (absSpread / (config.minSpreadThreshold * 5)) *
          ref.confidence *
          sourceWeight,
        1.0
      );

      opportunities.push({
        spreadPercent: absSpread,
        direction,
        referencePrice: ref.price,
        currentPrice: currentPriceStr,
        estimatedProfit,
        source: ref.source,
        confidence: Math.max(confidence, 0.1),
      });
    }

    return opportunities;
  }

  /**
   * Select the best arbitrage opportunity
   * Ranks by: profitability * confidence
   */
  private selectBestOpportunity(
    opportunities: ArbitrageOpportunity[]
  ): ArbitrageOpportunity {
    return opportunities.sort(
      (a, b) =>
        b.spreadPercent * b.confidence - a.spreadPercent * a.confidence
    )[0];
  }

  /**
   * Check if the opportunity is profitable after gas costs
   */
  private checkProfitability(
    opportunity: ArbitrageOpportunity,
    config: ArbitrageConfig
  ): boolean {
    const estimatedProfit = parseFloat(opportunity.estimatedProfit);
    const gasCost = parseFloat(config.estimatedGasCost || '0');
    const minNetProfit = parseFloat(config.minNetProfit || '0');

    const netProfit = estimatedProfit - gasCost;
    return netProfit >= minNetProfit;
  }

  /**
   * Calculate trade amount for arbitrage
   * Larger spreads warrant larger position sizes
   */
  private calculateArbitrageAmount(
    opportunity: ArbitrageOpportunity,
    _marketData: MarketData,
    config: AgentConfig
  ): string {
    const min = BigInt(config.tradingSettings.minAmountIn);
    const max = BigInt(config.tradingSettings.maxAmountIn);
    const range = max - min;

    // Scale with confidence and spread size
    const scaleFactor = Math.min(
      opportunity.confidence * (opportunity.spreadPercent / 2),
      1.0
    );
    const amount =
      min + (range * BigInt(Math.floor(scaleFactor * 100))) / BigInt(100);

    return amount.toString();
  }

  /**
   * Build reasoning string
   */
  private buildReasoning(
    opportunity: ArbitrageOpportunity,
    totalSources: number
  ): string {
    const directionStr =
      opportunity.direction === SwapDirection.ZERO_FOR_ONE
        ? 'SELL token0 (pool overpriced)'
        : 'BUY token0 (pool underpriced)';

    return (
      `Arbitrage opportunity detected from ${totalSources} source(s). ` +
      `Source: ${opportunity.source}. ` +
      `Current price: ${opportunity.currentPrice}, ` +
      `Reference price: ${opportunity.referencePrice}. ` +
      `Spread: ${opportunity.spreadPercent.toFixed(3)}%. ` +
      `Action: ${directionStr} with ${(opportunity.confidence * 100).toFixed(1)}% confidence.`
    );
  }

  /**
   * Get arbitrage configuration with defaults
   */
  private getArbitrageConfig(config: AgentConfig): ArbitrageConfig {
    return {
      ...DEFAULT_ARBITRAGE_CONFIG,
      ...(config.strategy.config as Partial<ArbitrageConfig>),
    };
  }

  /**
   * Get configuration schema
   */
  override getConfigSchema(): Record<string, any> {
    return {
      minSpreadThreshold: {
        type: 'number',
        default: 0.3,
        description: 'Minimum price spread (%) to trigger an arbitrage trade',
      },
      maxSpreadThreshold: {
        type: 'number',
        default: 10.0,
        description: 'Maximum price spread (%) - above this, the opportunity may be suspicious',
      },
      estimatedGasCost: {
        type: 'string',
        default: '0',
        description: 'Estimated gas cost in token units',
      },
      minNetProfit: {
        type: 'string',
        default: '0',
        description: 'Minimum net profit (after gas) in token units',
      },
      referencePrices: {
        type: 'array',
        default: [],
        description: 'Reference prices from other pools or oracles',
      },
      cooldownPeriod: {
        type: 'number',
        default: 60,
        description: 'Cooldown period in seconds between arbitrage trades',
      },
      minLiquidity: {
        type: 'string',
        default: '0',
        description: 'Minimum liquidity in the pool',
      },
      maxSlippageBps: {
        type: 'number',
        default: 30,
        description: 'Maximum slippage in basis points',
      },
      sourceWeights: {
        type: 'object',
        default: {},
        description: 'Weight for each reference price source',
      },
      enableCrossPoolArbitrage: {
        type: 'boolean',
        default: true,
        description: 'Enable cross-pool arbitrage detection',
      },
    };
  }
}
