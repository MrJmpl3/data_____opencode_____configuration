import { describe, expect, it, vi } from 'vitest';

import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import {
  hydrateChildStatusesFromClient,
  hydrateChildStatusesFromTuiState,
} from '../../../../src/features/subagent-status/runtime/refresh/hydrate-client.ts';
import type { SubagentState } from '../../../../src/features/subagent-status/domain/types.ts';

const makeState = (status: SubagentState['children']['x']['status'] = 'running') => {
  const state = createEmptyState();
  state.children.ses_child = {
    id: 'ses_child',
    title: 'Child',
    parentID: 'ses_parent',
    source: 'session',
    targetSessionID: 'ses_child',
    status,
    startedAt: '2026-06-05T10:00:00.000Z',
    updatedAt: '2026-06-05T10:01:00.000Z',
    endedAt: status === 'running' ? undefined : '2026-06-05T10:01:00.000Z',
  };
  return state;
};

const apiFor = (options: {
  status?: unknown;
  messages?: unknown[];
  tuiStatus?: unknown;
  tuiMessages?: unknown[];
  rejectStatus?: boolean;
  rejectMessages?: boolean;
}) => ({
  client: {
    session: {
      status: async () =>
        options.rejectStatus ? Promise.reject(new Error('status down')) : { data: options.status ?? {} },
      messages: async () =>
        options.rejectMessages ? Promise.reject(new Error('messages down')) : { data: options.messages ?? [] },
    },
  },
  state: {
    path: { directory: '/tmp' },
    session: {
      status: () => options.tuiStatus,
      messages: () => options.tuiMessages ?? [],
    },
  },
});

describe('branch-core status hydration', () => {
  it('returns early for empty and unknown targets', async () => {
    const api = apiFor({});
    const state = makeState();
    expect(await hydrateChildStatusesFromClient(api as never, state, [])).toBe(false);
    expect(await hydrateChildStatusesFromClient(api as never, state, ['ses_missing'])).toBe(false);
    expect(hydrateChildStatusesFromTuiState(api as never, state, [])).toBe(false);
    expect(hydrateChildStatusesFromTuiState(api as never, state, ['ses_missing'])).toBe(false);
  });

  it('marks terminal client activity and uses TUI activity for an error', async () => {
    const doneState = makeState();
    const changed = await hydrateChildStatusesFromClient(
      apiFor({
        status: { ses_child: { status: 'completed', time: { completed: '2026-06-05T10:03:00.000Z' } } },
      }) as never,
      doneState,
      ['ses_child'],
    );
    expect(changed).toBe(true);
    expect(doneState.children.ses_child).toMatchObject({ status: 'done', endedAt: '2026-06-05T10:03:00.000Z' });

    const errorState = makeState();
    expect(
      hydrateChildStatusesFromTuiState(
        apiFor({
          tuiStatus: 'error',
          tuiMessages: [{ status: 'error', time: { updated: '2026-06-05T10:04:00.000Z' } }],
        }) as never,
        errorState,
        ['ses_child'],
      ),
    ).toBe(true);
    expect(errorState.children.ses_child).toMatchObject({ status: 'error', endedAt: '2026-06-05T10:04:00.000Z' });
  });

  it('records running evidence on failed reads and on ambiguous activity', async () => {
    const failedState = makeState();
    const evidence = new Set<string>();
    expect(
      await hydrateChildStatusesFromClient(
        apiFor({ status: { ses_child: 'running' }, rejectMessages: true }) as never,
        failedState,
        ['ses_child'],
        evidence,
      ),
    ).toBe(true);
    expect(evidence).toContain('ses_child');

    const ambiguousState = makeState();
    const tuiEvidence = new Set<string>();
    expect(
      hydrateChildStatusesFromTuiState(
        apiFor({
          tuiStatus: 'running',
          tuiMessages: [{ type: 'step-start', time: { start: '2026-06-05T10:05:00.000Z' } }],
        }) as never,
        ambiguousState,
        ['ses_child'],
        tuiEvidence,
      ),
    ).toBe(true);
    expect(tuiEvidence).toContain('ses_child');
    expect(ambiguousState.children.ses_child?.updatedAt).toBe('2026-06-05T10:05:00.000Z');
  });

  it('protects terminal recovery rows from client and TUI running evidence', async () => {
    const options = { terminalRecoverySessionIDs: new Set(['ses_child']) };
    const state = makeState('done');
    const original = { ...state.children.ses_child };
    expect(
      await hydrateChildStatusesFromClient(
        apiFor({
          status: { ses_child: 'running' },
          messages: [{ type: 'step-start', time: { start: '2026-06-05T10:05:00.000Z' } }],
        }) as never,
        state,
        ['ses_child'],
        undefined,
        options,
      ),
    ).toBe(false);
    expect(
      hydrateChildStatusesFromTuiState(
        apiFor({ tuiStatus: 'running', tuiMessages: [] }) as never,
        state,
        ['ses_child'],
        undefined,
        options,
      ),
    ).toBe(false);
    expect(state.children.ses_child).toEqual(original);
  });

  it('handles status-map failure without losing the running probe path', async () => {
    const state = makeState();
    const evidence = new Set<string>();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await hydrateChildStatusesFromClient(
      apiFor({ rejectStatus: true, messages: [] }) as never,
      state,
      ['ses_child'],
      evidence,
    );
    expect(evidence).toContain('ses_child');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
