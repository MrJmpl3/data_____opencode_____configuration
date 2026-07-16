import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchCopilotQuota,
  formatCopilotLines,
  normalizeCopilotResetAtMs,
} from '../../../../src/features/quota/infrastructure/providers/copilot.ts';

describe('Copilot provider', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agent-monitor-copilot-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', directory);
    writeFileSync(
      join(directory, 'auth.json'),
      JSON.stringify({ 'github-copilot': { type: 'oauth', access: 'token' } }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('derives totals and used counts from remaining data and normalizes epoch reset values', async () => {
    const resetAt = Math.floor((Date.now() + 3_600_000) / 1000);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ quota: { used: 20, remaining: 80, reset_at: resetAt } }), { status: 200 }),
        ),
    );
    await expect(fetchCopilotQuota()).resolves.toMatchObject({ total: 100, used: 20, remaining: 80, pctRemaining: 80 });
    expect(normalizeCopilotResetAtMs(resetAt)).toBe(resetAt * 1000);
    expect(normalizeCopilotResetAtMs(resetAt * 1000)).toBe(resetAt * 1000);
  });

  it('uses tier fallback, supports unlimited, and rejects malformed or HTTP responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ plan: { type: 'pro' }, used: 2 }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ quota: { unlimited: true } }), { status: 200 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValueOnce(new Response('rate limited', { status: 429 })),
    );
    await expect(fetchCopilotQuota()).resolves.toMatchObject({ total: 300, used: 2, remaining: 298 });
    await expect(fetchCopilotQuota()).resolves.toEqual({ text: 'Unlimited', unlimited: true });
    await expect(fetchCopilotQuota()).resolves.toEqual({ error: 'Could not extract Copilot quota data' });
    await expect(fetchCopilotQuota()).resolves.toMatchObject({ error: 'Copilot API HTTP 429; rate limited' });
  });

  it('formats reset and no-reset branches', () => {
    expect(
      formatCopilotLines(
        { text: '80/100', used: 20, remaining: 80, total: 100, pctRemaining: 80, resetSec: 60 },
        'remaining',
        1_000,
      ),
    ).toHaveLength(2);
    expect(formatCopilotLines({ text: 'Unlimited', unlimited: true }, 'remaining', 1_000)).toEqual([
      { kind: 'detail', text: 'Monthly Unlimited', tone: 'neutral' },
    ]);
  });
});
