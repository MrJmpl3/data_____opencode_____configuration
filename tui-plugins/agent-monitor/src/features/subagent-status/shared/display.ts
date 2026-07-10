// ── Debug ──────────────────────────────────────────────────────────
// ponytail: Debug state is intentionally module-level (not instance-scoped)
// because the debug flag is set once at startup via plugin options and never
// changes mid-session. A factory would add indirection without benefit.
let debugEnabled = false;

export const setDebugEnabled = (value: boolean): void => {
  debugEnabled = value;
};
export const debugLog = (...args: unknown[]): void => {
  if (debugEnabled) console.log(...args);
};

// ── Display helpers ────────────────────────────────────────────────
const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const conciseText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = normalizeWhitespace(value);
  if (!text) return undefined;
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
};

export const normalizeDisplayText = (value: string): string => normalizeWhitespace(value).toLowerCase();

export const sameDisplayText = (left?: string, right?: string): boolean => {
  if (!left || !right) return false;
  return normalizeDisplayText(left) === normalizeDisplayText(right);
};

// ── Visibility policy ──────────────────────────────────────────────
export interface SubagentVisibilityPolicy {
  doneRetentionMs: number;
  staleRetentionMs: number;
}

export const DEFAULT_DONE_RETENTION_MS = 10 * 60 * 1000;
export const DEFAULT_STALE_RETENTION_MS = 20 * 60 * 1000;

export const DEFAULT_SUBAGENT_VISIBILITY_POLICY: SubagentVisibilityPolicy = {
  doneRetentionMs: DEFAULT_DONE_RETENTION_MS,
  staleRetentionMs: DEFAULT_STALE_RETENTION_MS,
};

// ── Persisted artifacts ────────────────────────────────────────────
export interface PersistedSnapshotArtifacts {
  statusText: string;
  debugSnapshot: string;
}
