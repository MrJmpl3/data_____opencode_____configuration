import { join } from 'node:path';
import os from 'node:os';

import type { SubagentChild, SubagentState, SubagentTokens } from '../../domain/types.ts';
import { mergeSubagentTokens, normalizeSubagentTokens } from '../../domain/tokens.ts';
import { deriveTerminalSessionStatus } from '../../domain/session-status.ts';
import { debugLog } from '../../shared/display.ts';
import { isPlainObject as isRecord, normalizedString, timestampFromUnknown } from '../../../../kit/coercion.ts';
import { DEFAULT_STALE_RUNNING_PROBE_POLICY } from '../../runtime/options.ts';

import { applyRecoveredChildren } from '../recovery.ts';
import type { RecoveryContext, RecoveryResult, RecoverySource } from '../recovery.ts';
import { readSQLiteRecoveryRows, type SQLiteRecoveryRow } from './script.ts';

type RecoveredStatusEvidence = 'explicit' | 'ambiguous';

type RecoveredStatus = {
  status: SubagentChild['status'];
  endedAt?: string;
  updatedAt?: string;
  tokens?: SubagentTokens;
  evidence?: RecoveredStatusEvidence;
};

type MappedRecoveredChild = {
  child: SubagentChild;
  protectedTerminalSessionID?: string;
};

const NEVER_STARTED_HARD_STALE_AFTER_MS = 30 * 60_000;

const toISOString = (timestampMs: number): string => {
  return new Date(timestampMs).toISOString();
};

const resolveOpenCodeDatabasePath = (): string => {
  const baseDir = process.env.XDG_DATA_HOME ?? join(os.homedir(), '.local', 'share');
  return join(baseDir, 'opencode', 'opencode.db');
};

const resolvePartTerminalTimestamp = (part: Record<string, unknown>): string | undefined => {
  const state = isRecord(part.state) ? part.state : undefined;
  const time = isRecord(part.time) ? part.time : undefined;

  return (
    timestampFromUnknown(time?.end) ??
    timestampFromUnknown(time?.ended) ??
    timestampFromUnknown(time?.completed) ??
    timestampFromUnknown(time?.updated) ??
    timestampFromUnknown(state?.completed) ??
    timestampFromUnknown(state?.ended) ??
    timestampFromUnknown(state?.end) ??
    timestampFromUnknown(state?.updated)
  );
};

const resolvePartStartTimestamp = (part: Record<string, unknown>): string | undefined => {
  const state = isRecord(part.state) ? part.state : undefined;
  const time = isRecord(part.time) ? part.time : undefined;

  return (
    timestampFromUnknown(time?.start) ??
    timestampFromUnknown(time?.started) ??
    timestampFromUnknown(time?.created) ??
    timestampFromUnknown(time?.updated) ??
    timestampFromUnknown(state?.started) ??
    timestampFromUnknown(state?.start) ??
    timestampFromUnknown(state?.created) ??
    timestampFromUnknown(state?.updated)
  );
};

const resolveExplicitSessionTerminalStatus = (
  part: Record<string, unknown>,
  state: Record<string, unknown> | undefined,
): Exclude<SubagentChild['status'], 'running'> | undefined => {
  const type = normalizedString(part.type);
  if (type === 'session.error') return 'error';

  const isSessionScopedTerminal = Boolean(type && (type.startsWith('session.') || type === 'completed'));
  if (!isSessionScopedTerminal) return undefined;

  return (
    deriveTerminalSessionStatus(state?.status ?? part.status ?? state ?? part) ??
    (part.error || state?.error ? 'error' : undefined)
  );
};

const resolveAmbiguousStepFinishStatus = (part: Record<string, unknown>): 'done' | 'error' | undefined => {
  if (normalizedString(part.type) !== 'step-finish') return undefined;
  if (part.error) return 'error';

  const reason = normalizedString(part.reason ?? part.status ?? part.state);
  const terminalReason = deriveTerminalSessionStatus(reason);
  if (terminalReason === 'done' || terminalReason === 'error') return terminalReason;

  return reason === 'stop' ? 'done' : undefined;
};

