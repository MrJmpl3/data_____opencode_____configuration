import { join } from 'node:path';
import os from 'node:os';

import type { SubagentChild, SubagentState, SubagentTokens } from '../../domain/types.ts';
import { mergeSubagentTokens, normalizeSubagentTokens } from '../../domain/tokens.ts';
import { deriveTerminalSessionStatus } from '../../domain/session-status.ts';
import { debugLog } from '../../shared/display.ts';
import { isRecord, normalizedString, timestampFromUnknown } from '../../../../kit/coercion.ts';
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

// PartClassification is a discriminated description of what one
// `part` payload means for terminal-status recovery. A single part may carry
// multiple contributions (e.g. a step-start timestamp AND an explicit
// terminal status), so the shape is intentionally additive rather than a
// single tag.
type PartClassification = {
  // step-start timestamp (ms since epoch) when the part is a step-start;
  // undefined when the part is not a step-start or its start time is missing.
  startedAtMs: number | undefined;
  // Explicit terminal evidence (session.error, session.*, or a session-scoped
  // completed part). `endedAtMs` is undefined when the part carries no
  // terminal timestamp — in that case it acts as a status-only fallback.
  // status is `TerminalStatus` (excludes 'running'). The reducer
  // treats anything that is not 'error' as a completion source, preserving
  // the original loop's `status === 'error'` branch.
  explicit: { status: TerminalStatus; endedAtMs: number | undefined } | undefined;
  // Ambiguous terminal evidence from a step-finish part. Only present when
  // the part resolves to a parseable terminal timestamp; otherwise dropped,
  // matching the original `continue` behavior.
  ambiguous: { status: 'done' | 'error'; endedAtMs: number } | undefined;
};

type TerminalStatus = Exclude<SubagentChild['status'], 'running'>;

type RecoveryAccumulator = {
  // Latest (max) step-start timestamp seen across all step-start parts.
  // used as a stale guard for the ambiguous step-finish evidence —
  // if the most recent step-start is newer than the ambiguous finish, we
  // assume the session resumed and prefer `running`.
  latestStepStartAtMs: number;
  // Explicit terminal evidence with a parseable timestamp.
  completedAtMs: number;
  errorAtMs: number;
  completedTokens: SubagentTokens | undefined;
  errorTokens: SubagentTokens | undefined;
  // Explicit terminal evidence WITHOUT a parseable timestamp: we still trust
  // the status, but cannot compute an endedAt. Acts as a last-resort fallback
  // when no timestamped evidence exists.
  fallbackTerminalStatus: TerminalStatus | undefined;
  fallbackTerminalTokens: SubagentTokens | undefined;
  // Ambiguous (step-finish) terminal evidence with a parseable timestamp.
  ambiguousCompletedAtMs: number;
  ambiguousErrorAtMs: number;
  // Union of every raw tokens payload encountered — used as the base when
  // merging the final reported tokens so we never lose partially-seen counts.
  latestTokens: SubagentTokens | undefined;
};

const createEmptyAccumulator = (): RecoveryAccumulator => ({
  latestStepStartAtMs: 0,
  completedAtMs: 0,
  errorAtMs: 0,
  completedTokens: undefined,
  errorTokens: undefined,
  fallbackTerminalStatus: undefined,
  fallbackTerminalTokens: undefined,
  ambiguousCompletedAtMs: 0,
  ambiguousErrorAtMs: 0,
  latestTokens: undefined,
});

const classifyPartStatus = (part: unknown): PartClassification | undefined => {
  if (!isRecord(part)) return undefined;

  const state = isRecord(part.state) ? part.state : undefined;

  let startedAtMs: number | undefined;
  if (normalizedString(part.type) === 'step-start') {
    const startedAt = resolvePartStartTimestamp(part);
    if (startedAt) {
      const parsed = Date.parse(startedAt);
      startedAtMs = Number.isNaN(parsed) ? undefined : parsed;
    }
  }

  let explicit: PartClassification['explicit'];
  const explicitStatus = resolveExplicitSessionTerminalStatus(part, state);
  if (explicitStatus) {
    const endedAt = resolvePartTerminalTimestamp(part);
    let endedAtMs: number | undefined;
    if (endedAt) {
      const parsed = Date.parse(endedAt);
      endedAtMs = Number.isNaN(parsed) ? undefined : parsed;
    }
    explicit = { status: explicitStatus, endedAtMs };
  }

  let ambiguous: PartClassification['ambiguous'];
  if (!explicit) {
    const ambiguousStatus = resolveAmbiguousStepFinishStatus(part);
    if (ambiguousStatus) {
      const endedAt = resolvePartTerminalTimestamp(part);
      if (endedAt) {
        const parsed = Date.parse(endedAt);
        if (!Number.isNaN(parsed)) {
          ambiguous = { status: ambiguousStatus, endedAtMs: parsed };
        }
      }
    }
  }

  return { startedAtMs, explicit, ambiguous };
};

