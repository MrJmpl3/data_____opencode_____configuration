import { describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';

import { createEmptyState } from '../../../src/features/subagent-status/domain/state/core.ts';
import type { SubagentState } from '../../../src/features/subagent-status/domain/types.ts';
import { applySubagentEvent } from '../../../src/features/subagent-status/runtime/events/handle.ts';
import { createMergeEventState } from '../../../src/features/subagent-status/runtime/events/merge.ts';
import {
  hydrateChildStatusesFromClient,
  hydrateChildStatusesFromTuiState,
} from '../../../src/features/subagent-status/runtime/refresh/hydrate-client.ts';
import { mergeRefreshStatus } from '../../../src/features/subagent-status/runtime/refresh/orchestrator.ts';
import { collectProviderLines } from '../../../src/features/quota/ui/components/quota-section.tsx';
import {
  formatOpenAIAdditionalRateLimitLabel,
  formatOpenAIRateLimitTone,
  formatPaceLineText,
  formatResetCreditsLines,
} from '../../../src/features/quota/domain/format.ts';
import {
  getCounts,
  resolveElapsedMs,
  resolveStatusColor,
  sanitizeSummary,
} from '../../../src/features/subagent-status/domain/state/core.ts';
import { useClockTicker } from '../../../src/kit/use-clock-ticker.ts';

const child = (status: 'running' | 'done' | 'error' = 'running') => ({
  id: 'ses_child',
  title: 'Child',
  parentID: 'ses_parent',
  source: 'session' as const,
  targetSessionID: 'ses_child',
  status,
  startedAt: '2026-07-15T10:00:00.000Z',
  updatedAt: '2026-07-15T10:01:00.000Z',
  endedAt: status === 'running' ? undefined : '2026-07-15T10:02:00.000Z',
});

const stateWithChild = (status: 'running' | 'done' | 'error' = 'running'): SubagentState => {
  const state = createEmptyState();
  state.children.ses_child = child(status);
  return state;
};

const api = (status: unknown, messages: unknown[] = []) => ({
  client: {
    session: {
      status: async () => ({ data: status }),
      messages: async () => ({ data: messages }),
    },
  },
  state: {
    path: { directory: '/tmp' },
    session: { status: () => status, messages: () => messages },
  },
});

describe('coverage final observable branches', () => {
  it('collects successful, empty, string-error, and thrown provider results', async () => {
    const setNowMs = vi.fn();
    const lines = await collectProviderLines(
      { authCookie: '', workspaces: [] },
      ['openai', 'deepseek', 'openrouter', 'ollama-cloud'],
      'remaining',
      setNowMs,
      async (providerId) => {
        if (providerId === 'openai') return [{ kind: 'detail', text: 'ok' } as never];
        if (providerId === 'deepseek') return 'provider unavailable';
        if (providerId === 'openrouter') return undefined;
        throw new Error('network unavailable');
      },
    );

    expect(lines).toHaveLength(2);
    expect(lines.some((line) => line.kind === 'detail' && line.text === 'provider unavailable')).toBe(true);
    expect(setNowMs).not.toHaveBeenCalled();
    await collectProviderLines({ authCookie: '', workspaces: [] }, [], 'remaining', setNowMs);
  });

  it('handles running and terminal session status events', () => {
    const state = stateWithChild();
    expect(
      applySubagentEvent(state, {
        type: 'session.status',
        properties: { sessionID: 'ses_child', status: 'running', info: { time: { updated: '2026-07-15T10:03:00Z' } } },
      }),
    ).toBe(true);
    expect(
      applySubagentEvent(state, {
        type: 'session.error',
        properties: { sessionID: 'ses_child', info: { time: { completed: '2026-07-15T10:04:00Z' } } },
      }),
    ).toBe(true);
    expect(state.children.ses_child?.status).toBe('error');
  });

  it('updates a terminal representation when a session update has no status', () => {
    const state = createEmptyState();
    state.children.ses_child = child('done');
    expect(
      applySubagentEvent(state, {
        type: 'session.updated',
        properties: { info: { id: 'ses_child', title: 'Updated child' } },
      }),
    ).toBe(true);
    expect(state.children.ses_child?.title).toBe('Updated child');
  });

  it('completes a task tool and its matching subtask', () => {
    const state = stateWithChild();
    state.children.subtask = { ...child(), id: 'subtask', source: 'subtask', messageID: 'msg', title: 'Do thing' };
    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_parent',
          part: {
            type: 'tool',
            tool: 'task',
            id: 'call',
            messageID: 'msg',
            state: { status: 'done', time: { end: '2026-07-15T10:05:00Z' }, input: { description: 'Do thing' } },
          },
        },
      }),
    ).toBe(true);
    expect(state.children.subtask?.status).toBe('done');
  });

  it('returns safely for empty hydration targets and status-map failures', async () => {
    const state = stateWithChild();
    expect(await hydrateChildStatusesFromClient(api({}, []) as never, state, [])).toBe(false);
    expect(hydrateChildStatusesFromTuiState(api('idle') as never, state, [])).toBe(false);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failingApi = {
      ...api({}, []),
      client: {
        session: {
          status: async () => Promise.reject(new Error('status unavailable')),
          messages: async () => ({ data: [] }),
        },
      },
    };
    const evidence = new Set<string>();
    await hydrateChildStatusesFromClient(failingApi as never, state, ['ses_child'], evidence);
    expect(evidence).toContain('ses_child');
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();

    const protectedState = stateWithChild('error');
    expect(
      hydrateChildStatusesFromTuiState(
        api('error', [] as unknown[]) as never,
        protectedState,
        ['ses_child'],
        undefined,
        { terminalRecoverySessionIDs: new Set(['ses_child']) },
      ),
    ).toBe(false);
  });

  it('does not overwrite a newer live terminal state with older refresh data', () => {
    const state = stateWithChild('done');
    const base = structuredClone(state);
    const refresh = createEmptyState();
    refresh.children.ses_child = {
      ...child('error'),
      updatedAt: '2026-07-15T09:00:00Z',
      endedAt: '2026-07-15T09:00:00Z',
    };
    expect(mergeRefreshStatus(state, base, refresh)).toBe(false);
  });

  it('buffers startup events and ignores disposed or unrelated events', async () => {
    const state = createEmptyState();
    const buffered = vi.fn();
    const merge = createMergeEventState({
      isDisposed: () => false,
      getCurrentState: () => state,
      getCurrentSessionId: () => '',
      isBufferingStartupScopedEvents: () => true,
      bufferStartupScopedEvent: buffered,
      syncState: vi.fn(async () => undefined),
      createPersistMeta: (source) => ({ source }),
    });
    await merge({ type: 'session.created', properties: { info: { id: 'ses_start', parentID: 'ses_parent' } } });
    expect(buffered).toHaveBeenCalledWith('ses_start', expect.anything());

    const ignored = createMergeEventState({
      isDisposed: () => false,
      getCurrentState: () => state,
      getCurrentSessionId: () => 'ses_current',
      isBufferingStartupScopedEvents: () => false,
      bufferStartupScopedEvent: buffered,
      syncState: vi.fn(async () => undefined),
      createPersistMeta: (source) => ({ source }),
    });
    await ignored({ type: 'session.idle', properties: { sessionID: 'ses_other' } });
    await ignored({ type: 'session.idle', properties: { sessionID: 'ses_current' } });

    const disposed = createMergeEventState({
      isDisposed: () => true,
      getCurrentState: () => state,
      getCurrentSessionId: () => 'ses_current',
      isBufferingStartupScopedEvents: () => false,
      bufferStartupScopedEvent: buffered,
      syncState: vi.fn(async () => undefined),
      createPersistMeta: (source) => ({ source }),
    });
    await disposed({ type: 'session.idle', properties: { sessionID: 'ses_current' } });
  });

  it('covers defensive state helpers and refresh identity cases', () => {
    expect(sanitizeSummary('  same title ', 'same title')).toBeUndefined();
    expect(
      resolveElapsedMs({ startedAt: 'not-a-date', updatedAt: '2026-07-15T10:00:00Z', status: 'done' }, Date.now()),
    ).toBe(0);
    expect(
      resolveElapsedMs({ startedAt: '2026-07-15T10:00:00Z', updatedAt: 'not-a-date', status: 'done' }, Date.now()),
    ).toBe(0);

    const state = createEmptyState();
    const refresh = createEmptyState();
    refresh.children.new = { ...child('done'), id: 'new', targetSessionID: 'new' };
    expect(mergeRefreshStatus(state, createEmptyState(), refresh)).toBe(true);
    expect(state.children.new?.status).toBe('done');
    expect(resolveStatusColor('done')).toBe('green');
    expect(resolveStatusColor('error')).toBe('red');
    expect(resolveStatusColor('stale')).toBe('gray');
    const counted = createEmptyState();
    counted.children.running = { ...child('running'), id: 'running' };
    counted.children.done = { ...child('done'), id: 'done' };
    counted.children.error = { ...child('error'), id: 'error' };
    counted.children.stale = { ...child('error'), id: 'stale', status: 'stale' };
    expect(getCounts(counted)).toEqual({ running: 1, done: 1, stale: 1, error: 1 });

    const unchanged = stateWithChild();
    expect(mergeRefreshStatus(unchanged, structuredClone(unchanged), structuredClone(unchanged))).toBe(false);

    const terminalLive = stateWithChild('done');
    const terminalBase = structuredClone(terminalLive);
    const olderTerminal = createEmptyState();
    olderTerminal.children.ses_child = {
      ...child('error'),
      updatedAt: '2026-07-15T09:00:00Z',
      endedAt: '2026-07-15T09:00:00Z',
    };
    expect(mergeRefreshStatus(terminalLive, terminalBase, olderTerminal)).toBe(false);

    const runningLive = stateWithChild();
    const runningBase = structuredClone(runningLive);
    const olderDone = createEmptyState();
    olderDone.children.ses_child = {
      ...child('done'),
      updatedAt: '2026-07-15T09:00:00Z',
      endedAt: '2026-07-15T09:00:00Z',
    };
    expect(mergeRefreshStatus(runningLive, runningBase, olderDone)).toBe(false);

    const heuristicLive = stateWithChild('done');
    const heuristicBase = structuredClone(heuristicLive);
    const newerError = createEmptyState();
    newerError.children.ses_child = {
      ...child('error'),
      updatedAt: '2026-07-15T10:03:00Z',
      endedAt: '2026-07-15T10:03:00Z',
    };
    expect(mergeRefreshStatus(heuristicLive, heuristicBase, newerError, new Set(), new Set(['ses_child']))).toBe(false);

    const nonRunningLive = stateWithChild('done');
    const nonRunningBase = structuredClone(nonRunningLive);
    const runningRefresh = createEmptyState();
    runningRefresh.children.ses_child = { ...child(), updatedAt: '2026-07-15T10:03:00Z' };
    expect(mergeRefreshStatus(nonRunningLive, nonRunningBase, runningRefresh)).toBe(false);
  });

  it('ignores a non-terminal step finish reason', () => {
    const state = stateWithChild();
    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: { sessionID: 'ses_child', part: { type: 'step-finish', reason: 'length' } },
      }),
    ).toBe(false);
  });

  it('formats quota timing, rate-limit, and reset-credit states', () => {
    expect(formatPaceLineText({ usedPct: 5, resetSec: 900 }, 3600).paceText).toContain('under');
    expect(formatPaceLineText({ usedPct: 95, resetSec: 3000 }, 3600).recoverySeconds).toBeGreaterThan(0);
    expect(formatPaceLineText({ usedPct: 0, resetSec: 0 }, 3600).recoverySeconds).toBeUndefined();
    expect(formatOpenAIRateLimitTone({ limitReached: true })).toBe('error');
    expect(formatOpenAIRateLimitTone({ allowed: false })).toBe('error');
    expect(formatOpenAIRateLimitTone({ allowed: true })).toBe('neutral');
    expect(
      formatOpenAIAdditionalRateLimitLabel({ label: '  A very long additional limit  ', allowed: false }, 'now'),
    ).toContain('blocked');
    expect(formatOpenAIAdditionalRateLimitLabel({ label: '' })).toBe('Additional limit');
    expect(formatResetCreditsLines({ state: 'none-available', availableCount: 0, credits: [] })).toHaveLength(1);
    expect(formatResetCreditsLines({ state: 'unavailable', availableCount: 0, credits: [] })[0]).toMatchObject({
      tone: 'error',
    });
    expect(
      formatResetCreditsLines({
        state: 'available',
        availableCount: 1,
        nextExpiresAtMs: Date.parse('2026-07-20T00:00:00Z'),
        credits: [{ expiresAtIso: '2026-07-20T00:00:00Z', grantedAtIso: '2026-07-10T00:00:00Z' }],
      }),
    ).toHaveLength(2);
    expect(formatResetCreditsLines({ state: 'available', availableCount: 2, credits: [] })[0]).toMatchObject({
      kind: 'detail',
    });
    expect(
      formatResetCreditsLines({
        state: 'available',
        availableCount: 1,
        nextExpiresAtMs: Date.parse('2026-07-20T00:00:00Z'),
        credits: [{ expiresAtIso: 'not-a-date' }, { expiresAtIso: '2026-07-20T00:00:00Z' }],
      }),
    ).toHaveLength(1);
    expect(
      formatResetCreditsLines({
        state: 'available',
        availableCount: 1,
        nextExpiresAtMs: Date.parse('2026-07-20T00:00:00Z'),
        credits: [{ expiresAtIso: '2026-07-20T00:00:00Z' }],
      }),
    ).toHaveLength(1);
  });

  it('pauses, resumes, and disposes the aligned clock ticker', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T10:00:00.250Z'));
    const [active, setActive] = createSignal(false);
    const ticks: number[] = [];
    const dispose = useClockTicker({ active, intervalMs: 1000, onTick: (now) => ticks.push(now) });

    vi.advanceTimersByTime(1000);
    expect(ticks).toHaveLength(0);
    setActive(true);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    expect(ticks).toHaveLength(1);
    dispose();
    const count = ticks.length;
    vi.advanceTimersByTime(2000);
    expect(ticks).toHaveLength(count);
    vi.useRealTimers();
  });
});
