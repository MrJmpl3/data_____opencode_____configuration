import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOpenAIQuota } from '../../../../src/features/quota/infrastructure/providers/openai.ts';

describe('OpenAI remaining branches', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agent-monitor-openai-extra-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', directory);
    writeFileSync(join(directory, 'auth.json'), JSON.stringify({ openai: { type: 'oauth', access: 'token' } }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('accepts alternate fields and unlimited credits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            planType: 'team',
            rate_limit: { hourly: { used_percent: 10, reset_after_seconds: 20 } },
            code_review_rate_limit: { primary: { used_percent: 40, reset_after: 30 } },
            credits: { unlimited: true },
          }),
        ),
      ),
    );
    await expect(fetchOpenAIQuota()).resolves.toMatchObject({
      planType: 'team',
      hourly: { usedPct: 10 },
      codeReview: { usedPct: 40 },
      credits: 'Unlimited',
    });
  });

  it('rejects non-object usage and reports reset-credit invalid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify([])))
        .mockResolvedValueOnce(new Response('not-json')),
    );
    await expect(fetchOpenAIQuota({ experimentalResetCredits: true })).resolves.toEqual({
      error: 'OpenAI did not return expected quota data',
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ plan_type: 'free' })))
        .mockResolvedValueOnce(new Response('not-json')),
    );
    await expect(fetchOpenAIQuota({ experimentalResetCredits: true })).resolves.toMatchObject({
      resetCredits: { state: 'unavailable', errorMessage: expect.stringContaining('invalid JSON') },
    });
  });
});
