import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';

const fetchCopilotQuota = vi.hoisted(() => vi.fn());
const fetchDeepSeekQuota = vi.hoisted(() => vi.fn());
const fetchOllamaCloudQuota = vi.hoisted(() => vi.fn());
const fetchOpencodeGoDashboard = vi.hoisted(() => vi.fn());
const fetchOpenAIQuota = vi.hoisted(() => vi.fn());
const fetchOpenRouterQuota = vi.hoisted(() => vi.fn());
const readQuotaConfig = vi.hoisted(() => vi.fn());
const readOpencodeGoConfig = vi.hoisted(() => vi.fn());
const subscribeRefreshTriggers = vi.hoisted(() => vi.fn());
const tickerDispose = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/features/quota/infrastructure/providers/copilot.ts', () => ({
  fetchCopilotQuota,
  formatCopilotLines: vi.fn(() => [{ kind: 'detail', text: 'copilot', tone: 'success' }]),
}));
vi.mock('../../../../../src/features/quota/infrastructure/providers/deepseek.ts', () => ({
  fetchDeepSeekQuota,
  formatDeepSeekLines: vi.fn(() => [{ kind: 'detail', text: 'deepseek', tone: 'success' }]),
}));
vi.mock('../../../../../src/features/quota/infrastructure/providers/ollama-cloud.ts', () => ({
  fetchOllamaCloudQuota,
  formatOllamaCloudLines: vi.fn(() => [{ kind: 'detail', text: 'ollama', tone: 'success' }]),
}));
vi.mock('../../../../../src/features/quota/infrastructure/providers/opencode-go.ts', () => ({
  fetchOpencodeGoDashboard,
  formatOpencodeGoWorkspaceHeading: vi.fn((label: string) => label),
  formatOpencodeGoWorkspaceLines: vi.fn((workspace: { label: string }) => [{ kind: 'heading', text: workspace.label }]),
  readOpencodeGoConfig,
}));
vi.mock('../../../../../src/features/quota/infrastructure/providers/openai.ts', () => ({
  fetchOpenAIQuota,
  formatOpenAILines: vi.fn(() => [{ kind: 'detail', text: 'openai', tone: 'success' }]),
}));
vi.mock('../../../../../src/features/quota/infrastructure/providers/openrouter.ts', () => ({
  fetchOpenRouterQuota,
  formatOpenRouterLines: vi.fn(() => [{ kind: 'detail', text: 'openrouter', tone: 'success' }]),
}));
vi.mock('../../../../../src/features/quota/infrastructure/providers/config.ts', () => ({ readQuotaConfig }));
vi.mock('../../../../../src/features/quota/runtime.tsx', () => ({ subscribeRefreshTriggers }));
vi.mock('../../../../../src/kit/use-clock-ticker.ts', () => ({
  useClockTicker: vi.fn(() => tickerDispose),
}));

import { memoryText, renderMemory, type MemoryNode } from '../../../../support/opentui-memory-renderer.ts';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { fetchProviderLines, QuotaSection } from '../../../../../src/features/quota/ui/components/quota-section.tsx';

const config = { authCookie: 'cookie', workspaces: [{ workspaceId: 'workspace', label: 'Workspace' }] };
const trigger = (index = 0): (() => void) => subscribeRefreshTriggers.mock.calls[index][0].onTrigger;

const makeApi = (): TuiPluginApi =>
  ({
    theme: { current: { text: 'white' } },
    event: {},
    lifecycle: { onDispose: vi.fn() },
  }) as unknown as TuiPluginApi;

