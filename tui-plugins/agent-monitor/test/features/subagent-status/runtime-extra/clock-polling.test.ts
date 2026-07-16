import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useClockTicker } from '../../../../src/kit/use-clock-ticker.ts';
import { usePolling } from '../../../../src/kit/use-polling.ts';

describe('runtime timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T10:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('ticks immediately on activation and cancels its aligned timeout on dispose', async () => {
    const [active, setActive] = createSignal(false);
    const onTick = vi.fn();
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = useClockTicker({ active, intervalMs: 1000, onTick });
      return rootDispose;
    });

    setActive(true);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);
    dispose();
    vi.advanceTimersByTime(2000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('polls only while active and releases the interval with Solid cleanup', () => {
    const refetch = vi.fn();
    let setActive!: (value: boolean) => void;
    let dispose!: () => void;
    createRoot((rootDispose) => {
      const [active, update] = createSignal(false);
      setActive = update;
      usePolling({ refetch, intervalMs: 1000, active });
      dispose = rootDispose;
    });

    vi.advanceTimersByTime(2000);
    expect(refetch).not.toHaveBeenCalled();
    setActive(true);
    vi.advanceTimersByTime(1000);
    expect(refetch).toHaveBeenCalledTimes(1);
    setActive(false);
    vi.advanceTimersByTime(1000);
    expect(refetch).toHaveBeenCalledTimes(1);
    dispose();
    vi.advanceTimersByTime(2000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
