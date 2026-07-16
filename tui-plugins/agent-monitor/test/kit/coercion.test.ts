import { describe, expect, it } from 'vitest';

import {
  asString,
  findBoolean,
  findNumber,
  findString,
  firstDefined,
  isOneOf,
  normalizedString,
  readBooleanField,
  readNumericField,
  readStringField,
  safeTimestamp,
  timestampFromUnknown,
  timestampMs,
  toFiniteNumber,
  toNonNegativeInteger,
} from '../../src/kit/coercion.ts';

describe('coercion and nested helpers', () => {
  it.each([
    [['value', ' value '], 'value'],
    [['', ' ', null], undefined],
  ])('coerces strings', (input, expected) => {
    expect(asString(input[0])).toBe(expected);
  });

  it('normalizes strings and numbers', () => {
    expect(normalizedString('  Mixed Case ')).toBe('mixed case');
    expect(normalizedString(1)).toBeUndefined();
    expect(toFiniteNumber(' 12.5 ')).toBe(12.5);
    expect(toFiniteNumber('')).toBeUndefined();
    expect(toFiniteNumber(Infinity)).toBeUndefined();
    expect(toNonNegativeInteger('-2.8')).toBe(0);
    expect(toNonNegativeInteger('2.8')).toBe(2);
  });

  it('reads typed fields and nested paths with fallback behavior', () => {
    const record = { string: 'text', blank: ' ', boolean: true, number: '4', nested: { value: 9 } };
    expect(readStringField(record, 'string')).toBe('text');
    expect(readStringField(record, 'blank')).toBeUndefined();
    expect(readBooleanField(record, 'boolean')).toBe(true);
    expect(readBooleanField(record, 'number')).toBeUndefined();
    expect(readNumericField(record, 'number')).toBe(4);
    expect(readNumericField(record, 'missing')).toBeUndefined();
    expect(findNumber(record, [['nested', 'value'], ['number']])).toBe(9);
    expect(findBoolean(record, [['missing'], ['boolean']])).toBe(true);
    expect(findString(record, [['nested', 'missing'], ['string']])).toBe('text');
    expect(findNumber({ nested: 1 }, [['nested', 'value']])).toBeUndefined();
  });

  it('handles timestamps, firstDefined, and membership predicates', () => {
    expect(timestampMs(undefined)).toBe(0);
    expect(timestampMs('invalid')).toBe(0);
    expect(timestampMs('2025-01-01T00:00:00Z')).toBe(Date.parse('2025-01-01T00:00:00Z'));
    expect(safeTimestamp('invalid', 'fallback')).toBe('fallback');
    expect(safeTimestamp('2025-01-01', 'fallback')).toBe('2025-01-01');
    expect(timestampFromUnknown(1_735_689_600)).toBe('2025-01-01T00:00:00.000Z');
    expect(timestampFromUnknown('2025-01-01')).toBe('2025-01-01T00:00:00.000Z');
    expect(timestampFromUnknown(0)).toBeUndefined();
    expect(timestampFromUnknown('invalid')).toBeUndefined();
    expect(firstDefined(undefined, 0, 2)).toBe(0);
    const isProvider = isOneOf('openai', 'ollama-cloud');
    expect(isProvider('openai')).toBe(true);
    expect(isProvider('other')).toBe(false);
  });
});
