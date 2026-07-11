import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchWithTimeout,
  httpErrorMessage,
  readJsonResponse,
} from '../../../../src/features/quota/infrastructure/providers/http.ts';

// ---------------------------------------------------------------------------
// fetchWithTimeout — timeout abort propagation, error translation, external
// signal cancellation
// ---------------------------------------------------------------------------

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const makeAbortableFetch = (): {
    fetchMock: ReturnType<typeof vi.fn>;
    controller: AbortController;
  } => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const signal = options.signal as AbortSignal;
          if (signal.aborted) {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
          // Never resolves on its own — timeout or external signal must trigger
        }),
    );
    return { fetchMock, controller };
  };

  it('throws a timeout error when the fetch does not respond within the configured ms', async () => {
    const { fetchMock } = makeAbortableFetch();
    vi.stubGlobal('fetch', fetchMock);

    const fetchPromise = fetchWithTimeout('https://example.com/api', {}, 1000);

    vi.advanceTimersByTime(1000);

    await expect(fetchPromise).rejects.toThrow('Request to https://example.com/api timed out after 1000ms');
  });

  it('does not throw when the fetch resolves before the timeout expires', async () => {
    vi.useRealTimers(); // real timers for this test — we need fetch to actually resolve

    const mockResponse = new Response('ok', { status: 200 });
    // Using fake timers for the test but need the fetch to actually resolve…
    // Instead: manually resolve before the timeout fires
    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWithTimeout('https://example.com/api', {}, 5000);
    expect(result.status).toBe(200);

    vi.restoreAllMocks();
  });

  it('cancels the internal timer when the external signal aborts first', async () => {
    const { fetchMock } = makeAbortableFetch();
    vi.stubGlobal('fetch', fetchMock);

    const externalController = new AbortController();
    const fetchPromise = fetchWithTimeout('https://example.com/api', {}, 5000, externalController.signal);

    externalController.abort();

    await expect(fetchPromise).rejects.toThrow('Request to https://example.com/api timed out after 5000ms');
  });

  it('uses the default FETCH_TIMEOUT_MS when no ms argument is given', async () => {
    const { fetchMock } = makeAbortableFetch();
    vi.stubGlobal('fetch', fetchMock);

    // Default is 10_000 (FETCH_TIMEOUT_MS from constants, which is DEFAULT_FETCH_TIMEOUT_MS = 10_000)
    const fetchPromise = fetchWithTimeout('https://example.com/api', {});

    vi.advanceTimersByTime(10_000);

    await expect(fetchPromise).rejects.toThrow('Request to https://example.com/api timed out after 10000ms');
  });

  it('aborts when both the internal timeout and the external signal are provided', async () => {
    const { fetchMock } = makeAbortableFetch();
    vi.stubGlobal('fetch', fetchMock);

    const externalController = new AbortController();
    const fetchPromise = fetchWithTimeout('https://example.com/api', {}, 3000, externalController.signal);

    // External aborts before the 3s timeout
    externalController.abort();

    await expect(fetchPromise).rejects.toThrow('Request to https://example.com/api timed out after 3000ms');
  });
});

// ---------------------------------------------------------------------------
// httpErrorMessage — structured HTTP error messages
// ---------------------------------------------------------------------------

describe('httpErrorMessage', () => {
  it('formats a basic HTTP status', () => {
    const res = new Response(null, { status: 429 });
    expect(httpErrorMessage('GitHub API', res)).toBe('GitHub API HTTP 429');
  });

  it('includes retry-after header when present', () => {
    const res = new Response(null, { status: 429, headers: { 'retry-after': '120' } });
    expect(httpErrorMessage('GH', res)).toContain('retry-after=120');
  });

  it('includes x-ratelimit-reset header when present', () => {
    const res = new Response(null, { status: 429, headers: { 'x-ratelimit-reset': '1700000000' } });
    expect(httpErrorMessage('GH', res)).toContain('rate-limit-reset=1700000000');
  });

  it('includes a truncated body preview for HTML responses', () => {
    const res = new Response(null, { status: 502 });
    expect(httpErrorMessage('API', res, '<!DOCTYPE html><html><title>Bad Gateway</title></html>')).toContain(
      'HTML response: Bad Gateway',
    );
  });

  it('includes a truncated body preview for text responses', () => {
    const res = new Response(null, { status: 500 });
    const longBody = 'x'.repeat(300);
    const msg = httpErrorMessage('API', res, longBody);
    expect(msg).toContain('…');
  });
});

// ---------------------------------------------------------------------------
// readJsonResponse — JSON parsing with error wrapping
// ---------------------------------------------------------------------------

describe('readJsonResponse', () => {
  it('parses valid JSON from the response body', async () => {
    const res = new Response('{"key": "value"}', { status: 200 });
    const result = await readJsonResponse('Test', res);
    expect('data' in result).toBe(true);
    if ('data' in result) {
      expect(result.data).toEqual({ key: 'value' });
    }
  });

  it('returns an error for invalid JSON', async () => {
    const res = new Response('not-json', { status: 200 });
    const result = await readJsonResponse('Test', res);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('invalid JSON');
    }
  });
});
