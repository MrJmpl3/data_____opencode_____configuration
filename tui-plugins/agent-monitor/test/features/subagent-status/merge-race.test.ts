import { describe, expect, it, vi } from 'vitest';

import { createEmptyState } from '../../../src/features/subagent-status/domain/state/core.ts';
import type { SubagentState } from '../../../src/features/subagent-status/domain/types.ts';
import { createMergeEventState } from '../../../src/features/subagent-status/runtime/events/merge.ts';
import type { PersistSnapshotMeta } from '../../../src/features/subagent-status/runtime/snapshot.ts';
import { mergeRefreshStatus } from '../../../src/features/subagent-status/runtime/refresh/orchestrator.ts';

const CREATED_AT = '2026-06-05T10:00:00.000Z';

type SyncStateFn = (nextState: SubagentState, meta: PersistSnapshotMeta) => Promise<void>;

const sessionCreatedEvent = (id: string, parentID: string) => ({
  type: 'session.created' as const,
  properties: {
    sessionID: parentID,
    info: { id, parentID, title: `Child ${id}`, time: { created: CREATED_AT } },
  },
});

describe('mergeEventState race guard', () => {
  it('processes events for an already monitored child session', async () => {
    let liveState = createEmptyState();
    liveState.children.ses_child = {
      id: 'ses_child',
      title: 'Child ses_child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      color: 'yellow',
      startedAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
    const syncState = vi.fn<SyncStateFn>(async (nextState) => {
      liveState = nextState;
    });
    const mergeEvent = createMergeEventState({
      isDisposed: () => false,
      getCurrentState: () => liveState,
      getCurrentSessionId: () => 'ses_parent',
      isBufferingStartupScopedEvents: () => false,
      bufferStartupScopedEvent: () => {},
      syncState,
      createPersistMeta: (source) => ({ source, lastEventType: 'test', bufferedEventCount: 0 }),
    });

    await mergeEvent({
      type: 'session.status',
      properties: {
        sessionID: 'ses_child',
        status: 'running',
        info: { time: { updated: '2026-06-05T10:02:00.000Z' } },
      },
    });

    expect(syncState).toHaveBeenCalledTimes(1);
    expect(liveState.children.ses_child).toMatchObject({ status: 'running', updatedAt: '2026-06-05T10:02:00.000Z' });
  });

  it('ignores events for an unrelated session', async () => {
    const liveState = createEmptyState();
    const syncState = vi.fn<SyncStateFn>(async () => {});
    const mergeEvent = createMergeEventState({
      isDisposed: () => false,
      getCurrentState: () => liveState,
      getCurrentSessionId: () => 'ses_parent',
      isBufferingStartupScopedEvents: () => false,
      bufferStartupScopedEvent: () => {},
      syncState,
      createPersistMeta: (source) => ({ source, lastEventType: 'test', bufferedEventCount: 0 }),
    });

    await mergeEvent({
      type: 'session.created',
      properties: {
        sessionID: 'ses_unrelated',
        info: { id: 'ses_unrelated', parentID: 'ses_other', time: { created: CREATED_AT } },
      },
    });

    expect(syncState).not.toHaveBeenCalled();
    expect(liveState.children).toEqual({});
  });

  it('ignores an unrelated message part that only identifies its owning session', async () => {
    const liveState = createEmptyState();
    const syncState = vi.fn<SyncStateFn>(async () => {});
    const mergeEvent = createMergeEventState({
      isDisposed: () => false,
      getCurrentState: () => liveState,
      getCurrentSessionId: () => 'ses_parent',
      isBufferingStartupScopedEvents: () => false,
      bufferStartupScopedEvent: () => {},
      syncState,
      createPersistMeta: (source) => ({ source, lastEventType: 'test', bufferedEventCount: 0 }),
    });

    await mergeEvent({
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'subtask',
          id: 'foreign_part',
          sessionID: 'ses_foreign',
          description: 'Foreign task',
        },
      },
    });

    expect(syncState).not.toHaveBeenCalled();
    expect(liveState.children).toEqual({});
  });

  it('recovers a missing child from a direct session.updated event', async () => {
    let liveState = createEmptyState();
    const syncState = vi.fn<SyncStateFn>(async (nextState) => {
      liveState = nextState;
    });
    const mergeEvent = createMergeEventState({
      isDisposed: () => false,
      getCurrentState: () => liveState,
      getCurrentSessionId: () => 'ses_parent',
      isBufferingStartupScopedEvents: () => false,
      bufferStartupScopedEvent: () => {},
      syncState,
      createPersistMeta: (source) => ({ source, lastEventType: 'test', bufferedEventCount: 0 }),
    });

    await mergeEvent({
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_recovered',
          parentID: 'ses_parent',
          title: 'Recovered child',
          time: { updated: '2026-06-05T10:02:00.000Z' },
        },
      },
    });

    expect(syncState).toHaveBeenCalledTimes(1);
    expect(liveState.children.ses_recovered).toMatchObject({
      id: 'ses_recovered',
      parentID: 'ses_parent',
      title: 'Recovered child',
      status: 'running',
    });
  });

  it('persists the event normally when live state does not change during processing', async () => {
    let liveState: SubagentState = createEmptyState();
    const syncState = vi.fn<SyncStateFn>(async (nextState) => {
      liveState = nextState;
    });

    const mergeEvent = createMergeEventState({
      isDisposed: () => false,
      getCurrentState: () => liveState,
      getCurrentSessionId: () => 'ses_parent',
      isBufferingStartupScopedEvents: () => false,
      bufferStartupScopedEvent: () => {},
      syncState,
      createPersistMeta: (source) => ({ source, lastEventType: 'test', bufferedEventCount: 0 }),
    });

    await mergeEvent(sessionCreatedEvent('ses_child', 'ses_parent'));

    expect(syncState).toHaveBeenCalledTimes(1);
    expect(liveState.children.ses_child).toMatchObject({ status: 'running' });
  });

  it('merges into live state when the state version changed between clone and persist', async () => {
    let accessCount = 0;
    let liveState: SubagentState = createEmptyState();

    const getCurrentState = (): SubagentState => {
      accessCount++;
      if (accessCount >= 2) {
        // Simulate refresh path adding a child (and changing updatedAt)
        // between our clone and the guard's version check
        const enriched = createEmptyState();
        enriched.updatedAt = new Date(Date.now() + 2000).toISOString();
        enriched.children.ses_refresh_added = {
          id: 'ses_refresh_added',
          title: 'Added by refresh',
          parentID: 'ses_parent',
          source: 'session',
          status: 'running',
          color: 'yellow',
          startedAt: CREATED_AT,
          updatedAt: CREATED_AT,
        };
        return enriched;
      }
      return liveState;
    };

    let persistedState: SubagentState | undefined;
    const syncState = vi.fn<SyncStateFn>(async (nextState) => {
      persistedState = nextState;
      liveState = nextState;
    });

    const mergeEvent = createMergeEventState({
      isDisposed: () => false,
      getCurrentState,
      getCurrentSessionId: () => 'ses_parent',
      isBufferingStartupScopedEvents: () => false,
      bufferStartupScopedEvent: () => {},
      syncState,
      createPersistMeta: (source) => ({ source, lastEventType: 'test', bufferedEventCount: 0 }),
    });

    await mergeEvent(sessionCreatedEvent('ses_child', 'ses_parent'));

    expect(syncState).toHaveBeenCalledTimes(1);
    // ses_child from the event AND ses_refresh_added from the merge
    expect(persistedState?.children?.ses_child).toMatchObject({ status: 'running', title: 'Child ses_child' });
    expect(persistedState?.children?.ses_refresh_added).toMatchObject({ status: 'running', title: 'Added by refresh' });
  });

  it('preserves live terminal status when state version changed and event carries older running evidence', async () => {
    let accessCount = 0;
    let liveState: SubagentState = createEmptyState();

    const getCurrentState = (): SubagentState => {
      accessCount++;
      if (accessCount >= 2) {
        const enriched = createEmptyState();
        enriched.updatedAt = new Date(Date.now() + 2000).toISOString();
        // Live state has this child as terminal (done)
        enriched.children.ses_child = {
          id: 'ses_child',
          title: 'Already completed',
          parentID: 'ses_parent',
          source: 'session',
          status: 'done',
          color: 'green',
          startedAt: CREATED_AT,
          updatedAt: CREATED_AT,
          endedAt: CREATED_AT,
        };
        return enriched;
      }
      return liveState;
    };

    let persistedState: SubagentState | undefined;
    const syncState = vi.fn<SyncStateFn>(async (nextState) => {
      persistedState = nextState;
      liveState = nextState;
    });

    const mergeEvent = createMergeEventState({
      isDisposed: () => false,
      getCurrentState,
      getCurrentSessionId: () => 'ses_parent',
      isBufferingStartupScopedEvents: () => false,
      bufferStartupScopedEvent: () => {},
      syncState,
      createPersistMeta: (source) => ({ source, lastEventType: 'test', bufferedEventCount: 0 }),
    });

    await mergeEvent(sessionCreatedEvent('ses_child', 'ses_parent'));

    // The live terminal "done" must be preserved through the merge
    expect(persistedState?.children?.ses_child).toMatchObject({ status: 'done' });
  });

  it('does not reapply an older terminal synthetic clone over a newer live reopening', () => {
    const liveState = createEmptyState();
    liveState.children.ses_child = {
      id: 'ses_child',
      title: 'Reopened child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      startedAt: CREATED_AT,
      updatedAt: '2026-06-05T10:02:00.000Z',
    };
    const clonedState = createEmptyState();
    clonedState.children.tool_delegate = {
      id: 'tool_delegate',
      title: 'Delegation',
      parentID: 'ses_parent',
      source: 'tool',
      targetSessionID: 'ses_child',
      status: 'done',
      startedAt: CREATED_AT,
      updatedAt: '2026-06-05T10:01:00.000Z',
      endedAt: '2026-06-05T10:01:00.000Z',
    };

    expect(mergeRefreshStatus(liveState, createEmptyState(), clonedState)).toBe(true);
    expect(liveState.children.ses_child).toMatchObject({ status: 'running', updatedAt: '2026-06-05T10:02:00.000Z' });
  });

  it('does not let heuristic stale error overwrite a concurrent terminal event', () => {
    const liveState = createEmptyState();
    liveState.children.ses_child = {
      id: 'ses_child',
      title: 'Completed child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'done',
      startedAt: CREATED_AT,
      updatedAt: '2026-06-05T10:01:00.000Z',
      endedAt: '2026-06-05T10:01:00.000Z',
    };
    const staleState = createEmptyState();
    staleState.children.ses_child = {
      ...liveState.children.ses_child,
      status: 'error',
      updatedAt: '2026-06-05T10:05:00.000Z',
      endedAt: '2026-06-05T10:05:00.000Z',
    };

    expect(mergeRefreshStatus(liveState, createEmptyState(), staleState, new Set(), new Set(['ses_child']))).toBe(
      false,
    );
    expect(liveState.children.ses_child).toMatchObject({ status: 'done', endedAt: '2026-06-05T10:01:00.000Z' });
  });

  it('calls syncState exactly once per event', async () => {
    let liveState: SubagentState = createEmptyState();
    const syncState = vi.fn<SyncStateFn>(async (nextState) => {
      liveState = nextState;
    });

    const mergeEvent = createMergeEventState({
      isDisposed: () => false,
      getCurrentState: () => liveState,
      getCurrentSessionId: () => 'ses_parent',
      isBufferingStartupScopedEvents: () => false,
      bufferStartupScopedEvent: () => {},
      syncState,
      createPersistMeta: (source) => ({ source, lastEventType: 'test', bufferedEventCount: 0 }),
    });

    await mergeEvent(sessionCreatedEvent('ses_child', 'ses_parent'));

    expect(syncState).toHaveBeenCalledTimes(1);
  });

  it('only merges new (absent) children from the event state into the live state', async () => {
    let accessCount = 0;
    let liveState: SubagentState = createEmptyState();

    const getCurrentState = (): SubagentState => {
      accessCount++;
      if (accessCount >= 2) {
        const enriched = createEmptyState();
        enriched.updatedAt = new Date(Date.now() + 2000).toISOString();
        // Live state has ses_child as "done" with a different title
        enriched.children.ses_child = {
          id: 'ses_child',
          title: 'Live version of child',
          parentID: 'ses_parent',
          source: 'session',
          status: 'done',
          color: 'green',
          startedAt: CREATED_AT,
          updatedAt: CREATED_AT,
          endedAt: CREATED_AT,
        };
        return enriched;
      }
      return liveState;
    };

    let persistedState: SubagentState | undefined;
    const syncState = vi.fn<SyncStateFn>(async (nextState) => {
      persistedState = nextState;
      liveState = nextState;
    });

    const mergeEvent = createMergeEventState({
      isDisposed: () => false,
      getCurrentState,
      getCurrentSessionId: () => 'ses_parent',
      isBufferingStartupScopedEvents: () => false,
      bufferStartupScopedEvent: () => {},
      syncState,
      createPersistMeta: (source) => ({ source, lastEventType: 'test', bufferedEventCount: 0 }),
    });

    await mergeEvent(sessionCreatedEvent('ses_child', 'ses_parent'));

    // The live version (done) must win because the child already exists
    // in live state — the merge only adds ABSENT children.
    expect(persistedState?.children?.ses_child).toMatchObject({
      status: 'done',
      title: 'Live version of child',
    });
  });
});
