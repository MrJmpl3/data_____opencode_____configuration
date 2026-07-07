import { onCleanup } from 'solid-js';

/**
 * 1Hz clock ticker. Fires `onTick(nowMs)` every `intervalMs` while `active()`
 * is true, with each tick aligned to the wall-clock boundary so multiple
 * components that call this stay in sync. The timer is cleared on Solid
 * `onCleanup`; no manual dispose needed.
 *
 * Inlined from main's `@opencode-ai/tui-kit/runtime` useClockTicker — the upstream
 * version uses `createRoot` to host an internal `createEffect` for
 * false→true transition handling; the quota section doesn't need that because
 * the slot is always mounted when the section is visible.
 */
export interface ClockTickerOptions {
  active: () => boolean;
  onTick: (nowMs: number) => void;
  intervalMs?: number;
}

export const useClockTicker = ({ active, onTick, intervalMs = 1000 }: ClockTickerOptions): void => {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const alignedDelay = (): number => intervalMs - (Date.now() % intervalMs);

  const scheduleTick = (): void => {
    if (disposed) return;
    timer = setTimeout(() => {
      if (disposed) return;
      if (active()) onTick(Date.now());
      scheduleTick();
    }, alignedDelay());
  };

  scheduleTick();

  onCleanup(() => {
    disposed = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  });
};
