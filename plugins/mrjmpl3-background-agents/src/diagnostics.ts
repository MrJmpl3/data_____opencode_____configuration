import type {
  AssistantMessage,
  ApiError,
  Event,
  MessageAbortedError,
  MessageOutputLengthError,
  Part,
  ProviderAuthError,
  ToolPart,
  ToolState,
  UnknownError,
} from '@opencode-ai/sdk';

import type {
  Delegation,
  DelegationDiagnosticError,
  DelegationDiagnosticsReport,
  DelegationEventDiagnostic,
  DelegationMessageSnapshot,
  DelegationToolCallDiagnostic,
  SessionMessageItem,
} from './types.ts';

const MAX_EVENT_COUNT = 12;
const MAX_TOOL_CALL_COUNT = 8;
const MAX_STRING_LENGTH = 2000;
const MAX_OBJECT_DEPTH = 4;
const MAX_OBJECT_KEYS = 20;
const MAX_ARRAY_ITEMS = 12;

type KnownDelegationError =
  | ProviderAuthError
  | UnknownError
  | MessageOutputLengthError
  | MessageAbortedError
  | ApiError;

export interface DelegationDiagnosticsState {
  promptError?: string;
  sessionError?: DelegationDiagnosticError;
  assistantError?: DelegationDiagnosticError;
  toolCalls: Map<string, DelegationToolCallDiagnostic>;
  recentEvents: DelegationEventDiagnostic[];
  messageSnapshot?: DelegationMessageSnapshot;
  notes: Set<string>;
}

function truncateString(value: string, limit: number = MAX_STRING_LENGTH): string {
  if (value.length <= limit) return value;

  return `${value.slice(0, limit)}… [truncated ${value.length - limit} chars]`;
}

function sanitizeValue(value: unknown, depth: number = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (depth >= MAX_OBJECT_DEPTH) {
    return '[truncated]';
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);

    for (const [key, entryValue] of entries) {
      result[key] = sanitizeValue(entryValue, depth + 1);
    }

    return result;
  }

  return String(value);
}

function normalizeError(error: KnownDelegationError | undefined): DelegationDiagnosticError | undefined {
  if (!error) return undefined;

  const apiData = error.name === 'APIError' ? error.data : undefined;
  const baseMessage =
    typeof error.data === 'object' && error.data && 'message' in error.data ? error.data.message : undefined;

  return {
    name: error.name,
    message: typeof baseMessage === 'string' ? truncateString(baseMessage) : undefined,
    statusCode: apiData?.statusCode,
    isRetryable: apiData?.isRetryable,
    responseHeaders:
      apiData?.responseHeaders && typeof apiData.responseHeaders === 'object'
        ? (sanitizeValue(apiData.responseHeaders) as Record<string, string>)
        : undefined,
    responseBody: apiData?.responseBody ? truncateString(apiData.responseBody) : undefined,
  };
}

function getToolStateMetadata(state: ToolState): unknown {
  if ('metadata' in state) return state.metadata;

  return undefined;
}

function getToolStateTime(state: ToolState): unknown {
  if ('time' in state) return state.time;

  return undefined;
}

function toToolCallDiagnostic(part: ToolPart): DelegationToolCallDiagnostic {
  return {
    partID: part.id,
    callID: part.callID,
    messageID: part.messageID,
    tool: part.tool,
    status: part.state.status,
    input: sanitizeValue(part.state.input),
    raw: part.state.status === 'pending' ? truncateString(part.state.raw) : undefined,
    error: part.state.status === 'error' ? truncateString(part.state.error) : undefined,
    metadata: sanitizeValue(getToolStateMetadata(part.state) ?? part.metadata),
    time: sanitizeValue(getToolStateTime(part.state)),
  };
}

function pushRecentEvent(state: DelegationDiagnosticsState, event: DelegationEventDiagnostic): void {
  state.recentEvents.push(event);
  if (state.recentEvents.length > MAX_EVENT_COUNT) {
    state.recentEvents.splice(0, state.recentEvents.length - MAX_EVENT_COUNT);
  }
}

