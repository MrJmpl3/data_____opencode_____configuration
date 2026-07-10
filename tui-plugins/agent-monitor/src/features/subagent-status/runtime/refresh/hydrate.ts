// Status-hydration logic — fill in missing token data from logs.
//
// Originally part of refresh.ts; extracted here to reduce file sprawl.

import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import { isRecord, normalizedString, timestampFromUnknown } from '../../../../kit/coercion.ts';
import { deriveSessionStatus, deriveTerminalSessionStatus } from '../../domain/session-status.ts';
import { isRealSessionChild } from '../../domain/state/core.ts';
import { markChildRunning, markChildStatus } from '../../domain/state/mutations.ts';
import { upsertChildDetails } from '../../domain/state/mutate-details.ts';
import type { SubagentChild, SubagentState } from '../../domain/types.ts';
import { hasCompleteUsageMetrics } from '../../domain/tokens.ts';
import { hydrateDoneChildTokens as hydrateDoneChildTokensFromLogs } from '../../infrastructure/logs.ts';

import { resolveChildSessionId as resolveSessionRowSessionId } from '../session/navigate.ts';

export type RunningEvidenceCollector = Set<string>;

export type MessageSummary = { status?: 'done' | 'error'; endedAt?: string; evidence?: 'explicit' | 'ambiguous' };

export type MessageActivity = {
  summary: MessageSummary;
  latestActivityAt?: string;
  latestLiveActivityAt?: string;
};

export type StatusHydrationOptions = {
  terminalRecoverySessionIDs?: ReadonlySet<string>;
};

export const isRecoveryProtectedFromRunning = (
  sessionId: string,
  options: StatusHydrationOptions | undefined,
): boolean => {
  return options?.terminalRecoverySessionIDs?.has(sessionId) === true;
};

const messageInfo = (message: unknown): Record<string, unknown> | undefined => {
  const record = isRecord(message) ? message : undefined;
  return isRecord(record?.info) ? record.info : record;
};

const messageTime = (message: unknown, ...keys: string[]): string | undefined => {
  const record = isRecord(message) ? message : undefined;
  const info = messageInfo(message);
  const state = isRecord(record?.state) ? record.state : undefined;
  const sources = [
    isRecord(record?.time) ? record.time : undefined,
    isRecord(info?.time) ? info.time : undefined,
    isRecord(state?.time) ? state.time : undefined,
    state,
    info,
    record,
  ];

  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const timestamp = timestampFromUnknown(source[key]);
      if (timestamp) return timestamp;
    }
  }

  return undefined;
};

const messageActivityAt = (message: unknown): string | undefined => {
  return messageTime(message, 'completed', 'updated', 'created');
};

const messageLiveActivityAt = (message: unknown): string | undefined => {
  return messageTime(message, 'updated', 'created');
};

const latestISOString = (timestampMs: number): string | undefined => {
  return timestampMs > 0 ? new Date(timestampMs).toISOString() : undefined;
};

const maxTimestamp = (currentMs: number, timestamp: string | undefined): number => {
  if (!timestamp) return currentMs;

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? currentMs : Math.max(currentMs, parsed);
};

const resolveStepStartTimestamp = (message: unknown): string | undefined => {
  return messageTime(message, 'start', 'started', 'created', 'updated');
};

const resolveAmbiguousStepFinishStatus = (message: unknown): MessageSummary['status'] => {
  const record = isRecord(message) ? message : undefined;
  const info = messageInfo(message);
  const state = isRecord(record?.state) ? record.state : undefined;
  const type = normalizedString(record?.type ?? info?.type ?? state?.type);
  if (type !== 'step-finish') return undefined;
  if (record?.error || info?.error || state?.error) return 'error';

  const reason = normalizedString(record?.reason ?? info?.reason ?? state?.reason ?? record?.status ?? info?.status);
  const terminalReason = deriveTerminalSessionStatus(reason);
  if (terminalReason === 'done' || terminalReason === 'error') return terminalReason;

  return reason === 'stop' ? 'done' : undefined;
};

const isNewerTimestamp = (candidate: string | undefined, baseline: string | undefined): boolean => {
  if (!candidate || !baseline) return false;

  return Date.parse(candidate) > Date.parse(baseline);
};

export const emptyMessageActivity = (): MessageActivity => ({ summary: {} });

