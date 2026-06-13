import { describe, expect, it } from 'vitest';

import {
  formatCountQuota,
  formatCreditQuota,
  formatPercentQuota,
  formatResponsibleUsagePace,
  formatResponsibleWeeklyUsage,
  formatUsedPercentQuota,
  WEEK_SECONDS,
} from '../src/domain/format.ts';

describe('formatPercentQuota', () => {
  it('formats used and remaining percentages according to the display mode', () => {
    expect(formatPercentQuota(33.6, 66.4, 'used')).toBe('34%');
    expect(formatPercentQuota(33.6, 66.4, 'remaining')).toBe('66%');
  });
});

describe('formatUsedPercentQuota', () => {
  it('clamps values below zero', () => {
    expect(formatUsedPercentQuota(-10, 'used')).toBe('0%');
  });

  it('clamps values above one hundred', () => {
    expect(formatUsedPercentQuota(120, 'remaining')).toBe('0%');
  });
});

describe('formatResponsibleUsagePace', () => {
  it('reports usage below the responsible pace', () => {
    expect(formatResponsibleUsagePace({ usedPct: 5, resetSec: 90 }, 100)).toBe('✓ ok · 5.00% below');
  });

  it('reports usage exactly at the responsible pace', () => {
    expect(formatResponsibleUsagePace({ usedPct: 10, resetSec: 90 }, 100)).toBe('✓ ok · 0.00% below');
  });

  it('reports usage above the responsible pace', () => {
    expect(formatResponsibleUsagePace({ usedPct: 15, resetSec: 90 }, 100)).toBe('⚠ high · 5.00% over');
  });
});

describe('formatResponsibleWeeklyUsage', () => {
  it('uses the weekly window for responsible pace calculations', () => {
    expect(formatResponsibleWeeklyUsage({ usedPct: 50, resetSec: WEEK_SECONDS / 2 })).toBe('✓ ok · 0.00% below');
  });
});

describe('formatCountQuota', () => {
  it('derives missing values when the total is known', () => {
    expect(formatCountQuota({ text: '70/100', used: 30, total: 100 }, 'remaining')).toBe('70 pts');
    expect(formatCountQuota({ text: '70/100', remaining: 70, total: 100 }, 'used')).toBe('30 pts');
  });

  it('falls back to the provider text when no numeric value can be computed', () => {
    expect(formatCountQuota({ text: 'Unlimited' }, 'used')).toBe('Unlimited');
  });

  it('clamps negative derived values to zero', () => {
    expect(formatCountQuota({ text: '-2/10', used: 12, total: 10 }, 'remaining')).toBe('0 pts');
  });
});

describe('formatCreditQuota', () => {
  it('formats used credits when the total is known', () => {
    expect(formatCreditQuota({ text: '$7.50', remaining: 7.5, total: 10 }, 'used')).toBe('$2.50/$10.00');
  });

  it('keeps the provider text for remaining credits', () => {
    expect(formatCreditQuota({ text: '$7.50', usage: 2.5, remaining: 7.5, total: 10 }, 'remaining')).toBe('$7.50');
  });

  it('falls back to the provider text when no total exists', () => {
    expect(formatCreditQuota({ text: '$1.2345 used (no limit)', usage: 1.2345 }, 'used')).toBe(
      '$1.2345 used (no limit)',
    );
  });
});
