import { describe, expect, it } from 'vitest';

import { applySubagentEvent, extractTaskToolEvidence } from './events.ts';
import { createEmptyState } from './state.ts';

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
      status: 'running',
      targetSessionID: 'ses_child_1',
    });
    expect(evidence?.endedAt).toBeUndefined();
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

  it('keeps matching tool and subtask rows running until the delegated session finishes', () => {
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
          targetSession: 'ses_child_1',
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
      status: 'running',
      targetSessionID: 'ses_child_1',
    });
    expect(state.children['subtask:part_1']).toMatchObject({
      status: 'running',
      targetSessionID: 'ses_child_1',
    });
    expect(state.children['tool:tool_1']?.endedAt).toBeUndefined();
    expect(state.children['subtask:part_1']?.endedAt).toBeUndefined();
  });
});
