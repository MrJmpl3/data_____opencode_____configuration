import { describe, expect, it, vi } from 'vitest';

import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import {
  reconcileChildrenState,
  selectLatestTerminalEvidence,
} from '../../../../src/features/subagent-status/domain/reconcile/reconcile.ts';
import { createMergeEventState } from '../../../../src/features/subagent-status/runtime/events/merge.ts';
import { mergeRefreshStatus } from '../../../../src/features/subagent-status/runtime/refresh/orchestrator.ts';
import type { SubagentChild, SubagentState } from '../../../../src/features/subagent-status/domain/types.ts';

const child = (overrides: Partial<SubagentChild> = {}): SubagentChild => ({
  id: 'ses_child',
  title: 'Child',
  parentID: 'ses_parent',
  source: 'session',
  targetSessionID: 'ses_child',
  status: 'running',
  startedAt: '2026-06-05T10:00:00.000Z',
  updatedAt: '2026-06-05T10:01:00.000Z',
  ...overrides,
});

describe('branch-core reconcile transitions', () => {
  it('selects terminal evidence by timestamp and id tie-breaker', () => {
    const sameTime = '2026-06-05T10:02:00.000Z';
    const first = child({ id: 'tool:a', source: 'tool', status: 'done', endedAt: sameTime, updatedAt: sameTime });
    const second = child({ id: 'tool:z', source: 'tool', status: 'error', endedAt: sameTime, updatedAt: sameTime });
    expect(selectLatestTerminalEvidence([first, second]).get('ses_child')).toBe(second);
    expect(selectLatestTerminalEvidence([child({ status: 'running' })])).toEqual(new Map());
  });

  it('reopens explicitly recovered terminal rows and purges omitted terminal sessions', () => {
    const state = createEmptyState();
    state.children.ses_old = child({
      id: 'ses_old',
      targetSessionID: 'ses_old',
      status: 'done',
      endedAt: '2026-06-05T10:02:00.000Z',
      updatedAt: '2026-06-05T10:02:00.000Z',
    });
    state.children.ses_recovered = child({
      id: 'ses_recovered',
      targetSessionID: 'ses_recovered',
      status: 'done',
      endedAt: '2026-06-05T10:02:00.000Z',
      updatedAt: '2026-06-05T10:02:00.000Z',
    });
    const result = reconcileChildrenState(
      state,
      {
        data: [
          { id: 'ses_recovered', parentID: 'ses_parent', status: 'running', updatedAt: '2026-06-05T10:03:00.000Z' },
        ],
      },
      { recoverySessionIDs: new Set(['ses_recovered']), terminalRecoverySessionIDs: new Set() },
    );
    expect(result.changed).toBe(true);
    expect(result.nextState.children.ses_recovered?.status).toBe('done');
    expect(result.nextState.children.ses_old).toBeUndefined();
    expect(result.nextState.purgedSessionIDs.ses_old).toBe(true);
  });

  it('keeps newer running evidence and handles malformed prior timestamps', () => {
    const state = createEmptyState();
    state.updatedAt = 'not-a-date';
    state.children.ses_child = child({ updatedAt: '2026-06-05T10:05:00.000Z' });
    const result = reconcileChildrenState(state, {
      data: [
        {
          id: 'tool:old',
          parentID: 'ses_parent',
          source: 'tool',
          targetSessionID: 'ses_child',
          status: 'done',
          updatedAt: '2026-06-05T10:02:00.000Z',
        },
      ],
    });
    expect(result.nextState.children.ses_child?.status).toBe('running');
  });
});

