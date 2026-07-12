import { describe, expect, it, vi } from 'vitest';

import { createEmptyState } from '../../../src/features/subagent-status/domain/state/core.ts';
import type { SubagentState } from '../../../src/features/subagent-status/domain/types.ts';
import { createMergeEventState } from '../../../src/features/subagent-status/runtime/events/merge.ts';
import type { PersistSnapshotMeta } from '../../../src/features/subagent-status/runtime/snapshot.ts';

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
