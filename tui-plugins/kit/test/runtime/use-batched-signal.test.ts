/** @jsxImportSource @opentui/solid */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, createComputed } from 'solid-js/dist/solid.js';

import { useBatchedSignal } from '../../src/runtime/use-batched-signal.js';

/** Flush all pending microtasks. */
const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(resolve));

describe('useBatchedSignal', () => {
  // Spec scenario: set coalesces multiple writes into one emission.
  it('coalesces multiple set() calls into one emission after microtask drain', async () => {
    const [get, set] = useBatchedSignal(0);

    // Track how many times a reactive computation reads `get()`.
    let readCount = 0;
    const dispose = createRoot((disposeRoot) => {
      createComputed(() => {
        void get();
        readCount += 1;
      });
      return disposeRoot;
    });

    // Initial read: 1
    const initialReads = readCount;

    // Multiple synchronous sets — should batch into one emission.
    set(1);
    set(2);
    set(3);

    // Before microtask drain, the outer signal still holds the initial value.
    expect(get()).toBe(0);

    await flushMicrotasks();

    // After microtask drain, one emission.
    expect(get()).toBe(3);
    expect(readCount).toBe(initialReads + 1); // exactly one additional re-computation

    dispose();
  });

  // Spec scenario: batch emits exactly one update after fn returns.
  it('batch emits exactly one update after fn returns', () => {
    const [get, set, batch] = useBatchedSignal<number[]>([]);

    let readCount = 0;
    const dispose = createRoot((disposeRoot) => {
      createComputed(() => {
        void get();
        readCount += 1;
      });
      return disposeRoot;
    });

    const initialReads = readCount;

    batch(() => {
      set([1]);
      set([1, 2]);
      set([1, 2, 3]);
    });

    // After batch returns, the outer signal is updated synchronously.
    expect(get()).toEqual([1, 2, 3]);
    expect(readCount).toBe(initialReads + 1); // exactly one re-computation

    dispose();
  });

  // Spec scenario: batch uses sync signal, set uses microtask signal.
  it('batch updates synchronously while set defers to microtask', async () => {
    const [get, set, batch] = useBatchedSignal(0);

    let readCount = 0;
    const dispose = createRoot((disposeRoot) => {
      createComputed(() => {
        void get();
        readCount += 1;
      });
      return disposeRoot;
    });

    const initialReads = readCount;

    // batch writes are synchronous.
    batch(() => set(42));
    expect(get()).toBe(42); // sync after batch

    // set writes are deferred.
    set(99);
    expect(get()).toBe(42); // NOT 99 yet — microtask hasn't fired
    expect(readCount).toBe(initialReads + 1); // only the batch caused a recomputation

    await flushMicrotasks();

    // After microtask drain, the deferred set applies.
    expect(get()).toBe(99);
    expect(readCount).toBe(initialReads + 2); // one more recomputation

    dispose();
  });
});
