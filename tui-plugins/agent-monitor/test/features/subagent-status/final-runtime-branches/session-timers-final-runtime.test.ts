import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import { createRuntimeSessionScopeHelpers } from '../../../../src/features/subagent-status/runtime/session/scope.ts';
import { useClockTicker } from '../../../../src/kit/use-clock-ticker.ts';
import { usePolling } from '../../../../src/kit/use-polling.ts';

describe('final runtime session and timer branches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T10:00:00.250Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('handles empty, absent, and invalidated scoped replays', async () => {
    let session = 'ses_parent';
    const sync = vi.fn(async () => undefined);
    const scope = createRuntimeSessionScopeHelpers({
      getSessionId: () => session,
      setSessionId: (value) => {
        session = value;
      },
      syncState: sync,
      createRefreshMeta: () => ({ source: 'refresh' }),
    });
    await scope.replayDeferredStartupScopedEvents(
      '',
      0,
      vi.fn(async () => undefined),
      () => false,
    );
    await scope.replayDeferredStartupScopedEvents(
      'ses_parent',
      0,
      vi.fn(async () => undefined),
      () => false,
    );
    scope.bufferStartupScopedEvent('ses_parent', { id: 1 });
    scope.invalidateSessionScope();
    await scope.replayDeferredStartupScopedEvents(
      'ses_parent',
      0,
      vi.fn(async () => undefined),
      () => false,
    );
    scope.resetSessionScope();
    expect(session).toBe('');
    expect(sync).toHaveBeenCalledWith(createEmptyState(), { source: 'refresh' });
  });

  it('skips inactive clock ticks, resumes on activation, and stops polling cleanup', async () => {
    const [active, setActive] = createSignal(false);
    const tick = vi.fn();
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = useClockTicker({ active, intervalMs: 1000, onTick: tick });
      return rootDispose;
    });
    vi.advanceTimersByTime(1000);
    expect(tick).not.toHaveBeenCalled();
    setActive(true);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    dispose();

    const refetch = vi.fn();
    let rootDispose!: () => void;
    createRoot((cleanup) => {
      usePolling({ refetch, intervalMs: 1000 });
      rootDispose = cleanup;
    });
    vi.advanceTimersByTime(1000);
    expect(refetch).toHaveBeenCalledTimes(1);
    rootDispose();
    vi.advanceTimersByTime(1000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
