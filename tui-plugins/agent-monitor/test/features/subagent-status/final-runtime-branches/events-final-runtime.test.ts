import { describe, expect, it, vi } from 'vitest';

import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import { installEventBridge } from '../../../../src/features/subagent-status/runtime/events/bridge.ts';
import { applySubagentEvent } from '../../../../src/features/subagent-status/runtime/events/handle.ts';
import {
  buildToolChild,
  extractChildCore,
  extractChildTimestamps,
  extractCreatedChild,
  extractSubtaskChild,
  extractTaskToolEvidence,
  extractToolChild,
  extractToolTitle,
  validateToolPart,
} from '../../../../src/features/subagent-status/runtime/events/extract-child.ts';

const baseEvent = (part: Record<string, unknown>) => ({
  type: 'message.part.updated',
  properties: { sessionID: 'ses_parent', part },
});

describe('final runtime event branches', () => {
  it('contains refresh rejection and unsubscribe failures during bridge cleanup', async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const unsubscribe = vi.fn(() => {
      throw new Error('unsubscribe failed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dispose = installEventBridge(
      {
        event: {
          on: vi.fn((name: string, handler: (event: unknown) => void) => {
            handlers.set(name, handler);
            return unsubscribe;
          }),
        },
        lifecycle: { onDispose: vi.fn() },
      } as never,
      async () => {
        throw new Error('refresh failed');
      },
    );
    handlers.get('session.error')?.({});
    await Promise.resolve();
    dispose();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects incomplete child and tool payloads', () => {
    expect(extractChildCore({ properties: { info: { id: 'only-id' } } })).toBeNull();
    expect(extractSubtaskChild(baseEvent({ type: 'subtask', id: 'part' }))).toBeNull();
    expect(extractToolChild(baseEvent({ type: 'tool', tool: 'other' }))).toBeNull();
    expect(validateToolPart(baseEvent({ type: 'tool', tool: 'task', id: 'id', messageID: 'msg' }))).toBeNull();
    expect(extractTaskToolEvidence(baseEvent({ type: 'tool', tool: 'delegate', state: {} }))).toBeNull();
  });

  it('uses fallback titles, timestamps, and terminal status variants', () => {
    const event = {
      type: 'session.created',
      properties: {
        info: {
          id: 'ses_child',
          parentID: 'ses_parent',
          name: 'Named child',
          status: 'completed',
          time: { created: '2026-07-15T10:00:00.000Z', completed: '2026-07-15T10:01:00.000Z' },
        },
      },
    };
    expect(extractCreatedChild(event)).toMatchObject({ id: 'ses_child', title: 'Named child', status: 'done' });
    expect(extractChildTimestamps(event, 'done')).toMatchObject({ endedAt: '2026-07-15T10:01:00.000Z' });
    expect(extractToolTitle({}, { input: { prompt: 'Prompt text' } }, 'delegate')).toBe('Prompt text');
    expect(extractToolTitle({}, {}, 'delegate')).toBe('delegate');
  });

  it('applies tool completion to its synthetic and target rows', () => {
    const state = createEmptyState();
    state.children.ses_child = {
      id: 'ses_child',
      title: 'Child',
      parentID: 'ses_parent',
      source: 'session',
      targetSessionID: 'ses_child',
      status: 'running',
      startedAt: '2026-07-15T10:00:00.000Z',
      updatedAt: '2026-07-15T10:00:00.000Z',
    };
    state.children.subtask = {
      id: 'subtask',
      title: 'Task',
      parentID: 'ses_parent',
      messageID: 'msg',
      source: 'subtask',
      targetSessionID: 'ses_child',
      status: 'running',
      startedAt: '2026-07-15T10:00:00.000Z',
      updatedAt: '2026-07-15T10:00:00.000Z',
    };
    const event = baseEvent({
      type: 'tool',
      tool: 'task',
      id: 'call',
      sessionID: 'ses_parent',
      messageID: 'msg',
      state: { status: 'error', time: { end: '2026-07-15T10:02:00.000Z' }, input: { description: 'Task' } },
    });
    expect(applySubagentEvent(state, event)).toBe(true);
    expect(state.children['tool:call']).toMatchObject({ status: 'error' });
    expect(state.children.ses_child?.status).toBe('error');
    expect(state.children.subtask?.status).toBe('error');
  });
});
