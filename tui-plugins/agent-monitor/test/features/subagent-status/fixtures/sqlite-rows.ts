// ponytail: in-memory simulation of the Python `recovery.py` script.
//
// The real recovery pipeline lives in
// `src/features/subagent-status/infrastructure/sqlite/recovery.py` and runs
// inside a `python3` subprocess. For unit tests we want to avoid the
// subprocess dependency, so this fixture reproduces the same final shape
// (`SQLiteRecoveryRow[]`) that the Python script emits.
//
// The TypeScript `resolveRecoveredStatus` reducer exposed by `hydrate.ts`
// is intentionally close to the Python logic, but it does NOT see the row
// `timeUpdated` value — and the Python pipeline uses that column as a
// fallback for ambiguous step-finish timestamps. We therefore re-implement
// the classification here, mirroring `recovery.py` line for line.

import type { SubagentChild, SubagentTokens } from '../../../../src/features/subagent-status/domain/types.ts';
import type { SQLiteRecoveryRow } from '../../../../src/features/subagent-status/infrastructure/sqlite/script.ts';

type PartInput = {
  data: Record<string, unknown>;
  timeUpdated: number;
};

type SessionInput = {
  id: string;
  parentID: string;
  title: string;
  agent?: string;
  timeCreated: number;
  timeUpdated: number;
  tokensInput?: number;
  tokensOutput?: number;
  parts?: PartInput[];
};

type Accumulator = {
  explicit: 'done' | 'error' | null;
  completedMs: number;
  errorMs: number;
  ambiguousCompletedMs: number;
  ambiguousErrorMs: number;
  latestStepStartMs: number;
  stepStartCount: number;
  partCount: number;
  tokens: SubagentTokens;
};

const TERMINAL_KEYWORDS = new Set(['done', 'error']);

const toFiniteMs = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
};

const pickTime = (timeObj: unknown, stateObj: unknown, keys: readonly string[]): number | undefined => {
  const candidates: unknown[] = [];
  if (timeObj && typeof timeObj === 'object') {
    for (const key of keys) candidates.push((timeObj as Record<string, unknown>)[key]);
  }
  if (stateObj && typeof stateObj === 'object') {
    for (const key of keys) candidates.push((stateObj as Record<string, unknown>)[key]);
  }
  for (const candidate of candidates) {
    const ms = toFiniteMs(candidate);
    if (ms !== undefined) return ms;
  }
  return undefined;
};

const terminalReasonFrom = (value: unknown): 'done' | 'error' | null => {
  if (typeof value !== 'string') return null;
  const lowered = value.toLowerCase().trim();
  if (lowered === 'done' || lowered === 'error') return lowered;
  for (const terminal of TERMINAL_KEYWORDS) {
    if (lowered.includes(terminal)) return terminal as 'done' | 'error';
  }
  if (['completed', 'complete', 'success', 'succeeded', 'finished'].includes(lowered)) return 'done';
  if (['failed', 'failure', 'cancelled', 'canceled', 'aborted', 'abandoned'].includes(lowered)) return 'error';
  return null;
};

const mergeTokenField = (
  target: SubagentTokens,
  key: 'input' | 'output' | 'total' | 'contextPercent',
  value: unknown,
): void => {
  const numeric = toFiniteMs(value);
  if (numeric === undefined) return;
  const current = target[key];
  if (current === undefined || numeric > current) {
    target[key] = numeric;
  }
};

const extractPartTokens = (part: Record<string, unknown>): SubagentTokens | undefined => {
  const raw = part.tokens;
  if (!raw || typeof raw !== 'object') return undefined;
  const tokens: SubagentTokens = {};
  mergeTokenField(tokens, 'input', (raw as Record<string, unknown>).input);
  mergeTokenField(tokens, 'output', (raw as Record<string, unknown>).output);
  mergeTokenField(tokens, 'total', (raw as Record<string, unknown>).total);
  mergeTokenField(tokens, 'contextPercent', (raw as Record<string, unknown>).contextPercent);
  return Object.keys(tokens).length > 0 ? tokens : undefined;
};

type ClassifyResult = {
  explicit: 'done' | 'error' | null;
  endedMs: number | null;
  errorMs: number | null;
};

const classifyPart = (
  part: Record<string, unknown>,
  state: Record<string, unknown> | undefined,
  rowUpdatedMs: number,
): ClassifyResult => {
  const partType = typeof part.type === 'string' ? part.type : '';

  if (partType === 'session.error') {
    const ended = pickTime(part.time, state, ['end', 'ended', 'completed', 'updated', 'created']) ?? rowUpdatedMs;
    return { explicit: 'error', endedMs: ended, errorMs: ended };
  }

  if (partType.startsWith('session.') || partType === 'completed') {
    const stateStatus = state?.status;
    const partStatus = part.status;
    const partState = part.state;
    const explicit =
      terminalReasonFrom(stateStatus) ??
      terminalReasonFrom(partStatus) ??
      terminalReasonFrom(partState) ??
      (state?.error || part.error ? 'error' : null);
    if (explicit === null) return { explicit: null, endedMs: null, errorMs: null };
    const ended = pickTime(part.time, state, ['completed', 'end', 'ended', 'updated', 'created']) ?? rowUpdatedMs;
    if (explicit === 'error') return { explicit, endedMs: ended, errorMs: ended };
    return { explicit, endedMs: ended, errorMs: null };
  }

  if (partType === 'step-finish') {
    if (part.error) {
      const ended = pickTime(part.time, state, ['end', 'ended', 'updated', 'created']) ?? rowUpdatedMs;
      return { explicit: null, endedMs: null, errorMs: ended };
    }
    const reason = typeof part.reason === 'string' ? part.reason : '';
    if (reason === 'stop' || reason === 'completed') {
      const ended = pickTime(part.time, state, ['end', 'ended', 'updated', 'created']) ?? rowUpdatedMs;
      return { explicit: null, endedMs: ended, errorMs: null };
    }
    return { explicit: null, endedMs: null, errorMs: null };
  }

  return { explicit: null, endedMs: null, errorMs: null };
};

