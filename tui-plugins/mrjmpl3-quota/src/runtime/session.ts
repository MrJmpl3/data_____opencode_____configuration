const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export const slotSessionId = (slotInput: unknown, fallback = ''): string => {
  if (!isRecord(slotInput)) return fallback;

  const sessionId = slotInput.session_id;

  return typeof sessionId === 'string' ? sessionId : fallback;
};
