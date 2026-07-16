import { describe, expect, it } from 'vitest';

import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import { applySubagentEvent } from '../../../../src/features/subagent-status/runtime/events/handle.ts';

describe('event terminal handling gaps', () => {
  it('routes terminal idle evidence through terminal status handling', () => {
    const state = createEmptyState();
    applySubagentEvent(state, {
      type: 'session.created',
      properties: {
        info: {
          id: 'ses_child',
          parentID: 'ses_parent',
          title: 'Child',
          time: { created: '2026-06-05T10:00:00.000Z' },
        },
      },
    });

    expect(
      applySubagentEvent(state, {
        type: 'session.idle',
        properties: {
          sessionID: 'ses_child',
          status: 'cancelled',
          info: { time: { completed: '2026-06-05T10:02:00.000Z' } },
        },
      }),
    ).toBe(true);
    expect(state.children.ses_child).toMatchObject({ status: 'error', endedAt: '2026-06-05T10:02:00.000Z' });
  });

  it('rejects malformed and irrelevant payloads without mutating state', () => {
    const state = createEmptyState();
    expect(applySubagentEvent(state, null)).toBe(false);
    expect(applySubagentEvent(state, { type: 'message.updated', properties: {} })).toBe(false);
    expect(state.children).toEqual({});
  });
});
