import { fmtDuration } from '../../../kit/format.ts';
import type {
  OpenAIAdditionalRateLimit,
  OpenAIResult,
  OpenAIWindow,
  PercentWindow,
  QuotaDisplayMode,
  QuotaLine,
  QuotaLineTone,
  OpenAIResetCreditsResult,
} from './types.ts';
import { MONTH_SECONDS, WEEK_SECONDS } from './types.ts';
import { detailTextLine, headingLine, windowLine, paceLine, formatUsedPercentQuota } from './lines.ts';
import {
  parseWindowFromAliases,
  parseResetCreditsPayload,
  parseAdditionalRateLimits,
  parseOpenAIWindow,
  firstWindow,
  readWindowResetSeconds,
} from './parse.ts';

const formatCompactPercent = (value: number): string => value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');

const deriveWindowLabel = (limitWindowSec: number, fallback: string): string => {
  if (Math.abs(limitWindowSec - 5 * 3600) < 300) return '5h';
  if (Math.abs(limitWindowSec - 24 * 3600) < 600) return '24h';
  if (Math.abs(limitWindowSec - 7 * 24 * 3600) < 600) return 'Wk';
  if (Math.abs(limitWindowSec - 30 * 24 * 3600) < 3600) return 'Mo';
  return fallback;
};

export const formatPaceLineText = (
  window: { usedPct: number; resetSec: number },
  windowSeconds: number,
): { paceText: string; recoverySeconds: number | undefined } => {
  const totalSeconds = Math.max(1, windowSeconds);
  const usedPct = Math.max(0, Math.min(100, window.usedPct));
  const resetSec = Math.max(0, Math.min(totalSeconds, window.resetSec));
  const elapsedSeconds = totalSeconds - resetSec;
  const responsibleUsedPercent = (elapsedSeconds / totalSeconds) * 100;
  const deltaPercent = usedPct - responsibleUsedPercent;
  const isOverPace = deltaPercent > 0;
  const absoluteDelta = formatCompactPercent(Math.abs(deltaPercent));
  const paceText = isOverPace ? `⚠ ${absoluteDelta}% over` : `✓ ${absoluteDelta}% under`;
  let recoverySeconds: number | undefined;
  if (isOverPace) {
    const projected = Math.ceil((usedPct * totalSeconds) / 100 - elapsedSeconds);
    if (projected > 0) recoverySeconds = projected;
  }
  return { paceText, recoverySeconds };
};

export const formatOpenAIRateLimitTone = (limit: { allowed?: boolean; limitReached?: boolean }): QuotaLineTone => {
  if (limit.limitReached) return 'error';
  if (limit.allowed === false) return 'error';
  return 'neutral';
};

const compactText = (text: string, maxLength: number): string => {
  const normalizedText = text.trim().replace(/\s+/g, ' ') || 'Additional limit';
  if (normalizedText.length <= maxLength) return normalizedText;
  if (maxLength <= 1) return normalizedText.slice(0, maxLength);
  return `${normalizedText.slice(0, maxLength - 1).trimEnd()}…`;
};

export const formatOpenAIAdditionalRateLimitLabel = (
  limit: Pick<OpenAIAdditionalRateLimit, 'label' | 'allowed' | 'limitReached'>,
  suffix?: string,
): string => {
  const stateLabel = limit.limitReached ? 'limit reached' : limit.allowed === false ? 'blocked' : '';
  const compactLabel = compactText(limit.label, stateLabel ? 12 : 16);
  const label = stateLabel ? `${stateLabel} · ${compactLabel}` : compactLabel;
  return suffix ? `${label} ${suffix}` : label;
};

