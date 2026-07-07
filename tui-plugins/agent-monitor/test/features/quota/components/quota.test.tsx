import { vi, describe, expect, it, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures these are initialized before vi.mock hoisting
// ---------------------------------------------------------------------------

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

const mockFetchProviderLines = vi.hoisted(() => vi.fn());
vi.mock(import('../../../../src/features/quota/ui/components/quota-section.tsx'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchProviderLines: mockFetchProviderLines,
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { collectProviderLines } from '../../../../src/features/quota/ui/components/quota-section.tsx';
import {
  defaultQuotaSectionOptions,
  resolveVisibleProviderIdsWithDiagnostics,
  type QuotaSectionOptions,
} from '../../../../src/features/quota/domain/options.ts';
import { renderQuotaLine } from '../../../../src/features/quota/domain/format.ts';
import { readOpencodeGoConfig } from '../../../../src/features/quota/infrastructure/providers/opencode-go.ts';
import { readQuotaConfig } from '../../../../src/features/quota/infrastructure/providers/config.ts';
import { formatDeepSeekLines } from '../../../../src/features/quota/infrastructure/providers/deepseek.ts';

// ---------------------------------------------------------------------------
// B1: collectProviderLines triggers a fetch for each visible provider
// ---------------------------------------------------------------------------

describe('collectProviderLines (B1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls fetchProviderLines for each visible provider', async () => {
    mockFetchProviderLines.mockResolvedValue([]);

    const result = await collectProviderLines(
      null,
      ['github-copilot', 'openrouter'] as any,
      'remaining',
      vi.fn(),
      // ponytail: pass the mock as the fetcher so the default-fetcher closure
      // (which captures the unmocked module-scope `fetchProviderLines`) is
      // bypassed. The mock lives at the import boundary, not inside the
      // module's internal references.
      (providerId, ctx) => mockFetchProviderLines({ providerId, ...ctx }),
    );

    expect(mockFetchProviderLines).toHaveBeenCalledTimes(2);
    expect(mockFetchProviderLines).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'github-copilot' }));
    expect(mockFetchProviderLines).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'openrouter' }));
    expect(result).toEqual([]);
  });

  it('passes opencodeGoConfig to fetchProviderLines', async () => {
    mockFetchProviderLines.mockResolvedValue([]);
    const opencodeGoConfig = { authCookie: 'test-cookie', workspaces: [{ workspaceId: 'ws-1', label: 'Test' }] };

    await collectProviderLines(opencodeGoConfig, ['github-copilot'] as any, 'remaining', vi.fn(), (providerId, ctx) =>
      mockFetchProviderLines({ providerId, ...ctx }),
    );

    expect(mockFetchProviderLines).toHaveBeenCalledWith(expect.objectContaining({ opencodeGoConfig }));
  });
});

// ---------------------------------------------------------------------------
// B2: readOpencodeGoConfig reads from disk
// ---------------------------------------------------------------------------

