import { describe, expect, it, vi } from 'vitest';

import type { SubagentState } from '../../../src/features/subagent-status/domain/types.ts';
import { createTuiRuntimeRefresh } from '../../../src/features/subagent-status/runtime/refresh/orchestrator.ts';
import type { RecoverySource, RecoveryResult } from '../../../src/features/subagent-status/infrastructure/recovery.ts';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { createEmptyState } from '../../../src/features/subagent-status/domain/state/core.ts';
import type { ResolvedSubagentStatusPluginOptions } from '../../../src/features/subagent-status/runtime/options.ts';
import type { PersistSnapshotMeta } from '../../../src/features/subagent-status/runtime/snapshot.ts';

describe('4.1 — SubagentState shape includes recovering field', () => {
  it('allows setting recovering on SubagentState', () => {
    const state: SubagentState = {
      children: {},
      countedChildIDs: {},
      purgedSessionIDs: {},
      totalExecuted: 0,
      updatedAt: '2026-06-04T12:00:00.000Z',
      recovering: true,
    };

    expect(state.recovering).toBe(true);
  });

  it('defaults recovering to undefined when not set', () => {
    const state: SubagentState = {
      children: {},
      countedChildIDs: {},
      purgedSessionIDs: {},
      totalExecuted: 0,
      updatedAt: '2026-06-04T12:00:00.000Z',
    };

    expect(state.recovering).toBeUndefined();
  });

  it('toggles recovering between true and false', () => {
    const state: SubagentState = {
      children: {},
      countedChildIDs: {},
      purgedSessionIDs: {},
      totalExecuted: 0,
      updatedAt: '2026-06-04T12:00:00.000Z',
    };

    state.recovering = true;
    expect(state.recovering).toBe(true);

    state.recovering = false;
    expect(state.recovering).toBe(false);
  });
});