export const analyzeMessages = (messages: readonly unknown[]): MessageActivity => {
  let latestActivityMs = 0;
  let latestLiveActivityMs = 0;
  let completedAtMs = 0;
  let errorAtMs = 0;
  let ambiguousCompletedAtMs = 0;
  let ambiguousErrorAtMs = 0;
  let latestStepStartAtMs = 0;

  for (const message of messages) {
    latestActivityMs = maxTimestamp(latestActivityMs, messageActivityAt(message));
    latestLiveActivityMs = maxTimestamp(latestLiveActivityMs, messageLiveActivityAt(message));

    const record = isRecord(message) ? message : undefined;
    const info = messageInfo(message);
    const state = isRecord(record?.state) ? record.state : undefined;
    const status =
      deriveTerminalSessionStatus(state?.status ?? info?.status ?? record?.status ?? state ?? info ?? record) ??
      (record?.error || info?.error || state?.error ? 'error' : undefined);
    const type = normalizedString(record?.type ?? info?.type ?? state?.type);
    if (type === 'step-start') {
      latestStepStartAtMs = maxTimestamp(latestStepStartAtMs, resolveStepStartTimestamp(message));
    }

    const terminalAt =
      messageTime(message, 'completed', 'end', 'ended', 'updated', 'created') ?? messageActivityAt(message);

    if (status === 'error' && terminalAt) {
      errorAtMs = maxTimestamp(errorAtMs, terminalAt);
      continue;
    }

    const hasDoneSignal = status === 'done' && (type === 'session.status' || type === 'completed');
    if (hasDoneSignal && terminalAt) {
      completedAtMs = maxTimestamp(completedAtMs, terminalAt);
      continue;
    }

    const ambiguousStatus = resolveAmbiguousStepFinishStatus(message);
    if (ambiguousStatus === 'error' && terminalAt) {
      ambiguousErrorAtMs = maxTimestamp(ambiguousErrorAtMs, terminalAt);
      continue;
    }

    if (ambiguousStatus === 'done' && terminalAt) {
      ambiguousCompletedAtMs = maxTimestamp(ambiguousCompletedAtMs, terminalAt);
    }
  }

  const ambiguousAtMs = Math.max(ambiguousCompletedAtMs, ambiguousErrorAtMs);
  const ambiguousStatus = ambiguousErrorAtMs > ambiguousCompletedAtMs ? 'error' : 'done';
  const summary: MessageSummary =
    errorAtMs > completedAtMs
      ? { status: 'error', endedAt: latestISOString(errorAtMs) }
      : completedAtMs > 0
        ? { status: 'done', endedAt: latestISOString(completedAtMs) }
        : ambiguousAtMs > 0 && ambiguousAtMs >= latestStepStartAtMs
          ? { status: ambiguousStatus, endedAt: latestISOString(ambiguousAtMs), evidence: 'ambiguous' }
          : {};

  return {
    summary,
    latestActivityAt: latestISOString(latestActivityMs),
    latestLiveActivityAt: latestISOString(latestLiveActivityMs),
  };
};

const readTuiMessageActivity = (api: TuiPluginApi, sessionId: string): MessageActivity => {
  try {
    return analyzeMessages(api.state.session.messages(sessionId));
  } catch {
    return emptyMessageActivity();
  }
};

export const createTuiMessageActivityCache = (api: TuiPluginApi): ((sessionId: string) => MessageActivity) => {
  const cache = new Map<string, MessageActivity>();

  return (sessionId: string): MessageActivity => {
    const cached = cache.get(sessionId);
    if (cached) return cached;

    const activity = readTuiMessageActivity(api, sessionId);
    cache.set(sessionId, activity);
    return activity;
  };
};

export const latestSessionActivityAt = (api: TuiPluginApi, sessionId: string): string | undefined => {
  return readTuiMessageActivity(api, sessionId).latestActivityAt;
};

export const sessionStatusEndedAt = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;

  const time = isRecord(value.time) ? value.time : undefined;
  return (
    timestampFromUnknown(time?.completed) ??
    timestampFromUnknown(time?.ended) ??
    timestampFromUnknown(time?.end) ??
    timestampFromUnknown(time?.updated)
  );
};

export const summarizeMessages = (messages: readonly unknown[]): MessageSummary => analyzeMessages(messages).summary;

export const groupTargetRowsBySessionID = (
  state: SubagentState,
  targetSessionIDSet: ReadonlySet<string>,
): Map<string, SubagentChild[]> => {
  const groups = new Map<string, SubagentChild[]>();

  for (const child of Object.values(state.children)) {
    if (!isRealSessionChild(child)) continue;

    const sessionId = resolveSessionRowSessionId(child);
    if (!sessionId || !targetSessionIDSet.has(sessionId)) continue;

    const group = groups.get(sessionId);
    if (group) {
      group.push(child);
    } else {
      groups.set(sessionId, [child]);
    }
  }

  return groups;
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
