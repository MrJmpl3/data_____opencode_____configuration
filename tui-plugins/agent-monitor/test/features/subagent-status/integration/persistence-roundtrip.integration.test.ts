import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadState, persistSnapshot } from '../../../../src/features/subagent-status/infrastructure/persistence.ts';
import { formatPersistedSnapshot } from '../../../../src/features/subagent-status/runtime/snapshot.ts';
import { createChild, createState } from '../fixtures/subagent-state.ts';

describe('persistence round-trip integration', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:05:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('preserves children, counts, totalExecuted, and updatedAt through save-load round-trip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-roundtrip-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    const textPath = join(dir, 'status.txt');

    // Build a populated state with a variety of children.
    const originalChildren = [
      createChild({
        id: 'ses_done_1',
        title: 'Completed task',
        parentID: 'ses_parent',
        status: 'done',
        endedAt: '2026-06-04T11:55:00.000Z',
        source: 'session',
        targetSessionID: 'ses_done_1',
        tokens: { input: 120, output: 45, total: 165 },
      }),
      createChild({
        id: 'ses_error_1',
        title: 'Failed task',
        parentID: 'ses_parent',
        status: 'error',
        endedAt: '2026-06-04T11:50:00.000Z',
        source: 'session',
        targetSessionID: 'ses_error_1',
      }),
      createChild({
        id: 'ses_running_1',
        title: 'Running task',
        parentID: 'ses_parent',
        status: 'running',
        source: 'session',
        targetSessionID: 'ses_running_1',
      }),
      createChild({
        id: 'tool:subtask_1',
        title: 'Subtask via tool',
        parentID: 'ses_parent',
        status: 'done',
        endedAt: '2026-06-04T11:52:00.000Z',
        source: 'tool',
        targetSessionID: 'ses_sub_1',
      }),
    ];

    const originalState = createState(originalChildren, 5);
    // override totalExecuted to be greater than children.length
    originalState.totalExecuted = 7;
    originalState.updatedAt = '2026-06-04T12:00:00.000Z';

    // Format and persist.
    const artifacts = formatPersistedSnapshot(originalState, { source: 'refresh' });
    await persistSnapshot(statePath, textPath, originalState, artifacts);

    // Load without recovery sources.
    const loaded = await loadState(statePath);

    // Assert totalExecuted preserved.
    expect(loaded.totalExecuted).toBe(7);

    // Assert updatedAt preserved (loadState preserves the stored updatedAt).
    expect(loaded.updatedAt).toBe('2026-06-04T12:00:00.000Z');

    // Assert child count matches.
    expect(Object.keys(loaded.children)).toHaveLength(4);

    // Assert each child's identity fields survive.
    for (const original of originalChildren) {
      const loadedChild = loaded.children[original.id];
      expect(loadedChild).toBeDefined();

      // Core identity fields survive the JSON round-trip.
      expect(loadedChild!.id).toBe(original.id);
      expect(loadedChild!.title).toBe(original.title);
      expect(loadedChild!.parentID).toBe(original.parentID);
      expect(loadedChild!.status).toBe(original.status);
      expect(loadedChild!.source).toBe(original.source);
      expect(loadedChild!.targetSessionID).toBe(original.targetSessionID);

      // Tokens survive when present.
      if (original.tokens) {
        expect(loadedChild!.tokens).toMatchObject(original.tokens);
      }

      // endedAt survives when present.
      if (original.endedAt) {
        expect(loadedChild!.endedAt).toBe(original.endedAt);
      }
    }

    // Assert countedChildIDs preserved.
    const expectedCounted = Object.fromEntries(originalChildren.map((c) => [c.id, true]));
    expect(loaded.countedChildIDs).toMatchObject(expectedCounted);

    // Assert purgedSessionIDs is empty.
    expect(loaded.purgedSessionIDs).toEqual({});
  });

  it('survives a second save-load cycle without data loss', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-roundtrip2-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');
    const textPath = join(dir, 'status.txt');

    const child = createChild({
      id: 'ses_cycle',
      title: 'Cycle test',
      parentID: 'ses_parent',
      status: 'running',
      source: 'session',
      targetSessionID: 'ses_cycle',
    });

    const state = createState([child], 1);
    state.updatedAt = '2026-06-04T12:00:00.000Z';

    // First round-trip.
    await persistSnapshot(statePath, textPath, state, formatPersistedSnapshot(state, { source: 'refresh' }));
    const loaded1 = await loadState(statePath);
    expect(loaded1.children.ses_cycle).toBeDefined();
    expect(loaded1.totalExecuted).toBe(1);

    // Modify and persist again.
    loaded1.totalExecuted = 2;
    loaded1.children.ses_cycle.status = 'done';
    loaded1.children.ses_cycle.endedAt = '2026-06-04T12:02:00.000Z';
    loaded1.updatedAt = '2026-06-04T12:02:00.000Z';

    await persistSnapshot(statePath, textPath, loaded1, formatPersistedSnapshot(loaded1, { source: 'refresh' }));
    const loaded2 = await loadState(statePath);

    expect(loaded2.children.ses_cycle).toBeDefined();
    expect(loaded2.children.ses_cycle!.status).toBe('done');
    expect(loaded2.children.ses_cycle!.endedAt).toBe('2026-06-04T12:02:00.000Z');
    expect(loaded2.totalExecuted).toBe(2);
    expect(loaded2.updatedAt).toBe('2026-06-04T12:02:00.000Z');
  });
});
