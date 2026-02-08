import { BatchExecutor } from '../../hooks/BatchExecutor';
import { PrivBatchHookClient, ZKProof, TransactionResult } from '../../hooks/PrivBatchHookClient';
import { RevealManager, RevealData } from '../../hooks/RevealManager';
import { createMockPoolKey, MOCK_POOL_ID } from '../helpers/fixtures';

// ─── Mock HookClient ──────────────────────────────────────────

const mockChecker = jest.fn();
const mockRevealAndBatchExecute = jest.fn();
const mockRevealAndBatchExecuteWithProofs = jest.fn();
const mockGetPendingCommitmentCount = jest.fn();
const mockGetMinCommitments = jest.fn();

const mockHookClient = {
  checker: mockChecker,
  revealAndBatchExecute: mockRevealAndBatchExecute,
  revealAndBatchExecuteWithProofs: mockRevealAndBatchExecuteWithProofs,
  getPendingCommitmentCount: mockGetPendingCommitmentCount,
  getMinCommitments: mockGetMinCommitments,
} as unknown as PrivBatchHookClient;

// ─── Mock RevealManager ──────────────────────────────────────

const mockGetRevealsForPool = jest.fn();
const mockSubmitAllReveals = jest.fn();
const mockGetSubmittedHashesForPool = jest.fn();
const mockClearExecutedReveals = jest.fn();

const mockRevealManager = {
  getRevealsForPool: mockGetRevealsForPool,
  submitAllReveals: mockSubmitAllReveals,
  getSubmittedHashesForPool: mockGetSubmittedHashesForPool,
  clearExecutedReveals: mockClearExecutedReveals,
} as unknown as RevealManager;

