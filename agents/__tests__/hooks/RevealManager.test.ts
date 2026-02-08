import { RevealManager, RevealData } from '../../hooks/RevealManager';
import { PrivBatchHookClient } from '../../hooks/PrivBatchHookClient';
import { createMockSwapIntent, createMockPoolKey, MOCK_POOL_ID } from '../helpers/fixtures';
import { ethers } from 'ethers';

// ─── Mock HookClient ──────────────────────────────────────────

const mockSubmitReveal = jest.fn();
const mockSubmitRevealForZK = jest.fn();
const mockComputeKeccakCommitmentHash = jest.fn().mockReturnValue('0x' + 'ab'.repeat(32));

const mockHookClient = {
  submitReveal: mockSubmitReveal,
  submitRevealForZK: mockSubmitRevealForZK,
  computeKeccakCommitmentHash: mockComputeKeccakCommitmentHash,
} as unknown as PrivBatchHookClient;

describe('RevealManager', () => {
  let manager: RevealManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new RevealManager(mockHookClient, { submissionDelayMs: 0 });
  });

  // ─── Reveal collection ──────────────────────────────

  test('addReveal stores a reveal', () => {
    const hash = '0x' + 'aa'.repeat(32);
    const intent = createMockSwapIntent();
    const poolKey = createMockPoolKey();

    manager.addReveal(hash, intent, poolKey, MOCK_POOL_ID, false);

    const reveals = manager.getRevealsForPool(MOCK_POOL_ID);
    expect(reveals).toHaveLength(1);
    expect(reveals[0].commitmentHash).toBe(hash);
  });

  test('addReveal ignores duplicates', () => {
    const hash = '0x' + 'aa'.repeat(32);
    const intent = createMockSwapIntent();
    const poolKey = createMockPoolKey();

    manager.addReveal(hash, intent, poolKey, MOCK_POOL_ID, false);
    manager.addReveal(hash, intent, poolKey, MOCK_POOL_ID, false);

    const reveals = manager.getRevealsForPool(MOCK_POOL_ID);
    expect(reveals).toHaveLength(1);
  });

  test('addReveal from multiple agents accumulates', () => {
    const hash1 = '0x' + 'aa'.repeat(32);
    const hash2 = '0x' + 'bb'.repeat(32);
    const intent1 = createMockSwapIntent({ nonce: 1 });
    const intent2 = createMockSwapIntent({ nonce: 2 });
    const poolKey = createMockPoolKey();

    manager.addReveal(hash1, intent1, poolKey, MOCK_POOL_ID, false);
    manager.addReveal(hash2, intent2, poolKey, MOCK_POOL_ID, true);

    const reveals = manager.getRevealsForPool(MOCK_POOL_ID);
    expect(reveals).toHaveLength(2);
  });

  // ─── Reveal validation ──────────────────────────────

  test('validateReveal catches expired deadline', () => {
    const expired = createMockSwapIntent({
      deadline: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    });
    const revealData: RevealData = {
      commitmentHash: '0x' + 'aa'.repeat(32),
      intent: expired,
      poolKey: createMockPoolKey(),
      poolId: MOCK_POOL_ID,
      isZKVerified: true,
      submittedOnChain: false,
    };
    const result = manager.validateReveal(revealData);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('deadline'))).toBe(true);
  });

  test('validateReveal accepts valid ZK intent', () => {
    const valid = createMockSwapIntent();
    const revealData: RevealData = {
      commitmentHash: '0x' + 'aa'.repeat(32),
      intent: valid,
      poolKey: createMockPoolKey(),
      poolId: MOCK_POOL_ID,
      isZKVerified: true, // ZK skips hash check
      submittedOnChain: false,
    };
    const result = manager.validateReveal(revealData);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('validateReveal catches zero amountIn', () => {
    const zeroAmt = createMockSwapIntent({ amountIn: '0' });
    const revealData: RevealData = {
      commitmentHash: '0x' + 'aa'.repeat(32),
      intent: zeroAmt,
      poolKey: createMockPoolKey(),
      poolId: MOCK_POOL_ID,
      isZKVerified: true,
      submittedOnChain: false,
    };
    const result = manager.validateReveal(revealData);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('amount'))).toBe(true);
  });

  // ─── On-chain submission ────────────────────────────

  test('submitAllReveals calls submitRevealForZK for ZK reveals', async () => {
    mockSubmitRevealForZK.mockResolvedValue({ hash: '0xtx1', success: true, blockNumber: 1, gasUsed: 50000n });

    const hash = '0x' + 'aa'.repeat(32);
    const intent = createMockSwapIntent();
    const poolKey = createMockPoolKey();

    manager.addReveal(hash, intent, poolKey, MOCK_POOL_ID, true);

    const results = await manager.submitAllReveals();
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(mockSubmitRevealForZK).toHaveBeenCalled();
  });

  test('submitAllReveals calls submitReveal for non-ZK reveals', async () => {
    // For non-ZK, validateReveal checks keccak hash
    mockComputeKeccakCommitmentHash.mockReturnValue('0x' + 'bb'.repeat(32));
    mockSubmitReveal.mockResolvedValue({ hash: '0xtx2', success: true, blockNumber: 1, gasUsed: 50000n });

    const hash = '0x' + 'bb'.repeat(32); // Must match computed
    const intent = createMockSwapIntent();
    const poolKey = createMockPoolKey();

    manager.addReveal(hash, intent, poolKey, MOCK_POOL_ID, false);

    const results = await manager.submitAllReveals();
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(mockSubmitReveal).toHaveBeenCalled();
  });

  test('submitAllReveals returns empty when nothing pending', async () => {
    const results = await manager.submitAllReveals();
    expect(results).toHaveLength(0);
  });

  // ─── Get reveals for pool ───────────────────────────

  test('getRevealsForPool returns all reveals for a pool', () => {
    const hash1 = '0x' + 'aa'.repeat(32);
    const hash2 = '0x' + 'bb'.repeat(32);
    const poolKey = createMockPoolKey();

    manager.addReveal(hash1, createMockSwapIntent({ nonce: 1 }), poolKey, MOCK_POOL_ID, false);
    manager.addReveal(hash2, createMockSwapIntent({ nonce: 2 }), poolKey, MOCK_POOL_ID, true);

    const reveals = manager.getRevealsForPool(MOCK_POOL_ID);
    expect(reveals).toHaveLength(2);
  });

  // ─── Clear ──────────────────────────────────────────

  test('clearPool removes all reveals for a pool', () => {
    const poolKey = createMockPoolKey();
    manager.addReveal('0x' + 'aa'.repeat(32), createMockSwapIntent(), poolKey, MOCK_POOL_ID, false);

    expect(manager.getRevealsForPool(MOCK_POOL_ID)).toHaveLength(1);
    manager.clearPool(MOCK_POOL_ID);
    expect(manager.getRevealsForPool(MOCK_POOL_ID)).toHaveLength(0);
  });

  test('clearAll removes everything', () => {
    const poolKey = createMockPoolKey();
    manager.addReveal('0x' + 'aa'.repeat(32), createMockSwapIntent({ nonce: 1 }), poolKey, MOCK_POOL_ID, false);
    manager.addReveal('0x' + 'bb'.repeat(32), createMockSwapIntent({ nonce: 2 }), poolKey, 'other-pool', false);

    manager.clearAll();
    expect(manager.getPendingCount()).toBe(0);
  });

  // ─── Submitted hashes ───────────────────────────────

  test('getSubmittedHashesForPool returns only submitted reveals', () => {
    const poolKey = createMockPoolKey();
    manager.addReveal('0x' + 'aa'.repeat(32), createMockSwapIntent(), poolKey, MOCK_POOL_ID, false);

    // Not submitted yet
    expect(manager.getSubmittedHashesForPool(MOCK_POOL_ID)).toHaveLength(0);
  });
});
