import { createComponent } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchDeepSeekQuota = vi.hoisted(() => vi.fn());
const fetchCopilotQuota = vi.hoisted(() => vi.fn());
const fetchOllamaCloudQuota = vi.hoisted(() => vi.fn());
const fetchOpenAIQuota = vi.hoisted(() => vi.fn());
const fetchOpenRouterQuota = vi.hoisted(() => vi.fn());
const fetchOpencodeGoDashboard = vi.hoisted(() => vi.fn());
const readOpencodeGoConfig = vi.hoisted(() => vi.fn());
const readQuotaConfig = vi.hoisted(() => vi.fn());
const subscribeRefreshTriggers = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/features/quota/infrastructure/providers/copilot.ts', () => ({
  fetchCopilotQuota,
  formatCopilotLines: vi.fn(() => [{ kind: 'detail', text: 'copilot', tone: 'neutral' }]),
}));
vi.mock('../../../../src/features/quota/infrastructure/providers/deepseek.ts', () => ({
  fetchDeepSeekQuota,
  formatDeepSeekLines: vi.fn(() => [{ kind: 'detail', text: 'deepseek', tone: 'neutral' }]),
}));
vi.mock('../../../../src/features/quota/infrastructure/providers/ollama-cloud.ts', () => ({
  fetchOllamaCloudQuota,
  formatOllamaCloudLines: vi.fn(() => [{ kind: 'detail', text: 'ollama', tone: 'neutral' }]),
}));
vi.mock('../../../../src/features/quota/infrastructure/providers/openai.ts', () => ({
  fetchOpenAIQuota,
  formatOpenAILines: vi.fn(() => [{ kind: 'detail', text: 'openai', tone: 'neutral' }]),
}));
vi.mock('../../../../src/features/quota/infrastructure/providers/openrouter.ts', () => ({
  fetchOpenRouterQuota,
  formatOpenRouterLines: vi.fn(() => [{ kind: 'detail', text: 'openrouter', tone: 'neutral' }]),
}));
vi.mock('../../../../src/features/quota/infrastructure/providers/opencode-go.ts', () => ({
  fetchOpencodeGoDashboard,
  formatOpencodeGoWorkspaceHeading: vi.fn((label: string) => label),
  formatOpencodeGoWorkspaceLines: vi.fn(() => []),
  readOpencodeGoConfig,
}));
vi.mock('../../../../src/features/quota/infrastructure/providers/config.ts', () => ({ readQuotaConfig }));
vi.mock('../../../../src/features/quota/runtime.tsx', () => ({ subscribeRefreshTriggers }));
vi.mock('../../../../src/kit/use-clock-ticker.ts', () => ({ useClockTicker: vi.fn(() => vi.fn()) }));

import { renderMemory } from '../../../support/opentui-memory-renderer.ts';
import { QuotaSection } from '../../../../src/features/quota/ui/components/quota-section.tsx';

describe('final quota section timing branches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.clearAllMocks();
    readQuotaConfig.mockReturnValue(null);
    readOpencodeGoConfig.mockReturnValue(null);
    fetchDeepSeekQuota.mockResolvedValue({ value: 'quota' });
    subscribeRefreshTriggers.mockImplementation(() => ({ unsubscribe: vi.fn() }));
  });

  afterEach(() => vi.useRealTimers());

  it('executes a deferred refresh and cancels a pending timer on disposal', async () => {
    const api = {
      theme: { current: { text: 'white' } },
      event: {},
      lifecycle: { onDispose: vi.fn() },
    };
    const view = renderMemory(
      () =>
        createComponent(QuotaSection, {
          api: api as never,
          options: {
            visible: true,
            order: 60,
            visibleProviders: ['deepseek'],
            pollIntervalMs: 0,
            minRefreshIntervalMs: 60_000,
          },
        }) as never,
    );
    await vi.waitFor(() => expect(fetchDeepSeekQuota).toHaveBeenCalledOnce());
    await Promise.resolve();
    await Promise.resolve();

    const onTrigger = subscribeRefreshTriggers.mock.calls[0][0].onTrigger as () => void;
    const initialCalls = fetchDeepSeekQuota.mock.calls.length;
    onTrigger();
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(fetchDeepSeekQuota.mock.calls.length).toBeGreaterThan(initialCalls);

    onTrigger();
    const callsBeforeDispose = fetchDeepSeekQuota.mock.calls.length;
    view.dispose();
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(fetchDeepSeekQuota.mock.calls.length).toBe(callsBeforeDispose);
  });
});
