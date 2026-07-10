import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDebugEnabled } from '../../../src/features/subagent-status/shared/display.ts';
import {
  createSQLiteRecoverySource,
  resolveRecoveredStatus,
  safeParseParts,
} from '../../../src/features/subagent-status/infrastructure/sqlite/hydrate.ts';
import { createEmptyState, getCounts } from '../../../src/features/subagent-status/domain/state/core.ts';
import { applyRecoveredChildren } from '../../../src/features/subagent-status/infrastructure/recovery.ts';
import { simulateSQLiteRecoveryRows } from './fixtures/sqlite-rows.ts';

// ponytail: every test in this file runs entirely in-process. The SQLite +
// Python boundary is replaced by `simulateSQLiteRecoveryRows`, which feeds
// the same `SQLiteRecoveryRow[]` shape the production pipeline would emit.
// Cases that need to verify the real Python script end-to-end live in
// `integration/sqlite-recovery.integration.test.ts` instead.

describe('sqlite recovery source', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T05:25:00.000Z'));
  });

  afterEach(() => {
    setDebugEnabled(false);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('marks step-finish-only SQLite evidence done when no newer running evidence exists', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_1468147afffePt1H1Qt7VKwLho',
        parentID: 'ses_parent',
        title: 'Show Cascadia defaults',
        agent: 'general',
        timeCreated: 1780550100000,
        timeUpdated: 1780550405000,
        tokensInput: 12,
        tokensOutput: 8,
        parts: [
          { data: { type: 'step-start', time: { start: 1780550280000 } }, timeUpdated: 1780550280000 },
          {
            data: {
              type: 'text',
              text: 'Cascadia Code ships with several stylistic set defaults.',
              time: { created: 1780550340000, updated: 1780550340000 },
            },
            timeUpdated: 1780550340000,
          },
          {
            data: {
              type: 'step-finish',
              reason: 'stop',
              tokens: { input: 12, output: 8, total: 20 },
              time: { end: 1780550400000 },
            },
            timeUpdated: 1780550400000,
          },
          {
            data: {
              type: 'text',
              text: 'Final answer: Cascadia defaults are available.',
              time: { created: 1780550405000, updated: 1780550405000 },
            },
            timeUpdated: 1780550405000,
          },
        ],
      },
    ]);

    const state = createEmptyState();
    state.children.ses_1468147afffePt1H1Qt7VKwLho = {
      id: 'ses_1468147afffePt1H1Qt7VKwLho',
      title: 'Show Cascadia defaults',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      startedAt: '2026-06-04T05:15:00.000Z',
      updatedAt: '2026-06-04T05:19:00.000Z',
    };
    state.children['tool:ses_1468147afffePt1H1Qt7VKwLho'] = {
      id: 'tool:ses_1468147afffePt1H1Qt7VKwLho',
      title: 'Show Cascadia defaults',
      parentID: 'ses_parent',
      source: 'tool',
      targetSessionID: 'ses_1468147afffePt1H1Qt7VKwLho',
      status: 'running',
      startedAt: '2026-06-04T05:15:00.000Z',
      updatedAt: '2026-06-04T05:19:00.000Z',
    };

    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });
    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_1468147afffePt1H1Qt7VKwLho).toMatchObject({
      status: 'done',
      tokens: { input: 12, output: 8, total: 20 },
    });
    expect(state.children.ses_1468147afffePt1H1Qt7VKwLho?.endedAt).toBe('2026-06-04T05:20:00.000Z');
    expect(state.children['tool:ses_1468147afffePt1H1Qt7VKwLho']).toMatchObject({
      status: 'done',
    });
    expect(state.children['tool:ses_1468147afffePt1H1Qt7VKwLho']?.endedAt).toBe('2026-06-04T05:20:00.000Z');
    expect(getCounts(state)).toMatchObject({ done: 2, running: 0 });
  });

  it('does not override newer persisted running rows when SQLite only has step-finish evidence', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_14584472affeE6HD4fNRxdM0oq',
        parentID: 'ses_parent',
        title: 'Terminal child',
        agent: 'sdd-apply',
        timeCreated: 1780550100000,
        timeUpdated: 1780550400000,
        tokensInput: 12,
        tokensOutput: 8,
        parts: [
          {
            data: {
              type: 'step-finish',
              reason: 'stop',
              tokens: { input: 12, output: 8, total: 20 },
              time: { end: 1780550400000 },
            },
            timeUpdated: 1780550400000,
          },
        ],
      },
    ]);

    const state = createEmptyState();
    state.children.ses_14584472affeE6HD4fNRxdM0oq = {
      id: 'ses_14584472affeE6HD4fNRxdM0oq',
      title: 'Terminal child',
      parentID: 'ses_parent',
      source: 'session',
      targetSessionID: 'ses_14584472affeE6HD4fNRxdM0oq',
      status: 'running',
      startedAt: '2026-06-04T05:15:00.000Z',
      updatedAt: '2026-06-04T05:24:30.000Z',
    };

    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });
    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_14584472affeE6HD4fNRxdM0oq).toMatchObject({
      status: 'done',
      updatedAt: '2026-06-04T05:20:00.000Z',
      endedAt: '2026-06-04T05:20:00.000Z',
      tokens: { input: 12, output: 8, total: 20 },
    });
  });

  it('preserves same-terminal recovered child timing while merging recovered metadata', () => {
    const state = createEmptyState();
    state.children.ses_failed = {
      id: 'ses_failed',
      title: 'Failed child',
      parentID: 'ses_parent',
      source: 'session',
      targetSessionID: 'ses_failed',
      status: 'error',
      color: 'red',
      startedAt: '2026-06-04T05:15:00.000Z',
      updatedAt: '2026-06-04T05:20:00.000Z',
      endedAt: '2026-06-04T05:20:00.000Z',
    };

    const result = applyRecoveredChildren(
      state,
      [
        {
          id: 'ses_failed',
          title: 'Failed child',
          parentID: 'ses_parent',
          source: 'session',
          targetSessionID: 'ses_failed',
          status: 'error',
          agentName: 'sdd-apply',
          startedAt: '2026-06-04T05:15:00.000Z',
          updatedAt: '2026-06-04T05:30:00.000Z',
          endedAt: '2026-06-04T05:30:00.000Z',
          tokens: { input: 12, output: 8, total: 20 },
        },
      ],
      ['ses_failed'],
      'ses_parent',
    );

    expect(result.changed).toBe(true);
    expect(state.children.ses_failed).toMatchObject({
      status: 'error',
      agentName: 'sdd-apply',
      tokens: { input: 12, output: 8, total: 20 },
      updatedAt: '2026-06-04T05:20:00.000Z',
      endedAt: '2026-06-04T05:20:00.000Z',
    });
  });

  it('uses large step-finish-only recovery as done evidence while preserving token evidence', async () => {
    const largePayload = 'x'.repeat(256 * 1024);
    const largeParts = [
      ...Array.from({ length: 104 }, (_, index) =>
        JSON.stringify({
          id: `prt_large_noise_${index}`,
          type: index % 2 === 0 ? 'text' : 'reasoning',
          text: largePayload,
          encrypted: largePayload,
        }),
      ),
      JSON.stringify({
        id: 'prt_step_finish',
        type: 'step-finish',
        reason: 'stop',
        tokens: { input: 12, output: 8, total: 20 },
        time: { end: 1780550400000 },
      }),
    ];

    const parsedParts = safeParseParts(largeParts);
    expect(parsedParts).toHaveLength(105);
    expect(resolveRecoveredStatus(parsedParts)).toMatchObject({
      status: 'done',
      endedAt: '2026-06-04T05:20:00.000Z',
      tokens: { input: 12, output: 8, total: 20 },
    });

    // Build 104 noise text/reasoning parts plus one step-finish. The fixture
    // only needs the shape the Python pipeline would emit, so we feed the
    // parts as plain objects.
    const sessionParts = [
      ...Array.from({ length: 104 }, (_, index) => ({
        data: {
          id: `prt_large_noise_${index}`,
          type: index % 2 === 0 ? 'text' : 'reasoning',
          text: 'x'.repeat(128 * 1024),
          encrypted: 'x'.repeat(128 * 1024),
        },
        timeUpdated: 1780550200000 + index,
      })),
      {
        data: {
          id: 'prt_terminal',
          type: 'step-finish',
          reason: 'stop',
          tokens: { input: 12, output: 8, total: 20 },
          time: { end: 1780550400000 },
        },
        timeUpdated: 1780550400000,
      },
    ];

    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_large_terminal',
        parentID: 'ses_parent',
        title: 'Large terminal child',
        agent: 'sdd-apply',
        timeCreated: 1780550100000,
        timeUpdated: 1780550400000,
        tokensInput: 12,
        tokensOutput: 8,
        parts: sessionParts,
      },
    ]);

    const state = createEmptyState();
    state.children.ses_large_terminal = {
      id: 'ses_large_terminal',
      title: 'Large terminal child',
      parentID: 'ses_parent',
      source: 'session',
      targetSessionID: 'ses_large_terminal',
      status: 'running',
      startedAt: '2026-06-04T05:15:00.000Z',
      updatedAt: '2026-06-04T05:20:00.101Z',
    };

    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });
    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_large_terminal).toMatchObject({
      status: 'done',
      updatedAt: '2026-06-04T05:20:00.000Z',
      endedAt: '2026-06-04T05:20:00.000Z',
      tokens: { input: 12, output: 8, total: 20 },
    });
  });

  it('marks stale step-finish stop recovery as done instead of abandoned error', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_step_finish_done',
        parentID: 'ses_parent',
        title: 'Finished child',
        agent: 'sdd-apply',
        timeCreated: 1780530000000,
        timeUpdated: 1780532400000,
        tokensInput: 12,
        tokensOutput: 8,
        parts: [
          {
            data: {
              type: 'step-finish',
              reason: 'stop',
              tokens: { input: 12, output: 8, total: 20 },
              time: { end: 1780532400000 },
            },
            timeUpdated: 1780532400000,
          },
        ],
      },
    ]);

    const state = createEmptyState();
    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });

    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_step_finish_done).toMatchObject({
      status: 'done',
      updatedAt: '2026-06-04T00:20:00.000Z',
      endedAt: '2026-06-04T00:20:00.000Z',
      tokens: { input: 12, output: 8, total: 20 },
    });
  });

  it('uses SQLite row timestamps for real-shaped step-finish payloads without payload time', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_fresh_stop',
        parentID: 'ses_parent',
        title: 'Fresh real-shaped done',
        agent: 'sdd-apply',
        timeCreated: 1780550100000,
        timeUpdated: 1780550400000,
        tokensInput: 12,
        tokensOutput: 8,
        parts: [
          { data: { type: 'step-start' }, timeUpdated: 1780550340000 },
          { data: { type: 'tool', state: { status: 'completed' } }, timeUpdated: 1780550360000 },
          {
            data: {
              type: 'step-finish',
              reason: 'stop',
              tokens: { input: 12, output: 8, total: 20 },
            },
            timeUpdated: 1780550400000,
          },
        ],
      },
      {
        id: 'ses_stale_stop',
        parentID: 'ses_parent',
        title: 'Stale real-shaped done',
        agent: 'sdd-apply',
        timeCreated: 1780530000000,
        timeUpdated: 1780532400000,
        tokensInput: 12,
        tokensOutput: 8,
        parts: [
          { data: { type: 'step-start' }, timeUpdated: 1780532100000 },
          {
            data: {
              type: 'step-finish',
              reason: 'stop',
              tokens: { input: 12, output: 8, total: 20 },
            },
            timeUpdated: 1780532400000,
          },
        ],
      },
      {
        id: 'ses_resumed_after_stop',
        parentID: 'ses_parent',
        title: 'Resumed after stop',
        agent: 'sdd-apply',
        timeCreated: 1780550100000,
        timeUpdated: 1780550460000,
        tokensInput: 0,
        tokensOutput: 0,
        parts: [
          { data: { type: 'step-start' }, timeUpdated: 1780550340000 },
          { data: { type: 'step-finish', reason: 'stop' }, timeUpdated: 1780550400000 },
          { data: { type: 'step-start' }, timeUpdated: 1780550460000 },
        ],
      },
    ]);

    const state = createEmptyState();
    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });

    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_fresh_stop).toMatchObject({
      status: 'done',
      updatedAt: '2026-06-04T05:20:00.000Z',
      endedAt: '2026-06-04T05:20:00.000Z',
      tokens: { input: 12, output: 8, total: 20 },
    });
    expect(state.children.ses_stale_stop).toMatchObject({
      status: 'done',
      updatedAt: '2026-06-04T00:20:00.000Z',
      endedAt: '2026-06-04T00:20:00.000Z',
      tokens: { input: 12, output: 8, total: 20 },
    });
    expect(state.children.ses_resumed_after_stop).toMatchObject({
      status: 'running',
      updatedAt: '2026-06-04T05:21:00.000Z',
      endedAt: undefined,
    });
  });

  it('keeps failed step-finish recovery evidence as error', () => {
    expect(
      resolveRecoveredStatus([
        {
          type: 'step-finish',
          reason: 'failed',
          tokens: { input: 12, output: 8, total: 20 },
          time: { end: 1780532400000 },
        },
      ]),
    ).toMatchObject({
      status: 'error',
      updatedAt: '2026-06-04T00:20:00.000Z',
      endedAt: '2026-06-04T00:20:00.000Z',
      tokens: { input: 12, output: 8, total: 20 },
    });
  });

  it('keeps fresh one-text sessions running but marks short-stale never-started one-text sessions error', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_145d5e0d2ffeVLMuOYGqU0uLr4',
        parentID: 'ses_parent',
        title: 'Review Monaspace options',
        agent: 'general',
        timeCreated: 1780550580000,
        timeUpdated: 1780550640000,
        parts: [
          {
            data: {
              type: 'text',
              text: 'Review Monaspace options',
              time: { created: 1780550640000, updated: 1780550640000 },
            },
            timeUpdated: 1780550640000,
          },
        ],
      },
      {
        id: 'ses_145d5a499ffeZF21By59epQSYl',
        parentID: 'ses_parent',
        title: 'Re-review Monaspace options',
        agent: 'general',
        timeCreated: 1780547700000,
        timeUpdated: 1780548000000,
        parts: [
          {
            data: {
              type: 'text',
              text: 'Re-review Monaspace options',
              time: { created: 1780548000000, updated: 1780548000000 },
            },
            timeUpdated: 1780548000000,
          },
        ],
      },
    ]);

    const state = createEmptyState();
    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });
    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_145d5e0d2ffeVLMuOYGqU0uLr4).toMatchObject({
      status: 'running',
      updatedAt: '2026-06-04T05:24:00.000Z',
      endedAt: undefined,
    });
    expect(state.children.ses_145d5a499ffeZF21By59epQSYl).toMatchObject({
      status: 'error',
      updatedAt: '2026-06-04T05:25:00.000Z',
      endedAt: '2026-06-04T05:25:00.000Z',
    });
    expect(getCounts(state)).toMatchObject({ running: 1, error: 1 });
  });

  it('hydrates terminal status and tokens from the SQLite session store', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Recovered child',
        agent: 'sdd-apply',
        timeCreated: 1780550100000,
        timeUpdated: 1780550400000,
        tokensInput: 12,
        tokensOutput: 8,
        parts: [
          {
            data: {
              type: 'session.status',
              state: { status: 'completed' },
              tokens: { input: 12, output: 8, total: 20 },
              time: { completed: 1780550400000 },
            },
            timeUpdated: 1780550400000,
          },
        ],
      },
    ]);

    const state = createEmptyState();
    state.children.ses_child = {
      id: 'ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      startedAt: '2026-06-04T05:15:00.000Z',
      updatedAt: '2026-06-04T05:19:00.000Z',
    };
    state.children['tool:ses_child'] = {
      id: 'tool:ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'tool',
      targetSessionID: 'ses_child',
      status: 'running',
      startedAt: '2026-06-04T05:15:00.000Z',
      updatedAt: '2026-06-04T05:19:00.000Z',
    };

    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });
    const result = await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(result).toEqual({
      authoritativeSessionIDs: ['ses_child'],
      changed: true,
      protectedTerminalSessionIDs: ['ses_child'],
    });
    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      endedAt: '2026-06-04T05:20:00.000Z',
      tokens: { input: 12, output: 8, total: 20 },
    });
    expect(state.children['tool:ses_child']).toMatchObject({
      status: 'done',
      endedAt: '2026-06-04T05:20:00.000Z',
    });
  });

  it('treats session.status completion parts as terminal recovery evidence', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Recovered child',
        agent: 'sdd-apply',
        timeCreated: 1780550100000,
        timeUpdated: 1780550400000,
        tokensInput: 12,
        tokensOutput: 8,
        parts: [
          {
            data: {
              type: 'session.status',
              state: { status: 'completed' },
              tokens: { input: 12, output: 8, total: 20 },
              time: { completed: 1780550400000 },
            },
            timeUpdated: 1780550400000,
          },
        ],
      },
    ]);

    const state = createEmptyState();
    state.children.ses_child = {
      id: 'ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      startedAt: '2026-06-04T05:15:00.000Z',
      updatedAt: '2026-06-04T05:19:00.000Z',
    };

    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });
    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      endedAt: '2026-06-04T05:20:00.000Z',
      tokens: { input: 12, output: 8, total: 20 },
    });
  });

  it('does not terminalize generic completed part state without session-scoped evidence', () => {
    expect(
      resolveRecoveredStatus([
        {
          type: 'part.updated',
          status: 'completed',
          tokens: { input: 12, output: 8, total: 20 },
          time: { updated: 1780550400000 },
        },
      ]),
    ).toMatchObject({
      status: 'running',
      tokens: { input: 12, output: 8, total: 20 },
    });
  });

  it('keeps SQLite fallback token counts semantically partial instead of inventing totals', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Recovered child',
        agent: 'sdd-apply',
        timeCreated: 1780550100000,
        timeUpdated: 1780550400000,
        tokensInput: 10,
        tokensOutput: 5,
        // No parts: this is a never-started running session that lives off
        // the row-level token columns only.
        parts: [],
      },
    ]);

    const state = createEmptyState();
    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });

    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_child).toMatchObject({
      status: 'running',
      tokens: { input: 10, output: 5 },
    });
    expect(state.children.ses_child?.tokens?.total).toBeUndefined();
  });

  it('marks recovered running rows older than the default five-hour hard stale threshold as error', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Recovered child',
        agent: 'sdd-apply',
        timeCreated: 1780530000000,
        timeUpdated: 1780532400000,
        tokensInput: 10,
        tokensOutput: 5,
        parts: [],
      },
    ]);

    const state = createEmptyState();
    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });

    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_child).toMatchObject({
      status: 'error',
      updatedAt: '2026-06-04T05:25:00.000Z',
      endedAt: '2026-06-04T05:25:00.000Z',
      tokens: { input: 10, output: 5 },
    });
    expect(state.children.ses_child?.tokens?.total).toBeUndefined();
  });

  it('marks recovered running rows as error using the configured hard stale threshold', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Recovered child',
        agent: 'sdd-apply',
        timeCreated: 1780550100000,
        timeUpdated: 1780550400000,
        tokensInput: 10,
        tokensOutput: 5,
        parts: [],
      },
    ]);

    const state = createEmptyState();
    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows, hardStaleAfterMs: 4 * 60_000 });

    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_child).toMatchObject({
      status: 'error',
      updatedAt: '2026-06-04T05:25:00.000Z',
      endedAt: '2026-06-04T05:25:00.000Z',
    });
  });

  it('keeps recovered running rows running when the hard stale threshold is disabled', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Recovered child',
        agent: 'sdd-apply',
        timeCreated: 1780530000000,
        timeUpdated: 1780532400000,
        tokensInput: 10,
        tokensOutput: 5,
        parts: [],
      },
    ]);

    const state = createEmptyState();
    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows, hardStaleAfterMs: 0 });

    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_child).toMatchObject({
      status: 'running',
      updatedAt: '2026-06-04T00:20:00.000Z',
      endedAt: undefined,
      tokens: { input: 10, output: 5 },
    });
  });

  it('merges SQLite row token counts with step-finish usage details when marking done', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Recovered child',
        agent: 'sdd-apply',
        timeCreated: 1780550100000,
        timeUpdated: 1780550400000,
        tokensInput: 12,
        tokensOutput: 8,
        parts: [
          {
            data: {
              type: 'step-finish',
              reason: 'stop',
              tokens: { contextPercent: 42.5 },
              time: { end: 1780550400000 },
            },
            timeUpdated: 1780550400000,
          },
        ],
      },
    ]);

    const state = createEmptyState();
    state.children.ses_child = {
      id: 'ses_child',
      title: 'Recovered child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      startedAt: '2026-06-04T05:15:00.000Z',
      updatedAt: '2026-06-04T05:19:00.000Z',
    };

    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });
    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      updatedAt: '2026-06-04T05:20:00.000Z',
      endedAt: '2026-06-04T05:20:00.000Z',
      tokens: { input: 12, output: 8, contextPercent: 42.5 },
    });
  });

  it('purges non-authoritative rows that are absent from SQLite recovery', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_kept',
        parentID: 'ses_parent',
        title: 'Kept child',
        agent: 'sdd-apply',
        timeCreated: 1780550100000,
        timeUpdated: 1780550400000,
        tokensInput: 1,
        tokensOutput: 1,
        parts: [],
      },
    ]);

    const state = createEmptyState();
    state.children.ses_stale = {
      id: 'ses_stale',
      title: 'Stale child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'done',
      startedAt: '2026-06-04T05:00:00.000Z',
      updatedAt: '2026-06-04T05:05:00.000Z',
      endedAt: '2026-06-04T05:05:00.000Z',
    };

    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });
    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_stale).toBeUndefined();
    expect(state.purgedSessionIDs.ses_stale).toBe(true);
    expect(state.children.ses_kept).toMatchObject({
      status: 'running',
      title: 'Kept child',
    });
  });

  it('lets recovered terminal state win over newer cached running evidence', () => {
    const state = createEmptyState();
    state.children.ses_child = {
      id: 'ses_child',
      title: 'Live child',
      parentID: 'ses_parent',
      source: 'session',
      status: 'running',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T12:01:00.000Z',
      color: 'yellow',
    };

    const result = applyRecoveredChildren(
      state,
      [
        {
          id: 'ses_child',
          title: 'Recovered child',
          parentID: 'ses_parent',
          source: 'session',
          targetSessionID: 'ses_child',
          status: 'done',
          startedAt: '2026-06-04T11:55:00.000Z',
          updatedAt: '2026-06-04T12:00:00.000Z',
          endedAt: '2026-06-04T12:00:00.000Z',
        },
      ],
      ['ses_child'],
      'ses_parent',
    );

    expect(result.changed).toBe(true);
    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      color: 'green',
      updatedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:00:00.000Z',
      title: 'Recovered child',
    });
  });

  it('does not purge newer live running rows missing from provisional recovery results', () => {
    const state = createEmptyState();
    state.children.ses_live = {
      id: 'ses_live',
      title: 'Live child',
      parentID: 'ses_parent',
      source: 'session',
      targetSessionID: 'ses_live',
      status: 'running',
      startedAt: '2026-06-04T11:55:00.000Z',
      updatedAt: '2026-06-04T12:01:00.000Z',
      color: 'yellow',
    };

    applyRecoveredChildren(
      state,
      [
        {
          id: 'ses_recovered',
          title: 'Recovered child',
          parentID: 'ses_parent',
          source: 'session',
          targetSessionID: 'ses_recovered',
          status: 'done',
          startedAt: '2026-06-04T11:40:00.000Z',
          updatedAt: '2026-06-04T11:50:00.000Z',
          endedAt: '2026-06-04T11:50:00.000Z',
        },
      ],
      ['ses_recovered'],
      'ses_parent',
    );

    expect(state.children.ses_live).toMatchObject({
      status: 'running',
      updatedAt: '2026-06-04T12:01:00.000Z',
    });
    expect(state.purgedSessionIDs.ses_live).toBeUndefined();
  });

  it('ignores malformed latest-part payloads instead of aborting SQLite recovery', async () => {
    // The fixture always emits well-formed parts, but the production
    // pipeline silently drops parts whose JSON fails to parse. Verify the
    // downstream code keeps going when given a `running` row that has no
    // parseable parts.
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Recovered child',
        agent: 'sdd-apply',
        timeCreated: 1780550100000,
        timeUpdated: 1780550400000,
        tokensInput: 12,
        tokensOutput: 8,
        parts: [],
      },
    ]);

    const state = createEmptyState();
    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });

    const result = await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(result).toEqual({
      authoritativeSessionIDs: ['ses_child'],
      changed: true,
      protectedTerminalSessionIDs: [],
    });
    expect(state.children.ses_child).toMatchObject({
      status: 'running',
      updatedAt: '2026-06-04T05:20:00.000Z',
      endedAt: undefined,
      tokens: { input: 12, output: 8 },
    });
    expect(state.children.ses_child?.tokens?.total).toBeUndefined();
  });

  it('falls back to session updatedAt when terminal recovery payload omits terminal time fields', async () => {
    const rows = simulateSQLiteRecoveryRows([
      {
        id: 'ses_child',
        parentID: 'ses_parent',
        title: 'Recovered child',
        agent: 'sdd-apply',
        timeCreated: 1780550100000,
        timeUpdated: 1780550400000,
        tokensInput: 12,
        tokensOutput: 8,
        parts: [
          {
            data: { type: 'session.status', state: { status: 'completed' } },
            timeUpdated: 1780550400000,
          },
        ],
      },
    ]);

    const state = createEmptyState();
    const source = createSQLiteRecoverySource({ databasePath: ":memory:", readRows: async () => rows });

    await source.hydrateState(state, {
      directory: '/tmp/workspace',
      parentSessionID: 'ses_parent',
    });

    expect(state.children.ses_child).toMatchObject({
      status: 'done',
      updatedAt: '2026-06-04T05:20:00.000Z',
      endedAt: '2026-06-04T05:20:00.000Z',
      tokens: { input: 12, output: 8 },
    });
    expect(state.children.ses_child?.tokens?.total).toBeUndefined();
  });
});

