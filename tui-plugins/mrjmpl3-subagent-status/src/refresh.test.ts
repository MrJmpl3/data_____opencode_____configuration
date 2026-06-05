import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { describe, expect, it, vi } from 'vitest';

import { createEmptyState } from './state.ts';
import type { SubagentState } from './types.ts';

async function waitForCondition(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('refresh runtime', () => {
  it('replays buffered synthetic events after the session is selected', async () => {
    vi.resetModules();

    let capturedOnEvent: ((event: unknown) => void) | undefined;

    vi.doMock('./events.ts', async () => {
      const actual = await vi.importActual<typeof import('./events.ts')>('./events.ts');

      return {
        ...actual,
        installEventBridge: vi.fn((_api, _refresh, onEvent) => {
          capturedOnEvent = onEvent;
          return () => {
            capturedOnEvent = undefined;
          };
        }),
      };
    });

    vi.doMock('./persistence.ts', async () => {
      const actual = await vi.importActual<typeof import('./persistence.ts')>('./persistence.ts');

      return {
        ...actual,
        resolveStatePath: vi.fn(() => '/tmp/mrjmpl3-subagent-status-state.json'),
        resolveTextPath: vi.fn(() => '/tmp/mrjmpl3-subagent-status-status.txt'),
        loadState: vi.fn(async () => createEmptyState()),
        shouldPreserveStateOnStartup: vi.fn(() => false),
        createPersistQueue: vi.fn(() => async () => undefined),
      };
    });

    const { createTuiRuntime } = await import('./refresh.ts');

    let state: SubagentState = createEmptyState();
    let sessionID = '';
    const api = {
      client: {
        session: {
          children: vi.fn(async () => ({ data: [] })),
        },
      },
      event: {},
      lifecycle: {
        onDispose: vi.fn(),
      },
      state: {
        path: {
          directory: '/tmp/workspace',
        },
        session: {
          messages: vi.fn(() => []),
          status: vi.fn(() => undefined),
        },
      },
    } as unknown as TuiPluginApi;

    const runtime = createTuiRuntime(api, {
      getState: () => state,
      setState: (nextState) => {
        state = nextState;
      },
      getSessionId: () => sessionID,
      setSessionId: (nextSessionID) => {
        sessionID = nextSessionID;
      },
      setNowMs: vi.fn(),
    });

    capturedOnEvent?.({
      type: 'message.part.updated',
      sessionID: 'ses_parent',
      properties: {
        part: {
          type: 'subtask',
          id: 'part_1',
          sessionID: 'ses_parent',
          messageID: 'msg_1',
          description: 'Buffered synthetic child',
          state: {
            input: {
              prompt: 'Buffered synthetic child',
            },
          },
        },
      },
    });

    await runtime.bootstrap();

    expect(state.children['subtask:part_1']).toBeUndefined();

    runtime.refreshFromSlot({ session_id: 'ses_parent' });
    await waitForCondition(() => state.children['subtask:part_1'] !== undefined);

    expect(state.children['subtask:part_1']).toMatchObject({
      id: 'subtask:part_1',
      parentID: 'ses_parent',
      source: 'subtask',
      status: 'running',
      title: 'Buffered synthetic child',
    });

    runtime.dispose();
  });
});
