import { describe, expect, it, vi } from 'vitest';

import { formatOpenAILines } from '../../../../src/features/quota/domain/format.ts';
import { formatCreditQuota, formatCountQuota } from '../../../../src/features/quota/domain/lines.ts';
import {
  resolveNumericOptions,
  resolveVisibleProviderIdsWithDiagnostics,
} from '../../../../src/features/quota/domain/options.ts';
import {
  isQuotaRateLimitError,
  retryAfterMsFromMessage,
} from '../../../../src/features/quota/infrastructure/retry-policy.ts';

describe('final quota domain branches', () => {
  it('uses fallback window labels and credit text when no numeric total exists', () => {
    expect(
      formatOpenAILines({ hourly: { usedPct: 10, resetSec: 1, limitWindowSec: 123 } }, 'remaining', 0)[1],
    ).toMatchObject({
      kind: 'window',
      label: '5h',
    });
    expect(formatCreditQuota({ text: 'unlimited', total: 10 }, 'used')).toBe('unlimited');
    expect(formatCountQuota({ text: 'fallback', total: 10 }, 'remaining')).toBe('fallback');
  });

  it('resolves invalid numeric options and filters invalid provider entries', () => {
    expect(
      resolveNumericOptions({ pollIntervalMs: Number.POSITIVE_INFINITY, fetchTimeoutMs: Number.NaN }),
    ).toMatchObject({
      pollIntervalMs: 600_000,
      fetchTimeoutMs: 10_000,
    });
    expect(resolveVisibleProviderIdsWithDiagnostics(['unknown'])).toMatchObject({
      visibleProviders: ['opencode-go', 'github-copilot', 'openrouter'],
      fellBackToDefaultVisibleProviders: true,
    });
  });

  it('parses retry-after dates and reset values in each supported clock unit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    expect(retryAfterMsFromMessage('retry-after: Wed, 01 Jan 2025 00:00:02 GMT')).toBe(2_000);
    expect(retryAfterMsFromMessage('rate-limit-reset: 2')).toBe(2_000);
    expect(retryAfterMsFromMessage('rate-limit-reset: 1735689602')).toBe(2_000);
    expect(retryAfterMsFromMessage('rate-limit-reset: 1735689602000')).toBe(2_000);
    expect(retryAfterMsFromMessage('retry-after: 0')).toBe(0);
    expect(isQuotaRateLimitError('too many requests')).toBe(true);
    vi.useRealTimers();
  });
});
