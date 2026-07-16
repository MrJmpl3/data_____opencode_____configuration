import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchOpenAIQuota } from '../../../../src/features/quota/infrastructure/providers/openai.ts';

describe('OpenAI provider', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agent-monitor-openai-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', directory);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });
  const auth = (access = 'token', extra: Record<string, unknown> = {}): void =>
    writeFileSync(join(directory, 'auth.json'), JSON.stringify({ openai: { type: 'oauth', access, ...extra } }));

  it('parses quota windows, credits, additional limits, account auth, and reset credits', async () => {
    auth('token', { account_id: 'account' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              plan_type: 'pro',
              rate_limit: {
                primary_window: { used_percent: 25, reset_after_seconds: 30 },
                secondary: { remaining_percent: 80, reset_after: 60 },
              },
              credits: { has_credits: true, balance: 2.5 },
              additional_rate_limits: {
                images: { limit_name: 'Images', rate_limit: { primary: { used_percent: 10, reset_after: 5 } } },
              },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              available_count: 1,
              credits: [{ status: 'available', expires_at: '2099-01-01T00:00:00Z' }],
            }),
            { status: 200 },
          ),
        ),
    );
    const result = await fetchOpenAIQuota({ experimentalResetCredits: true });
    expect(result).toMatchObject({
      planType: 'pro',
      credits: '$2.50',
      hourly: { usedPct: 25, resetSec: 30 },
      weekly: { usedPct: 20, resetSec: 60 },
      resetCredits: { state: 'available', availableCount: 1 },
    });
    expect((result as { additionalRateLimits: unknown[] }).additionalRateLimits).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ headers: { 'ChatGPT-Account-Id': 'account' } });
  });

  it('returns null without auth and errors for malformed, non-2xx, invalid JSON, and unreachable usage', async () => {
    await expect(fetchOpenAIQuota()).resolves.toBeNull();
    auth();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValueOnce(new Response('bad', { status: 401 }))
        .mockResolvedValueOnce(new Response('not-json', { status: 200 })),
    );
    await expect(fetchOpenAIQuota()).resolves.toEqual({ error: 'OpenAI did not return expected quota data' });
    await expect(fetchOpenAIQuota()).resolves.toMatchObject({ error: 'OpenAI HTTP 401; bad' });
    await expect(fetchOpenAIQuota()).resolves.toMatchObject({ error: expect.stringContaining('invalid JSON') });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchOpenAIQuota()).resolves.toEqual({ error: 'OpenAI usage endpoint unreachable' });
  });

  it('reports reset-credit HTTP and malformed responses while preserving usage', async () => {
    auth();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ planType: 'free' }), { status: 200 }))
        .mockResolvedValueOnce(new Response('failure', { status: 500 })),
    );
    const result = await fetchOpenAIQuota({ experimentalResetCredits: true });
    expect(result).toMatchObject({
      planType: 'free',
      resetCredits: { state: 'unavailable', errorMessage: 'OpenAI reset credits HTTP 500; failure' },
    });
  });
});