export const resolveRecoveredStatus = (parts: readonly unknown[]): RecoveredStatus => {
  let completedAtMs = 0;
  let errorAtMs = 0;
  let ambiguousCompletedAtMs = 0;
  let ambiguousErrorAtMs = 0;
  let latestStepStartAtMs = 0;
  let fallbackTerminalStatus: Exclude<SubagentChild['status'], 'running'> | undefined;
  let fallbackTerminalTokens: SubagentTokens | undefined;
  let latestTokens: SubagentTokens | undefined;
  let completedTokens: SubagentTokens | undefined;
  let errorTokens: SubagentTokens | undefined;

  if (parts.length === 0) {
    return { status: 'running', updatedAt: undefined, endedAt: undefined, tokens: undefined };
  }

  for (const part of parts) {
    if (!isRecord(part)) continue;

    const state = isRecord(part.state) ? part.state : undefined;
    const rawTokens = normalizeSubagentTokens(part.tokens);
    latestTokens = mergeSubagentTokens(latestTokens, rawTokens);

    if (normalizedString(part.type) === 'step-start') {
      const startedAt = resolvePartStartTimestamp(part);
      if (startedAt) {
        const startedAtMs = Date.parse(startedAt);
        latestStepStartAtMs = Number.isNaN(startedAtMs)
          ? latestStepStartAtMs
          : Math.max(latestStepStartAtMs, startedAtMs);
      }
    }

    const status = resolveExplicitSessionTerminalStatus(part, state);
    if (!status) {
      const ambiguousStatus = resolveAmbiguousStepFinishStatus(part);
      if (!ambiguousStatus) continue;

      const endedAt = resolvePartTerminalTimestamp(part);
      if (!endedAt) continue;

      const endedAtMs = Date.parse(endedAt);
      if (Number.isNaN(endedAtMs)) continue;

      if (ambiguousStatus === 'error') {
        if (endedAtMs >= ambiguousErrorAtMs) {
          ambiguousErrorAtMs = endedAtMs;
          errorTokens = mergeSubagentTokens(errorTokens, rawTokens);
        }
        continue;
      }

      if (endedAtMs >= ambiguousCompletedAtMs) {
        ambiguousCompletedAtMs = endedAtMs;
        completedTokens = mergeSubagentTokens(completedTokens, rawTokens);
      }
      continue;
    }

    const endedAt = resolvePartTerminalTimestamp(part);
    if (!endedAt) {
      fallbackTerminalStatus = status;
      fallbackTerminalTokens = mergeSubagentTokens(fallbackTerminalTokens, rawTokens);
      continue;
    }

    const endedAtMs = Date.parse(endedAt);
    if (status === 'error') {
      if (endedAtMs >= errorAtMs) {
        errorAtMs = endedAtMs;
        errorTokens = mergeSubagentTokens(errorTokens, rawTokens);
      }

      continue;
    }

    if (endedAtMs >= completedAtMs) {
      completedAtMs = endedAtMs;
      completedTokens = mergeSubagentTokens(completedTokens, rawTokens);
    }
  }

  if (errorAtMs > completedAtMs) {
    const endedAt = toISOString(errorAtMs);

    return {
      status: 'error',
      updatedAt: endedAt,
      endedAt,
      tokens: mergeSubagentTokens(latestTokens, errorTokens),
      evidence: 'explicit',
    };
  }

  if (completedAtMs > 0) {
    const endedAt = toISOString(completedAtMs);

    return {
      status: 'done',
      updatedAt: endedAt,
      endedAt,
      tokens: mergeSubagentTokens(latestTokens, completedTokens),
      evidence: 'explicit',
    };
  }

  if (fallbackTerminalStatus) {
    return {
      status: fallbackTerminalStatus,
      updatedAt: undefined,
      endedAt: undefined,
      tokens: mergeSubagentTokens(latestTokens, fallbackTerminalTokens),
      evidence: 'explicit',
    };
  }

  const ambiguousStatus = ambiguousErrorAtMs > ambiguousCompletedAtMs ? 'error' : 'done';
  const ambiguousAtMs = Math.max(ambiguousCompletedAtMs, ambiguousErrorAtMs);
  if (ambiguousAtMs > 0 && ambiguousAtMs >= latestStepStartAtMs) {
    const endedAt = toISOString(ambiguousAtMs);

    return {
      status: ambiguousStatus,
      updatedAt: endedAt,
      endedAt,
      tokens: mergeSubagentTokens(latestTokens, ambiguousStatus === 'error' ? errorTokens : completedTokens),
      evidence: 'ambiguous',
    };
  }

  return {
    status: 'running',
    updatedAt: undefined,
    endedAt: undefined,
    tokens: latestTokens,
  };
};

