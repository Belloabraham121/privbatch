import { BatchCoordinator, AgentReadinessSignal, BatchParameters } from '../../coordination/BatchCoordinator';
import { MOCK_POOL_ID } from '../helpers/fixtures';

describe('BatchCoordinator', () => {
  let coordinator: BatchCoordinator;

  beforeEach(() => {
    coordinator = new BatchCoordinator({
      quorum: 2,
      minTotalCommitments: 2,
      countdownMs: 100, // Fast countdown for tests
      conflictResolution: { strategy: 'median' },
    });
  });

  afterEach(() => {
    coordinator.destroy();
  });

  // ─── Agent registration ──────────────────────────────

  test('registerAgent tracks agents', () => {
    coordinator.registerAgent('agent-1');
    coordinator.registerAgent('agent-2');
    expect(coordinator.getRegisteredAgentCount()).toBe(2);
  });

  test('unregisterAgent removes agent and signals', () => {
    coordinator.registerAgent('agent-1');
    coordinator.registerAgent('agent-2');

    coordinator.signalReady({
      agentId: 'agent-1',
      poolId: MOCK_POOL_ID,
      ready: true,
      pendingCommitments: 1,
      timestamp: Date.now(),
    });

    coordinator.unregisterAgent('agent-1');
    expect(coordinator.getRegisteredAgentCount()).toBe(1);

    const state = coordinator.getPoolState(MOCK_POOL_ID);
    expect(state.readyAgents).not.toContain('agent-1');
  });

  // ─── Readiness signaling ─────────────────────────────

  test('signalReady tracks agent readiness per pool', () => {
    coordinator.registerAgent('agent-1');
    coordinator.signalReady({
      agentId: 'agent-1',
      poolId: MOCK_POOL_ID,
      ready: true,
      pendingCommitments: 2,
      timestamp: Date.now(),
    });

    const state = coordinator.getPoolState(MOCK_POOL_ID);
    expect(state.totalReady).toBe(1);
    expect(state.readyAgents).toContain('agent-1');
    expect(state.totalPendingCommitments).toBe(2);
  });

  test('signalReady(ready=false) removes signal', () => {
    coordinator.registerAgent('agent-1');
    coordinator.signalReady({
      agentId: 'agent-1',
      poolId: MOCK_POOL_ID,
      ready: true,
      pendingCommitments: 1,
      timestamp: Date.now(),
    });
    coordinator.signalReady({
      agentId: 'agent-1',
      poolId: MOCK_POOL_ID,
      ready: false,
      pendingCommitments: 0,
      timestamp: Date.now(),
    });

    const state = coordinator.getPoolState(MOCK_POOL_ID);
    expect(state.totalReady).toBe(0);
  });

  test('unknown agents are rejected', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    coordinator.signalReady({
      agentId: 'unknown',
      poolId: MOCK_POOL_ID,
      ready: true,
      pendingCommitments: 1,
      timestamp: Date.now(),
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown'));
    warnSpy.mockRestore();
  });

  // ─── Quorum & countdown ──────────────────────────────

  test('quorum triggers countdown', () => {
    coordinator.registerAgent('agent-1');
    coordinator.registerAgent('agent-2');
    coordinator.registerAgent('agent-3'); // 3 agents, quorum = 2

    coordinator.signalReady({
      agentId: 'agent-1',
      poolId: MOCK_POOL_ID,
      ready: true,
      pendingCommitments: 1,
      timestamp: Date.now(),
    });

    let state = coordinator.getPoolState(MOCK_POOL_ID);
    expect(state.quorumMet).toBe(false);
    expect(state.countdownActive).toBe(false);

    coordinator.signalReady({
      agentId: 'agent-2',
      poolId: MOCK_POOL_ID,
      ready: true,
      pendingCommitments: 1,
      timestamp: Date.now(),
    });

    state = coordinator.getPoolState(MOCK_POOL_ID);
    expect(state.quorumMet).toBe(true);
    expect(state.countdownActive).toBe(true);
  });

  test('all agents ready fires immediately without countdown', (done) => {
    coordinator = new BatchCoordinator({
      quorum: 2,
      minTotalCommitments: 2,
      countdownMs: 30000, // Long countdown — should NOT wait
    });

    coordinator.registerAgent('agent-1');
    coordinator.registerAgent('agent-2');

    coordinator.onBatchReady((poolId: string, params: BatchParameters) => {
      expect(poolId).toBe(MOCK_POOL_ID);
      expect(params.participatingAgents).toHaveLength(2);
      expect(params.totalCommitments).toBe(2);
      coordinator.destroy();
      done();
    });

    coordinator.signalReady({
      agentId: 'agent-1',
      poolId: MOCK_POOL_ID,
      ready: true,
      pendingCommitments: 1,
      timestamp: Date.now(),
    });
    coordinator.signalReady({
      agentId: 'agent-2',
      poolId: MOCK_POOL_ID,
      ready: true,
      pendingCommitments: 1,
      timestamp: Date.now(),
    });
  });

  test('countdown fires callback after delay', (done) => {
    coordinator = new BatchCoordinator({
      quorum: 2,
      minTotalCommitments: 2,
      countdownMs: 50,
    });

    coordinator.registerAgent('agent-1');
    coordinator.registerAgent('agent-2');
    coordinator.registerAgent('agent-3');

    coordinator.onBatchReady((poolId: string) => {
      expect(poolId).toBe(MOCK_POOL_ID);
      coordinator.destroy();
      done();
    });

    coordinator.signalReady({
      agentId: 'agent-1',
      poolId: MOCK_POOL_ID,
      ready: true,
      pendingCommitments: 1,
      timestamp: Date.now(),
    });
    coordinator.signalReady({
      agentId: 'agent-2',
      poolId: MOCK_POOL_ID,
      ready: true,
      pendingCommitments: 1,
      timestamp: Date.now(),
    });
    // agent-3 never signals → countdown fires after 50ms
  });

  // ─── Conflict resolution ─────────────────────────────

  test('median resolution picks middle value', () => {
    coordinator.registerAgent('agent-1');
    coordinator.registerAgent('agent-2');
    coordinator.registerAgent('agent-3');

    coordinator.signalReady({
      agentId: 'agent-1', poolId: MOCK_POOL_ID, ready: true,
      pendingCommitments: 1, preferredSlippageBps: 30, timestamp: Date.now(),
    });
    coordinator.signalReady({
      agentId: 'agent-2', poolId: MOCK_POOL_ID, ready: true,
      pendingCommitments: 1, preferredSlippageBps: 50, timestamp: Date.now(),
    });
    coordinator.signalReady({
      agentId: 'agent-3', poolId: MOCK_POOL_ID, ready: true,
      pendingCommitments: 1, preferredSlippageBps: 100, timestamp: Date.now(),
    });

    const params = coordinator.resolveBatchParameters(MOCK_POOL_ID);
    expect(params.slippageBps).toBe(50); // Median
  });

  test('mean resolution averages values', () => {
    const meanCoord = new BatchCoordinator({
      quorum: 2,
      conflictResolution: { strategy: 'mean' },
      countdownMs: 10000,
    });

    meanCoord.registerAgent('a');
    meanCoord.registerAgent('b');

    meanCoord.signalReady({
      agentId: 'a', poolId: MOCK_POOL_ID, ready: true,
      pendingCommitments: 1, preferredSlippageBps: 30, timestamp: Date.now(),
    });
    meanCoord.signalReady({
      agentId: 'b', poolId: MOCK_POOL_ID, ready: true,
      pendingCommitments: 1, preferredSlippageBps: 70, timestamp: Date.now(),
    });

    const params = meanCoord.resolveBatchParameters(MOCK_POOL_ID);
    expect(params.slippageBps).toBe(50); // (30+70)/2
    meanCoord.destroy();
  });

  // ─── withdrawReady ───────────────────────────────────

  test('withdrawReady cancels countdown if quorum lost', () => {
    coordinator.registerAgent('agent-1');
    coordinator.registerAgent('agent-2');
    coordinator.registerAgent('agent-3');

    coordinator.signalReady({
      agentId: 'agent-1', poolId: MOCK_POOL_ID, ready: true,
      pendingCommitments: 1, timestamp: Date.now(),
    });
    coordinator.signalReady({
      agentId: 'agent-2', poolId: MOCK_POOL_ID, ready: true,
      pendingCommitments: 1, timestamp: Date.now(),
    });

    let state = coordinator.getPoolState(MOCK_POOL_ID);
    expect(state.countdownActive).toBe(true);

    coordinator.withdrawReady('agent-2', MOCK_POOL_ID);
    state = coordinator.getPoolState(MOCK_POOL_ID);
    expect(state.countdownActive).toBe(false);
    expect(state.totalReady).toBe(1);
  });

  // ─── resetPool ───────────────────────────────────────

  test('resetPool clears all signals and timers', () => {
    coordinator.registerAgent('agent-1');
    coordinator.signalReady({
      agentId: 'agent-1', poolId: MOCK_POOL_ID, ready: true,
      pendingCommitments: 1, timestamp: Date.now(),
    });

    coordinator.resetPool(MOCK_POOL_ID);
    const state = coordinator.getPoolState(MOCK_POOL_ID);
    expect(state.totalReady).toBe(0);
    expect(state.countdownActive).toBe(false);
  });

  // ─── allAgentsReady ──────────────────────────────────

  test('allAgentsReady returns true when all agents signalled', () => {
    coordinator.registerAgent('a');
    coordinator.registerAgent('b');

    coordinator.signalReady({
      agentId: 'a', poolId: MOCK_POOL_ID, ready: true,
      pendingCommitments: 1, timestamp: Date.now(),
    });
    expect(coordinator.allAgentsReady(MOCK_POOL_ID)).toBe(false);

    coordinator.signalReady({
      agentId: 'b', poolId: MOCK_POOL_ID, ready: true,
      pendingCommitments: 1, timestamp: Date.now(),
    });
    // After signaling both, it would have fired immediately, resetting state
    // But allAgentsReady checks current state — after reset it's false
    // So we need to check BEFORE the callback fires
    // Use a new coordinator without a callback to test this
    const testCoord = new BatchCoordinator({ quorum: 3, countdownMs: 99999 });
    testCoord.registerAgent('x');
    testCoord.registerAgent('y');
    testCoord.signalReady({ agentId: 'x', poolId: MOCK_POOL_ID, ready: true, pendingCommitments: 1, timestamp: Date.now() });
    testCoord.signalReady({ agentId: 'y', poolId: MOCK_POOL_ID, ready: true, pendingCommitments: 1, timestamp: Date.now() });
    expect(testCoord.allAgentsReady(MOCK_POOL_ID)).toBe(true);
    testCoord.destroy();
  });
});
