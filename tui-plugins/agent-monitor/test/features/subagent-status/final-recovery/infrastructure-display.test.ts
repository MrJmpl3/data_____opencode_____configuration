import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hydrateDoneChildTokens,
  resetDoneTokenCache,
} from '../../../../src/features/subagent-status/infrastructure/logs.ts';
import { readSubagentStatusOptions } from '../../../../src/features/subagent-status/infrastructure/config.ts';
import { persistSnapshot } from '../../../../src/features/subagent-status/infrastructure/persistence/queue.ts';
import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';
import { conciseText } from '../../../../src/features/subagent-status/shared/display.ts';

describe('final infrastructure recovery boundaries', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetDoneTokenCache();
    delete process.env.OPENCODE_CONFIG_DIR;
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('returns undefined for non-object and invalid config sections', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-final-config-'));
    dirs.push(dir);
    process.env.OPENCODE_CONFIG_DIR = dir;
    await writeFile(
      join(dir, 'agent-monitor.json'),
      JSON.stringify({ sections: { 'subagent-status': { options: [] } } }),
    );
    expect(readSubagentStatusOptions()).toEqual([]);
    await writeFile(join(dir, 'agent-monitor.json'), '[]');
    expect(readSubagentStatusOptions()).toBeUndefined();
  });

  it('handles missing log directories and throttles exhausted token recovery', async () => {
    vi.useFakeTimers();
    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-final-logs-'));
    dirs.push(dir);
    await expect(hydrateDoneChildTokens('ses_missing', join(dir, 'missing'))).rejects.toThrow('ENOENT');
    for (let attempt = 0; attempt < 15; attempt++) {
      await hydrateDoneChildTokens('ses_missing', dir);
      vi.advanceTimersByTime(2001);
    }
    await expect(hydrateDoneChildTokens('ses_missing', dir)).resolves.toBeUndefined();
  });

  it('keeps persistence failures non-fatal and truncates display text at the boundary', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-final-file-'));
    dirs.push(dir);
    const file = join(dir, 'not-a-directory');
    await writeFile(file, 'file');
    await persistSnapshot(join(file, 'state.json'), join(file, 'status.txt'), createEmptyState(), {
      statusText: 'status',
      debugSnapshot: '{}',
    });
    expect(warn).toHaveBeenCalled();
    expect(conciseText('x'.repeat(180))).toBe('x'.repeat(180));
    expect(conciseText('x'.repeat(181))).toBe(`${'x'.repeat(179)}…`);
  });

  it('writes discovered token data from a later log without accepting invalid session ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-final-token-'));
    dirs.push(dir);
    await writeFile(join(dir, 'event.log'), 'ses_done {"usage":{"prompt_tokens":7,"completion_tokens":8}}\n');
    expect(await hydrateDoneChildTokens('invalid', dir)).toBeUndefined();
    expect(await hydrateDoneChildTokens('ses_done', dir)).toMatchObject({ input: 7, output: 8 });
    expect(await readFile(join(dir, 'event.log'), 'utf8')).toContain('ses_done');
  });
});
