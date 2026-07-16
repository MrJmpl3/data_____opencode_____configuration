import { describe, expect, it, vi } from 'vitest';
import { createSignal, createRoot } from 'solid-js';

import { fmtDuration } from '../../../src/kit/format.ts';
import { useClockTicker } from '../../../src/kit/use-clock-ticker.ts';

describe('kit formatting and ticker boundaries', () => {
  it('formats zero, seconds, minutes, hours, and days', () => {
    expect(fmtDuration()).toBe('0s');
    expect(fmtDuration(0)).toBe('0s');
    expect(fmtDuration(5)).toBe('5s');
    expect(fmtDuration(65)).toBe('1m5s');
    expect(fmtDuration(3665)).toBe('1h1m5s');
    expect(fmtDuration(90065)).toBe('1d1h1m5s');
  });

  it('fires immediately after activation, skips inactive ticks, and disposes timers', async () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const dispose = createRoot((disposeRoot) => {
      const [active] = createSignal(true);
      const tickerDispose = useClockTicker({ active, intervalMs: 1000, onTick });
      return () => {
        tickerDispose();
        disposeRoot();
      };
    });

    vi.advanceTimersByTime(1001);
    expect(onTick).toHaveBeenCalledTimes(1);
    dispose();
    vi.advanceTimersByTime(2000);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
