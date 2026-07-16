import { deriveSessionStatus as deriveOpenCodeSessionStatus } from '../session-status.ts';
import type { SubagentChild, SubagentTokens } from '../types.ts';
import { asString, isRecord, timestampFromUnknown } from '../../../../kit/coercion.ts';

const sessionTime = (input: Record<string, unknown>, key: 'created' | 'updated'): string | undefined => {
  const time = isRecord(input.time) ? input.time : undefined;
  return timestampFromUnknown(time?.[key]);
};

const normalizeTokens = (value: unknown): SubagentTokens | undefined => {
  if (!isRecord(value)) return undefined;
  const input = typeof value.input === 'number' && Number.isFinite(value.input) ? value.input : undefined;
  const output = typeof value.output === 'number' && Number.isFinite(value.output) ? value.output : undefined;
  const total = typeof value.total === 'number' && Number.isFinite(value.total) ? value.total : undefined;
  const contextPercent =
    typeof value.contextPercent === 'number' && Number.isFinite(value.contextPercent)
      ? value.contextPercent
      : undefined;
  if (input === undefined && output === undefined && total === undefined && contextPercent === undefined)
    return undefined;
  return { input, output, total, contextPercent };
};

const normalizeResponseChild = (input: unknown): SubagentChild | undefined => {
  if (!isRecord(input)) return undefined;
  const id = asString(input.id);
  const parentID = asString(input.parentID);
  if (!id || !parentID) return undefined;
  const title = asString(input.title) ?? asString(input.name) ?? 'Subagent';
  const startedAt = asString(input.startedAt) ?? sessionTime(input, 'created') ?? new Date().toISOString();
  const updatedAt = asString(input.updatedAt) ?? sessionTime(input, 'updated') ?? startedAt;
  const status = deriveOpenCodeSessionStatus(input.status ?? input.state);
  if (!status) return undefined;
  return {
    id,
    title,
    summary: asString(input.summary),
    agentName: asString(input.agentName),
    parentID,
    messageID: asString(input.messageID),
    source:
      input.source === 'session' || input.source === 'subtask' || input.source === 'tool'
        ? input.source
        : id.startsWith('ses_')
          ? 'session'
          : undefined,
    targetSessionID: asString(input.targetSessionID) ?? (id.startsWith('ses_') ? id : undefined),
    status,
    color: status === 'done' ? 'green' : status === 'error' ? 'red' : status === 'stale' ? 'gray' : 'yellow',
    startedAt,
    updatedAt,
    endedAt: asString(input.endedAt) ?? (status === 'running' ? undefined : updatedAt),
    elapsedMs: undefined,
    tokens: normalizeTokens(input.tokens),
  };
};

export const normalizeChildrenResponse = (response: unknown): SubagentChild[] => {
  const data = isRecord(response) ? response.data : response;
  if (!Array.isArray(data)) return [];
  return data.map(normalizeResponseChild).filter((child): child is SubagentChild => Boolean(child));
};
