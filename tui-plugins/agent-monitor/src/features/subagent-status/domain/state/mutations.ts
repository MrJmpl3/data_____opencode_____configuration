import type { SubagentChild, SubagentState, SubagentTokens } from '../types.ts';

import { safeTimestamp, timestampMs, toNonNegativeInteger } from '../../../../kit/coercion.ts';
import {
  clearPurgedSession,
  createEmptyState,
  isSubtaskFallback,
  mergeTokens,
  resolveSessionIdentity,
  resolveStatusColor,
  sameTokens,
  sanitizeTargetSessionID,
} from './core.ts';
import {
  childEvidenceTimestampMs,
  isTerminalStatus,
  normalizeChild,
  pruneTerminalChildren,
  rekeyCountedExecution,
  resolveExecutionCountIdentity,
  syncExecutionState,
} from './maintenance.ts';

// ─── Mutaciones de estado ──────────────────────────────────────────────────
// Son las UNICAS 5 formas de modificar SubagentState. Cada mutation devuelve
// boolean indicando si algo cambio realmente (para saber si hay que persistir).

const countChildExecution = (
  state: SubagentState,
  child: Pick<SubagentChild, 'id' | 'title' | 'parentID'> &
    Partial<Pick<SubagentChild, 'messageID' | 'source' | 'targetSessionID'>>,
): boolean => {
  state.totalExecuted = Math.max(
    toNonNegativeInteger(state.totalExecuted) ?? 0,
    Object.keys(state.countedChildIDs).length,
  );
  const countIdentity = resolveExecutionCountIdentity(state, child);
  if (!countIdentity || state.countedChildIDs[countIdentity]) return false;

  state.countedChildIDs[countIdentity] = true;
  state.totalExecuted = Math.max(
    toNonNegativeInteger(state.totalExecuted) ?? 0,
    Object.keys(state.countedChildIDs).length,
  );
  return true;
};

const reconcileSubtaskTargetCount = (
  state: SubagentState,
  child: Pick<SubagentChild, 'id'> & Partial<Pick<SubagentChild, 'source' | 'targetSessionID'>>,
): boolean => {
  if (!isSubtaskFallback(child) || !child.targetSessionID) return false;
  return rekeyCountedExecution(state, child.id, child.targetSessionID);
};

const shouldPreserveSameTerminalTiming = (
  existing: SubagentChild | undefined,
  nextStatus: SubagentChild['status'],
): boolean => {
  return Boolean(existing && isTerminalStatus(existing.status) && existing.status === nextStatus);
};

// Source resolution prefers the incoming value, falls back to the
// stored one, and as a last resort infers 'session' from a ses_-prefixed id.
// Keeping the chain isolated makes the precedence readable in one place.
const resolveSourceForUpsert = (
  input: Pick<SubagentChild, 'id' | 'source'>,
  existing: SubagentChild | undefined,
): SubagentChild['source'] =>
  input.source ?? existing?.source ?? (input.id.startsWith('ses_') ? 'session' : undefined);

const isKnownStatus = (status: SubagentChild['status'] | undefined): status is SubagentChild['status'] =>
  status === 'done' || status === 'error' || status === 'stale' || status === 'running';

const resolveIncomingStatus = (
  input: Partial<Pick<SubagentChild, 'status'>>,
  existing: SubagentChild | undefined,
): SubagentChild['status'] => (isKnownStatus(input.status) ? input.status : (existing?.status ?? 'running'));

const isStaleEvidence = (existing: SubagentChild | undefined, incomingEvidenceMs: number): boolean =>
  Boolean(existing && incomingEvidenceMs < childEvidenceTimestampMs(existing));

// A terminal child transitions back to running only when (a) the
// caller explicitly opts in, (b) the new evidence is strictly newer, and (c)
// the incoming status is running. Otherwise we'd silently rewrite history
// and break the terminal contract.
const shouldReopenTerminal = (
  existing: SubagentChild | undefined,
  incomingStatus: SubagentChild['status'],
  incomingEvidenceMs: number,
  allowTerminalReopen: boolean | undefined,
): boolean =>
  Boolean(
    existing &&
      isTerminalStatus(existing.status) &&
      incomingStatus === 'running' &&
      allowTerminalReopen === true &&
      incomingEvidenceMs > childEvidenceTimestampMs(existing),
  );

