import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import { installEventBridge } from '../../../../src/features/subagent-status/runtime/events/bridge.ts';
import { t, resetLocale } from '../../../../src/features/subagent-status/runtime/i18n.ts';
import { createTokenBackfillRunner } from '../../../../src/features/subagent-status/runtime/refresh/token-backfill.ts';

vi.mock('../../../../src/features/subagent-status/runtime/refresh/hydrate.ts', () => ({
  hydrateChildTokensFromLogs: vi.fn(),
}));

import { hydrateChildTokensFromLogs } from '../../../../src/features/subagent-status/runtime/refresh/hydrate.ts';

describe('subagent-status runtime edge behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetLocale();
  });

  it.each([
    ['es-MX', 'Subagentes'],
    ['es', 'Subagentes'],
    ['en-US', 'Subagents'],
    ['', 'Subagents'],
  ])('selects translation fallback for locale %s', (locale, expected) => {
    process.env.LANG = locale;
    expect(t('subagents')).toBe(expected);
    expect(t('missing' as never)).toBeUndefined();
  });

  it('uses locale precedence and caches the first detection', () => {
    process.env.LANG = 'en_US.UTF-8';
    process.env.LC_ALL = 'es_ES.UTF-8';
    expect(t('done')).toBe('done');
    process.env.LANG = 'es_ES.UTF-8';
    expect(t('done')).toBe('done');
  });

  it('refreshes only relevant events, reports refresh rejection, and tolerates cleanup failures', async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const unsubscribe = vi.fn(() => {
      if (unsubscribe.mock.calls.length === 2) throw new Error('unsubscribe failed');
    });
    const refresh = vi.fn(async () => {
      throw new Error('refresh failed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = {
      event: {
        on: vi.fn((name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
          return unsubscribe;
        }),
      },
      lifecycle: { onDispose: vi.fn() },
    } as unknown as Pick<TuiPluginApi, 'event' | 'lifecycle'>;

    const dispose = installEventBridge(api, refresh);
    handlers.get('session.error')?.({ type: 'session.error' });
    await Promise.resolve();
    dispose();
    expect(refresh).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['inactive', () => true, false],
    ['empty session', () => false, false],
    ['no done children', () => false, false],
  ])('backfill guard: %s', async (_label, inactive, shouldSync) => {
    const state = createEmptyState();
    const syncState = vi.fn(async () => undefined);
    const runner = createTokenBackfillRunner({
      getState: () => state,
      isInactiveSessionToken: inactive,
      syncState,
      createPersistMeta: (source) => ({ source }),
    });
    await runner.runner({ sessionId: _label === 'empty session' ? '' : 'ses_parent', sessionToken: 1 });
    expect(syncState).toHaveBeenCalledTimes(shouldSync ? 1 : 0);
  });

  it('backfills changed done children and skips unchanged results', async () => {
    const state = createEmptyState();
    state.children.ses_done = {
      id: 'ses_done',
      title: 'Done',
      parentID: 'ses_parent',
      source: 'session',
      status: 'done',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const syncState = vi.fn(async () => undefined);
    vi.mocked(hydrateChildTokensFromLogs).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const runner = createTokenBackfillRunner({
      getState: () => state,
      isInactiveSessionToken: () => false,
      syncState,
      createPersistMeta: (source) => ({ source }),
    });
    await runner.runner({ sessionId: 'ses_parent', sessionToken: 1 });
    await runner.runner({ sessionId: 'ses_parent', sessionToken: 1 });
    expect(syncState).toHaveBeenCalledOnce();
  });
});