const foldSession = (session: SessionInput): SQLiteRecoveryRow => {
  const parts = session.parts ?? [];
  const stepStartCount = parts.filter((part) => part.data.type === 'step-start').length;

  const acc: Accumulator = {
    explicit: null,
    completedMs: 0,
    errorMs: 0,
    ambiguousCompletedMs: 0,
    ambiguousErrorMs: 0,
    latestStepStartMs: 0,
    stepStartCount,
    partCount: parts.length,
    tokens: {},
  };

  for (const part of parts) {
    acc.partCount = parts.length; // matches Python (it counts even malformed parts)
    const partType = typeof part.data.type === 'string' ? part.data.type : '';
    const partState =
      part.data.state && typeof part.data.state === 'object' ? (part.data.state as Record<string, unknown>) : undefined;
    const partTokens = extractPartTokens(part.data);
    if (partTokens) {
      for (const [key, value] of Object.entries(partTokens)) {
        if (typeof value === 'number') {
          mergeTokenField(acc.tokens, key as keyof SubagentTokens, value);
        }
      }
    }
    if (partType === 'step-start') {
      const start = pickTime(part.data.time, partState, ['start', 'started', 'created', 'updated']) ?? part.timeUpdated;
      if (start > 0) acc.latestStepStartMs = Math.max(acc.latestStepStartMs, start);
      continue;
    }
    const { explicit, endedMs, errorMs } = classifyPart(part.data, partState, part.timeUpdated);
    if (explicit !== null) {
      acc.explicit = explicit;
      if (endedMs !== null) {
        if (explicit === 'error') acc.errorMs = Math.max(acc.errorMs, endedMs);
        else acc.completedMs = Math.max(acc.completedMs, endedMs);
      }
    }
    if (endedMs === null && partType === 'step-finish') {
      // python uses row[3] (time_updated) as the fallback
    }
    if (
      partType === 'step-finish' &&
      (part.data.reason === 'stop' || part.data.reason === 'completed') &&
      endedMs !== null
    ) {
      acc.ambiguousCompletedMs = Math.max(acc.ambiguousCompletedMs, endedMs);
    }
    if (errorMs !== null) {
      acc.ambiguousErrorMs = Math.max(acc.ambiguousErrorMs, errorMs);
    }
  }

  // Merge row-level token columns (parts win when newer).
  if (session.tokensInput !== undefined) mergeTokenField(acc.tokens, 'input', session.tokensInput);
  if (session.tokensOutput !== undefined) mergeTokenField(acc.tokens, 'output', session.tokensOutput);
  const tokens: SubagentTokens | undefined = Object.keys(acc.tokens).length > 0 ? acc.tokens : undefined;

  // Derive status using the same priority as `recovery.py`.
  let status: SubagentChild['status'] = 'running';
  let evidence: 'explicit' | 'ambiguous' | null = null;
  let endedMs = 0;

  if (acc.explicit === 'error' && acc.errorMs > 0) {
    status = 'error';
    evidence = 'explicit';
    endedMs = acc.errorMs;
  } else if (acc.completedMs > 0 && (acc.explicit === 'done' || acc.completedMs >= acc.errorMs)) {
    status = 'done';
    evidence = 'explicit';
    endedMs = acc.completedMs;
  } else if (acc.errorMs > acc.completedMs && acc.errorMs > 0) {
    status = 'error';
    evidence = 'explicit';
    endedMs = acc.errorMs;
  } else if (
    acc.ambiguousCompletedMs > 0 &&
    acc.ambiguousCompletedMs >= acc.latestStepStartMs &&
    acc.ambiguousCompletedMs >= acc.ambiguousErrorMs
  ) {
    status = 'done';
    evidence = 'ambiguous';
    endedMs = acc.ambiguousCompletedMs;
  } else if (acc.ambiguousErrorMs > 0 && acc.ambiguousErrorMs > acc.ambiguousCompletedMs) {
    status = 'error';
    evidence = 'ambiguous';
    endedMs = acc.ambiguousErrorMs;
  }

  return {
    id: session.id,
    parentID: session.parentID,
    title: session.title,
    agentName: session.agent,
    startedAtMs: session.timeCreated,
    updatedAtMs: session.timeUpdated,
    endedAtMs: endedMs,
    partCount: parts.length,
    stepStartCount,
    status,
    evidence,
    tokens,
  };
};

/**
 * Build `SQLiteRecoveryRow[]` from in-memory session + part data.
 *
 * Mirrors what the Python recovery script would emit for the same input.
 * Pass one entry per session, with `parts` listing each row in the `part`
 * table that belongs to that session.
 */
export const simulateSQLiteRecoveryRows = (sessions: readonly SessionInput[]): SQLiteRecoveryRow[] => {
  return sessions.map(foldSession);
};

export type { SQLiteRecoveryRow, PartInput, SessionInput };
