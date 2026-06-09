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
