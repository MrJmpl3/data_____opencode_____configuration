import { describe, expect, it, vi } from 'vitest';

import { createQuotaProviderCache } from '../../../../src/features/quota/infrastructure/cache.ts';
import {
  isQuotaRateLimitError,
  retryAfterMsFromMessage,
} from '../../../../src/features/quota/infrastructure/retry-policy.ts';

describe('quota retry policy', () => {
  it.each([
    ['retry-after=1.5 seconds', 1500],
    ['retry-after: 0', 0],
    ['rate-limit-reset=1700000000000', 0],
    ['rate-limit-reset=1700000000', expect.any(Number)],
    ['rate-limit-reset=60', expect.any(Number)],
    ['retry-after: invalid', 0],
  ])('parses retry hint %s', (message, expected) => {
    const actual = retryAfterMsFromMessage(message);
    if (typeof expected === 'number') expect(actual).toBe(expected);
    else expect(actual).toBeGreaterThanOrEqual(0);
  });

  it('accepts date retry hints and recognizes temporary rate-limit wording', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    expect(retryAfterMsFromMessage(`retry-after: ${new Date(Date.now() + 60_000).toUTCString()}`)).toBe(60_000);
    expect(isQuotaRateLimitError('temporary failure')).toBe(true);
    expect(isQuotaRateLimitError('RATE_LIMIT')).toBe(true);
    expect(isQuotaRateLimitError('bad request')).toBe(false);
    vi.useRealTimers();
  });
});

describe('quota provider cache', () => {
  it('translates thrown errors, removes undefined values, and respects cooldown expiry', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ kind: 'detail', text: 'fresh' }]);
    const cache = createQuotaProviderCache({
      providerCacheTtlMs: 100,
      providerErrorBackoffMs: 100,
      fetchProviderLines: fetcher,
    });
    expect(await cache.getCachedProviderLines('openai', {})).toBe('Error: boom');
    vi.advanceTimersByTime(101);
    expect(await cache.getCachedProviderLines('openai', {})).toBeUndefined();
    expect(await cache.getCachedProviderLines('openai', {})).toEqual([{ kind: 'detail', text: 'fresh' }]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('uses retry-after over the capped backoff and preserves cached values during cooldown', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue('HTTP 429 retry-after=7200');
    const cache = createQuotaProviderCache({
      providerCacheTtlMs: 1,
      providerErrorBackoffMs: 1,
      fetchProviderLines: fetcher,
    });
    expect(await cache.getCachedProviderLines('openrouter', {})).toContain('429');
    vi.advanceTimersByTime(60 * 60_000);
    expect(await cache.getCachedProviderLines('openrouter', {})).toContain('429');
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
