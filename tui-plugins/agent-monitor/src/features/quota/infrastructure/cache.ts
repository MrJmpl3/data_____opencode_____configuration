import { fmtDuration } from '../../../kit/format.ts';
import type { ProviderFetchResult, QuotaProviderId } from '../domain/types.ts';

import { isQuotaRateLimitError, retryAfterMsFromMessage } from './retry-policy.ts';

const MAX_PROVIDER_BACKOFF_MS = 60 * 60_000;

interface ProviderCacheEntry {
  generation: number;
  value?: ProviderFetchResult;
  fetchedAtMs: number;
  cooldownUntilMs?: number;
  consecutiveErrors: number;
  inFlight?: Promise<ProviderFetchResult>;
}

interface QuotaProviderCacheConfig<TConfig> {
  providerCacheTtlMs: number;
  providerErrorBackoffMs: number;
  fetchProviderLines: (providerId: QuotaProviderId, config: TConfig) => Promise<ProviderFetchResult>;
}

export const createQuotaProviderCache = <TConfig>({
  providerCacheTtlMs,
  providerErrorBackoffMs,
  fetchProviderLines,
}: QuotaProviderCacheConfig<TConfig>): {
  getCachedProviderLines: (providerId: QuotaProviderId, config: TConfig) => Promise<ProviderFetchResult>;
  invalidateVisibleData: () => void;
} => {
  const providerCache = new Map<QuotaProviderId, ProviderCacheEntry>();

  const getErrorCooldownMs = (message: string, attempts: number): number => {
    const retryAfterMs = retryAfterMsFromMessage(message);
    const baseMs = isQuotaRateLimitError(message) ? providerErrorBackoffMs : providerCacheTtlMs;
    const multipliedMs = baseMs * Math.min(4, Math.max(1, attempts));
    return Math.max(retryAfterMs, Math.min(multipliedMs, MAX_PROVIDER_BACKOFF_MS));
  };

  const cacheProviderResult = (
    providerId: QuotaProviderId,
    value: ProviderFetchResult,
    requestGeneration: number,
  ): ProviderFetchResult => {
    const currentEntry = providerCache.get(providerId);
    if (currentEntry && currentEntry.generation !== requestGeneration) {
      return value;
    }

    if (value === undefined) {
      providerCache.delete(providerId);
      return undefined;
    }

    const now = Date.now();
    const previous = currentEntry;
    const consecutiveErrors = typeof value === 'string' ? (previous?.consecutiveErrors ?? 0) + 1 : 0;
    providerCache.set(providerId, {
      generation: requestGeneration,
      value,
      fetchedAtMs: now,
      consecutiveErrors,
      cooldownUntilMs: typeof value === 'string' ? now + getErrorCooldownMs(value, consecutiveErrors) : undefined,
    });
    return value;
  };

  const getCachedProviderLines = async (providerId: QuotaProviderId, config: TConfig): Promise<ProviderFetchResult> => {
    const now = Date.now();
    const entry = providerCache.get(providerId);
    if (entry?.inFlight) return entry.inFlight;
    if (entry?.cooldownUntilMs && entry.cooldownUntilMs > now) {
      return entry.value ?? `Refresh paused · retry in ${fmtDuration(Math.ceil((entry.cooldownUntilMs - now) / 1000))}`;
    }
    if (entry?.value !== undefined && now - entry.fetchedAtMs < providerCacheTtlMs) {
      return entry.value;
    }

    const requestGeneration = entry?.generation ?? 0;

    const request = fetchProviderLines(providerId, config)
      .then((value) => cacheProviderResult(providerId, value, requestGeneration))
      .catch((error: unknown) => {
        const message = `Error: ${error instanceof Error ? error.message : String(error)}`;
        return cacheProviderResult(providerId, message, requestGeneration);
      });

    providerCache.set(providerId, {
      generation: requestGeneration,
      value: entry?.value,
      fetchedAtMs: entry?.fetchedAtMs ?? 0,
      cooldownUntilMs: entry?.cooldownUntilMs,
      consecutiveErrors: entry?.consecutiveErrors ?? 0,
      inFlight: request,
    });

    return request;
  };

  const invalidateVisibleData = () => {
    for (const entry of providerCache.values()) {
      entry.generation += 1;
      entry.value = undefined;
      entry.fetchedAtMs = 0;
      entry.inFlight = undefined;
    }
  };

  return { getCachedProviderLines, invalidateVisibleData };
};
