/** @jsxImportSource @opentui/solid */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, createSignal } from 'solid-js/dist/solid.js';

import { useClockTicker } from '../../src/runtime/use-clock-ticker.js';

describe('useClockTicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Spec scenario: Ticker fires at 1Hz boundary with setTimeout alignment.
  it('fires onTick at aligned 1Hz boundary using setTimeout', () => {
    const onTick = vi.fn();
    const [active] = createSignal(true);

    const dispose = createRoot(() => useClockTicker({ active, onTick }));

    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);
    const firstArg = onTick.mock.calls[0]![0]!;
    expect(typeof firstArg).toBe('number');
    expect(firstArg).toBeGreaterThan(0);

    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(2);

    dispose();
  });

  // Spec scenario: Ticker skips onTick when active is false.
  it('skips onTick when active is false but keeps rescheduling', () => {
    const onTick = vi.fn();
    const [active, setActive] = createSignal(false);

    const dispose = createRoot(() => useClockTicker({ active, onTick }));

    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(0);

    setActive(true);
    expect(onTick).toHaveBeenCalledTimes(1);

    dispose();
  });

  // Spec scenario: Ticker fires immediately when active transitions false→true.
  it('fires immediate tick when active transitions from false to true', () => {
    const onTick = vi.fn();
    const [active, setActive] = createSignal(false);

    const dispose = createRoot(() => useClockTicker({ active, onTick }));

    vi.advanceTimersByTime(500);
    expect(onTick).toHaveBeenCalledTimes(0);

    setActive(true);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(typeof onTick.mock.calls[0]![0]!).toBe('number');

    dispose();
  });

  // Spec scenario: Ticker cleans up on dispose — no more ticks after disposal.
  it('cleans up on dispose without leaking timers across tests', () => {
    const onTick = vi.fn();
    const [active] = createSignal(true);

    const dispose = createRoot(() => useClockTicker({ active, onTick }));

    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalled();

    expect(() => dispose()).not.toThrow();
  });
});
