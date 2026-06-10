/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { createSignal } from 'solid-js';

import type { QuotaLine } from '../domain/lines.ts';
import { detailTextLine, headingLine } from '../domain/lines.ts';
import { fetchProviderLines } from '../domain/provider-results.ts';
import type { GoConfig, ProviderFetchResult, ProviderResult } from '../domain/provider-results.ts';
import type { QuotaProviderId } from '../domain/types.ts';
import { createQuotaProviderCache } from '../infrastructure/cache.ts';
import { readGoConfig } from '../infrastructure/providers/go.ts';
import { View } from '../ui/view.tsx';
import { createRefreshScheduler } from './refresh-scheduler.ts';
import {
  ALLOWED_VISIBLE_PROVIDER_IDS,
  DEFAULT_VISIBLE_PROVIDERS,
  inspectQuotaPluginOptions,
} from './options.ts';
import type { ProviderSpec } from '../domain/types.ts';
import { slotSessionId } from './session.ts';

const TERMINAL_SESSION_STATUSES = new Set([
  'aborted',
  'cancelled',
  'canceled',
  'completed',
  'done',
  'error',
  'failed',
  'failure',
  'stopped',
  'success',
  'succeeded',
  'timeout',
  'timed_out',
]);
const TERMINAL_TASK_STATUSES = new Set(['cancelled', 'canceled', 'completed', 'done', 'error', 'failed', 'success']);
const PROVIDER_CACHE_INVALIDATION_SOURCES = new Set(['message.part.updated', 'quota-window-expired', 'session.error', 'session.status']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);
const normalizedStatus = (value: unknown): string | undefined => asString(value)?.trim().toLowerCase();

const readStatus = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return normalizedStatus(value);
  }

  return (
    normalizedStatus(value.status) ??
    readStatus(value.status) ??
    normalizedStatus(value.state) ??
    readStatus(value.state) ??
    normalizedStatus(value.phase) ??
    readStatus(value.phase)
  );
};

const readSessionStatus = (event: unknown): string | undefined => {
  if (!isRecord(event)) {
    return undefined;
  }

  return (
    readStatus(event.properties) ??
    readStatus(isRecord(event.properties) ? event.properties.info : undefined) ??
    readStatus(event.status) ??
    readStatus(event.state)
  );
};

export const isQuotaTerminalSessionEvent = (event: unknown): boolean => {
  const status = readSessionStatus(event);
  return status ? TERMINAL_SESSION_STATUSES.has(status) : false;
};

export const isQuotaTerminalTaskEvent = (event: unknown): boolean => {
  if (!isRecord(event) || !isRecord(event.properties) || !isRecord(event.properties.part)) {
    return false;
  }

  const { part } = event.properties;
  if (part.type !== 'tool' || part.tool !== 'task') {
    return false;
  }

  const status = readStatus(part.state) ?? readStatus(part.status);
  return status ? TERMINAL_TASK_STATUSES.has(status) : false;
};

const IMMEDIATE_REFRESH_EVENTS = ['tui.session.select'];
const COMPLETION_REFRESH_EVENTS = [
  'session.idle',
  'session.error',
  { name: 'session.status', shouldRefresh: isQuotaTerminalSessionEvent },
  { name: 'message.part.updated', shouldRefresh: isQuotaTerminalTaskEvent },
];

const hasExpiredQuotaLine = (items: readonly QuotaLine[], nowMs: number): boolean =>
  items.some((line) => (line.kind === 'window' || line.kind === 'pace') && line.resetAtMs <= nowMs);

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const buildInvalidVisibleProvidersWarning = ({
  invalidVisibleProviderEntries,
  fellBackToDefaultVisibleProviders,
}: {
  invalidVisibleProviderEntries: readonly string[];
  fellBackToDefaultVisibleProviders: boolean;
}): string => {
  const fallbackMessage = fellBackToDefaultVisibleProviders
    ? ` Falling back to defaults: ${DEFAULT_VISIBLE_PROVIDERS.join(', ')}.`
    : '';

  return `[quota] Ignoring invalid visibleProviders entries: ${invalidVisibleProviderEntries.join(', ')}. ` +
    `Allowed canonical provider ids: ${ALLOWED_VISIBLE_PROVIDER_IDS.join(', ')}.${fallbackMessage}`;
};

