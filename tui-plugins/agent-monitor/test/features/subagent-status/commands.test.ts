import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { describe, expect, it, vi } from 'vitest';

import { registerSubagentStatusTui } from '../../../src/features/subagent-status/runtime/runtime.tsx';

describe('runtime command integration', () => {
  it('does not register manual commands or keymap layers', async () => {
    vi.resetModules();

    const registerLayer = vi.fn();
    const registerCommand = vi.fn();

    const api = {
      client: {
        session: {
          children: vi.fn(async () => ({ data: [] })),
        },
      },
      command: {
        register: registerCommand,
      },
      keymap: {
        registerLayer,
      },
      lifecycle: {
        onDispose: vi.fn(),
      },
      route: {
        current: { name: 'home' },
        navigate: vi.fn(),
      },
      slots: {
        register: vi.fn(),
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
      theme: {
        current: {
          error: 'red',
          success: 'green',
          text: 'white',
          textMuted: 'gray',
          warning: 'yellow',
        },
      },
    } as unknown as TuiPluginApi;

    await registerSubagentStatusTui(api, undefined);

    expect(registerLayer).not.toHaveBeenCalled();
    expect(registerCommand).not.toHaveBeenCalled();
  });
});
