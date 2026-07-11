import type { SubagentState } from '../../domain/types.ts';
import { sameDisplayText } from '../../shared/display.ts';
import { asString, isRecord } from '../../../../kit/coercion.ts';
import type { EventLike } from './event-payload.ts';
import { extractSessionId } from './extract.ts';

const isSessionId = (value: unknown): value is string => typeof value === 'string' && value.startsWith('ses_');

const collectSessionIds = (input: unknown, target: Set<string>, depth = 0): void => {
  if (depth > 4 || !input) return;
  if (isSessionId(input)) {
    target.add(input);
    return;
  }
  if (Array.isArray(input)) {
    for (const value of input) collectSessionIds(value, target, depth + 1);
    return;
  }
  if (!isRecord(input)) return;
  for (const [key, value] of Object.entries(input)) {
    if (key.toLowerCase().includes('session')) collectSessionIds(value, target, depth + 1);
  }
};

export const extractPartTargetSessionCandidates = (event: EventLike): string[] => {
  const part = isRecord(event.properties?.part) ? event.properties.part : undefined;
  if (!part) return [];
  const candidates = new Set<string>();
  collectSessionIds(part, candidates);
  const parentSessionId = asString(part.sessionID) ?? asString(part.session_id) ?? extractSessionId(event);
  if (parentSessionId) candidates.delete(parentSessionId);
  return [...candidates];
};

export const parseTaskSessionIdFromOutput = (value: unknown, parentSessionId?: string): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const candidates = new Set(
    [...value.matchAll(/\b(?:task_id\s*:\s*)?(ses_[A-Za-z0-9_-]+)\b/gi)].map((match) => match[1]),
  );
  if (parentSessionId) candidates.delete(parentSessionId);
  return candidates.size === 1 ? [...candidates][0] : undefined;
};

export const resolveSyntheticTargetSessionID = (
  state: SubagentState,
  input: { parentID: string; messageID?: string },
  explicitCandidates: readonly string[] = [],
): string | undefined => {
  const candidates = new Set<string>(explicitCandidates.filter(isSessionId));
  const siblings = Object.values(state.children).filter(
    (child) => (child.source === 'session' || child.id.startsWith('ses_')) && child.parentID === input.parentID,
  );
  const byMessage = siblings.filter((child) => input.messageID && child.messageID === input.messageID);
  if (byMessage.length === 1) candidates.add(byMessage[0].id);
  if (siblings.length === 1) candidates.add(siblings[0].id);
  return candidates.size === 1 ? [...candidates][0] : undefined;
};

export const mapTaskToolToSubtaskID = (
  state: SubagentState,
  task: {
    parentID: string;
    messageID: string;
    title: string;
    summary?: string;
    agentName?: string;
    targetSessionID?: string;
  },
): string | undefined => {
  const candidates = Object.values(state.children).filter(
    (child) => child.source === 'subtask' && child.status === 'running' && child.parentID === task.parentID,
  );
  const byMessage = candidates.filter((child) => child.messageID === task.messageID);
  const scoped = byMessage.length > 0 ? byMessage : candidates;
  if (task.targetSessionID) {
    const matches = scoped.filter((child) => child.targetSessionID === task.targetSessionID);
    if (matches.length === 1) return matches[0].id;
  }
  for (const field of ['title', 'summary', 'agentName'] as const) {
    if (!task[field]) continue;
    const matches = scoped.filter((child) => sameDisplayText(child[field], task[field]));
    if (matches.length === 1) return matches[0].id;
  }
  return undefined;
};
