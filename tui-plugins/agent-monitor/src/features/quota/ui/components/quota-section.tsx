/** @jsxImportSource @opentui/solid */
import type { JSX } from 'solid-js';
import { createSignal, onCleanup, onMount } from 'solid-js';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import { useClockTicker } from '../../../../kit/use-clock-ticker.ts';
import { usePolling } from '../../../../kit/use-polling.ts';
import { createQuotaProviderCache } from '../../infrastructure/cache.ts';
import { resolveNumericOptions, resolveVisibleProviderIdsWithDiagnostics } from '../../domain/options.ts';
import { fetchCopilotQuota, formatCopilotLines } from '../../infrastructure/providers/copilot.ts';
import { readQuotaConfig } from '../../infrastructure/providers/config.ts';
import { fetchDeepSeekQuota, formatDeepSeekLines } from '../../infrastructure/providers/deepseek.ts';
import { fetchOllamaCloudQuota, formatOllamaCloudLines } from '../../infrastructure/providers/ollama-cloud.ts';
import {
  fetchOpencodeGoDashboard,
  formatOpencodeGoWorkspaceHeading,
  formatOpencodeGoWorkspaceLines,
  readOpencodeGoConfig,
} from '../../infrastructure/providers/opencode-go.ts';
import { fetchOpenAIQuota, formatOpenAILines } from '../../infrastructure/providers/openai.ts';
import { fetchOpenRouterQuota, formatOpenRouterLines } from '../../infrastructure/providers/openrouter.ts';
import { detailTextLine, headingLine } from '../../domain/lines.ts';
import { subscribeRefreshTriggers } from '../../runtime.tsx';
import type {
  FetchProviderLinesArgs,
  OpencodeGoConfig,
  ProviderFetchResult,
  QuotaDisplayMode,
  QuotaLine,
  QuotaProviderId,
} from '../../domain/types.ts';

import { QuotaView } from './quota-view.tsx';

export type QuotaSectionProps = {
  api: TuiPluginApi;
  options: QuotaSectionOptionsImport;
};

// Re-export the consumer type alias so existing imports of `QuotaSectionProps`
// from this file keep working. The real definition lives in `lib/quota-options.ts`.
import type { QuotaSectionOptions as QuotaSectionOptionsImport } from '../../domain/options.ts';

interface ProviderFetchContext {
  opencodeGoConfig: OpencodeGoConfig;
  displayMode: QuotaDisplayMode;
  setNowMs: (ms: number) => void;
  fetchTimeoutMs: number;
}

type CachedProviderFetcher = (
  providerId: QuotaProviderId,
  ctx: ProviderFetchContext,
) => Promise<QuotaLine[] | string | undefined>;

/** Events that should bust the provider cache and force a re-fetch on
 *  the next tick. Mirrors the events subscribed in main's runtime. */
const REFRESH_TRIGGER_EVENTS = ['tui.session.select', 'session.idle', 'session.error'] as const;

/** True when `result` is a provider error shape: `{ error: string }`. */
const isProviderError = (result: unknown): result is { error: string } =>
  typeof result === 'object' && result !== null && 'error' in result;

type QuotaLines = QuotaLine[];
type Formatter<T> = (result: T, displayMode: QuotaDisplayMode, fetchedAtMs: number) => QuotaLines;
type NoTickFormatter<T> = (result: T, displayMode: QuotaDisplayMode) => QuotaLines;

// Shapes returned by the per-provider fetch helpers — `T` for the success
// variant, with `null` and `{ error: string }` for the documented failure
// variants. The helpers below narrow to `T` once null/error are filtered.
type FetcherResult<T> = T | null | { error: string };

// Standard fetch+format flow for the providers that expose a `fetchXxxQuota()`
// entry point. Centralizes the null/error short-circuits and the fetchedAtMs
// bookkeeping so the per-provider helpers only own the parts that actually
// differ (which fetcher to call, which formatter to apply).
const fetchAndFormatStandard = async <T,>(
  fetcher: () => Promise<FetcherResult<T>>,
  formatter: Formatter<T>,
  displayMode: QuotaDisplayMode,
  setNowMs: (ms: number) => void,
): Promise<ProviderFetchResult> => {
  const result = await fetcher();
  if (result === null) return undefined;
  if (isProviderError(result)) return result.error;
  const fetchedAtMs = Date.now();
  setNowMs(fetchedAtMs);
  return formatter(result, displayMode, fetchedAtMs);
};

