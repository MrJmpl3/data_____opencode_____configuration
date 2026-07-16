/** @jsxImportSource @opentui/solid */
import { describe, expect, it, vi } from 'vitest';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import { registerSubagentStatusTui } from '../../../../src/features/subagent-status/runtime/runtime.tsx';
import { memoryElements, renderMemory } from '../../../support/opentui-memory-renderer.ts';

const createApi = () => {
  const registrations: Array<{ slots: Record<string, (...args: any[]) => unknown> }> = [];
  const api = {
    client: {
      session: {
        children: vi.fn(async () => ({ data: [] })),
        status: vi.fn(async () => ({ data: {} })),
        messages: vi.fn(async () => ({ data: [] })),
      },
    },
    event: { on: vi.fn(() => vi.fn()) },
    lifecycle: { onDispose: vi.fn() },
    route: { current: '', navigate: vi.fn() },
    slots: { register: vi.fn((registration) => registrations.push(registration)) },
    state: { path: { directory: '/tmp' }, session: { messages: vi.fn(() => []), status: vi.fn(() => undefined) } },
    theme: { current: { text: 'white', textMuted: 'gray', warning: 'yellow', success: 'green', error: 'red' } },
    ui: {
      Prompt: (props: Record<string, unknown>) => ({ kind: 'element', type: 'prompt', props, children: [] }),
      Slot: (props: Record<string, unknown>) => ({ kind: 'element', type: 'slot', props, children: [] }),
    },
  } as unknown as TuiPluginApi;
  return { api, registrations };
};

describe('final runtime registration branches', () => {
  it('normalizes every session id prop and toggles the rendered sidebar', async () => {
    const { api, registrations } = createApi();
    await registerSubagentStatusTui(api, undefined);
    const slots = registrations[0]?.slots;
    expect(slots?.session_prompt?.({}, {})).toBeDefined();
    expect(slots?.session_prompt?.({}, { sessionId: 'ses_a' })).toBeDefined();
    expect(slots?.session_prompt?.({}, { sessionID: 'ses_b' })).toBeDefined();
    const sidebar = renderMemory(() => slots?.sidebar_content?.({}, { session_id: 'ses_parent' }) as any);
    const toggle = memoryElements(sidebar.root).find((node) => typeof node.props.onMouseDown === 'function');
    expect(toggle).toBeDefined();
    (toggle?.props.onMouseDown as () => void)();
    sidebar.dispose();
  });
});
