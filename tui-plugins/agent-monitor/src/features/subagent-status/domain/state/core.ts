import type { SubagentChild, SubagentCounts, SubagentState, SubagentTokens } from '../types.ts';

import { mergeSubagentTokens, normalizeSubagentTokens, sameSubagentTokens } from '../tokens.ts';
import { safeTimestamp, timestampMs, toFiniteNumber, toNonNegativeInteger } from '../../../../kit/coercion.ts';

// ─── helpers ───────────────────────────────────────────────────────────────

export const sanitizeSummary = (value: unknown, title: string): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const summary = value.replace(/\s+/g, ' ').trim();
  if (!summary) return undefined;
  if (summary.toLowerCase() === title.replace(/\s+/g, ' ').trim().toLowerCase()) return undefined;

  return summary;
};

export const sanitizeAgentName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const agentName = value
    .replace(/^\((.*)\)$/, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return agentName || undefined;
};

export const sanitizeTargetSessionID = (value: unknown, fallback?: string): string | undefined => {
  if (typeof value === 'string' && value.startsWith('ses_')) return value;
  if (typeof fallback === 'string' && fallback.startsWith('ses_')) return fallback;
  return undefined;
};

export const sanitizeTokens = (input: unknown): SubagentTokens | undefined => normalizeSubagentTokens(input);

export const sameTokens = (left: SubagentTokens | undefined, right: SubagentTokens | undefined): boolean =>
  sameSubagentTokens(left, right);

export const mergeTokens = (
  existing: SubagentTokens | undefined,
  incoming: SubagentTokens | undefined,
): SubagentTokens | undefined => mergeSubagentTokens(existing, incoming);

export const resolveStatusColor = (status: SubagentChild['status']): NonNullable<SubagentChild['color']> => {
  if (status === 'done') return 'green';
  if (status === 'error') return 'red';
  if (status === 'stale') return 'gray';
  return 'yellow';
};

export const resolveElapsedMs = (
  child: Pick<SubagentChild, 'startedAt' | 'updatedAt' | 'endedAt' | 'status'>,
  nowMs: number,
): number => {
  const startedMs = Date.parse(child.startedAt);
  if (Number.isNaN(startedMs)) return 0;

  const endMs = child.status === 'running' ? nowMs : Date.parse(child.endedAt ?? child.updatedAt);
  if (Number.isNaN(endMs)) return 0;

  return Math.max(0, endMs - startedMs);
};

export { safeTimestamp, timestampMs, toFiniteNumber, toNonNegativeInteger };

// ─── core ───────────────────────────────────────────────────────────────────

export const createEmptyState = (): SubagentState => ({
  children: {},
  countedChildIDs: {},
  purgedSessionIDs: {},
  totalExecuted: 0,
  updatedAt: new Date().toISOString(),
});

export const getCounts = (state: SubagentState): SubagentCounts => {
  const counts: SubagentCounts = { running: 0, done: 0, stale: 0, error: 0 };

  for (const child of Object.values(state.children)) {
    if (child.status === 'running') counts.running += 1;
    if (child.status === 'done') counts.done += 1;
    if (child.status === 'stale') counts.stale += 1;
    if (child.status === 'error') counts.error += 1;
  }

  return counts;
};

// ─── child-kind ──────────────────────────────────────────────────────────────

export const isRealSessionChild = (
  child: Pick<SubagentChild, 'id'> & Partial<Pick<SubagentChild, 'source'>>,
): boolean => child.source === 'session' || child.id.startsWith('ses_');

export const isSyntheticToolWrapper = (child: Partial<Pick<SubagentChild, 'source'>>): boolean =>
  child.source === 'tool';

export const isDelegationLikeChild = (child: Pick<SubagentChild, 'title'>): boolean =>
  child.title.trim().toLowerCase().startsWith('delegation:');

export const isSubtaskFallback = (child: Partial<Pick<SubagentChild, 'source'>>): boolean => child.source === 'subtask';

// ─── session-identity ───────────────────────────────────────────────────────

export const resolveSessionIdentity = (
  child: Pick<SubagentChild, 'id'> & Partial<Pick<SubagentChild, 'targetSessionID'>>,
): string | undefined => {
  if (child.id.startsWith('ses_')) return child.id;
  return sanitizeTargetSessionID(child.targetSessionID);
};

export const clearPurgedSession = (state: SubagentState, sessionId: string): void => {
  delete state.purgedSessionIDs[sessionId];
};
