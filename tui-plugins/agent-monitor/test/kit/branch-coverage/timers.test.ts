import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useClockTicker } from '../../../src/kit/use-clock-ticker.ts';
import { usePolling } from '../../../src/kit/use-polling.ts';

describe('kit timer boundary branches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T10:00:00.250Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('skips inactive aligned ticks and resumes with an immediate activation tick', async () => {
    const [active, setActive] = createSignal(false);
    const ticks = vi.fn();
    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = useClockTicker({ active, intervalMs: 1000, onTick: ticks });
      return rootDispose;
    });
    vi.advanceTimersByTime(750);
    expect(ticks).not.toHaveBeenCalled();
    setActive(true);
    vi.advanceTimersByTime(1000);
    expect(ticks).toHaveBeenCalledOnce();
    setActive(false);
    vi.advanceTimersByTime(1000);
    expect(ticks).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('polls without an active gate and does not poll while the gate is false', () => {
    const always = vi.fn();
    const gated = vi.fn();
    let dispose!: () => void;
    createRoot((rootDispose) => {
      usePolling({ refetch: always, intervalMs: 100, active: undefined });
      const [active] = createSignal(false);
      usePolling({ refetch: gated, intervalMs: 100, active });
      dispose = rootDispose;
    });
    vi.advanceTimersByTime(250);
    expect(always).toHaveBeenCalledTimes(2);
    expect(gated).not.toHaveBeenCalled();
    dispose();
    vi.advanceTimersByTime(200);
    expect(always).toHaveBeenCalledTimes(2);
  });
});
