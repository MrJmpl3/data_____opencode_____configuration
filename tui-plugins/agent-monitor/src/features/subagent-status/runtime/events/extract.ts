import { deriveSessionStatus as deriveOpenCodeSessionStatus } from '../../domain/session-status.ts';
import { conciseText, sameDisplayText } from '../../shared/display.ts';
import { asString, firstDefined, isRecord, timestampFromUnknown } from '../../../../kit/coercion.ts';
import type { EventLike } from './event-payload.ts';

export type SyntheticChild = {
  id: string;
  title: string;
  summary?: string;
  agentName?: string;
  parentID: string;
  messageID: string;
  targetSessionID?: string;
  startedAt?: string;
  updatedAt?: string;
  status?: 'running' | 'done' | 'error';
  endedAt?: string;
};

export const firstDistinctSummary = (candidates: unknown[], title: string | undefined): string | undefined => {
  for (const candidate of candidates) {
    const summary = conciseText(candidate);
    if (summary && !sameDisplayText(summary, title)) return summary;
  }
  return undefined;
};

export const extractEventTimestamp = (event: EventLike, keys: string[]): string | undefined => {
  const part = isRecord(event.properties?.part) ? event.properties.part : undefined;
  const state = isRecord(part?.state) ? part.state : undefined;
  const sources = [
    isRecord(event.properties?.info?.time) ? event.properties.info.time : undefined,
    isRecord(part?.time) ? part.time : undefined,
    isRecord(state?.time) ? state.time : undefined,
    state,
    part,
  ];
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const candidate = timestampFromUnknown(source[key]);
      if (candidate) return candidate;
    }
  }
  return undefined;
};

// `part.sessionID` (from `event.properties.part`) is deliberately NOT included
// in the resolution chain. `part.sessionID` identifies the SESSION THAT OWNS the
// part (the parent), not the event's own session identifier. Using it here would
// cause `message.part.updated` events from child sessions to be incorrectly
// routed to the parent session when the event-level `sessionID` is absent or
// different. The `part.sessionID` field is correctly scoped as a `parentID`
// fallback in `extract-child.ts` and `resolve.ts`.
export const extractSessionId = (event: EventLike): string | undefined =>
  firstDefined(
    asString(event.properties?.sessionID),
    asString(event.properties?.session_id),
    asString(event.properties?.sessionId),
    asString(event.properties?.info?.sessionID),
    asString(event.properties?.info?.session_id),
    asString(event.properties?.info?.sessionId),
    asString(event.sessionID),
    asString(event.session_id),
    asString(event.sessionId),
    asString(event.properties?.info?.id),
    asString(event.properties?.id),
  );

export const extractOpenCodeEventSessionStatus = (event: EventLike): SyntheticChild['status'] | undefined => {
  const statuses = [
    event.properties?.info?.status,
    event.properties?.info?.state,
    event.properties?.status,
    event.properties?.state,
    event.status,
    event.state,
    event.properties,
  ]
    .map(deriveOpenCodeSessionStatus)
    .filter((status): status is SyntheticChild['status'] => Boolean(status) && status !== 'stale');
  return statuses.find((status) => status !== 'running') ?? statuses[0];
};

export const extractChildDetails = (event: EventLike) => {
  const part = isRecord(event.properties?.part) ? event.properties.part : undefined;
  const state = isRecord(part?.state) ? part.state : undefined;
  const input = isRecord(state?.input) ? state.input : undefined;
  return {
    title:
      asString(event.properties?.info?.title) ??
      asString(event.properties?.title) ??
      asString(event.title) ??
      asString(event.name),
    summary: firstDistinctSummary(
      [input?.prompt, input?.description, part?.description, state?.description],
      undefined,
    ),
    agentName:
      asString(input?.subagent_type) ??
      asString(input?.agent) ??
      asString(part?.agent) ??
      asString(event.properties?.info?.agent) ??
      asString(event.properties?.info?.subagent_type),
    updatedAt: extractEventTimestamp(event, ['updated', 'completed', 'created', 'started', 'start']),
  };
};
