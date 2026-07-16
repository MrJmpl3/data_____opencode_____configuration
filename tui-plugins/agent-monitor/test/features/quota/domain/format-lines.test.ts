import { describe, expect, it } from 'vitest';

import {
  formatCreditQuota,
  formatCountQuota,
  formatPercentQuota,
  formatUsedPercentQuota,
  quotaColor,
  windowLine,
  paceLine,
} from '../../../../src/features/quota/domain/lines.ts';
import {
  formatOpenAIAdditionalRateLimitLabel,
  formatOpenAIRateLimitTone,
  formatPaceLineText,
  formatOpenAILines,
  formatResetCreditsLines,
  renderQuotaLine,
} from '../../../../src/features/quota/domain/format.ts';

describe('quota line helpers', () => {
  it('formats used and remaining percentages with clamping and rounding', () => {
    expect(formatPercentQuota(12.4, 87.6, 'used')).toBe('12%');
    expect(formatPercentQuota(12.4, 87.6, 'remaining')).toBe('88%');
    expect(formatUsedPercentQuota(-4, 'used')).toBe('0%');
    expect(formatUsedPercentQuota(120, 'remaining')).toBe('0%');
  });

  it('formats count data from direct and derived values', () => {
    expect(formatCountQuota({ text: 'fallback', used: 4, total: 10 }, 'used')).toBe('4 pts');
    expect(formatCountQuota({ text: 'fallback', remaining: 6, total: 10 }, 'used')).toBe('4 pts');
    expect(formatCountQuota({ text: 'fallback', used: 4, total: 10 }, 'remaining')).toBe('6 pts');
  });

  it('formats credit data from direct and derived values', () => {
    expect(formatCreditQuota({ text: 'fallback', usage: 1.25, total: 5 }, 'used')).toBe('$1.25/$5.00');
    expect(formatCreditQuota({ text: 'fallback', remaining: 3.75, total: 5 }, 'used')).toBe('$1.25/$5.00');
    expect(formatCreditQuota({ text: 'fallback', usage: 1.25, total: 5 }, 'remaining')).toBe('fallback');
  });

  it('falls back for missing, invalid, or non-positive totals', () => {
    expect(formatCountQuota({ text: 'count', total: 0, used: 2 }, 'used')).toBe('2 pts');
    expect(formatCountQuota({ text: 'count', total: 4 }, 'used')).toBe('count');
    expect(formatCreditQuota({ text: 'credit', total: 0, usage: 1 }, 'used')).toBe('credit');
    expect(formatCreditQuota({ text: 'credit', total: 4, usage: Number.NaN }, 'used')).toBe('credit');
  });

  it.each([
    [0, undefined, 'green'],
    [50, undefined, 'green'],
    [51, undefined, 'yellow'],
    [80, undefined, 'yellow'],
    [81, undefined, 'orange'],
    [99, undefined, 'orange'],
    [100, undefined, 'red'],
    [undefined, 'success', 'green'],
    [undefined, 'warning', 'yellow'],
    [undefined, 'error', 'red'],
    [undefined, undefined, 'gray'],
  ])('maps quota color boundary %#', (used, tone, expected) =>
    expect(quotaColor(used, tone as 'success' | 'warning' | 'error' | undefined)).toBe(expected),
  );

  it('creates lines with safe reset values and finite percentages only', () => {
    expect(windowLine('x', '1%', -2.8, 1000, 'warning', Number.NaN)).toEqual({
      kind: 'window',
      label: 'x',
      value: '1%',
      resetAtMs: 1000,
      tone: 'warning',
      usedPct: undefined,
    });
    const line = paceLine({ usedPct: 4, resetSec: -2.8 }, 300, 1000);
    expect(line.kind === 'pace' && line.resetAtMs).toBe(1000);
  });
});

describe('quota presentation', () => {
  it.each([
    [{ usedPct: 80, resetSec: 50 }, 100, '⚠ 30% over'],
    [{ usedPct: 10, resetSec: 50 }, 100, '✓ 40% under'],
    [{ usedPct: 100, resetSec: 1 }, 100, '⚠ 1% over'],
  ])('formats pace text %#', (window, seconds, expected) =>
    expect(formatPaceLineText(window, seconds).paceText).toBe(expected),
  );

  it('reports recovery only when an over-pace projection is positive', () => {
    expect(formatPaceLineText({ usedPct: 80, resetSec: 50 }, 100).recoverySeconds).toBe(30);
    expect(formatPaceLineText({ usedPct: 0, resetSec: 100 }, 100).recoverySeconds).toBeUndefined();
  });

  it.each([
    [{ limitReached: true }, 'error'],
    [{ allowed: false }, 'error'],
    [{ allowed: true }, 'neutral'],
    [{}, 'neutral'],
  ])('formats rate limit tone %#', (limit, expected) => expect(formatOpenAIRateLimitTone(limit)).toBe(expected));

  it('compacts additional labels, states, and suffixes', () => {
    expect(
      formatOpenAIAdditionalRateLimitLabel({ label: '  too   long label for display  ', limitReached: true }),
    ).toBe('limit reached · too long la…');
    expect(formatOpenAIAdditionalRateLimitLabel({ label: ' ', allowed: false }, '2nd')).toBe(
      'blocked · Additional… 2nd',
    );
    expect(formatOpenAIAdditionalRateLimitLabel({ label: 'short' })).toBe('short');
  });

  it('renders every quota line kind and clamps expired reset times', () => {
    expect(renderQuotaLine({ kind: 'heading', text: 'Quota' }, 1000)).toBe('● Quota');
    expect(renderQuotaLine({ kind: 'detail', text: 'Detail' }, 1000)).toBe('  Detail');
    expect(renderQuotaLine({ kind: 'window', label: '5h', value: '20%', resetAtMs: 500 }, 1000)).toBe('  5h 20% · 0s');
    expect(renderQuotaLine({ kind: 'pace', usedPct: 80, resetAtMs: 51_000, windowSeconds: 100 }, 1000)).toContain(
      '~30s',
    );
  });

  it('formats OpenAI windows, additional limits, credits, reset states, and no-data fallback', () => {
    const lines = formatOpenAILines(
      {
        hourly: { usedPct: 20, resetSec: 10, limitWindowSec: 18_000 },
        weekly: { usedPct: 40, resetSec: 10, limitWindowSec: 604_800 },
        additionalRateLimits: [
          {
            label: 'API',
            allowed: false,
            primary: { usedPct: 5, resetSec: 2 },
            secondary: { usedPct: 6, resetSec: 3 },
          },
        ],
        credits: '$2',
        resetCredits: {
          state: 'available',
          availableCount: 1,
          credits: [{ grantedAtIso: '2025-01-01', expiresAtIso: '2025-01-02' }],
          nextExpiresAtMs: Date.parse('2025-01-02'),
        },
      },
      'used',
      0,
    );
    expect(lines.map((line) => line.kind)).toEqual([
      'heading',
      'window',
      'pace',
      'window',
      'pace',
      'window',
      'window',
      'detail',
      'detail',
      'detail',
    ]);
    expect(formatOpenAILines({}, 'remaining', 0)).toEqual([{ kind: 'detail', text: 'No windows', tone: 'neutral' }]);
    expect(formatResetCreditsLines({ state: 'none-available', availableCount: 0, credits: [] })).toEqual([
      { kind: 'detail', text: 'Reset · none', tone: 'neutral' },
    ]);
    expect(formatResetCreditsLines({ state: 'unavailable', availableCount: 0, credits: [] })).toEqual([
      { kind: 'detail', text: 'Reset · unavailable', tone: 'error' },
    ]);
  });
});
