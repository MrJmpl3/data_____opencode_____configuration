import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';

import { useClockTicker } from '../../../../src/kit/use-clock-ticker.ts';
import { usePolling } from '../../../../src/kit/use-polling.ts';

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls refetch on each tick at the given interval', () => {
    const refetch = vi.fn();
    createRoot((dispose) => {
      usePolling({ refetch, intervalMs: 1000 });

      vi.advanceTimersByTime(1000);
      expect(refetch).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(refetch).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(1000);
      expect(refetch).toHaveBeenCalledTimes(3);

      dispose();
    });
  });

  it('stops calling refetch after the owning root is disposed', () => {
    const refetch = vi.fn();
    createRoot((dispose) => {
      usePolling({ refetch, intervalMs: 1000 });

      vi.advanceTimersByTime(1000);
      expect(refetch).toHaveBeenCalledTimes(1);

      dispose();
    });

    vi.advanceTimersByTime(5000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('skips refetch when active() returns false and resumes when true', () => {
    const refetch = vi.fn();
    let active = false;
    createRoot((dispose) => {
      usePolling({
        refetch,
        intervalMs: 1000,
        active: () => active,
      });

      vi.advanceTimersByTime(3000);
      expect(refetch).toHaveBeenCalledTimes(0);

      active = true;
      vi.advanceTimersByTime(1000);
      expect(refetch).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(refetch).toHaveBeenCalledTimes(2);

      dispose();
    });
  });
});

describe('useClockTicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onTick at the given interval while active is true', () => {
    const onTick = vi.fn();
    createRoot((dispose) => {
      useClockTicker({ active: () => true, onTick, intervalMs: 1000 });

      // useClockTicker aligns to wall-clock boundaries; with a 1000ms interval
      // and faked Date.now, the first tick fires within one alignment window.
      vi.advanceTimersByTime(1100);
      expect(onTick).toHaveBeenCalled();

      const callsAfterFirst = onTick.mock.calls.length;
      vi.advanceTimersByTime(1000);
      expect(onTick.mock.calls.length).toBeGreaterThan(callsAfterFirst);

      dispose();
    });
  });

  it('does not fire onTick when active is false', () => {
    const onTick = vi.fn();
    createRoot((dispose) => {
      useClockTicker({ active: () => false, onTick, intervalMs: 1000 });

      vi.advanceTimersByTime(3000);
      expect(onTick).not.toHaveBeenCalled();

      dispose();
    });
  });

  it('stops firing after the returned dispose is called', () => {
    const onTick = vi.fn();
    createRoot((dispose) => {
      const stopTicker = useClockTicker({ active: () => true, onTick, intervalMs: 1000 });

      vi.advanceTimersByTime(1100);
      const callsBeforeDispose = onTick.mock.calls.length;

      stopTicker();
      vi.advanceTimersByTime(3000);
      expect(onTick.mock.calls.length).toBe(callsBeforeDispose);

      dispose();
    });
  });
});