describe('branch-core serialized event merge', () => {
  const metadata = { source: 'event' as const };
  const makeInput = (state: SubagentState) => {
    let live = state;
    const synced: SubagentState[] = [];
    return {
      synced,
      replace(next: SubagentState) {
        live = next;
      },
      input: {
        isDisposed: () => false,
        getCurrentState: () => live,
        getCurrentSessionId: () => 'ses_parent',
        isBufferingStartupScopedEvents: () => false,
        bufferStartupScopedEvent: vi.fn(),
        syncState: vi.fn(async (next: SubagentState) => {
          synced.push(next);
          live = next;
        }),
        createPersistMeta: () => metadata,
      },
    };
  };

  it('ignores disposed, malformed, unrelated, and unchanged events', async () => {
    const base = createEmptyState();
    const setup = makeInput(base);
    const merge = createMergeEventState(setup.input);
    await merge({ type: 'session.created', properties: { info: { id: 'ses_other', parentID: 'other' } } });
    await merge(null);
    expect(setup.synced).toHaveLength(0);
    setup.input.isDisposed = () => true;
    await merge({ type: 'session.created', properties: { info: { id: 'ses_child', parentID: 'ses_parent' } } });
    expect(setup.synced).toHaveLength(0);
  });

  it('merges new children when live state changes during persistence', async () => {
    const setup = makeInput(createEmptyState());
    let resolveSync!: () => void;
    setup.input.syncState = vi.fn(
      (next: SubagentState) =>
        new Promise<void>((resolve) => {
          setup.replace({ ...next, children: { live: child({ id: 'live' }) } });
          resolveSync = resolve;
        }),
    );
    const pending = createMergeEventState(setup.input)({
      type: 'session.created',
      properties: { info: { id: 'ses_child', parentID: 'ses_parent' } },
    });
    await Promise.resolve();
    resolveSync();
    await pending;
    expect(setup.input.syncState).toHaveBeenCalled();
  });
});

describe('branch-core refresh status merge', () => {
  it('adds new terminal and running refresh rows with authoritative evidence', () => {
    const state = createEmptyState();
    const refresh = createEmptyState();
    refresh.children.ses_done = child({
      id: 'ses_done',
      targetSessionID: 'ses_done',
      status: 'done',
      endedAt: '2026-06-05T10:02:00.000Z',
    });
    refresh.children.ses_running = child({ id: 'ses_running', targetSessionID: 'ses_running' });
    expect(mergeRefreshStatus(state, createEmptyState(), refresh, new Set(['ses_done']))).toBe(true);
    expect(state.children.ses_done?.status).toBe('done');
    expect(state.children.ses_running?.status).toBe('running');
  });

  it('skips unchanged, stale, heuristic, and older terminal refresh states', () => {
    const state = createEmptyState();
    state.children.ses_child = child({
      status: 'done',
      endedAt: '2026-06-05T10:03:00.000Z',
      updatedAt: '2026-06-05T10:03:00.000Z',
    });
    const base = structuredClone(state);
    const unchanged = structuredClone(state);
    expect(mergeRefreshStatus(state, base, unchanged)).toBe(false);

    const heuristic = createEmptyState();
    heuristic.children.ses_child = child({
      status: 'error',
      endedAt: '2026-06-05T10:04:00.000Z',
      updatedAt: '2026-06-05T10:04:00.000Z',
    });
    expect(mergeRefreshStatus(state, base, heuristic, new Set(), new Set(['ses_child']))).toBe(false);

    const older = createEmptyState();
    older.children.ses_child = child({
      status: 'error',
      endedAt: '2026-06-05T10:02:00.000Z',
      updatedAt: '2026-06-05T10:02:00.000Z',
    });
    expect(mergeRefreshStatus(state, base, older)).toBe(false);
  });

  it('accepts newer terminal and running evidence and updates the live row', () => {
    const state = createEmptyState();
    state.children.ses_child = child({ status: 'running', updatedAt: '2026-06-05T10:01:00.000Z' });
    const base = structuredClone(state);
    const refresh = createEmptyState();
    refresh.children.ses_child = child({
      status: 'done',
      endedAt: '2026-06-05T10:02:00.000Z',
      updatedAt: '2026-06-05T10:02:00.000Z',
      color: 'green',
    });
    expect(mergeRefreshStatus(state, base, refresh)).toBe(true);
    expect(state.children.ses_child).toMatchObject({ status: 'done', color: 'green' });

    const runningState = createEmptyState();
    runningState.children.ses_child = child({ status: 'running', updatedAt: '2026-06-05T10:01:00.000Z' });
    const runningBase = structuredClone(runningState);
    const runningRefresh = createEmptyState();
    runningRefresh.children.ses_child = child({ status: 'running', updatedAt: '2026-06-05T10:02:00.000Z' });
    expect(mergeRefreshStatus(runningState, runningBase, runningRefresh)).toBe(true);
  });
});
