import type { QuotaProviderId } from './types.ts';

/** Lower bound for any user-configured refresh interval: prevents accidental
 *  100ms loops that would get rate-limited by every provider. */
export const MIN_SAFE_REFRESH_INTERVAL_MS = 60_000;

export const DEFAULT_PROVIDER_CACHE_TTL_MS = 5 * 60_000;
export const DEFAULT_PROVIDER_ERROR_BACKOFF_MS = 15 * 60_000;
export const DEFAULT_MIN_REFRESH_INTERVAL_MS = 2 * 60_000;

export interface QuotaSectionOptions {
  visible: boolean;
  order: number;
  pollIntervalMs?: number;
  /**
   * Minimum gap (ms) between two refreshes. Events from the bus that arrive
   * sooner are debounced onto a single deferred refresh.
   */
  minRefreshIntervalMs?: number;
  /** Provider cache TTL in ms. */
  providerCacheTtlMs?: number;
  /** Provider error backoff in ms. */
  providerErrorBackoffMs?: number;
  visibleProviders?: readonly string[];
  displayMode?: 'remaining' | 'used';
}

export const defaultQuotaSectionOptions: QuotaSectionOptions = {
  visible: true,
  order: 60,
  pollIntervalMs: 10 * 60_000,
  minRefreshIntervalMs: DEFAULT_MIN_REFRESH_INTERVAL_MS,
  providerCacheTtlMs: DEFAULT_PROVIDER_CACHE_TTL_MS,
  providerErrorBackoffMs: DEFAULT_PROVIDER_ERROR_BACKOFF_MS,
};

// ponytail: defaults canónicos para `visibleProviders`. `readonly` impide
// que callers muten la lista global; nuevos providers se agregan acá.
const DEFAULT_VISIBLE_PROVIDERS: readonly QuotaProviderId[] = ['opencode-go', 'github-copilot', 'openrouter'];

export const ALLOWED_PROVIDER_IDS: readonly QuotaProviderId[] = [
  'opencode-go',
  'github-copilot',
  'openrouter',
  'openai',
  'deepseek',
  'ollama-cloud',
];

interface VisibleProviderResolution {
  visibleProviders: readonly QuotaProviderId[];
  invalidVisibleProviderEntries: readonly string[];
  fellBackToDefaultVisibleProviders: boolean;
}

const formatInvalidEntry = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * Resuelve la lista de `visibleProviders` declarada en `agent-monitor.json`
 * contra el conjunto canónico de providers soportados. Una lista ausente o
 * vacía cae a los defaults. Entradas inválidas se devuelven también para que
 * el runtime pueda loggear advertencias en vez de descartarlas en silencio.
 */
export const resolveVisibleProviderIdsWithDiagnostics = (
  configured: readonly string[] | undefined,
): VisibleProviderResolution => {
  if (!configured || configured.length === 0) {
    return {
      visibleProviders: DEFAULT_VISIBLE_PROVIDERS,
      invalidVisibleProviderEntries: [],
      fellBackToDefaultVisibleProviders: false,
    };
  }

  const resolved: QuotaProviderId[] = [];
  const invalid: string[] = [];
  const seen = new Set<QuotaProviderId>();
  for (const raw of configured) {
    if (typeof raw !== 'string') {
      invalid.push(formatInvalidEntry(raw));
      continue;
    }
    if (!ALLOWED_PROVIDER_IDS.includes(raw as QuotaProviderId)) {
      invalid.push(formatInvalidEntry(raw));
      continue;
    }
    const id = raw as QuotaProviderId;
    if (seen.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }

  if (resolved.length === 0) {
    return {
      visibleProviders: DEFAULT_VISIBLE_PROVIDERS,
      invalidVisibleProviderEntries: invalid,
      fellBackToDefaultVisibleProviders: invalid.length > 0,
    };
  }

  return {
    visibleProviders: resolved,
    invalidVisibleProviderEntries: invalid,
    fellBackToDefaultVisibleProviders: false,
  };
};

interface ClampNumberOptions {
  value: number | undefined;
  fallback: number;
  minimum: number;
  allowZero?: boolean;
}

/** Clamp a user-supplied numeric option to a safe range, falling back when
 *  the value is missing or not a finite number. */
const clampNumberOption = ({ value, fallback, minimum, allowZero = false }: ClampNumberOptions): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (allowZero && value === 0) return 0;
  return Math.max(minimum, value);
};

interface ResolvedQuotaSectionOptions {
  pollIntervalMs: number;
  minRefreshIntervalMs: number;
  providerCacheTtlMs: number;
  providerErrorBackoffMs: number;
}

/** Subset of `QuotaSectionOptions` that the numeric resolver actually reads.
 *  Keeping the input narrow makes the resolver testable without having to
 *  build a full `QuotaSectionOptions` in every assertion. */
type NumericQuotaOptions = Pick<
  Partial<QuotaSectionOptions>,
  'pollIntervalMs' | 'minRefreshIntervalMs' | 'providerCacheTtlMs' | 'providerErrorBackoffMs'
>;

/**
 * Resolves and clamps every numeric option in one pass so the runtime layer
 * doesn't have to repeat the same defensive checks. Returns a flat shape with
 * safe, non-zero values for every key.
 */
export const resolveNumericOptions = (options: NumericQuotaOptions): ResolvedQuotaSectionOptions => {
  return {
    pollIntervalMs: clampNumberOption({
      value: options.pollIntervalMs,
      fallback: defaultQuotaSectionOptions.pollIntervalMs!,
      minimum: MIN_SAFE_REFRESH_INTERVAL_MS,
      allowZero: true,
    }),
    minRefreshIntervalMs: clampNumberOption({
      value: options.minRefreshIntervalMs,
      fallback: DEFAULT_MIN_REFRESH_INTERVAL_MS,
      minimum: MIN_SAFE_REFRESH_INTERVAL_MS,
    }),
    providerCacheTtlMs: clampNumberOption({
      value: options.providerCacheTtlMs,
      fallback: DEFAULT_PROVIDER_CACHE_TTL_MS,
      minimum: MIN_SAFE_REFRESH_INTERVAL_MS,
    }),
    providerErrorBackoffMs: clampNumberOption({
      value: options.providerErrorBackoffMs,
      fallback: DEFAULT_PROVIDER_ERROR_BACKOFF_MS,
      minimum: MIN_SAFE_REFRESH_INTERVAL_MS,
    }),
  };
};
