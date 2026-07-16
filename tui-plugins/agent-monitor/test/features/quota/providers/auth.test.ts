import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readAuthProviderApiKey,
  readOauthAccessToken,
  readOpenAIAccountId,
} from '../../../../src/features/quota/infrastructure/providers/auth.ts';

describe('provider auth readers', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agent-monitor-auth-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', directory);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  const writeAuth = (value: unknown): void => writeFileSync(join(directory, 'auth.json'), JSON.stringify(value));

  it('reads trimmed OAuth and API credentials in supported shapes', () => {
    writeAuth({
      openai: { type: 'oauth', access: ' oauth-token ' },
      openrouter: { type: 'api', key: ' router-key ' },
      deepseek: { api_key: ' deep-key ' },
    });

    expect(readOauthAccessToken('openai')).toBe('oauth-token');
    expect(readAuthProviderApiKey('openrouter')).toBe('router-key');
    expect(readAuthProviderApiKey('deepseek')).toBe('deep-key');
  });

  it('rejects missing, malformed, wrong-type, and blank credentials', () => {
    writeAuth({
      oauth: { type: 'api', access: 'token' },
      blank: { type: 'oauth', access: '   ' },
      malformed: 'token',
    });

    expect(readOauthAccessToken('missing')).toBeNull();
    expect(readOauthAccessToken('oauth')).toBeNull();
    expect(readOauthAccessToken('blank')).toBeNull();
    expect(readAuthProviderApiKey('malformed')).toBeNull();
  });

  it('uses an auth account id before decoding a JWT and decodes a valid fallback JWT', () => {
    const payload = Buffer.from(JSON.stringify({ chatgpt_account_id: ' jwt-account ' })).toString('base64url');
    const token = `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${payload}.signature`;
    writeAuth({ openai: { type: 'oauth', access: token } });
    expect(readOpenAIAccountId(token)).toBe('jwt-account');

    writeAuth({ openai: { type: 'oauth', access: token, account_id: ' auth-account ' } });
    expect(readOpenAIAccountId(token)).toBe('auth-account');
  });

  it('returns null for absent or malformed JWT account claims', () => {
    writeAuth({});
    expect(readOpenAIAccountId('not-a-jwt')).toBeNull();

    const badPayload = Buffer.from(JSON.stringify({ other: 'value' })).toString('base64url');
    const token = `header.${badPayload}.signature`;
    expect(readOpenAIAccountId(token)).toBeNull();
  });
});
