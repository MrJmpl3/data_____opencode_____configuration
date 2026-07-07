export type UnknownRecord = Record<string, unknown>;

/** C1: true si es objeto no-null (incluye arrays) */
export const isRecord = (v: unknown): v is UnknownRecord => typeof v === 'object' && v !== null;

/** C2: true solo para plain objects (EXCLUYE arrays) */
export const isPlainObject = (v: unknown): v is UnknownRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** C3: devuelve el string original si no está vacío, sino undefined */
export const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 ? v : undefined;

/** C4: devuelve el string en lowercase, trim, o undefined */
export const normalizedString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim().toLowerCase() : undefined;

/** C5: devuelve un numero finito o undefined */
export const toFiniteNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0) {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

/** C6: devuelve entero >= 0 o undefined */
export const toNonNegativeInteger = (v: unknown): number | undefined => {
  const parsed = toFiniteNumber(v);
  if (parsed === undefined) return undefined;
  return Math.max(0, Math.floor(parsed));
};

/** C7: devuelve epoch ms o 0; input puede ser string | undefined */
export const timestampMs = (input: string | undefined): number => {
  if (!input) return 0;
  const parsed = Date.parse(input);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** C8: devuelve el input si es parseable, sino fallback */
export const safeTimestamp = (input: unknown, fallback: string): string => {
  if (typeof input !== 'string') return fallback;
  return Number.isNaN(Date.parse(input)) ? fallback : input;
};

/** C9: devuelve ISO string o undefined */
export const timestampFromUnknown = (v: unknown): string | undefined => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const millis = v < 10_000_000_000 ? v * 1000 : v;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  if (typeof v === 'string' && v.trim().length > 0) {
    const parsed = Date.parse(v);
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
  }

  return undefined;
};

/** C10: devuelve el primer valor defined de una lista */
export const firstDefined = <T>(...values: readonly (T | undefined)[]): T | undefined => {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
};

const getNested = (obj: unknown, path: readonly string[]): unknown => {
  let value: unknown = obj;
  for (const key of path) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
};

/** C11: busca el primer numero finito en paths anidados */
export const findNumber = (data: unknown, paths: readonly (readonly string[])[]): number | undefined => {
  for (const path of paths) {
    const value = getNested(data, path);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
};

/** C12: busca el primer boolean en paths anidados */
export const findBoolean = (data: unknown, paths: readonly (readonly string[])[]): boolean | undefined => {
  for (const path of paths) {
    const value = getNested(data, path);
    if (typeof value === 'boolean') return value;
  }
  return undefined;
};

/** C13: busca el primer string en paths anidados */
export const findString = (data: unknown, paths: readonly (readonly string[])[]): string | undefined => {
  for (const path of paths) {
    const value = getNested(data, path);
    if (typeof value === 'string') return value;
  }
  return undefined;
};

/** C14: lector tipado de campo — devuelve string o undefined */
export const readStringField = (data: UnknownRecord, key: string): string | undefined => {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

/** C15: lector tipado de campo — devuelve boolean o undefined */
export const readBooleanField = (data: UnknownRecord, key: string): boolean | undefined => {
  const value = data[key];
  return typeof value === 'boolean' ? value : undefined;
};

/** C16: lector tipado de campo — devuelve numero finito o undefined */
export const readNumericField = (data: UnknownRecord, key: string): number | undefined => {
  const value = data[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};
