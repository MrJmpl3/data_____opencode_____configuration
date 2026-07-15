import { markChildRunning, markChildStatus, upsertRunningChild } from '../../domain/state/mutations.ts';
import { upsertChildDetails } from '../../domain/state/mutate-details.ts';
import { isTerminalStatus } from '../../domain/state/maintenance.ts';
import type { SubagentState } from '../../domain/types.ts';
import { asString } from '../../../../kit/coercion.ts';
import { normalizeEventPayload } from '../events/event-payload.ts';
import type { EventLike } from '../events/event-payload.ts';
import {
  extractChildDetails,
  extractEventTimestamp,
  extractOpenCodeEventSessionStatus,
  extractSessionId,
} from './extract.ts';
import { extractCreatedChild, extractSubtaskChild, extractToolChild } from './extract-child.ts';
import { mapTaskToolToSubtaskID, resolveSyntheticTargetSessionID } from './resolve.ts';

// Event types that can actually mutate SubagentState. Used by mergeEventState
// to avoid cloning the entire state tree for irrelevant events (e.g.
// tui.session.select, message.updated) that the bridge delivers but that
// never change state.
export const RELEVANT_EVENT_TYPES = new Set([
  'session.created',
  'session.updated',
  'session.idle',
  'session.error',
  'session.status',
  'message.part.updated',
]);

// ─── handling: process events ────────────────────────────────────────────────

const handleStepFinish = (state: SubagentState, event: EventLike): boolean => {
  const part = event.properties?.part;
  if (!part || part.type !== 'step-finish') return false;

  const sessionId = extractSessionId(event);
  if (!sessionId) return false;

  const reason = part.reason;

  // `tool-calls` is an intermediate continuation signal, NOT terminal.
  if (reason === 'tool-calls') return false;

  if (reason === 'stop') {
    return markChildStatus(
      state,
      sessionId,
      'done',
      extractEventTimestamp(event, ['completed', 'end', 'ended', 'updated', 'created', 'started']),
    );
  }

  return false;
};

const handleSessionCreated = (state: SubagentState, event: EventLike, allowTerminalReopen = true): boolean => {
  const created = extractCreatedChild(event);
  if (!created) return false;

  return upsertRunningChild(
    state,
    {
      ...created,
      source: 'session',
      targetSessionID: created.id,
    },
    { allowTerminalReopen },
  );
};

const handleSessionIdle = (state: SubagentState, event: EventLike): boolean => {
  const sessionId = extractSessionId(event);
  if (!sessionId) return false;

  // An idle event may carry a terminal status (cancelled, aborted,
  // done) when the sub-agent was interrupted. Check for it — if present,
  // route through handleSessionStatus instead of just updating details so
  // the child is properly marked as terminal and won't stay "running" forever.
  const terminalStatus = extractOpenCodeEventSessionStatus(event);
  if (terminalStatus === 'error' || terminalStatus === 'done') {
    return handleSessionStatus(state, event);
  }

  return upsertChildDetails(state, sessionId, extractChildDetails(event));
};

const handleSessionStatus = (state: SubagentState, event: EventLike): boolean => {
  const type = asString(event.type);
  const sessionId = extractSessionId(event);
  if (!type || !sessionId) return false;

  const status = type === 'session.error' ? 'error' : extractOpenCodeEventSessionStatus(event);
  if (!status) return false;

  const details = extractChildDetails(event);
  const eventUpdatedAt = details.updatedAt;
  const changed =
    status === 'running'
      ? markChildRunning(state, sessionId, eventUpdatedAt)
      : markChildStatus(
          state,
          sessionId,
          status,
          extractEventTimestamp(event, ['completed', 'end', 'ended', 'updated', 'created', 'started']),
        );

  return upsertChildDetails(state, sessionId, details) || changed;
};

const handleSessionUpdated = (state: SubagentState, event: EventLike): boolean => {
  const status = extractOpenCodeEventSessionStatus(event);
  const sessionId = extractSessionId(event);
  const existing = sessionId ? state.children[sessionId] : undefined;
  const terminalRepresentation = sessionId
    ? Object.values(state.children).find(
        (child) => (child.id === sessionId || child.targetSessionID === sessionId) && isTerminalStatus(child.status),
      )
    : undefined;

  if (!status && terminalRepresentation) {
    return existing && sessionId ? upsertChildDetails(state, sessionId, extractChildDetails(event)) : false;
  }

  const changed = handleSessionCreated(state, event, false);

  if (!status) return changed;

  return handleSessionStatus(state, event) || changed;
};

const handleMessagePartUpdated = (state: SubagentState, event: EventLike): boolean => {
  let changed = false;

  changed = handleStepFinish(state, event) || changed;

  const subtask = extractSubtaskChild(event);
  if (subtask) {
    changed =
      upsertRunningChild(state, {
        ...subtask,
        source: 'subtask',
        targetSessionID: resolveSyntheticTargetSessionID(
          state,
          { parentID: subtask.parentID, messageID: subtask.messageID },
          subtask.targetSessionID ? [subtask.targetSessionID] : [],
        ),
      }) || changed;
  }

  const tool = extractToolChild(event);
  if (!tool) return changed;

  const targetSessionID = resolveSyntheticTargetSessionID(
    state,
    { parentID: tool.parentID, messageID: tool.messageID },
    tool.targetSessionID ? [tool.targetSessionID] : [],
  );

  changed =
    upsertRunningChild(state, {
      ...tool,
      source: 'tool',
      targetSessionID,
    }) || changed;

  if (tool.status === 'done' || tool.status === 'error') {
    changed = markChildStatus(state, tool.id, tool.status, tool.endedAt ?? tool.updatedAt) || changed;
  }

  if (asString(event.properties?.part?.tool) !== 'task' || (tool.status !== 'done' && tool.status !== 'error')) {
    return changed;
  }

  const subtaskID = mapTaskToolToSubtaskID(state, {
    parentID: tool.parentID,
    messageID: tool.messageID,
    title: tool.title,
    summary: tool.summary,
    agentName: tool.agentName,
    targetSessionID,
  });
  if (!subtaskID) return changed;

  if (targetSessionID) {
    changed = upsertChildDetails(state, subtaskID, { targetSessionID, updatedAt: tool.updatedAt }) || changed;
  }

  return markChildStatus(state, subtaskID, tool.status, tool.endedAt ?? tool.updatedAt) || changed;
};

export const applySubagentEvent = (state: SubagentState, event: unknown): boolean => {
  const candidate = normalizeEventPayload(event);
  if (!candidate) return false;

  const type = asString(candidate.type);
  if (!type) return false;

  if (type === 'session.created') return handleSessionCreated(state, candidate);
  if (type === 'session.updated') return handleSessionUpdated(state, candidate);
  if (type === 'session.idle') return handleSessionIdle(state, candidate);
  if (type === 'session.error' || type === 'session.status') return handleSessionStatus(state, candidate);
  if (type !== 'message.part.updated') return false;

  return handleMessagePartUpdated(state, candidate);
};
