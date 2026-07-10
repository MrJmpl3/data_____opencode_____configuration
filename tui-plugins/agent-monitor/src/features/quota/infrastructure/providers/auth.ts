import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { isRecord } from '../../../../kit/coercion.ts';

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
  } catch (e) {
    console.warn('[agent-monitor] Failed to read auth.json:', e instanceof Error ? e.message : String(e));
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
  if (entry.type === 'api') {
    const value = entry.key;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
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

export const readOpenAIAccountId = (token: string): string | null => {
  const fromAuth = readOauthAccountId(['openai', 'chatgpt', 'codex']);
  if (fromAuth) return fromAuth;
  try {
    // JWT signature verification skipped because the token comes from
    // the user's local auth.json (trusted file). Only the chatgpt_account_id
    // claim is read — no authorization decisions are made from this payload.
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8')) as unknown;
    if (!isRecord(payload)) return null;
    const jwtAccountId = payload.chatgpt_account_id;
    if (typeof jwtAccountId === 'string' && jwtAccountId.trim()) return jwtAccountId.trim();
  } catch {
    return null;
  }
  return null;
};
