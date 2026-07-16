import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatOpencodeGoWorkspaceLines,
  fetchOpencodeGoDashboard,
} from '../../../../src/features/quota/infrastructure/providers/opencode-go.ts';

describe('OpenCode Go remaining branches', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('formats every available window in used mode with pace lines', () => {
    const lines = formatOpencodeGoWorkspaceLines(
      { workspaceId: 'id', label: 'OpenCode Go · Team' },
      {
        rolling: { used: 10, remaining: 90, resetInSec: 100 },
        weekly: { used: 20, remaining: 80, resetInSec: 200 },
        monthly: { used: 30, remaining: 70, resetInSec: 300 },
      },
      'used',
      1_000,
    );
    expect(lines).toHaveLength(7);
    expect(lines[0]).toEqual({ kind: 'heading', text: 'OpenCode Go (Team)' });
    expect(lines[1]).toMatchObject({ kind: 'window', label: '5h', value: '10%' });
  });

  it('returns the first usable dashboard window when other windows are absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('monthlyUsage:$R[0]={usagePercent:12.5 resetInSec:60}', { status: 200 })),
    );
    await expect(fetchOpencodeGoDashboard('id', 'cookie')).resolves.toEqual({
      data: { rolling: null, weekly: null, monthly: { used: 12.5, remaining: 87.5, resetInSec: 60 } },
    });
  });
});
