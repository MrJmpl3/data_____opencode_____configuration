import { describe, expect, it, vi } from 'vitest';

import {
  createRuntimeSessionScopeHelpers,
  MAX_DEFERRED_STARTUP_SCOPED_EVENTS,
} from '../../../../src/features/subagent-status/runtime/session/scope.ts';
import { createSessionClientBoundary } from '../../../../src/features/subagent-status/runtime/session/session-client.ts';
import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';

describe('final session orchestration branches', () => {
  it('resets and switches scopes, persists failures, and stops replay after invalidation', async () => {
    let session = 'ses_old';
    const sync = vi.fn(async () => {
      throw new Error('disk unavailable');
    });
    const scope = createRuntimeSessionScopeHelpers({
      getSessionId: () => session,
      setSessionId: (value) => {
        session = value;
      },
      syncState: sync,
      createRefreshMeta: () => ({ source: 'refresh' }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const token = scope.beginSessionScope('ses_new');
    scope.bufferStartupScopedEvent('ses_new', { id: 1 });
    scope.bufferStartupScopedEvent('ses_new', { id: 2 });
    session = 'ses_other';
    await scope.replayDeferredStartupScopedEvents(
      'ses_new',
      token,
      vi.fn(async () => undefined),
      () => false,
    );
    expect(warn).toHaveBeenCalled();
    scope.resetSessionScope();
    expect(session).toBe('');
    warn.mockRestore();
  });

  it('drops oldest buffered events at the bounded queue limit and honors disposal', async () => {
    let session = '';
    const scope = createRuntimeSessionScopeHelpers({
      getSessionId: () => session,
      setSessionId: (v) => {
        session = v;
      },
      syncState: vi.fn(async () => undefined),
      createRefreshMeta: () => ({ source: 'refresh' }),
    });
    for (let i = 0; i < MAX_DEFERRED_STARTUP_SCOPED_EVENTS + 1; i++) scope.bufferStartupScopedEvent('ses_x', i);
    session = 'ses_x';
    const replay = vi.fn(async () => undefined);
    await scope.replayDeferredStartupScopedEvents('ses_x', scope.beginSessionScope('ses_x'), replay, () => true);
    expect(replay).not.toHaveBeenCalled();
  });

  it('normalizes absent clients and malformed responses', async () => {
    const client = createSessionClientBoundary({ client: {}, state: { path: { directory: '/workspace' } } });
    await expect(client.listChildren('ses_x')).resolves.toBeUndefined();
    await expect(client.readStatusMap()).resolves.toEqual({});
    await expect(client.readMessages('ses_x')).resolves.toEqual([]);
    const api = {
      client: { session: { status: async () => undefined, messages: async () => ({ data: 'bad' }) } },
      state: { path: { directory: '/workspace' } },
    };
    const normalized = createSessionClientBoundary(api);
    await expect(normalized.readStatusMap()).resolves.toEqual({});
    await expect(normalized.readMessages('ses_x')).resolves.toEqual([]);
  });
});
