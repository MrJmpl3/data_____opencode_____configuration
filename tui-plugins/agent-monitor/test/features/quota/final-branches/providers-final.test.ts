import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readAuthProviderApiKey,
  readOpenAIAccountId,
} from '../../../../src/features/quota/infrastructure/providers/auth.ts';
import {
  fetchCopilotQuota,
  formatCopilotLines,
} from '../../../../src/features/quota/infrastructure/providers/copilot.ts';
import {
  fetchDeepSeekQuota,
  formatDeepSeekLines,
} from '../../../../src/features/quota/infrastructure/providers/deepseek.ts';
import { fetchOpenAIQuota } from '../../../../src/features/quota/infrastructure/providers/openai.ts';
import { fetchOpenRouterQuota } from '../../../../src/features/quota/infrastructure/providers/openrouter.ts';

describe('final quota provider branches', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agent-monitor-final-providers-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', directory);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('uses Copilot total and remaining fields and derives pace from counts', async () => {
    writeFileSync(
      join(directory, 'auth.json'),
      JSON.stringify({ 'github-copilot': { type: 'oauth', access: 'token' } }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ total: 100, remaining: 20 }), { status: 200 })),
    );

    await expect(fetchCopilotQuota()).resolves.toMatchObject({ total: 100, used: 80, remaining: 20 });
    expect(formatCopilotLines({ text: '20/100', total: 100, used: 80, resetSec: 60 }, 'used', 1_000)).toEqual([
      { kind: 'window', label: 'Mo', value: '80 pts', resetAtMs: 61_000, tone: 'neutral', usedPct: 80 },
    ]);
  });

  it('handles DeepSeek empty and non-record balance entries without inventing balances', async () => {
    writeFileSync(join(directory, 'auth.json'), JSON.stringify({ deepseek: { type: 'api', key: 'key' } }));
    expect(formatDeepSeekLines({ isAvailable: false, balances: [] }, 'remaining')).toEqual([]);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ is_available: false, balance_infos: [null] }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify('not-a-balance'), { status: 200 })),
    );

    await expect(fetchDeepSeekQuota()).resolves.toEqual({ isAvailable: false, balances: [] });
    await expect(fetchDeepSeekQuota()).resolves.toEqual({ error: 'DeepSeek did not return expected balance data' });
  });

  it('rejects primitive OpenRouter payloads', async () => {
    writeFileSync(join(directory, 'auth.json'), JSON.stringify({ openrouter: { token: 'router-key' } }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify('not-credit-data'), { status: 200 })));
    await expect(fetchOpenRouterQuota()).resolves.toEqual({ error: 'OpenRouter did not return expected credit data' });
    expect(readAuthProviderApiKey('openrouter')).toBe('router-key');
  });

  it('reports unreadable provider error bodies while preserving OpenAI usage flow', async () => {
    writeFileSync(join(directory, 'auth.json'), JSON.stringify({ openai: { type: 'oauth', access: 'token' } }));
    const unreadable = () => {
      const response = new Response(null, { status: 503 });
      vi.spyOn(response, 'text').mockRejectedValue(new Error('body unavailable'));
      return response;
    };
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(unreadable()).mockReturnValueOnce(unreadable()));

    await expect(fetchOpenAIQuota({ experimentalResetCredits: true })).resolves.toEqual({
      error: 'OpenAI HTTP 503; body unavailable',
    });
  });

  it('reads alternate API credentials and rejects JWTs without an account claim', () => {
    writeFileSync(
      join(directory, 'auth.json'),
      JSON.stringify({ openrouter: { api_key: ' api-key ' }, openai: { type: 'oauth', access: 'token' } }),
    );
    expect(readAuthProviderApiKey('openrouter')).toBe('api-key');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ subject: 'user' })).toString('base64url');
    expect(readOpenAIAccountId(`${header}.${payload}.signature`)).toBeNull();
  });
});
