export interface RefreshSchedulerConfig {
  subscribe: (eventName: string, handler: () => void) => () => void;
  onRefresh: (source?: string) => void;
  immediateEvents: string[];
  completionEvents: string[];
}

// --- event-driven refresh scheduler ---
// Replaces polling with subscribe-based event binding.
// Events trigger staggered timers that call onRefresh.
// Clean dispose ensures no stale callbacks after unmount.

export interface RefreshScheduler {
  scheduleRefresh(extraDelays?: number[], source?: string): void;
  dispose(): void;
}

export function createRefreshScheduler({
  subscribe,
  onRefresh,
  immediateEvents,
  completionEvents,
}: RefreshSchedulerConfig): RefreshScheduler {
  // --- pendingTimers as Set prevents double-clear ---
  // Each timer removes itself on fire. dispose() iterates survivors.
  // Set handles the edge case where a timer fires during clearTimeout.

  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  // --- staggered base delays prevent thundering herd ---
  // 150ms: fast first refresh for immediate feedback.
  // 600ms: catches late state changes from concurrent events.

  const REFRESH_DELAYS_MS = [150, 600];
  let disposed = false;

  // --- event-driven refresh reduces wasted requests ---
  // Old polling queried on a fixed interval regardless of activity.
  // Now refreshes only when relevant events fire, cutting unnecessary calls.

  function scheduleRefresh(extraDelays: number[] = [], source?: string) {
    for (const delay of [...REFRESH_DELAYS_MS, ...extraDelays]) {
      const timer = setTimeout(() => {
        if (disposed) return;
        pendingTimers.delete(timer);
        onRefresh(source);
      }, delay);
      pendingTimers.add(timer);
    }
  }

  // --- bindEvents maps event names to refresh triggers ---
  // completionEvents get +250ms extra delay so the LLM finishes settling
  // before fetching updated quota. Prevents reading stale intermediate state.

  function bindEvents(eventNames: string[], extraDelays: number[] = []) {
    return eventNames.map((eventName) =>
      subscribe(eventName, () => scheduleRefresh(extraDelays, eventName)),
    );
  }

  const unsubscribers = [
    ...bindEvents(immediateEvents),
    ...bindEvents(completionEvents, [250]),
  ];

  // --- disposed flag prevents onRefresh after unmount ---
  // unsubscribers tear down event bindings, pendingTimers.forEach clears
  // any timers that haven't fired yet. Triple-lock cleanup.

  function dispose() {
    disposed = true;
    for (const unsub of unsubscribers) unsub();
    pendingTimers.forEach((timer) => clearTimeout(timer));
  }

  return {
    scheduleRefresh,
    dispose,
  };
}