interface TimingPreservation {
  preserveExistingTiming: boolean;
  preserveSameTerminalTiming: boolean;
  reopenTerminal: boolean;
}

const computeTimingPreservation = (
  existing: SubagentChild | undefined,
  incomingStatus: SubagentChild['status'],
  incomingEvidenceMs: number,
  allowTerminalReopen: boolean | undefined,
): TimingPreservation => {
  const reopenTerminal = shouldReopenTerminal(existing, incomingStatus, incomingEvidenceMs, allowTerminalReopen);
  const preserveSameTerminalTiming = shouldPreserveSameTerminalTiming(existing, incomingStatus);
  const staleEvidence = isStaleEvidence(existing, incomingEvidenceMs);
  const preserveExistingTiming = Boolean(
    existing &&
      (preserveSameTerminalTiming ||
        staleEvidence ||
        (isTerminalStatus(existing.status) && incomingStatus === 'running' && !reopenTerminal)),
  );
  return { preserveExistingTiming, preserveSameTerminalTiming, reopenTerminal };
};

// Field-by-field equality on 12 normalized properties avoids a
// deep-equal helper but still lets the upsert return false when nothing
// observable changed. Tokens are compared structurally via sameTokens.
const hasChildFieldChanges = (existing: SubagentChild, next: SubagentChild): boolean =>
  existing.title !== next.title ||
  existing.summary !== next.summary ||
  existing.agentName !== next.agentName ||
  existing.parentID !== next.parentID ||
  existing.messageID !== next.messageID ||
  existing.source !== next.source ||
  existing.targetSessionID !== next.targetSessionID ||
  existing.status !== next.status ||
  existing.startedAt !== next.startedAt ||
  existing.updatedAt !== next.updatedAt ||
  existing.endedAt !== next.endedAt ||
  !sameTokens(existing.tokens, next.tokens);

/** Inserta o actualiza un child en estado running. Si ya existe, mergea
 *  campos parciales. Si es terminal-reopen, permite reactivar. */
export const upsertRunningChild = (
  state: SubagentState,
  input: Pick<SubagentChild, 'id' | 'title' | 'parentID'> &
    Partial<
      Pick<
        SubagentChild,
        | 'summary'
        | 'agentName'
        | 'messageID'
        | 'source'
        | 'targetSessionID'
        | 'startedAt'
        | 'updatedAt'
        | 'status'
        | 'endedAt'
        | 'tokens'
      >
    >,
  options: { allowPurgedSessionRestore?: boolean; allowTerminalReopen?: boolean } = {},
): boolean => {
  const now = new Date().toISOString();
  const existing = state.children[input.id];
  const source = resolveSourceForUpsert(input, existing);
  const observedUpdatedAt = safeTimestamp(input.updatedAt, now);
  const observedStartedAt = safeTimestamp(input.startedAt, existing?.startedAt ?? observedUpdatedAt);
  const targetSessionID = sanitizeTargetSessionID(
    input.targetSessionID ?? existing?.targetSessionID,
    input.id.startsWith('ses_') ? input.id : undefined,
  );
  const incomingStatus = resolveIncomingStatus(input, existing);
  const sessionIdentity = resolveSessionIdentity({ id: input.id, targetSessionID });
  if (!existing && sessionIdentity && state.purgedSessionIDs[sessionIdentity] && !options.allowPurgedSessionRestore) {
    return false;
  }

  if (sessionIdentity && options.allowPurgedSessionRestore) {
    clearPurgedSession(state, sessionIdentity);
  }

  const incomingEvidenceMs = timestampMs(input.endedAt ?? observedUpdatedAt ?? observedStartedAt);
  const { preserveExistingTiming, preserveSameTerminalTiming } = computeTimingPreservation(
    existing,
    incomingStatus,
    incomingEvidenceMs,
    options.allowTerminalReopen,
  );
  const status = preserveExistingTiming ? existing!.status : incomingStatus;
  const nextUpdatedAt = preserveExistingTiming ? existing!.updatedAt : observedUpdatedAt;
  const nextEndedAt = preserveExistingTiming
    ? existing!.endedAt
    : status === 'running'
      ? undefined
      : (input.endedAt ?? existing?.endedAt ?? observedUpdatedAt);

  const counted = existing
    ? false
    : countChildExecution(state, {
        id: input.id,
        title: input.title,
        parentID: input.parentID,
        messageID: input.messageID,
        source,
        targetSessionID,
      });

  const next = normalizeChild({
    id: input.id,
    title: input.title,
    summary: input.summary ?? existing?.summary,
    agentName: input.agentName ?? existing?.agentName,
    parentID: input.parentID,
    messageID: input.messageID ?? existing?.messageID,
    source,
    targetSessionID,
    status,
    startedAt: observedStartedAt,
    updatedAt: nextUpdatedAt,
    endedAt: nextEndedAt,
    color: existing?.color,
    elapsedMs: existing?.elapsedMs,
    tokens: mergeTokens(existing?.tokens, input.tokens),
  });

  if (existing && !hasChildFieldChanges(existing, next)) {
    return counted;
  }

  state.children[input.id] = next;
  reconcileSubtaskTargetCount(state, next);
  state.updatedAt = preserveSameTerminalTiming ? observedUpdatedAt : next.updatedAt;
  return true;
};

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

  const changed =
    JSON.stringify(state.children) !== JSON.stringify(nextState.children) ||
    JSON.stringify(state.countedChildIDs) !== JSON.stringify(nextState.countedChildIDs) ||
    state.totalExecuted !== nextState.totalExecuted;

  state.children = nextState.children;
  state.countedChildIDs = nextState.countedChildIDs;
  state.totalExecuted = nextState.totalExecuted;
  state.updatedAt = changed ? new Date().toISOString() : state.updatedAt;
  return changed;
};

