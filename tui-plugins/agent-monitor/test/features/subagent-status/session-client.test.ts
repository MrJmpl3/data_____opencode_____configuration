import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionClientBoundary } from '../../../src/features/subagent-status/runtime/session/session-client.ts';

const TIMEOUT_MS = 100;

describe('session-client timeout', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects listChildren when the call hangs beyond the timeout', async () => {
    const api = {
      client: {
        session: {
          children: vi.fn(() => new Promise<never>(() => {})), // never resolves
          status: vi.fn(),
          messages: vi.fn(),
        },
      },
      state: { path: { directory: '/tmp' } },
    };

    const client = createSessionClientBoundary(api, TIMEOUT_MS);
    await expect(client.listChildren('ses_x')).rejects.toThrow('Session client timed out');
  });

  it('rejects readStatusMap when the call hangs beyond the timeout', async () => {
    const api = {
      client: {
        session: {
          children: vi.fn(),
          status: vi.fn(() => new Promise<never>(() => {})),
          messages: vi.fn(),
        },
      },
      state: { path: { directory: '/tmp' } },
    };

    const client = createSessionClientBoundary(api, TIMEOUT_MS);
    await expect(client.readStatusMap()).rejects.toThrow('Session client timed out');
  });

  it('rejects readMessages when the call hangs beyond the timeout', async () => {
    const api = {
      client: {
        session: {
          children: vi.fn(),
          status: vi.fn(),
          messages: vi.fn(() => new Promise<never>(() => {})),
        },
      },
      state: { path: { directory: '/tmp' } },
    };

    const client = createSessionClientBoundary(api, TIMEOUT_MS);
    await expect(client.readMessages('ses_x')).rejects.toThrow('Session client timed out');
  });

  it('resolves listChildren normally when the call completes before timeout', async () => {
    const api = {
      client: {
        session: {
          children: vi.fn(async () => ({ data: [{ id: 'ses_1' }] })),
          status: vi.fn(),
          messages: vi.fn(),
        },
      },
      state: { path: { directory: '/tmp' } },
    };

    const client = createSessionClientBoundary(api);
    const result = await client.listChildren('ses_x');
    expect(result).toEqual({ data: [{ id: 'ses_1' }] });
  });

  it('resolves readStatusMap normally when the call completes before timeout', async () => {
    const api = {
      client: {
        session: {
          children: vi.fn(),
          status: vi.fn(async () => ({ data: { ses_1: { status: 'running' } } })),
          messages: vi.fn(),
        },
      },
      state: { path: { directory: '/tmp' } },
    };

    const client = createSessionClientBoundary(api);
    const result = await client.readStatusMap();
    expect(result).toEqual({ ses_1: { status: 'running' } });
  });

  it('resolves readMessages normally when the call completes before timeout', async () => {
    const api = {
      client: {
        session: {
          children: vi.fn(),
          status: vi.fn(),
          messages: vi.fn(async () => ({ data: [{ type: 'step-finish' }] })),
        },
      },
      state: { path: { directory: '/tmp' } },
    };

    const client = createSessionClientBoundary(api);
    const result = await client.readMessages('ses_x');
    expect(result).toEqual([{ type: 'step-finish' }]);
  });
});
