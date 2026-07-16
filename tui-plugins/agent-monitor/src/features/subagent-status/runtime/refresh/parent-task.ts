import { deriveTerminalSessionStatus } from '../../domain/session-status.ts';
import { markChildStatus, upsertRunningChild } from '../../domain/state/mutations.ts';
import type { SubagentState } from '../../domain/types.ts';
import { asString, isRecord, timestampFromUnknown } from '../../../../kit/coercion.ts';
import { parseTaskSessionIdFromOutput } from '../events/resolve.ts';

export type ParentTaskEvidence = {
  parentSessionID: string;
  targetSessionID?: string;
  childID?: string;
  status: 'done' | 'error';
  background: boolean;
  endedAt?: string;
};

const taskParts = (message: unknown): Record<string, unknown>[] => {
  if (!isRecord(message) || !Array.isArray(message.parts)) return [];
  return message.parts.filter(
    (part): part is Record<string, unknown> => isRecord(part) && part.type === 'tool' && part.tool === 'task',
  );
};

const terminalAt = (part: Record<string, unknown>, state: Record<string, unknown>): string | undefined => {
  const time = isRecord(part.time) ? part.time : undefined;
  const stateTime = isRecord(state.time) ? state.time : undefined;
  return (
    timestampFromUnknown(time?.completed) ??
    timestampFromUnknown(time?.ended) ??
    timestampFromUnknown(stateTime?.completed) ??
    timestampFromUnknown(stateTime?.ended) ??
    timestampFromUnknown(stateTime?.updated)
  );
};

export const analyzeParentTaskMessages = (
  messages: readonly unknown[],
  parentSessionID: string,
): ParentTaskEvidence[] => {
  const evidence: ParentTaskEvidence[] = [];
  for (const message of messages) {
    for (const part of taskParts(message)) {
      const state = isRecord(part.state) ? part.state : undefined;
      if (!state) continue;
      const status = deriveTerminalSessionStatus(state.status);
      if (status !== 'done' && status !== 'error') continue;
      const metadata = isRecord(state.metadata) ? state.metadata : undefined;
      const input = isRecord(state.input) ? state.input : undefined;
      const targetSessionID =
        asString(metadata?.sessionId) ??
        asString(metadata?.sessionID) ??
        asString(metadata?.session_id) ??
        parseTaskSessionIdFromOutput(state.output, parentSessionID);
      const partID = asString(part.id);
      evidence.push({
        parentSessionID,
        targetSessionID,
        childID: partID ? `tool:${partID}` : undefined,
        status,
        background: input?.background === true || metadata?.background === true,
        endedAt: terminalAt(part, state),
      });
    }
  }
  return evidence;
};

export const applyParentTaskEvidence = (state: SubagentState, evidence: readonly ParentTaskEvidence[]): boolean => {
  let changed = false;
  for (const task of evidence) {
    let targets = Object.values(state.children).filter(
      (child) =>
        (task.targetSessionID &&
          (child.id === task.targetSessionID || child.targetSessionID === task.targetSessionID)) ||
        (task.childID && child.id === task.childID),
    );
    if (targets.length === 0 && task.targetSessionID) {
      changed =
        upsertRunningChild(state, {
          id: task.targetSessionID,
          title: 'subagent',
          parentID: task.parentSessionID,
          source: 'session',
          targetSessionID: task.targetSessionID,
          status: 'running',
          startedAt: task.endedAt,
          updatedAt: task.endedAt,
        }) || changed;
      targets = Object.values(state.children).filter(
        (child) => child.id === task.targetSessionID || child.targetSessionID === task.targetSessionID,
      );
    }
    if (task.background && task.status === 'done' && targets.some((child) => child.status === 'running')) continue;
    for (const child of targets) {
      changed =
        markChildStatus(state, child.id, task.status, task.endedAt ?? child.updatedAt, {
          allowTerminalOverride: task.status === 'error' || child.status === 'stale',
        }) || changed;
    }
  }
  return changed;
};