/** Marca un child como running (vuelve del estado terminal). */
export const markChildRunning = (state: SubagentState, childID: string, updatedAt?: string): boolean => {
  const resolvedUpdatedAt = safeTimestamp(updatedAt, new Date().toISOString());
  const nextEvidenceMs = timestampMs(resolvedUpdatedAt);
  let changed = false;

  for (const child of Object.values(state.children)) {
    if (child.id !== childID && child.targetSessionID !== childID) continue;

    const currentEvidenceMs = childEvidenceTimestampMs(child);
    const reopeningTerminal = isTerminalStatus(child.status);
    if (
      (reopeningTerminal && nextEvidenceMs <= currentEvidenceMs) ||
      (!reopeningTerminal && nextEvidenceMs < currentEvidenceMs)
    ) {
      continue;
    }

    const normalized = normalizeChild(
      {
        ...child,
        status: 'running',
        updatedAt: resolvedUpdatedAt,
        endedAt: undefined,
      },
      Date.parse(resolvedUpdatedAt),
    );

    if (
      child.status === normalized.status &&
      child.updatedAt === normalized.updatedAt &&
      child.endedAt === normalized.endedAt &&
      child.color === normalized.color &&
      child.elapsedMs === normalized.elapsedMs
    ) {
      continue;
    }

    clearPurgedSession(state, resolveSessionIdentity(child) ?? childID);
    state.children[child.id] = normalized;
    changed = true;
  }

  if (!changed) return false;

  state.updatedAt = resolvedUpdatedAt;
  return true;
};

/** Marca un child con status terminal (done/error/stale). Si allowOlderTerminalEvidence
 *  es true, permite evidencia vieja (para recovery). */
export const markChildStatus = (
  state: SubagentState,
  childID: string,
  status: Exclude<SubagentChild['status'], 'running'>,
  endedAt?: string,
  options: { allowOlderTerminalEvidence?: boolean } = {},
): boolean => {
  let changed = false;
  const resolvedEndedAt = safeTimestamp(endedAt, new Date().toISOString());
  const nextEvidenceMs = timestampMs(resolvedEndedAt);

  for (const child of Object.values(state.children)) {
    if (child.id !== childID && child.targetSessionID !== childID) continue;
    if (
      nextEvidenceMs < childEvidenceTimestampMs(child) &&
      !(options.allowOlderTerminalEvidence === true && child.status === 'running')
    ) {
      continue;
    }
    if (child.status === status) {
      continue;
    }

    clearPurgedSession(state, resolveSessionIdentity(child) ?? childID);

    state.children[child.id] = normalizeChild(
      {
        ...child,
        status,
        color: resolveStatusColor(status),
        endedAt: resolvedEndedAt,
        updatedAt: resolvedEndedAt,
      },
      Date.parse(resolvedEndedAt),
    );
    changed = true;
  }

  if (!changed) return false;

  pruneTerminalChildren(state, Date.parse(resolvedEndedAt));
  state.updatedAt = resolvedEndedAt;
  return true;
};
