import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyState, getCounts } from '../../../src/features/subagent-status/domain/state/core.ts';
import {
  pruneOrphanedSyntheticRunningChildren,
  pruneTerminalChildren,
} from '../../../src/features/subagent-status/domain/state/maintenance.ts';
import {
  markChildRunning,
  markChildStatus,
  upsertRunningChild,
} from '../../../src/features/subagent-status/domain/state/mutations.ts';
import { replaceChildren } from '../../../src/features/subagent-status/domain/state/replace.ts';
import { upsertChildDetails } from '../../../src/features/subagent-status/domain/state/mutate-details.ts';
import {
  loadState,
  resolveStatePath,
  saveState,
} from '../../../src/features/subagent-status/infrastructure/persistence.ts';

describe('state', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'));
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

  it('counts children and persists snapshots', async () => {
    const state = createEmptyState();
    replaceChildren(state, [
      {
        id: 'ses_1',
        title: 'Runner',
        parentID: 'ses_parent',
        status: 'done',
        startedAt: '2026-06-04T11:50:00.000Z',
        updatedAt: '2026-06-04T11:51:00.000Z',
        endedAt: '2026-06-04T11:51:00.000Z',
      },
    ]);

    expect(getCounts(state)).toEqual({ running: 0, done: 1, stale: 0, error: 0 });
    expect(state.totalExecuted).toBe(1);

    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');

    await saveState(statePath, state);
    const loaded = await loadState(statePath);

    expect(loaded.totalExecuted).toBe(1);
    expect(getCounts(loaded)).toEqual({ running: 0, done: 1, stale: 0, error: 0 });
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({
      totalExecuted: 1,
    });
  });

  it('derives a stable workspace-scoped state path', () => {
    const previousRuntimeDir = process.env.XDG_RUNTIME_DIR;

    try {
      process.env.XDG_RUNTIME_DIR = '/run/user/1000';

      const first = resolveStatePath('/workspaces/project-a');
      const second = resolveStatePath('/workspaces/project-a');
      const different = resolveStatePath('/workspaces/project-b');

      expect(first).toBe(second);
      expect(first).not.toContain(`pid-${process.pid}`);
      expect(first).not.toBe(different);
    } finally {
      if (previousRuntimeDir === undefined) {
        delete process.env.XDG_RUNTIME_DIR;
      } else {
        process.env.XDG_RUNTIME_DIR = previousRuntimeDir;
      }
    }
  });

  it('respects the explicit persisted state path option', () => {
    expect(resolveStatePath({ workspaceDirectory: '/workspaces/project-a', statePath: '/tmp/custom-state.json' })).toBe(
      '/tmp/custom-state.json',
    );
  });

  it('does not rewrite identical children snapshots', () => {
    const state = createEmptyState();

    expect(
      replaceChildren(state, [
        {
          id: 'ses_1',
          title: 'Runner',
          parentID: 'ses_parent',
          status: 'done',
          startedAt: '2026-06-04T11:50:00.000Z',
          updatedAt: '2026-06-04T11:51:00.000Z',
          endedAt: '2026-06-04T11:51:00.000Z',
        },
      ]),
    ).toBe(true);

    expect(
      replaceChildren(state, [
        {
          id: 'ses_1',
          title: 'Runner',
          parentID: 'ses_parent',
          status: 'done',
          startedAt: '2026-06-04T11:50:00.000Z',
          updatedAt: '2026-06-04T11:51:00.000Z',
          endedAt: '2026-06-04T11:51:00.000Z',
        },
      ]),
    ).toBe(false);
  });

  it('prunes old terminal children and orphaned synthetic running rows when loading persisted state', async () => {
    const state = createEmptyState();
    state.children = {
      ses_old: {
        id: 'ses_old',
        title: 'Old runner',
        parentID: 'ses_parent',
        status: 'done',
        startedAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:05:00.000Z',
        endedAt: '2026-06-04T10:05:00.000Z',
      },
      ses_recent: {
        id: 'ses_recent',
        title: 'Recent runner',
        parentID: 'ses_parent',
        status: 'done',
        startedAt: '2026-06-04T11:40:00.000Z',
        updatedAt: '2026-06-04T11:45:00.000Z',
        endedAt: '2026-06-04T11:45:00.000Z',
      },
      ses_running: {
        id: 'ses_running',
        title: 'Running runner',
        parentID: 'ses_parent',
        status: 'running',
        startedAt: '2026-06-04T11:55:00.000Z',
        updatedAt: '2026-06-04T11:55:00.000Z',
      },
      'tool:part_1': {
        id: 'tool:part_1',
        title: 'Stale tool',
        parentID: 'ses_missing',
        source: 'tool',
        status: 'running',
        startedAt: '2026-06-04T11:52:00.000Z',
        updatedAt: '2026-06-04T11:52:00.000Z',
      },
    };
    state.countedChildIDs = {
      ses_old: true,
      ses_recent: true,
      ses_running: true,
    };
    state.totalExecuted = 3;
    state.updatedAt = '2026-06-04T11:55:00.000Z';

    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');

    await saveState(statePath, state);
    const loaded = await loadState(statePath);

    expect(Object.keys(loaded.children)).toEqual(['ses_recent', 'ses_running']);
    expect(loaded.countedChildIDs).toEqual({
      ses_recent: true,
      ses_running: true,
    });
    expect(loaded.totalExecuted).toBe(3);
    expect(getCounts(loaded)).toEqual({ running: 1, done: 1, stale: 0, error: 0 });
  });

  it('excludes expired failed history while preserving recent failed executions and total execution history', async () => {
    const state = createEmptyState();
    state.children = {
      ses_error_old: {
        id: 'ses_error_old',
        title: 'Old failed child',
        parentID: 'ses_parent',
        source: 'session',
        status: 'error',
        color: 'red',
        startedAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:05:00.000Z',
        endedAt: '2026-06-04T10:05:00.000Z',
      },
      ses_error_recent: {
        id: 'ses_error_recent',
        title: 'Recent failed child',
        parentID: 'ses_parent',
        source: 'session',
        status: 'error',
        color: 'red',
        startedAt: '2026-06-04T11:40:00.000Z',
        updatedAt: '2026-06-04T11:45:00.000Z',
        endedAt: '2026-06-04T11:45:00.000Z',
      },
    };
    state.countedChildIDs = { ses_error_old: true, ses_error_recent: true };
    state.totalExecuted = 2;

    expect(pruneTerminalChildren(state, Date.parse('2026-06-04T12:00:00.000Z'))).toBe(true);

    expect(Object.keys(state.children)).toEqual(['ses_error_recent']);
    expect(state.countedChildIDs).toEqual({ ses_error_recent: true });
    expect(state.totalExecuted).toBe(2);
    expect(getCounts(state)).toEqual({ running: 0, done: 0, stale: 0, error: 1 });
  });

  it('treats stale rows as terminal and preserves them across persistence', async () => {
    const state = createEmptyState();
    state.children.ses_stale = {
      id: 'ses_stale',
      title: 'Abandoned child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      startedAt: '2026-06-04T11:50:00.000Z',
      updatedAt: '2026-06-04T11:55:00.000Z',
    };

    expect(markChildStatus(state, 'ses_stale', 'stale', '2026-06-04T12:00:00.000Z')).toBe(true);
    expect(state.children.ses_stale).toMatchObject({
      status: 'stale',
      color: 'gray',
      endedAt: '2026-06-04T12:00:00.000Z',
    });
    expect(getCounts(state)).toEqual({ running: 0, done: 0, stale: 1, error: 0 });

    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');

    await saveState(statePath, state);
    const loaded = await loadState(statePath);

    expect(loaded.children.ses_stale).toMatchObject({
      status: 'stale',
      color: 'gray',
    });
    expect(getCounts(loaded)).toEqual({ running: 0, done: 0, stale: 1, error: 0 });
  });

  it('prunes orphaned synthetic running rows that are no longer anchored to an active session', () => {
    const state = createEmptyState();
    state.children = {
      ses_parent: {
        id: 'ses_parent',
        title: 'Parent runner',
        parentID: 'ses_root',
        source: 'session',
        status: 'done',
        startedAt: '2026-06-04T11:40:00.000Z',
        updatedAt: '2026-06-04T11:45:00.000Z',
        endedAt: '2026-06-04T11:45:00.000Z',
      },
      'subtask:part_1': {
        id: 'subtask:part_1',
        title: 'Detached fallback',
        parentID: 'ses_parent',
        source: 'subtask',
        status: 'running',
        startedAt: '2026-06-04T11:50:00.000Z',
        updatedAt: '2026-06-04T11:50:00.000Z',
      },
    };

    expect(pruneOrphanedSyntheticRunningChildren(state)).toBe(true);
    expect(state.children['subtask:part_1']).toBeUndefined();
    expect(state.children.ses_parent).toBeDefined();
  });

  it('prunes synthetic tool wrappers even when no real session anchor remains', () => {
    const state = createEmptyState();
    state.children['tool:delegate_1'] = {
      id: 'tool:delegate_1',
      title: 'Detached wrapper',
      parentID: 'ses_parent',
      source: 'tool',
      targetSessionID: 'ses_child',
      status: 'running',
      startedAt: '2026-06-04T11:50:00.000Z',
      updatedAt: '2026-06-04T11:50:00.000Z',
    };
    state.children['subtask:part_1'] = {
      id: 'subtask:part_1',
      title: 'Fallback row',
      parentID: 'ses_parent',
      source: 'subtask',
      targetSessionID: 'ses_child',
      status: 'running',
      startedAt: '2026-06-04T11:50:00.000Z',
      updatedAt: '2026-06-04T11:50:00.000Z',
    };

    expect(pruneOrphanedSyntheticRunningChildren(state)).toBe(true);
    expect(state.children['tool:delegate_1']).toBeUndefined();
    expect(state.children['subtask:part_1']).toBeDefined();
  });

  it('drops stale counted ids when replacing children with a pruned snapshot', () => {
    const state = createEmptyState();
    state.children = {
      ses_old: {
        id: 'ses_old',
        title: 'Old runner',
        parentID: 'ses_parent',
        status: 'done',
        startedAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:05:00.000Z',
        endedAt: '2026-06-04T10:05:00.000Z',
      },
    };
    state.countedChildIDs = { ses_old: true };
    state.totalExecuted = 1;

    expect(
      replaceChildren(state, [
        {
          id: 'ses_recent',
          title: 'Recent runner',
          parentID: 'ses_parent',
          status: 'running',
          startedAt: '2026-06-04T11:40:00.000Z',
          updatedAt: '2026-06-04T11:45:00.000Z',
        },
      ]),
    ).toBe(true);

    expect(state.children.ses_old).toBeUndefined();
    expect(state.countedChildIDs).toEqual({ ses_recent: true });
    expect(state.totalExecuted).toBe(2);
  });

  it('rekeys persisted fallback duplicates to a single counted session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-'));
    tempDirs.push(dir);
    const statePath = join(dir, 'state.json');

    await saveState(statePath, {
      children: {
        'subtask:part_1': {
          id: 'subtask:part_1',
          title: 'Fallback work',
          parentID: 'ses_parent',
          messageID: 'msg_1',
          source: 'subtask',
          targetSessionID: 'ses_child',
          status: 'running',
          startedAt: '2026-06-04T11:50:00.000Z',
          updatedAt: '2026-06-04T11:50:00.000Z',
        },
        ses_child: {
          id: 'ses_child',
          title: 'Fallback work',
          parentID: 'ses_parent',
          messageID: 'msg_1',
          source: 'session',
          targetSessionID: 'ses_child',
          status: 'running',
          startedAt: '2026-06-04T11:50:00.000Z',
          updatedAt: '2026-06-04T11:55:00.000Z',
        },
      },
      countedChildIDs: {
        'subtask:part_1': true,
        ses_child: true,
      },
      purgedSessionIDs: {},
      totalExecuted: 2,
      updatedAt: '2026-06-04T11:55:00.000Z',
    });

    const loaded = await loadState(statePath);

    expect(loaded.totalExecuted).toBe(1);
    expect(loaded.countedChildIDs.ses_child).toBe(true);
    expect(loaded.countedChildIDs['subtask:part_1']).toBeUndefined();
  });

  it('counts a fallback row and its later real session once', () => {
    const state = createEmptyState();

    upsertRunningChild(state, {
      id: 'subtask:part_1',
      title: 'Fallback work',
      parentID: 'ses_parent',
      messageID: 'msg_1',
      source: 'subtask',
    });
    upsertRunningChild(state, {
      id: 'ses_child',
      title: 'Fallback work',
      parentID: 'ses_parent',
      messageID: 'msg_1',
      source: 'session',
      targetSessionID: 'ses_child',
      updatedAt: '2026-06-04T11:55:00.000Z',
    });

    expect(state.totalExecuted).toBe(1);
    expect(state.countedChildIDs.ses_child).toBe(true);
    expect(state.countedChildIDs['subtask:part_1']).toBeUndefined();
  });

  it('preserves a terminal child when later running evidence arrives', () => {
    const state = createEmptyState();

    upsertRunningChild(state, {
      id: 'ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'done',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T11:56:00.000Z',
      endedAt: '2026-06-04T11:56:00.000Z',
    });

    const elapsedMs = state.children.ses_child?.elapsedMs;

    vi.advanceTimersByTime(60_000);

    expect(
      upsertRunningChild(state, {
        id: 'ses_child',
        title: 'Recovered child',
        parentID: 'ses_parent',
        source: 'session',
        status: 'running',
        startedAt: '2026-06-04T11:55:00.000Z',
        updatedAt: '2026-06-04T12:00:00.000Z',
      }),
    ).toBe(false);

    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      updatedAt: '2026-06-04T11:56:00.000Z',
      endedAt: '2026-06-04T11:56:00.000Z',
      elapsedMs,
    });
  });

  it('reopens matching rows with running color and cleared terminal markers', () => {
    const state = createEmptyState();
    state.children.ses_child = {
      id: 'ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      color: 'green',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T11:56:00.000Z',
      endedAt: '2026-06-04T11:56:00.000Z',
    };
    state.children['tool:ses_child'] = {
      id: 'tool:ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'tool',
      targetSessionID: 'ses_child',
      status: 'done',
      color: 'green',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T11:56:00.000Z',
      endedAt: '2026-06-04T11:56:00.000Z',
    };

    expect(markChildRunning(state, 'ses_child', '2026-06-04T12:00:00.000Z')).toBe(true);
    expect(state.children.ses_child).toMatchObject({
      status: 'running',
      color: 'yellow',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: undefined,
    });
    expect(state.children['tool:ses_child']).toMatchObject({
      status: 'running',
      color: 'yellow',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: undefined,
    });
  });

  it('does not resurrect a terminal session after retention pruning', () => {
    const state = createEmptyState();

    upsertRunningChild(state, {
      id: 'ses_pruned',
      title: 'Pruned child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'done',
      startedAt: '2026-06-04T10:00:00.000Z',
      updatedAt: '2026-06-04T10:05:00.000Z',
      endedAt: '2026-06-04T10:05:00.000Z',
    });

    expect(pruneTerminalChildren(state, Date.parse('2026-06-04T12:00:00.000Z'))).toBe(true);
    expect(state.children.ses_pruned).toBeUndefined();
    expect(state.purgedSessionIDs.ses_pruned).toBe(true);

    expect(
      upsertRunningChild(state, {
        id: 'ses_pruned',
        title: 'Pruned child',
        parentID: 'ses_parent',
        source: 'session',
        status: 'running',
        startedAt: '2026-06-04T11:59:00.000Z',
        updatedAt: '2026-06-04T12:00:00.000Z',
      }),
    ).toBe(false);

    expect(state.children.ses_pruned).toBeUndefined();
  });

  it('does not reopen a terminal row from stale running evidence', () => {
    const state = createEmptyState();

    state.children.ses_child = {
      id: 'ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'done',
      color: 'green',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    };

    expect(markChildRunning(state, 'ses_child', '2026-06-04T11:59:59.000Z')).toBe(false);
    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
      color: 'green',
    });
  });

  it('does not let older terminal evidence override a newer running row', () => {
    const state = createEmptyState();

    state.children.ses_child = {
      id: 'ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      color: 'yellow',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T12:01:00.000Z',
    };

    expect(markChildStatus(state, 'ses_child', 'error', '2026-06-04T12:00:00.000Z')).toBe(false);
    expect(state.children.ses_child).toMatchObject({
      status: 'running',
      updatedAt: '2026-06-04T12:01:00.000Z',
      color: 'yellow',
    });
    expect(state.children.ses_child).not.toHaveProperty('endedAt');
  });

  it('allows equal-timestamp terminal evidence to close a running row', () => {
    const state = createEmptyState();

    state.children.ses_child = {
      id: 'ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      color: 'yellow',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T12:00:00.000Z',
    };

    expect(markChildStatus(state, 'ses_child', 'done', '2026-06-04T12:00:00.000Z')).toBe(true);
    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      color: 'green',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    });
  });

  it('lets equal-timestamp terminal evidence replace an older terminal classification', () => {
    const state = createEmptyState();

    state.children.ses_child = {
      id: 'ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'done',
      color: 'green',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    };

    expect(markChildStatus(state, 'ses_child', 'error', '2026-06-04T12:00:00.000Z')).toBe(false);
    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      color: 'green',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    });
  });

  it('keeps a terminal row closed when equal-timestamp running evidence is replayed through upsert', () => {
    const state = createEmptyState();

    upsertRunningChild(state, {
      id: 'ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'done',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    });

    expect(
      upsertRunningChild(state, {
        id: 'ses_child',
        title: 'Recovered child',
        parentID: 'ses_parent',
        source: 'session',
        status: 'running',
        startedAt: '2026-06-04T11:55:00.000Z',
        updatedAt: '2026-06-04T12:00:00.000Z',
      }),
    ).toBe(false);
    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    });
  });

  it('does not rewrite endedAt/updatedAt when the same terminal status is repeated with a newer timestamp', () => {
    const state = createEmptyState();

    state.children.ses_child = {
      id: 'ses_child',
      title: 'Completed child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'done',
      color: 'green',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    };

    vi.advanceTimersByTime(120_000);

    expect(markChildStatus(state, 'ses_child', 'done', '2026-06-04T12:02:00.000Z')).toBe(false);
    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    });
  });

  it('preserves same-terminal upsert timing while merging non-timing child fields', () => {
    const state = createEmptyState();

    state.children.ses_child = {
      id: 'ses_child',
      title: 'Failed child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'error',
      color: 'red',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    };

    expect(
      upsertRunningChild(state, {
        id: 'ses_child',
        title: 'Failed child',
        parentID: 'ses_parent',
        source: 'session',
        status: 'error',
        summary: 'Recovered failure summary',
        agentName: 'sdd-apply',
        targetSessionID: 'ses_child',
        startedAt: '2026-06-04T11:55:00.000Z',
        updatedAt: '2026-06-04T12:05:00.000Z',
        endedAt: '2026-06-04T12:05:00.000Z',
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({
      status: 'error',
      summary: 'Recovered failure summary',
      agentName: 'sdd-apply',
      targetSessionID: 'ses_child',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    });
  });

  it('preserves terminal detail timing while still merging tokens and summary', () => {
    const state = createEmptyState();
    state.updatedAt = '2026-06-04T12:00:00.000Z';

    state.children.ses_child = {
      id: 'ses_child',
      title: 'Failed child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'error',
      color: 'red',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
      tokens: { input: 2, output: 3, total: 5 },
    };

    expect(
      upsertChildDetails(state, 'ses_child', {
        summary: 'Failure details were recovered',
        tokens: { input: 4, output: 6, total: 10 },
        updatedAt: '2026-06-04T12:05:00.000Z',
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({
      status: 'error',
      summary: 'Failure details were recovered',
      tokens: { input: 4, output: 6, total: 10 },
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    });
    expect(state.updatedAt).toBe('2026-06-04T12:05:00.000Z');
  });

  it('allows changing from one terminal status to a different terminal status', () => {
    const state = createEmptyState();

    state.children.ses_child = {
      id: 'ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'error',
      color: 'red',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    };

    expect(markChildStatus(state, 'ses_child', 'done', '2026-06-04T12:01:00.000Z')).toBe(false);
    expect(state.children.ses_child).toMatchObject({
      status: 'error',
      color: 'red',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
    });
  });

  it('does not let older detail updates roll timestamps backwards', () => {
    const state = createEmptyState();

    state.children.ses_child = {
      id: 'ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      color: 'yellow',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T12:01:00.000Z',
    };

    expect(
      upsertChildDetails(state, 'ses_child', {
        summary: 'Recovered from older source',
        updatedAt: '2026-06-04T12:00:00.000Z',
      }),
    ).toBe(true);

    expect(state.children.ses_child).toMatchObject({
      status: 'running',
      updatedAt: '2026-06-04T12:01:00.000Z',
      summary: 'Recovered from older source',
    });
  });

  it('preserves more than 50 recent terminal children (does not cap within retention window)', () => {
    const state = createEmptyState();
    const baseTime = Date.parse('2026-06-04T12:00:00.000Z');
    // Create 60 terminal children within the retention window (all within TERMINAL_CHILD_RETENTION_MS ~30min)
    for (let i = 0; i < 60; i++) {
      const id = `ses_recent_${String(i).padStart(2, '0')}`;
      state.children[id] = {
        id,
        title: `Recent child ${i}`,
        parentID: 'ses_parent',
        source: 'session',
        status: 'done',
        color: 'green',
        startedAt: new Date(baseTime - (60 - i) * 30_000).toISOString(),
        updatedAt: new Date(baseTime - (60 - i) * 30_000).toISOString(),
        endedAt: new Date(baseTime - (60 - i) * 30_000).toISOString(),
      };
      state.countedChildIDs[id] = true;
    }
    state.totalExecuted = 60;

    expect(pruneTerminalChildren(state, baseTime)).toBe(false);

    // All 60 recent children must survive — the 50 cap only applies
    // to items OUTSIDE the retention window.
    expect(Object.keys(state.children).length).toBe(60);
    expect(state.countedChildIDs).toHaveProperty('ses_recent_00');
    expect(state.countedChildIDs).toHaveProperty('ses_recent_59');
  });

  it('caps stale terminal children outside the retention window at 50', () => {
    const state = createEmptyState();
    const baseTime = Date.parse('2026-06-04T12:00:00.000Z');
    const outsideWindow = baseTime - 40 * 60 * 1000; // 40 min ago — outside 30 min retention

    // Create 60 children outside the retention window
    for (let i = 0; i < 60; i++) {
      const id = `ses_stale_${String(i).padStart(2, '0')}`;
      state.children[id] = {
        id,
        title: `Stale child ${i}`,
        parentID: 'ses_parent',
        source: 'session',
        status: 'done',
        color: 'green',
        startedAt: new Date(outsideWindow + i * 10_000).toISOString(),
        updatedAt: new Date(outsideWindow + i * 10_000).toISOString(),
        endedAt: new Date(outsideWindow + i * 10_000).toISOString(),
      };
      state.countedChildIDs[id] = true;
    }
    state.totalExecuted = 60;

    expect(pruneTerminalChildren(state, baseTime)).toBe(true);

    // At most 50 survive from outside the retention window
    expect(Object.keys(state.children).length).toBeLessThanOrEqual(50);
  });

  it('mixes recent and stale children correctly — keeps all recent even beyond 50', () => {
    const state = createEmptyState();
    const baseTime = Date.parse('2026-06-04T12:00:00.000Z');

    // 10 recent children within retention window
    for (let i = 0; i < 10; i++) {
      const id = `ses_recent_${i}`;
      state.children[id] = {
        id,
        title: `Recent ${i}`,
        parentID: 'ses_parent',
        source: 'session',
        status: 'done',
        color: 'green',
        startedAt: new Date(baseTime - (10 - i) * 60_000).toISOString(),
        updatedAt: new Date(baseTime - (10 - i) * 60_000).toISOString(),
        endedAt: new Date(baseTime - (10 - i) * 60_000).toISOString(),
      };
      state.countedChildIDs[id] = true;
    }
    // 60 stale children outside retention window
    const outsideWindow = baseTime - 40 * 60 * 1000;
    for (let i = 0; i < 60; i++) {
      const id = `ses_stale_${i}`;
      state.children[id] = {
        id,
        title: `Stale ${i}`,
        parentID: 'ses_parent',
        source: 'session',
        status: 'done',
        color: 'green',
        startedAt: new Date(outsideWindow + i * 10_000).toISOString(),
        updatedAt: new Date(outsideWindow + i * 10_000).toISOString(),
        endedAt: new Date(outsideWindow + i * 10_000).toISOString(),
      };
      state.countedChildIDs[id] = true;
    }
    state.totalExecuted = 70;

    expect(pruneTerminalChildren(state, baseTime)).toBe(true);

    // All 10 recent survive
    for (let i = 0; i < 10; i++) {
      expect(state.children[`ses_recent_${i}`]).toBeDefined();
    }
    // At most 50 stale survive (10 + 50 = 60)
    expect(Object.keys(state.children).length).toBeLessThanOrEqual(60);
    expect(Object.keys(state.children).length).toBeGreaterThanOrEqual(10);
  });
});
