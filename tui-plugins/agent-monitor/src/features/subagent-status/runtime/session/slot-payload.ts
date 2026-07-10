import { asString, isRecord } from '../../../../kit/coercion.ts';

export type NormalizedSessionSlotPayload = {
  sessionID?: string;
};

export const normalizeSessionSlotPayload = (input: unknown): NormalizedSessionSlotPayload => {
  if (!isRecord(input)) return {};
  return { sessionID: asString(input.sessionID) ?? asString(input.session_id) ?? asString(input.sessionId) };
};

export const resolveSlotSessionId = (input: unknown, fallback = ''): string =>
  normalizeSessionSlotPayload(input).sessionID ?? fallback;
