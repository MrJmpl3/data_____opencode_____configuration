import { describe, expect, it, vi } from 'vitest';

import {
  findFirstString,
  firstWindow,
  parseAdditionalRateLimits,
  parseOpenAIWindow,
  parseResetCreditEntry,
  parseResetCreditStatus,
  parseResetCreditsPayload,
  parseWindowFromAliases,
  readWindowResetSeconds,
} from '../../../../src/features/quota/domain/parse.ts';

describe('quota parsing', () => {
  describe('readWindowResetSeconds', () => {
    it.each([
      ['reset_after_seconds', { reset_after_seconds: 12.9 }, 12],
      ['reset_after alias', { reset_after: '8' }, 8],
      ['resetAfter alias', { resetAfter: 4 }, 4],
      ['reset_in_seconds alias', { reset_in_seconds: -2 }, 0],
      ['resetInSec alias', { resetInSec: 3 }, 3],
    ])('reads %s', (_name, input, expected) => {
      expect(readWindowResetSeconds(input)).toBe(expected);
    });

    it('reads ISO and epoch reset timestamps and rejects malformed values', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
      expect(readWindowResetSeconds({ reset_at: '2025-01-01T00:00:09.900Z' })).toBe(9);
      expect(readWindowResetSeconds({ resetAt: '2024-12-31T23:59:00Z' })).toBe(0);
      expect(readWindowResetSeconds({ reset_at: 1_735_689_609 })).toBe(9);
      expect(readWindowResetSeconds({ reset_at: 1_735_689_609_000 })).toBe(9);
      expect(readWindowResetSeconds({ reset_at: 'not-a-date' })).toBeUndefined();
      expect(readWindowResetSeconds({ reset_after: 'nope' })).toBeUndefined();
      vi.useRealTimers();
    });
  });

  describe('parseOpenAIWindow', () => {
    it.each([
      ['explicit percent and aliases', { used_pct: '25', reset_after: 10, window_seconds: '60' }, 25],
      ['used over limit', { used: 2, total: 8, reset_after_seconds: 10 }, 25],
      ['remaining over limit', { remaining: 6, quota: 8, reset_after_seconds: 10 }, 25],
      ['remaining percent', { remainingPct: 75, reset_after_seconds: 10 }, 25],
      ['clamps percent', { used_percent: 150, reset_after_seconds: 10 }, 100],
    ])('parses %s', (_name, input, usedPct) => {
      expect(parseOpenAIWindow(input)).toMatchObject({ usedPct, resetSec: 10 });
    });

    it.each([
      null,
      'window',
      {},
      { used: 1, limit: 0, reset_after: 10 },
      { used_percent: Number.NaN, reset_after: 10 },
      { used_percent: 20 },
    ])('returns undefined for malformed or incomplete input %#', (input) => {
      expect(parseOpenAIWindow(input)).toBeUndefined();
    });
  });

  it('selects the first valid primary and secondary windows, then supports direct windows', () => {
    const primary = { used_percent: 20, reset_after: 5 };
    const secondary = { used_percent: 40, reset_after: 6 };
    expect(firstWindow({ primary_window: {}, primary, secondary_window: secondary })).toEqual({
      primary: { usedPct: 20, resetSec: 5, limitWindowSec: undefined },
      secondary: { usedPct: 40, resetSec: 6, limitWindowSec: undefined },
    });
    expect(firstWindow({ used_percent: 10, reset_after: 2 })).toEqual({
      primary: { usedPct: 10, resetSec: 2, limitWindowSec: undefined },
    });
    expect(firstWindow({ nope: true })).toEqual({});
    expect(parseWindowFromAliases({ first: {}, second: secondary }, ['first', 'second'])).toMatchObject({
      usedPct: 40,
    });
    expect(parseWindowFromAliases({ used_percent: 10, reset_after: 2 }, ['missing'])).toMatchObject({ usedPct: 10 });
    expect(parseWindowFromAliases(undefined, ['first'])).toBeUndefined();
  });

  it('finds the first non-empty string alias', () => {
    expect(findFirstString({ one: ' ', two: 'chosen' }, ['one', 'two'])).toBe('chosen');
    expect(findFirstString({ one: 4 }, ['one'])).toBeUndefined();
  });

  describe('parseAdditionalRateLimits', () => {
    it('parses object and array forms, nested rate limits, labels, and state fields', () => {
      const result = parseAdditionalRateLimits({
        nested: {
          rate_limit: {
            limitName: 'requests',
            allowed: true,
            limit_reached: false,
            primary: { used_percent: 30, reset_after: 20 },
          },
          meteredFeature: 'feature',
        },
        invalid: { name: 'ignored' },
      });
      expect(result).toEqual([
        {
          label: 'feature',
          limitName: undefined,
          meteredFeature: 'feature',
          allowed: true,
          limitReached: false,
          primary: { usedPct: 30, resetSec: 20, limitWindowSec: undefined },
          secondary: undefined,
        },
      ]);
      expect(
        parseAdditionalRateLimits([{ id: 'array-label', window: { used_percent: 1, reset_after: 2 } }, 4]),
      ).toMatchObject([{ label: 'array-label' }]);
      expect(parseAdditionalRateLimits(null)).toEqual([]);
    });
  });

  describe('reset credits', () => {
    it.each(['available', 'REDEEMED', ' expired ', 'redeeming'])('normalizes status %s', (value) => {
      expect(parseResetCreditStatus(value)).toBe(value.trim().toLowerCase());
    });

    it.each([null, 1, '', 'unknown'])('rejects status %#', (value) =>
      expect(parseResetCreditStatus(value)).toBeUndefined(),
    );

    it('parses aliases and discards empty entries', () => {
      expect(parseResetCreditEntry({ grantedAt: '2025-01-01', state: 'available' })).toEqual({
        grantedAtIso: '2025-01-01',
        expiresAtIso: undefined,
        status: 'available',
      });
      expect(parseResetCreditEntry({})).toBeNull();
      expect(parseResetCreditEntry('bad')).toBeNull();
    });

    it('returns unavailable for malformed payloads and calculates the next future expiry', () => {
      const now = Date.parse('2025-01-01T00:00:00Z');
      expect(parseResetCreditsPayload('bad', now)).toMatchObject({
        state: 'unavailable',
        availableCount: 0,
        credits: [],
      });
      expect(
        parseResetCreditsPayload(
          {
            availableCount: -2.8,
            credits: [
              { expires_at: '2025-01-03T00:00:00Z', status: 'available' },
              { expires_at: '2024-01-01T00:00:00Z' },
              { status: 'invalid' },
            ],
          },
          now,
        ),
      ).toEqual({
        state: 'none-available',
        availableCount: 0,
        credits: [
          { grantedAtIso: undefined, expiresAtIso: '2025-01-03T00:00:00Z', status: 'available' },
          { grantedAtIso: undefined, expiresAtIso: '2024-01-01T00:00:00Z', status: undefined },
        ],
        nextExpiresAtMs: Date.parse('2025-01-03T00:00:00Z'),
      });
      expect(parseResetCreditsPayload({ available_count: 2.9, credits: [] }, now)).toEqual({
        state: 'available',
        availableCount: 2,
        credits: [],
        nextExpiresAtMs: undefined,
      });
    });
  });
});
