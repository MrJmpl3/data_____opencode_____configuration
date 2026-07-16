import { describe, expect, it, vi } from 'vitest';

import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import type { SubagentState } from '../../../../src/features/subagent-status/domain/types.ts';
import type { RecoverySource } from '../../../../src/features/subagent-status/infrastructure/recovery.ts';
import type { PersistSnapshotMeta } from '../../../../src/features/subagent-status/runtime/snapshot.ts';
import type { ResolvedSubagentStatusPluginOptions } from '../../../../src/features/subagent-status/runtime/options.ts';
import {
  createTuiRuntimeRefresh,
  mergeRefreshStatus,
} from '../../../../src/features/subagent-status/runtime/refresh/orchestrator.ts';

const policy: ResolvedSubagentStatusPluginOptions['staleRunningProbePolicy'] = {
  refreshIntervalMs: 60_000,
  hardStaleAfterMs: 300_000,
  inactiveThresholdMs: 0,
  baseBackoffMs: 1_000,
  maxBackoffMs: 10_000,
  maxAttempts: 3,
};

const child = (overrides: Partial<SubagentState['children'][string]> = {}) => ({
  id: 'ses_child',
  title: 'Child',
  parentID: 'ses_parent',
  source: 'session' as const,
  targetSessionID: 'ses_child',
  status: 'running' as const,
  startedAt: '2026-06-04T12:00:00.000Z',
  updatedAt: '2026-06-04T12:01:00.000Z',
  ...overrides,
});

const createRefresh = (
  options: {
    listChildren?: () => Promise<unknown>;
    recoverySources?: RecoverySource[];
    token?: number;
  } = {},
) => {
  let currentState = createEmptyState();
  let token = options.token ?? 1;
  const syncState = vi.fn(async (nextState: SubagentState) => {
    currentState = nextState;
  });
  const publishState = vi.fn((nextState: SubagentState) => {
    currentState = nextState;
  });
  const sessionScope = {
    currentSessionToken: () => token,
    isBufferingStartupScopedEvents: () => false,
    bufferStartupScopedEvent: vi.fn(),
    replayDeferredStartupScopedEvents: vi.fn(async () => undefined),
  };
  const api = {
    client: {
      session: {
        children: options.listChildren ?? (async () => ({ data: [] })),
        status: async () => ({ data: {} }),
        messages: async () => ({ data: [] }),
      },
    },
    state: { path: { directory: '/tmp/workspace' }, session: { messages: () => [], status: () => undefined } },
  } as unknown as TuiPluginApi;
  const refresh = createTuiRuntimeRefresh(api, {
    state: { getState: () => currentState, getSessionId: () => 'ses_parent' },
    sessionScope: sessionScope as never,
    recoverySources: options.recoverySources ?? [],
    staleRunningProbePolicy: policy,
    staleRunningProbeStateBySessionId: new Map(),
    createPersistMeta: (source: PersistSnapshotMeta['source']) => ({ source }),
    syncState,
    publishState,
    isDisposed: () => false,
  });
  return {
    ...refresh,
    syncState,
    publishState,
    getState: () => currentState,
    invalidate: () => {
      token += 1;
    },
  };
};

describe('refresh failure and race boundaries', () => {
  it('does not replace a newer terminal child with an older terminal refresh', () => {
    const state = createEmptyState();
    state.children.ses_child = child({
      status: 'done',
      endedAt: '2026-06-04T12:03:00.000Z',
      updatedAt: '2026-06-04T12:03:00.000Z',
    });
    const base = structuredClone(state);
    const refresh = createEmptyState();
    refresh.children.ses_child = child({
      status: 'error',
      endedAt: '2026-06-04T12:02:00.000Z',
      updatedAt: '2026-06-04T12:02:00.000Z',
    });

    expect(mergeRefreshStatus(state, base, refresh)).toBe(false);
    expect(state.children.ses_child.status).toBe('done');
  });

  it('allows protected recovery evidence to replace an older terminal state', () => {
    const state = createEmptyState();
    state.children.ses_child = child({
      status: 'done',
      endedAt: '2026-06-04T12:03:00.000Z',
      updatedAt: '2026-06-04T12:03:00.000Z',
    });
    const refresh = createEmptyState();
    refresh.children.ses_child = child({
      status: 'error',
      endedAt: '2026-06-04T12:01:00.000Z',
      updatedAt: '2026-06-04T12:01:00.000Z',
    });

    expect(mergeRefreshStatus(state, createEmptyState(), refresh, new Set(['ses_child']))).toBe(true);
    expect(state.children.ses_child.status).toBe('error');
  });

  it('continues after listChildren failure and clears recovering', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runtime = createRefresh({
      listChildren: async () => {
        throw new Error('network down');
      },
    });
    await runtime.refresh('ses_parent', 1);

    expect(runtime.syncState).not.toHaveBeenCalled();
    expect(runtime.publishState).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('does not publish stale recovery after the session token changes during hydration', async () => {
    const hydration = new Promise<void>((resolve) => setTimeout(resolve, 0));
    const runtime = createRefresh({
      recoverySources: [
        {
          hydrateState: async () => {
            await hydration;
            return { changed: true, authoritativeSessionIDs: [] };
          },
        },
      ],
    });
    const pending = runtime.refresh('ses_parent', 1);
    runtime.invalidate();
    await pending;

    expect(runtime.syncState).not.toHaveBeenCalled();
    expect(runtime.publishState).not.toHaveBeenCalled();
  });

  it('ignores an explicitly inactive refresh request', async () => {
    const runtime = createRefresh({ token: 2 });
    await runtime.refresh('ses_parent', 1);
    expect(runtime.syncState).not.toHaveBeenCalled();
    expect(runtime.publishState).not.toHaveBeenCalled();
  });
});
