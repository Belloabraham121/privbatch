import { PrivBatchHookClient, ZKProof } from '../../hooks/PrivBatchHookClient';
import { ethers } from 'ethers';
import { createMockPoolKey, createMockSwapIntent, MOCK_ADDRESSES, MOCK_POOL_ID } from '../helpers/fixtures';

// ─── Mock contract methods ────────────────────────────────────

const mockSubmitCommitment = jest.fn();
const mockSubmitCommitmentWithProof = jest.fn();
const mockSubmitReveal = jest.fn();
const mockSubmitRevealForZK = jest.fn();
const mockRevealAndBatchExecute = jest.fn();
const mockRevealAndBatchExecuteWithProofs = jest.fn();
const mockChecker = jest.fn();
const mockGetPendingCommitmentCount = jest.fn();
const mockVerifiedCommitments = jest.fn();
const mockMinCommitments = jest.fn();
const mockBatchInterval = jest.fn();

const fakeContract = {
  submitCommitment: mockSubmitCommitment,
  submitCommitmentWithProof: mockSubmitCommitmentWithProof,
  submitReveal: mockSubmitReveal,
  submitRevealForZK: mockSubmitRevealForZK,
  revealAndBatchExecute: mockRevealAndBatchExecute,
  revealAndBatchExecuteWithProofs: mockRevealAndBatchExecuteWithProofs,
  checker: mockChecker,
  getPendingCommitmentCount: mockGetPendingCommitmentCount,
  verifiedCommitments: mockVerifiedCommitments,
  MIN_COMMITMENTS: mockMinCommitments,
  BATCH_INTERVAL: mockBatchInterval,
  on: jest.fn(),
  off: jest.fn(),
  removeAllListeners: jest.fn(),
};

// Patch ethers.Contract to return our fake
jest.spyOn(ethers, 'Contract').mockImplementation(() => fakeContract as any);

const mockWallet = {
  getAddress: jest.fn().mockResolvedValue(MOCK_ADDRESSES.user),
  getNonce: jest.fn().mockResolvedValue(0),
  provider: {
    getNetwork: jest.fn().mockResolvedValue({ chainId: 84532n }),
    getTransactionReceipt: jest.fn(),
  },
} as unknown as ethers.Wallet;

