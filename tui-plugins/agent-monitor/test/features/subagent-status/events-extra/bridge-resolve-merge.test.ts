import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { describe, expect, it, vi } from 'vitest';

import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import { installEventBridge } from '../../../../src/features/subagent-status/runtime/events/bridge.ts';
import { createMergeEventState } from '../../../../src/features/subagent-status/runtime/events/merge.ts';
import type { PersistSnapshotMeta } from '../../../../src/features/subagent-status/runtime/snapshot.ts';
import {
  extractPartTargetSessionCandidates,
  mapTaskToolToSubtaskID,
  parseTaskSessionIdFromOutput,
  resolveSyntheticTargetSessionID,
} from '../../../../src/features/subagent-status/runtime/events/resolve.ts';
import type { SubagentState } from '../../../../src/features/subagent-status/domain/types.ts';

const meta = (source: PersistSnapshotMeta['source']): PersistSnapshotMeta => ({ source });

describe('subagent event bridge and resolution', () => {
  it('subscribes to relevant events, forwards payloads, refreshes, and disposes once', async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const unsubs = new Map<string, ReturnType<typeof vi.fn>>();
    const onDispose = vi.fn();
    const refresh = vi.fn(async () => undefined);
    const onEvent = vi.fn();
    const api = {
      event: {
        on: vi.fn((name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
          const unsubscribe = vi.fn();
          unsubs.set(name, unsubscribe);
          return unsubscribe;
        }),
      },
      lifecycle: { onDispose },
    } as unknown as Pick<TuiPluginApi, 'event' | 'lifecycle'>;

    const dispose = installEventBridge(api, refresh, onEvent);
    expect(handlers.size).toBe(8);
    handlers.get('session.status')?.({ type: 'session.status' });
    await Promise.resolve();
    expect(onEvent).toHaveBeenCalledWith({ type: 'session.status' });
    expect(refresh).toHaveBeenCalledTimes(1);

    dispose();
    dispose();
    expect([...unsubs.values()].every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
    expect(onDispose).toHaveBeenCalledWith(expect.any(Function));
  });

  it('supports missing subscriptions and logs unsubscribe failures without aborting cleanup', () => {
    const dispose = installEventBridge(
      { event: {}, lifecycle: { onDispose: vi.fn() } } as unknown as Pick<TuiPluginApi, 'event' | 'lifecycle'>,
      vi.fn(async () => undefined),
    );
    expect(() => dispose()).not.toThrow();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = {
      event: {
        on: vi.fn(() => {
          throw new Error('subscribe failed');
        }),
      },
      lifecycle: { onDispose: vi.fn() },
    } as unknown as Pick<TuiPluginApi, 'event' | 'lifecycle'>;
    expect(() =>
      installEventBridge(
        api,
        vi.fn(async () => undefined),
      ),
    ).toThrow('subscribe failed');
    warn.mockRestore();
  });

  it('resolves unambiguous task targets while rejecting parent and ambiguous candidates', () => {
    expect(parseTaskSessionIdFromOutput('task_id: ses_child-1', 'ses_parent')).toBe('ses_child-1');
    expect(parseTaskSessionIdFromOutput('ses_parent ses_child-1 ses_child-2', 'ses_parent')).toBeUndefined();

    const event = {
      properties: {
        sessionID: 'ses_parent',
        part: { type: 'tool', sessionId: 'ses_child', sessionIds: ['ses_other'] },
      },
    };
    expect(extractPartTargetSessionCandidates(event)).toEqual(['ses_child', 'ses_other']);

    const state = createEmptyState();
    state.children.ses_child = {
      id: 'ses_child',
      title: 'Child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      startedAt: '2026-06-05T10:00:00.000Z',
      updatedAt: '2026-06-05T10:00:00.000Z',
      messageID: 'msg_1',
    };
    expect(resolveSyntheticTargetSessionID(state, { parentID: 'ses_parent', messageID: 'msg_1' })).toBe('ses_child');
    expect(
      mapTaskToolToSubtaskID(state, { parentID: 'ses_parent', messageID: 'msg_1', title: 'Child' }),
    ).toBeUndefined();
  });
});

describe('serialized event state merge', () => {
  const createInput = (initialState: SubagentState, currentSessionId = 'ses_parent') => {
    let state = initialState;
    const synced: SubagentState[] = [];
    const input = {
      isDisposed: () => false,
      getCurrentState: () => state,
      getCurrentSessionId: () => currentSessionId,
      isBufferingStartupScopedEvents: () => true,
      bufferStartupScopedEvent: vi.fn(),
      syncState: vi.fn(async (nextState: SubagentState): Promise<void> => {
        synced.push(nextState);
      }),
      createPersistMeta: meta,
    };
    return {
      input,
      synced,
      replaceState: (nextState: SubagentState) => {
        state = nextState;
      },
    };
  };

  it('filters unrelated events and buffers startup events without a selected session', async () => {
    const state = createEmptyState();
    const unrelated = createInput(state);
    await createMergeEventState(unrelated.input)({
      type: 'session.created',
      properties: { info: { id: 'ses_other', parentID: 'ses_nope' } },
    });
    expect(unrelated.input.syncState).not.toHaveBeenCalled();

    const startup = createInput(state, '');
    await createMergeEventState(startup.input)({
      type: 'session.created',
      properties: { info: { id: 'ses_child', parentID: 'ses_parent' } },
    });
    expect(startup.input.bufferStartupScopedEvent).toHaveBeenCalledWith('ses_child', expect.any(Object));
  });

  it('merges a new event child without dropping existing live state', async () => {
    const state = createEmptyState();
    state.children.ses_live = {
      id: 'ses_live',
      title: 'Live',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      startedAt: '2026-06-05T10:00:00.000Z',
      updatedAt: '2026-06-05T10:00:00.000Z',
    };
    const { input, synced } = createInput(state);
    const merge = createMergeEventState(input);
    const pending = merge({
      type: 'session.created',
      properties: { info: { id: 'ses_child', parentID: 'ses_parent', title: 'Child' } },
    });
    await pending;
    expect(synced[0]?.children.ses_live).toBeDefined();
    expect(synced[0]?.children.ses_child).toBeDefined();
  });
});
