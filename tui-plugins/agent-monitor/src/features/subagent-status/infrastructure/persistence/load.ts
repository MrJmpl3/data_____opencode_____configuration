import { readFile } from 'node:fs/promises';

import type { SubagentChild, SubagentState } from '../../domain/types.ts';
import { isRecord, isOneOf, toFiniteNumber, toNonNegativeInteger } from '../../../../kit/coercion.ts';
import { clearPurgedSession, createEmptyState } from '../../domain/state/core.ts';
import {
  normalizeChild,
  pruneOrphanedSyntheticRunningChildren,
  pruneTerminalChildren,
  rekeyCountedExecution,
  resolveExecutionCountIdentity,
  syncExecutionState,
} from '../../domain/state/maintenance.ts';
import type { RecoveryContext, RecoverySource } from '../recovery.ts';

import { applyRecoveryIfNeeded } from './recovery.ts';

const safeReadJSON = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const isPersistedChildSource = (value: unknown): boolean =>
  value === undefined || isOneOf('session', 'subtask', 'tool')(value);

const isPersistedChildStatus = isOneOf('running', 'done', 'error', 'stale');

type HydratablePersistedChild = Record<string, unknown> & {
  parentID: string;
  source?: SubagentChild['source'];
  status: SubagentChild['status'];
};

const isHydratablePersistedChild = (value: Record<string, unknown>): value is HydratablePersistedChild => {
  if (typeof value.parentID !== 'string') return false;
  if (!isPersistedChildSource(value.source)) return false;
  return isPersistedChildStatus(value.status);
};

const parsePersistedState = (raw: string): SubagentState | null => {
  // returns null on parse failure or shape mismatch so the caller can fall back to
  // an empty state without leaking exception handling into the orchestration code.
  const parsed = safeReadJSON(raw);
  if (!isRecord(parsed)) return null;

  const state = createEmptyState();
  state.updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : state.updatedAt;

  if (isRecord(parsed.countedChildIDs)) {
    for (const [id, value] of Object.entries(parsed.countedChildIDs)) {
      // only boolean `true` entries are kept — any other shape (including objects or
      // strings) is treated as a corrupt entry and dropped silently.
      if (value === true && id) state.countedChildIDs[id] = true;
    }
  }
  if (isRecord(parsed.purgedSessionIDs)) {
    for (const [id, value] of Object.entries(parsed.purgedSessionIDs)) {
      // `ses_` prefix guard prevents restoring purged-session markers written by a
      // different runtime that may not match the current session-id scheme.
      if (value === true && id.startsWith('ses_')) state.purgedSessionIDs[id] = true;
    }
  }
  state.totalExecuted = Math.max(
    toNonNegativeInteger(parsed.totalExecuted) ?? 0,
    Object.keys(state.countedChildIDs).length,
  );

  const rawChildren = isRecord(parsed.children) ? parsed.children : {};
  for (const child of hydrateChildren(rawChildren, state.updatedAt)) {
    clearPurgedSession(state, child.id);
    state.children[child.id] = child;
  }

  return state;
};

