import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCopilotQuota } from '../../../../src/features/quota/infrastructure/providers/copilot.ts';

describe('Copilot remaining branches', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agent-monitor-copilot-extra-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', directory);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('derives used and total from nested remaining data and uses a date reset', async () => {
    writeFileSync(
      join(directory, 'auth.json'),
      JSON.stringify({ 'github-copilot': { type: 'oauth', access: 'token' } }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            quota_snapshots: { premium_interactions: { entitlement: 100, remaining: 25 } },
            quota_reset_date: '2099-01-01',
          }),
        ),
      ),
    );
    await expect(fetchCopilotQuota()).resolves.toMatchObject({ total: 100, used: 75, remaining: 25 });
  });

  it('returns null without OAuth auth and rejects invalid negative usage', async () => {
    await expect(fetchCopilotQuota()).resolves.toBeNull();
    writeFileSync(
      join(directory, 'auth.json'),
      JSON.stringify({ 'github-copilot': { type: 'api', key: 'wrong-type' } }),
    );
    await expect(fetchCopilotQuota()).resolves.toBeNull();
    writeFileSync(
      join(directory, 'auth.json'),
      JSON.stringify({ 'github-copilot': { type: 'oauth', access: 'token' } }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ total: 10, used: -1 }))));
    await expect(fetchCopilotQuota()).resolves.toEqual({ error: 'Could not extract Copilot quota data' });
  });
});
