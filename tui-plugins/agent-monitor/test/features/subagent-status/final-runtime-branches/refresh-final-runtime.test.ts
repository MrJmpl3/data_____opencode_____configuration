import { describe, expect, it, vi } from 'vitest';

import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import { mergeRefreshStatus } from '../../../../src/features/subagent-status/runtime/refresh/orchestrator.ts';
import { hydrateChildStatusesFromClient } from '../../../../src/features/subagent-status/runtime/refresh/hydrate-client.ts';

const child = (status: 'running' | 'done' | 'error', updatedAt = '2026-07-15T10:00:00.000Z') => ({
  id: 'ses_child',
  title: 'Child',
  parentID: 'ses_parent',
  source: 'session' as const,
  targetSessionID: 'ses_child',
  status,
  startedAt: '2026-07-15T09:00:00.000Z',
  updatedAt,
  ...(status === 'running' ? {} : { endedAt: updatedAt }),
});

const api = (status: unknown, rejectMessages = false) => ({
  client: {
    session: {
      status: vi.fn(async () => ({ data: { ses_child: status } })),
      messages: vi.fn(async () => (rejectMessages ? Promise.reject(new Error('messages unavailable')) : { data: [] })),
    },
  },
  state: { path: { directory: '/tmp' }, session: { status: () => undefined, messages: () => [] } },
});

describe('final runtime refresh branches', () => {
  it('preserves terminal precedence and allows authoritative older terminal evidence', () => {
    const live = createEmptyState();
    live.children.ses_child = child('done', '2026-07-15T10:03:00.000Z');
    const base = structuredClone(live);
    const refresh = createEmptyState();
    refresh.children.ses_child = child('error', '2026-07-15T10:01:00.000Z');
    expect(mergeRefreshStatus(live, base, refresh)).toBe(false);
    expect(live.children.ses_child?.status).toBe('done');
    expect(mergeRefreshStatus(live, base, refresh, new Set(['ses_child']))).toBe(true);
    expect(live.children.ses_child?.status).toBe('error');
  });

  it('hydrates terminal client status and records evidence when message reads reject', async () => {
    const state = createEmptyState();
    state.children.ses_child = child('running');
    const evidence = new Set<string>();
    expect(await hydrateChildStatusesFromClient(api({ status: 'completed' }) as never, state, ['ses_child'])).toBe(
      true,
    );
    expect(state.children.ses_child?.status).toBe('done');
    state.children.ses_child = child('running');
    expect(await hydrateChildStatusesFromClient(api('running', true) as never, state, ['ses_child'], evidence)).toBe(
      true,
    );
    expect(evidence).toContain('ses_child');
  });
});
