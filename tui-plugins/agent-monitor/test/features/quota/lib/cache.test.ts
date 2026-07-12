import { describe, expect, it, vi } from 'vitest';

import { createQuotaProviderCache } from '../../../../src/features/quota/infrastructure/cache.ts';
import {
  isQuotaRateLimitError,
  retryAfterMsFromMessage,
} from '../../../../src/features/quota/infrastructure/retry-policy.ts';
import type { ProviderFetchResult } from '../../../../src/features/quota/domain/types.ts';

const makeFetcher = (results: readonly ProviderFetchResult[]) => {
  let i = 0;
  return vi.fn(async (): Promise<ProviderFetchResult> => {
    const value = results[i] ?? results[results.length - 1];
    i += 1;
    return value;
  });
};

describe('createQuotaProviderCache', () => {
  it('returns the cached value within the TTL window without calling the fetcher again', async () => {
    const fetcher = makeFetcher([[{ kind: 'detail', text: 'cached' }]]);
    const { getCachedProviderLines } = createQuotaProviderCache<string>({
      providerCacheTtlMs: 60_000,
      providerErrorBackoffMs: 60_000,
      fetchProviderLines: fetcher,
    });

    await getCachedProviderLines('github-copilot', 'ctx');
    await getCachedProviderLines('github-copilot', 'ctx');
    await getCachedProviderLines('github-copilot', 'ctx');

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after the TTL expires', async () => {
    vi.useFakeTimers();
    const fetcher = makeFetcher([[{ kind: 'detail', text: 'first' }], [{ kind: 'detail', text: 'second' }]]);
    const { getCachedProviderLines } = createQuotaProviderCache<string>({
      providerCacheTtlMs: 1_000,
      providerErrorBackoffMs: 1_000,
      fetchProviderLines: fetcher,
    });

    await getCachedProviderLines('github-copilot', 'ctx');
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_500);
    await getCachedProviderLines('github-copilot', 'ctx');
    expect(fetcher).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('coalesces concurrent requests for the same provider into one fetch', async () => {
    let resolveFirst: ((value: ProviderFetchResult) => void) | undefined;
    const fetcher = vi.fn(
      () =>
        new Promise<ProviderFetchResult>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { getCachedProviderLines } = createQuotaProviderCache<string>({
      providerCacheTtlMs: 60_000,
      providerErrorBackoffMs: 60_000,
      fetchProviderLines: fetcher,
    });

    const p1 = getCachedProviderLines('github-copilot', 'ctx');
    const p2 = getCachedProviderLines('github-copilot', 'ctx');

    resolveFirst?.([{ kind: 'detail', text: 'once' }]);
    await Promise.all([p1, p2]);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('skips re-fetching while a rate-limited provider is in cooldown and surfaces the cached error', async () => {
    const fetcher = makeFetcher(['HTTP 429 · retry-after=600']);
    const { getCachedProviderLines } = createQuotaProviderCache<string>({
      providerCacheTtlMs: 60_000,
      providerErrorBackoffMs: 60_000,
      fetchProviderLines: fetcher,
    });

    const first = await getCachedProviderLines('github-copilot', 'ctx');
    const second = await getCachedProviderLines('github-copilot', 'ctx');

    expect(first).toBe('HTTP 429 · retry-after=600');
    expect(second).toBe('HTTP 429 · retry-after=600');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('caches string error results and applies the rate-limit backoff so the next call returns the same string without re-fetching', async () => {
    const fetcher = makeFetcher(['Service unavailable', 'Service unavailable']);
    const { getCachedProviderLines } = createQuotaProviderCache<string>({
      providerCacheTtlMs: 60_000,
      providerErrorBackoffMs: 60_000,
      fetchProviderLines: fetcher,
    });

    const first = await getCachedProviderLines('github-copilot', 'ctx');
    const second = await getCachedProviderLines('github-copilot', 'ctx');

    // ponytail: la única garantía observable de que consecutiveErrors cuenta
    // es que el segundo call sigue mostrando el error cacheado en vez de
    // re-intentar el fetcher (el backoff dispara el cooldown).
    expect(first).toBe('Service unavailable');
    expect(second).toBe('Service unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('discards an in-flight fetch result when invalidateVisibleData runs before it resolves', async () => {
    let resolveFirst: ((value: ProviderFetchResult) => void) | undefined;
    const slowFetcher = vi.fn(
      () =>
        new Promise<ProviderFetchResult>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { getCachedProviderLines, invalidateVisibleData } = createQuotaProviderCache<string>({
      providerCacheTtlMs: 60_000,
      providerErrorBackoffMs: 60_000,
      fetchProviderLines: slowFetcher,
    });

    // Start an in-flight fetch
    const firstPromise = getCachedProviderLines('github-copilot', 'ctx');

    // Invalidate while that fetch is still in-flight
    invalidateVisibleData();

    // Resolve the stale in-flight fetch with outdated data
    resolveFirst?.([{ kind: 'detail', text: 'stale' }]);
    await firstPromise;

    // After invalidation a new fetch should re-call the fetcher
    slowFetcher.mockResolvedValue([{ kind: 'detail', text: 'fresh' }]);
    const result = await getCachedProviderLines('github-copilot', 'ctx');

    expect(result).toEqual([{ kind: 'detail', text: 'fresh' }]);
    expect(slowFetcher).toHaveBeenCalledTimes(2);
  });

  it('invalidateVisibleData resets every entry so the next call re-fetches', async () => {
    const fetcher = makeFetcher([[{ kind: 'detail', text: 'first' }], [{ kind: 'detail', text: 'second' }]]);
    const { getCachedProviderLines, invalidateVisibleData } = createQuotaProviderCache<string>({
      providerCacheTtlMs: 60_000,
      providerErrorBackoffMs: 60_000,
      fetchProviderLines: fetcher,
    });

    await getCachedProviderLines('github-copilot', 'ctx');
    expect(fetcher).toHaveBeenCalledTimes(1);

    invalidateVisibleData();
    await getCachedProviderLines('github-copilot', 'ctx');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('isQuotaRateLimitError', () => {
  it('detects 429 and rate-limit phrases', () => {
    expect(isQuotaRateLimitError('HTTP 429 · retry-after=60')).toBe(true);
    expect(isQuotaRateLimitError('rate limit exceeded')).toBe(true);
    expect(isQuotaRateLimitError('Too Many Requests')).toBe(true);
    expect(isQuotaRateLimitError('secondary rate limit hit')).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isQuotaRateLimitError('Service unavailable')).toBe(false);
    expect(isQuotaRateLimitError('Invalid credentials')).toBe(false);
  });
});

describe('retryAfterMsFromMessage', () => {
  it('parses a retry-after header in seconds', () => {
    expect(retryAfterMsFromMessage('retry-after=120')).toBe(120_000);
  });

  it('parses a retry-after header in seconds with a space', () => {
    expect(retryAfterMsFromMessage('retry-after: 30')).toBe(30_000);
  });

  it('parses a rate-limit-reset epoch in seconds', () => {
    const futureEpoch = Math.floor(Date.now() / 1000) + 60;
    const ms = retryAfterMsFromMessage(`rate-limit-reset=${futureEpoch}`);
    expect(ms).toBeGreaterThan(50_000);
    expect(ms).toBeLessThan(70_000);
  });

  it('returns 0 when no header is present', () => {
    expect(retryAfterMsFromMessage('Service unavailable')).toBe(0);
  });

  it('parses an HTTP-date retry-after header via Date.parse fallback', () => {
    const futureDate = new Date(Date.now() + 120_000);
    const ms = retryAfterMsFromMessage(`retry-after: ${futureDate.toUTCString()}`);
    expect(ms).toBeGreaterThan(100_000);
    expect(ms).toBeLessThan(140_000);
  });
});