// Local normalizeChild wrapper imported lazily to avoid a top-level cycle with
// domain/state/maintenance. The function is pure and side-effect free.
const hydrateChildren = (rawChildren: Record<string, unknown>, fallbackTimestamp: string): SubagentChild[] => {
  // input is a `Record<string, unknown>` (the persisted children map), not an array,
  // because the JSON shape is keyed by child id. The function still returns an array so the
  // caller can iterate without managing the key simultaneously.
  const children: SubagentChild[] = [];
  for (const [id, value] of Object.entries(rawChildren)) {
    if (!isRecord(value)) continue;
    if (!isHydratablePersistedChild(value)) continue;

    // tokens are normalized one-field-at-a-time so a partially-populated record
    // (e.g. only `input`) survives; the final `undefined` check drops the bag entirely when
    // every sub-field is absent.
    const tokens = isRecord(value.tokens)
      ? {
          input: toFiniteNumber(value.tokens.input),
          output: toFiniteNumber(value.tokens.output),
          total: toFiniteNumber(value.tokens.total),
          contextPercent: toFiniteNumber(value.tokens.contextPercent),
        }
      : undefined;

    const child = normalizeChild(
      {
        id: typeof value.id === 'string' ? value.id : id,
        title: typeof value.title === 'string' ? value.title : id,
        summary: typeof value.summary === 'string' ? value.summary : undefined,
        agentName: typeof value.agentName === 'string' ? value.agentName : undefined,
        parentID: value.parentID,
        messageID: typeof value.messageID === 'string' ? value.messageID : undefined,
        source:
          value.source === 'session' || value.source === 'subtask' || value.source === 'tool'
            ? value.source
            : undefined,
        targetSessionID: typeof value.targetSessionID === 'string' ? value.targetSessionID : undefined,
        status: value.status,
        color:
          value.color === 'green' || value.color === 'red' || value.color === 'yellow' || value.color === 'gray'
            ? value.color
            : undefined,
        startedAt: typeof value.startedAt === 'string' ? value.startedAt : fallbackTimestamp,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : fallbackTimestamp,
        endedAt: typeof value.endedAt === 'string' ? value.endedAt : undefined,
        elapsedMs: toFiniteNumber(value.elapsedMs),
        tokens:
          tokens?.input === undefined &&
          tokens?.output === undefined &&
          tokens?.total === undefined &&
          tokens?.contextPercent === undefined
            ? undefined
            : tokens,
      },
      Date.parse(fallbackTimestamp),
    );
    children.push(child);
  }
  return children;
};

const reconcileExecutionCounts = (state: SubagentState): void => {
  for (const child of Object.values(state.children)) {
    if (child.source === 'subtask' && child.targetSessionID && state.countedChildIDs[child.id]) {
      rekeyCountedExecution(state, child.id, child.targetSessionID);
    }

    const countIdentity = resolveExecutionCountIdentity(state, child);
    if (countIdentity && !state.countedChildIDs[countIdentity]) {
      state.countedChildIDs[countIdentity] = true;
    }
  }
  syncExecutionState(state);
};

const pruneOnLoad = (state: SubagentState): boolean => {
  // returns true when anything was pruned so the caller can decide whether to bump
  // `updatedAt`. Two distinct passes run because terminal-vs-orphan membership is computed
  // independently and must each be re-evaluated on every load.
  const prunedTerminalChildren = pruneTerminalChildren(state, Date.now());
  const prunedOrphanedSyntheticChildren = pruneOrphanedSyntheticRunningChildren(state);
  if (prunedTerminalChildren || prunedOrphanedSyntheticChildren) {
    state.updatedAt = new Date().toISOString();
    return true;
  }
  return false;
};

export const loadState = async (
  statePath: string,
  options: {
    recoveryContext?: RecoveryContext;
    recoverySources?: RecoverySource[];
  } = {},
): Promise<SubagentState> => {
  let state = createEmptyState();
  try {
    const raw = await readFile(statePath, 'utf8');
    state = parsePersistedState(raw) ?? state;
  } catch (e) {
    // Format: "[agent-monitor] <message> — sessionId=<id>: <error>" so a
    // single grep on `sessionId=` correlates every failure to its session.
    // `loadState` does not own a sessionId; the recovery context supplies
    // the parent session when present, otherwise the format omits the id.
    const parentSessionID = options.recoveryContext?.parentSessionID;
    console.warn(
      '[agent-monitor] Failed to load state, continuing recovery' + (parentSessionID ? ' — sessionId=' : ':'),
      ...(parentSessionID ? [parentSessionID, ':'] : []),
      e instanceof Error ? e : String(e),
    );
  }

  reconcileExecutionCounts(state);
  try {
    const recoveredState = structuredClone(state);
    await applyRecoveryIfNeeded(recoveredState, options);
    state = recoveredState;
  } catch (e) {
    console.warn('[agent-monitor] Recovery failed, using persisted state:', e instanceof Error ? e : String(e));
  }
  pruneOnLoad(state);

  return state;
};
