import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readSubagentStatusOptions } from '../../../../src/features/subagent-status/infrastructure/config.ts';
import {
  hydrateDoneChildTokens,
  readOpenCodeLogFileIfSmall,
  resetDoneTokenCache,
} from '../../../../src/features/subagent-status/infrastructure/logs.ts';
import { createPersistQueue } from '../../../../src/features/subagent-status/infrastructure/persistence/queue.ts';
import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';

describe('subagent-status infrastructure boundaries', () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    resetDoneTokenCache();
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
    delete process.env.OPENCODE_CONFIG_DIR;
  });

  it.each([
    ['missing file', undefined, undefined],
    ['invalid JSON', '{', undefined],
    ['non-object JSON', '[]', undefined],
    ['missing options', JSON.stringify({ sections: { 'subagent-status': {} } }), undefined],
    [
      'valid options',
      JSON.stringify({ sections: { 'subagent-status': { options: { debug: true } } } }),
      { debug: true },
    ],
  ])('reads config boundary: %s', async (_label, contents, expected) => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-monitor-config-'));
    directories.push(directory);
    process.env.OPENCODE_CONFIG_DIR = directory;
    if (contents !== undefined) await writeFile(join(directory, 'agent-monitor.json'), contents);

    expect(readSubagentStatusOptions()).toEqual(expected);
  });

  it.each([['not a session', 'child', undefined]])(
    'handles log lookup boundary: %s',
    async (_label, sessionId, expected) => {
      const directory = await mkdtemp(join(tmpdir(), 'agent-monitor-logs-'));
      directories.push(directory);
      expect(await hydrateDoneChildTokens(sessionId, join(directory, 'missing'))).toEqual(expected);
    },
  );

  it('surfaces an unreadable log directory as a rejected read', async () => {
    await expect(hydrateDoneChildTokens('ses_missing', '/path/that/does/not/exist')).rejects.toThrow('ENOENT');
  });

  it('extracts nested token hints, normalizes percentages, and throttles repeated reads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-monitor-logs-'));
    directories.push(directory);
    await writeFile(
      join(directory, 'a.log'),
      `noise ses_child {"usage":{"input_tokens":4,"output_tokens":5,"context_usage":0.25}}\n`,
    );

    expect(await hydrateDoneChildTokens('ses_child', directory)).toEqual({ input: 4, output: 5, contextPercent: 25 });
    expect(await hydrateDoneChildTokens('ses_child', directory)).toEqual({ input: 4, output: 5, contextPercent: 25 });
  });

  it('rejects oversized and non-file logs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-monitor-log-size-'));
    directories.push(directory);
    const file = join(directory, 'large.log');
    await writeFile(file, 'x'.repeat(1024 * 1024 + 1));
    expect(await readOpenCodeLogFileIfSmall(file)).toBeUndefined();
    expect(await readOpenCodeLogFileIfSmall(directory)).toBeUndefined();
    await expect(readOpenCodeLogFileIfSmall(join(directory, 'missing.log'))).rejects.toThrow('ENOENT');
  });

  it('serializes queue failures without rejecting callers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const persist = createPersistQueue('/dev/null/state.json', '/dev/null/status.txt', () => ({
      statusText: 'status',
      debugSnapshot: 'debug',
    }));

    await expect(persist(createEmptyState(), undefined)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[agent-monitor] Failed to persist snapshot:', expect.any(String));
  });
});
