import { ENGRAM_URL } from './config.ts';

export interface EngramFetchOptions {
  method?: string;
  body?: unknown;
}

export async function engramFetch(path: string, opts: EngramFetchOptions = {}): Promise<any> {
  try {
    const response = await fetch(`${ENGRAM_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    return await response.json();
  } catch {
    return null;
  }
}

export async function isEngramRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${ENGRAM_URL}/health`, {
      signal: AbortSignal.timeout(500),
    });

    return response.ok;
  } catch {
    return false;
  }
}