describe('PrivBatchHookClient', () => {
  let client: PrivBatchHookClient;

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore the spy so it works on each call
    (ethers.Contract as unknown as jest.SpyInstance).mockImplementation(() => fakeContract as any);
    client = new PrivBatchHookClient({
      hookAddress: MOCK_ADDRESSES.hook,
      signer: mockWallet,
      provider: {} as ethers.JsonRpcProvider,
    });
  });

  // ─── Commitment submission ───────────────────────────

  test('submitCommitment sends transaction and returns result', async () => {
    const mockTx = { hash: '0xabc', wait: jest.fn().mockResolvedValue({ hash: '0xabc', blockNumber: 100, gasUsed: 50000n, status: 1 }) };
    mockSubmitCommitment.mockResolvedValue(mockTx);

    const poolKey = createMockPoolKey();
    const hash = '0x' + 'dd'.repeat(32);

    const result = await client.submitCommitment(poolKey, hash);
    expect(result.success).toBe(true);
    expect(result.hash).toBe('0xabc');
    expect(mockSubmitCommitment).toHaveBeenCalled();
  });

  test('submitCommitmentWithProof sends ZK proof', async () => {
    const mockTx = { hash: '0xdef', wait: jest.fn().mockResolvedValue({ hash: '0xdef', blockNumber: 101, gasUsed: 80000n, status: 1 }) };
    mockSubmitCommitmentWithProof.mockResolvedValue(mockTx);

    const poolKey = createMockPoolKey();
    const hash = '0x' + 'ee'.repeat(32);
    const proof: ZKProof = {
      a: ['1', '2'],
      b: [['3', '4'], ['5', '6']],
      c: ['7', '8'],
      publicSignals: ['9'],
    };

    const result = await client.submitCommitmentWithProof(poolKey, hash, proof);
    expect(result.success).toBe(true);
    expect(mockSubmitCommitmentWithProof).toHaveBeenCalled();
  });

  // ─── Reveal submission ───────────────────────────────

  test('submitReveal sends intent to hook', async () => {
    const mockTx = { hash: '0x111', wait: jest.fn().mockResolvedValue({ hash: '0x111', blockNumber: 102, gasUsed: 40000n, status: 1 }) };
    mockSubmitReveal.mockResolvedValue(mockTx);

    const poolKey = createMockPoolKey();
    const intent = createMockSwapIntent();

    const result = await client.submitReveal(poolKey, intent);
    expect(result.success).toBe(true);
    expect(mockSubmitReveal).toHaveBeenCalled();
  });

  test('submitRevealForZK sends intent with commitment hash', async () => {
    const mockTx = { hash: '0x222', wait: jest.fn().mockResolvedValue({ hash: '0x222', blockNumber: 103, gasUsed: 45000n, status: 1 }) };
    mockSubmitRevealForZK.mockResolvedValue(mockTx);

    const poolKey = createMockPoolKey();
    const intent = createMockSwapIntent();
    const commitHash = '0x' + 'ff'.repeat(32);

    const result = await client.submitRevealForZK(poolKey, commitHash, intent);
    expect(result.success).toBe(true);
    expect(mockSubmitRevealForZK).toHaveBeenCalled();
  });

  // ─── Batch execution ────────────────────────────────

  test('revealAndBatchExecute calls contract', async () => {
    const mockTx = { hash: '0x333', wait: jest.fn().mockResolvedValue({ hash: '0x333', blockNumber: 104, gasUsed: 200000n, status: 1 }) };
    mockRevealAndBatchExecute.mockResolvedValue(mockTx);

    const poolKey = createMockPoolKey();
    const hashes = ['0x' + 'aa'.repeat(32), '0x' + 'bb'.repeat(32)];

    const result = await client.revealAndBatchExecute(poolKey, hashes);
    expect(result.success).toBe(true);
    expect(mockRevealAndBatchExecute).toHaveBeenCalled();
  });

  // ─── State queries ──────────────────────────────────

  test('checker returns canExec', async () => {
    mockChecker.mockResolvedValue([true, '0x']);

    const result = await client.checker(MOCK_POOL_ID);
    expect(result.canExec).toBe(true);
    expect(mockChecker).toHaveBeenCalledWith(MOCK_POOL_ID);
  });

  test('getPendingCommitmentCount returns number', async () => {
    mockGetPendingCommitmentCount.mockResolvedValue(5n);

    const count = await client.getPendingCommitmentCount(MOCK_POOL_ID);
    expect(count).toBe(5);
  });

  test('isCommitmentVerified returns boolean', async () => {
    mockVerifiedCommitments.mockResolvedValue(true);
    const hash = '0x' + 'cc'.repeat(32);

    const result = await client.isCommitmentVerified(hash);
    expect(result).toBe(true);
    expect(mockVerifiedCommitments).toHaveBeenCalledWith(hash);
  });

  // ─── Keccak commitment hash ─────────────────────────

  test('computeKeccakCommitmentHash returns a bytes32 hex', () => {
    const intent = createMockSwapIntent();
    const hash = client.computeKeccakCommitmentHash(intent);
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/i);
  });

  test('computeKeccakCommitmentHash is deterministic', () => {
    const intent = createMockSwapIntent();
    const hash1 = client.computeKeccakCommitmentHash(intent);
    const hash2 = client.computeKeccakCommitmentHash(intent);
    expect(hash1).toBe(hash2);
  });

  test('different intents produce different hashes', () => {
    const intent1 = createMockSwapIntent({ nonce: 1 });
    const intent2 = createMockSwapIntent({ nonce: 2 });
    const hash1 = client.computeKeccakCommitmentHash(intent1);
    const hash2 = client.computeKeccakCommitmentHash(intent2);
    expect(hash1).not.toBe(hash2);
  });

  // ─── Pool ID derivation ─────────────────────────────

  test('getPoolId returns a bytes32 hex', () => {
    const poolKey = createMockPoolKey();
    const poolId = client.getPoolId(poolKey);
    expect(poolId).toMatch(/^0x[a-f0-9]{64}$/i);
  });

  // ─── Error decoding ─────────────────────────────────

  test('decodeError maps known selectors', () => {
    expect(client.decodeError('0xc06789fa')).toBe('InvalidCommitment');
    expect(client.decodeError('0x56a270ff')).toBe('SlippageExceededForUser');
    expect(client.decodeError('0x5212cba1')).toBe('CurrencyNotSettled');
  });

  test('decodeError returns Unknown for unknown selectors', () => {
    expect(client.decodeError('0x00000000')).toContain('Unknown');
  });

  // ─── Error handling ──────────────────────────────────

  test('submitCommitment returns failure on revert', async () => {
    mockSubmitCommitment.mockRejectedValue(new Error('execution reverted'));

    const poolKey = createMockPoolKey();
    const hash = '0x' + 'dd'.repeat(32);

    await expect(client.submitCommitment(poolKey, hash)).rejects.toThrow();
  });
});