// Variant for providers that do not need a fetchedAtMs (currently
// openrouter + deepseek). Keeping the no-tick branch separate avoids paying
// for the Date.now / setNowMs plumbing on those call paths.
const fetchAndFormatStandardNoTick = async <T,>(
  fetcher: () => Promise<FetcherResult<T>>,
  formatter: NoTickFormatter<T>,
  displayMode: QuotaDisplayMode,
): Promise<ProviderFetchResult> => {
  const result = await fetcher();
  if (result === null) return undefined;
  if (isProviderError(result)) return result.error;
  return formatter(result, displayMode);
};

const fetchAndFormatCopilot = (
  displayMode: QuotaDisplayMode,
  setNowMs: (ms: number) => void,
  timeoutMs: number,
): Promise<ProviderFetchResult> =>
  fetchAndFormatStandard(() => fetchCopilotQuota(undefined, timeoutMs), formatCopilotLines, displayMode, setNowMs);

const fetchAndFormatOpenRouter = (displayMode: QuotaDisplayMode, timeoutMs: number): Promise<ProviderFetchResult> =>
  fetchAndFormatStandardNoTick(() => fetchOpenRouterQuota(undefined, timeoutMs), formatOpenRouterLines, displayMode);

const fetchAndFormatOpenAI = (
  displayMode: QuotaDisplayMode,
  setNowMs: (ms: number) => void,
  timeoutMs: number,
): Promise<ProviderFetchResult> => {
  const experimentalResetCredits = readQuotaConfig()?.options?.experimentalOpenAIResetCredits === true;
  return fetchAndFormatStandard(
    () => fetchOpenAIQuota({ experimentalResetCredits, timeoutMs }),
    formatOpenAILines,
    displayMode,
    setNowMs,
  );
};

const fetchAndFormatDeepSeek = (displayMode: QuotaDisplayMode, timeoutMs: number): Promise<ProviderFetchResult> =>
  fetchAndFormatStandardNoTick(() => fetchDeepSeekQuota(undefined, timeoutMs), formatDeepSeekLines, displayMode);

const fetchAndFormatOllamaCloud = (
  displayMode: QuotaDisplayMode,
  setNowMs: (ms: number) => void,
  timeoutMs: number,
): Promise<ProviderFetchResult> =>
  fetchAndFormatStandard(
    () => fetchOllamaCloudQuota(undefined, timeoutMs),
    formatOllamaCloudLines,
    displayMode,
    setNowMs,
  );

const fetchOpencodeGoLines = async (
  opencodeGoConfig: OpencodeGoConfig,
  displayMode: QuotaDisplayMode,
  setNowMs: (ms: number) => void,
  timeoutMs: number,
): Promise<QuotaLine[]> => {
  if (!opencodeGoConfig || opencodeGoConfig.workspaces.length === 0) return [];

  const fetchedAtMs = Date.now();
  const settledWorkspaces = await Promise.all(
    opencodeGoConfig.workspaces.map(async (workspace) => {
      try {
        return {
          workspace,
          result: await fetchOpencodeGoDashboard(
            workspace.workspaceId,
            opencodeGoConfig.authCookie,
            undefined,
            timeoutMs,
          ),
        };
      } catch (error: unknown) {
        return { workspace, result: { error: error instanceof Error ? error.message : String(error) } };
      }
    }),
  );

  setNowMs(fetchedAtMs);
  return settledWorkspaces.flatMap(({ workspace, result }) => {
    if ('data' in result) {
      return formatOpencodeGoWorkspaceLines(workspace, result.data, displayMode, fetchedAtMs);
    }
    return [headingLine(formatOpencodeGoWorkspaceHeading(workspace.label)), detailTextLine(result.error, 'error')];
  });
};