describe('readOpencodeGoConfig (B2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when agent-monitor.json has no opencode-go provider', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ sections: { quota: { providers: {} } } }));

    expect(readOpencodeGoConfig()).toBeNull();
  });

  it('returns parsed opencode-go config when agent-monitor.json has valid nested data', () => {
    const mockData = {
      sections: {
        quota: {
          providers: {
            'opencode-go': {
              authCookie: 'abc123',
              workspaces: [{ workspaceId: 'ws-1', label: 'My Workspace' }],
            },
          },
        },
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(mockData));

    const config = readOpencodeGoConfig();
    expect(config).not.toBeNull();
    expect(config!.authCookie).toBe('abc123');
    expect(config!.workspaces).toHaveLength(1);
    expect(config!.workspaces[0].workspaceId).toBe('ws-1');
  });

  it('flattens a one-level-nested workspaces array into a flat list', () => {
    const mockData = {
      sections: {
        quota: {
          providers: {
            'opencode-go': {
              authCookie: 'abc123',
              workspaces: [[{ workspaceId: 'ws-1', label: 'Work 1' }], [{ workspaceId: 'ws-2', label: 'Work 2' }]],
            },
          },
        },
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(mockData));

    const config = readOpencodeGoConfig();
    expect(config).not.toBeNull();
    expect(config!.workspaces).toHaveLength(2);
    expect(config!.workspaces.map((w) => w.workspaceId)).toEqual(['ws-1', 'ws-2']);
  });

  it('reads the options sub-record under sections.quota.options', () => {
    const mockData = {
      sections: {
        quota: {
          options: {
            displayMode: 'used',
            pollIntervalMs: 600000,
            visibleProviders: ['opencode-go', 'deepseek', 'openai'],
          },
        },
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(mockData));

    const config = readQuotaConfig();
    expect(config).not.toBeNull();
    expect(config!.options?.displayMode).toBe('used');
    expect(config!.options?.pollIntervalMs).toBe(600000);
    expect(config!.options?.visibleProviders).toEqual(['opencode-go', 'deepseek', 'openai']);
  });

  it('returns null when agent-monitor.json does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(readOpencodeGoConfig()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B3: error strings are wrapped as detail error lines
// ---------------------------------------------------------------------------

describe('collectProviderLines error handling (B3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps string error results as detail error lines', async () => {
    mockFetchProviderLines.mockResolvedValue('Rate limit exceeded');

    const result = await collectProviderLines(
      null,
      ['github-copilot'] as any,
      'remaining',
      vi.fn(),
      (providerId, ctx) => mockFetchProviderLines({ providerId, ...ctx }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ kind: 'detail', text: 'Rate limit exceeded', tone: 'error' });
  });

  it('combines array results and error strings from multiple providers', async () => {
    mockFetchProviderLines
      .mockResolvedValueOnce([{ kind: 'detail', text: 'OK', tone: 'neutral' }])
      .mockResolvedValueOnce('Provider failed');

    const result = await collectProviderLines(
      null,
      ['github-copilot', 'openrouter'] as any,
      'remaining',
      vi.fn(),
      (providerId, ctx) => mockFetchProviderLines({ providerId, ...ctx }),
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ kind: 'detail', text: 'OK', tone: 'neutral' });
    expect(result[1]).toEqual({ kind: 'detail', text: 'Provider failed', tone: 'error' });
  });
});

// ---------------------------------------------------------------------------
// usePolling is exercised in test/shared/tui-kit.test.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// resolveVisibleProviderIdsWithDiagnostics: invalid entries surface for the
// runtime warning, not silently dropped.
// ---------------------------------------------------------------------------

describe('resolveVisibleProviderIdsWithDiagnostics', () => {
  it('returns defaults without invalid entries when nothing is configured', () => {
    expect(resolveVisibleProviderIdsWithDiagnostics(undefined)).toEqual({
      visibleProviders: ['opencode-go', 'github-copilot', 'openrouter'],
      invalidVisibleProviderEntries: [],
      fellBackToDefaultVisibleProviders: false,
    });
  });

  it('surfaces non-string and unknown-id entries as invalid', () => {
    // @ts-expect-error — testing runtime path with a non-string entry
    const result = resolveVisibleProviderIdsWithDiagnostics(['openai', 42, 'unknown', null]);
    expect(result.visibleProviders).toEqual(['openai']);
    expect(result.invalidVisibleProviderEntries).toEqual(['42', '"unknown"', 'null']);
    expect(result.fellBackToDefaultVisibleProviders).toBe(false);
  });

  it('falls back to defaults and reports the fallback when every entry is invalid', () => {
    const result = resolveVisibleProviderIdsWithDiagnostics(['nope', 'still-no']);
    expect(result.visibleProviders).toEqual(['opencode-go', 'github-copilot', 'openrouter']);
    expect(result.invalidVisibleProviderEntries).toEqual(['"nope"', '"still-no"']);
    expect(result.fellBackToDefaultVisibleProviders).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderQuotaLine: behavior parity with the dropped re-export
// ---------------------------------------------------------------------------

describe('renderQuotaLine', () => {
  it('prefixes heading lines with a bullet marker', () => {
    expect(renderQuotaLine({ kind: 'heading', text: 'OpenAI' }, Date.now() + 1)).toBe('● OpenAI');
  });

  it('renders detail lines with a two-space indent', () => {
    expect(renderQuotaLine({ kind: 'detail', text: 'No windows' }, Date.now() + 1)).toBe('  No windows');
  });

  it('renders window and pace lines from the domain layer', () => {
    const nowMs = Date.now();
    const windowLine = {
      kind: 'window' as const,
      label: 'Wk',
      value: '70%',
      resetAtMs: nowMs + 300_000,
      usedPct: 30,
    };
    expect(renderQuotaLine(windowLine, nowMs)).toMatch(/^  Wk 70% · /);

    // 5% used in 100s window with 50s remaining → 50s elapsed, 50% responsible → under.
    const paceLine = {
      kind: 'pace' as const,
      usedPct: 5,
      resetAtMs: nowMs + 50_000,
      windowSeconds: 100,
    };
    expect(renderQuotaLine(paceLine, nowMs)).toMatch(/^    ✓ /);
  });
});

// ---------------------------------------------------------------------------
// DeepSeek heading: formatDeepSeekLines emits a leading heading line
// ---------------------------------------------------------------------------

describe('formatDeepSeekLines heading', () => {
  it('prepends a heading line when given valid balance data', () => {
    const result = formatDeepSeekLines(
      { isAvailable: true, balances: [{ currency: 'USD', totalBalance: 12.34 }] },
      'remaining',
    );
    expect(result[0]).toEqual({ kind: 'heading', text: 'DeepSeek' });
  });
});
