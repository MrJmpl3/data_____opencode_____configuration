// Stale-probe logic — detect zombie/stale sessions.
//
// Originally part of refresh.ts; extracted here to reduce file sprawl.

import { childEvidenceTimestampMs } from '../../domain/state/maintenance.ts';
import { isRealSessionChild } from '../../domain/state/core.ts';
import { markChildStatus } from '../../domain/state/mutations.ts';
import type { SubagentChild, SubagentState } from '../../domain/types.ts';
import { debugLog } from '../../shared/display.ts';

import type { StaleRunningProbePolicy } from '../options.ts';
import { resolveChildSessionId as resolveSessionRowSessionId } from '../session/navigate.ts';

export type StaleRunningProbeState = {
  attempts: number;
  missingRunningEvidenceAttempts: number;
  lastSeenUpdatedAt: string;
  nextProbeAtMs: number;
};

const finiteProbeCounter = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined;
};

const normalizeProbeCounter = (value: unknown): number => {
  return finiteProbeCounter(value) ?? 0;
};

const previousProbeCounter = (
  previous: StaleRunningProbeState | undefined,
  childUpdatedAt: string,
  key: keyof StaleRunningProbeState,
): number => {
  if (!previous || previous.lastSeenUpdatedAt !== childUpdatedAt) return 0;

  return normalizeProbeCounter(previous[key]);
};

const previousMissingRunningEvidenceAttempts = (
  previous: StaleRunningProbeState | undefined,
  childUpdatedAt: string,
): number => {
  return previousProbeCounter(previous, childUpdatedAt, 'missingRunningEvidenceAttempts');
};

export const nextStaleRunningBackoffMs = (attempts: number, policy: StaleRunningProbePolicy): number => {
  return Math.min(policy.baseBackoffMs * 2 ** Math.max(0, attempts - 1), policy.maxBackoffMs);
};

export const resolveStaleRunningProbeTargets = (
  state: SubagentState,
  probeStateBySessionId: Map<string, StaleRunningProbeState>,
  policy: StaleRunningProbePolicy,
  nowMs: number,
): string[] => {
  const activeRunningSessionIds = new Set<string>();
  const targetSessionIds: string[] = [];

  for (const child of Object.values(state.children)) {
    if (!isRealSessionChild(child) || child.status !== 'running') continue;

    const sessionId = resolveSessionRowSessionId(child);
    if (!sessionId) continue;

    activeRunningSessionIds.add(sessionId);
    const existing = probeStateBySessionId.get(sessionId);

    if (!existing) {
      targetSessionIds.push(sessionId);
      continue;
    }

    if (existing.lastSeenUpdatedAt !== child.updatedAt) {
      probeStateBySessionId.set(sessionId, {
        attempts: 0,
        missingRunningEvidenceAttempts: 0,
        lastSeenUpdatedAt: child.updatedAt,
        nextProbeAtMs: nowMs + policy.baseBackoffMs,
      });
      continue;
    }

    if (nowMs < existing.nextProbeAtMs) continue;
    targetSessionIds.push(sessionId);
  }

  for (const sessionId of [...probeStateBySessionId.keys()]) {
    if (!activeRunningSessionIds.has(sessionId)) {
      probeStateBySessionId.delete(sessionId);
    }
  }

  return targetSessionIds;
};

// Grouping the four probe-evolution knobs into a single context keeps
// the call-site self-documenting and leaves the hot loop signature small. The
// orchestrator already has these four values in scope together, so passing them
// as a tuple would just rename the same arg list — an explicit object pays for
// itself by surviving future additions (e.g. metrics, cancellation tokens) without
// breaking every caller.
export type SettleStaleProbeContext = {
  authoritativeSessionIDs: ReadonlySet<string>;
  runningEvidenceSessionIDs: ReadonlySet<string>;
  policy: StaleRunningProbePolicy;
  nowMs: number;
};

export const settleStaleRunningProbeTargets = (
  state: SubagentState,
  probeStateBySessionId: Map<string, StaleRunningProbeState>,
  sessionIds: string[],
  context: SettleStaleProbeContext,
): boolean => {
  const { authoritativeSessionIDs, runningEvidenceSessionIDs, policy, nowMs } = context;
  let changed = false;

  for (const sessionId of sessionIds) {
    const child = Object.values(state.children).find(
      (candidate) => isRealSessionChild(candidate) && resolveSessionRowSessionId(candidate) === sessionId,
    );

    if (!child || child.status !== 'running') {
      probeStateBySessionId.delete(sessionId);
      continue;
    }

    const previous = probeStateBySessionId.get(sessionId);
    const attempts = Math.min(policy.maxAttempts, previousProbeCounter(previous, child.updatedAt, 'attempts') + 1);
    const hasRunningEvidence = runningEvidenceSessionIDs.has(sessionId);
    const hasAuthoritativePresenceGuard = authoritativeSessionIDs.has(sessionId);
    const childEvidenceMs = childEvidenceTimestampMs(child);
    const hasExceededHardStaleAge = policy.hardStaleAfterMs > 0 && nowMs - childEvidenceMs >= policy.hardStaleAfterMs;
    const missingRunningEvidenceAttempts =
      hasRunningEvidence || hasAuthoritativePresenceGuard
        ? 0
        : Math.min(policy.maxAttempts, previousMissingRunningEvidenceAttempts(previous, child.updatedAt) + 1);

    const hasExceededInactiveThreshold =
      !hasRunningEvidence && policy.inactiveThresholdMs > 0 && nowMs - childEvidenceMs >= policy.inactiveThresholdMs;

    if (
      hasExceededHardStaleAge ||
      hasExceededInactiveThreshold ||
      (!hasRunningEvidence && !hasAuthoritativePresenceGuard && missingRunningEvidenceAttempts >= policy.maxAttempts)
    ) {
      console.warn(
        `[agent-monitor] stale-probe: marking ${sessionId} as error (hardStale=${hasExceededHardStaleAge} inactiveThreshold=${hasExceededInactiveThreshold} runningEvidence=${hasRunningEvidence} authGuard=${hasAuthoritativePresenceGuard} missingAttempts=${missingRunningEvidenceAttempts})`,
      );
      const errorAt = new Date(Math.max(nowMs, childEvidenceMs)).toISOString();
      const marked = markChildStatus(state, child.id, 'error', errorAt);

      if (marked) {
        probeStateBySessionId.delete(sessionId);
        changed = true;
        continue;
      }
    }

    probeStateBySessionId.set(sessionId, {
      attempts,
      missingRunningEvidenceAttempts,
      lastSeenUpdatedAt: child.updatedAt,
      nextProbeAtMs: nowMs + nextStaleRunningBackoffMs(attempts, policy),
    });
  }

  return changed;
};

// Re-export to satisfy consumers that import the child type via this module.
export type { SubagentChild };
