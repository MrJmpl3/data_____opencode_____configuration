import { clearPurgedSession, isRealSessionChild } from '../state/core.ts';
import { cloneState } from '../../../../kit/clone.ts';
import {
  isTerminalStatus,
  normalizeChild,
  pruneOrphanedSyntheticRunningChildren,
  pruneTerminalChildren,
} from '../state/maintenance.ts';
import { markChildStatus, upsertRunningChild } from '../state/mutations.ts';
import { normalizeChildrenResponse } from './normalize.ts';
import type { SubagentChild, SubagentState } from '../types.ts';
import { sameSubagentTokens } from '../tokens.ts';

type ReconcileChildrenStateOptions = {
  recoverySessionIDs?: ReadonlySet<string>;
  terminalRecoverySessionIDs?: ReadonlySet<string>;
};

const resolveRealSessionID = (child: SubagentChild): string | undefined => {
  if (!isRealSessionChild(child)) return undefined;
  return child.targetSessionID ?? (child.id.startsWith('ses_') ? child.id : undefined);
};

const collectTerminalRecoveryChildren = (
  state: SubagentState,
  terminalRecoverySessionIDs: ReadonlySet<string> | undefined,
): Map<string, SubagentChild> => {
  const terminalRecoveryChildren = new Map<string, SubagentChild>();
  if (!terminalRecoverySessionIDs?.size) return terminalRecoveryChildren;
  for (const child of Object.values(state.children)) {
    if (!isRealSessionChild(child) || !isTerminalStatus(child.status)) continue;
    const sessionID = resolveRealSessionID(child);
    if (!sessionID || !terminalRecoverySessionIDs.has(sessionID)) continue;
    if (!terminalRecoveryChildren.has(sessionID) || child.id === sessionID)
      terminalRecoveryChildren.set(sessionID, child);
  }
  return terminalRecoveryChildren;
};

const inheritTerminalRecoveryStatus = (child: SubagentChild, terminalChild: SubagentChild): SubagentChild => {
  if (!isTerminalStatus(terminalChild.status)) return child;
  const endedAt = terminalChild.endedAt ?? terminalChild.updatedAt;
  return { ...child, status: terminalChild.status, updatedAt: endedAt, endedAt };
};

const resolveIncomingChild = (
  child: SubagentChild,
  terminalRecoveryChildren: ReadonlyMap<string, SubagentChild>,
): { child: SubagentChild; inheritedTerminalRecovery: boolean; sessionID?: string } => {
  const sessionID = resolveRealSessionID(child);
  const terminalRecoveryChild = sessionID ? terminalRecoveryChildren.get(sessionID) : undefined;
  if (child.status !== 'running' || !terminalRecoveryChild)
    return { child, inheritedTerminalRecovery: false, sessionID };
  return {
    child: inheritTerminalRecoveryStatus(child, terminalRecoveryChild),
    inheritedTerminalRecovery: true,
    sessionID,
  };
};

const canReopenTerminalChild = (
  child: SubagentChild,
  sessionID: string | undefined,
  terminalRecoverySessionIDs: ReadonlySet<string> | undefined,
): boolean => !(child.status === 'running' && sessionID && terminalRecoverySessionIDs?.has(sessionID));

const isNewTerminalRecoveryAlias = (
  existing: SubagentChild | undefined,
  incomingChild: SubagentChild,
  sessionID: string | undefined,
  inheritedTerminalRecovery: boolean,
): boolean => !existing && inheritedTerminalRecovery && Boolean(sessionID && incomingChild.id !== sessionID);

const sameChild = (left: SubagentChild | undefined, right: SubagentChild | undefined): boolean => {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.id === right.id &&
    left.status === right.status &&
    left.updatedAt === right.updatedAt &&
    left.endedAt === right.endedAt &&
    left.summary === right.summary &&
    left.agentName === right.agentName &&
    left.targetSessionID === right.targetSessionID &&
    left.color === right.color &&
    left.elapsedMs === right.elapsedMs &&
    left.title === right.title &&
    left.parentID === right.parentID &&
    left.messageID === right.messageID &&
    left.source === right.source &&
    left.startedAt === right.startedAt &&
    sameSubagentTokens(left.tokens, right.tokens)
  );
};

