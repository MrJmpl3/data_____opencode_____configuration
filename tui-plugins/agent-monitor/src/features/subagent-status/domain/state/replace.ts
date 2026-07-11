import type { SubagentChild, SubagentState } from '../types.ts';

import { isTerminalStatus, syncExecutionState } from './maintenance.ts';
import { markChildStatus, upsertRunningChild } from './mutations.ts';
import { createEmptyState } from './core.ts';

/** Reemplaza todos los hijos del estado. Se usa en refresh completo. */
export const replaceChildren = (state: SubagentState, nextChildren: SubagentChild[]): boolean => {
  const nextState = createEmptyState();
  nextState.countedChildIDs = { ...state.countedChildIDs };
  nextState.totalExecuted = state.totalExecuted;
  nextState.updatedAt = state.updatedAt;

  for (const child of nextChildren) {
    upsertRunningChild(nextState, child);
    if (isTerminalStatus(child.status)) {
      markChildStatus(nextState, child.id, child.status, child.endedAt ?? child.updatedAt);
    }
  }

  syncExecutionState(nextState);

  const childrenCountChanged = Object.keys(state.children).length !== Object.keys(nextState.children).length;
  const countedIDsChanged = Object.keys(state.countedChildIDs).length !== Object.keys(nextState.countedChildIDs).length;
  const changed = childrenCountChanged || countedIDsChanged || state.totalExecuted !== nextState.totalExecuted;

  state.children = nextState.children;
  state.countedChildIDs = nextState.countedChildIDs;
  state.totalExecuted = nextState.totalExecuted;
  state.updatedAt = changed ? new Date().toISOString() : state.updatedAt;
  return changed;
};
