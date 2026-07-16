import { describe, expect, it, vi } from 'vitest';

import {
  createPromptFocusController,
  resolveSidebarReturnFocusAction,
} from '../../../../src/features/subagent-status/runtime/session/focus.ts';
import { createRuntimeSessionScopeHelpers } from '../../../../src/features/subagent-status/runtime/session/scope.ts';
import {
  navigateToChildSession,
  resolveSessionSlotTransition,
} from '../../../../src/features/subagent-status/runtime/session/navigate.ts';
import { createSessionClientBoundary } from '../../../../src/features/subagent-status/runtime/session/session-client.ts';

describe('session runtime boundary branches', () => {
  it('classifies missing, unrelated, and return focus transitions', () => {
    const pending = { parentSessionID: 'ses_parent', childSessionID: 'ses_child', childRowID: 'row' };
    expect(resolveSidebarReturnFocusAction({ pendingSidebarRefocus: pending })).toBe('none');
    expect(
      resolveSidebarReturnFocusAction({
        pendingSidebarRefocus: pending,
        previousRouteSessionID: 'ses_parent',
        routeSessionID: 'ses_parent',
      }),
    ).toBe('none');
    expect(
      resolveSidebarReturnFocusAction({
        pendingSidebarRefocus: pending,
        previousRouteSessionID: 'ses_child',
        routeSessionID: 'ses_parent',
      }),
    ).toBe('focus-prompt');
    expect(
      resolveSidebarReturnFocusAction({
        pendingSidebarRefocus: pending,
        previousRouteSessionID: 'ses_child',
        routeSessionID: 'ses_other',
      }),
    ).toBe('clear-pending');
    expect(resolveSessionSlotTransition('', {}, false)).toEqual({
      nextSessionId: '',
      resetState: false,
      shouldRefresh: false,
    });
    expect(resolveSessionSlotTransition('ses_parent', {}, true).resetState).toBe(true);
  });

  it('retries prompt focus and forwards both ref shapes', () => {
    const scheduled: (() => void)[] = [];
    const focus = vi.fn();
    const controller = createPromptFocusController((callback) => scheduled.push(callback));
    const refObject: { current?: unknown } = {};
    const forwarded = vi.fn();
    controller.composePromptRef(refObject as never)(undefined);
    controller.composePromptRef(forwarded)({ focus } as never);
    expect(refObject.current).toBeUndefined();
    controller.rememberSidebarChildNavigation({
      parentSessionID: 'ses_parent',
      childSessionID: 'ses_child',
      childRowID: 'row',
    });
    controller.handleRouteChange('ses_child');
    controller.handleRouteChange('ses_parent');
    scheduled.shift()?.();
    expect(focus).toHaveBeenCalledOnce();
    expect(forwarded).toHaveBeenCalledWith({ focus });
  });

  it('bounds startup events and stops replay when the session becomes stale', async () => {
    let session = 'ses_parent';
    const syncState = vi.fn(async () => undefined);
    const scope = createRuntimeSessionScopeHelpers({
      getSessionId: () => session,
      setSessionId: (value) => {
        session = value;
      },
      syncState,
      createRefreshMeta: () => ({ source: 'refresh', bufferedEventCount: 0 }),
    });
    for (let index = 0; index < 513; index += 1) scope.bufferStartupScopedEvent('ses_parent', index);
    const replayed: unknown[] = [];
    await scope.replayDeferredStartupScopedEvents(
      'ses_parent',
      scope.currentSessionToken(),
      async (event) => {
        replayed.push(event);
        session = 'ses_other';
      },
      () => false,
    );
    expect(replayed).toEqual([1]);
    expect(scope.isBufferingStartupScopedEvents()).toBe(true);
    scope.finishStartupScopedEventBuffering();
    expect(scope.isBufferingStartupScopedEvents()).toBe(false);
  });

  it('navigates only to session targets and normalizes absent client APIs', async () => {
    const navigate = vi.fn();
    const api = { route: { navigate } } as never;
    expect(navigateToChildSession(api, { id: 'tool-1' })).toBe(false);
    expect(navigateToChildSession(api, { id: 'work', targetSessionID: 'ses_child' })).toBe(true);
    expect(navigate).toHaveBeenCalledWith('session', { sessionID: 'ses_child' });
    const client = createSessionClientBoundary({ client: {}, state: { path: { directory: '/workspace' } } });
    await expect(client.listChildren('ses_parent')).resolves.toBeUndefined();
    await expect(client.readStatusMap()).resolves.toEqual({});
    await expect(client.readMessages('ses_parent')).resolves.toEqual([]);
  });
});
