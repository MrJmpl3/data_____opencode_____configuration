import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { TuiPluginApi, TuiPluginMeta } from '@opencode-ai/plugin/tui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as quotaIndex from '../index.tsx';
import plugin, {
  formatResponsibleWeeklyUsage,
  isQuotaRateLimitError,
  resolveQuotaPluginOptions,
  retryAfterMsFromMessage,
} from '../index.tsx';
import { inspectQuotaPluginOptions } from '../src/runtime/options.ts';
import { createRefreshScheduler } from '../src/runtime/refresh-scheduler.ts';
import {
  isQuotaTerminalSessionEvent,
  isQuotaTerminalTaskEvent,
  registerQuotaTui,
  refreshQuotaProviders,
} from '../src/runtime/runtime.tsx';
import { fetchCopilotQuota, normalizeCopilotResetAtMs } from '../src/infrastructure/providers/copilot.ts';
import { fmtDuration } from '../src/infrastructure/providers/format.ts';
import { fetchWithTimeout } from '../src/infrastructure/providers/http.ts';
import { fetchOpenAIQuota, parseAdditionalRateLimits } from '../src/infrastructure/providers/openai.ts';
import { fetchOpenRouterQuota as fetchOpenRouterQuotaFromOpenRouter } from '../src/infrastructure/providers/openrouter.ts';
import { fetchOpenAIQuota as fetchOpenAIQuotaFromOpenAI } from '../src/infrastructure/providers/openai.ts';
import { fetchOpenRouterQuota } from '../src/infrastructure/providers/openrouter.ts';
import { fetchWithTimeout as fetchWithTimeoutFromHttp } from '../src/infrastructure/providers/http.ts';
import { fmtDuration as fmtDurationFromProviderFormat } from '../src/infrastructure/providers/format.ts';
import { parseAdditionalRateLimits as parseAdditionalRateLimitsFromOpenAI } from '../src/infrastructure/providers/openai.ts';

const createAuthFixture = (entries: Record<string, unknown>): string => {
  const root = mkdtempSync(join(tmpdir(), 'opencode-quota-'));
  const authDir = join(root, 'opencode');
  mkdirSync(authDir, { recursive: true });
  writeFileSync(join(authDir, 'auth.json'), JSON.stringify(entries), 'utf8');
  return root;
};

const flushAsyncTasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const pluginMeta: TuiPluginMeta = {
  id: 'quota',
  source: 'file',
  spec: 'quota',
  target: 'quota',
  first_time: 0,
  last_time: 0,
  time_changed: 0,
  load_count: 1,
  fingerprint: 'test',
  state: 'first',
};