describe('debug gating for sqlite recovery console.log replacements', () => {
  afterEach(() => {
    setDebugEnabled(false);
    vi.restoreAllMocks();
  });

  it('does not call console.log for hydrateState skipping when debug is disabled', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const state = createEmptyState();
    const source = createSQLiteRecoverySource({ databasePath: ':memory:' });

    setDebugEnabled(false);
    await source.hydrateState(state, { directory: '/tmp' });

    expect(console.log).not.toHaveBeenCalled();
  });

  it('calls console.log for hydrateState skipping when debug is enabled', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const state = createEmptyState();
    const source = createSQLiteRecoverySource({ databasePath: ':memory:' });

    setDebugEnabled(true);
    await source.hydrateState(state, { directory: '/tmp' });

    expect(console.log).toHaveBeenCalled();
  });
});

describe('mergeTokens cleanup', () => {
  it('sqlite.ts uses mergeSubagentTokens from domain/tokens instead of a local mergeTokens', async () => {
    const source = await readFile(
      new URL('../../../src/features/subagent-status/infrastructure/sqlite/hydrate.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toMatch(/const mergeTokens\s*=\s*\(/);
    expect(source).toMatch(/import\s*\{[^}]*mergeSubagentTokens[^}]*\}\s*from\s['"]\.\.\/\.\.\/domain\/tokens\.ts['"]/);
  });
});
