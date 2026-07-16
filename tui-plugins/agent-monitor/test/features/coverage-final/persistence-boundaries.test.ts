import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { persistSnapshot } from '../../../src/features/subagent-status/infrastructure/persistence/queue.ts';
import {
  resolveStatePath,
  resolveTextPath,
  shouldPreserveStateOnStartup,
} from '../../../src/features/subagent-status/infrastructure/persistence/io.ts';
import type { SubagentState } from '../../../src/features/subagent-status/domain/types.ts';

const snapshot: SubagentState = {
  children: {},
  countedChildIDs: {},
  purgedSessionIDs: {},
  totalExecuted: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
  recovering: true,
};

describe('persistence boundary branches', () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('resolves explicit and derived persistence paths', () => {
    expect(resolveStatePath({ statePath: ' /tmp/custom ' })).toBe(' /tmp/custom ');
    expect(resolveTextPath('/tmp/state.json')).toBe('/tmp/status.txt');
    expect(shouldPreserveStateOnStartup()).toBe(false);
    expect(shouldPreserveStateOnStartup({ preserveStateOnStartup: true })).toBe(true);
  });

  it('swallows a failed atomic snapshot write after temporary-file cleanup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-monitor-persistence-final-'));
    directories.push(directory);
    await mkdir(join(directory, 'state.json'));
    await expect(
      persistSnapshot(join(directory, 'state.json'), join(directory, 'status.txt'), snapshot, {
        statusText: 'status',
        debugSnapshot: '{}',
      }),
    ).resolves.toBeUndefined();
  });
});
