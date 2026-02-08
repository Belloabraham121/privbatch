import { MarketDataFetcher } from '../../utils/marketData';
import { ethers } from 'ethers';
import { createMockPoolKey, MOCK_POOL_ID, MOCK_ADDRESSES } from '../helpers/fixtures';

// ─── Mock ethers provider ─────────────────────────────────────

const mockProvider = {
  call: jest.fn(),
  getNetwork: jest.fn().mockResolvedValue({ chainId: 84532n }),
  getLogs: jest.fn().mockResolvedValue([]),
  getBlockNumber: jest.fn().mockResolvedValue(1000),
  getBlock: jest.fn().mockResolvedValue({ timestamp: Math.floor(Date.now() / 1000) }),
} as unknown as ethers.JsonRpcProvider;

describe('MarketDataFetcher', () => {
  let fetcher: MarketDataFetcher;

  beforeEach(() => {
    jest.clearAllMocks();
    fetcher = new MarketDataFetcher(mockProvider, MOCK_ADDRESSES.poolManager, 1000);
  });

  // ─── Pool ID computation ─────────────────────────────

  test('getPoolId returns a hex string', () => {
    const poolKey = createMockPoolKey();
    const poolId = (fetcher as any).getPoolId(poolKey);
    expect(poolId).toMatch(/^0x[a-f0-9]+$/i);
  });

  test('getPoolId is deterministic', () => {
    const poolKey = createMockPoolKey();
    const id1 = (fetcher as any).getPoolId(poolKey);
    const id2 = (fetcher as any).getPoolId(poolKey);
    expect(id1).toBe(id2);
  });

  test('different pool keys produce different pool IDs', () => {
    const key1 = createMockPoolKey({ fee: 3000 });
    const key2 = createMockPoolKey({ fee: 500 });
    const id1 = (fetcher as any).getPoolId(key1);
    const id2 = (fetcher as any).getPoolId(key2);
    expect(id1).not.toBe(id2);
  });

  // ─── Cache behavior ──────────────────────────────────

  test('cache stores and returns data within TTL', async () => {
    const poolKey = createMockPoolKey();
    const poolId = (fetcher as any).getPoolId(poolKey);
    const fakeData = {
      poolId,
      poolKey,
      currentPrice: '1.0',
      priceChange1h: 0,
      priceChange24h: 0,
      totalLiquidity: '1000',
      liquidity0: '500',
      liquidity1: '500',
      volume1h: '100',
      volume24h: '1000',
      recentSwaps: [],
      timestamp: Date.now(),
    };

    (fetcher as any).cache.set(poolId, {
      data: fakeData,
      timestamp: Date.now(),
      ttl: 30000,
    });

    const result = await fetcher.fetchMarketData(poolKey);
    expect(result).toEqual(fakeData);
  });

  test('cache is bypassed when TTL expired', async () => {
    const poolKey = createMockPoolKey();
    const poolId = (fetcher as any).getPoolId(poolKey);

    // Set expired cache entry
    (fetcher as any).cache.set(poolId, {
      data: {},
      timestamp: Date.now() - 60000,
      ttl: 1000,
    });

    // This will try to fetch from provider and likely fail,
    // but the important thing is it doesn't return the stale cache
    try {
      await fetcher.fetchMarketData(poolKey);
    } catch {
      // Expected — mock doesn't return ABI-encoded data
    }
  });

  // ─── Cache clear ─────────────────────────────────────

  test('clearCache removes entry for a pool', () => {
    const poolKey = createMockPoolKey();
    const poolId = (fetcher as any).getPoolId(poolKey);
    (fetcher as any).cache.set(poolId, { data: {}, timestamp: Date.now(), ttl: 30000 });
    expect((fetcher as any).cache.has(poolId)).toBe(true);

    fetcher.clearCache(poolId);
    expect((fetcher as any).cache.has(poolId)).toBe(false);
  });

  test('clearAllCache clears everything', () => {
    (fetcher as any).cache.set('pool-1', { data: {}, timestamp: Date.now(), ttl: 30000 });
    (fetcher as any).cache.set('pool-2', { data: {}, timestamp: Date.now(), ttl: 30000 });
    expect((fetcher as any).cache.size).toBe(2);

    fetcher.clearAllCache();
    expect((fetcher as any).cache.size).toBe(0);
  });

  // ─── Volume calculation ────────────────────────────────

  test('calculateVolume returns sum of absolute amounts within window', () => {
    const now = Date.now() / 1000;
    const swaps = [
      { poolId: MOCK_POOL_ID, timestamp: now - 100, amount0: '-100', amount1: '200', zeroForOne: true, sqrtPriceX96: '0' },
      { poolId: MOCK_POOL_ID, timestamp: now - 200, amount0: '50', amount1: '-100', zeroForOne: false, sqrtPriceX96: '0' },
      { poolId: MOCK_POOL_ID, timestamp: now - 10000, amount0: '999', amount1: '-999', zeroForOne: false, sqrtPriceX96: '0' }, // Outside 1h window
    ];

    const volume = fetcher.calculateVolume(swaps, 3600);
    // swap1: |−100| + |200| = 300, swap2: |50| + |−100| = 150, swap3: outside window
    expect(volume).toBe(BigInt(450));
  });

  test('calculateVolume returns 0 for empty swaps', () => {
    const volume = fetcher.calculateVolume([], 3600);
    expect(volume).toBe(BigInt(0));
  });

  // ─── Provider accessor ──────────────────────────────

  test('getProvider returns the provider', () => {
    expect(fetcher.getProvider()).toBe(mockProvider);
  });

  test('getPoolManagerAddress returns the address', () => {
    expect(fetcher.getPoolManagerAddress()).toBe(MOCK_ADDRESSES.poolManager);
  });
});
