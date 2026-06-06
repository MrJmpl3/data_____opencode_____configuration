export type QuotaProviderId = 'go' | 'copilot' | 'openrouter' | 'openai';
export type QuotaDisplayMode = 'remaining' | 'used';

export interface QuotaPluginOptions {
  displayMode?: QuotaDisplayMode;
  visibleProviders?: readonly string[];
  pollIntervalMs?: number;
  minRefreshIntervalMs?: number;
  providerCacheTtlMs?: number;
  providerErrorBackoffMs?: number;
}

export interface ProviderSpec {
  id: QuotaProviderId;
  label: string;
}

export interface PercentWindow {
  usedPct: number;
  resetSec: number;
  limitWindowSec?: number;
}

export interface GoWindow {
  used: number;
  remaining: number;
  resetInSec: number;
}

export interface CopilotResult {
  text: string;
  used?: number;
  remaining?: number;
  total?: number;
  pctRemaining?: number;
  unlimited?: boolean;
  resetTimeIso?: string;
  resetSec?: number;
}

export interface OpenRouterResult {
  text: string;
  remaining?: number;
  total?: number;
  usage?: number;
}

export interface OpenAIWindow extends PercentWindow {}

export interface OpenAIAdditionalRateLimit {
  label: string;
  limitName?: string;
  meteredFeature?: string;
  allowed?: boolean;
  limitReached?: boolean;
  primary?: OpenAIWindow;
  secondary?: OpenAIWindow;
}

export interface OpenAIResult {
  planType?: string;
  hourly?: OpenAIWindow;
  weekly?: OpenAIWindow;
  codeReview?: OpenAIWindow;
  credits?: string;
  additionalRateLimits?: OpenAIAdditionalRateLimit[];
}
