import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detailTextLine, headingLine, paceLine, windowLine } from '../src/domain/lines.ts';
import { fetchProviderLines } from '../src/domain/provider-results.ts';
import { readGoConfig } from '../src/infrastructure/providers/go.ts';

vi.mock('../src/infrastructure/providers/go.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/infrastructure/providers/go.ts')>(
    '../src/infrastructure/providers/go.ts',
  );

  return {
    ...actual,
    fetchGoDashboard: vi.fn(async (workspaceId: string) => {
      if (workspaceId === 'wrk-team-a') {
        return {
          data: {
            rolling: { used: 10, remaining: 90, resetInSec: 300 },
            weekly: { used: 20, remaining: 80, resetInSec: 600 },
            monthly: { used: 30, remaining: 70, resetInSec: 900 },
          },
        };
      }

      return { error: 'Workspace unavailable' };
    }),
  };
});

const createWorkspaceFile = (workspaces: readonly { workspaceId: string; label: string }[]): string => {
  const root = mkdtempSync(join(tmpdir(), 'opencode-go-workspaces-'));
  const filePath = join(root, 'workspaces.json');
  writeFileSync(filePath, JSON.stringify(workspaces), 'utf8');
  return filePath;
};

describe('OpenCode Go workspace configuration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('prefers file-based workspaces over JSON env and legacy fallback', () => {
    const workspaceFile = createWorkspaceFile([{ workspaceId: 'wrk-file-a', label: 'File A' }]);

    vi.stubEnv('OPENCODE_GO_AUTH_COOKIE', 'file-cookie');
    vi.stubEnv('OPENCODE_GO_WORKSPACES_FILE', workspaceFile);
    vi.stubEnv('OPENCODE_GO_WORKSPACES', JSON.stringify([{ workspaceId: 'wrk-env-a', label: 'Env A' }]));
    vi.stubEnv('OPENCODE_GO_WORKSPACE_ID', 'legacy-workspace');

    expect(readGoConfig()).toEqual({
      authCookie: 'file-cookie',
      workspaces: [{ workspaceId: 'wrk-file-a', label: 'File A' }],
    });
  });

  it('falls back to JSON env when the file source is absent', () => {
    delete process.env.OPENCODE_GO_WORKSPACES_FILE;

    vi.stubEnv('OPENCODE_GO_AUTH_COOKIE', 'env-cookie');
    vi.stubEnv(
      'OPENCODE_GO_WORKSPACES',
      JSON.stringify([
        { workspaceId: 'wrk-env-a', label: 'Env A' },
        { workspaceId: ' ', label: 'Ignored' },
      ]),
    );
    vi.stubEnv('OPENCODE_GO_WORKSPACE_ID', 'legacy-workspace');

    expect(readGoConfig()).toEqual({
      authCookie: 'env-cookie',
      workspaces: [{ workspaceId: 'wrk-env-a', label: 'Env A' }],
    });
  });

  it('suppresses legacy fallback when the workspace file is invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'opencode-go-workspaces-'));
    const workspaceFile = join(root, 'workspaces.json');
    writeFileSync(workspaceFile, '{ invalid json', 'utf8');

    vi.stubEnv('OPENCODE_GO_AUTH_COOKIE', 'file-cookie');
    vi.stubEnv('OPENCODE_GO_WORKSPACES_FILE', workspaceFile);
    vi.stubEnv('OPENCODE_GO_WORKSPACE_ID', 'legacy-workspace');

    expect(readGoConfig()).toBeNull();
  });

  it('suppresses legacy fallback when the JSON env source is empty', () => {
    delete process.env.OPENCODE_GO_WORKSPACES_FILE;

    vi.stubEnv('OPENCODE_GO_AUTH_COOKIE', 'env-cookie');
    vi.stubEnv('OPENCODE_GO_WORKSPACES', '[]');
    vi.stubEnv('OPENCODE_GO_WORKSPACE_ID', 'legacy-workspace');

    expect(readGoConfig()).toBeNull();
  });

  it('returns one OpenCode Go block per configured workspace', async () => {
    const setNowMs = vi.fn();

    const lines = await fetchProviderLines({
      providerId: 'opencode-go',
      goConfig: {
        authCookie: 'cookie',
        workspaces: [
          { workspaceId: 'wrk-team-a', label: 'Work 1' },
          { workspaceId: 'wrk-team-b', label: 'Work 2' },
        ],
      },
      displayMode: 'used',
      setNowMs,
    });

    expect(setNowMs).toHaveBeenCalledWith(1_700_000_000_000);
    expect(lines).toEqual([
      headingLine('OpenCode Go (Work 1)'),
      windowLine('5h', '10%', 300, 1_700_000_000_000, 'neutral', 10),
      windowLine('Wk', '20%', 600, 1_700_000_000_000, 'neutral', 20),
      windowLine('Mo', '30%', 900, 1_700_000_000_000, 'neutral', 30),
      paceLine({ usedPct: 30, resetSec: 900 }, 30 * 24 * 60 * 60, 1_700_000_000_000),
      headingLine('OpenCode Go (Work 2)'),
      detailTextLine('Workspace unavailable', 'error'),
    ]);
  });
});
