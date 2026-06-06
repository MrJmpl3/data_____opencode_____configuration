import type { GoWindow } from '../../domain/types.ts';
import { DASHBOARD_URL, USER_AGENT } from './constants.ts';
import { fetchWithTimeout, httpErrorMessage } from './http.ts';

export const readGoConfig = (): {
  workspaceId: string;
  authCookie: string;
} | null => {
  const workspaceId = process.env.OPENCODE_GO_WORKSPACE_ID?.trim();
  const authCookie = process.env.OPENCODE_GO_AUTH_COOKIE?.trim();
  if (workspaceId && authCookie) return { workspaceId, authCookie };
  return null;
};

const RE_NUM = String.raw`(-?\d+(?:\.\d+)?)`;

const windowRegexes = (key: string): { pctFirst: RegExp; resetFirst: RegExp } => {
  const pctFirst = new RegExp(
    String.raw`${key}:\$R\[\d+\]=\{[^}]*usagePercent:${RE_NUM}[^}]*resetInSec:${RE_NUM}[^}]*\}`,
  );
  const resetFirst = new RegExp(
    String.raw`${key}:\$R\[\d+\]=\{[^}]*resetInSec:${RE_NUM}[^}]*usagePercent:${RE_NUM}[^}]*\}`,
  );
  return { pctFirst, resetFirst };
};

const parseGoWindow = (html: string, key: string): GoWindow | null => {
  const { pctFirst, resetFirst } = windowRegexes(key);

  const tryMatch = (pattern: RegExp, pctIndex: number, resetIndex: number): GoWindow | null => {
    const match = html.match(pattern);
    if (!match) return null;
    const usagePercent = Number(match[pctIndex]);
    const resetInSec = Number(match[resetIndex]);
    if (!Number.isFinite(usagePercent) || !Number.isFinite(resetInSec)) return null;
    const used = Math.max(0, usagePercent);
    return {
      used,
      remaining: Math.max(0, 100 - used),
      resetInSec: Math.max(0, resetInSec),
    };
  };

  return tryMatch(pctFirst, 1, 2) ?? tryMatch(resetFirst, 2, 1);
};

export const fetchGoDashboard = async (
  workspaceId: string,
  authCookie: string,
): Promise<
  | {
      data: {
        rolling: GoWindow | null;
        weekly: GoWindow | null;
        monthly: GoWindow | null;
      };
    }
  | { error: string }
> => {
  const res = await fetchWithTimeout(DASHBOARD_URL(workspaceId), {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html',
      Cookie: `auth=${authCookie}`,
    },
  });
  if (!res.ok) return { error: httpErrorMessage('OpenCode Go', res) };

  const html = await res.text();
  const data = {
    rolling: parseGoWindow(html, 'rollingUsage'),
    weekly: parseGoWindow(html, 'weeklyUsage'),
    monthly: parseGoWindow(html, 'monthlyUsage'),
  };
  if (!data.rolling && !data.weekly && !data.monthly) {
    return { error: 'No quota data found in OpenCode Go dashboard' };
  }
  return { data };
};
