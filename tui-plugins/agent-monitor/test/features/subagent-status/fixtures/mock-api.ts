import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { vi } from 'vitest';

export const createMockApi = (): TuiPluginApi =>
  ({
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
  }) as unknown as TuiPluginApi;
