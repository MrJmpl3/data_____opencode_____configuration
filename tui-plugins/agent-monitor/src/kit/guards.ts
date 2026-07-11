export type UnknownRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is UnknownRecord => typeof value === 'object' && value !== null;

export const isPlainObject = (value: unknown): value is UnknownRecord => isRecord(value) && !Array.isArray(value);
