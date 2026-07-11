import type { SubagentChild } from '../../domain/types.ts';
import type { SQLiteRecoveryRow } from './script.ts';

const NEVER_STARTED_HARD_STALE_AFTER_MS = 30 * 60_000;

const toISOString = (timestampMs: number): string => {
  return new Date(timestampMs).toISOString();
};

export type MappedRecoveredChild = {
  child: SubagentChild;
  protectedTerminalSessionID?: string;
};

export const mapRecoveredChild = (row: SQLiteRecoveryRow, hardStaleAfterMs: number): MappedRecoveredChild => {
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
