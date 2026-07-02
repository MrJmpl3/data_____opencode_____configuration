import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { OpenCodeGoWorkspaceConfig } from '../../domain/types.ts';
import type { QuotaPluginOptions } from '../../domain/types.ts';
import { isRecord } from './shared.ts';

export interface QuotaFileConfig {
  /** Provider-specific configuration */
  providers?: {
    'opencode-go'?: {
      authCookie: string;
      workspaces: readonly OpenCodeGoWorkspaceConfig[];
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
    experimentalOpenAIResetCredits?: QuotaPluginOptions['experimentalOpenAIResetCredits'];
  };
}

const quotaConfigPath = (): string => {
  const configDir = process.env.OPENCODE_CONFIG_DIR;
  if (configDir) return join(configDir, 'quota.json');
  return join(homedir(), '.config', 'opencode', 'quota.json');
};

const asStringArray = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
};

const normalizeWorkspaceEntries = (value: unknown): readonly OpenCodeGoWorkspaceConfig[] => {
  if (!Array.isArray(value)) return [];

  const workspaces: OpenCodeGoWorkspaceConfig[] = [];

  for (const rawWorkspace of value) {
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

    const config: QuotaFileConfig = {};

    // ── providers ──────────────────────────────────────────────────────
    const providers = isRecord(parsed.providers) ? parsed.providers : {};

    const goSection = isRecord(providers['opencode-go']) ? providers['opencode-go'] : {};
    const authCookie = typeof goSection.authCookie === 'string' ? goSection.authCookie.trim() : '';
    const workspaces = normalizeWorkspaceEntries(goSection.workspaces);
    if (authCookie && workspaces.length > 0) {
      config.providers = { 'opencode-go': { authCookie, workspaces } };
    }

    // ── options ────────────────────────────────────────────────────────
    const opts = isRecord(parsed.options) ? parsed.options : {};
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
    if (typeof opts.minRefreshIntervalMs === 'number' && Number.isFinite(opts.minRefreshIntervalMs)) {
      options.minRefreshIntervalMs = opts.minRefreshIntervalMs;
    }
    if (typeof opts.providerCacheTtlMs === 'number' && Number.isFinite(opts.providerCacheTtlMs)) {
      options.providerCacheTtlMs = opts.providerCacheTtlMs;
    }
    if (typeof opts.providerErrorBackoffMs === 'number' && Number.isFinite(opts.providerErrorBackoffMs)) {
      options.providerErrorBackoffMs = opts.providerErrorBackoffMs;
    }

    options.experimentalOpenAIResetCredits = opts.experimentalOpenAIResetCredits === true;

    if (Object.keys(options).length > 0) {
      config.options = options;
    }

    return config;
  } catch {
    return null;
  }
};
