export function createRefreshScheduler({ api, onRefresh, immediateEvents, completionEvents }) {
  const pendingTimers = new Set();
  const REFRESH_DELAYS_MS = [150, 600];
  let disposed = false;

  function scheduleRefresh(extraDelays = []) {
    for (const delay of [...REFRESH_DELAYS_MS, ...extraDelays]) {
      const timer = setTimeout(() => {
        if (disposed) return;
        pendingTimers.delete(timer);
        onRefresh();
      }, delay);
      pendingTimers.add(timer);
    }
  }

  function bindEvents(eventNames, extraDelays = []) {
    return eventNames.map((eventName) =>
      api.event.on(eventName, () => scheduleRefresh(extraDelays)),
    );
  }

  const unsubscribers = [
    ...bindEvents(immediateEvents),
    ...bindEvents(completionEvents, [5000]),
  ];

  function dispose() {
    disposed = true;
    for (const unsub of unsubscribers) unsub();
    for (const timer of pendingTimers) clearTimeout(timer);
    pendingTimers.clear();
  }

  return {
    scheduleRefresh,
    dispose,
  };
}