const normalizeAt = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const applyTerminalRecoveryToExistingAliases = (
  state: SubagentState,
  terminalRecoveryChildren: ReadonlyMap<string, SubagentChild>,
): boolean => {
  if (terminalRecoveryChildren.size === 0) return false;
  let changed = false;
  for (const child of Object.values(state.children)) {
    if (child.status !== 'running') continue;
    if (!isRealSessionChild(child)) continue;
    const sessionID = child.targetSessionID;
    if (!sessionID || child.id === sessionID) continue;
    const terminalChild = terminalRecoveryChildren.get(sessionID);
    if (!terminalChild) continue;
    const endedAt = terminalChild.endedAt ?? terminalChild.updatedAt;
    const next = normalizeChild(inheritTerminalRecoveryStatus(child, terminalChild), normalizeAt(endedAt));
    if (sameChild(child, next)) continue;
    state.children[child.id] = next;
    changed = true;
  }
  return changed;
};

export const reconcileNormalizedChildrenState = (
  state: SubagentState,
  incomingChildren: readonly SubagentChild[],
  options: ReconcileChildrenStateOptions = {},
): { changed: boolean; nextState: SubagentState } => {
  const nextState = cloneState(state);
  const incomingIDs = new Set(incomingChildren.map((child) => child.id));
  const terminalRecoveryChildren = collectTerminalRecoveryChildren(nextState, options.terminalRecoverySessionIDs);
  const hadRealSessionChildren = Object.values(state.children).some(
    (child) => child.source === 'session' || child.id.startsWith('ses_'),
  );
  let changed = false;
  for (const incomingChild of incomingChildren) {
    const before = nextState.children[incomingChild.id];
    const { child, inheritedTerminalRecovery, sessionID } = resolveIncomingChild(
      incomingChild,
      terminalRecoveryChildren,
    );
    if (isNewTerminalRecoveryAlias(before, incomingChild, sessionID, inheritedTerminalRecovery)) continue;
    const allowTerminalReopen = canReopenTerminalChild(incomingChild, sessionID, options.terminalRecoverySessionIDs);
    changed = upsertRunningChild(nextState, child, { allowTerminalReopen }) || changed;
    if (isTerminalStatus(child.status))
      changed =
        markChildStatus(nextState, child.id, child.status, child.endedAt ?? child.updatedAt, {
          allowOlderTerminalEvidence: inheritedTerminalRecovery,
        }) || changed;
    if (!sameChild(before, nextState.children[child.id])) changed = true;
  }
  changed = applyTerminalRecoveryToExistingAliases(nextState, terminalRecoveryChildren) || changed;
  for (const existing of Object.values(state.children)) {
    if (!isRealSessionChild(existing)) continue;
    if (incomingIDs.has(existing.id)) continue;
    const existingSessionID = resolveRealSessionID(existing);
    if (existingSessionID && options.recoverySessionIDs?.has(existingSessionID)) continue;
    if (existing.status === 'running') continue;
    nextState.purgedSessionIDs[existing.id] = true;
    delete nextState.children[existing.id];
    changed = true;
  }
  const pruneReferenceMs = Date.parse(nextState.updatedAt);
  const pruned = pruneTerminalChildren(nextState, Number.isNaN(pruneReferenceMs) ? Date.now() : pruneReferenceMs);
  const prunedSynthetic = pruneOrphanedSyntheticRunningChildren(nextState, {
    pruneWhenNoRealSessionChildren: hadRealSessionChildren,
  });
  if (changed || pruned || prunedSynthetic) nextState.updatedAt = new Date().toISOString();
  return { changed: changed || pruned || prunedSynthetic, nextState };
};

export const reconcileChildrenState = (
  state: SubagentState,
  response: unknown,
  options: ReconcileChildrenStateOptions = {},
): { changed: boolean; nextState: SubagentState } => {
  return reconcileNormalizedChildrenState(state, normalizeChildrenResponse(response), options);
};