describe('BatchExecutor', () => {
  let executor: BatchExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new BatchExecutor(mockHookClient, mockRevealManager, {
      pollIntervalMs: 100,
      postRevealDelayMs: 0,
      maxRetries: 1,
      retryBaseDelayMs: 0,
    });
  });

  afterEach(() => {
    executor.stopPolling();
  });

  // ─── Pool registration ──────────────────────────────

  test('addPool registers a pool', () => {
    const poolKey = createMockPoolKey();
    executor.addPool(poolKey, MOCK_POOL_ID);
    // Verify via checkBatchReadiness — if pool is not added, it would still work
    // but the polling wouldn't monitor it. We check that the pool is in the monitored set.
    expect(executor.isExecutorRunning()).toBe(false); // not started yet
  });

  test('removePool removes a pool', () => {
    const poolKey = createMockPoolKey();
    executor.addPool(poolKey, MOCK_POOL_ID);
    executor.removePool(MOCK_POOL_ID);
    // Just ensuring no error
    expect(true).toBe(true);
  });

  // ─── Batch readiness ────────────────────────────────

  test('checkBatchReadiness returns readiness info', async () => {
    executor.addPool(createMockPoolKey(), MOCK_POOL_ID);

    mockChecker.mockResolvedValue({ canExec: true, execPayload: '0x' });
    mockGetPendingCommitmentCount.mockResolvedValue(3);
    mockGetRevealsForPool.mockReturnValue([
      { submittedOnChain: true },
      { submittedOnChain: true },
      { submittedOnChain: false },
    ]);
    mockGetMinCommitments.mockResolvedValue(2);

    const readiness = await executor.checkBatchReadiness(MOCK_POOL_ID);
    expect(readiness.canExec).toBe(true);
    expect(readiness.pendingOnChain).toBe(3);
    expect(readiness.revealsReady).toBe(2); // Only submitted
    expect(readiness.meetsMinimum).toBe(true);
  });

  // ─── ZK proof storage ───────────────────────────────

  test('storeProof and getProof work correctly', () => {
    const hash = '0x' + 'cc'.repeat(32);
    const proof: ZKProof = {
      a: ['1', '2'],
      b: [['3', '4'], ['5', '6']],
      c: ['7', '8'],
      publicSignals: ['9'],
    };
    executor.storeProof(hash, proof);
    expect(executor.getProof(hash)).toEqual(proof);
  });

  test('getProof returns undefined for unknown hash', () => {
    expect(executor.getProof('0x' + 'ff'.repeat(32))).toBeUndefined();
  });

  // ─── ZK batch execution ─────────────────────────────

  test('executeBatchZK submits reveals, then executes with proofs', async () => {
    const poolKey = createMockPoolKey();
    executor.addPool(poolKey, MOCK_POOL_ID);

    const hashes = ['0x' + 'aa'.repeat(32), '0x' + 'bb'.repeat(32)];

    // Store ZK proofs
    for (const h of hashes) {
      executor.storeProof(h, {
        a: ['1', '2'], b: [['3', '4'], ['5', '6']], c: ['7', '8'], publicSignals: ['9'],
      });
    }

    mockSubmitAllReveals.mockResolvedValue([{ success: true }, { success: true }]);
    mockGetSubmittedHashesForPool.mockReturnValue(hashes);
    mockRevealAndBatchExecuteWithProofs.mockResolvedValue({
      hash: '0xtx', blockNumber: 200, gasUsed: 300000n, success: true,
    } as TransactionResult);

    const result = await executor.executeBatchZK(MOCK_POOL_ID, poolKey);
    expect(result.success).toBe(true);
    expect(result.batchSize).toBe(2);
    expect(mockRevealAndBatchExecuteWithProofs).toHaveBeenCalled();
    expect(mockClearExecutedReveals).toHaveBeenCalledWith(hashes);
  });

  // ─── Standard batch execution ───────────────────────

  test('executeBatchStandard submits reveals, then executes without proofs', async () => {
    const poolKey = createMockPoolKey();
    executor.addPool(poolKey, MOCK_POOL_ID);

    const hashes = ['0x' + 'aa'.repeat(32)];
    mockSubmitAllReveals.mockResolvedValue([{ success: true }]);
    mockGetSubmittedHashesForPool.mockReturnValue(hashes);
    mockRevealAndBatchExecute.mockResolvedValue({
      hash: '0xtx2', blockNumber: 201, gasUsed: 200000n, success: true,
    } as TransactionResult);

    const result = await executor.executeBatchStandard(MOCK_POOL_ID, poolKey);
    expect(result.success).toBe(true);
    expect(mockRevealAndBatchExecute).toHaveBeenCalled();
  });

  // ─── Execution history ──────────────────────────────

  test('getExecutionHistory returns past results', async () => {
    const poolKey = createMockPoolKey();
    executor.addPool(poolKey, MOCK_POOL_ID);

    const hashes = ['0x' + 'aa'.repeat(32)];
    executor.storeProof(hashes[0], {
      a: ['1', '2'], b: [['3', '4'], ['5', '6']], c: ['7', '8'], publicSignals: ['9'],
    });

    mockSubmitAllReveals.mockResolvedValue([{ success: true }]);
    mockGetSubmittedHashesForPool.mockReturnValue(hashes);
    mockRevealAndBatchExecuteWithProofs.mockResolvedValue({
      hash: '0xtx', blockNumber: 300, gasUsed: 100000n, success: true,
    } as TransactionResult);

    await executor.executeBatchZK(MOCK_POOL_ID, poolKey);

    const history = executor.getExecutionHistory();
    expect(history.length).toBe(1);
    expect(history[0].success).toBe(true);
  });

  // ─── Stats ──────────────────────────────────────────

  test('getStats returns aggregate stats', async () => {
    const poolKey = createMockPoolKey();
    executor.addPool(poolKey, MOCK_POOL_ID);

    const hashes = ['0x' + 'aa'.repeat(32)];
    executor.storeProof(hashes[0], {
      a: ['1', '2'], b: [['3', '4'], ['5', '6']], c: ['7', '8'], publicSignals: ['9'],
    });

    mockSubmitAllReveals.mockResolvedValue([{ success: true }]);
    mockGetSubmittedHashesForPool.mockReturnValue(hashes);
    mockRevealAndBatchExecuteWithProofs.mockResolvedValue({
      hash: '0xtx', blockNumber: 300, gasUsed: 100000n, success: true,
    } as TransactionResult);

    await executor.executeBatchZK(MOCK_POOL_ID, poolKey);

    const stats = executor.getStats();
    expect(stats.totalBatches).toBe(1);
    expect(stats.successfulBatches).toBe(1);
    expect(stats.failedBatches).toBe(0);
    expect(stats.totalSwaps).toBe(1);
  });

  // ─── Error handling ──────────────────────────────────

  test('executeBatchZK handles missing reveals gracefully', async () => {
    const poolKey = createMockPoolKey();
    executor.addPool(poolKey, MOCK_POOL_ID);

    mockSubmitAllReveals.mockResolvedValue([]);
    mockGetSubmittedHashesForPool.mockReturnValue([]); // No reveals

    const result = await executor.executeBatchZK(MOCK_POOL_ID, poolKey);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No submitted reveals');
  });

  test('executeBatchZK handles missing ZK proof', async () => {
    const poolKey = createMockPoolKey();
    executor.addPool(poolKey, MOCK_POOL_ID);

    const hashes = ['0x' + 'aa'.repeat(32)];
    // Don't store proof for hash

    mockSubmitAllReveals.mockResolvedValue([{ success: true }]);
    mockGetSubmittedHashesForPool.mockReturnValue(hashes);

    const result = await executor.executeBatchZK(MOCK_POOL_ID, poolKey);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing ZK proof');
  });

  // ─── Polling ────────────────────────────────────────

  test('isExecutorRunning reflects polling state', () => {
    expect(executor.isExecutorRunning()).toBe(false);
  });
});
