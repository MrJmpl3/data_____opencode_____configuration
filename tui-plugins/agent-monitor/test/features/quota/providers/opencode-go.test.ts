import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchOpencodeGoDashboard,
  formatOpencodeGoWorkspaceHeading,
  formatOpencodeGoWorkspaceLines,
  readOpencodeGoConfig,
} from '../../../../src/features/quota/infrastructure/providers/opencode-go.ts';

describe('OpenCode Go provider', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agent-monitor-go-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', directory);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads valid config and normalizes workspace headings', () => {
    writeFileSync(
      join(directory, 'agent-monitor.json'),
      JSON.stringify({
        sections: {
          quota: {
            providers: {
              'opencode-go': {
                authCookie: ' cookie ',
                workspaces: [
                  { workspaceId: 'id', label: 'OpenCode Go · Team' },
                  [{ workspaceId: 'x', label: 'Other' }],
                ],
              },
            },
          },
        },
      }),
    );
    expect(readOpencodeGoConfig()).toEqual({
      authCookie: 'cookie',
      workspaces: [
        { workspaceId: 'id', label: 'OpenCode Go · Team' },
        { workspaceId: 'x', label: 'Other' },
      ],
    });
    expect(formatOpencodeGoWorkspaceHeading('OpenCode Go')).toBe('OpenCode Go');
    expect(formatOpencodeGoWorkspaceHeading('OpenCode Go · Team')).toBe('OpenCode Go (Team)');
    expect(formatOpencodeGoWorkspaceHeading('OpenCode Go (Team)')).toBe('OpenCode Go (Team)');
    expect(formatOpencodeGoWorkspaceHeading('Other')).toBe('OpenCode Go (Other)');
  });

  it('parses windows in both field orders and clamps negative values', async () => {
    const html =
      'rollingUsage:$R[0]={usagePercent:25 resetInSec:60} weeklyUsage:$R[1]={resetInSec:-2 usagePercent:105}';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, { status: 200 })));
    await expect(fetchOpencodeGoDashboard('team id', 'cookie')).resolves.toEqual({
      data: {
        rolling: { used: 25, remaining: 75, resetInSec: 60 },
        weekly: { used: 105, remaining: 0, resetInSec: 0 },
        monthly: null,
      },
    });
  });

  it('reports HTTP, empty dashboard, and missing config errors', async () => {
    expect(readOpencodeGoConfig()).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
        .mockResolvedValueOnce(new Response('<html>empty</html>', { status: 200 })),
    );
    await expect(fetchOpencodeGoDashboard('id', 'cookie')).resolves.toMatchObject({
      error: 'OpenCode Go HTTP 502; bad gateway',
    });
    await expect(fetchOpencodeGoDashboard('id', 'cookie')).resolves.toEqual({
      error: 'No quota data found in OpenCode Go dashboard',
    });
  });

  it('formats workspace headings and the no-windows fallback', () => {
    expect(
      formatOpencodeGoWorkspaceLines(
        { workspaceId: 'id', label: 'Other' },
        { rolling: null, weekly: null, monthly: null },
        'remaining',
        0,
      ),
    ).toEqual([
      { kind: 'heading', text: 'OpenCode Go (Other)' },
      { kind: 'detail', text: 'No windows', tone: 'neutral' },
    ]);
  });
});
