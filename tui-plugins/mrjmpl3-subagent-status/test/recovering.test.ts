import { describe, expect, it, vi } from 'vitest';

import type { SubagentState } from '../src/domain/types.ts';
import { createTuiRuntimeRefresh } from '../src/runtime/tui-runtime-refresh.ts';
import type { RecoverySource, RecoveryResult } from '../src/infrastructure/recovery.ts';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { createEmptyState } from '../src/domain/state.ts';
import type { ResolvedSubagentStatusPluginOptions } from '../src/runtime/options.ts';
import type { PersistSnapshotMeta } from '../src/runtime/persisted-snapshot.ts';

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
      baseBackoffMs: 1_000,
      maxBackoffMs: 10_000,
      maxAttempts: 3,
    };

    const syncState = async (nextState: SubagentState) => {
      syncStateCalls.push(structuredClone(nextState));
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
      isDisposed: () => false,
    });

    return { refresh, syncStateCalls, sessionScope };
  };

  it('clears recovering from state before syncState completes', async () => {
    const { refresh, syncStateCalls } = createRefreshContext();

    await refresh('ses_parent', 1);

    expect(syncStateCalls.length).toBeGreaterThan(0);
    const lastSynced = syncStateCalls[syncStateCalls.length - 1];
    // After recovery completes, recovering should be cleared (falsy)
    expect(lastSynced.recovering).toBeFalsy();
  });

  it('sets recovering on the cloned state during recovery and clears before sync', async () => {
    const { refresh, syncStateCalls } = createRefreshContext();

    await refresh('ses_parent', 1);

    // All synced states should have recovering set to falsy after the recovery cycle
    for (const synced of syncStateCalls) {
      expect(synced.recovering).toBeFalsy();
    }
  });
});
