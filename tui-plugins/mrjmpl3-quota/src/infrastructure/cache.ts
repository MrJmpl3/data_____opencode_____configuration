import { fmtDuration } from './providers/format.ts';
import { isQuotaRateLimitError, retryAfterMsFromMessage } from './retry-policy.ts';
import type { GoConfig, ProviderFetchResult } from '../domain/provider-results.ts';
import type { QuotaProviderId } from '../domain/types.ts';

const MAX_PROVIDER_BACKOFF_MILLISECONDS = 60 * 60_000;

interface ProviderCacheEntry {
  value?: ProviderFetchResult;
  fetchedAtMilliseconds: number;
  cooldownUntilMilliseconds?: number;
  consecutiveErrors: number;
  inFlight?: Promise<ProviderFetchResult>;
}

interface QuotaProviderCacheConfig {
  providerCacheTtlMilliseconds: number;
  providerErrorBackoffMilliseconds: number;
  fetchProviderLines: (providerId: QuotaProviderId, goConfig: GoConfig) => Promise<ProviderFetchResult>;
}

export const createQuotaProviderCache = ({
  providerCacheTtlMilliseconds,
  providerErrorBackoffMilliseconds,
  fetchProviderLines,
}: QuotaProviderCacheConfig): {
  providerCache: Map<QuotaProviderId, ProviderCacheEntry>;
  getCachedProviderLines: (providerId: QuotaProviderId, goConfig: GoConfig) => Promise<ProviderFetchResult>;
} => {
  const providerCache = new Map<QuotaProviderId, ProviderCacheEntry>();

  const getErrorCooldownMilliseconds = (message: string, attempts: number): number => {
    const retryAfterMs = retryAfterMsFromMessage(message);
    const baseMs = isQuotaRateLimitError(message) ? providerErrorBackoffMilliseconds : providerCacheTtlMilliseconds;
    const multipliedMs = baseMs * Math.min(4, Math.max(1, attempts));
    return Math.max(retryAfterMs, Math.min(multipliedMs, MAX_PROVIDER_BACKOFF_MILLISECONDS));
  };

  const cacheProviderResult = (providerId: QuotaProviderId, value: ProviderFetchResult): ProviderFetchResult => {
    if (value === undefined) {
      providerCache.delete(providerId);
      return undefined;
    }

    const now = Date.now();
    const previous = providerCache.get(providerId);
    const consecutiveErrors = typeof value === 'string' ? (previous?.consecutiveErrors ?? 0) + 1 : 0;
    providerCache.set(providerId, {
      value,
      fetchedAtMilliseconds: now,
      consecutiveErrors,
      cooldownUntilMilliseconds:
        typeof value === 'string' ? now + getErrorCooldownMilliseconds(value, consecutiveErrors) : undefined,
    });
    return value;
  };

  const getCachedProviderLines = async (
    providerId: QuotaProviderId,
    goConfig: GoConfig,
  ): Promise<ProviderFetchResult> => {
    const now = Date.now();
    const entry = providerCache.get(providerId);
    if (entry?.inFlight) return entry.inFlight;
    if (entry?.cooldownUntilMilliseconds && entry.cooldownUntilMilliseconds > now) {
      return (
        entry.value ??
        `Refresh paused · retry in ${fmtDuration(Math.ceil((entry.cooldownUntilMilliseconds - now) / 1000))}`
      );
    }
    if (entry?.value !== undefined && now - entry.fetchedAtMilliseconds < providerCacheTtlMilliseconds) {
      return entry.value;
    }

    const request = fetchProviderLines(providerId, goConfig)
      .then((value) => cacheProviderResult(providerId, value))
      .catch((error: unknown) => {
        const message = `Error: ${error instanceof Error ? error.message : String(error)}`;
        return cacheProviderResult(providerId, message);
      });

    providerCache.set(providerId, {
      value: entry?.value,
      fetchedAtMilliseconds: entry?.fetchedAtMilliseconds ?? 0,
      cooldownUntilMilliseconds: entry?.cooldownUntilMilliseconds,
      consecutiveErrors: entry?.consecutiveErrors ?? 0,
      inFlight: request,
    });

    return request;
  };

  return { providerCache, getCachedProviderLines };
};
