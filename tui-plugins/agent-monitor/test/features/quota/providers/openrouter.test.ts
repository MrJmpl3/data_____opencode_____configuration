import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchOpenRouterQuota,
  formatOpenRouterLines,
} from '../../../../src/features/quota/infrastructure/providers/openrouter.ts';

describe('OpenRouter provider', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agent-monitor-openrouter-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', directory);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });
  const auth = (value: unknown): void => writeFileSync(join(directory, 'auth.json'), JSON.stringify(value));

  it('returns remaining credits from wrapped payload and sends the API key', async () => {
    auth({ openrouter: { type: 'api', key: ' router-key ' } });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 2.5 } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchOpenRouterQuota()).resolves.toEqual({ text: '$7.50', remaining: 7.5, total: 10, usage: 2.5 });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer router-key' } });
  });

  it('handles unlimited usage, malformed payloads, HTTP errors, and missing auth', async () => {
    auth({ openrouter: { type: 'api', key: 'key' } });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ total_usage: 1.23456 }), { status: 200 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValueOnce(new Response('busy', { status: 503 })),
    );

    await expect(fetchOpenRouterQuota()).resolves.toEqual({ text: '$1.2346 used (no limit)', usage: 1.23456 });
    await expect(fetchOpenRouterQuota()).resolves.toEqual({ error: 'OpenRouter did not return expected credit data' });
    await expect(fetchOpenRouterQuota()).resolves.toMatchObject({ error: 'OpenRouter HTTP 503; busy' });
    rmSync(join(directory, 'auth.json'));
    await expect(fetchOpenRouterQuota()).resolves.toBeNull();
  });

  it('formats remaining and used display lines', () => {
    expect(formatOpenRouterLines({ text: '$7.50', remaining: 7.5, total: 10, usage: 2.5 }, 'remaining')).toEqual([
      { kind: 'detail', text: 'Credits $7.50', tone: 'neutral' },
    ]);
    expect(formatOpenRouterLines({ text: '$7.50', remaining: 7.5, total: 10, usage: 2.5 }, 'used')[0]).toMatchObject({
      text: 'Credits $2.50/$10.00',
    });
  });
});
