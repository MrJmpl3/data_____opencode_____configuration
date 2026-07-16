import type { TuiPromptRef } from '@opencode-ai/plugin/tui';

export type SidebarReturnFocusAction = 'none' | 'clear-pending' | 'focus-prompt';

export type PendingSidebarRefocus = {
  parentSessionID: string;
  childSessionID: string;
  childRowID: string;
};

export type PromptRefProp =
  | ((ref: TuiPromptRef | undefined) => void)
  | { current?: TuiPromptRef | undefined }
  | undefined;

const scheduleDeferred = (callback: () => void): void => {
  setTimeout(callback, 0);
};

export const resolveSidebarReturnFocusAction = (input: {
  pendingSidebarRefocus?: PendingSidebarRefocus;
  previousRouteSessionID?: string;
  routeSessionID?: string;
}): SidebarReturnFocusAction => {
  const { pendingSidebarRefocus, previousRouteSessionID, routeSessionID } = input;
  if (!pendingSidebarRefocus || previousRouteSessionID === routeSessionID) return 'none';
  if (
    previousRouteSessionID === pendingSidebarRefocus.childSessionID &&
    routeSessionID === pendingSidebarRefocus.parentSessionID
  )
    return 'focus-prompt';
  if (routeSessionID === undefined) return 'none';
  if (routeSessionID !== pendingSidebarRefocus.childSessionID) return 'clear-pending';
  return 'none';
};

export const focusPromptWithDeferredRetry = (
  tryFocusPrompt: () => boolean,
  schedule: (callback: () => void) => void = scheduleDeferred,
): void => {
  schedule(() => {
    if (tryFocusPrompt()) return;
    schedule(() => {
      void tryFocusPrompt();
    });
  });
};

export type PromptFocusController = ReturnType<typeof createPromptFocusController>;

export const createPromptFocusController = (schedule: (callback: () => void) => void = scheduleDeferred) => {
  let previousRouteSessionID: string | undefined;
  let pendingSidebarRefocus: PendingSidebarRefocus | undefined;
  let activePromptRef: TuiPromptRef | undefined;

  const composePromptRef =
    (slotRef: PromptRefProp) =>
    (ref: TuiPromptRef | undefined): void => {
      activePromptRef = ref;
      if (typeof slotRef === 'function') slotRef(ref);
      else if (slotRef && 'current' in slotRef) slotRef.current = ref;
    };

  const focusActivePrompt = (): void => {
    focusPromptWithDeferredRetry(() => {
      if (!activePromptRef) return false;
      activePromptRef.focus();
      return true;
    }, schedule);
  };

  const handleRouteChange = (routeSessionID: string | undefined): void => {
    const action = resolveSidebarReturnFocusAction({ pendingSidebarRefocus, previousRouteSessionID, routeSessionID });
    if (action === 'focus-prompt') {
      pendingSidebarRefocus = undefined;
      focusActivePrompt();
    } else if (action === 'clear-pending') {
      pendingSidebarRefocus = undefined;
    }
    if (routeSessionID !== undefined) previousRouteSessionID = routeSessionID;
  };

  return {
    composePromptRef,
    handleRouteChange,
    rememberSidebarChildNavigation: (input: PendingSidebarRefocus): void => {
      pendingSidebarRefocus = input;
    },
  };
};
