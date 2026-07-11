import type { SubagentChild } from '../types.ts';

import { timestampMs } from '../../../../kit/coercion.ts';
import { isTerminalStatus, childEvidenceTimestampMs } from './maintenance.ts';

interface TimingPreservation {
  preserveExistingTiming: boolean;
  preserveSameTerminalTiming: boolean;
  reopenTerminal: boolean;
}

export type ResolvedChildTiming = {
  status: SubagentChild['status'];
  updatedAt: string;
  endedAt: string | undefined;
  preserveSameTerminalTiming: boolean;
};

export const isKnownStatus = (status: SubagentChild['status'] | undefined): status is SubagentChild['status'] =>
  status === 'done' || status === 'error' || status === 'stale' || status === 'running';

export const resolveIncomingStatus = (
  input: Partial<Pick<SubagentChild, 'status'>>,
  existing: SubagentChild | undefined,
): SubagentChild['status'] => (isKnownStatus(input.status) ? input.status : (existing?.status ?? 'running'));

// Source resolution prefers the incoming value, falls back to the
// stored one, and as a last resort infers 'session' from a ses_-prefixed id.
// Keeping the chain isolated makes the precedence readable in one place.
export const resolveSourceForUpsert = (
  input: Pick<SubagentChild, 'id' | 'source'>,
  existing: SubagentChild | undefined,
): SubagentChild['source'] => input.source ?? existing?.source ?? (input.id.startsWith('ses_') ? 'session' : undefined);

const shouldPreserveSameTerminalTiming = (
  existing: SubagentChild | undefined,
  nextStatus: SubagentChild['status'],
): boolean => {
  return Boolean(existing && isTerminalStatus(existing.status) && existing.status === nextStatus);
};

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

// Resolves the status + timestamps the upsert should commit. Pulled out of
// upsertRunningChild so the timing policy lives in one named unit and the
// orchestrator only has to read the result.
export const resolveChildTiming = (
  existing: SubagentChild | undefined,
  observedUpdatedAt: string,
  observedStartedAt: string,
  incomingStatus: SubagentChild['status'],
  inputEndedAt: string | undefined,
  allowTerminalReopen: boolean | undefined,
): ResolvedChildTiming => {
  const incomingEvidenceMs = timestampMs(inputEndedAt ?? observedUpdatedAt ?? observedStartedAt);
  const { preserveExistingTiming, preserveSameTerminalTiming } = computeTimingPreservation(
    existing,
    incomingStatus,
    incomingEvidenceMs,
    allowTerminalReopen,
  );

  if (preserveExistingTiming && existing) {
    return {
      status: existing.status,
      updatedAt: existing.updatedAt,
      endedAt: existing.endedAt,
      preserveSameTerminalTiming,
    };
  }

  const resolvedUpdatedAt = observedUpdatedAt;
  const resolvedEndedAt =
    incomingStatus === 'running' ? undefined : (inputEndedAt ?? existing?.endedAt ?? observedUpdatedAt);
  return {
    status: incomingStatus,
    updatedAt: resolvedUpdatedAt,
    endedAt: resolvedEndedAt,
    preserveSameTerminalTiming,
  };
};