export const renderQuotaLine = (line: QuotaLine, nowMs: number): string => {
  const indent = (text: string): string => `  ${text}`;
  const indentPace = (text: string): string => `    ${text}`;
  switch (line.kind) {
    case 'heading':
      return `● ${line.text}`;
    case 'detail':
      return indent(line.text);
    case 'window': {
      const resetSec = Math.max(0, Math.ceil((line.resetAtMs - nowMs) / 1000));
      return indent(`${line.label} ${line.value} · ${fmtDuration(resetSec)}`);
    }
    case 'pace': {
      const resetSec = Math.max(0, Math.ceil((line.resetAtMs - nowMs) / 1000));
      const { paceText, recoverySeconds } = formatPaceLineText({ usedPct: line.usedPct, resetSec }, line.windowSeconds);
      const projection = recoverySeconds !== undefined ? ` · ~${fmtDuration(recoverySeconds)}` : '';
      return indentPace(`${paceText}${projection}`);
    }
  }
};

const formatCompactResetDate = (dateMs: number): string =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(dateMs));

export const formatResetCreditsLines = (resetCredits: OpenAIResetCreditsResult): QuotaLine[] => {
  switch (resetCredits.state) {
    case 'available': {
      const countLabel = resetCredits.availableCount === 1 ? '1 available' : `${resetCredits.availableCount} available`;
      const expiryLabel = resetCredits.nextExpiresAtMs
        ? ` · ${formatCompactResetDate(resetCredits.nextExpiresAtMs)}`
        : '';
      const lines: QuotaLine[] = [detailTextLine(`Reset · ${countLabel}${expiryLabel}`)];
      if (resetCredits.nextExpiresAtMs) {
        const nextCredit = resetCredits.credits.find((credit) => {
          if (!credit.expiresAtIso) return false;
          const ms = Date.parse(credit.expiresAtIso);
          return !Number.isNaN(ms) && ms === resetCredits.nextExpiresAtMs;
        });
        if (nextCredit?.grantedAtIso) {
          const grantedMs = Date.parse(nextCredit.grantedAtIso);
          if (!Number.isNaN(grantedMs)) lines.push(detailTextLine(`Granted ${formatCompactResetDate(grantedMs)}`));
        }
      }
      return lines;
    }
    case 'none-available':
      return [detailTextLine('Reset · none')];
    case 'unavailable':
      return [detailTextLine('Reset · unavailable', 'error')];
  }
};

export const formatOpenAILines = (
  data: OpenAIResult,
  displayMode: QuotaDisplayMode,
  fetchedAtMs: number,
): QuotaLine[] => {
  const lines: QuotaLine[] = [];
  const addWindow = (
    label: string,
    window: OpenAIWindow | undefined,
    paceWindowSeconds?: number,
    tone?: QuotaLineTone,
  ) => {
    if (!window) return;
    const effectiveLabel =
      window.limitWindowSec !== undefined ? deriveWindowLabel(window.limitWindowSec, label) : label;
    lines.push(
      windowLine(
        effectiveLabel,
        formatUsedPercentQuota(window.usedPct, displayMode),
        window.resetSec,
        fetchedAtMs,
        tone,
        window.usedPct,
      ),
    );
    if (paceWindowSeconds) {
      const effectivePace = window.limitWindowSec ?? paceWindowSeconds;
      lines.push(paceLine(window, effectivePace, fetchedAtMs));
    }
  };
  addWindow('5h', data.hourly, 5 * 3600);
  addWindow('Wk', data.weekly, WEEK_SECONDS);
  addWindow('Code', data.codeReview, MONTH_SECONDS);
  for (const limit of data.additionalRateLimits ?? []) {
    const tone = formatOpenAIRateLimitTone(limit);
    addWindow(formatOpenAIAdditionalRateLimitLabel(limit), limit.primary, undefined, tone);
    addWindow(formatOpenAIAdditionalRateLimitLabel(limit, '2nd'), limit.secondary, undefined, tone);
  }
  if (data.credits) lines.push(detailTextLine(`Credits ${data.credits}`));
  if (data.resetCredits) lines.push(...formatResetCreditsLines(data.resetCredits));
  if (lines.length === 0) return [detailTextLine('No windows')];
  return [headingLine('OpenAI'), ...lines];
};
