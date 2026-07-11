import type { SubagentChild, SubagentState } from '../../domain/types.ts';
import { deriveSessionStatus, deriveTerminalSessionStatus } from '../../domain/session-status.ts';
import { markChildRunning, markChildStatus } from '../../domain/state/mutations.ts';
import { upsertChildDetails } from '../../domain/state/mutate-details.ts';
import { hasCompleteUsageMetrics } from '../../domain/tokens.ts';
import { hydrateDoneChildTokens as hydrateDoneChildTokensFromLogs } from '../../infrastructure/logs.ts';
import { isRecord, timestampFromUnknown } from '../../../../kit/coercion.ts';

import { resolveChildSessionId as resolveSessionRowSessionId } from '../session/navigate.ts';
import type { MessageActivity } from './message-activity.ts';

export type RunningEvidenceCollector = Set<string>;

export type StatusHydrationOptions = {
  terminalRecoverySessionIDs?: ReadonlySet<string>;
};

// Grouping the two "context" arguments into a single optional object
// keeps the data args (sessionId, children, sessionStatus, messageActivity,
// state) flowing positionally — they're the per-call inputs that every reader
// needs to see. The two trailing knobs (runningEvidenceIDs collector and
// recovery-protection options) are shared state, not call data, and bundling
// them prevents the easy mistake of swapping them at the call site.
export type HydrationContext = {
  runningEvidenceIDs?: RunningEvidenceCollector;
  options?: StatusHydrationOptions;
};

export const isRecoveryProtectedFromRunning = (
  sessionId: string,
  options: StatusHydrationOptions | undefined,
): boolean => {
  return options?.terminalRecoverySessionIDs?.has(sessionId) === true;
};

const isNewerTimestamp = (candidate: string | undefined, baseline: string | undefined): boolean => {
  if (!candidate || !baseline) return false;

  return Date.parse(candidate) > Date.parse(baseline);
};

const sessionStatusEndedAt = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;

  const time = isRecord(value.time) ? value.time : undefined;
  return (
    timestampFromUnknown(time?.completed) ??
    timestampFromUnknown(time?.ended) ??
    timestampFromUnknown(time?.end) ??
    timestampFromUnknown(time?.updated)
  );
};

/**
 * Shared per-session hydration logic.
 *
 * Determines whether a set of children targeting the same session should be
 * marked running or terminal based on the session status and message activity.
 * Returns true if any child state was modified.
 *
 * Callers (wrapper functions) are responsible for reading the session status
 * and message activity according to their source (client API vs TUI state),
 * and for handling any source-specific special cases (e.g. TUI error early
 * path, client running timestamp enrichment).
 */
export const hydrateChildFromSessionActivity = (
  sessionId: string,
  children: SubagentChild[],
  sessionStatus: unknown,
  messageActivity: MessageActivity,
  state: SubagentState,
  context: HydrationContext = {},
): boolean => {
  const runningEvidenceIDs = context.runningEvidenceIDs;
  const options = context.options;
  const status = deriveSessionStatus(sessionStatus);
  const terminalStatus = deriveTerminalSessionStatus(sessionStatus);
  const blockRunningEvidence = isRecoveryProtectedFromRunning(sessionId, options);

  // Running path
  if (status === 'running') {
    if (blockRunningEvidence) return false;

    runningEvidenceIDs?.add(sessionId);
    let changed = false;
    for (const child of children) {
      changed = markChildRunning(state, child.id, messageActivity.latestLiveActivityAt ?? child.updatedAt) || changed;
    }
    return changed;
  }

  // Terminal / validation path
  const nextStatus = terminalStatus ?? messageActivity.summary.status;
  if (nextStatus) {
    if (!terminalStatus && messageActivity.summary.evidence === 'ambiguous' && runningEvidenceIDs?.has(sessionId)) {
      return false;
    }

    let changed = false;
    for (const child of children) {
      const endedAt =
        sessionStatusEndedAt(sessionStatus) ??
        messageActivity.summary.endedAt ??
        messageActivity.latestActivityAt ??
        child.endedAt ??
        child.updatedAt;
      changed = markChildStatus(state, child.id, nextStatus, endedAt) || changed;
    }
    return changed;
  }

  // No terminal status — check for running evidence from newer activity
  if (blockRunningEvidence) return false;

  let changed = false;
  for (const child of children) {
    if (!isNewerTimestamp(messageActivity.latestLiveActivityAt, child.updatedAt)) continue;

    runningEvidenceIDs?.add(sessionId);
    changed = markChildRunning(state, child.id, messageActivity.latestLiveActivityAt) || changed;
  }
  return changed;
};

export const hydrateChildTokensFromLogs = async (state: SubagentState): Promise<boolean> => {
  let changed = false;

  for (const child of Object.values(state.children)) {
    if (child.status !== 'done') continue;
    if (hasCompleteUsageMetrics(child.tokens)) {
      continue;
    }

    const sessionId = resolveSessionRowSessionId(child);
    if (!sessionId) continue;

    const tokens = await hydrateDoneChildTokensFromLogs(sessionId);
    if (!tokens) continue;

    changed = upsertChildDetails(state, child.id, { tokens }) || changed;
  }

  return changed;
};
