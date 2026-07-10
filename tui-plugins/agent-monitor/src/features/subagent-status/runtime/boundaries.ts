import type { TuiRouteCurrent } from '@opencode-ai/plugin/tui';

import { asString, isRecord } from '../../../kit/coercion.ts';

// ---------------------------------------------------------------------------
// event-payload.ts
// ---------------------------------------------------------------------------

export type EventLike = {
  type?: unknown;
  title?: unknown;
  name?: unknown;
  sessionID?: unknown;
  session_id?: unknown;
  sessionId?: unknown;
  status?: unknown;
  state?: unknown;
  parentID?: unknown;
  properties?: {
    id?: unknown;
    sessionID?: unknown;
    session_id?: unknown;
    sessionId?: unknown;
    title?: unknown;
    name?: unknown;
    parentID?: unknown;
    status?: unknown;
    state?: unknown;
    info?: {
      id?: unknown;
      title?: unknown;
      name?: unknown;
      agent?: unknown;
      subagent_type?: unknown;
      sessionID?: unknown;
      session_id?: unknown;
      sessionId?: unknown;
      parentID?: unknown;
      status?: unknown;
      state?: unknown;
      time?: Record<string, unknown>;
    };
    part?: Record<string, unknown>;
  };
  [key: string]: unknown;
};

const normalizeEventInfo = (input: unknown): NonNullable<EventLike['properties']>['info'] | undefined => {
  if (!isRecord(input)) {
    return undefined;
  }

  return {
    ...input,
    time: isRecord(input.time) ? input.time : undefined,
  };
};

const normalizeEventProperties = (input: unknown): EventLike['properties'] | undefined => {
  if (!isRecord(input)) {
    return undefined;
  }

  return {
    ...input,
    info: normalizeEventInfo(input.info),
    part: isRecord(input.part) ? input.part : undefined,
  };
};

export const normalizeEventPayload = (input: unknown): EventLike | undefined => {
  if (!isRecord(input)) {
    return undefined;
  }

  return {
    ...input,
    properties: normalizeEventProperties(input.properties),
  };
};

// ---------------------------------------------------------------------------
// route-params.ts
// ---------------------------------------------------------------------------

export type NormalizedSessionRouteParams = {
  sessionID?: string;
};

export const normalizeSessionRouteParams = (route: TuiRouteCurrent): NormalizedSessionRouteParams => {
  if (route.name === 'session') {
    return {
      sessionID: asString(route.params?.sessionID),
    };
  }

  if (!('params' in route) || !isRecord(route.params)) {
    return {};
  }

  const params: Record<string, unknown> = route.params;

  return {
    sessionID: asString(params.sessionID) ?? asString(params.session_id) ?? asString(params.sessionId),
  };
};

export const resolveRouteSessionId = (route: TuiRouteCurrent): string | undefined => {
  return normalizeSessionRouteParams(route).sessionID;
};

// ---------------------------------------------------------------------------
// session-client.ts
// ---------------------------------------------------------------------------

type SessionStatusMap = Record<string, unknown>;

export type SessionClientBoundaryApi = {
  client: {
    session?: {
      children?: (input: { sessionID: string; directory: string }) => Promise<unknown>;
      status?: (input: { directory: string }) => Promise<{ data?: unknown } | undefined>;
      messages?: (input: { sessionID: string; directory: string }) => Promise<{ data?: unknown } | undefined>;
    };
  };
  state: {
    path: {
      directory: string;
    };
  };
};

const normalizeStatusMap = (input: unknown): SessionStatusMap => {
  return isRecord(input) ? input : {};
};

const normalizeMessages = (input: unknown): readonly unknown[] => {
  return Array.isArray(input) ? input : [];
};

export const createSessionClientBoundary = (api: SessionClientBoundaryApi) => {
  const directory = api.state.path.directory;
  const sessionClient = api.client.session;

  return {
    listChildren: async (sessionID: string): Promise<unknown> => {
      return sessionClient?.children?.({ sessionID, directory });
    },
    readStatusMap: async (): Promise<SessionStatusMap> => {
      return normalizeStatusMap((await sessionClient?.status?.({ directory }))?.data);
    },
    readMessages: async (sessionID: string): Promise<readonly unknown[]> => {
      return normalizeMessages((await sessionClient?.messages?.({ sessionID, directory }))?.data);
    },
  };
};

// ---------------------------------------------------------------------------
// slot-payload.ts
// ---------------------------------------------------------------------------

export type NormalizedSessionSlotPayload = {
  sessionID?: string;
};

export const normalizeSessionSlotPayload = (input: unknown): NormalizedSessionSlotPayload => {
  if (!isRecord(input)) {
    return {};
  }

  return {
    sessionID: asString(input.sessionID) ?? asString(input.session_id) ?? asString(input.sessionId),
  };
};

export const resolveSlotSessionId = (input: unknown, fallback = ''): string => {
  return normalizeSessionSlotPayload(input).sessionID ?? fallback;
};