export const fetchProviderLines = async (args: FetchProviderLinesArgs): Promise<ProviderFetchResult> => {
  const { providerId, opencodeGoConfig, displayMode, setNowMs, fetchTimeoutMs = 10_000 } = args;

  switch (providerId) {
    case 'opencode-go':
      return fetchOpencodeGoLines(opencodeGoConfig, displayMode, setNowMs, fetchTimeoutMs);
    case 'github-copilot':
      return fetchAndFormatCopilot(displayMode, setNowMs, fetchTimeoutMs);
    case 'openrouter':
      return fetchAndFormatOpenRouter(displayMode, fetchTimeoutMs);
    case 'openai':
      return fetchAndFormatOpenAI(displayMode, setNowMs, fetchTimeoutMs);
    case 'deepseek':
      return fetchAndFormatDeepSeek(displayMode, fetchTimeoutMs);
    case 'ollama-cloud':
      return fetchAndFormatOllamaCloud(displayMode, setNowMs, fetchTimeoutMs);
  }
};

/**
 * Recolecta lineas de todos los providers visibles en PARALELO. Cada provider
 * tiene su propio timeout (10s por defecto) — sumarlos en serie era el bug
 * original que hacía la sección tardar hasta 30-40s en aparecer. Con
 * `Promise.all` el wall-clock es el MAX de los providers, no la suma.
 *
 * El parámetro `fetcher` permite inyectar un wrapper con cache: en producción
 * lo provee `createQuotaProviderCache` para reusar el resultado del último
 * fetch dentro de la ventana TTL; los tests lo omiten para forzar la llamada
 * directa a `fetchProviderLines` y mantener las aserciones deterministas.
 *
 * Función async pura para testear sin renderizar el componente TUI.
 */
export const collectProviderLines = async (
  opencodeGoConfig: OpencodeGoConfig,
  visibleIds: readonly QuotaProviderId[],
  displayMode: QuotaDisplayMode,
  setNowMs: (ms: number) => void,
  fetcher: CachedProviderFetcher = (providerId, ctx) => fetchProviderLines({ providerId, ...ctx }),
  fetchTimeoutMs = 10_000,
): Promise<QuotaLine[]> => {
  const ctx: ProviderFetchContext = { opencodeGoConfig, displayMode, setNowMs, fetchTimeoutMs };
  const settled = await Promise.all(
    visibleIds.map(async (providerId) => {
      try {
        const result = await fetcher(providerId, ctx);
        return { providerId, result };
      } catch (err: unknown) {
        return { providerId, error: err };
      }
    }),
  );

  const lines: QuotaLine[] = [];
  for (const outcome of settled) {
    if ('error' in outcome) {
      console.warn('[agent-monitor] quota provider exception:', {
        providerId: outcome.providerId,
        error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
      });
      continue;
    }

    const { providerId, result } = outcome;
    if (Array.isArray(result) && result.length > 0) {
      lines.push(...result);
    } else if (typeof result === 'string') {
      lines.push(detailTextLine(result, 'error'));
      console.warn('[agent-monitor] quota provider error:', { providerId, error: result });
    }
  }
  return lines;
};

/**
 * Sección "Quota" del sidebar. Usa onMount para la carga inicial y
 * usePolling para refresco periódico según options.pollIntervalMs. La
 * cache de providers vive en `createQuotaProviderCache` y se invalida vía
 * `invalidateVisibleData` cuando el event bus dispara uno de los eventos
 * configurados (`tui.session.select`, `session.idle`, `session.error`).
 */
