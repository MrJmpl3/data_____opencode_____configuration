import type { SubagentChild } from '../domain/types.ts';

type SessionTargetLike = Pick<SubagentChild, 'id'> & Partial<Pick<SubagentChild, 'targetSessionID'>>;

export const isSessionTarget = (value: unknown): value is string => {
  return typeof value === 'string' && value.startsWith('ses_');
};

export const resolveChildSessionId = (child: SessionTargetLike): string | undefined => {
  if (isSessionTarget(child.targetSessionID)) return child.targetSessionID;
  if (isSessionTarget(child.id)) return child.id;
  return undefined;
};
