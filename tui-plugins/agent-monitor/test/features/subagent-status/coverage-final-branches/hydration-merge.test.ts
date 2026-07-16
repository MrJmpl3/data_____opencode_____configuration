import { describe, expect, it, vi } from 'vitest';

import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import type { SubagentState } from '../../../../src/features/subagent-status/domain/types.ts';
import { createMergeEventState } from '../../../../src/features/subagent-status/runtime/events/merge.ts';
import {
  hydrateChildStatusesFromClient,
  hydrateChildStatusesFromTuiState,
} from '../../../../src/features/subagent-status/runtime/refresh/hydrate-client.ts';
import { applySubagentEvent } from '../../../../src/features/subagent-status/runtime/events/handle.ts';
import { mergeRefreshStatus } from '../../../../src/features/subagent-status/runtime/refresh/orchestrator.ts';

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

const api = (status: unknown, messages: unknown[] = []) => ({
  client: { session: { status: async () => ({ data: status }), messages: async () => ({ data: messages }) } },
  state: { path: { directory: '/tmp' }, session: { status: () => status, messages: () => messages } },
});

const stateWith = (status: 'running' | 'done' | 'error' = 'running'): SubagentState => {
  const state = createEmptyState();
  state.children.ses_child = child(status);
  return state;
};

describe('final hydration and merge branches', () => {
  it('uses client terminal, client running, and TUI error paths', async () => {
    const done = stateWith();
    expect(
      await hydrateChildStatusesFromClient(
        api({ ses_child: { status: 'completed', time: { completed: '2026-07-15T10:03:00.000Z' } } }) as never,
        done,
        ['ses_child'],
      ),
    ).toBe(true);
    expect(done.children.ses_child?.status).toBe('done');

    const running = stateWith();
    const evidence = new Set<string>();
    expect(
      await hydrateChildStatusesFromClient(
        api({ ses_child: { status: 'running' } }, [
          { type: 'step-start', time: { start: '2026-07-15T10:04:00.000Z' } },
        ]) as never,
        running,
        ['ses_child'],
        evidence,
      ),
    ).toBe(true);
    expect(evidence).toContain('ses_child');

    const errored = stateWith();
    expect(
      hydrateChildStatusesFromTuiState(
        api('error', [{ type: 'step-start', time: { start: '2026-07-15T10:05:00.000Z' } }]) as never,
        errored,
        ['ses_child'],
      ),
    ).toBe(true);
    expect(errored.children.ses_child?.status).toBe('error');

    const failedNonRunning = stateWith('done');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failedApi = {
      client: {
        session: {
          status: async () => ({ data: { ses_child: { status: 'completed' } } }),
          messages: async () => {
            throw new Error('messages down');
          },
        },
      },
      state: { path: { directory: '/tmp' }, session: { status: () => 'completed', messages: () => [] } },
    };
    await hydrateChildStatusesFromClient(failedApi as never, failedNonRunning, ['ses_child']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('handles non-terminal step finishes and task completion without a target row', () => {
    const state = stateWith();
    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: { part: { type: 'step-finish', reason: 'stop' } },
      }),
    ).toBe(false);
    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: { sessionID: 'ses_child', part: { type: 'step-finish', reason: 'tool-calls' } },
      }),
    ).toBe(false);
    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: { sessionID: 'ses_child', part: { type: 'step-finish', reason: 'stop' } },
      }),
    ).toBe(true);
    expect(applySubagentEvent(state, { type: 'session.idle', properties: { info: { status: 'idle' } } })).toBe(false);
    expect(applySubagentEvent(state, { type: 'session.status', properties: { info: { id: 'ses_child' } } })).toBe(
      false,
    );
    expect(
      applySubagentEvent(state, { type: 'session.updated', properties: { info: { id: 'ses_child', status: 'idle' } } }),
    ).toBe(false);
    const task = stateWith();
    task.children.subtask = { ...child(), id: 'subtask', source: 'subtask', messageID: 'msg', title: 'Task' };
    expect(
      applySubagentEvent(task, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_parent',
          part: {
            type: 'tool',
            tool: 'task',
            id: 'call',
            messageID: 'msg',
            state: { status: 'done', time: { end: '2026-07-15T10:06:00.000Z' }, input: { description: 'Task' } },
          },
        },
      }),
    ).toBe(true);
    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_child',
          part: { type: 'subtask', id: 'subtask', messageID: 'msg', description: 'Task' },
        },
      }),
    ).toBe(true);
  });

  it('buffers unrelated startup events and merges a new event row after a live update', async () => {
    let state = createEmptyState();
    let session = '';
    const buffered = vi.fn();
    const sync = vi.fn(async (next: SubagentState) => {
      state = next;
    });
    const merge = createMergeEventState({
      isDisposed: () => false,
      getCurrentState: () => state,
      getCurrentSessionId: () => session,
      isBufferingStartupScopedEvents: () => true,
      bufferStartupScopedEvent: buffered,
      syncState: sync,
      createPersistMeta: (source) => ({ source }),
    });
    await merge({ type: 'session.created', properties: { info: { id: 'ses_buffered', parentID: 'ses_parent' } } });
    expect(buffered).toHaveBeenCalled();
    session = 'ses_parent';
    await merge({
      type: 'session.created',
      properties: { info: { id: 'ses_child', parentID: 'ses_parent', title: 'Child' } },
    });
    expect(sync).toHaveBeenCalled();
    const live = state;
    await merge({ type: 'session.idle', properties: { info: { id: 'ses_child', status: 'idle' } } });
    expect(state).toBe(live);
  });

  it('resolves fresh, stale, heuristic, and authoritative terminal refreshes', () => {
    const base = stateWith('running');
    const live = structuredClone(base);
    const incoming = createEmptyState();
    incoming.children.ses_child = {
      ...child('done'),
      endedAt: '2026-07-15T10:03:00.000Z',
      updatedAt: '2026-07-15T10:03:00.000Z',
    };
    expect(mergeRefreshStatus(live, base, incoming)).toBe(true);
    expect(live.children.ses_child?.status).toBe('done');

    const older = stateWith('done');
    older.children.ses_child!.endedAt = '2026-07-15T10:05:00.000Z';
    older.children.ses_child!.updatedAt = '2026-07-15T10:05:00.000Z';
    const olderBase = structuredClone(older);
    const olderIncoming = createEmptyState();
    olderIncoming.children.ses_child = { ...child('error'), endedAt: '2026-07-15T10:04:00.000Z' };
    expect(mergeRefreshStatus(older, olderBase, olderIncoming)).toBe(false);

    const recovery = stateWith('done');
    const recoveryBase = structuredClone(recovery);
    const recoveryIncoming = createEmptyState();
    recoveryIncoming.children.ses_child = { ...child('error'), endedAt: '2026-07-15T10:00:00.000Z' };
    expect(mergeRefreshStatus(recovery, recoveryBase, recoveryIncoming, new Set(['ses_child']))).toBe(true);
  });
});
