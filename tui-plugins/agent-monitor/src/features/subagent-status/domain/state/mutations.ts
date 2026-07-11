import type { SubagentChild, SubagentState, SubagentTokens } from '../types.ts';

import { safeTimestamp, timestampMs, toNonNegativeInteger } from '../../../../kit/coercion.ts';
import {
  clearPurgedSession,
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
} from './maintenance.ts';
import { resolveChildTiming, resolveIncomingStatus, resolveSourceForUpsert } from './timing-policy.ts';

// ─── Mutaciones de estado ──────────────────────────────────────────────────
// Son las UNICAS formas de modificar SubagentState. Cada mutation devuelve
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
  if (child.source !== 'subtask' || !child.targetSessionID) return false;
  return rekeyCountedExecution(state, child.id, child.targetSessionID);
};

type ChildBuildInputs = {
  input: Parameters<typeof upsertRunningChild>[1];
  existing: SubagentChild | undefined;
  observedStartedAt: string;
  status: SubagentChild['status'];
  nextUpdatedAt: string;
  nextEndedAt: string | undefined;
  source: SubagentChild['source'];
  targetSessionID: string | undefined;
  tokens: SubagentTokens | undefined;
};

// Builds the normalized child snapshot that gets committed to state. Keeping
// the field-by-field merge out of the orchestrator makes the "what counts as a
// change" decision sit next to the actual construction.
const buildChildState = (params: ChildBuildInputs): SubagentChild => {
  const { input, existing, observedStartedAt, status, nextUpdatedAt, nextEndedAt, source, targetSessionID, tokens } =
    params;
  return normalizeChild({
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
    tokens,
  });
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

  const {
    status,
    updatedAt: nextUpdatedAt,
    endedAt: nextEndedAt,
    preserveSameTerminalTiming,
  } = resolveChildTiming(
    existing,
    observedUpdatedAt,
    observedStartedAt,
    incomingStatus,
    input.endedAt,
    options.allowTerminalReopen,
  );

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

  const next = buildChildState({
    input,
    existing,
    observedStartedAt,
    status,
    nextUpdatedAt,
    nextEndedAt,
    source,
    targetSessionID,
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
