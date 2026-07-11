import type { PercentWindow, QuotaDisplayMode, QuotaLine, QuotaLineTone } from './types.ts';

export const formatPercentQuota = (used: number, remaining: number, displayMode: QuotaDisplayMode): string => {
  if (displayMode === 'used') return `${used.toFixed(0)}%`;
  return `${remaining.toFixed(0)}%`;
};

export const formatUsedPercentQuota = (usedPct: number, displayMode: QuotaDisplayMode): string => {
  const used = Math.max(0, Math.min(100, usedPct));
  return formatPercentQuota(used, Math.max(0, 100 - used), displayMode);
};

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

const indentQuotaLine = (text: string): string => `  ${text}`;

export const quotaColor = (usedPct: number | undefined, tone: QuotaLineTone | undefined): string => {
  if (usedPct !== undefined) {
    if (usedPct <= 50) return 'green';
    if (usedPct <= 80) return 'yellow';
    if (usedPct < 100) return 'orange';
    return 'red';
  }
  if (tone === 'success') return 'green';
  if (tone === 'warning') return 'yellow';
  if (tone === 'error') return 'red';
  return 'gray';
};

export const headingLine = (text: string): QuotaLine => ({ kind: 'heading', text });
export const detailTextLine = (text: string, tone: QuotaLineTone = 'neutral'): QuotaLine => ({
  kind: 'detail',
  text,
  tone,
});

export const windowLine = (
  label: string,
  value: string,
  resetSec: number,
  capturedAtMs: number,
  tone: QuotaLineTone = 'neutral',
  usedPct?: number,
): QuotaLine => ({
  kind: 'window',
  label,
  value,
  resetAtMs: capturedAtMs + Math.max(0, Math.floor(resetSec)) * 1000,
  tone,
  usedPct: usedPct !== undefined && Number.isFinite(usedPct) ? usedPct : undefined,
});

export const paceLine = (window: PercentWindow, windowSeconds: number, capturedAtMs: number): QuotaLine => ({
  kind: 'pace',
  usedPct: window.usedPct,
  resetAtMs: capturedAtMs + Math.max(0, Math.floor(window.resetSec)) * 1000,
  windowSeconds,
});