describe('quota tui plugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('exposes a stable plugin contract', () => {
    expect(plugin.id).toBe('quota');
    expect(typeof plugin.tui).toBe('function');
  });

  it('keeps the current index export surface available', () => {
    expect(quotaIndex.default.id).toBe('quota');
    expect(typeof quotaIndex.formatResponsibleUsagePace).toBe('function');
    expect(typeof quotaIndex.formatResponsibleWeeklyUsage).toBe('function');
    expect(typeof quotaIndex.isQuotaRateLimitError).toBe('function');
    expect(typeof quotaIndex.resolveQuotaPluginOptions).toBe('function');
    expect(typeof quotaIndex.retryAfterMsFromMessage).toBe('function');
  });

  it('returns defaults when plugin options are omitted', () => {
    const options = resolveQuotaPluginOptions(undefined);

    expect(options).toEqual({
      displayMode: 'remaining',
      visibleProviders: [
        { id: 'opencode-go', label: 'OpenCode Go' },
        { id: 'github-copilot', label: 'GitHub Copilot' },
        { id: 'openrouter', label: 'OpenRouter' },
      ],
      pollIntervalMs: 600_000,
      minRefreshIntervalMs: 120_000,
      providerCacheTtlMs: 300_000,
      providerErrorBackoffMs: 900_000,
    });
  });

  it('rejects legacy provider ids and falls back to defaults when nothing valid remains', () => {
    const options = resolveQuotaPluginOptions({
      visibleProviders: [' OR ', 'copilot', 'go', 'unknown', 'chatgpt'],
    });

    expect(options.visibleProviders).toEqual([
      { id: 'opencode-go', label: 'OpenCode Go' },
      { id: 'github-copilot', label: 'GitHub Copilot' },
      { id: 'openrouter', label: 'OpenRouter' },
    ]);
  });

  it('reports invalid visibleProviders entries without changing canonical selection rules', () => {
    const resolved = inspectQuotaPluginOptions({
      visibleProviders: ['openai', 'copilot', 'go', 'or', 'openai', 42],
    });

    expect(resolved.options.visibleProviders).toEqual([{ id: 'openai', label: 'OpenAI' }]);
    expect(resolved.diagnostics).toEqual({
      invalidVisibleProviderEntries: ['"copilot"', '"go"', '"or"', '42'],
      fellBackToDefaultVisibleProviders: false,
    });
  });

  it('accepts canonical provider ids and preserves their configured order', () => {
    const options = resolveQuotaPluginOptions({
      visibleProviders: ['openai', 'opencode-go', 'github-copilot'],
    });

    expect(options.visibleProviders).toEqual([
      { id: 'openai', label: 'OpenAI' },
      { id: 'opencode-go', label: 'OpenCode Go' },
      { id: 'github-copilot', label: 'GitHub Copilot' },
    ]);
  });

  it('keeps the first duplicate canonical provider and does not reorder the output', () => {
    const options = resolveQuotaPluginOptions({
      visibleProviders: ['openai', 'opencode-go', 'openai', 'github-copilot', 'opencode-go'],
    });

    expect(options.visibleProviders).toEqual([
      { id: 'openai', label: 'OpenAI' },
      { id: 'opencode-go', label: 'OpenCode Go' },
      { id: 'github-copilot', label: 'GitHub Copilot' },
    ]);
  });

  it('normalizes numeric plugin options without changing canonical provider order', () => {
    const options = resolveQuotaPluginOptions({
      displayMode: 'used',
      visibleProviders: ['openai', 'openrouter', 'openai'],
      pollIntervalMs: 0,
      minRefreshIntervalMs: 10,
      providerCacheTtlMs: 20,
      providerErrorBackoffMs: Number.NaN,
    });

    expect(options).toEqual({
      displayMode: 'used',
      visibleProviders: [
        { id: 'openai', label: 'OpenAI' },
        { id: 'openrouter', label: 'OpenRouter' },
      ],
      pollIntervalMs: 0,
      minRefreshIntervalMs: 60_000,
      providerCacheTtlMs: 60_000,
      providerErrorBackoffMs: 900_000,
    });
  });

  it('exposes provider adapters from their responsibility-based modules', () => {
    expect(fetchCopilotQuota).toBeDefined();
    expect(fetchWithTimeout).toBe(fetchWithTimeoutFromHttp);
    expect(fetchOpenAIQuota).toBe(fetchOpenAIQuotaFromOpenAI);
    expect(fetchOpenRouterQuota).toBe(fetchOpenRouterQuotaFromOpenRouter);
    expect(fmtDuration).toBe(fmtDurationFromProviderFormat);
    expect(parseAdditionalRateLimits).toBe(parseAdditionalRateLimitsFromOpenAI);
  });

  it('registers a sidebar slot, responds to session changes, and disposes timers/events', async () => {
    const events = new Map<string, (payload?: unknown) => void>();
    const disposers: (() => void)[] = [];
    const slotRegistrations: { slots: { sidebar_content: (ctx: unknown, slotInput: unknown) => unknown } }[] = [];

    const api = {
      event: {
        on: (eventName: string, handler: (payload?: unknown) => void) => {
          events.set(eventName, handler);
          return () => events.delete(eventName);
        },
      },
      lifecycle: {
        onDispose: (handler: () => void) => disposers.push(handler),
      },
      slots: {
        register: (registration: { slots: { sidebar_content: (ctx: unknown, slotInput: unknown) => unknown } }) => {
          slotRegistrations.push(registration);
        },
      },
      theme: { current: { text: 'white', textMuted: 'gray' } },
    } as unknown as TuiPluginApi;

    await plugin.tui(
      api,
      {
        minRefreshIntervalMs: 60_000,
        pollIntervalMs: 0,
        providerCacheTtlMs: 60_000,
        visibleProviders: ['openrouter'],
      },
      pluginMeta,
    );

    expect(slotRegistrations).toHaveLength(1);
    expect(events.has('message.part.updated')).toBe(true);
    expect(events.has('session.error')).toBe(true);
    expect(events.has('session.status')).toBe(true);
    expect(events.has('tui.session.select')).toBe(true);
    expect(events.has('session.idle')).toBe(true);

    disposers.forEach((dispose) => dispose());
    await vi.runAllTimersAsync();
    expect(events.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('warns once when visibleProviders contains invalid entries', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events = new Map<string, (payload?: unknown) => void>();
    const disposers: (() => void)[] = [];
    const slotRegistrations: { slots: { sidebar_content: (ctx: unknown, slotInput: unknown) => unknown } }[] = [];

    const api = {
      event: {
        on: (eventName: string, handler: (payload?: unknown) => void) => {
          events.set(eventName, handler);
          return () => events.delete(eventName);
        },
      },
      lifecycle: {
        onDispose: (handler: () => void) => disposers.push(handler),
      },
      slots: {
        register: (registration: { slots: { sidebar_content: (ctx: unknown, slotInput: unknown) => unknown } }) => {
          slotRegistrations.push(registration);
        },
      },
      theme: { current: { text: 'white', textMuted: 'gray' } },
    } as unknown as TuiPluginApi;

    await registerQuotaTui(
      api,
      {
        minRefreshIntervalMs: 60_000,
        pollIntervalMs: 0,
        providerCacheTtlMs: 60_000,
        visibleProviders: ['copilot', 'openrouter', 'chatgpt'],
      },
    );

    await flushAsyncTasks();

    expect(slotRegistrations).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[quota] Ignoring invalid visibleProviders entries: "copilot", "chatgpt". ' +
        'Allowed canonical provider ids: opencode-go, github-copilot, openrouter, openai.',
    );

    events.get('session.idle')?.();
    await flushAsyncTasks();

    expect(warnSpy).toHaveBeenCalledTimes(1);

    disposers.forEach((dispose) => dispose());
  });

  it('coalesces repeated immediate refresh events before execution', () => {
    const events = new Map<string, (payload?: unknown) => void>();
    const onRefresh = vi.fn();
    const scheduler = createRefreshScheduler({
      subscribe: (eventName, handler) => {
        events.set(eventName, handler);
        return () => events.delete(eventName);
      },
      onRefresh,
      immediateEvents: ['now'],
      completionEvents: [],
      pollIntervalMs: 0,
      refreshDelayMs: 250,
    });

    events.get('now')?.();
    events.get('now')?.();
    events.get('now')?.();
    events.get('now')?.();
    vi.advanceTimersByTime(249);
    expect(onRefresh).toHaveBeenCalledTimes(0);

    events.get('now')?.();
    vi.advanceTimersByTime(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith('now');

    scheduler.dispose();
  });

  it('recognizes terminal subagent completion events without reacting to non-terminal noise', () => {
    expect(
      isQuotaTerminalTaskEvent({
        properties: {
          part: {
            type: 'tool',
            tool: 'task',
            state: {
              status: 'completed',
            },
          },
        },
      }),
    ).toBe(true);

    expect(
      isQuotaTerminalTaskEvent({
        properties: {
          part: {
            type: 'tool',
            tool: 'task',
            state: {
              status: 'running',
            },
          },
        },
      }),
    ).toBe(false);

    expect(
      isQuotaTerminalSessionEvent({
        properties: {
          state: {
            status: 'completed',
          },
        },
      }),
    ).toBe(true);

    expect(
      isQuotaTerminalSessionEvent({
        properties: {
          status: 'running',
        },
      }),
    ).toBe(false);
  });

  it('filters non-terminal task updates before scheduling completion refreshes', () => {
    const events = new Map<string, (payload?: unknown) => void>();
    const onRefresh = vi.fn();
    const scheduler = createRefreshScheduler({
      subscribe: (eventName, handler) => {
        events.set(eventName, handler);
        return () => events.delete(eventName);
      },
      onRefresh,
      immediateEvents: [],
      completionEvents: [{ name: 'message.part.updated', shouldRefresh: isQuotaTerminalTaskEvent }],
      pollIntervalMs: 0,
      refreshDelayMs: 300,
    });

    events.get('message.part.updated')?.({
      properties: {
        part: {
          type: 'tool',
          tool: 'task',
          state: {
            status: 'running',
          },
        },
      },
    });
    vi.advanceTimersByTime(600);
    expect(onRefresh).toHaveBeenCalledTimes(0);

    events.get('message.part.updated')?.({
      properties: {
        part: {
          type: 'tool',
          tool: 'task',
          state: {
            status: 'completed',
          },
        },
      },
    });
    vi.advanceTimersByTime(549);
    expect(onRefresh).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith('message.part.updated');

    scheduler.dispose();
  });

  it('coalesces terminal subagent bursts into one forced provider refetch per refresh interval', async () => {
    vi.resetModules();

    const fetchProviderLines = vi.fn(async () => ['OpenRouter ready']);

    vi.doMock('../src/domain/provider-results.ts', async () => {
      const actual = await vi.importActual<typeof import('../src/domain/provider-results.ts')>(
        '../src/domain/provider-results.ts',
      );

      return {
        ...actual,
        fetchProviderLines,
      };
    });

    const { registerQuotaTui } = await import('../src/runtime/runtime.tsx');
    const events = new Map<string, (payload?: unknown) => void>();
    const disposers: Array<() => void> = [];

    const api = {
      event: {
        on: (eventName: string, handler: (payload?: unknown) => void) => {
          events.set(eventName, handler);
          return () => events.delete(eventName);
        },
      },
      lifecycle: {
        onDispose: (handler: () => void) => disposers.push(handler),
      },
      slots: {
        register: vi.fn(),
      },
      theme: { current: { text: 'white', textMuted: 'gray' } },
    } as unknown as TuiPluginApi;

    await registerQuotaTui(api, {
      minRefreshIntervalMs: 60_000,
      pollIntervalMs: 0,
      providerCacheTtlMs: 300_000,
      visibleProviders: ['openrouter'],
    });
    await flushAsyncTasks();

    expect(fetchProviderLines).toHaveBeenCalledTimes(1);

    const emitTerminalTaskCompletion = () => {
      events.get('message.part.updated')?.({
        properties: {
          part: {
            type: 'tool',
            tool: 'task',
            state: {
              status: 'completed',
            },
          },
        },
      });
    };

    emitTerminalTaskCompletion();
    vi.advanceTimersByTime(549);
    await flushAsyncTasks();
    expect(fetchProviderLines).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await flushAsyncTasks();
    expect(fetchProviderLines).toHaveBeenCalledTimes(2);

    emitTerminalTaskCompletion();
    events.get('session.status')?.({
      properties: {
        state: {
          status: 'completed',
        },
      },
    });
    events.get('session.error')?.({
      properties: {
        sessionID: 'ses_child',
      },
    });

    vi.advanceTimersByTime(550);
    await flushAsyncTasks();
    expect(fetchProviderLines).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(59_449);
    await flushAsyncTasks();
    expect(fetchProviderLines).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1);
    await flushAsyncTasks();
    expect(fetchProviderLines).toHaveBeenCalledTimes(3);

    disposers.forEach((dispose) => dispose());
    vi.doUnmock('../src/domain/provider-results.ts');
    vi.resetModules();
  });

  it('starts provider refreshes in parallel and applies each result as it settles', async () => {
    const started: string[] = [];
    const resolvers: Record<string, (value: string) => void> = {};
    const results = new Map([
      ['github-copilot' as const, null],
      ['openrouter' as const, null],
    ]);
    const onUpdate = vi.fn();

    const refreshPromise = refreshQuotaProviders({
      visibleProviders: [
        { id: 'github-copilot', label: 'GitHub Copilot' },
        { id: 'openrouter', label: 'OpenRouter' },
      ],
      results,
      goConfig: null,
      getCachedProviderLines: (providerId) => {
        started.push(providerId);

        return new Promise((resolve) => {
          resolvers[providerId] = resolve;
        });
      },
      shouldContinue: () => true,
      onUpdate,
    });

    expect(started).toEqual(['github-copilot', 'openrouter']);

    resolvers.openrouter?.('openrouter-ready');
    await Promise.resolve();

    expect(results.get('openrouter')).toBe('openrouter-ready');
    expect(results.get('github-copilot')).toBeNull();
    expect(onUpdate).toHaveBeenCalledTimes(1);

    resolvers['github-copilot']?.('copilot-ready');
    await refreshPromise;

    expect(results.get('github-copilot')).toBe('copilot-ready');
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('recognizes rate-limit errors and ignores plain parse errors', () => {
    expect(isQuotaRateLimitError('Request failed with status code 429: Too Many Requests')).toBe(true);
    expect(isQuotaRateLimitError('Rate limit exceeded while processing request')).toBe(true);
    expect(isQuotaRateLimitError('Cannot parse response: unexpected token in JSON at position 1')).toBe(false);
  });

  it('honors retry-after details even when an error body follows', () => {
    expect(retryAfterMsFromMessage('OpenAI HTTP 429; retry-after=3600; body: slow down')).toBe(3_600_000);
    expect(retryAfterMsFromMessage('OpenRouter HTTP 429; retry-after 120: slow down')).toBe(120_000);
  });

  it('normalizes Copilot reset_at values in seconds and milliseconds', () => {
    expect(normalizeCopilotResetAtMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeCopilotResetAtMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('returns a clear timeout error from fetchWithTimeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const request = fetchWithTimeout('https://example.test/slow', {}, 250);
    vi.advanceTimersByTime(250);

    await expect(request).rejects.toThrow('Request to https://example.test/slow timed out after 250ms');
  });

  it('returns a stable error for malformed OpenRouter credit payloads', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('null', { status: 200 }));

    await expect(fetchOpenRouterQuota()).resolves.toEqual({
      error: 'OpenRouter did not return expected credit data',
    });
  });

  it('sanitizes html and invalid-json responses from provider endpoints', async () => {
    vi.stubEnv(
      'XDG_DATA_HOME',
      createAuthFixture({
        'github-copilot': { type: 'oauth', access: 'copilot-token' },
        openai: { type: 'oauth', access: 'openai-token', account_id: 'acct-123' },
      }),
    );

    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock.mockResolvedValueOnce(
      new Response(
        '<!doctype html><html><head><title>Quota Failure</title></head><body><h1>\u001b[31mNope\nline</h1></body></html>',
        { status: 200 },
      ),
    );

    const copilot = await fetchCopilotQuota();
    expect(copilot).not.toBeNull();
    expect(copilot && 'error' in copilot).toBe(true);
    if (copilot && 'error' in copilot) {
      expect(copilot.error).toContain('Copilot API returned invalid JSON');
      expect(copilot.error).toContain('HTML response: Quota Failure');
      expect(copilot.error).not.toContain('<html>');
      expect(copilot.error).not.toContain('<title>');
      expect(copilot.error).not.toContain('\u001b');
      expect(copilot.error).not.toContain('\n');
    }

    fetchMock.mockResolvedValueOnce(new Response('\u001b[31mnot json\nline2', { status: 200 }));

    const openai = await fetchOpenAIQuota();
    expect(openai).not.toBeNull();
    expect(openai && 'error' in openai).toBe(true);
    if (openai && 'error' in openai) {
      expect(openai.error).toContain('OpenAI returned invalid JSON');
      expect(openai.error).toContain('not json line2');
      expect(openai.error).not.toContain('\u001b');
      expect(openai.error).not.toContain('\n');
    }
  });

  it('sanitizes html bodies returned by non-ok responses', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-token');

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(
        '<!doctype html><html><head><title>Gateway Down</title></head><body><h1>\u001b[31mTry again\nlater</h1></body></html>',
        {
          status: 502,
          headers: { 'content-type': 'text/html' },
        },
      ),
    );

    const result = await fetchOpenRouterQuota();
    expect(result).not.toBeNull();
    expect(result && 'error' in result).toBe(true);
    if (result && 'error' in result) {
      expect(result.error).toContain('OpenRouter HTTP 502');
      expect(result.error).toContain('HTML response: Gateway Down');
      expect(result.error).not.toContain('<html>');
      expect(result.error).not.toContain('<title>');
      expect(result.error).not.toContain('\u001b');
      expect(result.error).not.toContain('\n');
    }
  });

  it('formats weekly responsible usage pace against elapsed window time', () => {
    expect(
      formatResponsibleWeeklyUsage({
        usedPct: 4,
        resetSec: 6 * 24 * 60 * 60 + 18 * 60 * 60,
      }),
    ).toBe('⚠ high · 0.43% over');

    expect(
      formatResponsibleWeeklyUsage({
        usedPct: 50,
        resetSec: 4 * 24 * 60 * 60,
      }),
    ).toBe('⚠ high · 7.14% over');

    expect(
      formatResponsibleWeeklyUsage({
        usedPct: 60,
        resetSec: 4 * 24 * 60 * 60,
      }),
    ).toBe('⚠ high · 17.14% over');

    expect(
      formatResponsibleWeeklyUsage({
        usedPct: 20,
        resetSec: 6 * 24 * 60 * 60,
      }),
    ).toBe('⚠ high · 5.71% over');
  });

  it('formats durations including minutes and seconds', () => {
    expect(fmtDuration(6 * 86400 + 23 * 3600 + 12 * 60 + 34)).toBe('6d 23h 12m 34s');
    expect(fmtDuration(75)).toBe('1m 15s');
  });

  it('parses Codex Spark additional rate limit', () => {
    const limits = parseAdditionalRateLimits([
      {
        limit_name: 'GPT-5.3-Codex-Spark',
        metered_feature: '...',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 12.5,
            reset_after_seconds: 3600,
            reset_at: 1234567890,
            limit_window_seconds: 18000,
          },
          secondary_window: {
            used_percent: 25,
            reset_after_seconds: 7200,
            reset_at: 1234567890,
            limit_window_seconds: 604800,
          },
        },
      },
    ]);

    expect(limits).toHaveLength(1);
    expect(limits[0]).toMatchObject({
      label: 'Codex Spark',
      allowed: true,
      limitReached: false,
      primary: {
        usedPct: 12.5,
        resetSec: 3600,
        limitWindowSec: 18000,
      },
      secondary: {
        usedPct: 25,
        resetSec: 7200,
        limitWindowSec: 604800,
      },
    });
  });
});
