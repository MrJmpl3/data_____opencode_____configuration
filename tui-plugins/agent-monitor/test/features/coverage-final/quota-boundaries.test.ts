import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readAuthProviderApiKey,
  readOauthAccessToken,
  readOpenAIAccountId,
} from '../../../src/features/quota/infrastructure/providers/auth.ts';
import { readQuotaConfig } from '../../../src/features/quota/infrastructure/providers/config.ts';
import { fetchOpenRouterQuota } from '../../../src/features/quota/infrastructure/providers/openrouter.ts';
import { fetchProviderLines } from '../../../src/features/quota/ui/components/quota-section.tsx';

describe('quota boundary branches', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agent-monitor-coverage-final-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', directory);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('rejects malformed auth entries and reads fallback token fields', () => {
    writeFileSync(
      join(directory, 'auth.json'),
      JSON.stringify({
        openai: { type: 'oauth', access: '  access  ' },
        deepseek: { apiKey: '  fallback  ' },
        openrouter: { type: 'api', key: '  primary  ' },
        invalid: 'value',
      }),
    );
    expect(readOauthAccessToken('openai')).toBe('access');
    expect(readAuthProviderApiKey('deepseek')).toBe('fallback');
    expect(readAuthProviderApiKey('openrouter')).toBe('primary');
    expect(readOauthAccessToken('invalid')).toBeNull();
    expect(readAuthProviderApiKey('missing')).toBeNull();
    expect(readOpenAIAccountId('not.a.jwt')).toBeNull();
  });

  it('reads nested provider configuration and ignores invalid workspace entries', () => {
    writeFileSync(
      join(directory, 'agent-monitor.json'),
      JSON.stringify({
        sections: {
          quota: {
            providers: {
              'opencode-go': {
                authCookie: ' cookie ',
                workspaces: [[{ workspaceId: ' ws ', label: ' Workspace ' }], { workspaceId: '', label: 'bad' }],
              },
              'ollama-cloud': { authCookie: ' ollama ' },
            },
            options: {
              displayMode: 'unexpected',
              visibleProviders: ['openai', 3],
              pollIntervalMs: 0,
              experimentalOpenAIResetCredits: true,
            },
          },
        },
      }),
    );
    expect(readQuotaConfig()).toEqual({
      providers: {
        'opencode-go': { authCookie: 'cookie', workspaces: [{ workspaceId: 'ws', label: 'Workspace' }] },
        'ollama-cloud': { authCookie: 'ollama' },
      },
      options: {
        displayMode: 'remaining',
        visibleProviders: ['openai'],
        pollIntervalMs: 0,
        experimentalOpenAIResetCredits: true,
      },
    });
  });

  it('handles OpenRouter nested, unlimited, and invalid payloads', async () => {
    writeFileSync(join(directory, 'auth.json'), JSON.stringify({ openrouter: { type: 'api', key: 'key' } }));
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 3 } }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ total_usage: 1.23456 }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 200 })),
    );
    await expect(fetchOpenRouterQuota()).resolves.toMatchObject({ remaining: 7, usage: 3, total: 10 });
    await expect(fetchOpenRouterQuota()).resolves.toMatchObject({ usage: 1.23456, text: '$1.2346 used (no limit)' });
    await expect(fetchOpenRouterQuota()).resolves.toEqual({ error: 'OpenRouter did not return expected credit data' });
  });

  it('returns empty opencode-go lines and no-auth provider results', async () => {
    const setNowMs = vi.fn();
    await expect(
      fetchProviderLines({
        providerId: 'opencode-go',
        opencodeGoConfig: { authCookie: '', workspaces: [] },
        displayMode: 'remaining',
        setNowMs,
      }),
    ).resolves.toEqual([]);
    await expect(
      fetchProviderLines({
        providerId: 'openrouter',
        opencodeGoConfig: { authCookie: '', workspaces: [] },
        displayMode: 'remaining',
        setNowMs,
      }),
    ).resolves.toBeUndefined();
  });
});
