export const createSerializedTaskQueue = <T>(task: (value: T) => Promise<void>): ((value: T) => Promise<void>) => {
  const queue: T[] = [];
  let active = false;

  const drain = async (): Promise<void> => {
    if (active) return;
    active = true;

    try {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next === undefined) continue;
        await task(next);
      }
    } finally {
      active = false;
    }
  };

  return (value: T): Promise<void> => {
    queue.push(value);
    return drain();
  };
};

export const createCoalescedTaskRunner = <T>(task: (value: T) => Promise<void>): ((value: T) => Promise<void>) => {
  let draining = false;
  let pending: { value: T } | undefined;
  let currentBatch: Promise<void> | undefined;

  const drain = async (): Promise<void> => {
    draining = true;
    try {
      while (pending) {
        const { value: current } = pending;
        pending = undefined;
        await task(current);
      }
    } finally {
      draining = false;
      currentBatch = undefined;
      // Re-entrancy guard — if schedule() was called during drain,
      // pending was set but draining prevented the new cycle from starting.
      // Kick off a fresh drain with the latest value.
      if (pending) {
        currentBatch = drain();
        await currentBatch;
      }
    }
  };

  const schedule = (value: T): Promise<void> => {
    pending = { value };
    if (!draining) {
      currentBatch = drain();
    }
    return currentBatch ?? Promise.resolve();
  };

  return schedule;
};

type BufferedTaskQueueOptions = {
  maxSize?: number;
  maxAgeMs?: number;
};

export const createBufferedTaskQueue = <T>(
  task: (value: T) => Promise<void>,
  options: BufferedTaskQueueOptions = {},
) => {
  const maxSize = options.maxSize ?? 512;
  const maxAgeMs = options.maxAgeMs ?? 15_000;
  const queue: Array<{ value: T; enqueuedAt: number }> = [];
  let ready = false;
  let draining = false;
  let truncated = false;

  const compactIfStale = (now: number): void => {
    if (queue.length === 0) return;
    if (now - queue[0].enqueuedAt < maxAgeMs) return;

    queue.length = 0;
    truncated = true;
  };

  const drain = async (): Promise<void> => {
    if (!ready || draining) return;

    draining = true;
    try {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (!entry) continue;

        await task(entry.value);
      }
    } finally {
      draining = false;
    }
  };

  return {
    push: (value: T): void => {
      const now = Date.now();
      compactIfStale(now);
      queue.push({ value, enqueuedAt: now });

      if (queue.length > maxSize) {
        queue.splice(0, queue.length - maxSize);
        truncated = true;
      }

      if (ready) void drain();
    },
    size: (): number => {
      return queue.length;
    },
    wasTruncated: (): boolean => {
      return truncated;
    },
    markReady: (): Promise<void> => {
      compactIfStale(Date.now());
      ready = true;
      return drain();
    },
  };
};