export const QuotaSection = (props: QuotaSectionProps): JSX.Element => {
  const visibleIds = resolveVisibleProviderIdsWithDiagnostics(props.options.visibleProviders).visibleProviders;
  const resolved = resolveNumericOptions(props.options);
  const [lines, setLines] = createSignal<QuotaLine[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [nowMs, setNowMs] = createSignal(Date.now());
  // el cache por instancia evita leaks entre mounts/unmounts.
  // El TTL y el backoff ahora vienen de options, no de constantes hardcoded.
  const cacheAndFetcher = createQuotaProviderCache<ProviderFetchContext>({
    providerCacheTtlMilliseconds: resolved.providerCacheTtlMs,
    providerErrorBackoffMilliseconds: resolved.providerErrorBackoffMs,
    fetchProviderLines: (providerId, ctx) => fetchProviderLines({ providerId, ...ctx }),
  });

  // fetch generation counter — incremented before each doFetch so that
  // stale results from in-flight requests that complete after a newer
  // fetch are discarded instead of overwriting the view lines.
  let fetchGen = 0;

  // last wall-clock time a doFetch completed. Used to debounce refresh
  // events by minRefreshIntervalMs.
  const [lastRefreshAtMs, setLastRefreshAtMs] = createSignal(0);

  let deferredRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  const doFetch = async ({ fromTrigger }: { fromTrigger?: boolean } = {}): Promise<void> => {
    const gen = ++fetchGen;
    const displayMode: QuotaDisplayMode = props.options.displayMode ?? 'remaining';
    const collected = await collectProviderLines(
      readOpencodeGoConfig(),
      visibleIds,
      displayMode,
      (ms) => setNowMs(ms),
      (providerId, ctx) => cacheAndFetcher.getCachedProviderLines(providerId, ctx),
      resolved.fetchTimeoutMs,
    );
    // generation guard: discard if a newer fetch started while we were in-flight
    if (gen !== fetchGen) return;
    setLines(collected);
    // only update the debounce anchor on non-deferred completions so the
    // next event-gap is measured from the actual fetch — not from a
    // deferred-timer fire that was itself clamped.
    if (!fromTrigger) setLastRefreshAtMs(Date.now());
  };

  onMount(() => {
    setLoading(true);
    doFetch().finally(() => setLoading(false));
  });

  // zero is allowed by resolveNumericOptions to disable polling;
  // skip the timer entirely so a disabled poll is truly free.
  if (resolved.pollIntervalMs > 0) {
    usePolling({
      refetch: () => {
        doFetch().catch((err: unknown) => {
          console.warn('[agent-monitor] poll fetch failed:', err);
        });
      },
      intervalMs: resolved.pollIntervalMs,
    });
  }

  // 1Hz tick so the rendered "5h12m33s" counters actually count down
  // between fetches. The kit version returns a dispose handle that must
  // be invoked on unmount; the internal setTimeout chain would otherwise
  // keep firing past the component's lifetime.
  onCleanup(
    useClockTicker({
      active: () => lines().length > 0,
      onTick: (tickNowMs: number) => setNowMs(tickNowMs),
    }),
  );

  // Event-driven cache invalidation + refresh. minRefreshIntervalMs
  // debounces bus events so rapid-fire triggers don't cause back-to-back
  // fetches. When pollInterval is 0 (disabled) this is the ONLY refresh
  // mechanism, so the fetcher path respects the debounce contract.
  subscribeRefreshTriggers({
    events: props.api.event,
    lifecycle: props.api.lifecycle,
    eventNames: REFRESH_TRIGGER_EVENTS,
    onTrigger: () => {
      if (deferredRefreshTimer !== undefined) {
        clearTimeout(deferredRefreshTimer);
        deferredRefreshTimer = undefined;
      }

      const elapsed = Date.now() - lastRefreshAtMs();
      if (elapsed >= resolved.minRefreshIntervalMs) {
        cacheAndFetcher.invalidateVisibleData();
        doFetch({ fromTrigger: true }).catch((err: unknown) => {
          console.warn('[agent-monitor] event-triggered fetch failed:', err);
        });
      } else {
        // Defer until minRefreshIntervalMs from the last anchor point
        deferredRefreshTimer = setTimeout(() => {
          deferredRefreshTimer = undefined;
          cacheAndFetcher.invalidateVisibleData();
          doFetch({ fromTrigger: true }).catch((err: unknown) => {
            console.warn('[agent-monitor] deferred event-triggered fetch failed:', err);
          });
        }, resolved.minRefreshIntervalMs - elapsed);
      }
    },
  });

  // Clean up any pending deferred refresh timer on unmount
  onCleanup(() => {
    if (deferredRefreshTimer !== undefined) {
      clearTimeout(deferredRefreshTimer);
      deferredRefreshTimer = undefined;
    }
  });

  const theme = () => props.api.theme.current;
  return (
    <box gap={0}>
      <text fg={theme().text}>Quota</text>
      <QuotaView lines={lines()} nowMs={nowMs()} loading={loading()} api={props.api} />
    </box>
  );
};
