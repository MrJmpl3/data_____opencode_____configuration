import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useClockTicker } from '../../../../src/kit/use-clock-ticker.ts';
import { usePolling } from '../../../../src/kit/use-polling.ts';

describe('final scheduling and cleanup branches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T10:00:00.250Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('reschedules inactive clock ticks without invoking callbacks, then resumes', async () => {
    const [active, setActive] = createSignal(true);
    const onTick = vi.fn();
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = useClockTicker({ active, intervalMs: 1000, onTick });
      return rootDispose;
    });
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);
    setActive(false);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);
    dispose();
    vi.advanceTimersByTime(2000);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('does not invoke polling after cleanup when active callback throws', () => {
    const refetch = vi.fn(() => {
      throw new Error('callback failed');
    });
    let dispose!: () => void;
    createRoot((rootDispose) => {
      usePolling({ refetch, intervalMs: 1000 });
      dispose = rootDispose;
    });
    expect(() => vi.advanceTimersByTime(1000)).toThrow('callback failed');
    dispose();
    vi.advanceTimersByTime(1000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
