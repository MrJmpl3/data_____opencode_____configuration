import { describe, expect, it, vi } from 'vitest';

import { focusPromptWithDeferredRetry, resolveSidebarReturnFocusAction } from '../src/runtime/focus.ts';

describe('runtime focus helpers', () => {
  it('returns focus-prompt only when navigating back from child to parent', () => {
    expect(
      resolveSidebarReturnFocusAction({
        pendingSidebarRefocus: {
          parentSessionID: 'ses_parent',
          childSessionID: 'ses_child',
          childRowID: 'tool:delegate_1',
        },
        previousRouteSessionID: 'ses_child',
        routeSessionID: 'ses_parent',
      }),
    ).toBe('focus-prompt');
  });

  it('clears pending focus when navigation goes somewhere else', () => {
    expect(
      resolveSidebarReturnFocusAction({
        pendingSidebarRefocus: {
          parentSessionID: 'ses_parent',
          childSessionID: 'ses_child',
          childRowID: 'tool:delegate_1',
        },
        previousRouteSessionID: 'ses_child',
        routeSessionID: 'ses_other',
      }),
    ).toBe('clear-pending');
  });

  it('retries focusing the prompt once when the first attempt fails', () => {
    const attempts = vi.fn<() => boolean>().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const scheduled: Array<() => void> = [];

    focusPromptWithDeferredRetry(attempts, (callback) => {
      scheduled.push(callback);
    });

    expect(attempts).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);

    scheduled.shift()?.();
    expect(attempts).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);

    scheduled.shift()?.();
    expect(attempts).toHaveBeenCalledTimes(2);
  });
});
