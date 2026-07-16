/** @jsxImportSource @opentui/solid */
import { describe, expect, it, vi } from 'vitest';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import { registerSubagentStatusTui } from '../../../../src/features/subagent-status/runtime/runtime.tsx';
import { jsx, renderMemory, memoryText } from '../../../support/opentui-memory-renderer.ts';

const createApi = () => {
  const disposers: Array<() => void> = [];
  const registrations: Array<{ order: number; slots: Record<string, (...args: any[]) => unknown> }> = [];
  const api = {
    client: {
      session: {
        children: vi.fn(async () => ({ data: [] })),
        status: vi.fn(async () => ({ data: {} })),
        messages: vi.fn(async () => ({ data: [] })),
      },
    },
    event: { on: vi.fn(() => vi.fn()) },
    lifecycle: { onDispose: vi.fn((dispose: () => void) => disposers.push(dispose)) },
    route: { current: '', navigate: vi.fn() },
    slots: { register: vi.fn((registration) => registrations.push(registration)) },
    state: {
      path: { directory: '/tmp' },
      session: {
        children: vi.fn(async () => ({ data: [] })),
        messages: vi.fn(() => []),
        status: vi.fn(() => undefined),
      },
    },
    theme: { current: { text: 'white', textMuted: 'gray', warning: 'yellow', success: 'green', error: 'red' } },
    ui: {
      Prompt: (props: Record<string, unknown>) => jsx('prompt', props),
      Slot: (props: Record<string, unknown>) => jsx('slot', props),
    },
  } as unknown as TuiPluginApi;
  return { api, disposers, registrations };
};

describe('subagent status slot registration', () => {
  it('registers home, session, sidebar, and bottom slots and invokes each callback', async () => {
    const { api, registrations } = createApi();
    await registerSubagentStatusTui(api, undefined);

    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.order).toBe(110);
    const slots = registrations[0]?.slots;
    expect(Object.keys(slots ?? {}).sort()).toEqual([
      'home_bottom',
      'home_prompt',
      'session_prompt',
      'sidebar_content',
    ]);

    const home = slots?.home_prompt?.({}, { workspace_id: 'workspace' });
    const session = slots?.session_prompt?.({}, { session_id: 'ses_parent' });
    expect(home).toBeDefined();
    expect(session).toBeDefined();

    const sidebar = renderMemory(() => slots?.sidebar_content?.({}, { sessionID: 'ses_parent' }) as any);
    expect(memoryText(sidebar.root)).toContain('Subagents');
    sidebar.dispose();

    const bottom = renderMemory(() => slots?.home_bottom?.({}, {}) as any);
    expect(bottom.root.children).toHaveLength(0);
    bottom.dispose();
  });

  it('disposes runtime subscriptions and timers through the observable lifecycle hook', async () => {
    const { api, disposers } = createApi();
    await registerSubagentStatusTui(api, undefined);

    expect(disposers.length).toBeGreaterThan(0);
    const unsubscribe = api.event.on as ReturnType<typeof vi.fn>;
    expect(unsubscribe).toHaveBeenCalled();
    const callbacks = unsubscribe.mock.results.map((result) => result.value as ReturnType<typeof vi.fn>);
    disposers.forEach((dispose) => dispose());
    callbacks.forEach((callback) => expect(callback).toHaveBeenCalled());
  });
});
