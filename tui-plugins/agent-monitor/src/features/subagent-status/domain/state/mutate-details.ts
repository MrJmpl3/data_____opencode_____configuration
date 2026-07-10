import type { SubagentChild, SubagentState, SubagentTokens } from '../types.ts';

import { safeTimestamp, timestampMs } from '../../../../kit/coercion.ts';
import {
  isSubtaskFallback,
  mergeTokens,
  sameTokens,
  sanitizeAgentName,
  sanitizeSummary,
  sanitizeTargetSessionID,
} from './core.ts';
import { childEvidenceTimestampMs, isTerminalStatus, normalizeChild } from './maintenance.ts';
import { rekeyCountedExecution } from './maintenance.ts';

const reconcileSubtaskTargetCount = (
  state: SubagentState,
  child: Pick<SubagentChild, 'id'> & Partial<Pick<SubagentChild, 'source' | 'targetSessionID'>>,
): boolean => {
  if (!isSubtaskFallback(child) || !child.targetSessionID) return false;
  return rekeyCountedExecution(state, child.id, child.targetSessionID);
};

export const upsertChildDetails = (
  state: SubagentState,
  childID: string,
  input: {
    title?: string;
    summary?: string;
    agentName?: string;
    tokens?: SubagentTokens;
    targetSessionID?: string;
    updatedAt?: string;
  },
): boolean => {
  const existing = state.children[childID];
  if (!existing) return false;

  const nextTitle = typeof input.title === 'string' && input.title.trim().length > 0 ? input.title : existing.title;
  const nextSummary = sanitizeSummary(input.summary, nextTitle) ?? sanitizeSummary(existing.summary, nextTitle);
  const nextAgentName = sanitizeAgentName(input.agentName) ?? existing.agentName;
  const nextTokens = mergeTokens(existing.tokens, input.tokens);
  const nextTargetSessionID = sanitizeTargetSessionID(
    input.targetSessionID ?? existing.targetSessionID,
    existing.id.startsWith('ses_') ? existing.id : undefined,
  );
  const candidateUpdatedAt = safeTimestamp(input.updatedAt, existing.updatedAt ?? new Date().toISOString());
  const preserveTerminalTiming = isTerminalStatus(existing.status);
  const nextUpdatedAt = preserveTerminalTiming
    ? existing.updatedAt
    : timestampMs(candidateUpdatedAt) >= childEvidenceTimestampMs(existing)
      ? candidateUpdatedAt
      : existing.updatedAt;

  if (
    nextTitle === existing.title &&
    nextSummary === existing.summary &&
    nextAgentName === existing.agentName &&
    nextTargetSessionID === existing.targetSessionID &&
    sameTokens(nextTokens, existing.tokens)
  ) {
    return false;
  }

  state.children[childID] = normalizeChild(
    {
      ...existing,
      title: nextTitle,
      summary: nextSummary,
      agentName: nextAgentName,
      targetSessionID: nextTargetSessionID,
      tokens: nextTokens,
      updatedAt: nextUpdatedAt,
    },
    Date.parse(nextUpdatedAt),
  );
  reconcileSubtaskTargetCount(state, state.children[childID]);
  state.updatedAt = candidateUpdatedAt;
  return true;
};


