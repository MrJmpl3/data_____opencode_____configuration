import { describe, expect, it } from 'vitest';

import { createEmptyState, getCounts } from '../../../src/features/subagent-status/domain/state/core.ts';
import { applySubagentEvent } from '../../../src/features/subagent-status/runtime/events/handle.ts';
import {
  extractSessionId,
  extractTaskToolEvidence,
} from '../../../src/features/subagent-status/runtime/events/parse.ts';

const CREATED_AT = '2026-06-05T10:00:00.000Z';
const IDLE_AT = '2026-06-05T10:01:00.000Z';
const DONE_AT = '2026-06-05T10:02:00.000Z';
const ERROR_AT = '2026-06-05T10:03:00.000Z';

const seedChildSession = () => {
  const state = createEmptyState();

  expect(
    applySubagentEvent(state, {
      type: 'session.created',
      properties: {
        info: {
          id: 'ses_child',
          parentID: 'ses_parent',
          title: 'Delegated child',
          time: {
            created: CREATED_AT,
          },
        },
      },
    }),
  ).toBe(true);

  return state;
};

describe('events', () => {
  it('parses subtask events and keeps completed task tool evidence non-terminal', () => {
    const state = createEmptyState();

    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_parent',
          part: {
            type: 'subtask',
            id: 'part_1',
            sessionID: 'ses_parent',
            messageID: 'msg_1',
            description: 'Review auth changes',
            state: {
              input: {
                prompt: 'Review auth changes and report findings',
              },
            },
            targetSession: 'ses_child_1',
          },
        },
      }),
    ).toBe(true);

    expect(state.children['subtask:part_1']).toMatchObject({
      id: 'subtask:part_1',
      source: 'subtask',
      title: 'Review auth changes',
      targetSessionID: 'ses_child_1',
      status: 'running',
    });

    const evidence = extractTaskToolEvidence({
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'tool',
          tool: 'task',
          state: {
            status: 'completed',
            metadata: { sessionId: 'ses_child_1' },
            time: { end: '2026-06-04T12:05:00.000Z' },
          },
        },
      },
    });

    expect(evidence).toMatchObject({
      status: 'done',
      targetSessionID: 'ses_child_1',
      endedAt: '2026-06-04T12:05:00.000Z',
    });
  });

  it('ignores ambiguous task target evidence', () => {
    expect(
      extractTaskToolEvidence({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            tool: 'task',
            state: {
              status: 'completed',
              output: 'first ses_child_1 then ses_child_2',
            },
          },
        },
      })?.targetSessionID,
    ).toBeUndefined();
  });

  it('keeps event session parsing tolerant across session key aliases', () => {
    expect(
      extractSessionId({
        session_id: 'ses_root',
      }),
    ).toBe('ses_root');

    expect(
      extractSessionId({
        properties: {
          info: {
            sessionID: 'ses_child',
          },
        },
      }),
    ).toBe('ses_child');
  });

  it('does NOT use part.sessionID as the event session (parent ownership, not event identity)', () => {
    // `part.sessionID` identifies the session that OWNS the part (the
    // parent), not the event's own session identifier. If present at the
    // event level, `properties.sessionID` should always take priority.
    // If only `part.sessionID` exists without an event-level session,
    // the function must return undefined — the event is ambiguous and
    // should be routed via another mechanism (buffered startup, etc.).
    expect(
      extractSessionId({
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'subtask',
            sessionID: 'ses_parent',
          },
        },
      }),
    ).toBeUndefined();

    // When both `properties.sessionID` and `part.sessionID` exist, the
    // event-level session ID wins (it names the session this event is
    // about, not the session that owns the part).
    expect(
      extractSessionId({
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_child',
          part: {
            type: 'subtask',
            sessionID: 'ses_parent',
          },
        },
      }),
    ).toBe('ses_child');
  });

  it('completes tool and closes subtask when task tool completes', () => {
    const state = createEmptyState();

    applySubagentEvent(state, {
      type: 'session.created',
      properties: {
        info: {
          id: 'ses_child_1',
          parentID: 'ses_parent',
          title: 'Delegated child',
          time: { created: '2026-06-04T12:00:00.000Z' },
        },
      },
    });

    applySubagentEvent(state, {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_parent',
        part: {
          type: 'subtask',
          id: 'part_1',
          sessionID: 'ses_parent',
          messageID: 'msg_1',
          description: 'Execute migration slice',
          targetSession: 'ses_child_1',
          time: { created: '2026-06-04T12:00:00.000Z' },
        },
      },
    });

    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_parent',
          part: {
            type: 'tool',
            tool: 'task',
            id: 'tool_1',
            sessionID: 'ses_parent',
            messageID: 'msg_1',
            state: {
              status: 'completed',
              input: { description: 'Execute migration slice' },
              metadata: { sessionId: 'ses_child_1' },
              time: { end: '2026-06-04T12:10:00.000Z' },
            },
          },
        },
      }),
    ).toBe(true);

    expect(state.children['tool:tool_1']).toMatchObject({
      status: 'done',
      targetSessionID: 'ses_child_1',
      endedAt: '2026-06-04T12:10:00.000Z',
    });
    expect(state.children['subtask:part_1']).toMatchObject({
      status: 'done',
      targetSessionID: 'ses_child_1',
      endedAt: '2026-06-04T12:10:00.000Z',
    });
    expect(state.children.ses_child_1).toMatchObject({
      status: 'done',
      endedAt: '2026-06-04T12:10:00.000Z',
    });
  });

  it('does not mark the only running subtask as failed when task tool evidence cannot be correlated', () => {
    const state = createEmptyState();

    applySubagentEvent(state, {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_parent',
        part: {
          type: 'subtask',
          id: 'part_1',
          sessionID: 'ses_parent',
          messageID: 'msg_1',
          description: 'Execute migration slice',
        },
      },
    });

    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_parent',
          part: {
            type: 'tool',
            tool: 'task',
            id: 'tool_1',
            sessionID: 'ses_parent',
            messageID: 'msg_2',
            state: {
              status: 'error',
              input: { description: 'Different delegated task' },
              time: { end: '2026-06-04T12:10:00.000Z' },
            },
          },
        },
      }),
    ).toBe(true);

    expect(state.children['tool:tool_1']).toMatchObject({
      status: 'error',
      endedAt: '2026-06-04T12:10:00.000Z',
    });
    expect(state.children['subtask:part_1']).toMatchObject({
      status: 'running',
      endedAt: undefined,
    });
  });

  it('keeps an existing child running when only session.idle arrives', () => {
    const state = seedChildSession();

    applySubagentEvent(state, {
      type: 'session.idle',
      properties: {
        sessionID: 'ses_child',
        title: 'Delegated child',
        info: {
          time: {
            updated: IDLE_AT,
          },
        },
      },
    });

    expect(state.children.ses_child).toMatchObject({
      status: 'running',
      updatedAt: CREATED_AT,
    });
    expect(state.children.ses_child?.endedAt).toBeUndefined();
  });

  it('marks an idle child done only after explicit session.status completion evidence arrives', () => {
    const state = seedChildSession();

    applySubagentEvent(state, {
      type: 'session.idle',
      properties: {
        sessionID: 'ses_child',
        info: {
          time: {
            updated: IDLE_AT,
          },
        },
      },
    });

    expect(
      applySubagentEvent(state, {
        type: 'session.status',
        properties: {
          sessionID: 'ses_child',
          status: 'completed',
          info: {
            time: {
              completed: DONE_AT,
            },
          },
        },
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      updatedAt: DONE_AT,
      endedAt: DONE_AT,
    });
  });

  it('marks a child done from terminal session.updated info status evidence despite unrecognized outer status', () => {
    const state = seedChildSession();

    expect(
      applySubagentEvent(state, {
        type: 'session.updated',
        properties: {
          status: 'idle',
          info: {
            id: 'ses_child',
            parentID: 'ses_parent',
            status: 'completed',
            time: {
              completed: DONE_AT,
            },
          },
        },
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      endedAt: DONE_AT,
      elapsedMs: Date.parse(DONE_AT) - Date.parse(CREATED_AT),
    });
    expect(state.children.ses_child?.updatedAt).toBeTruthy();
    expect(getCounts(state)).toEqual({ running: 0, done: 1, stale: 0, error: 0 });
  });

  it('marks a child error from terminal session.updated info state evidence despite non-terminal outer state', () => {
    const state = seedChildSession();

    expect(
      applySubagentEvent(state, {
        type: 'session.updated',
        properties: {
          sessionID: 'ses_child',
          state: 'running',
          info: {
            state: 'failed',
            time: {
              ended: ERROR_AT,
            },
          },
        },
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({
      status: 'error',
      updatedAt: ERROR_AT,
      endedAt: ERROR_AT,
    });
    expect(getCounts(state)).toEqual({ running: 0, done: 0, stale: 0, error: 1 });
  });

  it('marks an idle child error when later session.error evidence arrives', () => {
    const state = seedChildSession();

    applySubagentEvent(state, {
      type: 'session.idle',
      properties: {
        sessionID: 'ses_child',
        info: {
          time: {
            updated: IDLE_AT,
          },
        },
      },
    });

    expect(
      applySubagentEvent(state, {
        type: 'session.error',
        properties: {
          sessionID: 'ses_child',
          info: {
            time: {
              ended: ERROR_AT,
            },
          },
        },
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({
      status: 'error',
      updatedAt: ERROR_AT,
      endedAt: ERROR_AT,
    });
  });

  it('reopens a done child when explicit session.status running evidence arrives', () => {
    const state = seedChildSession();
    state.children.ses_child.status = 'done';
    state.children.ses_child.color = 'green';
    state.children.ses_child.updatedAt = DONE_AT;
    state.children.ses_child.endedAt = DONE_AT;
    state.children['tool:ses_child'] = {
      id: 'tool:ses_child',
      title: 'Delegated child',
      parentID: 'ses_parent',
      source: 'tool',
      targetSessionID: 'ses_child',
      status: 'done',
      color: 'green',
      startedAt: CREATED_AT,
      updatedAt: DONE_AT,
      endedAt: DONE_AT,
    };

    expect(
      applySubagentEvent(state, {
        type: 'session.status',
        properties: {
          sessionID: 'ses_child',
          status: 'running',
          info: {
            time: {
              updated: '2026-06-05T10:05:00.000Z',
            },
          },
        },
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({
      status: 'running',
      color: 'yellow',
      updatedAt: '2026-06-05T10:05:00.000Z',
      endedAt: undefined,
    });
    expect(state.children['tool:ses_child']).toMatchObject({
      status: 'running',
      color: 'yellow',
      updatedAt: '2026-06-05T10:05:00.000Z',
      endedAt: undefined,
    });
  });

  it('applies discriminated busy and retry session.status events as running', () => {
    const state = seedChildSession();

    expect(
      applySubagentEvent(state, {
        type: 'session.status',
        properties: {
          sessionID: 'ses_child',
          status: { type: 'busy' },
          info: { time: { updated: '2026-06-05T10:01:01.000Z' } },
        },
      }),
    ).toBe(true);
    expect(state.children.ses_child).toMatchObject({ status: 'running' });

    expect(
      applySubagentEvent(state, {
        type: 'session.status',
        properties: {
          sessionID: 'ses_child',
          status: { type: 'retry', attempt: 2 },
          info: { time: { updated: '2026-06-05T10:01:02.000Z' } },
        },
      }),
    ).toBe(true);
    expect(state.children.ses_child).toMatchObject({ status: 'running' });
  });

  it('does not reopen a terminal child from stale session.status running evidence', () => {
    const state = seedChildSession();
    state.children.ses_child.status = 'error';
    state.children.ses_child.color = 'red';
    state.children.ses_child.updatedAt = ERROR_AT;
    state.children.ses_child.endedAt = ERROR_AT;

    expect(
      applySubagentEvent(state, {
        type: 'session.status',
        properties: {
          sessionID: 'ses_child',
          status: 'running',
          info: {
            time: {
              updated: IDLE_AT,
            },
          },
        },
      }),
    ).toBe(false);

    expect(state.children.ses_child).toMatchObject({
      status: 'error',
      color: 'red',
      updatedAt: ERROR_AT,
      endedAt: ERROR_AT,
    });
  });

  it('marks a running session child done from step-finish/stop part', () => {
    const state = seedChildSession();

    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_child',
          part: {
            type: 'step-finish',
            reason: 'stop',
          },
          time: {
            completed: DONE_AT,
          },
        },
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      endedAt: DONE_AT,
    });
  });

  it('does not reopen a terminal child from a later session.updated without status', () => {
    const state = seedChildSession();

    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_child',
          part: { type: 'step-finish', reason: 'stop' },
          info: { time: { completed: DONE_AT } },
        },
      }),
    ).toBe(true);
    const childBeforeUpdate = { ...state.children.ses_child };

    applySubagentEvent(state, {
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_child',
          parentID: 'ses_parent',
          title: 'Delegated child',
          time: { updated: '2026-06-05T10:03:00.000Z' },
        },
      },
    });

    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      startedAt: CREATED_AT,
      updatedAt: DONE_AT,
      endedAt: DONE_AT,
      elapsedMs: Date.parse(DONE_AT) - Date.parse(CREATED_AT),
    });
    expect(state.children.ses_child).toMatchObject({
      status: childBeforeUpdate.status,
      startedAt: childBeforeUpdate.startedAt,
      updatedAt: childBeforeUpdate.updatedAt,
      endedAt: childBeforeUpdate.endedAt,
      elapsedMs: childBeforeUpdate.elapsedMs,
    });
  });

  it('reopens a terminal child from a later explicit session.created event', () => {
    const state = seedChildSession();

    applySubagentEvent(state, {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_child',
        part: { type: 'step-finish', reason: 'stop' },
        info: { time: { completed: DONE_AT } },
      },
    });

    const reopenedAt = '2026-06-05T10:04:00.000Z';
    expect(
      applySubagentEvent(state, {
        type: 'session.created',
        properties: {
          info: {
            id: 'ses_child',
            parentID: 'ses_parent',
            title: 'Delegated child',
            status: 'busy',
            time: { created: reopenedAt },
          },
        },
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({
      status: 'running',
      startedAt: reopenedAt,
      updatedAt: reopenedAt,
      endedAt: undefined,
    });
  });

  it('does not create a session row when only a terminal synthetic alias targets it', () => {
    const state = createEmptyState();
    state.children['tool:ses_child'] = {
      id: 'tool:ses_child',
      title: 'Delegated child',
      parentID: 'ses_parent',
      source: 'tool',
      targetSessionID: 'ses_child',
      status: 'done',
      color: 'green',
      startedAt: CREATED_AT,
      updatedAt: DONE_AT,
      endedAt: DONE_AT,
      elapsedMs: Date.parse(DONE_AT) - Date.parse(CREATED_AT),
    };

    applySubagentEvent(state, {
      type: 'session.updated',
      session_id: 'ses_child',
      info: {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Delegated child',
        time: { updated: '2026-06-05T10:03:00.000Z' },
      },
    });

    expect(state.children.ses_child).toBeUndefined();
    expect(state.children['tool:ses_child']).toMatchObject({
      status: 'done',
      startedAt: CREATED_AT,
      updatedAt: DONE_AT,
      endedAt: DONE_AT,
      elapsedMs: Date.parse(DONE_AT) - Date.parse(CREATED_AT),
    });
  });

  it('reopens a terminal child from explicit busy session.updated status', () => {
    const state = seedChildSession();
    state.children.ses_child.status = 'done';
    state.children.ses_child.updatedAt = DONE_AT;
    state.children.ses_child.endedAt = DONE_AT;

    expect(
      applySubagentEvent(state, {
        type: 'session.updated',
        properties: {
          session_id: 'ses_child',
          status: { type: 'busy' },
          info: { time: { updated: '2026-06-05T10:04:00.000Z' } },
        },
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({
      status: 'running',
      updatedAt: '2026-06-05T10:04:00.000Z',
      endedAt: undefined,
    });
  });

  it('inserts an unknown child as running from session.updated without status', () => {
    const state = createEmptyState();

    expect(
      applySubagentEvent(state, {
        type: 'session.updated',
        session_id: 'ses_child_unknown',
        info: {
          id: 'ses_child_unknown',
          parentID: 'ses_parent',
          title: 'Unknown child',
        },
      }),
    ).toBe(true);

    expect(state.children.ses_child_unknown).toMatchObject({
      status: 'running',
      parentID: 'ses_parent',
    });
  });

  it('marks a child done from raw top-level step-finish/stop event fields', () => {
    const state = seedChildSession();

    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        sessionID: 'ses_child',
        part: { type: 'step-finish', reason: 'stop' },
        info: { time: { completed: DONE_AT } },
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      endedAt: DONE_AT,
    });
  });

  it('reads scalar properties.time and preserves the exact endedAt timestamp', () => {
    const state = seedChildSession();

    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_child',
          part: { type: 'step-finish', reason: 'stop' },
          time: Date.parse(DONE_AT),
        },
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({ status: 'done', endedAt: DONE_AT });
  });

  it('accepts a child step-finish event when the current session is its parent', () => {
    const state = seedChildSession();

    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_child',
          part: { type: 'step-finish', reason: 'stop' },
          info: { time: { completed: DONE_AT } },
        },
      }),
    ).toBe(true);
    expect(state.children.ses_child).toMatchObject({ status: 'done', endedAt: DONE_AT });
  });

  it('does NOT mark done from step-finish/tool-calls (intermediate signal)', () => {
    const state = seedChildSession();

    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_child',
          part: {
            type: 'step-finish',
            reason: 'tool-calls',
          },
        },
      }),
    ).toBe(false);

    expect(state.children.ses_child).toMatchObject({
      status: 'running',
    });
  });

  it('keeps raw top-level step-finish/tool-calls non-terminal', () => {
    const state = seedChildSession();

    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        sessionID: 'ses_child',
        part: { type: 'step-finish', reason: 'tool-calls' },
      }),
    ).toBe(false);

    expect(state.children.ses_child).toMatchObject({ status: 'running' });
  });

  it('preserves failed subtask recency when a later matching task message arrives', () => {
    const state = createEmptyState();
    state.children['subtask:part_1'] = {
      id: 'subtask:part_1',
      title: 'Execute failing slice',
      parentID: 'ses_parent',
      messageID: 'msg_1',
      source: 'subtask',
      targetSessionID: 'ses_child',
      status: 'error',
      color: 'red',
      startedAt: '2026-06-05T10:00:00.000Z',
      updatedAt: '2026-06-05T10:03:00.000Z',
      endedAt: '2026-06-05T10:03:00.000Z',
    };

    expect(
      applySubagentEvent(state, {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_parent',
          part: {
            type: 'tool',
            tool: 'task',
            id: 'tool_1',
            sessionID: 'ses_parent',
            messageID: 'msg_1',
            state: {
              status: 'error',
              input: { description: 'Execute failing slice' },
              metadata: { sessionId: 'ses_child' },
              time: { end: '2026-06-05T10:10:00.000Z' },
            },
          },
        },
      }),
    ).toBe(true);

    expect(state.children['subtask:part_1']).toMatchObject({
      status: 'error',
      targetSessionID: 'ses_child',
      updatedAt: '2026-06-05T10:03:00.000Z',
      endedAt: '2026-06-05T10:03:00.000Z',
    });
  });
});
