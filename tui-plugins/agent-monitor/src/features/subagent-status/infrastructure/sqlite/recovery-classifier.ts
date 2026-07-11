import type { SubagentChild, SubagentTokens } from '../../domain/types.ts';
import { mergeSubagentTokens, normalizeSubagentTokens } from '../../domain/tokens.ts';
import { deriveTerminalSessionStatus } from '../../domain/session-status.ts';
import { isRecord, normalizedString, timestampFromUnknown } from '../../../../kit/coercion.ts';

type RecoveredStatusEvidence = 'explicit' | 'ambiguous';

type TerminalStatus = Exclude<SubagentChild['status'], 'running'>;

export type RecoveredStatus = {
  status: SubagentChild['status'];
  endedAt?: string;
  updatedAt?: string;
  tokens?: SubagentTokens;
  evidence?: RecoveredStatusEvidence;
};

const toISOString = (timestampMs: number): string => {
  return new Date(timestampMs).toISOString();
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
): TerminalStatus | undefined => {
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

// Wraps a decision in the standard terminal-status shape. Keeping the
// constructor isolated from the priority logic makes each branch read as a
// pure "what evidence wins" instead of a verbose object literal.
const terminalStatus = (
  status: TerminalStatus,
  endedAt: string | undefined,
  tokens: SubagentTokens | undefined,
  evidence: RecoveredStatus['evidence'] = 'explicit',
): RecoveredStatus => ({ status, updatedAt: endedAt, endedAt, tokens, evidence });

// Ambiguous step-finish is only trustworthy when it is at least as new as the
// most recent step-start. Older ambiguous finishes are treated as "the
// session likely resumed" and fall through to the running case.
const decideAmbiguousStatus = (acc: RecoveryAccumulator): RecoveredStatus | undefined => {
  const ambiguousAtMs = Math.max(acc.ambiguousCompletedAtMs, acc.ambiguousErrorAtMs);
  if (ambiguousAtMs <= 0 || ambiguousAtMs < acc.latestStepStartAtMs) return undefined;

  const ambiguousStatus: TerminalStatus = acc.ambiguousErrorAtMs > acc.ambiguousCompletedAtMs ? 'error' : 'done';
  const tokens = mergeSubagentTokens(
    acc.latestTokens,
    ambiguousStatus === 'error' ? acc.errorTokens : acc.completedTokens,
  );
  return terminalStatus(ambiguousStatus, toISOString(ambiguousAtMs), tokens, 'ambiguous');
};

// decideRecoveredStatus encodes the priority of evidence sources observed
// during recovery. Each branch is an early-return guard so the order reads
// top-to-bottom without nested conditionals:
//   1. Explicit error with a timestamp beats anything else.
//   2. Explicit done with a timestamp is the next-best signal.
//   3. Status-only fallback (no timestamp) when the event stream stopped.
//   4. Ambiguous step-finish newer than the most recent step-start.
//   5. No terminal evidence — session still running.
const decideRecoveredStatus = (acc: RecoveryAccumulator): RecoveredStatus => {
  if (acc.errorAtMs > acc.completedAtMs) {
    return terminalStatus('error', toISOString(acc.errorAtMs), mergeSubagentTokens(acc.latestTokens, acc.errorTokens));
  }

  if (acc.completedAtMs > 0) {
    return terminalStatus(
      'done',
      toISOString(acc.completedAtMs),
      mergeSubagentTokens(acc.latestTokens, acc.completedTokens),
    );
  }

  if (acc.fallbackTerminalStatus) {
    return terminalStatus(
      acc.fallbackTerminalStatus,
      undefined,
      mergeSubagentTokens(acc.latestTokens, acc.fallbackTerminalTokens),
    );
  }

  const ambiguous = decideAmbiguousStatus(acc);
  if (ambiguous) return ambiguous;

  return { status: 'running', updatedAt: undefined, endedAt: undefined, tokens: acc.latestTokens };
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