// foldPart applies one classified part's contributions to the
// accumulator. It is the only place that mutates accumulator state, so the
// reduction shape stays auditable: every branch here corresponds to a
// distinct recovery evidence source.
const foldPart = (acc: RecoveryAccumulator, part: unknown): RecoveryAccumulator => {
  const classification = classifyPartStatus(part);
  if (!classification) return acc;

  const rawTokens = normalizeSubagentTokens(isRecord(part) ? part.tokens : undefined);
  acc.latestTokens = mergeSubagentTokens(acc.latestTokens, rawTokens);

  if (classification.startedAtMs !== undefined) {
    acc.latestStepStartAtMs = Math.max(acc.latestStepStartAtMs, classification.startedAtMs);
  }

  if (classification.explicit) {
    const { status, endedAtMs } = classification.explicit;
    if (endedAtMs === undefined) {
      // status-only fallback (no terminal timestamp). The original
      // loop overwrote this on every such part; we preserve that last-wins
      // semantic for compatibility.
      acc.fallbackTerminalStatus = status;
      acc.fallbackTerminalTokens = mergeSubagentTokens(acc.fallbackTerminalTokens, rawTokens);
    } else if (status === 'error') {
      if (endedAtMs >= acc.errorAtMs) {
        acc.errorAtMs = endedAtMs;
        acc.errorTokens = mergeSubagentTokens(acc.errorTokens, rawTokens);
      }
    } else if (endedAtMs >= acc.completedAtMs) {
      acc.completedAtMs = endedAtMs;
      acc.completedTokens = mergeSubagentTokens(acc.completedTokens, rawTokens);
    }
  } else if (classification.ambiguous) {
    const { status, endedAtMs } = classification.ambiguous;
    if (status === 'error') {
      if (endedAtMs >= acc.ambiguousErrorAtMs) {
        acc.ambiguousErrorAtMs = endedAtMs;
        acc.errorTokens = mergeSubagentTokens(acc.errorTokens, rawTokens);
      }
    } else if (endedAtMs >= acc.ambiguousCompletedAtMs) {
      acc.ambiguousCompletedAtMs = endedAtMs;
      acc.completedTokens = mergeSubagentTokens(acc.completedTokens, rawTokens);
    }
  }

  return acc;
};

// decideRecoveredStatus encodes the priority of evidence sources
// observed during recovery. Order matters:
//   1. Explicit terminal with a timestamp wins (error beats done on ties).
//   2. Explicit terminal without a timestamp is a status-only fallback.
//   3. Ambiguous step-finish evidence is used only when it is at least as
//      new as the most recent step-start (else the session likely resumed).
const decideRecoveredStatus = (acc: RecoveryAccumulator): RecoveredStatus => {
  if (acc.errorAtMs > acc.completedAtMs) {
    const endedAt = toISOString(acc.errorAtMs);

    return {
      status: 'error',
      updatedAt: endedAt,
      endedAt,
      tokens: mergeSubagentTokens(acc.latestTokens, acc.errorTokens),
      evidence: 'explicit',
    };
  }

  if (acc.completedAtMs > 0) {
    const endedAt = toISOString(acc.completedAtMs);

    return {
      status: 'done',
      updatedAt: endedAt,
      endedAt,
      tokens: mergeSubagentTokens(acc.latestTokens, acc.completedTokens),
      evidence: 'explicit',
    };
  }

  if (acc.fallbackTerminalStatus) {
    return {
      status: acc.fallbackTerminalStatus,
      updatedAt: undefined,
      endedAt: undefined,
      tokens: mergeSubagentTokens(acc.latestTokens, acc.fallbackTerminalTokens),
      evidence: 'explicit',
    };
  }

  const ambiguousStatus: TerminalStatus = acc.ambiguousErrorAtMs > acc.ambiguousCompletedAtMs ? 'error' : 'done';
  const ambiguousAtMs = Math.max(acc.ambiguousCompletedAtMs, acc.ambiguousErrorAtMs);
  if (ambiguousAtMs > 0 && ambiguousAtMs >= acc.latestStepStartAtMs) {
    const endedAt = toISOString(ambiguousAtMs);

    return {
      status: ambiguousStatus,
      updatedAt: endedAt,
      endedAt,
      tokens: mergeSubagentTokens(
        acc.latestTokens,
        ambiguousStatus === 'error' ? acc.errorTokens : acc.completedTokens,
      ),
      evidence: 'ambiguous',
    };
  }

  return {
    status: 'running',
    updatedAt: undefined,
    endedAt: undefined,
    tokens: acc.latestTokens,
  };
};

export const resolveRecoveredStatus = (parts: readonly unknown[]): RecoveredStatus => {
  if (parts.length === 0) {
    return { status: 'running', updatedAt: undefined, endedAt: undefined, tokens: undefined };
  }

  // the reducer loop replaces the previous 10+ mutable accumulators
  // with a single accumulator object, keeping the fold step local and pure
  // (returning a new acc, never mutating the caller's).
  const accumulator = parts.reduce<RecoveryAccumulator>(foldPart, createEmptyAccumulator());
  return decideRecoveredStatus(accumulator);
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

// `readRows` is an optional seam so unit tests can inject a fake
// row provider. Production callers rely on the default which spawns the
// Python recovery script. The default value is computed lazily so tests that
// pass a stub never touch `node:fs` or the `python3` binary.
export type ReadSQLiteRecoveryRows = (databasePath: string, parentSessionID: string) => Promise<SQLiteRecoveryRow[]>;

export const createSQLiteRecoverySource = (
  input: { databasePath?: string; hardStaleAfterMs?: number; readRows?: ReadSQLiteRecoveryRows } = {},
): RecoverySource => {
  const databasePath = input.databasePath ?? resolveOpenCodeDatabasePath();
  const hardStaleAfterMs = Math.max(
    0,
    Math.floor(input.hardStaleAfterMs ?? DEFAULT_STALE_RUNNING_PROBE_POLICY.hardStaleAfterMs),
  );
  const readRows = input.readRows ?? readSQLiteRecoveryRows;

  return {
    hydrateState: async (state: SubagentState, context: RecoveryContext): Promise<RecoveryResult | undefined> => {
      const parentSessionID = context.parentSessionID;
      if (!parentSessionID) {
        debugLog('[subagent-status] hydrateState: no parentSessionID, skipping');
        return undefined;
      }

      debugLog(`[subagent-status] hydrateState: parent=${parentSessionID} db=${databasePath}`);
      const rows = await readRows(databasePath, parentSessionID);
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
