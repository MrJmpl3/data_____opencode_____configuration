import { onCleanup } from 'solid-js';

/**
 * Periodic poller: calls `refetch` every `intervalMs` while `active()` is true.
 * The interval is cleared on Solid `onCleanup`; no manual dispose needed.
 */
export interface PollingOptions {
  refetch: () => void;
  intervalMs: number;
  active?: () => boolean;
}

export const usePolling = ({ refetch, intervalMs, active }: PollingOptions): void => {
  let disposed = false;
  const tick = (): void => {
    if (disposed) return;
    if (active && !active()) return;
    refetch();
  };
  const timer = setInterval(tick, intervalMs);
  onCleanup(() => {
    disposed = true;
    clearInterval(timer);
  });
};
