import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import type { SubagentChild } from '../../domain/types.ts';
import { resolveSlotSessionId } from './slot-payload.ts';

type SessionTargetLike = Pick<SubagentChild, 'id'> & Partial<Pick<SubagentChild, 'targetSessionID'>>;

export const isSessionTarget = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('ses_');

export const resolveChildSessionId = (child: SessionTargetLike): string | undefined => {
  if (isSessionTarget(child.targetSessionID)) return child.targetSessionID;
  if (isSessionTarget(child.id)) return child.id;
  return undefined;
};

export const resolveSessionSlotTransition = (
  currentSessionId: string,
  slotInput: unknown,
  hasTrackedChildren: boolean,
): { nextSessionId: string; resetState: boolean; shouldRefresh: boolean } => {
  const nextSessionId = resolveSlotSessionId(slotInput);
  if (!nextSessionId) {
    return {
      nextSessionId: '',
      resetState: currentSessionId !== '' || hasTrackedChildren,
      shouldRefresh: false,
    };
  }
  if (nextSessionId !== currentSessionId) {
    return { nextSessionId, resetState: true, shouldRefresh: true };
  }
  return { nextSessionId, resetState: false, shouldRefresh: !hasTrackedChildren };
};

export const resolveNavigationSessionId = (
  child: Pick<SubagentChild, 'id'> & Partial<Pick<SubagentChild, 'targetSessionID'>>,
): string | undefined => resolveChildSessionId(child);

export const navigateToChildSession = (
  api: Pick<TuiPluginApi, 'route'>,
  child: Pick<SubagentChild, 'id'> & Partial<Pick<SubagentChild, 'targetSessionID'>>,
): boolean => {
  const sessionId = resolveNavigationSessionId(child);
  if (!sessionId) return false;
  api.route.navigate('session', { sessionID: sessionId });
  return true;
};
