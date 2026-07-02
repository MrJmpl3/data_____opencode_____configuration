import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { isRecord } from './shared.ts';

const authJsonPath = (): string => {
  const configDir = process.env.OPENCODE_CONFIG_DIR;
  if (configDir) return join(configDir, 'auth.json');
  return join(homedir(), '.local', 'share', 'opencode', 'auth.json');
};

const readAuthJson = (): Record<string, unknown> | null => {
  const path = authJsonPath();
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const readOauthAccessToken = (key: string): string | null => {
  const auth = readAuthJson();
  if (!auth) return null;
  const entry = auth[key];
  if (!isRecord(entry)) return null;
  if (entry.type !== 'oauth') return null;
  const access = entry.access;
  if (typeof access === 'string' && access.trim()) return access.trim();
  return null;
};

export const readAuthProviderApiKey = (key: string): string | null => {
  const auth = readAuthJson();
  if (!auth) return null;
  const entry = auth[key];
  if (!isRecord(entry)) return null;
  // api entries store the value in the "key" field
  if (entry.type === 'api') {
    const value = entry.key;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  // fallback: look for the value in any field named apiKey, api_key, token, access
  for (const field of ['apiKey', 'api_key', 'token', 'access'] as const) {
    const value = entry[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

const readOauthAccountId = (keys: readonly string[]): string | null => {
  const auth = readAuthJson();
  if (!auth) return null;
  for (const key of keys) {
    const entry = auth[key];
    if (!isRecord(entry)) continue;
    if (entry.type !== 'oauth') continue;
    const accountId = entry.account_id ?? entry.accountId;
    if (typeof accountId === 'string' && accountId.trim()) return accountId.trim();
  }
  return null;
};

const parseJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const parsed: unknown = JSON.parse(payload);

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const readOpenAIAccountId = (token: string): string | null => {
  const fromAuth = readOauthAccountId(['openai', 'chatgpt', 'codex']);
  if (fromAuth) return fromAuth;
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  const jwtAccountId = payload.chatgpt_account_id;
  if (typeof jwtAccountId === 'string' && jwtAccountId.trim()) {
    return jwtAccountId.trim();
  }
  return null;
};
