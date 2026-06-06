export interface RefreshSchedulerConfig {
  subscribe: (eventName: string, handler: () => void) => () => void;
  onRefresh: (source?: string) => void;
  immediateEvents: string[];
  completionEvents: string[];
  pollIntervalMs?: number;
  refreshDelayMs?: number;
}

const DEFAULT_REFRESH_DELAY_MS = 300;
const DEFAULT_POLL_INTERVAL_MS = 10 * 60_000;

export interface RefreshScheduler {
  scheduleRefresh(extraDelays?: number[], source?: string): void;
  dispose(): void;
}

export const createRefreshScheduler = ({
  subscribe,
  onRefresh,
  immediateEvents,
  completionEvents,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  refreshDelayMs = DEFAULT_REFRESH_DELAY_MS,
}: RefreshSchedulerConfig): RefreshScheduler => {
  let disposed = false;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingDueAtMs = 0;
  let pendingSource: string | undefined;

  const pollTimer =
    pollIntervalMs > 0
      ? setInterval(() => {
          if (disposed) return;
          onRefresh('poll');
        }, pollIntervalMs)
      : undefined;

  const scheduleRefresh = (extraDelays: number[] = [], source?: string) => {
    if (disposed) return;

    const delay = refreshDelayMs + (extraDelays[0] ?? 0);
    const dueAtMs = Date.now() + delay;

    if (pendingTimer && pendingDueAtMs <= dueAtMs) {
      return;
    }

    pendingSource = source ?? pendingSource;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingDueAtMs = dueAtMs;
    pendingTimer = setTimeout(() => {
      if (disposed) return;
      const refreshSource = pendingSource;
      pendingTimer = undefined;
      pendingDueAtMs = 0;
      pendingSource = undefined;
      onRefresh(refreshSource);
    }, delay);
  };

  const bindEvents = (eventNames: string[], extraDelays: number[] = []) => {
    return eventNames.map((eventName) => subscribe(eventName, () => scheduleRefresh(extraDelays, eventName)));
  };

  const unsubscribers = [...bindEvents(immediateEvents), ...bindEvents(completionEvents, [250])];

  const dispose = () => {
    disposed = true;
    if (pollTimer) clearInterval(pollTimer);
    for (const unsubscribe of unsubscribers) unsubscribe();
    if (pendingTimer) clearTimeout(pendingTimer);
  };

  return {
    scheduleRefresh,
    dispose,
  };
};
