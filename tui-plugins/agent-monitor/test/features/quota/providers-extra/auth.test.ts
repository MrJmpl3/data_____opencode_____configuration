import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readAuthProviderApiKey,
  readOauthAccessToken,
  readOpenAIAccountId,
} from '../../../../src/features/quota/infrastructure/providers/auth.ts';

describe('provider auth remaining branches', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agent-monitor-auth-extra-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', directory);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads API credential fallback fields and OAuth accountId aliases', () => {
    writeFileSync(
      join(directory, 'auth.json'),
      JSON.stringify({
        apiKey: { apiKey: ' first ' },
        token: { token: ' second ' },
        codex: { type: 'oauth', accountId: ' account ' },
      }),
    );
    expect(readAuthProviderApiKey('apiKey')).toBe('first');
    expect(readAuthProviderApiKey('token')).toBe('second');
    expect(readOpenAIAccountId('not-a-jwt')).toBe('account');
    expect(readOauthAccessToken('codex')).toBeNull();
  });

  it('handles malformed auth JSON and malformed JWT payloads safely', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    writeFileSync(join(directory, 'auth.json'), '{bad');
    expect(readOauthAccessToken('openai')).toBeNull();
    expect(readAuthProviderApiKey('openrouter')).toBeNull();
    expect(readOpenAIAccountId('header.%%% .signature')).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
