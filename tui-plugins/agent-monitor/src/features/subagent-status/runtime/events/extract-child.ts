import { conciseText } from '../../shared/display.ts';
import { asString, isRecord, type UnknownRecord } from '../../../../kit/coercion.ts';
import type { EventLike } from './event-payload.ts';
import {
  extractEventTimestamp,
  extractOpenCodeEventSessionStatus,
  extractSessionId,
  firstDistinctSummary,
  type SyntheticChild,
} from './extract.ts';
import { extractPartTargetSessionCandidates, parseTaskSessionIdFromOutput } from './resolve.ts';
import { deriveTerminalSessionStatus } from '../../domain/session-status.ts';

export type TaskToolEvidence = {
  status: 'running' | 'done' | 'error';
  targetSessionID?: string;
  endedAt?: string;
  background: boolean;
};

export const extractChildCore = (event: EventLike) => {
  const info = event.properties?.info;
  const parentID = asString(info?.parentID);
  const id = asString(info?.id) ?? asString(event.properties?.id);
  if (!parentID || !id) return null;
  return {
    id,
    parentID,
    messageID: asString(info?.id) ?? id,
    title: asString(info?.title) ?? asString(info?.name) ?? 'subagent',
    agentName: asString(info?.agent) ?? asString(info?.subagent_type),
  };
};

export const extractChildTimestamps = (event: EventLike, status: SyntheticChild['status']) => {
  const startedAt = extractEventTimestamp(event, ['started', 'start', 'created', 'updated']);
  return {
    startedAt,
    updatedAt: extractEventTimestamp(event, ['updated', 'created', 'started', 'start']) ?? startedAt,
    endedAt:
      status === 'running'
        ? undefined
        : extractEventTimestamp(event, ['completed', 'end', 'ended', 'updated', 'created', 'started']),
  };
};

export const extractCreatedChild = (event: EventLike): SyntheticChild | null => {
  const core = extractChildCore(event);
  if (!core) return null;
  const status = extractOpenCodeEventSessionStatus(event) ?? 'running';
  return { ...core, targetSessionID: core.id, status, ...extractChildTimestamps(event, status) };
};

export const extractSubtaskChild = (event: EventLike): SyntheticChild | null => {
  const part = isRecord(event.properties?.part) ? event.properties.part : undefined;
  if (!part || part.type !== 'subtask') return null;
  const partID = asString(part.id);
  const parentID = asString(part.sessionID) ?? asString(part.session_id) ?? extractSessionId(event);
  const messageID = asString(part.messageID);
  if (!partID || !parentID || !messageID) return null;
  const title = asString(part.description) ?? asString(part.command) ?? asString(part.agent) ?? 'subtask';
  const state = isRecord(part.state) ? part.state : undefined;
  const input = isRecord(state?.input) ? state.input : undefined;
  const targets = extractPartTargetSessionCandidates(event);
  return {
    id: `subtask:${partID}`,
    title,
    summary: firstDistinctSummary([input?.prompt, input?.description, part.description, state?.description], title),
    agentName: asString(part.agent),
    parentID,
    messageID,
    targetSessionID: targets.length === 1 ? targets[0] : undefined,
    startedAt: extractEventTimestamp(event, ['started', 'start', 'created', 'updated']),
    updatedAt: extractEventTimestamp(event, ['updated', 'created', 'started', 'start']),
    status: 'running',
  };
};

export const extractTaskToolEvidence = (event: EventLike): TaskToolEvidence | null => {
  const part = isRecord(event.properties?.part) ? event.properties.part : undefined;
  if (!part || part.type !== 'tool' || asString(part.tool) !== 'task') return null;
  const state = isRecord(part.state) ? part.state : undefined;
  if (!state) return null;
  const terminalStatus = deriveTerminalSessionStatus(state.status);
  const status: TaskToolEvidence['status'] =
    terminalStatus === 'error' ? 'error' : terminalStatus === 'done' ? 'done' : 'running';
  const metadata = isRecord(state.metadata) ? state.metadata : undefined;
  const input = isRecord(state.input) ? state.input : undefined;
  const parentID = asString(part.sessionID) ?? asString(part.session_id) ?? extractSessionId(event);
  const targets = extractPartTargetSessionCandidates(event);
  return {
    status,
    background: input?.background === true || metadata?.background === true,
    targetSessionID:
      asString(metadata?.sessionId) ??
      asString(metadata?.sessionID) ??
      asString(metadata?.session_id) ??
      parseTaskSessionIdFromOutput(state.output, parentID) ??
      (targets.length === 1 ? targets[0] : undefined),
    endedAt: status !== 'running' ? extractEventTimestamp(event, ['completed', 'end', 'ended', 'updated']) : undefined,
  };
};

type ValidToolPart = {
  part: UnknownRecord;
  state: UnknownRecord;
  tool: 'delegate' | 'task';
  partID: string;
  parentID: string;
  messageID: string;
};

export const validateToolPart = (event: EventLike): ValidToolPart | null => {
  const part = isRecord(event.properties?.part) ? event.properties.part : undefined;
  if (!part || part.type !== 'tool') return null;
  const tool = asString(part.tool);
  const state = isRecord(part.state) ? part.state : undefined;
  const partID = asString(part.id);
  const parentID = asString(part.sessionID) ?? asString(part.session_id) ?? extractSessionId(event);
  const messageID = asString(part.messageID);
  if ((tool !== 'delegate' && tool !== 'task') || !state || !partID || !parentID || !messageID) return null;
  return { part, state, tool, partID, parentID, messageID };
};

export const extractToolTitle = (part: UnknownRecord, state: UnknownRecord, tool: string): string => {
  const input = isRecord(state.input) ? state.input : undefined;
  return (
    asString(state.title) ??
    asString(input?.description) ??
    conciseText(input?.prompt) ??
    asString(part.description) ??
    asString(input?.subagent_type) ??
    tool
  );
};

export const buildToolChild = (event: EventLike, validated: ValidToolPart): SyntheticChild => {
  const { part, state, tool, partID, parentID, messageID } = validated;
  const input = isRecord(state.input) ? state.input : undefined;
  const title = extractToolTitle(part, state, tool);
  const evidence = extractTaskToolEvidence(event);
  const targets = extractPartTargetSessionCandidates(event);
  return {
    id: `tool:${partID}`,
    title,
    summary: firstDistinctSummary([input?.prompt, input?.description, part.description, state.description], title),
    agentName: asString(input?.subagent_type) ?? asString(input?.agent),
    parentID,
    messageID,
    targetSessionID: evidence?.targetSessionID ?? (targets.length === 1 ? targets[0] : undefined),
    startedAt: extractEventTimestamp(event, ['started', 'start', 'created', 'updated']),
    updatedAt: extractEventTimestamp(event, ['updated', 'completed', 'created', 'started', 'start']),
    endedAt: evidence?.endedAt,
    status: evidence?.status ?? (asString(state.status) === 'error' ? 'error' : 'running'),
  };
};

export const extractToolChild = (event: EventLike): SyntheticChild | null => {
  const validated = validateToolPart(event);
  return validated ? buildToolChild(event, validated) : null;
};
