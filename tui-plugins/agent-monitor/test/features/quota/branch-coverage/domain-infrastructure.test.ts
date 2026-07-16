import { describe, expect, it, vi } from 'vitest';

import {
  formatPaceLineText,
  formatOpenAIAdditionalRateLimitLabel,
  formatOpenAILines,
} from '../../../../src/features/quota/domain/format.ts';
import { formatCountQuota, formatCreditQuota, quotaColor } from '../../../../src/features/quota/domain/lines.ts';
import {
  resolveNumericOptions,
  resolveVisibleProviderIdsWithDiagnostics,
} from '../../../../src/features/quota/domain/options.ts';
import {
  retryAfterMsFromMessage,
  isQuotaRateLimitError,
} from '../../../../src/features/quota/infrastructure/retry-policy.ts';
import {
  fetchWithTimeout,
  httpErrorMessage,
  readJsonResponse,
} from '../../../../src/features/quota/infrastructure/providers/http.ts';
import {
  collectProviderLines,
  fetchProviderLines,
} from '../../../../src/features/quota/ui/components/quota-section.tsx';

describe('quota domain and infrastructure branches', () => {
  it('covers pace recovery, compact labels, all OpenAI window labels, and reset lines', () => {
    expect(formatPaceLineText({ usedPct: 90, resetSec: 90 }, 100)).toEqual({
      paceText: expect.stringContaining('over'),
      recoverySeconds: 80,
    });
    expect(formatPaceLineText({ usedPct: -5, resetSec: 100 }, 100).paceText).toContain('under');
    expect(formatOpenAIAdditionalRateLimitLabel({ label: '  very long label here  ', limitReached: true }, '2nd')).toBe(
      'limit reached · very long l… 2nd',
    );
    expect(formatOpenAIAdditionalRateLimitLabel({ label: '   ' })).toBe('Additional limit');
    const lines = formatOpenAILines(
      {
        hourly: { usedPct: 10, resetSec: 1, limitWindowSec: 24 * 3600 },
        weekly: { usedPct: 20, resetSec: 1, limitWindowSec: 30 * 24 * 3600 },
        additionalRateLimits: [{ label: 'blocked', allowed: false, primary: { usedPct: 90, resetSec: 1 } }],
        resetCredits: { state: 'available', availableCount: 1, credits: [], nextExpiresAtMs: 1 },
      },
      'used',
      0,
    );
    expect(lines.map((line) => line.kind)).toContain('window');
    expect(
      formatOpenAILines({ resetCredits: { state: 'none-available', availableCount: 0, credits: [] } }, 'used', 0),
    ).toEqual([
      { kind: 'heading', text: 'OpenAI' },
      { kind: 'detail', text: 'Reset · none', tone: 'neutral' },
    ]);
  });

  it('uses fallback count and credit calculations and every quota color boundary', () => {
    expect(formatCountQuota({ text: 'fallback', total: 10, remaining: 3 }, 'used')).toBe('7 pts');
    expect(formatCountQuota({ text: 'fallback', total: 10, used: 3 }, 'remaining')).toBe('7 pts');
    expect(formatCreditQuota({ text: 'fallback', total: 10, remaining: 3 }, 'used')).toBe('$7.00/$10.00');
    expect(formatCreditQuota({ text: 'fallback', total: 0 }, 'used')).toBe('fallback');
    expect([
      quotaColor(50, undefined),
      quotaColor(80, undefined),
      quotaColor(90, undefined),
      quotaColor(100, undefined),
    ]).toEqual(['green', 'yellow', 'orange', 'red']);
    expect([
      quotaColor(undefined, 'success'),
      quotaColor(undefined, 'warning'),
      quotaColor(undefined, 'error'),
      quotaColor(undefined, 'neutral'),
    ]).toEqual(['green', 'yellow', 'red', 'gray']);
  });

  it('resolves duplicate providers, circular invalid entries, and unsafe numeric values', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(resolveVisibleProviderIdsWithDiagnostics(['openai', 'openai', circular as never])).toMatchObject({
      visibleProviders: ['openai'],
      invalidVisibleProviderEntries: ['[object Object]'],
    });
    expect(resolveVisibleProviderIdsWithDiagnostics([]).fellBackToDefaultVisibleProviders).toBe(false);
    expect(
      resolveNumericOptions({
        pollIntervalMs: 0,
        minRefreshIntervalMs: -1,
        providerCacheTtlMs: Infinity,
        providerErrorBackoffMs: NaN,
        fetchTimeoutMs: 0,
      }),
    ).toEqual({
      pollIntervalMs: 0,
      minRefreshIntervalMs: 60000,
      providerCacheTtlMs: 300000,
      providerErrorBackoffMs: 900000,
      fetchTimeoutMs: 1,
    });
  });

  it('parses retry hints and handles HTTP response edge cases', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    expect(retryAfterMsFromMessage('retry-after: 0.5')).toBe(500);
    expect(retryAfterMsFromMessage('rate-limit-reset: Wed, 01 Jan 2025 00:00:02 GMT')).toBe(2000);
    expect(retryAfterMsFromMessage('rate-limit-reset: invalid')).toBe(0);
    expect(isQuotaRateLimitError('temporary failure')).toBe(true);
    expect(isQuotaRateLimitError('connection refused')).toBe(false);
    expect(
      httpErrorMessage(
        'API',
        new Response(null, { status: 500, headers: { 'ratelimit-reset': '\u001b[31m10\u001b[0m' } }),
        '\0',
      ),
    ).toBe('API HTTP 500; rate-limit-reset=10');
    const unreadable = { text: vi.fn().mockRejectedValue(new Error('body unavailable')) } as unknown as Response;
    await expect(readJsonResponse('API', unreadable)).resolves.toEqual({
      error: 'API returned an unreadable JSON response',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchWithTimeout('https://example.test', {}, 10)).rejects.toThrow('offline');
    vi.useRealTimers();
  });

  it('collects public section results while isolating thrown provider failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const setNowMs = vi.fn();
    await expect(
      collectProviderLines(null, ['openai', 'deepseek', 'ollama-cloud'], 'remaining', setNowMs, async (providerId) => {
        if (providerId === 'openai') throw new Error('offline');
        if (providerId === 'deepseek') throw 'bad provider';
        return [];
      }),
    ).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    await expect(
      fetchProviderLines({ providerId: 'unknown' as never, opencodeGoConfig: null, displayMode: 'used', setNowMs }),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
