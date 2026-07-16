import { describe, expect, it } from 'vitest';

import { createEmptyState } from '../../../src/features/subagent-status/domain/state/core.ts';
import type { SubagentState } from '../../../src/features/subagent-status/domain/types.ts';
import {
  analyzeParentTaskMessages,
  applyParentTaskEvidence,
} from '../../../src/features/subagent-status/runtime/refresh/parent-task.ts';
import { reconcileChildrenState } from '../../../src/features/subagent-status/domain/reconcile/reconcile.ts';
import { extractTaskToolEvidence } from '../../../src/features/subagent-status/runtime/events/extract-child.ts';
import { markHardStaleRunningChildren } from '../../../src/features/subagent-status/domain/state/maintenance.ts';

const child = (status: 'running' | 'done' | 'error' | 'stale' = 'running') => ({
  id: 'ses_child',
  title: 'Child',
  parentID: 'ses_parent',
  source: 'session' as const,
  status,
  startedAt: '2026-07-15T10:00:00.000Z',
  updatedAt: '2026-07-15T10:01:00.000Z',
});

const stateWith = (status?: 'running' | 'done' | 'error' | 'stale'): SubagentState => ({
  ...createEmptyState(),
  children: { ses_child: child(status) },
});

const taskMessage = (status: string, extra: Record<string, unknown> = {}) => ({
  parts: [
    {
      type: 'tool',
      tool: 'task',
      id: 'call_task',
      state: {
        status,
        metadata: { sessionId: 'ses_child', ...extra },
        time: { updated: '2026-07-15T10:02:00.000Z' },
      },
    },
  ],
});

describe('durable parent task evidence', () => {
  it('ignores statusless children because children is inventory only', () => {
    const result = reconcileChildrenState(createEmptyState(), {
      data: [{ id: 'ses_child', parentID: 'ses_parent', title: 'Child' }],
    });

    expect(result.nextState.children).toEqual({});
  });

  it('recovers completed and failed foreground tasks from parent messages', () => {
    const messages = [taskMessage('completed'), taskMessage('error')];
    const evidence = analyzeParentTaskMessages(messages, 'ses_parent');
    const state = stateWith();

    applyParentTaskEvidence(state, [evidence[0]]);
    expect(state.children.ses_child.status).toBe('done');
    applyParentTaskEvidence(state, [evidence[1]]);
    expect(state.children.ses_child.status).toBe('error');
  });

  it('recreates a terminal child from durable parent evidence after restart', () => {
    const state = createEmptyState();
    const evidence = analyzeParentTaskMessages([taskMessage('completed')], 'ses_parent');

    expect(applyParentTaskEvidence(state, evidence)).toBe(true);
    expect(state.children.ses_child).toMatchObject({
      parentID: 'ses_parent',
      status: 'done',
      targetSessionID: 'ses_child',
    });
  });

  it('replaces heuristic stale state with durable completed evidence', () => {
    const state = stateWith('stale');
    const evidence = analyzeParentTaskMessages([taskMessage('completed')], 'ses_parent');

    expect(applyParentTaskEvidence(state, evidence)).toBe(true);
    expect(state.children.ses_child.status).toBe('done');
  });

  it('does not complete a still-running background task wrapper', () => {
    const state = stateWith();
    const evidence = analyzeParentTaskMessages([taskMessage('completed', { background: true })], 'ses_parent');

    applyParentTaskEvidence(state, evidence);

    expect(state.children.ses_child.status).toBe('running');
  });

  it('accepts sessionID aliases and output session identifiers', () => {
    const messages = [
      {
        parts: [
          { type: 'tool', tool: 'task', state: { status: 'completed', metadata: { sessionID: 'ses_child' } } },
          { type: 'tool', tool: 'task', state: { status: 'cancelled', output: 'task_id: ses_child' } },
        ],
      },
    ];

    expect(analyzeParentTaskMessages(messages, 'ses_parent')).toHaveLength(2);
    expect(analyzeParentTaskMessages(messages, 'ses_parent')[1]?.status).toBe('error');
  });

  it('ignores malformed and non-terminal task parts', () => {
    expect(
      analyzeParentTaskMessages(
        [
          null,
          {
            parts: [
              { type: 'tool', tool: 'task' },
              { type: 'tool', tool: 'other', state: { status: 'error' } },
            ],
          },
          { parts: [{ type: 'tool', tool: 'task', state: { status: 'running' } }] },
        ],
        'ses_parent',
      ),
    ).toEqual([]);
  });

  it('uses a tool child identifier when durable task metadata has no session id', () => {
    const state = stateWith();
    state.children['tool:call_task'] = { ...child(), id: 'tool:call_task', source: 'tool' };
    const evidence = analyzeParentTaskMessages(
      [{ parts: [{ type: 'tool', tool: 'task', id: 'call_task', state: { status: 'completed' } }] }],
      'ses_parent',
    );

    expect(applyParentTaskEvidence(state, evidence)).toBe(true);
    expect(state.children['tool:call_task'].status).toBe('done');
  });

  it('ignores durable task evidence that cannot identify a child', () => {
    const state = createEmptyState();

    expect(
      applyParentTaskEvidence(state, [
        { parentSessionID: 'ses_parent', status: 'done', background: false, endedAt: '2026-07-15T10:02:00.000Z' },
      ]),
    ).toBe(false);
    expect(state.children).toEqual({});
  });

  it('preserves the background flag from a live task event', () => {
    expect(
      extractTaskToolEvidence({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            tool: 'task',
            sessionID: 'ses_parent',
            state: { status: 'completed', input: { background: true }, metadata: { sessionId: 'ses_child' } },
          },
        },
      }),
    ).toMatchObject({ background: true, status: 'done', targetSessionID: 'ses_child' });
  });

  it('accepts background metadata when task input omits the flag', () => {
    expect(
      extractTaskToolEvidence({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            tool: 'task',
            sessionID: 'ses_parent',
            state: { status: 'completed', input: {}, metadata: { background: true, sessionId: 'ses_child' } },
          },
        },
      }),
    ).toMatchObject({ background: true });
  });

  it('does not infer a failure when hard-stale handling is disabled', () => {
    const state = stateWith();

    markHardStaleRunningChildren(state, 0);

    expect(state.children.ses_child.status).toBe('running');
  });

  it('leaves explicit terminal children unchanged during hard-stale handling', () => {
    const state = stateWith('done');

    markHardStaleRunningChildren(state, 1);

    expect(state.children.ses_child.status).toBe('done');
  });

  it('keeps explicit background errors terminal', () => {
    const state = stateWith();
    const evidence = analyzeParentTaskMessages([taskMessage('failed', { background: true })], 'ses_parent');

    expect(applyParentTaskEvidence(state, evidence)).toBe(true);
    expect(state.children.ses_child.status).toBe('error');
  });

  it('accepts a completed background wrapper after the child is no longer running', () => {
    const state = stateWith('done');
    const evidence = analyzeParentTaskMessages([taskMessage('completed', { background: true })], 'ses_parent');

    expect(applyParentTaskEvidence(state, evidence)).toBe(false);
    expect(state.children.ses_child.status).toBe('done');
  });
});
