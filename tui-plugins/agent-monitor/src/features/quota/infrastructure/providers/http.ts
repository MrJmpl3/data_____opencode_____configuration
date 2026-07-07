import { FETCH_TIMEOUT_MS } from './constants.ts';

export const fetchWithTimeout = async (
  url: string,
  requestOptions: RequestInit,
  ms: number = FETCH_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const mergedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

  try {
    return await fetch(url, { ...requestOptions, signal: mergedSignal });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${ms}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const MAX_ERROR_PREVIEW = 120;
const HTML_TAG_RE = /<[^>]*>/g;
const HTML_TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const HTML_PROBE_RE = /<(?:!doctype\s+html|\/?[a-z][\w:-]*)/i;

// ponytail: one-pass scrub — strips ANSI/control chars, collapses whitespace, truncates.
const cleanSnippet = (raw: string): string =>
  raw
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const previewBody = (body?: string): string | undefined => {
  if (!body) return undefined;
  const cleaned = cleanSnippet(body);
  if (!cleaned) return undefined;

  if (HTML_PROBE_RE.test(cleaned)) {
    const title = cleaned.match(HTML_TITLE_RE)?.[1]?.replace(HTML_TAG_RE, ' ').trim();
    return title ? `HTML response: ${title.slice(0, MAX_ERROR_PREVIEW)}` : 'HTML response';
  }

  return cleaned.length > MAX_ERROR_PREVIEW ? `${cleaned.slice(0, MAX_ERROR_PREVIEW - 1).trimEnd()}…` : cleaned;
};

export const httpErrorMessage = (label: string, res: Response, body?: string): string => {
  const parts = [`${label} HTTP ${res.status}`];
  const retryAfter = res.headers.get('retry-after')?.trim();
  const rateLimitReset = res.headers.get('x-ratelimit-reset')?.trim() || res.headers.get('ratelimit-reset')?.trim();
  if (retryAfter) parts.push(`retry-after=${cleanSnippet(retryAfter)}`);
  if (rateLimitReset) parts.push(`rate-limit-reset=${cleanSnippet(rateLimitReset)}`);
  const preview = previewBody(body);
  if (preview) parts.push(preview);
  return parts.join('; ');
};

export const readJsonResponse = async (
  label: string,
  res: Response,
): Promise<{ data: unknown } | { error: string }> => {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { error: `${label} returned an unreadable JSON response` };
  }

  try {
    return { data: JSON.parse(text.replace(/^\uFEFF/, '')) as unknown };
  } catch {
    const preview = previewBody(text);
    return { error: preview ? `${label} returned invalid JSON · ${preview}` : `${label} returned invalid JSON` };
  }
};
