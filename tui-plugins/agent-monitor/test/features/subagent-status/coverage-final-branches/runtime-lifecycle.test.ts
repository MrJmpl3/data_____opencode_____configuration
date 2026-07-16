import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import { createRuntimeSessionScopeHelpers } from '../../../../src/features/subagent-status/runtime/session/scope.ts';
import { createTuiRuntime } from '../../../../src/features/subagent-status/runtime/tui-runtime.ts';
import { normalizeSubagentStatusPluginOptions } from '../../../../src/features/subagent-status/runtime/options.ts';
import { installEventBridge } from '../../../../src/features/subagent-status/runtime/events/bridge.ts';
import { useClockTicker } from '../../../../src/kit/use-clock-ticker.ts';

const makeApi = () => {
  const handlers = new Map<string, (event: unknown) => void>();
  const api = {
    event: {
      on: vi.fn((name: string, handler: (event: unknown) => void) => {
        handlers.set(name, handler);
        return vi.fn();
      }),
    },
    lifecycle: { onDispose: vi.fn() },
    client: {
      session: {
        children: vi.fn(async () => ({ data: [] })),
        status: vi.fn(async () => ({ data: {} })),
        messages: vi.fn(async () => ({ data: [] })),
      },
    },
    state: {
      path: { directory: '/tmp/agent-monitor-coverage' },
      session: { status: vi.fn(() => undefined), messages: vi.fn(() => []) },
    },
  } as unknown as TuiPluginApi;
  return { api, handlers };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('final runtime lifecycle branches', () => {
  it('ticks immediately for an active clock and ignores a disposed timeout', async () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const dispose = useClockTicker({ active: () => true, intervalMs: 1000, onTick: tick });
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalled();
    dispose();
    vi.advanceTimersByTime(1000);
  });

  it('is inert when the event API is unavailable', () => {
    const dispose = installEventBridge(
      { event: undefined, lifecycle: { onDispose: vi.fn() } } as never,
      vi.fn(async () => undefined),
    );
    expect(() => dispose()).not.toThrow();
  });

  it('handles slot refresh transitions and repeated disposal', async () => {
    vi.useFakeTimers();
    const { api } = makeApi();
    let sessionId = 'ses_parent';
    let state = createEmptyState();
    const runtime = createTuiRuntime(
      api,
      {
        getState: () => state,
        setState: (next) => {
          state = next;
        },
        getSessionId: () => sessionId,
        setSessionId: (next) => {
          sessionId = next;
        },
        setNowMs: vi.fn(),
        isSlotVisible: () => false,
        hasVisibleContent: () => false,
      },
      normalizeSubagentStatusPluginOptions({ persistence: { statePath: '/tmp/agent-monitor-coverage-state.json' } }),
    );

    runtime.refreshFromSlot({ sessionId: 'ses_parent' });
    runtime.refreshFromSlot({ sessionId: 'ses_other' });
    await vi.runOnlyPendingTimersAsync();
    runtime.dispose();
    runtime.dispose();
    expect(sessionId).toBe('ses_other');
  });

  it('continues bootstrap after a refresh failure and drains a truncated event buffer', async () => {
    const { api, handlers } = makeApi();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let sessionId = '';
    let state = createEmptyState();
    const runtime = createTuiRuntime(
      api,
      {
        getState: () => state,
        setState: (next) => {
          state = next;
        },
        getSessionId: () => sessionId,
        setSessionId: (next) => {
          sessionId = next;
        },
        setNowMs: vi.fn(),
      },
      normalizeSubagentStatusPluginOptions({
        persistence: { statePath: '/tmp/agent-monitor-coverage-state.json' },
      }),
    );

    const refresh = handlers.get('session.created');
    for (let index = 0; index < 513; index += 1) {
      refresh?.({ type: 'session.created', properties: { info: { id: `ses_${index}`, parentID: 'ses_parent' } } });
    }
    await runtime.bootstrap();
    expect(warn).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('logs a bootstrap failure while still finalizing startup', async () => {
    const { api } = makeApi();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let sessionId = 'ses_parent';
    const runtime = createTuiRuntime(
      api,
      {
        getState: () => {
          throw new Error('state unavailable');
        },
        setState: vi.fn(),
        getSessionId: () => sessionId,
        setSessionId: (next) => {
          sessionId = next;
        },
        setNowMs: vi.fn(),
      },
      normalizeSubagentStatusPluginOptions({ persistence: { statePath: '/tmp/agent-monitor-coverage-state.json' } }),
    );
    await runtime.bootstrap();
    expect(warn).toHaveBeenCalled();
    runtime.dispose();
  });
});

describe('final session scope branches', () => {
  it('drops oldest events and stops replay when disposal or session changes', async () => {
    let sessionId = 'ses_parent';
    const scope = createRuntimeSessionScopeHelpers({
      getSessionId: () => sessionId,
      setSessionId: (next) => {
        sessionId = next;
      },
      syncState: vi.fn(async () => undefined),
      createRefreshMeta: () => ({ source: 'refresh' }),
    });
    for (let index = 0; index < 513; index += 1) scope.bufferStartupScopedEvent('ses_parent', index);
    const replay = vi.fn(async (event: unknown) => {
      if (event === 2) sessionId = 'ses_other';
    });
    await scope.replayDeferredStartupScopedEvents('ses_parent', scope.currentSessionToken(), replay, () => false);
    expect(replay).toHaveBeenCalled();
    expect(scope.isBufferingStartupScopedEvents()).toBe(true);
    scope.finishStartupScopedEventBuffering();
    expect(scope.isBufferingStartupScopedEvents()).toBe(false);
  });

  it('handles persistence failure while changing session scope', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let sessionId = 'ses_parent';
    const scope = createRuntimeSessionScopeHelpers({
      getSessionId: () => sessionId,
      setSessionId: (next) => {
        sessionId = next;
      },
      syncState: vi.fn(async () => {
        throw new Error('disk unavailable');
      }),
      createRefreshMeta: () => ({ source: 'refresh' }),
    });
    scope.beginSessionScope('ses_child');
    scope.resetSessionScope();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
  });
});
