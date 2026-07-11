import type { GoWindow, OpenCodeGoWorkspaceConfig, QuotaDisplayMode, QuotaLine } from '../../domain/types.ts';
import { MONTH_SECONDS, WEEK_SECONDS } from '../../domain/types.ts';
import { formatPercentQuota } from '../../domain/lines.ts';
import { detailTextLine, headingLine, paceLine, windowLine } from '../../domain/lines.ts';
import { readQuotaConfig } from './config.ts';
import { DASHBOARD_URL, USER_AGENT } from './constants.ts';
import { fetchWithTimeout, httpErrorMessage } from './http.ts';

type GoDashboard = {
  rolling: GoWindow | null;
  weekly: GoWindow | null;
  monthly: GoWindow | null;
};

interface GoConnectionConfig {
  authCookie: string;
  workspaces: readonly OpenCodeGoWorkspaceConfig[];
}

const GO_DEFAULT_WORKSPACE_LABEL = 'OpenCode Go';

export const formatOpencodeGoWorkspaceHeading = (workspaceLabel: string): string => {
  if (workspaceLabel === GO_DEFAULT_WORKSPACE_LABEL) return workspaceLabel;

  const dotPrefix = `${GO_DEFAULT_WORKSPACE_LABEL} · `;
  if (workspaceLabel.startsWith(dotPrefix)) {
    return `${GO_DEFAULT_WORKSPACE_LABEL} (${workspaceLabel.slice(dotPrefix.length)})`;
  }

  const parenthesizedPrefix = `${GO_DEFAULT_WORKSPACE_LABEL} (`;
  if (workspaceLabel.startsWith(parenthesizedPrefix)) return workspaceLabel;

  return `${GO_DEFAULT_WORKSPACE_LABEL} (${workspaceLabel})`;
};

export const readOpencodeGoConfig = (): GoConnectionConfig | null => {
  const config = readQuotaConfig();
  const opencodeGoSection = config?.providers?.['opencode-go'];
  if (!opencodeGoSection) return null;

  return { authCookie: opencodeGoSection.authCookie, workspaces: opencodeGoSection.workspaces };
};

const DECIMAL_PATTERN = String.raw`(-?\d+(?:\.\d+)?)`;

const windowRegexes = (key: string): { usagePercentFirst: RegExp; resetFirst: RegExp } => {
  const usagePercentFirst = new RegExp(
    String.raw`${key}:\$R\[\d+\]=\{[^}]*usagePercent:${DECIMAL_PATTERN}[^}]*resetInSec:${DECIMAL_PATTERN}[^}]*\}`,
  );
  const resetFirst = new RegExp(
    String.raw`${key}:\$R\[\d+\]=\{[^}]*resetInSec:${DECIMAL_PATTERN}[^}]*usagePercent:${DECIMAL_PATTERN}[^}]*\}`,
  );
  return { usagePercentFirst, resetFirst };
};

const parseGoWindow = (html: string, key: string): GoWindow | null => {
  const { usagePercentFirst, resetFirst } = windowRegexes(key);

  const tryMatch = (pattern: RegExp, usagePercentIndex: number, resetIndex: number): GoWindow | null => {
    const match = html.match(pattern);
    if (!match) return null;
    const usagePercent = Number(match[usagePercentIndex]);
    const resetInSec = Number(match[resetIndex]);
    if (!Number.isFinite(usagePercent) || !Number.isFinite(resetInSec)) return null;
    const used = Math.max(0, usagePercent);
    return {
      used,
      remaining: Math.max(0, 100 - used),
      resetInSec: Math.max(0, resetInSec),
    };
  };

  return tryMatch(usagePercentFirst, 1, 2) ?? tryMatch(resetFirst, 2, 1);
};

const formatOpencodeGoLines = (data: GoDashboard, displayMode: QuotaDisplayMode, fetchedAtMs: number): QuotaLine[] => {
  const lines: QuotaLine[] = [];

  const windows: readonly (readonly [string, keyof GoDashboard, number | undefined])[] = [
    ['5h', 'rolling', 5 * 3600],
    ['Wk', 'weekly', WEEK_SECONDS],
    ['Mo', 'monthly', MONTH_SECONDS],
  ];

  for (const [name, key, paceWindowSeconds] of windows) {
    const window = data[key];
    if (!window) continue;

    lines.push(
      windowLine(
        name,
        formatPercentQuota(window.used, window.remaining, displayMode),
        window.resetInSec,
        fetchedAtMs,
        'neutral',
        window.used,
      ),
    );

    if (paceWindowSeconds !== undefined) {
      lines.push(paceLine({ usedPct: window.used, resetSec: window.resetInSec }, paceWindowSeconds, fetchedAtMs));
    }
  }

  return lines.length ? lines : [detailTextLine('No windows')];
};

export const formatOpencodeGoWorkspaceLines = (
  workspace: OpenCodeGoWorkspaceConfig,
  data: GoDashboard,
  displayMode: QuotaDisplayMode,
  fetchedAtMs: number,
): QuotaLine[] => {
  return [
    headingLine(formatOpencodeGoWorkspaceHeading(workspace.label)),
    ...formatOpencodeGoLines(data, displayMode, fetchedAtMs),
  ];
};

export const fetchOpencodeGoDashboard = async (
  workspaceId: string,
  authCookie: string,
  signal?: AbortSignal,
  timeoutMs?: number,
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
  const response = await fetchWithTimeout(
    DASHBOARD_URL(workspaceId),
    {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
        Cookie: `auth=${authCookie}`,
      },
    },
    timeoutMs,
    signal,
  );
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    return { error: httpErrorMessage('OpenCode Go', response, errorText) };
  }

  const html = await response.text();
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
