import { createEffect, createRoot } from 'solid-js/dist/solid.js';
import type { Accessor } from 'solid-js';

/**
 * Aligned 1Hz clock ticker using setTimeout alignment.
 *
 * Reschedules itself after each tick. When `active()` is false, skips `onTick`
 * but continues rescheduling so the clock resumes within one boundary after
 * re-activation. When `active()` transitions from false to true, fires an
 * immediate synchronous tick. Returns a dispose function that cancels all
 * pending timeouts and destroys the Solid root.
 */
export function useClockTicker(options: {
  active: Accessor<boolean>;
  intervalMs?: number;
  onTick: (nowMs: number) => void;
}): () => void {
  const { active, intervalMs = 1000, onTick } = options;

  return createRoot((disposeRoot: () => void) => {
    let wasActive = active();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const alignedDelay = (): number => intervalMs - (Date.now() % intervalMs);

    const scheduleTick = (): void => {
      if (disposed) return;
      timer = setTimeout(() => {
        if (disposed) return;
        scheduleTick();
        if (!active()) return;
        onTick(Date.now());
      }, alignedDelay());
    };

    createEffect(() => {
      const now = active();
      if (now && !wasActive) {
        onTick(Date.now());
      }
      wasActive = now;
    });

    scheduleTick();

    return () => {
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      disposeRoot();
    };
  });
}
