import type { OpenAIAdditionalRateLimit, QuotaDisplayMode } from './types.ts';

export const WEEK_SECONDS = 7 * 24 * 60 * 60;
export const MONTH_SECONDS = 30 * 24 * 60 * 60;

export const formatPercentQuota = (used: number, remaining: number, displayMode: QuotaDisplayMode): string => {
  if (displayMode === 'used') return `${used.toFixed(0)}%`;
  return `${remaining.toFixed(0)}%`;
};

export const formatUsedPercentQuota = (usedPct: number, displayMode: QuotaDisplayMode): string => {
  const used = Math.max(0, Math.min(100, usedPct));
  return formatPercentQuota(used, Math.max(0, 100 - used), displayMode);
};

export const formatResponsibleUsagePace = (
  window: {
    usedPct: number;
    resetSec: number;
  },
  windowSeconds: number,
): string => {
  const totalSeconds = Math.max(1, windowSeconds);
  const usedPct = Math.max(0, Math.min(100, window.usedPct));
  const remainingSeconds = Math.max(0, Math.min(totalSeconds, window.resetSec));
  const elapsedSeconds = totalSeconds - remainingSeconds;
  const responsibleUsedPercent = (elapsedSeconds / totalSeconds) * 100;
  const deltaPercent = usedPct - responsibleUsedPercent;
  const absoluteDelta = Math.abs(deltaPercent).toFixed(2);

  if (deltaPercent <= 0) {
    return `✓ ok · ${absoluteDelta}% below`;
  }

  return `⚠ high · ${absoluteDelta}% over`;
};

export const formatResponsibleWeeklyUsage = (window: { usedPct: number; resetSec: number }): string =>
  formatResponsibleUsagePace(window, WEEK_SECONDS);

export const formatCountQuota = (
  data: { text: string; used?: number; remaining?: number; total?: number },
  displayMode: QuotaDisplayMode,
): string => {
  const { used, remaining, total } = data;
  const hasTotal = typeof total === 'number' && Number.isFinite(total) && total > 0;

  const value =
    displayMode === 'used'
      ? (used ?? (hasTotal && typeof remaining === 'number' ? total - remaining : undefined))
      : (remaining ?? (hasTotal && typeof used === 'number' ? total - used : undefined));

  if (typeof value !== 'number' || !Number.isFinite(value)) return data.text;
  return `${Math.max(0, value).toFixed(0)} pts`;
};

export const formatCreditQuota = (
  data: { text: string; usage?: number; remaining?: number; total?: number },
  displayMode: QuotaDisplayMode,
): string => {
  const { usage, remaining, total } = data;
  if (typeof total !== 'number' || total <= 0) return data.text;

  const value =
    displayMode === 'used'
      ? (usage ?? (typeof remaining === 'number' ? total - remaining : undefined))
      : (remaining ?? (typeof usage === 'number' ? total - usage : undefined));

  if (typeof value !== 'number' || !Number.isFinite(value)) return data.text;
  if (displayMode === 'remaining') return data.text;
  return `$${Math.max(0, value).toFixed(2)}/$${total.toFixed(2)}`;
};

export const formatOpenAIRateLimitStatus = (limit: {
  allowed?: boolean;
  limitReached?: boolean;
}): string | undefined => {
  if (limit.limitReached) return 'limit reached';
  if (limit.allowed === false) return 'blocked';
  if (limit.allowed === true) return 'available';
  return undefined;
};

export const isOpenAISparkRateLimit = (
  limit: Pick<OpenAIAdditionalRateLimit, 'label' | 'limitName' | 'meteredFeature'>,
): boolean => {
  const haystack = [limit.label, limit.limitName, limit.meteredFeature]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
  return haystack.includes('spark') || haystack.includes('codex');
};