function addNote(state: DelegationDiagnosticsState, note: string): void {
  state.notes.add(note);
}

function upsertToolCall(
  state: DelegationDiagnosticsState,
  toolCall: DelegationToolCallDiagnostic,
): DelegationToolCallDiagnostic {
  const key = toolCall.callID || toolCall.partID;
  const existing = state.toolCalls.get(key);
  const merged: DelegationToolCallDiagnostic = {
    ...existing,
    ...toolCall,
    raw: toolCall.raw ?? existing?.raw,
    error: toolCall.error ?? existing?.error,
    input: toolCall.input ?? existing?.input,
    metadata: toolCall.metadata ?? existing?.metadata,
    time: toolCall.time ?? existing?.time,
  };

  state.toolCalls.set(key, merged);

  return merged;
}

function isAssistantMessage(message: SessionMessageItem): message is SessionMessageItem & { info: AssistantMessage } {
  return message.info.role === 'assistant';
}

function isToolPart(part: Part): part is ToolPart {
  return part.type === 'tool';
}

function isInterestingToolCall(toolCall: DelegationToolCallDiagnostic): boolean {
  return toolCall.status === 'error' || Boolean(toolCall.raw);
}

export function createDelegationDiagnosticsState(): DelegationDiagnosticsState {
  return {
    toolCalls: new Map(),
    recentEvents: [],
    notes: new Set(),
  };
}

export function extractEventSessionID(event: Event): string | undefined {
  switch (event.type) {
    case 'session.idle':
    case 'session.status':
      return event.properties.sessionID;
    case 'session.error':
      return event.properties.sessionID;
    case 'message.updated':
      return event.properties.info.sessionID;
    case 'message.part.updated':
      return event.properties.part.sessionID;
    default:
      return undefined;
  }
}

export function captureDelegationEvent(state: DelegationDiagnosticsState, event: Event): boolean {
  switch (event.type) {
    case 'session.error': {
      state.sessionError = normalizeError(event.properties.error) ?? state.sessionError;
      pushRecentEvent(state, {
        type: event.type,
        sessionID: event.properties.sessionID,
        error: normalizeError(event.properties.error),
      });
      addNote(state, 'A session.error event was emitted for the delegated session.');
      return true;
    }
    case 'session.status': {
      pushRecentEvent(state, {
        type: event.type,
        sessionID: event.properties.sessionID,
        status: sanitizeValue(event.properties.status),
      });
      return true;
    }
    case 'message.updated': {
      const info = event.properties.info;
      if (info.role !== 'assistant' || !info.error) return false;

      state.assistantError = normalizeError(info.error) ?? state.assistantError;
      pushRecentEvent(state, {
        type: event.type,
        sessionID: info.sessionID,
        messageID: info.id,
        role: info.role,
        error: normalizeError(info.error),
        status: info.finish,
      });
      addNote(state, 'An assistant message error was exposed in message.updated.');
      return true;
    }
    case 'message.part.updated': {
      if (!isToolPart(event.properties.part)) return false;

      const toolCall = toToolCallDiagnostic(event.properties.part);
      const interesting = isInterestingToolCall(toolCall);

      if (interesting) {
        upsertToolCall(state, toolCall);
      }

      pushRecentEvent(state, {
        type: event.type,
        sessionID: event.properties.part.sessionID,
        messageID: event.properties.part.messageID,
        tool: event.properties.part.tool,
        callID: event.properties.part.callID,
        status: event.properties.part.state.status,
        rawCaptured: Boolean(toolCall.raw),
        error: toolCall.error
          ? {
              message: toolCall.error,
            }
          : undefined,
        time: sanitizeValue(getToolStateTime(event.properties.part.state)),
      });

      if (toolCall.raw) {
        addNote(state, 'A sanitized raw tool-call payload was captured from ToolStatePending.raw.');
      }
      if (toolCall.error) {
        addNote(state, 'A tool part reported an error state.');
      }

      return interesting;
    }
    default:
      return false;
  }
}

