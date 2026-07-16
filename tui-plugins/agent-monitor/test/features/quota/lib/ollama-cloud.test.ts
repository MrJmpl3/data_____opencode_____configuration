import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/features/quota/infrastructure/providers/config.ts', () => ({ readQuotaConfig: vi.fn() }));
vi.mock('../../../../src/features/quota/infrastructure/providers/http.ts', () => ({
  fetchWithTimeout: vi.fn(),
  httpErrorMessage: vi.fn(
    (label: string, response: Response, text: string) => `${label} HTTP ${response.status} ${text}`,
  ),
}));

import { readQuotaConfig } from '../../../../src/features/quota/infrastructure/providers/config.ts';
import { fetchWithTimeout } from '../../../../src/features/quota/infrastructure/providers/http.ts';
import {
  formatOllamaCloudLines,
  fetchOllamaCloudQuota,
  parseOllamaCloudHtml,
} from '../../../../src/features/quota/infrastructure/providers/ollama-cloud.ts';

const mockedConfig = vi.mocked(readQuotaConfig);
const mockedFetch = vi.mocked(fetchWithTimeout);

afterEach(() => vi.resetAllMocks());

describe('Ollama Cloud parsing and formatting', () => {
  it('parses aria usage, style fallback, reset times, and missing windows', () => {
    const html =
      '<div data-usage-track aria-label="25% used"></div><div data-usage-track style="width: 80%"></div>' +
      '<span class="local-time" data-time="2025-01-01T00:01:00Z"></span>' +
      '<span class="local-time" data-time="2024-12-31T23:59:00Z"></span>';
    expect(parseOllamaCloudHtml(html, Date.parse('2025-01-01T00:00:00Z'))).toEqual({
      session: { usedPct: 25, remainingPct: 75, resetSec: 60 },
      weekly: { usedPct: 80, remainingPct: 20, resetSec: 0 },
    });
    expect(parseOllamaCloudHtml('<div data-usage-track aria-label="bad"></div>', 0)).toEqual({
      error: expect.stringContaining('percentages'),
    });
    expect(parseOllamaCloudHtml('<p>empty</p>', 0)).toEqual({ error: expect.stringContaining('tracks') });
  });

  it('rejects out-of-range percentages and formats both display modes', () => {
    expect(parseOllamaCloudHtml('<div data-usage-track aria-label="120% used" style="width: 101%"></div>', 0)).toEqual({
      error: expect.stringContaining('percentages'),
    });
    const lines = formatOllamaCloudLines(
      {
        session: { usedPct: 25, remainingPct: 75, resetSec: 10 },
        weekly: { usedPct: 80, remainingPct: 20, resetSec: 20 },
      },
      'remaining',
      0,
    );
    expect(lines.map((line) => line.kind)).toEqual(['heading', 'window', 'pace', 'window', 'pace']);
    expect(lines[1]).toMatchObject({ label: '5h', value: '75%' });
    expect(formatOllamaCloudLines({}, 'used', 0)).toEqual([{ kind: 'heading', text: 'Ollama Cloud' }]);
  });
});

describe('fetchOllamaCloudQuota', () => {
  it('returns null without a cookie and handles redirects, HTTP errors, and valid HTML', async () => {
    mockedConfig.mockReturnValueOnce(null);
    expect(await fetchOllamaCloudQuota()).toBeNull();

    mockedConfig.mockReturnValue({ providers: { 'ollama-cloud': { authCookie: ' cookie ' } } });
    mockedFetch.mockResolvedValueOnce(new Response('', { status: 302 }));
    expect(await fetchOllamaCloudQuota()).toEqual({ error: expect.stringContaining('redirected') });
    mockedFetch.mockResolvedValueOnce(new Response('bad', { status: 500 }));
    expect(await fetchOllamaCloudQuota()).toEqual({ error: expect.stringContaining('HTTP 500') });
    mockedFetch.mockResolvedValueOnce(
      new Response('<div data-usage-track aria-label="20% used"></div>', { status: 200 }),
    );
    expect(await fetchOllamaCloudQuota(undefined, 1234)).toEqual({
      session: { usedPct: 20, remainingPct: 80, resetSec: 0 },
    });
    expect(mockedFetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        redirect: 'manual',
        headers: expect.objectContaining({ Cookie: '__Secure-session=cookie' }),
      }),
      1234,
      undefined,
    );
  });
});