export const safeParseParts = (values: readonly string[]): unknown[] => {
  const parts: unknown[] = [];

  for (const value of values) {
    try {
      parts.push(JSON.parse(value));
    } catch {
      parts.push(undefined);
    }
  }

  return parts;
};

const mapRecoveredChild = (row: SQLiteRecoveryRow, hardStaleAfterMs: number): MappedRecoveredChild => {
  const nowMs = Date.now();
  const isNeverStartedRunningFallback =
    row.status === 'running' && (row.partCount === 0 || (row.partCount > 0 && row.stepStartCount === 0));
  const runningHardStaleAfterMs =
    hardStaleAfterMs > 0 && isNeverStartedRunningFallback
      ? Math.min(hardStaleAfterMs, NEVER_STARTED_HARD_STALE_AFTER_MS)
      : hardStaleAfterMs;
  const isAbandonedRunningFallback =
    runningHardStaleAfterMs > 0 && row.status === 'running' && nowMs - row.updatedAtMs >= runningHardStaleAfterMs;
  const recoveredAtMs = isAbandonedRunningFallback ? Math.max(nowMs, row.updatedAtMs) : row.updatedAtMs;
  const endedAtMsFromRow = row.endedAtMs > 0 ? row.endedAtMs : recoveredAtMs;
  const updatedAt = toISOString(recoveredAtMs);
  const status: SubagentChild['status'] = isAbandonedRunningFallback ? 'error' : row.status;
  const endedAt = isAbandonedRunningFallback ? updatedAt : toISOString(endedAtMsFromRow);
  const protectedTerminalSessionID =
    status !== 'running' && row.evidence !== null && !isAbandonedRunningFallback ? row.id : undefined;

  return {
    child: {
      id: row.id,
      title: row.title,
      agentName: row.agentName,
      parentID: row.parentID,
      source: 'session',
      targetSessionID: row.id,
      status,
      startedAt: toISOString(row.startedAtMs),
      updatedAt,
      endedAt,
      tokens: row.tokens,
    },
    protectedTerminalSessionID,
  };
};

export const createSQLiteRecoverySource = (
  input: { databasePath?: string; hardStaleAfterMs?: number } = {},
): RecoverySource => {
  const databasePath = input.databasePath ?? resolveOpenCodeDatabasePath();
  const hardStaleAfterMs = Math.max(
    0,
    Math.floor(input.hardStaleAfterMs ?? DEFAULT_STALE_RUNNING_PROBE_POLICY.hardStaleAfterMs),
  );

  return {
    hydrateState: async (state: SubagentState, context: RecoveryContext): Promise<RecoveryResult | undefined> => {
      const parentSessionID = context.parentSessionID;
      if (!parentSessionID) {
        debugLog('[subagent-status] hydrateState: no parentSessionID, skipping');
        return undefined;
      }

      debugLog(`[subagent-status] hydrateState: parent=${parentSessionID} db=${databasePath}`);
      const rows = await readSQLiteRecoveryRows(databasePath, parentSessionID);
      debugLog(`[subagent-status] hydrateState: rows=${rows.length}`);
      if (rows.length === 0) return undefined;

      const mappedChildren = rows.map((row) => mapRecoveredChild(row, hardStaleAfterMs));
      const statuses = mappedChildren.map(({ child }) => child.status);
      debugLog(`[subagent-status] hydrateState: statuses=${JSON.stringify(statuses)}`);

      return applyRecoveredChildren(
        state,
        mappedChildren.map(({ child }) => child),
        rows.map((row) => row.id),
        parentSessionID,
        {
          protectedTerminalSessionIDs: mappedChildren
            .map(({ protectedTerminalSessionID }) => protectedTerminalSessionID)
            .filter((sessionId): sessionId is string => Boolean(sessionId)),
        },
      );
    },
  };
};