const renderSection = (options: Record<string, unknown>) =>
  renderMemory(
    () => createComponent(QuotaSection, { api: makeApi(), options: options as never }) as unknown as MemoryNode,
  );

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  readQuotaConfig.mockReturnValue(null);
  readOpencodeGoConfig.mockReturnValue(config);
  fetchOpencodeGoDashboard.mockResolvedValue({ data: {} });
  fetchCopilotQuota.mockResolvedValue({ value: 1 });
  fetchDeepSeekQuota.mockResolvedValue({ value: 1 });
  fetchOllamaCloudQuota.mockResolvedValue({ value: 1 });
  fetchOpenAIQuota.mockResolvedValue({ value: 1 });
  fetchOpenRouterQuota.mockResolvedValue({ value: 1 });
  subscribeRefreshTriggers.mockImplementation(() => ({ unsubscribe: vi.fn() }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('QuotaSection rendered flow', () => {
  it('runs each provider adapter through its import boundary', async () => {
    const setNowMs = vi.fn();
    const base = { opencodeGoConfig: config, displayMode: 'remaining' as const, setNowMs, fetchTimeoutMs: 321 };
    fetchCopilotQuota.mockResolvedValueOnce({ value: 1 });
    fetchOpenRouterQuota.mockResolvedValueOnce(null);
    fetchOpenAIQuota.mockResolvedValueOnce({ value: 1 });
    fetchDeepSeekQuota.mockResolvedValueOnce({ value: 1 });
    fetchOllamaCloudQuota.mockResolvedValueOnce({ value: 1 });

    await expect(fetchProviderLines({ providerId: 'github-copilot', ...base })).resolves.toEqual([
      { kind: 'detail', text: 'copilot', tone: 'success' },
    ]);
    await expect(fetchProviderLines({ providerId: 'openrouter', ...base })).resolves.toBeUndefined();
    await expect(fetchProviderLines({ providerId: 'openai', ...base })).resolves.toEqual([
      { kind: 'detail', text: 'openai', tone: 'success' },
    ]);
    await expect(fetchProviderLines({ providerId: 'deepseek', ...base })).resolves.toEqual([
      { kind: 'detail', text: 'deepseek', tone: 'success' },
    ]);
    await expect(fetchProviderLines({ providerId: 'ollama-cloud', ...base })).resolves.toEqual([
      { kind: 'detail', text: 'ollama', tone: 'success' },
    ]);
    await expect(fetchProviderLines({ providerId: 'opencode-go', ...base })).resolves.toEqual([
      { kind: 'heading', text: 'Workspace' },
    ]);
    expect(setNowMs).toHaveBeenCalled();
  });

  it('returns no lines for an unconfigured opencode-go provider', async () => {
    await expect(
      fetchProviderLines({
        providerId: 'opencode-go',
        opencodeGoConfig: null,
        displayMode: 'remaining',
        setNowMs: vi.fn(),
      }),
    ).resolves.toEqual([]);
  });

  it('renders the initial loading state, then fetches configured providers with provider config', async () => {
    const view = renderSection({ visibleProviders: ['openai'], pollIntervalMs: 0 });
    expect(memoryText(view.root)).toContain('QuotaLoading…');

    await settle();
    await vi.waitFor(() => expect(fetchOpenAIQuota).toHaveBeenCalled());
    expect(memoryText(view.root)).toContain('Quota');
    expect(fetchOpenAIQuota).toHaveBeenCalledOnce();
    expect(fetchOpenAIQuota).toHaveBeenCalledWith({ experimentalResetCredits: false, timeoutMs: 10_000 });
    view.dispose();
  });

  it('reads the experimental OpenAI option and renders success, error, and null provider outcomes', async () => {
    readQuotaConfig.mockReturnValue({ options: { experimentalOpenAIResetCredits: true } });
    fetchCopilotQuota.mockResolvedValueOnce(null);
    fetchOpenRouterQuota.mockResolvedValueOnce({ error: 'router failed' });
    fetchOpenAIQuota.mockRejectedValueOnce(new Error('network down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = renderSection({
      visibleProviders: ['github-copilot', 'openrouter', 'openai', 'deepseek'],
      pollIntervalMs: 0,
      providerCacheTtlMs: 60_000,
    });

    await settle();
    expect(memoryText(view.root)).toContain('Quota');
    expect(fetchOpenAIQuota).toHaveBeenCalledWith({ experimentalResetCredits: true, timeoutMs: 10_000 });
    expect(warn).toHaveBeenCalledWith(
      '[agent-monitor] quota provider error:',
      expect.objectContaining({ providerId: 'openrouter' }),
    );
    expect(warn).toHaveBeenCalledWith(
      '[agent-monitor] quota provider error:',
      expect.objectContaining({ providerId: 'openai' }),
    );
    warn.mockRestore();
    view.dispose();
  });

  it('formats opencode-go workspace success and caught workspace rejection lines', async () => {
    fetchOpencodeGoDashboard
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new Error('workspace unavailable'));
    readOpencodeGoConfig.mockReturnValue({
      authCookie: 'cookie',
      workspaces: [
        { workspaceId: 'one', label: 'One' },
        { workspaceId: 'two', label: 'Two' },
      ],
    });
    const view = renderSection({ visibleProviders: ['opencode-go'], pollIntervalMs: 0 });

    await settle();
    expect(memoryText(view.root)).toContain('Quota');
    expect(fetchOpencodeGoDashboard).toHaveBeenNthCalledWith(1, 'one', 'cookie', undefined, 10_000);
    view.dispose();
  });

  it('polls when enabled and does not create a polling timer when disabled', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const enabled = renderSection({
      visibleProviders: ['deepseek'],
      pollIntervalMs: 60_000,
      providerCacheTtlMs: 60_000,
    });
    await settle();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(fetchDeepSeekQuota).toHaveBeenCalledTimes(2);
    enabled.dispose();

    setIntervalSpy.mockClear();
    const disabled = renderSection({ visibleProviders: ['deepseek'], pollIntervalMs: 0 });
    await settle();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    disabled.dispose();
  });

  it('refreshes immediately after the debounce window and replaces deferred refreshes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const view = renderSection({ visibleProviders: ['deepseek'], pollIntervalMs: 0, minRefreshIntervalMs: 60_000 });
    await settle();
    await vi.waitFor(() => expect(fetchDeepSeekQuota).toHaveBeenCalled());
    const onTrigger = trigger();

    const initialCalls = fetchDeepSeekQuota.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    onTrigger();
    await settle();
    expect(fetchDeepSeekQuota.mock.calls.length).toBeGreaterThanOrEqual(initialCalls + 1);

    vi.advanceTimersByTime(1_000);
    onTrigger();
    vi.advanceTimersByTime(10_000);
    onTrigger();
    vi.advanceTimersByTime(49_999);
    await settle();
    expect(fetchDeepSeekQuota.mock.calls.length).toBeGreaterThanOrEqual(initialCalls + 1);
    vi.advanceTimersByTime(1);
    await settle();
    expect(fetchDeepSeekQuota.mock.calls.length).toBeGreaterThan(initialCalls + 1);
    view.dispose();
  });

  it('discards stale generations when a newer refresh completes first', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    let resolveSecond!: (value: unknown) => void;
    let resolveThird!: (value: unknown) => void;
    fetchDeepSeekQuota
      .mockResolvedValueOnce({ value: 'initial' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveThird = resolve;
          }),
      );
    const view = renderSection({ visibleProviders: ['deepseek'], pollIntervalMs: 0, minRefreshIntervalMs: 60_000 });
    await settle();
    const onTrigger = trigger();
    vi.advanceTimersByTime(60_000);
    onTrigger();
    vi.advanceTimersByTime(60_000);
    onTrigger();
    resolveThird({ value: 'newer' });
    await settle();
    resolveSecond({ value: 'older' });
    await settle();
    expect(fetchDeepSeekQuota).toHaveBeenCalledTimes(3);
    view.dispose();
  });

  it('clears deferred work and refresh subscriptions during disposal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const unsubscribe = vi.fn();
    const disposeLifecycle = vi.fn();
    subscribeRefreshTriggers.mockImplementation(
      ({ lifecycle }: { lifecycle: { onDispose: (fn: () => void) => void } }) => {
        lifecycle.onDispose(disposeLifecycle);
        return { unsubscribe };
      },
    );
    const view = renderSection({ visibleProviders: ['deepseek'], pollIntervalMs: 0, minRefreshIntervalMs: 120_000 });
    await settle();
    await vi.waitFor(() => expect(fetchDeepSeekQuota).toHaveBeenCalled());
    vi.advanceTimersByTime(1);
    trigger()();
    view.dispose();
    expect(subscribeRefreshTriggers).toHaveBeenCalledOnce();
  });

  it('executes a deferred event refresh and cancels its replacement timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1);
    const view = renderSection({ visibleProviders: ['deepseek'], pollIntervalMs: 0, minRefreshIntervalMs: 60_000 });
    const onTrigger = trigger();
    onTrigger();
    vi.advanceTimersByTime(59_999);
    const callsBeforeTimer = fetchDeepSeekQuota.mock.calls.length;
    vi.advanceTimersByTime(1);
    await settle();
    expect(fetchDeepSeekQuota.mock.calls.length).toBe(callsBeforeTimer);
    view.dispose();
  });
});
