import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchDeepSeekQuota,
  formatDeepSeekLines,
} from '../../../../src/features/quota/infrastructure/providers/deepseek.ts';

describe('DeepSeek provider', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agent-monitor-deepseek-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', directory);
    writeFileSync(join(directory, 'auth.json'), JSON.stringify({ deepseek: { type: 'api', key: 'deep-key' } }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('parses valid balances, filters malformed entries, and formats used CNY balances', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            is_available: true,
            balance_infos: [
              { currency: 'cny', total_balance: 8, granted_balance: 10, topped_up_balance: 2 },
              { currency: 'USD', total_balance: 1.5 },
              { total_balance: 3 },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await fetchDeepSeekQuota();
    expect(result).toEqual({
      isAvailable: true,
      balances: [
        { currency: 'CNY', totalBalance: 8, grantedBalance: 10, toppedUpBalance: 2 },
        { currency: 'USD', totalBalance: 1.5, grantedBalance: undefined, toppedUpBalance: undefined },
      ],
    });
    expect(formatDeepSeekLines(result as Exclude<typeof result, null | { error: string }>, 'used')).toEqual([
      { kind: 'heading', text: 'DeepSeek' },
      { kind: 'detail', text: 'CNY Balance ¥4.00/¥8.00', tone: 'neutral' },
      { kind: 'detail', text: 'USD Balance $1.50', tone: 'neutral' },
    ]);
  });

  it('returns null without auth and reports malformed, unavailable, and HTTP responses', async () => {
    rmSync(join(directory, 'auth.json'));
    await expect(fetchDeepSeekQuota()).resolves.toBeNull();
    writeFileSync(join(directory, 'auth.json'), JSON.stringify({ deepseek: { type: 'api', key: 'key' } }));
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ is_available: false, balance_infos: [] }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response('down', { status: 500 })),
    );
    await expect(fetchDeepSeekQuota()).resolves.toEqual({ error: 'DeepSeek did not return expected balance data' });
    await expect(fetchDeepSeekQuota()).resolves.toEqual({ isAvailable: false, balances: [] });
    await expect(fetchDeepSeekQuota()).resolves.toMatchObject({ error: 'DeepSeek HTTP 500; down' });
  });
});
