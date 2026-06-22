import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { debugLog, setDebugEnabled } from '../src/shared/debug.ts';

describe('debug flag', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    setDebugEnabled(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call console.log when debug is disabled', () => {
    setDebugEnabled(false);
    debugLog('hello', 42);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('calls console.log when debug is enabled', () => {
    setDebugEnabled(true);
    debugLog('hello', 42);
    expect(console.log).toHaveBeenCalledWith('hello', 42);
  });

  it('toggles from disabled to enabled and back', () => {
    setDebugEnabled(false);
    debugLog('one');
    expect(console.log).not.toHaveBeenCalled();

    setDebugEnabled(true);
    debugLog('two');
    expect(console.log).toHaveBeenCalledWith('two');

    setDebugEnabled(false);
    debugLog('three');
    expect(console.log).toHaveBeenCalledTimes(1); // only the 'two' call
  });

  it('accepts multiple arguments spread to console.log', () => {
    setDebugEnabled(true);
    debugLog('a', 1, { key: 'val' });
    expect(console.log).toHaveBeenCalledWith('a', 1, { key: 'val' });
  });

  it('starts disabled by default', async () => {
    vi.resetModules();
    const { debugLog: freshDebugLog } = await import('../src/shared/debug.ts');
    freshDebugLog('should not appear');
    expect(console.log).not.toHaveBeenCalled();
  });
});
