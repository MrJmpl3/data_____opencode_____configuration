import { createSignal } from 'solid-js/dist/solid.js';
import type { Accessor } from 'solid-js';

/**
 * Batched signal that coalesces multiple synchronous writes into a single
 * emission.
 *
 * Returns `get` (Accessor for the outer signal — what consumers read), `set`
 * (queues updates via `queueMicrotask`), and `batch` (executes a function
 * and synchronously copies the inner signal to the outer signal once).
 *
 * - `set(v)`: updates the inner signal immediately, then schedules a
 *   microtask to copy the inner value to the outer signal. Multiple `set`
 *   calls between microtask flushes coalesce into one outer emission.
 * - `batch(fn)`: runs `fn` synchronously. All `set` calls within `fn` are
 *   tracked via the inner signal only. After `fn` returns, the inner value
 *   is synchronously copied to the outer signal. No microtask is scheduled.
 */
export function useBatchedSignal<T>(
  initialValue: T,
): [
  get: Accessor<T>,
  set: (value: T) => void,
  batch: (fn: () => void) => void,
] {
  const [inner, setInner] = createSignal(initialValue);
  const [outer, setOuter] = createSignal(initialValue);

  let microtaskQueued = false;
  let batchActive = false;

  /** Copy the inner signal's value to the outer signal. */
  const syncOuter = (): void => {
    setOuter(() => inner());
  };

  const set = (value: T): void => {
    setInner(() => value);
    // When inside batch, skip microtask scheduling — the batch will sync
    // synchronously after fn returns.
    if (batchActive) return;
    if (!microtaskQueued) {
      microtaskQueued = true;
      queueMicrotask(() => {
        microtaskQueued = false;
        // If a batch ran between the time this microtask was queued and now,
        // the outer already has the latest inner value. Syncing again is a
        // no-op because inner hasn't changed since the last sync.
        if (!batchActive) {
          syncOuter();
        }
      });
    }
  };

  const batch = (fn: () => void): void => {
    batchActive = true;
    fn();
    batchActive = false;
    syncOuter();
  };

  return [outer, set, batch];
}
