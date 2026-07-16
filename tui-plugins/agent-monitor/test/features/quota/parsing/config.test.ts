import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readQuotaConfig } from '../../../../src/features/quota/infrastructure/providers/config.ts';

const directories: string[] = [];

afterEach(() => {
  delete process.env.OPENCODE_CONFIG_DIR;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const writeConfig = (content: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-monitor-quota-'));
  directories.push(directory);
  process.env.OPENCODE_CONFIG_DIR = directory;
  writeFileSync(join(directory, 'agent-monitor.json'), content);
};

describe('readQuotaConfig', () => {
  it('returns null for a missing file or malformed JSON', () => {
    process.env.OPENCODE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'agent-monitor-quota-'));
    directories.push(process.env.OPENCODE_CONFIG_DIR);
    expect(readQuotaConfig()).toBeNull();
    writeConfig('{ malformed');
    expect(readQuotaConfig()).toBeNull();
  });

  it('normalizes provider credentials, flat and nested workspaces, and options', () => {
    writeConfig(
      JSON.stringify({
        sections: {
          quota: {
            providers: {
              'opencode-go': {
                authCookie: ' cookie ',
                workspaces: [
                  [{ workspaceId: ' ws-1 ', label: ' Main ' }],
                  { workspaceId: 'ws-2', label: 'Secondary' },
                  { workspaceId: '', label: 'bad' },
                ],
              },
              'ollama-cloud': { authCookie: ' ollama ' },
            },
            options: {
              displayMode: 'used',
              visibleProviders: ['openai', 4, 'ollama-cloud'],
              pollIntervalMs: 1000,
              minRefreshIntervalMs: Number.POSITIVE_INFINITY,
              providerCacheTtlMs: 2000,
              providerErrorBackoffMs: 3000,
              fetchTimeoutMs: 4000,
              experimentalOpenAIResetCredits: true,
            },
          },
        },
      }),
    );
    expect(readQuotaConfig()).toEqual({
      providers: {
        'opencode-go': {
          authCookie: 'cookie',
          workspaces: [
            { workspaceId: 'ws-1', label: 'Main' },
            { workspaceId: 'ws-2', label: 'Secondary' },
          ],
        },
        'ollama-cloud': { authCookie: 'ollama' },
      },
      options: {
        displayMode: 'used',
        visibleProviders: ['openai', 'ollama-cloud'],
        pollIntervalMs: 1000,
        providerCacheTtlMs: 2000,
        providerErrorBackoffMs: 3000,
        fetchTimeoutMs: 4000,
        experimentalOpenAIResetCredits: true,
      },
    });
  });

  it.each([
    [{ sections: { quota: { providers: { 'opencode-go': { authCookie: 'cookie', workspaces: [] } } } } }, {}],
    [
      { sections: { quota: { options: { displayMode: 'unexpected', experimentalOpenAIResetCredits: false } } } },
      { options: { displayMode: 'remaining' } },
    ],
    [{ nope: true }, {}],
  ])('omits invalid or empty sections', (input, expected) => {
    writeConfig(JSON.stringify(input));
    expect(readQuotaConfig()).toEqual(expected);
  });
});
