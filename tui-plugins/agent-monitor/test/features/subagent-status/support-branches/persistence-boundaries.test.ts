import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadState } from '../../../../src/features/subagent-status/infrastructure/persistence/load.ts';
import {
  createPersistQueue,
  persistSnapshot,
} from '../../../../src/features/subagent-status/infrastructure/persistence/queue.ts';
import {
  resolveDebugPath,
  resolveStatePath,
  resolveTextPath,
  shouldPreserveStateOnStartup,
  writeLocalFile,
} from '../../../../src/features/subagent-status/infrastructure/persistence/io.ts';
import type { SubagentState } from '../../../../src/features/subagent-status/domain/types.ts';

const emptyState = (): SubagentState => ({
  children: {},
  countedChildIDs: {},
  purgedSessionIDs: {},
  totalExecuted: 0,
  updatedAt: new Date().toISOString(),
});

describe('persistence boundary branches', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    vi.restoreAllMocks();
  });

  it('resolves explicit and derived paths and preserves only explicit startup settings', () => {
    expect(resolveStatePath({ statePath: ' /custom/state.json ' })).toBe(' /custom/state.json ');
    expect(resolveTextPath('/tmp/state.json')).toBe('/tmp/status.txt');
    expect(resolveDebugPath('/tmp/state.json')).toBe('/tmp/debug.json');
    expect(shouldPreserveStateOnStartup()).toBe(false);
    expect(shouldPreserveStateOnStartup({ preserveStateOnStartup: true })).toBe(true);
    expect(resolveStatePath('/workspace')).toContain('workspace-');
  });

  it('falls back to empty state for unreadable and malformed snapshots', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-support-'));
    dirs.push(dir);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeFile(join(dir, 'bad.json'), '{not-json');
    await expect(loadState(join(dir, 'missing.json'))).resolves.toMatchObject({ children: {} });
    await expect(loadState(join(dir, 'bad.json'))).resolves.toMatchObject({ children: {} });
    expect(warn).toHaveBeenCalled();
  });

  it('skips invalid persisted records while retaining valid partial token data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-support-'));
    dirs.push(dir);
    const path = join(dir, 'state.json');
    await writeFile(
      path,
      JSON.stringify({
        updatedAt: '2026-01-01T00:00:00.000Z',
        totalExecuted: 'bad',
        countedChildIDs: { good: true, bad: 'yes' },
        purgedSessionIDs: { ses_ok: true, other: true },
        children: {
          good: { parentID: 'ses_parent', status: 'running', tokens: { input: 4 }, title: 4 },
          invalid: { parentID: 'ses_parent', status: 'pending' },
        },
      }),
    );
    const state = await loadState(path);
    expect(state.children.good).toMatchObject({ id: 'good', title: 'good', tokens: { input: 4 } });
    expect(state.children.invalid).toBeUndefined();
    expect(state.purgedSessionIDs).toEqual({ ses_ok: true });
  });

  it('serializes queued snapshots and reports write failures without rejecting callers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const state = emptyState();
    await persistSnapshot('/definitely/missing/state.json', '/definitely/missing/status.txt', state, {
      statusText: 'x',
      debugSnapshot: '{}',
    });
    expect(warn).toHaveBeenCalled();
    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-support-'));
    dirs.push(dir);
    const persist = createPersistQueue(
      join(dir, 'state.json'),
      join(dir, 'status.txt'),
      (_state, meta: { tag: string }) => ({ statusText: meta.tag, debugSnapshot: meta.tag }),
    );
    await Promise.all([persist(state, { tag: 'first' }), persist(state, { tag: 'second' })]);
    expect(await import('node:fs/promises').then(({ readFile }) => readFile(join(dir, 'status.txt'), 'utf8'))).toBe(
      'second',
    );
  });
});
