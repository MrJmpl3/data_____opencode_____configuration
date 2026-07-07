import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MIN_REFRESH_INTERVAL_MS,
  DEFAULT_PROVIDER_CACHE_TTL_MS,
  DEFAULT_PROVIDER_ERROR_BACKOFF_MS,
  MIN_SAFE_REFRESH_INTERVAL_MS,
  defaultQuotaSectionOptions,
  resolveNumericOptions,
} from '../../../../src/features/quota/domain/options.ts';

describe('resolveNumericOptions', () => {
  it('returns the safe defaults when no overrides are provided', () => {
    const resolved = resolveNumericOptions({});
    expect(resolved.pollIntervalMs).toBe(defaultQuotaSectionOptions.pollIntervalMs);
    expect(resolved.minRefreshIntervalMs).toBe(DEFAULT_MIN_REFRESH_INTERVAL_MS);
    expect(resolved.providerCacheTtlMs).toBe(DEFAULT_PROVIDER_CACHE_TTL_MS);
    expect(resolved.providerErrorBackoffMs).toBe(DEFAULT_PROVIDER_ERROR_BACKOFF_MS);
  });

  it('passes through user values above the safe minimum unchanged', () => {
    const resolved = resolveNumericOptions({
      pollIntervalMs: 5 * 60_000,
      minRefreshIntervalMs: 90_000,
      providerCacheTtlMs: 3 * 60_000,
      providerErrorBackoffMs: 10 * 60_000,
    });
    expect(resolved.pollIntervalMs).toBe(5 * 60_000);
    expect(resolved.minRefreshIntervalMs).toBe(90_000);
    expect(resolved.providerCacheTtlMs).toBe(3 * 60_000);
    expect(resolved.providerErrorBackoffMs).toBe(10 * 60_000);
  });

  it('clamps sub-minimum values up to MIN_SAFE_REFRESH_INTERVAL_MS', () => {
    const resolved = resolveNumericOptions({
      pollIntervalMs: 5_000,
      minRefreshIntervalMs: 1_000,
      providerCacheTtlMs: 100,
      providerErrorBackoffMs: 50,
    });
    expect(resolved.pollIntervalMs).toBe(MIN_SAFE_REFRESH_INTERVAL_MS);
    expect(resolved.minRefreshIntervalMs).toBe(MIN_SAFE_REFRESH_INTERVAL_MS);
    expect(resolved.providerCacheTtlMs).toBe(MIN_SAFE_REFRESH_INTERVAL_MS);
    expect(resolved.providerErrorBackoffMs).toBe(MIN_SAFE_REFRESH_INTERVAL_MS);
  });

  it('preserves pollIntervalMs=0 to disable polling', () => {
    const resolved = resolveNumericOptions({ pollIntervalMs: 0 });
    expect(resolved.pollIntervalMs).toBe(0);
  });

  it('falls back to defaults for non-finite values', () => {
    const resolved = resolveNumericOptions({
      pollIntervalMs: Number.POSITIVE_INFINITY,
      minRefreshIntervalMs: Number.NaN,
      providerCacheTtlMs: 'no' as unknown as number,
      providerErrorBackoffMs: undefined,
    });
    expect(resolved.pollIntervalMs).toBe(defaultQuotaSectionOptions.pollIntervalMs);
    expect(resolved.minRefreshIntervalMs).toBe(DEFAULT_MIN_REFRESH_INTERVAL_MS);
    expect(resolved.providerCacheTtlMs).toBe(DEFAULT_PROVIDER_CACHE_TTL_MS);
    expect(resolved.providerErrorBackoffMs).toBe(DEFAULT_PROVIDER_ERROR_BACKOFF_MS);
  });
});