export function captureMessageSnapshot(
  state: DelegationDiagnosticsState,
  messages: SessionMessageItem[] | undefined,
): void {
  if (!messages) {
    state.messageSnapshot = {
      totalMessages: 0,
      assistantMessages: 0,
      inspectionError: 'session.messages returned no data',
    };
    addNote(state, 'session.messages returned no data while building diagnostics.');
    return;
  }

  const assistantMessages = messages.filter(isAssistantMessage);
  const toolCalls: DelegationToolCallDiagnostic[] = [];

  for (const message of assistantMessages) {
    for (const part of message.parts) {
      if (!isToolPart(part)) continue;

      const toolCall = toToolCallDiagnostic(part);
      if (!isInterestingToolCall(toolCall)) continue;

      toolCalls.push(toolCall);
      upsertToolCall(state, toolCall);
    }
  }

  const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
  const textPartCount = lastAssistantMessage?.parts.filter((part) => part.type === 'text').length ?? 0;

  if (lastAssistantMessage?.info.error) {
    state.assistantError = normalizeError(lastAssistantMessage.info.error) ?? state.assistantError;
  }

  if (lastAssistantMessage && textPartCount === 0) {
    addNote(
      state,
      'No assistant text parts were available in session.messages; diagnostics reflect surrounding tool and error context only.',
    );
  }

  state.messageSnapshot = {
    totalMessages: messages.length,
    assistantMessages: assistantMessages.length,
    lastAssistantMessage: lastAssistantMessage
      ? {
          messageID: lastAssistantMessage.info.id,
          finish: lastAssistantMessage.info.finish,
          error: normalizeError(lastAssistantMessage.info.error),
          partTypes: lastAssistantMessage.parts.map((part) => part.type),
          textPartCount,
          toolCalls: toolCalls.slice(0, MAX_TOOL_CALL_COUNT),
        }
      : undefined,
  };
}

export function captureMessageInspectionError(state: DelegationDiagnosticsState, error: Error): void {
  state.messageSnapshot = {
    totalMessages: 0,
    assistantMessages: 0,
    inspectionError: error.message,
  };
  addNote(state, 'session.messages could not be inspected while building diagnostics.');
}

export function buildDelegationDiagnosticsReport(
  delegation: Delegation,
  state: DelegationDiagnosticsState,
  trigger: string,
): DelegationDiagnosticsReport | undefined {
  const toolCalls = [...state.toolCalls.values()].slice(0, MAX_TOOL_CALL_COUNT);
  const rawPayloadAvailable = toolCalls.some((toolCall) => Boolean(toolCall.raw));
  const shouldPersist =
    Boolean(state.promptError) ||
    Boolean(state.sessionError) ||
    Boolean(state.assistantError) ||
    toolCalls.length > 0 ||
    Boolean(state.messageSnapshot?.inspectionError);

  if (!shouldPersist) return undefined;

  const rawPayloadNote = rawPayloadAvailable
    ? 'Sanitized raw tool-call payload was captured from the delegated session.'
    : toolCalls.length > 0 || state.sessionError || state.assistantError
      ? 'Exact raw tool-call payload was not exposed by current event/message data. Diagnostics contain the best available surrounding context.'
      : 'No delegated tool-call payload was observed before the failure surfaced.';

  return {
    capturedAt: new Date().toISOString(),
    trigger,
    rawPayloadAvailable,
    rawPayloadNote,
    delegation: {
      id: delegation.id,
      sessionID: delegation.sessionID,
      parentSessionID: delegation.parentSessionID,
      agent: delegation.agent,
      status: delegation.status,
      startedAt: delegation.startedAt.toISOString(),
      completedAt: delegation.completedAt?.toISOString(),
    },
    promptError: state.promptError,
    sessionError: state.sessionError,
    assistantError: state.assistantError,
    toolCalls,
    recentEvents: state.recentEvents,
    messageSnapshot: state.messageSnapshot,
    notes: [...state.notes],
  };
}
