import { describe, expect, it, vi } from 'vitest';

import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import type { SubagentState } from '../../../../src/features/subagent-status/domain/types.ts';
import {
  createTuiRuntimeRefresh,
  mergeRefreshStatus,
} from '../../../../src/features/subagent-status/runtime/refresh/orchestrator.ts';

const policy = {
  refreshIntervalMs: 60_000,
  hardStaleAfterMs: 300_000,
  inactiveThresholdMs: 0,
  baseBackoffMs: 1,
  maxBackoffMs: 10,
  maxAttempts: 2,
};
const makeChild = (status: 'running' | 'done' | 'error' = 'running') => ({
  id: 'ses_child',
  title: 'Child',
  parentID: 'ses_parent',
  source: 'session' as const,
  targetSessionID: 'ses_child',
  status,
  startedAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:01:00.000Z',
});

const runtimeFor = (listChildren: () => Promise<unknown>) => {
  let state = createEmptyState();
  const token = { value: 1 };
  const syncState = vi.fn(async (next: SubagentState) => {
    state = next;
  });
  const sessionScope = {
    currentSessionToken: () => token.value,
    isBufferingStartupScopedEvents: () => false,
    bufferStartupScopedEvent: vi.fn(),
    replayDeferredStartupScopedEvents: vi.fn(async () => undefined),
  };
  const api = {
    client: {
      session: { children: listChildren, status: async () => ({ data: {} }), messages: async () => ({ data: [] }) },
    },
    state: { path: { directory: '/tmp' }, session: { status: () => undefined, messages: () => [] } },
  } as unknown as TuiPluginApi;
  const refresh = createTuiRuntimeRefresh(api, {
    state: { getState: () => state, getSessionId: () => 'ses_parent' },
    sessionScope: sessionScope as never,
    recoverySources: [],
    staleRunningProbePolicy: policy,
    staleRunningProbeStateBySessionId: new Map(),
    createPersistMeta: (source) => ({ source }),
    syncState,
    publishState: vi.fn((next) => {
      state = next;
    }),
    isDisposed: () => false,
  });
  return { refresh, syncState, state: () => state, token };
};

describe('final refresh orchestration branches', () => {
  it('continues after a list failure when recovery has nothing to persist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runtime = runtimeFor(async () => {
      throw new Error('offline');
    });
    await runtime.refresh.refresh('ses_parent', 1);
    expect(warn).toHaveBeenCalled();
    expect(runtime.syncState).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('preserves live terminal precedence while merging a stale refresh snapshot', () => {
    const live = createEmptyState();
    live.children.ses_child = {
      ...makeChild('done'),
      endedAt: '2026-07-01T10:05:00.000Z',
      updatedAt: '2026-07-01T10:05:00.000Z',
    };
    const base = structuredClone(live);
    const stale = createEmptyState();
    stale.children.ses_child = { ...makeChild('error'), endedAt: '2026-07-01T10:04:00.000Z' };
    expect(mergeRefreshStatus(live, base, stale)).toBe(false);
    expect(live.children.ses_child.status).toBe('done');
  });

  it('does not publish after disposal or token invalidation and ignores empty session IDs', async () => {
    const runtime = runtimeFor(async () => ({ data: [] }));
    await runtime.refresh.refresh('', 1);
    expect(runtime.syncState).not.toHaveBeenCalled();
    runtime.token.value = 2;
    await runtime.refresh.refresh('ses_parent', 1);
    expect(runtime.syncState).not.toHaveBeenCalled();
  });
});