describe('4.3 — recovering toggle in refresh cycle', () => {
  const createRefreshContext = () => {
    let currentState = structuredClone(createEmptyState());
    const syncStateCalls: SubagentState[] = [];
    const publishStateCalls: SubagentState[] = [];

    const recoverySources: RecoverySource[] = [
      {
        hydrateState: vi.fn(async (state: SubagentState): Promise<RecoveryResult | undefined> => {
          state.children.ses_child = {
            id: 'ses_child',
            title: 'Recovered child',
            parentID: 'ses_parent',
            source: 'session',
            targetSessionID: 'ses_child',
            status: 'done',
            startedAt: '2026-06-04T11:50:00.000Z',
            updatedAt: '2026-06-04T11:55:00.000Z',
            endedAt: '2026-06-04T11:55:00.000Z',
          };
          return { changed: true, authoritativeSessionIDs: ['ses_child'] };
        }),
      },
    ];

    let sessionToken = 1;

    const sessionScope = {
      beginSessionScope: vi.fn((_id: string) => {
        sessionToken += 1;
        return sessionToken;
      }),
      bufferStartupScopedEvent: vi.fn(),
      currentSessionToken: () => sessionToken,
      finishStartupScopedEventBuffering: vi.fn(),
      invalidateSessionScope: vi.fn(() => {
        sessionToken += 1;
        return sessionToken;
      }),
      isBufferingStartupScopedEvents: () => false,
      replayDeferredStartupScopedEvents: vi.fn(async () => undefined),
      resetSessionScope: vi.fn(),
    };

    const api = {
      client: {
        session: {
          listChildren: vi.fn(async () => ({ data: [] })),
          status: vi.fn(async () => ({ data: {} })),
          messages: vi.fn(async () => ({ data: [] })),
        },
      },
      state: {
        path: { directory: '/tmp/workspace' },
        session: {
          messages: vi.fn(() => []),
          status: vi.fn(() => undefined),
        },
      },
    } as unknown as TuiPluginApi;

    const staleRunningProbePolicy: ResolvedSubagentStatusPluginOptions['staleRunningProbePolicy'] = {
      refreshIntervalMs: 60_000,
      hardStaleAfterMs: 10 * 60_000,
      inactiveThresholdMs: 0,
      baseBackoffMs: 1_000,
      maxBackoffMs: 10_000,
      maxAttempts: 3,
    };

    const syncState = async (nextState: SubagentState) => {
      syncStateCalls.push(structuredClone(nextState));
      currentState = nextState;
    };

    const publishState = (nextState: SubagentState) => {
      publishStateCalls.push(structuredClone(nextState));
      currentState = nextState;
    };

    const { refresh } = createTuiRuntimeRefresh(api, {
      state: {
        getState: () => currentState,
        getSessionId: () => 'ses_parent',
      },
      sessionScope,
      recoverySources,
      staleRunningProbePolicy,
      staleRunningProbeStateBySessionId: new Map(),
      createPersistMeta: (source: PersistSnapshotMeta['source']): PersistSnapshotMeta => ({
        source,
      }),
      syncState,
      publishState,
      isDisposed: () => false,
    });

    return { refresh, syncStateCalls, publishStateCalls, sessionScope };
  };

  it('clears recovering even when the runtime state was replaced by a concurrent event merge', async () => {
    let currentState = structuredClone(createEmptyState());
    const eventMergeReplacement = structuredClone(createEmptyState());
    eventMergeReplacement.recovering = true;

    // Simulate an event merge that replaces the runtime state *during*
    // syncState (as would happen when the event bridge fires between
    // setState and the finally block).  The one-shot guard ensures the
    // finally block's correction actually persists instead of being
    // replaced again.
    let simulateEventMerge = true;
    const syncState = async (nextState: SubagentState) => {
      currentState = nextState;
      if (simulateEventMerge) {
        currentState = eventMergeReplacement;
        simulateEventMerge = false;
      }
    };
    const publishState = vi.fn();

    const recoverySources: RecoverySource[] = [
      {
        hydrateState: vi.fn(
          async (state: SubagentState): Promise<RecoveryResult | undefined> => ({
            changed: true,
            authoritativeSessionIDs: [],
          }),
        ),
      },
    ];

    const sessionScope = {
      beginSessionScope: vi.fn(),
      bufferStartupScopedEvent: vi.fn(),
      currentSessionToken: () => 1,
      finishStartupScopedEventBuffering: vi.fn(),
      invalidateSessionScope: vi.fn(() => 2),
      isBufferingStartupScopedEvents: () => false,
      replayDeferredStartupScopedEvents: vi.fn(async () => undefined),
      resetSessionScope: vi.fn(),
    };

    const api = {
      client: {
        session: {
          listChildren: vi.fn(async () => ({ data: [] })),
          status: vi.fn(async () => ({ data: {} })),
          messages: vi.fn(async () => ({ data: [] })),
        },
      },
      state: {
        path: { directory: '/tmp/workspace' },
        session: {
          messages: vi.fn(() => []),
          status: vi.fn(() => undefined),
        },
      },
    } as unknown as TuiPluginApi;

    const { refresh } = createTuiRuntimeRefresh(api, {
      state: {
        getState: () => currentState,
        getSessionId: () => 'ses_parent',
      },
      sessionScope,
      recoverySources,
      staleRunningProbePolicy: {
        refreshIntervalMs: 60_000,
        hardStaleAfterMs: 10 * 60_000,
        inactiveThresholdMs: 0,
        baseBackoffMs: 1_000,
        maxBackoffMs: 10_000,
        maxAttempts: 3,
      },
      staleRunningProbeStateBySessionId: new Map(),
      createPersistMeta: (source: PersistSnapshotMeta['source']): PersistSnapshotMeta => ({
        source,
      }),
      syncState,
      publishState,
      isDisposed: () => false,
    });

    await refresh('ses_parent', 1);

    // The finally block must publish a new reference through syncState
    // with recovering=false so Solid's referential equality re-evaluates
    // the memo/UI from "syncing" to idle.  An in-place mutation on the
    // merged reference would be invisible to Solid.
    expect(currentState.recovering).toBeFalsy();
  });

  it('publishes a new reference through syncState after event merge recovering fix', async () => {
    let currentState = structuredClone(createEmptyState());
    const eventMergeReplacement = structuredClone(createEmptyState());
    eventMergeReplacement.recovering = true;
    const syncStateCalls: SubagentState[] = [];

    let simulateEventMerge = false;
    const syncState = async (nextState: SubagentState) => {
      syncStateCalls.push(structuredClone(nextState));
      currentState = nextState;
      if (simulateEventMerge) {
        currentState = eventMergeReplacement;
        simulateEventMerge = false;
      }
    };
    const publishState = vi.fn();

    const recoverySources: RecoverySource[] = [
      {
        hydrateState: vi.fn(
          async (state: SubagentState): Promise<RecoveryResult | undefined> => ({
            changed: true,
            authoritativeSessionIDs: [],
          }),
        ),
      },
    ];

    const sessionScope = {
      beginSessionScope: vi.fn(),
      bufferStartupScopedEvent: vi.fn(),
      currentSessionToken: () => 1,
      finishStartupScopedEventBuffering: vi.fn(),
      invalidateSessionScope: vi.fn(() => 2),
      isBufferingStartupScopedEvents: () => false,
      replayDeferredStartupScopedEvents: vi.fn(async () => undefined),
      resetSessionScope: vi.fn(),
    };

    const api = {
      client: {
        session: {
          listChildren: vi.fn(async () => ({ data: [] })),
          status: vi.fn(async () => ({ data: {} })),
          messages: vi.fn(async () => ({ data: [] })),
        },
      },
      state: {
        path: { directory: '/tmp/workspace' },
        session: {
          messages: vi.fn(() => []),
          status: vi.fn(() => undefined),
        },
      },
    } as unknown as TuiPluginApi;

    const { refresh } = createTuiRuntimeRefresh(api, {
      state: {
        getState: () => currentState,
        getSessionId: () => 'ses_parent',
      },
      sessionScope,
      recoverySources,
      staleRunningProbePolicy: {
        refreshIntervalMs: 60_000,
        hardStaleAfterMs: 10 * 60_000,
        inactiveThresholdMs: 0,
        baseBackoffMs: 1_000,
        maxBackoffMs: 10_000,
        maxAttempts: 3,
      },
      staleRunningProbeStateBySessionId: new Map(),
      createPersistMeta: (source: PersistSnapshotMeta['source']): PersistSnapshotMeta => ({
        source,
      }),
      syncState,
      publishState,
      isDisposed: () => false,
    });

    simulateEventMerge = true;
    await refresh('ses_parent', 1);

    // The finally block must publish a new reference through syncState
    // with recovering=false, proving Solid reactivity is triggered.
    expect(syncStateCalls.some((c) => c.recovering === false)).toBe(true);
  });

  it('publishes a new state reference when recovering transitions from true to false after normal refresh', async () => {
    const { refresh, syncStateCalls, publishStateCalls } = createRefreshContext();

    await refresh('ses_parent', 1);

    expect(syncStateCalls.length).toBeGreaterThan(0);
    const synced = syncStateCalls.filter((c) => c.recovering === true);
    expect(synced.length).toBeGreaterThan(0);

    expect(publishStateCalls.some((c) => c.recovering === false)).toBe(true);
  });
});
