import type { SubagentChild } from '../domain/types.ts';

import { resolveChildSessionId } from './session-target.ts';

type SessionRowLike = Pick<SubagentChild, 'id'> & Partial<Pick<SubagentChild, 'source' | 'targetSessionID'>>;

export const isRealSessionRow = (child: SessionRowLike): boolean => {
  return child.source === 'session' || child.id.startsWith('ses_');
};

export const resolveSessionRowSessionId = (child: SessionRowLike): string | undefined => {
  return resolveChildSessionId(child);
};
