import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchCopilotQuota,
  formatCopilotLines,
} from '../../../../src/features/quota/infrastructure/providers/copilot.ts';
import {
  fetchDeepSeekQuota,
  formatDeepSeekLines,
} from '../../../../src/features/quota/infrastructure/providers/deepseek.ts';
import { fetchOpenRouterQuota } from '../../../../src/features/quota/infrastructure/providers/openrouter.ts';
import { fetchOpenAIQuota } from '../../../../src/features/quota/infrastructure/providers/openai.ts';

describe('quota provider branch behavior', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agent-monitor-branch-providers-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', directory);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('formats Copilot pace from a percent and derives used percentages without one', () => {
    expect(formatCopilotLines({ text: '20/100', resetSec: 120, pctRemaining: 20 }, 'remaining', 1_000)).toEqual([
      { kind: 'window', label: 'Mo', value: '20/100', resetAtMs: 121_000, tone: 'neutral', usedPct: 80 },
      { kind: 'pace', usedPct: 80, resetAtMs: 121_000, windowSeconds: 2_592_000 },
    ]);
    expect(formatCopilotLines({ text: '20/100', resetSec: 0, used: 20, total: 100 }, 'used', 1_000)).toEqual([
      { kind: 'detail', text: 'Monthly 20 pts', tone: 'neutral' },
    ]);
  });

  it('handles Copilot derived values, unknown tiers, and reset defaults', async () => {
    writeFileSync(
      join(directory, 'auth.json'),
      JSON.stringify({ 'github-copilot': { type: 'oauth', access: 'token' } }),
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ used: 15, remaining: 5 }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ plan: 'mystery', used: 1 }), { status: 200 })),
    );
    await expect(fetchCopilotQuota()).resolves.toMatchObject({ total: 20, used: 15, remaining: 5 });
    await expect(fetchCopilotQuota()).resolves.toMatchObject({ total: 300, used: 1, remaining: 299 });
  });

  it('formats unavailable DeepSeek balances and rejects available empty payloads', async () => {
    writeFileSync(join(directory, 'auth.json'), JSON.stringify({ deepseek: { type: 'api', key: 'key' } }));
    expect(
      formatDeepSeekLines({ isAvailable: false, balances: [{ currency: 'EUR', totalBalance: 2 }] }, 'remaining'),
    ).toEqual([
      { kind: 'heading', text: 'DeepSeek' },
      { kind: 'detail', text: 'Balance $2.00', tone: 'error' },
    ]);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ is_available: true, balance_infos: [] }), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ is_available: false, balance_infos: [{ currency: 'USD' }] }), { status: 200 }),
        ),
    );
    await expect(fetchDeepSeekQuota()).resolves.toEqual({ error: 'DeepSeek did not return expected balance data' });
    await expect(fetchDeepSeekQuota()).resolves.toEqual({ isAvailable: false, balances: [] });
  });

  it('accepts unwrapped OpenRouter payloads and treats non-positive totals as unlimited', async () => {
    writeFileSync(join(directory, 'auth.json'), JSON.stringify({ openrouter: { apiKey: 'router-key' } }));
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ total_credits: 0, total_usage: 2 }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    await expect(fetchOpenRouterQuota()).resolves.toEqual({ text: '$2.0000 used (no limit)', usage: 2 });
    await expect(fetchOpenRouterQuota()).resolves.toEqual({ error: 'OpenRouter did not return expected credit data' });
  });

  it('distinguishes OpenAI credit states and reset-credit malformed responses', async () => {
    writeFileSync(join(directory, 'auth.json'), JSON.stringify({ openai: { type: 'oauth', access: 'token' } }));
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ credits: { unlimited: true } }), { status: 200 }))
        .mockResolvedValueOnce(new Response('{', { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ plan_type: 'free' }), { status: 200 }))
        .mockResolvedValueOnce(new Response('{', { status: 200 })),
    );
    await expect(fetchOpenAIQuota()).resolves.toMatchObject({ credits: 'Unlimited' });
    await expect(fetchOpenAIQuota()).resolves.toMatchObject({ error: expect.stringContaining('invalid JSON') });
    await expect(fetchOpenAIQuota({ experimentalResetCredits: true })).resolves.toMatchObject({
      planType: 'free',
      resetCredits: { state: 'unavailable' },
    });
  });
});
