import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveRecoveredStatus,
  safeParseParts,
} from '../../../../src/features/subagent-status/infrastructure/sqlite/recovery-classifier.ts';
import { createSQLiteRecoverySource } from '../../../../src/features/subagent-status/infrastructure/sqlite/hydrate.ts';
import {
  loadState,
  saveState,
  createPersistQueue,
} from '../../../../src/features/subagent-status/infrastructure/persistence.ts';
import {
  resolveDebugPath,
  resolveStatePath,
  resolveTextPath,
  shouldPreserveStateOnStartup,
  writeLocalFile,
} from '../../../../src/features/subagent-status/infrastructure/persistence/io.ts';
import type { SubagentState } from '../../../../src/features/subagent-status/domain/types.ts';
import type { SQLiteRecoveryRow } from '../../../../src/features/subagent-status/infrastructure/sqlite/script.ts';
import { createEmptyState } from '../../../../src/features/subagent-status/domain/state/core.ts';

describe('recovery and persistence edge cases', () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('prefers explicit errors, preserves all token fields, and ignores malformed parts', () => {
    const parts = safeParseParts([
      JSON.stringify({ type: 'step-start', time: { start: '2026-06-04T12:00:00.000Z' }, tokens: { input: 2 } }),
      JSON.stringify({
        type: 'step-finish',
        reason: 'stop',
        time: { end: '2026-06-04T12:01:00.000Z' },
        tokens: { output: 3 },
      }),
      JSON.stringify({ type: 'session.error', time: { completed: '2026-06-04T12:02:00.000Z' }, tokens: { total: 9 } }),
      '{not-json}',
      'null',
    ]);

    expect(resolveRecoveredStatus(parts)).toMatchObject({
      status: 'error',
      endedAt: '2026-06-04T12:02:00.000Z',
      tokens: { input: 2, output: 3, total: 9 },
      evidence: 'explicit',
    });
    expect(parts[3]).toBeUndefined();
  });

  it('treats a step finish before a later step start as running', () => {
    expect(
      resolveRecoveredStatus([
        { type: 'step-finish', reason: 'stop', time: { end: '2026-06-04T12:01:00.000Z' } },
        { type: 'step-start', time: { start: '2026-06-04T12:02:00.000Z' } },
      ]).status,
    ).toBe('running');
  });

  it('hydrates rows, skips without a parent, and protects explicit terminal rows', async () => {
    const rows: SQLiteRecoveryRow[] = [
      {
        id: 'ses_done',
        parentID: 'ses_parent',
        title: 'Done',
        startedAtMs: 1000,
        updatedAtMs: 2000,
        endedAtMs: 2000,
        partCount: 1,
        stepStartCount: 0,
        status: 'done',
        evidence: 'explicit',
        tokens: { total: 4 },
      },
    ];
    const readRows = vi.fn(async () => rows);
    const source = createSQLiteRecoverySource({ databasePath: 'db', readRows });
    const state = createEmptyState();

    expect(await source.hydrateState(state, { directory: '/tmp' })).toBeUndefined();
    expect(readRows).not.toHaveBeenCalled();

    const result = await source.hydrateState(state, { directory: '/tmp', parentSessionID: 'ses_parent' });
    expect(result).toMatchObject({
      changed: true,
      authoritativeSessionIDs: ['ses_done'],
      protectedTerminalSessionIDs: ['ses_done'],
    });
    expect(state.children.ses_done).toMatchObject({ status: 'done', tokens: { total: 4 } });
  });

  it('loads corrupt snapshots as empty state and recovers from a source failure without throwing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-monitor-recovery-'));
    directories.push(directory);
    const statePath = join(directory, 'state.json');
    await writeLocalFile(statePath, '{bad');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const loaded = await loadState(statePath, {
      recoverySources: [
        {
          hydrateState: () => {
            throw new Error('source unavailable');
          },
        },
      ],
    });

    expect(loaded.children).toEqual({});
    expect(loaded.totalExecuted).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('reconciles counted subtask identities and strips transient recovery state when saving', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:05:00.000Z'));
    const directory = await mkdtemp(join(tmpdir(), 'agent-monitor-persistence-'));
    directories.push(directory);
    const statePath = join(directory, 'state.json');
    const state = {
      ...createEmptyState(),
      recovering: true,
      children: {
        task: {
          id: 'task',
          title: 'Task',
          parentID: 'ses_parent',
          source: 'subtask' as const,
          targetSessionID: 'ses_target',
          status: 'running' as const,
          startedAt: '2026-06-04T12:00:00.000Z',
          updatedAt: '2026-06-04T12:00:00.000Z',
        },
        ses_target: {
          id: 'ses_target',
          title: 'Target',
          parentID: 'ses_parent',
          source: 'session' as const,
          targetSessionID: 'ses_target',
          status: 'running' as const,
          startedAt: '2026-06-04T12:00:00.000Z',
          updatedAt: '2026-06-04T12:00:00.000Z',
        },
      },
      countedChildIDs: { task: true },
      totalExecuted: 1,
    } satisfies SubagentState;
    await saveState(statePath, state);
    const saved = JSON.parse(await readFile(statePath, 'utf8'));
    expect(saved.recovering).toBeUndefined();
    expect((await loadState(statePath)).countedChildIDs).toEqual({ ses_target: true });
  });

  it('serializes queued snapshots and uses stable path helpers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-monitor-queue-'));
    directories.push(directory);
    const statePath = join(directory, 'state.json');
    const textPath = resolveTextPath(statePath);
    const persist = createPersistQueue(statePath, textPath, (_state, meta: { value: string }) => ({
      statusText: meta.value,
      debugSnapshot: meta.value,
    }));

    const first = persist(createEmptyState(), { value: 'first' });
    const second = persist(createEmptyState(), { value: 'second' });
    await Promise.all([first, second]);
    expect(await readFile(textPath, 'utf8')).toBe('second');
    expect(resolveDebugPath(statePath)).toBe(join(directory, 'debug.json'));
    expect(resolveStatePath({ statePath })).toBe(statePath);
    expect(shouldPreserveStateOnStartup({ preserveStateOnStartup: true })).toBe(true);
    expect(shouldPreserveStateOnStartup()).toBe(false);
  });
});