export const refreshQuotaProviders = async ({
  visibleProviders,
  results,
  goConfig,
  getCachedProviderLines,
  shouldContinue,
  onUpdate,
}: {
  visibleProviders: readonly ProviderSpec[];
  results: Map<QuotaProviderId, ProviderResult>;
  goConfig: GoConfig;
  getCachedProviderLines: (providerId: QuotaProviderId, goConfig: GoConfig) => Promise<ProviderFetchResult>;
  shouldContinue: () => boolean;
  onUpdate: () => void;
}): Promise<void> => {
  await Promise.allSettled(
    visibleProviders
      .filter((provider) => results.has(provider.id))
      .map(async (provider) => {
        let result: ProviderFetchResult;
        try {
          result = await getCachedProviderLines(provider.id, goConfig);
        } catch (error: unknown) {
          result = errorMessage(error);
        }
        if (!shouldContinue()) return;

        if (result === undefined) {
          results.delete(provider.id);
        } else {
          results.set(provider.id, result);
        }

        onUpdate();
      }),
  );
};

export const registerQuotaTui = async (api: TuiPluginApi, options: unknown): Promise<void> => {
  const { slots, event: evt, lifecycle } = api;
  const [lines, setLines] = createSignal<QuotaLine[]>([]);
  const [nowMs, setNowMs] = createSignal(Date.now());
  let currentSessionId = '';
  let inFlightVersion = 0;
  let disposed = false;
  let clockTimer: ReturnType<typeof setTimeout> | undefined;

  const {
    options: resolvedOptions,
    diagnostics,
  } = inspectQuotaPluginOptions(options);

  if (diagnostics.invalidVisibleProviderEntries.length > 0) {
    console.warn(buildInvalidVisibleProvidersWarning(diagnostics));
  }

  const {
    displayMode,
    visibleProviders,
    pollIntervalMs,
    minRefreshIntervalMs,
    providerCacheTtlMs,
    providerErrorBackoffMs,
  } = resolvedOptions;
  const expiryRefreshIntervalMs = Math.max(minRefreshIntervalMs, providerCacheTtlMs);
  const { providerCache, getCachedProviderLines } = createQuotaProviderCache({
    providerCacheTtlMs,
    providerErrorBackoffMs,
    fetchProviderLines: (providerId, goConfig) => fetchProviderLines(providerId, goConfig, displayMode, setNowMs),
  });
  let refreshPromise: Promise<void> | undefined;
  let pendingRefreshSource: string | undefined;
  let pendingCacheInvalidation = false;
  let deferredRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRefreshStartedAtMs = 0;
  let lastInvalidatingRefreshStartedAtMs = 0;
  let lastExpiryRefreshAtMs = 0;

  const shouldInvalidateProviderCache = (source?: string): boolean => {
    return source ? PROVIDER_CACHE_INVALIDATION_SOURCES.has(source) : false;
  };

  const queuePendingRefresh = (source?: string, invalidateProviderCache = false) => {
    pendingRefreshSource = pendingRefreshSource ?? source;
    pendingCacheInvalidation = pendingCacheInvalidation || invalidateProviderCache;
  };

  const buildLines = (results: Map<QuotaProviderId, ProviderResult>): QuotaLine[] => {
    const items: QuotaLine[] = [];
    for (const provider of visibleProviders) {
      const result = results.get(provider.id);
      if (result === undefined) continue;
      if (result === null) {
        items.push(headingLine(provider.label));
        items.push(detailTextLine('Refreshing…'));
      } else if (typeof result === 'string') {
        items.push(headingLine(provider.label));
        items.push(detailTextLine(`Unavailable · ${result}`));
      } else {
        if (result[0]?.kind !== 'heading') items.push(headingLine(provider.label));
        items.push(...result);
      }
    }
    return items;
  };

  const requestRefresh = (source?: string, force = false, invalidateProviderCache = shouldInvalidateProviderCache(source)) => {
    if (disposed) return;
    if (refreshPromise) {
      queuePendingRefresh(source, invalidateProviderCache);
      return;
    }

    const now = Date.now();
    const lastRelevantRefreshStartedAtMs = invalidateProviderCache
      ? lastInvalidatingRefreshStartedAtMs
      : lastRefreshStartedAtMs;
    const elapsedMs = lastRelevantRefreshStartedAtMs > 0 ? now - lastRelevantRefreshStartedAtMs : Infinity;
    if (!force && elapsedMs < minRefreshIntervalMs) {
      scheduleDeferredRefresh(source, minRefreshIntervalMs - elapsedMs, invalidateProviderCache);
      return;
    }

    lastRefreshStartedAtMs = now;
    if (invalidateProviderCache) {
      lastInvalidatingRefreshStartedAtMs = now;
      providerCache.clear();
    }

    const promise = refresh(source);
    refreshPromise = promise;
    promise
      .finally(() => {
        refreshPromise = undefined;
        if (disposed || (!pendingRefreshSource && !pendingCacheInvalidation)) return;
        const queuedSource = pendingRefreshSource;
        const queuedCacheInvalidation = pendingCacheInvalidation;
        pendingRefreshSource = undefined;
        pendingCacheInvalidation = false;
        requestRefresh(queuedSource, false, queuedCacheInvalidation);
      })
      .catch((error: unknown) => {
        console.warn(`[quota] unexpected refresh failure: ${errorMessage(error)}`);
      });
  };

  const scheduleClockTick = () => {
    const delayMs = 1000 - (Date.now() % 1000);
    clockTimer = setTimeout(() => {
      if (disposed) return;
      const tickNowMs = Date.now();
      setNowMs(tickNowMs);
      if (hasExpiredQuotaLine(lines(), tickNowMs) && tickNowMs - lastExpiryRefreshAtMs >= expiryRefreshIntervalMs) {
        lastExpiryRefreshAtMs = tickNowMs;
        requestRefresh('quota-window-expired', true);
      }
      scheduleClockTick();
    }, delayMs);
  };

  const refresh = async (_source?: string) => {
    if (disposed) return;
    const currentVersion = ++inFlightVersion;
    const results = new Map<QuotaProviderId, ProviderResult>();
    const goConfig = readGoConfig();

    for (const provider of visibleProviders) {
      if (provider.id === 'opencode-go' && !goConfig) continue;
      results.set(provider.id, providerCache.get(provider.id)?.value ?? null);
    }

    setNowMs(Date.now());
    setLines(buildLines(results));

    await refreshQuotaProviders({
      visibleProviders,
      results,
      goConfig,
      getCachedProviderLines,
      shouldContinue: () => !disposed && currentVersion === inFlightVersion,
      onUpdate: () => setLines(buildLines(results)),
    });
  };

  const scheduleDeferredRefresh = (
    source?: string,
    delayMs: number = minRefreshIntervalMs,
    invalidateProviderCache = shouldInvalidateProviderCache(source),
  ) => {
    queuePendingRefresh(source, invalidateProviderCache);
    if (deferredRefreshTimer) return;
    deferredRefreshTimer = setTimeout(() => {
      deferredRefreshTimer = undefined;
      const queuedSource = pendingRefreshSource;
      const queuedCacheInvalidation = pendingCacheInvalidation;
      pendingRefreshSource = undefined;
      pendingCacheInvalidation = false;
      requestRefresh(queuedSource, false, queuedCacheInvalidation);
    }, delayMs);
  };

  scheduleClockTick();

  const scheduler = createRefreshScheduler({
    subscribe: (eventName, handler) => {
      if (eventName === 'tui.session.select') return evt.on('tui.session.select', handler);
      if (eventName === 'session.idle') return evt.on('session.idle', handler);
      if (eventName === 'session.error') return evt.on('session.error', handler);
      if (eventName === 'session.status') return evt.on('session.status', handler);
      if (eventName === 'message.part.updated') return evt.on('message.part.updated', handler);

      return () => {};
    },
    onRefresh: requestRefresh,
    immediateEvents: IMMEDIATE_REFRESH_EVENTS,
    completionEvents: COMPLETION_REFRESH_EVENTS,
    pollIntervalMs,
  });
  lifecycle.onDispose(() => {
    disposed = true;
    if (clockTimer) clearTimeout(clockTimer);
    if (deferredRefreshTimer) clearTimeout(deferredRefreshTimer);
    scheduler.dispose();
  });

  requestRefresh('initial', true);

  slots.register({
    order: 180,
    slots: {
      sidebar_content: (_ctx, slotInput) => {
        const sessionId = slotSessionId(slotInput);
        if (sessionId && sessionId !== currentSessionId) {
          currentSessionId = sessionId;
          requestRefresh(`session:${sessionId}`);
        }
        return <View getLines={lines} getNowMs={nowMs} api={api} />;
      },
    },
  });
};
