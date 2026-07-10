import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import os from 'node:os';

import type { SubagentChild, SubagentState } from '../domain/types.ts';
import type { PersistedSnapshotArtifacts } from '../shared/display.ts';

import {
  hydrateStateFromRecoverySources,
  inferParentSessionID,
  type RecoveryContext,
  type RecoverySource,
} from './recovery.ts';
import { createSerializedTaskQueue } from '../runtime/queue.ts';
import { clearPurgedSession, createEmptyState } from '../domain/state/core.ts';
import {
  normalizeChild,
  pruneOrphanedSyntheticRunningChildren,
  pruneTerminalChildren,
  rekeyCountedExecution,
  resolveExecutionCountIdentity,
  syncExecutionState,
} from '../domain/state/maintenance.ts';
import { isPlainObject as isRecord, toFiniteNumber, toNonNegativeInteger } from '../../../kit/coercion.ts';

const STATUS_DIRNAME = 'agent-monitor';
const STATUS_FILENAME = 'state.json';
const STATUS_DIR_MODE = 0o700;
const STATUS_FILE_MODE = 0o600;

const safeReadJSON = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const isPersistedChildSource = (value: unknown): boolean =>
  value === undefined || value === 'session' || value === 'subtask' || value === 'tool';

const isPersistedChildStatus = (value: unknown): boolean =>
  value === 'running' || value === 'done' || value === 'error' || value === 'stale';

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

const writeLocalFile = async (path: string, contents: string): Promise<void> => {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: STATUS_DIR_MODE });

  const tempPath = join(directory, `.${basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, contents, { encoding: 'utf8', mode: STATUS_FILE_MODE });
    await rename(tempPath, path);
  } catch (error) {
    // Temp file cleanup is best-effort — if it fails the original
    // error (the write/rename failure) is what matters to the caller.
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

export const resolveStatePath = (
  input: string | { workspaceDirectory?: string; statePath?: string } = process.cwd(),
): string => {
  if (
    typeof input === 'object' &&
    input !== null &&
    typeof input.statePath === 'string' &&
    input.statePath.trim().length > 0
  ) {
    return input.statePath;
  }

  const workspaceDirectory = typeof input === 'string' ? input : (input.workspaceDirectory ?? process.cwd());
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? os.tmpdir();
  const resolvedWorkspaceDirectory = resolve(workspaceDirectory);
  const workspaceHash = createHash('sha256').update(resolvedWorkspaceDirectory).digest('hex').slice(0, 16);

  return join(runtimeDir, STATUS_DIRNAME, `workspace-${workspaceHash}`, STATUS_FILENAME);
};

export const resolveTextPath = (statePath: string): string => {
  return join(dirname(statePath), 'status.txt');
};

export const resolveDebugPath = (statePath: string): string => {
  return join(dirname(statePath), 'debug.json');
};

export const shouldPreserveStateOnStartup = (input?: { preserveStateOnStartup?: boolean }): boolean => {
  return input?.preserveStateOnStartup === true;
};

// original `loadState` bundled file I/O, JSON parsing, schema validation, child hydration,
// token normalization, execution-count reconciliation, recovery source hydration and pruning
// into one ~130-line function. Splitting it keeps each step independently testable and makes the
// recovery fallback (retry with inferred parent) easier to reason about.

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

const applyRecoveryIfNeeded = async (
  state: SubagentState,
  options: {
    recoveryContext?: RecoveryContext;
    recoverySources?: RecoverySource[];
  },
): Promise<boolean> => {
  if (!options.recoverySources || options.recoverySources.length === 0) return false;

  const contextParentID = options.recoveryContext?.parentSessionID;
  const inferredParentID = inferParentSessionID(state);
  // the second pass with the inferred parent is only useful when the state already
  // has children to anchor the inference — an empty state can't disambiguate a parent.
  const shouldRetryWithInferredParent =
    !!inferredParentID && inferredParentID !== contextParentID && Object.keys(state.children).length > 0;

  const directory = options.recoveryContext?.directory ?? process.cwd();

  await hydrateStateFromRecoverySources(
    state,
    { directory, parentSessionID: contextParentID },
    options.recoverySources,
  );

  if (shouldRetryWithInferredParent) {
    await hydrateStateFromRecoverySources(
      state,
      { directory, parentSessionID: inferredParentID },
      options.recoverySources,
    );
  }

  return true;
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
  try {
    const raw = await readFile(statePath, 'utf8');
    const state = parsePersistedState(raw) ?? createEmptyState();

    reconcileExecutionCounts(state);
    await applyRecoveryIfNeeded(state, options);
    pruneOnLoad(state);

    return state;
  } catch {
    return createEmptyState();
  }
};

export const saveStatusText = async (textPath: string, contents: string): Promise<void> => {
  await writeLocalFile(textPath, contents);
};

export const saveDebugSnapshot = async (debugPath: string, contents: string): Promise<void> => {
  await writeLocalFile(debugPath, contents);
};

export const saveState = async (statePath: string, state: SubagentState): Promise<void> => {
  await writeLocalFile(statePath, JSON.stringify(state, null, 2));
};

export const persistSnapshot = async (
  statePath: string,
  textPath: string,
  state: SubagentState,
  artifacts: PersistedSnapshotArtifacts,
): Promise<void> => {
  try {
    await saveState(statePath, state);
    await saveStatusText(textPath, artifacts.statusText);
    await saveDebugSnapshot(resolveDebugPath(statePath), artifacts.debugSnapshot);
  } catch (e) {
    console.warn('[agent-monitor] Failed to persist snapshot:', e instanceof Error ? e.message : String(e));
  }
};

export const createPersistQueue = <TMeta>(
  statePath: string,
  textPath: string,
  formatArtifacts: (state: SubagentState, meta: TMeta) => PersistedSnapshotArtifacts,
) => {
  const enqueue = createSerializedTaskQueue(async (payload: { state: SubagentState; meta: TMeta }) => {
    await persistSnapshot(statePath, textPath, payload.state, formatArtifacts(payload.state, payload.meta));
  });

  return (state: SubagentState, meta: TMeta): Promise<void> => enqueue({ state: structuredClone(state), meta });
};
