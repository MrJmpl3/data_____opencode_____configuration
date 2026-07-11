import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { OpenCodeGoWorkspaceConfig, QuotaPluginOptions } from '../../domain/types.ts';
import { isRecord } from '../../../../kit/coercion.ts';

export interface QuotaFileConfig {
  /** Provider-specific configuration */
  providers?: {
    'opencode-go'?: {
      authCookie: string;
      workspaces: readonly OpenCodeGoWorkspaceConfig[];
    };
    'ollama-cloud'?: {
      authCookie: string;
    };
  };
  /** Plugin options */
  options?: {
    displayMode?: QuotaPluginOptions['displayMode'];
    visibleProviders?: QuotaPluginOptions['visibleProviders'];
    pollIntervalMs?: QuotaPluginOptions['pollIntervalMs'];
    minRefreshIntervalMs?: QuotaPluginOptions['minRefreshIntervalMs'];
    providerCacheTtlMs?: QuotaPluginOptions['providerCacheTtlMs'];
    providerErrorBackoffMs?: QuotaPluginOptions['providerErrorBackoffMs'];
    fetchTimeoutMs?: QuotaPluginOptions['fetchTimeoutMs'];
    experimentalOpenAIResetCredits?: QuotaPluginOptions['experimentalOpenAIResetCredits'];
  };
}

const quotaConfigPath = (): string => {
  const configDir = process.env.OPENCODE_CONFIG_DIR;
  if (configDir) return join(configDir, 'agent-monitor.json');
  return join(homedir(), '.config', 'opencode', 'agent-monitor.json');
};

const asStringArray = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
};

// Accepts both flat OpenCodeGoWorkspaceConfig[] and one-level-nested OpenCodeGoWorkspaceConfig[][].
const normalizeWorkspaceEntries = (value: unknown): readonly OpenCodeGoWorkspaceConfig[] => {
  if (!Array.isArray(value)) return [];

  const workspaces: OpenCodeGoWorkspaceConfig[] = [];

  for (const rawWorkspace of value.flat()) {
    if (!isRecord(rawWorkspace)) continue;

    const workspaceId = typeof rawWorkspace.workspaceId === 'string' ? rawWorkspace.workspaceId.trim() : '';
    const label = typeof rawWorkspace.label === 'string' ? rawWorkspace.label.trim() : '';

    if (!workspaceId || !label) continue;

    workspaces.push({ workspaceId, label });
  }

  return workspaces;
};

export const readQuotaConfig = (): QuotaFileConfig | null => {
  const path = quotaConfigPath();
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!isRecord(parsed)) return null;

    const sectionsRecord = isRecord(parsed.sections) ? parsed.sections : {};
    const quotaSection = isRecord(sectionsRecord.quota) ? sectionsRecord.quota : {};

    const config: QuotaFileConfig = {};

    // ── providers ──────────────────────────────────────────────────────
    const providers = isRecord(quotaSection.providers) ? quotaSection.providers : {};

    const opencodeGoSection = isRecord(providers['opencode-go']) ? providers['opencode-go'] : {};
    const authCookie = typeof opencodeGoSection.authCookie === 'string' ? opencodeGoSection.authCookie.trim() : '';
    const workspaces = normalizeWorkspaceEntries(opencodeGoSection.workspaces);
    if (authCookie && workspaces.length > 0) {
      config.providers = { 'opencode-go': { authCookie, workspaces } };
    }

    const ollamaSection = isRecord(providers['ollama-cloud']) ? providers['ollama-cloud'] : {};
    const ollamaCookie = typeof ollamaSection.authCookie === 'string' ? ollamaSection.authCookie.trim() : '';
    if (ollamaCookie) {
      config.providers = { ...(config.providers ?? {}), 'ollama-cloud': { authCookie: ollamaCookie } };
    }

    // ── options ────────────────────────────────────────────────────────
    const opts = isRecord(quotaSection.options) ? quotaSection.options : {};
    const options: QuotaFileConfig['options'] = {};

    if (typeof opts.displayMode === 'string') {
      options.displayMode = opts.displayMode === 'used' ? 'used' : 'remaining';
    }

    const providersList = asStringArray(opts.visibleProviders);
    if (providersList.length > 0) {
      options.visibleProviders = providersList;
    }

    if (typeof opts.pollIntervalMs === 'number' && Number.isFinite(opts.pollIntervalMs)) {
      options.pollIntervalMs = opts.pollIntervalMs;
    }

    if (opts.experimentalOpenAIResetCredits === true) {
      options.experimentalOpenAIResetCredits = true;
    }

    if (typeof opts.minRefreshIntervalMs === 'number' && Number.isFinite(opts.minRefreshIntervalMs)) {
      options.minRefreshIntervalMs = opts.minRefreshIntervalMs;
    }
    if (typeof opts.providerCacheTtlMs === 'number' && Number.isFinite(opts.providerCacheTtlMs)) {
      options.providerCacheTtlMs = opts.providerCacheTtlMs;
    }
    if (typeof opts.providerErrorBackoffMs === 'number' && Number.isFinite(opts.providerErrorBackoffMs)) {
      options.providerErrorBackoffMs = opts.providerErrorBackoffMs;
    }
    if (typeof opts.fetchTimeoutMs === 'number' && Number.isFinite(opts.fetchTimeoutMs)) {
      options.fetchTimeoutMs = opts.fetchTimeoutMs;
    }

    if (Object.keys(options).length > 0) {
      config.options = options;
    }

    return config;
  } catch (e) {
    console.warn('[agent-monitor] Failed to parse agent-monitor.json:', e instanceof Error ? e : String(e));
    return null;
  }
};
