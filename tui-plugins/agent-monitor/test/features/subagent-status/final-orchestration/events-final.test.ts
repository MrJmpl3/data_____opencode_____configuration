import { describe, expect, it } from 'vitest';

import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import { applySubagentEvent } from '../../../../src/features/subagent-status/runtime/events/handle.ts';
import {
  extractChildDetails,
  extractEventTimestamp,
  extractSessionId,
  extractOpenCodeEventSessionStatus,
} from '../../../../src/features/subagent-status/runtime/events/extract.ts';
import {
  extractPartTargetSessionCandidates,
  mapTaskToolToSubtaskID,
  parseTaskSessionIdFromOutput,
  resolveSyntheticTargetSessionID,
} from '../../../../src/features/subagent-status/runtime/events/resolve.ts';

const child = (overrides: Record<string, unknown> = {}) => ({
  id: 'ses_child',
  title: 'Child',
  parentID: 'ses_parent',
  source: 'session' as const,
  targetSessionID: 'ses_child',
  status: 'running' as const,
  startedAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
  ...overrides,
});

describe('final event orchestration branches', () => {
  it('uses all supported session and timestamp fallbacks without trusting part.sessionID', () => {
    expect(extractSessionId({ properties: { part: { sessionID: 'ses_parent' }, info: { id: 'ses_info' } } })).toBe(
      'ses_info',
    );
    expect(extractSessionId({ session_id: 'ses_top' })).toBe('ses_top');
    expect(
      extractEventTimestamp({ properties: { part: { state: { time: { completed: '2026-07-01T10:02:00.000Z' } } } } }, [
        'completed',
      ]),
    ).toBe('2026-07-01T10:02:00.000Z');
    expect(extractEventTimestamp({ properties: { part: { description: 'none' } } }, ['missing'])).toBeUndefined();
    expect(
      extractChildDetails({ properties: { part: { state: { input: { prompt: 'Prompt', agent: 'ignored' } } } } }),
    ).toMatchObject({
      summary: 'Prompt',
    });
    expect(
      extractOpenCodeEventSessionStatus({ properties: { info: { status: 'running' }, status: 'completed' } }),
    ).toBe('done');
  });

  it('keeps idle terminal status and task completion precedence over running state', () => {
    const state = createEmptyState();
    state.children.ses_child = child();
    expect(
      applySubagentEvent(state, { type: 'session.idle', properties: { sessionID: 'ses_child', status: 'done' } }),
    ).toBe(true);
    expect(state.children.ses_child.status).toBe('done');

    const taskState = createEmptyState();
    taskState.children.ses_child = child();
    taskState.children.subtask = {
      id: 'subtask',
      title: 'Run child',
      parentID: 'ses_parent',
      messageID: 'msg',
      source: 'subtask',
      targetSessionID: 'ses_child',
      status: 'running',
      startedAt: child().startedAt,
      updatedAt: child().updatedAt,
    };
    expect(
      applySubagentEvent(taskState, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_parent',
          part: {
            type: 'tool',
            tool: 'task',
            id: 'call',
            sessionID: 'ses_parent',
            messageID: 'msg',
            state: { status: 'done', time: { end: '2026-07-01T10:03:00.000Z' }, input: { description: 'Run child' } },
          },
        },
      }),
    ).toBe(true);
    expect(taskState.children.ses_child.status).toBe('done');
    expect(taskState.children.subtask.status).toBe('done');
  });

  it('rejects ambiguous synthetic resolution and excludes the parent session', () => {
    expect(parseTaskSessionIdFromOutput(42, 'ses_parent')).toBeUndefined();
    expect(parseTaskSessionIdFromOutput('ses_parent ses_a', 'ses_parent')).toBe('ses_a');
    expect(
      extractPartTargetSessionCandidates({
        properties: { sessionID: 'ses_parent', part: { sessionID: 'ses_parent', sessionIds: ['ses_child'] } },
      }),
    ).toEqual(['ses_child']);

    const state = createEmptyState();
    state.children.a = child({ id: 'ses_a', targetSessionID: undefined });
    state.children.b = child({ id: 'ses_b', targetSessionID: undefined });
    expect(resolveSyntheticTargetSessionID(state, { parentID: 'ses_parent' })).toBeUndefined();
    expect(mapTaskToolToSubtaskID(state, { parentID: 'ses_parent', messageID: 'msg', title: 'none' })).toBeUndefined();
  });
});
