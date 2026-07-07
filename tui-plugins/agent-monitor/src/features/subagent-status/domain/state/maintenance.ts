import type { SubagentChild, SubagentState } from '../types.ts';

import { timestampMs, toNonNegativeInteger } from '../../../../kit/coercion.ts';
import {
  isDelegationLikeChild,
  isRealSessionChild,
  isSubtaskFallback,
  isSyntheticToolWrapper,
  resolveElapsedMs,
  resolveSessionIdentity,
  resolveStatusColor,
  safeTimestamp,
  sanitizeAgentName,
  sanitizeSummary,
  sanitizeTargetSessionID,
  sanitizeTokens,
} from './core.ts';

// ─── helpers ───────────────────────────────────────────────────────────────

export const isTerminalStatus = (
  status: SubagentChild['status'],
): status is Exclude<SubagentChild['status'], 'running'> =>
  status === 'done' || status === 'error' || status === 'stale';

export const childEvidenceTimestampMs = (child: Pick<SubagentChild, 'startedAt' | 'updatedAt' | 'endedAt'>): number =>
  timestampMs(child.endedAt ?? child.updatedAt ?? child.startedAt);

export const terminalChildTimestamp = (child: SubagentChild): number => {
  const parsed = Date.parse(child.endedAt ?? child.updatedAt ?? child.startedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const rememberPurgedSession = (
  state: SubagentState,
  child: Pick<SubagentChild, 'id'> & Partial<Pick<SubagentChild, 'targetSessionID'>>,
): void => {
  const sessionId = resolveSessionIdentity(child);
  if (!sessionId) return;
  state.purgedSessionIDs[sessionId] = true;
};

// ─── normalization ──────────────────────────────────────────────────────────

export const normalizeChild = (child: SubagentChild, nowMs = Date.now()): SubagentChild => {
  const now = new Date(nowMs).toISOString();
  const status =
    child.status === 'done' || child.status === 'error' || child.status === 'stale' || child.status === 'running'
      ? child.status
      : 'running';
  const title = typeof child.title === 'string' && child.title.trim().length > 0 ? child.title : child.id;
  const startedAt = safeTimestamp(child.startedAt, now);
  const updatedAt = safeTimestamp(child.updatedAt, startedAt);
  const endedAt = child.endedAt ? safeTimestamp(child.endedAt, updatedAt) : undefined;

  return {
    ...child,
    title,
    summary: sanitizeSummary(child.summary, title),
    agentName: sanitizeAgentName(child.agentName),
    targetSessionID: sanitizeTargetSessionID(child.targetSessionID, child.id.startsWith('ses_') ? child.id : undefined),
    status,
    color: resolveStatusColor(status),
    startedAt,
    updatedAt,
    endedAt,
    elapsedMs: resolveElapsedMs({ startedAt, updatedAt, endedAt, status }, nowMs),
    tokens: sanitizeTokens(child.tokens),
  };
};

// ─── execution-count ────────────────────────────────────────────────────────

const normalizeExecutionCounters = (state: SubagentState): void => {
  state.totalExecuted = Math.max(
    toNonNegativeInteger(state.totalExecuted) ?? 0,
    Object.keys(state.countedChildIDs).length,
  );
};

const matchingCorrelation = (
  left: Pick<SubagentChild, 'parentID'> & Partial<Pick<SubagentChild, 'messageID'>>,
  right: Pick<SubagentChild, 'parentID'> & Partial<Pick<SubagentChild, 'messageID'>>,
): boolean =>
  Boolean(left.messageID && right.messageID && left.parentID === right.parentID && left.messageID === right.messageID);

const findMatchingCountedSessionID = (
  state: SubagentState,
  subtask: Pick<SubagentChild, 'parentID'> & Partial<Pick<SubagentChild, 'messageID' | 'targetSessionID'>>,
): string | undefined => {
  if (subtask.targetSessionID && state.countedChildIDs[subtask.targetSessionID]) {
    return subtask.targetSessionID;
  }

  const matches = Object.values(state.children)
    .filter((child) => isRealSessionChild(child))
    .filter((child) => state.countedChildIDs[child.id])
    .filter((child) => matchingCorrelation(subtask, child))
    .map((child) => child.id);

  return matches.length === 1 ? matches[0] : undefined;
};

const findMatchingCountedSubtaskID = (
  state: SubagentState,
  session: Pick<SubagentChild, 'id' | 'parentID'> & Partial<Pick<SubagentChild, 'messageID'>>,
): string | undefined => {
  const byTarget = Object.values(state.children)
    .filter((child) => isSubtaskFallback(child))
    .filter((child) => state.countedChildIDs[child.id])
    .filter((child) => child.targetSessionID === session.id)
    .map((child) => child.id);
  if (byTarget.length === 1) return byTarget[0];

  const byCorrelation = Object.values(state.children)
    .filter((child) => isSubtaskFallback(child))
    .filter((child) => state.countedChildIDs[child.id])
    .filter((child) => matchingCorrelation(session, child))
    .map((child) => child.id);

  return byCorrelation.length === 1 ? byCorrelation[0] : undefined;
};

const pruneStaleCountedChildIDs = (state: SubagentState): boolean => {
  let changed = false;

  for (const childID of Object.keys(state.countedChildIDs)) {
    if (state.children[childID]) continue;
    delete state.countedChildIDs[childID];
    changed = true;
  }

  return changed;
};

export const rekeyCountedExecution = (state: SubagentState, fromID: string, toID: string): boolean => {
  if (fromID === toID || !state.countedChildIDs[fromID]) return false;

  const toAlreadyCounted = Boolean(state.countedChildIDs[toID]);
  delete state.countedChildIDs[fromID];
  if (!toAlreadyCounted) {
    state.countedChildIDs[toID] = true;
    normalizeExecutionCounters(state);
    return true;
  }

  state.totalExecuted = Math.max(
    Object.keys(state.countedChildIDs).length,
    (toNonNegativeInteger(state.totalExecuted) ?? 0) - 1,
  );
  return true;
};

export const resolveExecutionCountIdentity = (
  state: SubagentState,
  child: Pick<SubagentChild, 'id' | 'title' | 'parentID'> &
    Partial<Pick<SubagentChild, 'messageID' | 'source' | 'targetSessionID'>>,
): string | undefined => {
  if (isSyntheticToolWrapper(child) || isDelegationLikeChild(child)) return undefined;

  if (isRealSessionChild(child)) {
    const matchingSubtaskID = findMatchingCountedSubtaskID(state, child);
    if (matchingSubtaskID) {
      rekeyCountedExecution(state, matchingSubtaskID, child.id);
      return undefined;
    }

    return child.id;
  }

  if (isSubtaskFallback(child)) {
    if (findMatchingCountedSessionID(state, child)) return undefined;
    return child.targetSessionID ?? child.id;
  }

  return child.id;
};

export const syncExecutionState = (state: SubagentState): void => {
  pruneStaleCountedChildIDs(state);
  normalizeExecutionCounters(state);
};

// ─── pruning ─────────────────────────────────────────────────────────────────

const TERMINAL_CHILD_RETENTION_MS = 30 * 60 * 1000;
const MAX_TERMINAL_CHILDREN = 50;

export const pruneTerminalChildren = (state: SubagentState, now = Date.now()): boolean => {
  const terminalChildren = Object.values(state.children)
    .filter((child) => child.status !== 'running')
    .sort((left, right) => terminalChildTimestamp(right) - terminalChildTimestamp(left));
  if (terminalChildren.length === 0) return false;

  const cutoff = now - TERMINAL_CHILD_RETENTION_MS;
  const keepIDs = new Set(
    terminalChildren
      .filter((child) => terminalChildTimestamp(child) >= cutoff)
      .slice(0, MAX_TERMINAL_CHILDREN)
      .map((child) => child.id),
  );

  let changed = false;
  for (const child of terminalChildren) {
    if (keepIDs.has(child.id)) continue;
    rememberPurgedSession(state, child);
    delete state.children[child.id];
    changed = true;
  }

  syncExecutionState(state);

  return changed;
};

export const pruneOrphanedSyntheticRunningChildren = (
  state: SubagentState,
  options: { pruneWhenNoRealSessionChildren?: boolean } = {},
): boolean => {
  const realSessionChildren = Object.values(state.children).filter((child) => isRealSessionChild(child));
  const pruneToolWrappersWithoutRealSessions =
    realSessionChildren.length === 0 && !options.pruneWhenNoRealSessionChildren;

  const activeSessionIDs = new Set(
    realSessionChildren.filter((child) => child.status === 'running').map((child) => child.id),
  );

  let changed = false;
  for (const child of Object.values(state.children)) {
    if (child.status !== 'running') continue;
    if (!isSyntheticToolWrapper(child) && !isSubtaskFallback(child)) continue;

    if (pruneToolWrappersWithoutRealSessions && isSubtaskFallback(child)) {
      continue;
    }

    const anchoredToActiveSession =
      activeSessionIDs.has(child.parentID) || activeSessionIDs.has(child.targetSessionID ?? '');
    if (anchoredToActiveSession) continue;

    rememberPurgedSession(state, child);
    delete state.children[child.id];
    changed = true;
  }

  syncExecutionState(state);

  return changed;
};
