import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatResetCreditsLines } from '../../../src/features/quota/domain/format.ts';
import { formatCreditQuota } from '../../../src/features/quota/domain/lines.ts';
import { fetchCopilotQuota } from '../../../src/features/quota/infrastructure/providers/copilot.ts';
import { fetchDeepSeekQuota } from '../../../src/features/quota/infrastructure/providers/deepseek.ts';
import { fetchOpenRouterQuota } from '../../../src/features/quota/infrastructure/providers/openrouter.ts';
import { QuotaView } from '../../../src/features/quota/ui/components/quota-view.tsx';
import { registerSidebarTui } from '../../../src/features/quota/runtime.tsx';
import { renderMemory, memoryText, type MemoryNode } from '../../support/opentui-memory-renderer.ts';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

describe('meaningful missed quota branches', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'agent-monitor-coverage-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', configDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(configDir, { recursive: true, force: true });
  });

  it('falls back to default visible providers when every configured id is invalid', async () => {
    writeFileSync(
      join(configDir, 'agent-monitor.json'),
      JSON.stringify({ sections: { quota: { options: { visibleProviders: ['unknown'] } } } }),
    );
    const register = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await (registerSidebarTui as unknown as (api: TuiPluginApi) => Promise<void>)({
      slots: { register },
    } as unknown as TuiPluginApi);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Falling back to defaults'));
  });

  it('preserves credit text when remaining mode has no usable usage fallback', () => {
    expect(formatCreditQuota({ text: 'credits unavailable', total: 10 }, 'remaining')).toBe('credits unavailable');
  });

  it('handles reset metadata with no matching credit and invalid grant date', () => {
    expect(
      formatResetCreditsLines({
        state: 'available',
        availableCount: 1,
        credits: [],
        nextExpiresAtMs: Date.parse('2026-08-01'),
      }),
    ).toHaveLength(1);
    expect(
      formatResetCreditsLines({
        state: 'available',
        availableCount: 2,
        credits: [{ expiresAtIso: '2026-08-01', grantedAtIso: 'not-a-date' }],
        nextExpiresAtMs: Date.parse('2026-08-01'),
      }),
    ).toHaveLength(1);
  });

  it('renders a pace warning when a window is projected over its limit', () => {
    const { root, dispose } = renderMemory(
      () =>
        QuotaView({
          lines: [{ kind: 'pace', usedPct: 100, resetAtMs: 61_000, windowSeconds: 100 }],
          nowMs: 1_000,
          loading: false,
          api: {} as TuiPluginApi,
        }) as unknown as MemoryNode,
    );
    expect(memoryText(root)).toContain('⚠');
    dispose();
  });

  it('uses zero usage when OpenRouter omits total usage', async () => {
    writeFileSync(join(configDir, 'auth.json'), JSON.stringify({ openrouter: { type: 'api', key: 'key' } }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ total_credits: 10 }), { status: 200 })),
    );

    await expect(fetchOpenRouterQuota()).resolves.toMatchObject({ remaining: 10, usage: 0 });
  });

  it('returns a structured error when OpenRouter JSON is malformed', async () => {
    writeFileSync(join(configDir, 'auth.json'), JSON.stringify({ openrouter: { type: 'api', key: 'key' } }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{', { status: 200 })));

    await expect(fetchOpenRouterQuota()).resolves.toMatchObject({ error: expect.stringContaining('OpenRouter') });
  });

  it('returns provider errors for malformed DeepSeek and Copilot responses', async () => {
    writeFileSync(
      join(configDir, 'auth.json'),
      JSON.stringify({
        deepseek: { type: 'api', key: 'deep-key' },
        'github-copilot': { type: 'oauth', access: 'token' },
      }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{', { status: 200 })));

    await expect(fetchDeepSeekQuota()).resolves.toMatchObject({ error: expect.stringContaining('DeepSeek') });
    await expect(fetchCopilotQuota()).resolves.toMatchObject({ error: expect.stringContaining('Copilot') });
  });
});
