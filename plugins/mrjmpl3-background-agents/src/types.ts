import type { createOpencodeClient } from '@opencode-ai/sdk';
import type { Message, Part } from '@opencode-ai/sdk';

export type OpencodeClient = ReturnType<typeof createOpencodeClient>;

export interface GeneratedMetadata {
  title: string;
  description: string;
}

export interface SessionMessageItem {
  info: Message;
  parts: Part[];
}

export interface AssistantSessionMessageItem {
  info: Message & { role: 'assistant' };
  parts: Part[];
}

export interface DelegationProgress {
  toolCalls: number;
  lastUpdate: Date;
  lastMessage?: string;
  lastMessageAt?: Date;
}

export interface DelegationDiagnosticError {
  name?: string;
  message?: string;
  statusCode?: number;
  isRetryable?: boolean;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}

export interface DelegationToolCallDiagnostic {
  partID: string;
  callID?: string;
  messageID?: string;
  tool: string;
  status: string;
  input?: unknown;
  raw?: string;
  error?: string;
  metadata?: unknown;
  time?: unknown;
}

export interface DelegationEventDiagnostic {
  type: string;
  sessionID?: string;
  messageID?: string;
  role?: string;
  tool?: string;
  callID?: string;
  status?: unknown;
  error?: DelegationDiagnosticError;
  rawCaptured?: boolean;
  time?: unknown;
}

export interface DelegationMessageSnapshot {
  totalMessages: number;
  assistantMessages: number;
  lastAssistantMessage?: {
    messageID: string;
    finish?: string;
    error?: DelegationDiagnosticError;
    partTypes: string[];
    textPartCount: number;
    toolCalls: DelegationToolCallDiagnostic[];
  };
  inspectionError?: string;
}

export interface DelegationDiagnosticsReport {
  capturedAt: string;
  trigger: string;
  rawPayloadAvailable: boolean;
  rawPayloadNote: string;
  delegation: {
    id: string;
    sessionID: string;
    parentSessionID: string;
    agent: string;
    status: string;
    startedAt: string;
    completedAt?: string;
  };
  promptError?: string;
  sessionError?: DelegationDiagnosticError;
  assistantError?: DelegationDiagnosticError;
  toolCalls: DelegationToolCallDiagnostic[];
  recentEvents: DelegationEventDiagnostic[];
  messageSnapshot?: DelegationMessageSnapshot;
  notes: string[];
}

export const DELEGATION_STALL_TIMEOUT_MS = 5 * 60 * 1000;
export const MAX_RUN_TIME_MS = 15 * 60 * 1000;

export interface Delegation {
  id: string;
  sessionID: string;
  parentSessionID: string;
  parentMessageID: string;
  parentAgent: string;
  prompt: string;
  agent: string;
  status: 'running' | 'complete' | 'error' | 'cancelled' | 'timeout';
  startedAt: Date;
  completedAt?: Date;
  progress: DelegationProgress;
  error?: string;
  title?: string;
  description?: string;
  result?: string;
}

export interface DelegateInput {
  parentSessionID: string;
  parentMessageID: string;
  parentAgent: string;
  prompt: string;
  agent: string;
}

export interface DelegationListItem {
  id: string;
  status: string;
  title?: string;
  description?: string;
  agent?: string;
}

export interface DelegateArgs {
  prompt: string;
  agent: string;
}

export interface DelegationForContext {
  id: string;
  agent?: string;
  title?: string;
  description?: string;
  status: string;
  startedAt?: Date;
  prompt?: string;
}

export interface SystemTransformInput {
  agent?: string;
  sessionID?: string;
}

export type PermissionEntry = 'ask' | 'allow' | 'deny' | Record<string, 'ask' | 'allow' | 'deny'>;

export interface AgentModelResolution {
  providerID: string;
  modelID: string;
  variant?: string;
}
