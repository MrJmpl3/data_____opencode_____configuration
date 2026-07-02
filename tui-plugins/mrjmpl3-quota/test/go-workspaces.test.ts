import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
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

const writeQuotaConfig = (quota: Record<string, unknown>): string => {
  const root = mkdtempSync(join(tmpdir(), 'opencode-go-'));
  const configDir = join(root, '.config', 'opencode');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'quota.json'), JSON.stringify(quota), 'utf8');
  return configDir;
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

  it('reads authCookie and workspaces from providers.opencode-go', () => {
    vi.stubEnv(
      'OPENCODE_CONFIG_DIR',
      writeQuotaConfig({
        providers: {
          'opencode-go': {
            authCookie: 'go-cookie',
            workspaces: [{ workspaceId: 'wrk-a', label: 'Workspace A' }],
          },
        },
      }),
    );

    expect(readGoConfig()).toEqual({
      authCookie: 'go-cookie',
      workspaces: [{ workspaceId: 'wrk-a', label: 'Workspace A' }],
    });
  });

  it('returns null when providers.opencode-go is missing', () => {
    vi.stubEnv(
      'OPENCODE_CONFIG_DIR',
      writeQuotaConfig({
        options: { displayMode: 'used' },
      }),
    );

    expect(readGoConfig()).toBeNull();
  });

  it('returns null when providers is missing', () => {
    vi.stubEnv('OPENCODE_CONFIG_DIR', writeQuotaConfig({ displayMode: 'used' }));

    expect(readGoConfig()).toBeNull();
  });

  it('returns null when quota.json is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'opencode-go-'));
    vi.stubEnv('OPENCODE_CONFIG_DIR', root);

    expect(readGoConfig()).toBeNull();
  });

  it('returns null when opencode-go has no authCookie', () => {
    vi.stubEnv(
      'OPENCODE_CONFIG_DIR',
      writeQuotaConfig({
        providers: {
          'opencode-go': {
            workspaces: [{ workspaceId: 'wrk-a', label: 'Workspace A' }],
          },
        },
      }),
    );

    expect(readGoConfig()).toBeNull();
  });

  it('returns null when opencode-go has no workspaces', () => {
    vi.stubEnv(
      'OPENCODE_CONFIG_DIR',
      writeQuotaConfig({
        providers: {
          'opencode-go': {
            authCookie: 'go-cookie',
            workspaces: [],
          },
        },
      }),
    );

    expect(readGoConfig()).toBeNull();
  });

  it('filters out invalid workspace entries', () => {
    vi.stubEnv(
      'OPENCODE_CONFIG_DIR',
      writeQuotaConfig({
        providers: {
          'opencode-go': {
            authCookie: 'go-cookie',
            workspaces: [
              { workspaceId: 'wrk-a', label: 'Workspace A' },
              { workspaceId: '', label: 'Empty ID' },
              { workspaceId: 'wrk-b', label: '' },
              { workspaceId: ' ', label: 'Whitespace' },
              { notId: 'x', notLabel: 'y' },
            ],
          },
        },
      }),
    );

    expect(readGoConfig()).toEqual({
      authCookie: 'go-cookie',
      workspaces: [{ workspaceId: 'wrk-a', label: 'Workspace A' }],
    });
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
