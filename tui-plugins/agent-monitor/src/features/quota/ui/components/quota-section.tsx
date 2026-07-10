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

const fetchOpencodeGoLines = async (
  opencodeGoConfig: OpencodeGoConfig,
  displayMode: QuotaDisplayMode,
  setNowMs: (ms: number) => void,
): Promise<QuotaLine[]> => {
  if (!opencodeGoConfig || opencodeGoConfig.workspaces.length === 0) return [];

  const fetchedAtMs = Date.now();
  const settledWorkspaces = await Promise.all(
    opencodeGoConfig.workspaces.map(async (workspace) => {
      try {
        return { workspace, result: await fetchOpencodeGoDashboard(workspace.workspaceId, opencodeGoConfig.authCookie) };
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
  const { providerId, opencodeGoConfig, displayMode, setNowMs } = args;

  switch (providerId) {
    case 'opencode-go':
      return fetchOpencodeGoLines(opencodeGoConfig, displayMode, setNowMs);

    case 'github-copilot': {
      const result = await fetchCopilotQuota();
      if (result === null) return undefined;
      if (isProviderError(result)) return result.error;
      const fetchedAtMs = Date.now();
      setNowMs(fetchedAtMs);
      return formatCopilotLines(result, displayMode, fetchedAtMs);
    }

    case 'openrouter': {
      const result = await fetchOpenRouterQuota();
      if (result === null) return undefined;
      if (isProviderError(result)) return result.error;
      return formatOpenRouterLines(result, displayMode);
    }

    case 'openai': {
      const experimentalResetCredits = readQuotaConfig()?.options?.experimentalOpenAIResetCredits === true;
      const result = await fetchOpenAIQuota({ experimentalResetCredits });
      if (result === null) return undefined;
      if (isProviderError(result)) return result.error;
      const fetchedAtMs = Date.now();
      setNowMs(fetchedAtMs);
      return formatOpenAILines(result, displayMode, fetchedAtMs);
    }

    case 'deepseek': {
      const result = await fetchDeepSeekQuota();
      if (result === null) return undefined;
      if (isProviderError(result)) return result.error;
      return formatDeepSeekLines(result, displayMode);
    }

    case 'ollama-cloud': {
      const result = await fetchOllamaCloudQuota();
      if (result === null) return undefined;
      if (isProviderError(result)) return result.error;
      const fetchedAtMs = Date.now();
      setNowMs(fetchedAtMs);
      return formatOllamaCloudLines(result, displayMode, fetchedAtMs);
    }
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
): Promise<QuotaLine[]> => {
  const ctx: ProviderFetchContext = { opencodeGoConfig, displayMode, setNowMs };
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

  const doFetch = async (): Promise<void> => {
    const displayMode: QuotaDisplayMode = props.options.displayMode ?? 'remaining';
    const collected = await collectProviderLines(
      readOpencodeGoConfig(),
      visibleIds,
      displayMode,
      (ms) => setNowMs(ms),
      (providerId, ctx) => cacheAndFetcher.getCachedProviderLines(providerId, ctx),
    );
    setLines(collected);
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

  // Event-driven cache invalidation. The provider cache may hold stale
  // values when the session changes or a turn completes with errors;
  // busting the cache here means the next `usePolling` tick (or the
  // slot's re-render on session change) re-fetches fresh data.
  subscribeRefreshTriggers({
    events: props.api.event,
    lifecycle: props.api.lifecycle,
    eventNames: REFRESH_TRIGGER_EVENTS,
    onTrigger: () => {
      // only invalidate — re-fetch is owned by the next poll
      // tick. An immediate refetch would race the in-flight request
      // and double the network load. The first event after a long
      // quiet stretch will hit an empty cache and re-fetch naturally.
      cacheAndFetcher.invalidateVisibleData();
    },
  });

  const theme = () => props.api.theme.current;
  return (
    <box gap={0}>
      <text fg={theme().text}>Quota</text>
      <QuotaView lines={lines()} nowMs={nowMs()} loading={loading()} api={props.api} />
    </box>
  );
};
