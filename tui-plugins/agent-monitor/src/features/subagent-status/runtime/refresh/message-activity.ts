import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import type { SubagentChild, SubagentState } from '../../domain/types.ts';
import { deriveTerminalSessionStatus } from '../../domain/session-status.ts';
import { isRealSessionChild } from '../../domain/state/core.ts';
import { isRecord, normalizedString, timestampFromUnknown } from '../../../../kit/coercion.ts';

import { resolveChildSessionId as resolveSessionRowSessionId } from '../session/navigate.ts';

export type MessageSummary = {
  status?: 'done' | 'error';
  endedAt?: string;
  evidence?: 'explicit' | 'ambiguous';
};

export type MessageActivity = {
  summary: MessageSummary;
  latestActivityAt?: string;
  latestLiveActivityAt?: string;
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

    const parts =
      isRecord(message) && Array.isArray((message as Record<string, unknown>).parts)
        ? ((message as Record<string, unknown>).parts as unknown[])
        : [];
    for (const part of parts) {
      if (!isRecord(part)) continue;
      latestActivityMs = maxTimestamp(latestActivityMs, messageActivityAt(part));
      latestLiveActivityMs = maxTimestamp(latestLiveActivityMs, messageLiveActivityAt(part));

      const partType = normalizedString(part.type);
      if (partType === 'step-start') {
        latestStepStartAtMs = maxTimestamp(latestStepStartAtMs, resolveStepStartTimestamp(part));
      }

      const partAmbiguous = resolveAmbiguousStepFinishStatus(part);
      if (!partAmbiguous) continue;

      const partTerminalAt =
        messageTime(part, 'completed', 'end', 'ended', 'updated', 'created') ?? messageActivityAt(part);
      if (partAmbiguous === 'error' && partTerminalAt) {
        ambiguousErrorAtMs = maxTimestamp(ambiguousErrorAtMs, partTerminalAt);
      } else if (partAmbiguous === 'done' && partTerminalAt) {
        ambiguousCompletedAtMs = maxTimestamp(ambiguousCompletedAtMs, partTerminalAt);
      }
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
