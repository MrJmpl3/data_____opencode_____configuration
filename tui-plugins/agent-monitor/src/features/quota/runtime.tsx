/** @jsxImportSource @opentui/solid */
// Entry point del feature quota. Lee config file, registra el sidebar slot
// con el componente QuotaSection que muestra el consumo de cada API provider.

import type { TuiPlugin, TuiPluginApi } from '@opencode-ai/plugin/tui';

import { QuotaSection } from './ui/components/quota-section.tsx';
import {
  ALLOWED_PROVIDER_IDS,
  defaultQuotaSectionOptions,
  resolveVisibleProviderIdsWithDiagnostics,
} from './domain/options.ts';
import { readQuotaConfig } from './infrastructure/providers/config.ts';
import { isRecord } from '../../kit/coercion.ts';

export const readSessionIdFromEvent = (payload: unknown): string | undefined => {
  if (!isRecord(payload)) return undefined;
  const candidates: readonly unknown[] = [
    payload.sessionID,
    payload.sessionId,
    isRecord(payload.properties) ? payload.properties.sessionID : undefined,
    isRecord(payload.properties) ? payload.properties.sessionId : undefined,
    isRecord(payload.info) ? payload.info.sessionID : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
};

export interface EventSubscriptionOptions {
  events: TuiPluginApi['event'];
  lifecycle: TuiPluginApi['lifecycle'];
  eventNames: readonly string[];
  onTrigger: (eventName: string, sessionId: string | undefined) => void;
}

/** Subscribes to each event in `eventNames`; on fire, calls `onTrigger`
 *  with the event name and the session id (if the payload carries one).
 *  Disposes everything via `lifecycle.onDispose`. */
export const subscribeRefreshTriggers = ({
  events,
  lifecycle,
  eventNames,
  onTrigger,
}: EventSubscriptionOptions): { unsubscribe: () => void } => {
  const unsubscribers: (() => void)[] = [];
  for (const eventName of eventNames) {
    const handler = (payload: unknown): void => {
      onTrigger(eventName, readSessionIdFromEvent(payload));
    };
    // ponytail: the event bus types are strict, but the string union above
    // matches the documented opencode events. Cast keeps the public surface
    // honest without an exhaustive event-name enum.
    unsubscribers.push(events.on(eventName as Parameters<typeof events.on>[0], handler));
  }
  const unsubscribe = (): void => {
    for (const fn of unsubscribers) fn();
  };
  lifecycle.onDispose(unsubscribe);
  return { unsubscribe };
};

/**
 * Registers the `sidebar_content` slot. The plugin is quota-only — the host
 * renders the QuotaSection directly, no section router, no other sections.
 */
export const registerSidebarTui: TuiPlugin = async (api: TuiPluginApi) => {
  const fileConfig = readQuotaConfig();
  const fileOptions = fileConfig?.options;

  // ponytail: los numéricos pasan por `resolveNumericOptions` que ya clampa
  // no-finitos; los strings/listas caen tal cual y se filtran en
  // `resolveVisibleProviderIdsWithDiagnostics`. Spread plano alcanza.
  const options = { ...defaultQuotaSectionOptions, ...fileOptions };

  const resolution = resolveVisibleProviderIdsWithDiagnostics(options.visibleProviders);
  if (resolution.invalidVisibleProviderEntries.length > 0) {
    const fallback = resolution.fellBackToDefaultVisibleProviders
      ? ` Falling back to defaults: ${resolution.visibleProviders.join(', ')}.`
      : '';
    console.warn(
      `[agent-monitor] Ignoring invalid visibleProviders entries: ${resolution.invalidVisibleProviderEntries.join(', ')}. ` +
        `Allowed canonical provider ids: ${ALLOWED_PROVIDER_IDS.join(', ')}.${fallback}`,
    );
  }

  api.slots.register({
    order: 120,
    slots: {
      sidebar_content: () => <QuotaSection api={api} options={options} />,
    },
  });
};
