import { describe, expect, it } from 'vitest';

import { isPlainObject, isRecord } from '../../../src/kit/coercion.ts';

describe('coercion', () => {
  it('accepts objects and arrays as records', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(true);
    expect(isRecord([1, 2, 3])).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('string')).toBe(false);
    expect(isRecord(42)).toBe(false);
  });

  it('rejects arrays when checking isPlainObject', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });
});
