import type { UnknownRecord } from './guards.ts';
import { isRecord } from './guards.ts';

const getNested = (object: unknown, path: readonly string[]): unknown => {
  let value = object;
  for (const key of path) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
};

export const findNumber = (data: unknown, paths: readonly (readonly string[])[]): number | undefined => {
  for (const path of paths) {
    const value = getNested(data, path);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
};

export const findBoolean = (data: unknown, paths: readonly (readonly string[])[]): boolean | undefined => {
  for (const path of paths) {
    const value = getNested(data, path);
    if (typeof value === 'boolean') return value;
  }
  return undefined;
};

export const findString = (data: unknown, paths: readonly (readonly string[])[]): string | undefined => {
  for (const path of paths) {
    const value = getNested(data, path);
    if (typeof value === 'string') return value;
  }
  return undefined;
};

export const readStringField = (data: UnknownRecord, key: string): string | undefined => {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

export const readBooleanField = (data: UnknownRecord, key: string): boolean | undefined => {
  const value = data[key];
  return typeof value === 'boolean' ? value : undefined;
};

export const readNumericField = (data: UnknownRecord, key: string): number | undefined => {
  const value = data[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};
