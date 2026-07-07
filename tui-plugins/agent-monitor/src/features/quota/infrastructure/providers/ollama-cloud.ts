import type { OllamaCloudResult, QuotaDisplayMode, QuotaLine } from '../../domain/types.ts';
import { WEEK_SECONDS } from '../../domain/types.ts';
import { formatPercentQuota } from '../../domain/lines.ts';
import { headingLine, paceLine, windowLine } from '../../domain/lines.ts';
import { readQuotaConfig } from './config.ts';
import { OLLAMA_CLOUD_SETTINGS_URL, USER_AGENT } from './constants.ts';
import { fetchWithTimeout, httpErrorMessage } from './http.ts';

const OLLAMA_CLOUD_COOKIE_NAME = '__Secure-session';
const OLLAMA_CLOUD_PROVIDER_LABEL = 'Ollama Cloud';

const DATA_USAGE_TRACK_RE = /<[^>]*\bdata-usage-track\b[^>]*>/gi;
const ARIA_USED_PERCENT_RE = /(\d+(?:\.\d+)?)\s*%\s*used/i;
const STYLE_ATTR_RE = /style="([^"]*)"/i;
const WIDTH_PERCENT_RE = /width\s*:\s*([0-9.]+)\s*%/i;
const LOCAL_TIME_RE = /class="[^"]*local-time[^"]*"[^>]*data-time="([^"]*)"/gi;

const readOllamaCloudCookie = (): string | null => {
  const cookie = readQuotaConfig()?.providers?.['ollama-cloud']?.authCookie;
  return cookie && cookie.trim() ? cookie.trim() : null;
};

// Ollama emits both `aria-label="N% used"` and `style="width: N%"` on each track,
// but some sessions (or older renders) lack the aria label — fall back to the
// CSS width so the provider still reports something useful.
const parseUsagePercent = (trackHtml: string): number | null => {
  const aria = trackHtml.match(ARIA_USED_PERCENT_RE);
  if (aria) {
    const pct = Number(aria[1]);
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100) return pct;
  }

  const styleMatch = trackHtml.match(STYLE_ATTR_RE);
  if (styleMatch) {
    const width = styleMatch[1].match(WIDTH_PERCENT_RE);
    if (width) {
      const pct = Number(width[1]);
      if (Number.isFinite(pct) && pct >= 0 && pct <= 100) return pct;
    }
  }

  return null;
};

const resetSecFromIso = (iso: string, nowMs: number): number => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((t - nowMs) / 1000));
};

export const parseOllamaCloudHtml = (html: string, nowMs: number): OllamaCloudResult | { error: string } => {
  DATA_USAGE_TRACK_RE.lastIndex = 0;
  const tracks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = DATA_USAGE_TRACK_RE.exec(html)) !== null) {
    tracks.push(match[0]);
  }

  if (tracks.length === 0) {
    return { error: 'Could not parse usage tracks from Ollama Cloud settings page' };
  }

  LOCAL_TIME_RE.lastIndex = 0;
  const resetTimes: string[] = [];
  while ((match = LOCAL_TIME_RE.exec(html)) !== null) {
    resetTimes.push(match[1]);
  }

  // Ollama renders the session meter before the weekly meter — if they ever
  // swap the order, both numbers will silently shift by one slot.
  const sessionPct = parseUsagePercent(tracks[0]);
  const weeklyPct = tracks.length > 1 ? parseUsagePercent(tracks[1]) : null;

  if (sessionPct === null && weeklyPct === null) {
    return { error: 'Could not extract usage percentages from Ollama Cloud settings page' };
  }

  const result: OllamaCloudResult = {};

  if (sessionPct !== null) {
    const resetSec = resetTimes[0] ? resetSecFromIso(resetTimes[0], nowMs) : 0;
    result.session = { usedPct: sessionPct, remainingPct: 100 - sessionPct, resetSec };
  }

  if (weeklyPct !== null) {
    const resetSec = resetTimes[1] ? resetSecFromIso(resetTimes[1], nowMs) : 0;
    result.weekly = { usedPct: weeklyPct, remainingPct: 100 - weeklyPct, resetSec };
  }

  return result;
};

export const formatOllamaCloudLines = (
  data: OllamaCloudResult,
  displayMode: QuotaDisplayMode,
  fetchedAtMs: number,
): QuotaLine[] => {
  const lines: QuotaLine[] = [headingLine(OLLAMA_CLOUD_PROVIDER_LABEL)];

  // Mirrors `formatOpencodeGoLines` — short label, shared percent helper, pace line
  // for every known window length. Session is a rolling 5-hour window.
  for (const [label, win, paceWindowSeconds] of [
    ['5h', data.session, 5 * 3600],
    ['Wk', data.weekly, WEEK_SECONDS],
  ] as const) {
    if (!win) continue;
    lines.push(
      windowLine(
        label,
        formatPercentQuota(win.usedPct, win.remainingPct, displayMode),
        win.resetSec,
        fetchedAtMs,
        'neutral',
        win.usedPct,
      ),
    );
    if (paceWindowSeconds !== undefined) {
      lines.push(paceLine({ usedPct: win.usedPct, resetSec: win.resetSec }, paceWindowSeconds, fetchedAtMs));
    }
  }

  return lines;
};

export const fetchOllamaCloudQuota = async (
  signal?: AbortSignal,
): Promise<OllamaCloudResult | null | { error: string }> => {
  const cookie = readOllamaCloudCookie();
  if (!cookie) return null;

  const response = await fetchWithTimeout(
    OLLAMA_CLOUD_SETTINGS_URL,
    {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
        Cookie: `${OLLAMA_CLOUD_COOKIE_NAME}=${cookie}`,
      },
      // Ollama sends expired sessions to /sign-in; we want to see that redirect
      // ourselves so we can surface a "cookie expired" error instead of fetching
      // a 200-page that has no usage data.
      redirect: 'manual',
    },
    undefined,
    signal,
  );

  if (response.status >= 300 && response.status < 400) {
    return { error: 'Ollama Cloud: redirected — cookie may be expired' };
  }

  if (!response.ok) {
    return { error: httpErrorMessage(OLLAMA_CLOUD_PROVIDER_LABEL, response) };
  }

  const html = await response.text();
  return parseOllamaCloudHtml(html, Date.now());
};
