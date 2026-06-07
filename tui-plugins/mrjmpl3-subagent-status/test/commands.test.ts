import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { describe, expect, it, vi } from 'vitest';

describe('runtime command integration', () => {
  it('does not register manual commands or keymap layers', async () => {
    vi.resetModules();

    const { default: plugin } = await import('../index.tsx');
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

    await plugin.tui(api, undefined, undefined as never);

    expect(registerLayer).not.toHaveBeenCalled();
    expect(registerCommand).not.toHaveBeenCalled();
  });
});
